use serde::{Deserialize, Serialize};
use std::fmt;

use super::model::FocusProfile;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FocusStatus {
    Idle,
    Preparing,
    Active,
    Releasing,
    RecoveryRequired,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FocusPhase {
    Work,
    ShortBreak,
    LongBreak,
}

impl FocusPhase {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Work => "work",
            Self::ShortBreak => "short_break",
            Self::LongBreak => "long_break",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct FocusSnapshot {
    pub status: FocusStatus,
    pub current_phase: Option<FocusPhase>,
    pub active_profile: Option<FocusProfile>,
    pub current_work_round: u32,
    pub total_work_rounds: u32,
    pub is_locked: bool,
    pub blocking_active: bool,
    pub unblock_during_breaks: bool,
}

#[derive(Debug, PartialEq, Eq)]
pub enum FocusError {
    SessionLocked,
    NoActiveProfile,
    InvalidTransition(&'static str),
}

impl fmt::Display for FocusError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::SessionLocked => write!(f, "Session is locked while active"),
            Self::NoActiveProfile => write!(f, "No active profile selected"),
            Self::InvalidTransition(msg) => write!(f, "Invalid state transition: {msg}"),
        }
    }
}

impl std::error::Error for FocusError {}

pub struct FocusStateMachine {
    status: FocusStatus,
    current_phase: Option<FocusPhase>,
    active_profile: Option<FocusProfile>,
    current_work_round: u32,
    total_work_rounds: u32,
    blocking_active: bool,
    unblock_during_breaks: bool,
}

impl FocusStateMachine {
    pub fn new() -> Self {
        Self {
            status: FocusStatus::Idle,
            current_phase: None,
            active_profile: None,
            current_work_round: 0,
            total_work_rounds: 0,
            blocking_active: false,
            unblock_during_breaks: false,
        }
    }

    pub fn snapshot(&self) -> FocusSnapshot {
        FocusSnapshot {
            status: self.status,
            current_phase: self.current_phase,
            active_profile: self.active_profile.clone(),
            current_work_round: self.current_work_round,
            total_work_rounds: self.total_work_rounds,
            is_locked: self.status == FocusStatus::Active || self.status == FocusStatus::Preparing,
            blocking_active: self.blocking_active,
            unblock_during_breaks: self.unblock_during_breaks,
        }
    }

    pub fn set_unblock_during_breaks(&mut self, unblock: bool) {
        self.unblock_during_breaks = unblock;
        // If currently in a break, update blocking_active accordingly
        if self.status == FocusStatus::Active {
            if let Some(phase) = self.current_phase {
                if phase == FocusPhase::ShortBreak || phase == FocusPhase::LongBreak {
                    self.blocking_active = !unblock;
                }
            }
        }
    }

    pub fn select_profile(&mut self, profile: Option<FocusProfile>) -> Result<(), FocusError> {
        if self.status == FocusStatus::Active || self.status == FocusStatus::Preparing {
            return Err(FocusError::SessionLocked);
        }
        if let Some(p) = &profile {
            self.total_work_rounds = p.work_rounds;
        } else {
            self.total_work_rounds = 0;
        }
        self.active_profile = profile;
        Ok(())
    }

    pub fn handle_work_started(&mut self) -> Result<(), FocusError> {
        if self.active_profile.is_none() {
            // Not a focus session run (standard timer)
            return Ok(());
        }

        self.status = FocusStatus::Active;
        self.current_phase = Some(FocusPhase::Work);
        if self.current_work_round == 0 {
            self.current_work_round = 1;
        }
        self.blocking_active = true;
        Ok(())
    }

    pub fn handle_round_completed(&mut self, next_phase: FocusPhase) -> Result<(), FocusError> {
        if self.status != FocusStatus::Active {
            return Ok(());
        }

        self.current_phase = Some(next_phase);
        match next_phase {
            FocusPhase::Work => {
                self.current_work_round += 1;
                self.blocking_active = true;
            }
            FocusPhase::ShortBreak | FocusPhase::LongBreak => {
                self.blocking_active = !self.unblock_during_breaks;
            }
        }
        Ok(())
    }

    pub fn handle_cycle_finished(&mut self) -> Result<(), FocusError> {
        self.status = FocusStatus::Idle;
        self.current_phase = None;
        self.current_work_round = 0;
        self.blocking_active = false;
        Ok(())
    }

    pub fn handle_emergency_released(&mut self) -> Result<(), FocusError> {
        self.status = FocusStatus::Idle;
        self.current_phase = None;
        self.current_work_round = 0;
        self.blocking_active = false;
        Ok(())
    }

    pub fn is_active(&self) -> bool {
        self.status == FocusStatus::Active
    }

    pub fn is_locked(&self) -> bool {
        self.status == FocusStatus::Active || self.status == FocusStatus::Preparing
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_profile(rounds: u32) -> FocusProfile {
        FocusProfile {
            id: "test-prof".to_string(),
            name: "Focus".to_string(),
            work_secs: 1500,
            short_break_secs: 300,
            long_break_secs: 900,
            work_rounds: rounds,
            blocked_apps: vec![],
            blocked_domains: vec!["reddit.com".to_string()],
            revision: 1,
        }
    }

    #[test]
    fn test_focus_cycle_transitions_and_locking() {
        let profile = sample_profile(2);
        let mut sm = FocusStateMachine::new();
        sm.select_profile(Some(profile)).unwrap();

        // Start work round 1
        sm.handle_work_started().unwrap();
        assert!(sm.snapshot().is_locked);
        assert!(sm.snapshot().blocking_active);
        assert_eq!(sm.snapshot().current_phase, Some(FocusPhase::Work));
        assert_eq!(sm.snapshot().current_work_round, 1);

        // Attempt to switch profile while active -> must error
        assert_eq!(sm.select_profile(None), Err(FocusError::SessionLocked));

        // Transition to break with unblock_during_breaks = true
        sm.set_unblock_during_breaks(true);
        sm.handle_round_completed(FocusPhase::ShortBreak).unwrap();
        assert!(sm.snapshot().is_locked);
        assert!(!sm.snapshot().blocking_active); // unblocked during break

        // Back to work round 2
        sm.handle_round_completed(FocusPhase::Work).unwrap();
        assert!(sm.snapshot().blocking_active); // re-blocked
        assert_eq!(sm.snapshot().current_work_round, 2);

        // Final long break
        sm.handle_round_completed(FocusPhase::LongBreak).unwrap();
        assert!(!sm.snapshot().blocking_active);

        // Final completion -> returns to Idle, unblocks, unlocks
        sm.handle_cycle_finished().unwrap();
        assert_eq!(sm.snapshot().status, FocusStatus::Idle);
        assert!(!sm.snapshot().is_locked);
        assert!(!sm.snapshot().blocking_active);
    }

    #[test]
    fn test_emergency_release() {
        let profile = sample_profile(4);
        let mut sm = FocusStateMachine::new();
        sm.select_profile(Some(profile)).unwrap();
        sm.handle_work_started().unwrap();
        assert!(sm.is_locked());

        sm.handle_emergency_released().unwrap();
        assert!(!sm.is_locked());
        assert_eq!(sm.snapshot().status, FocusStatus::Idle);
        assert!(!sm.snapshot().blocking_active);
    }
}
