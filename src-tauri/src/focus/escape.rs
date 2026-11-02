use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use uuid::Uuid;

use super::security::verify_passphrase;

pub const REQUIRED_HOLD_DURATION: Duration = Duration::from_secs(60);
pub const MAX_PULSE_GAP: Duration = Duration::from_millis(1500);
pub const PASSPHRASE_ATTEMPT_EXPIRY: Duration = Duration::from_secs(120);

#[derive(Debug, PartialEq, Eq)]
pub enum EscapeError {
    AttemptNotFound,
    HoldInterrupted,
    InvalidPassphrase,
    PassphraseMismatch,
    AttemptExpired,
}

impl std::fmt::Display for EscapeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::AttemptNotFound => write!(f, "Emergency exit attempt not found"),
            Self::HoldInterrupted => write!(f, "Continuous hold was interrupted or timed out"),
            Self::InvalidPassphrase => write!(f, "Invalid passphrase provided"),
            Self::PassphraseMismatch => write!(f, "Confirmation passphrase did not match first entry"),
            Self::AttemptExpired => write!(f, "Passphrase confirmation expired"),
        }
    }
}

impl std::error::Error for EscapeError {}

struct HoldAttempt {
    started_at: Instant,
    last_pulse_at: Instant,
    completed: bool,
}

struct PassphraseAttempt {
    first_entry: String,
    created_at: Instant,
    completed: bool,
}

pub struct EscapeHandler {
    holds: Mutex<HashMap<String, HoldAttempt>>,
    passphrases: Mutex<HashMap<String, PassphraseAttempt>>,
}

impl EscapeHandler {
    pub fn new() -> Self {
        Self {
            holds: Mutex::new(HashMap::new()),
            passphrases: Mutex::new(HashMap::new()),
        }
    }

    // --- Continuous Hold ---

    pub fn start_hold(&self) -> String {
        let attempt_id = Uuid::new_v4().to_string();
        let now = Instant::now();
        let mut holds = self.holds.lock().unwrap();
        holds.insert(
            attempt_id.clone(),
            HoldAttempt {
                started_at: now,
                last_pulse_at: now,
                completed: false,
            },
        );
        attempt_id
    }

    /// Pulses the hold attempt. Returns `Ok(true)` if hold duration (60s) has been reached.
    pub fn pulse_hold(&self, attempt_id: &str) -> Result<bool, EscapeError> {
        let now = Instant::now();
        let mut holds = self.holds.lock().unwrap();
        let attempt = holds.get_mut(attempt_id).ok_or(EscapeError::AttemptNotFound)?;

        if attempt.completed {
            return Ok(true);
        }

        // Check if hold was interrupted (too much time between pulses)
        if now.duration_since(attempt.last_pulse_at) > MAX_PULSE_GAP {
            holds.remove(attempt_id);
            return Err(EscapeError::HoldInterrupted);
        }

        attempt.last_pulse_at = now;

        if now.duration_since(attempt.started_at) >= REQUIRED_HOLD_DURATION {
            attempt.completed = true;
            Ok(true)
        } else {
            Ok(false)
        }
    }

    pub fn cancel_hold(&self, attempt_id: &str) {
        let mut holds = self.holds.lock().unwrap();
        holds.remove(attempt_id);
    }

    pub fn get_hold_progress_pct(&self, attempt_id: &str) -> Option<f32> {
        let holds = self.holds.lock().unwrap();
        let attempt = holds.get(attempt_id)?;
        let elapsed = Instant::now().duration_since(attempt.started_at).as_secs_f32();
        let total = REQUIRED_HOLD_DURATION.as_secs_f32();
        let pct = (elapsed / total).clamp(0.0, 1.0) * 100.0;
        Some(pct)
    }

    // --- Passphrase Exit ---

    pub fn submit_passphrase_first(
        &self,
        plain_first: &str,
        expected_hash: &str,
    ) -> Result<String, EscapeError> {
        if !verify_passphrase(plain_first, expected_hash) {
            return Err(EscapeError::InvalidPassphrase);
        }

        let attempt_id = Uuid::new_v4().to_string();
        let mut passphrases = self.passphrases.lock().unwrap();
        passphrases.insert(
            attempt_id.clone(),
            PassphraseAttempt {
                first_entry: plain_first.to_string(),
                created_at: Instant::now(),
                completed: false,
            },
        );
        Ok(attempt_id)
    }

    pub fn submit_passphrase_confirm(
        &self,
        attempt_id: &str,
        plain_second: &str,
    ) -> Result<bool, EscapeError> {
        let mut passphrases = self.passphrases.lock().unwrap();
        let attempt = passphrases
            .get_mut(attempt_id)
            .ok_or(EscapeError::AttemptNotFound)?;

        if Instant::now().duration_since(attempt.created_at) > PASSPHRASE_ATTEMPT_EXPIRY {
            passphrases.remove(attempt_id);
            return Err(EscapeError::AttemptExpired);
        }

        if attempt.first_entry != plain_second {
            passphrases.remove(attempt_id);
            return Err(EscapeError::PassphraseMismatch);
        }

        attempt.completed = true;
        passphrases.remove(attempt_id);
        Ok(true)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::focus::security::hash_passphrase;

    #[test]
    fn test_hold_lifecycle() {
        let handler = EscapeHandler::new();
        let id = handler.start_hold();

        // Pulse within reasonable time
        assert!(!handler.pulse_hold(&id).unwrap());
        assert!(handler.get_hold_progress_pct(&id).unwrap() >= 0.0);

        // Cancel removes attempt
        handler.cancel_hold(&id);
        assert_eq!(handler.pulse_hold(&id), Err(EscapeError::AttemptNotFound));
    }

    #[test]
    fn test_passphrase_two_step_verification() {
        let handler = EscapeHandler::new();
        let pass = "this-is-a-long-passphrase-with-more-than-thirty-characters!";
        let hash = hash_passphrase(pass).unwrap();

        // Step 1: wrong password fails
        assert_eq!(
            handler.submit_passphrase_first("wrong-passphrase-with-more-than-30-chars!", &hash),
            Err(EscapeError::InvalidPassphrase)
        );

        // Step 1: correct password succeeds
        let attempt_id = handler.submit_passphrase_first(pass, &hash).unwrap();

        // Step 2: mismatch fails
        let mismatch_res = handler.submit_passphrase_confirm(&attempt_id, "different-passphrase-that-does-not-match!");
        assert_eq!(mismatch_res, Err(EscapeError::PassphraseMismatch));

        // Start fresh attempt for successful confirm
        let attempt_id = handler.submit_passphrase_first(pass, &hash).unwrap();
        let confirm_res = handler.submit_passphrase_confirm(&attempt_id, pass);
        assert_eq!(confirm_res, Ok(true));
    }
}
