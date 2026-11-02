use argon2::{
    password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use rand_core::OsRng;
use std::fmt;

pub const MIN_PASSPHRASE_CHARS: usize = 30;

#[derive(Debug, PartialEq, Eq)]
pub enum SecurityError {
    PassphraseTooShort(usize),
    HashingFailed(String),
}

impl fmt::Display for SecurityError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::PassphraseTooShort(len) => write!(
                f,
                "Passphrase must be at least {MIN_PASSPHRASE_CHARS} characters (got {len})"
            ),
            Self::HashingFailed(err) => write!(f, "Failed to hash passphrase: {err}"),
        }
    }
}

impl std::error::Error for SecurityError {}

pub fn hash_passphrase(plain: &str) -> Result<String, SecurityError> {
    let char_count = plain.chars().count();
    if char_count < MIN_PASSPHRASE_CHARS {
        return Err(SecurityError::PassphraseTooShort(char_count));
    }

    let salt = SaltString::generate(&mut OsRng);
    let argon2 = Argon2::default();

    argon2
        .hash_password(plain.as_bytes(), &salt)
        .map(|h| h.to_string())
        .map_err(|e| SecurityError::HashingFailed(e.to_string()))
}

pub fn verify_passphrase(plain: &str, hash: &str) -> bool {
    if plain.chars().count() < MIN_PASSPHRASE_CHARS {
        return false;
    }

    match PasswordHash::new(hash) {
        Ok(parsed_hash) => Argon2::default()
            .verify_password(plain.as_bytes(), &parsed_hash)
            .is_ok(),
        Err(_) => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_passphrase_min_length_and_argon2() {
        let short = "too-short-passphrase";
        assert_eq!(
            hash_passphrase(short),
            Err(SecurityError::PassphraseTooShort(short.chars().count()))
        );

        let valid = "this-is-a-long-passphrase-with-more-than-thirty-characters!";
        let hash = hash_passphrase(valid).expect("hashing should succeed");
        assert!(hash.starts_with("$argon2id$"));
        assert!(verify_passphrase(valid, &hash));
        assert!(!verify_passphrase(
            "wrong-passphrase-with-more-than-thirty-characters!!",
            &hash
        ));
        assert!(!verify_passphrase(short, &hash));
    }
}
