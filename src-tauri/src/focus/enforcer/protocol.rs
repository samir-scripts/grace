use serde::{Deserialize, Serialize};

pub const PROTOCOL_VERSION: u32 = 1;
pub const LEASE_SECS: u64 = 15;
pub const HEARTBEAT_SECS: u64 = 2;
pub const MAX_MESSAGE_BYTES: usize = 65_536;
pub const MAX_DOMAINS: usize = 256;

#[derive(Debug, Default, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum EnforcementState {
    #[default]
    Inactive,
    Preparing,
    Active,
    Failed,
    Releasing,
    RecoveryRequired,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum EnforcementErrorCode {
    HelperUnavailable,
    AuthorizationRequired,
    AuthorizationDenied,
    UnsupportedPlatform,
    InvalidTarget,
    ApplyFailed,
    ReleaseFailed,
    LeaseLost,
    ProtocolMismatch,
}

#[derive(Debug, Default, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct EnforcementStatus {
    pub state: EnforcementState,
    pub applications_active: bool,
    pub websites_active: bool,
    pub error_code: Option<EnforcementErrorCode>,
}
