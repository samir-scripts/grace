use std::fmt;

#[derive(Debug, PartialEq, Eq)]
pub enum ValidationError {
    EmptyDomain,
    InvalidDomain(String),
    LoopbackNotAllowed,
    IpAddressNotAllowed,
    InvalidDuration(&'static str),
    InvalidRounds,
    TooManyDomains,
}

impl fmt::Display for ValidationError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::EmptyDomain => write!(f, "Domain cannot be empty"),
            Self::InvalidDomain(s) => write!(f, "Invalid domain: {s}"),
            Self::LoopbackNotAllowed => write!(f, "Localhost/loopback domains are not allowed"),
            Self::IpAddressNotAllowed => write!(f, "IP addresses are not allowed"),
            Self::InvalidDuration(s) => write!(f, "Invalid duration: {s}"),
            Self::InvalidRounds => write!(f, "Work rounds must be between 1 and 12"),
            Self::TooManyDomains => write!(f, "A session can block at most 256 distinct domains"),
        }
    }
}

impl std::error::Error for ValidationError {}

pub fn normalize_domain(input: &str) -> Result<String, ValidationError> {
    let mut raw = input.trim();
    if raw.is_empty() {
        return Err(ValidationError::EmptyDomain);
    }

    // Strip http:// or https:// if present
    if raw.get(..7).is_some_and(|prefix| prefix.eq_ignore_ascii_case("http://")) {
        raw = &raw[7..];
    } else if raw.get(..8).is_some_and(|prefix| prefix.eq_ignore_ascii_case("https://")) {
        raw = &raw[8..];
    }

    // Strip path, query, fragment
    if let Some(idx) = raw.find(['/', '?', '#', ':']) {
        raw = &raw[..idx];
    }
    raw = raw.trim();

    if raw.is_empty() {
        return Err(ValidationError::EmptyDomain);
    }

    let mut lower = raw.to_ascii_lowercase();

    // Strip leading www.
    if lower.starts_with("www.") {
        lower = lower[4..].to_string();
    }

    if lower.is_empty() {
        return Err(ValidationError::EmptyDomain);
    }

    // Check for loopback
    if lower == "localhost" || lower.ends_with(".localhost") {
        return Err(ValidationError::LoopbackNotAllowed);
    }

    // Check for IP address
    if lower.parse::<std::net::IpAddr>().is_ok() {
        return Err(ValidationError::IpAddressNotAllowed);
    }

    // Convert via IDNA domain_to_ascii
    match idna::domain_to_ascii(&lower) {
        Ok(ascii) => {
            if ascii.is_empty() || !ascii.contains('.') || ascii.starts_with('.') || ascii.ends_with('.') || ascii.contains("..")
                || !ascii.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'.') {
                return Err(ValidationError::InvalidDomain(lower));
            }
            Ok(ascii)
        }
        Err(_) => Err(ValidationError::InvalidDomain(lower)),
    }
}

pub fn validate_domain_count(count: usize) -> Result<(), ValidationError> {
    if count > super::enforcer::protocol::MAX_DOMAINS {
        return Err(ValidationError::TooManyDomains);
    }
    Ok(())
}

pub fn validate_profile_durations(
    work_secs: u32,
    short_break_secs: u32,
    long_break_secs: u32,
    work_rounds: u32,
) -> Result<(), ValidationError> {
    if !(60..=5400).contains(&work_secs) {
        return Err(ValidationError::InvalidDuration("Work duration must be between 1 and 90 minutes"));
    }
    if !(60..=1800).contains(&short_break_secs) {
        return Err(ValidationError::InvalidDuration("Short break duration must be between 1 and 30 minutes"));
    }
    if !(60..=3600).contains(&long_break_secs) {
        return Err(ValidationError::InvalidDuration("Long break duration must be between 1 and 60 minutes"));
    }
    if !(1..=12).contains(&work_rounds) {
        return Err(ValidationError::InvalidRounds);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_domain_normalization() {
        assert_eq!(normalize_domain("https://WWW.Reddit.COM/r/all").unwrap(), "reddit.com");
        assert_eq!(normalize_domain("discord.gg/").unwrap(), "discord.gg");
        assert_eq!(normalize_domain("http://youtube.com:8080/watch?v=123").unwrap(), "youtube.com");
        assert_eq!(normalize_domain("sub.example.co.uk").unwrap(), "sub.example.co.uk");
        assert!(normalize_domain("localhost").is_err());
        assert!(normalize_domain("127.0.0.1").is_err());
        assert!(normalize_domain("::1").is_err());
        assert!(normalize_domain("invalid..domain").is_err());
        assert!(normalize_domain("nodots").is_err());
        assert!(normalize_domain("").is_err());
    }

    #[test]
    fn normalizes_site_urls() {
        for (input, expected) in [
            ("HTTPS://WWW.YouTube.COM/watch?v=123", "youtube.com"),
            ("https://WWW.Instagram.COM/reels/?q=1", "instagram.com"),
            ("https://old.Reddit.COM/r/all?sort=new", "old.reddit.com"),
        ] {
            assert_eq!(normalize_domain(input).unwrap(), expected, "{input}");
        }
    }

    #[test]
    fn rejects_pattern_syntax() {
        for input in ["*.youtube.com", r".*youtube\.com$", "/youtube.com/i"] {
            assert!(normalize_domain(input).is_err(), "accepted {input}");
        }
    }

    #[test]
    fn test_duration_validation() {
        assert!(validate_profile_durations(1500, 300, 900, 4).is_ok());
        assert!(validate_profile_durations(59, 300, 900, 4).is_err());
        assert!(validate_profile_durations(5401, 300, 900, 4).is_err());
        assert!(validate_profile_durations(1500, 59, 900, 4).is_err());
        assert!(validate_profile_durations(1500, 1801, 900, 4).is_err());
        assert!(validate_profile_durations(1500, 300, 3601, 4).is_err());
        assert!(validate_profile_durations(1500, 300, 900, 0).is_err());
        assert!(validate_profile_durations(1500, 300, 900, 13).is_err());
    }
}
