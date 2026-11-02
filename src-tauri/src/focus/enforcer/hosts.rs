use std::fmt;
use std::fs;
use std::path::{Path, PathBuf};

pub const HOSTS_TAG_BEGIN: &str = "# BEGIN POMOTROID BLOCK";
pub const HOSTS_TAG_END: &str = "# END POMOTROID BLOCK";

#[derive(Debug, PartialEq, Eq)]
pub enum HostsError {
    ReadFailed(String),
    WriteFailed(String),
}

impl fmt::Display for HostsError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::ReadFailed(e) => write!(f, "Failed to read hosts file: {e}"),
            Self::WriteFailed(e) => write!(f, "Failed to write hosts file: {e}"),
        }
    }
}

impl std::error::Error for HostsError {}

pub fn default_hosts_path() -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        PathBuf::from(r"C:\Windows\System32\drivers\etc\hosts")
    }
    #[cfg(not(target_os = "windows"))]
    {
        PathBuf::from("/etc/hosts")
    }
}

pub fn inject_hosts_block(content: &str, domains: &[String]) -> String {
    let clean = remove_hosts_block(content);
    if domains.is_empty() {
        return clean;
    }

    let mut block = String::new();
    block.push_str(HOSTS_TAG_BEGIN);
    block.push('\n');

    for d in domains {
        let domain = d.trim();
        if domain.is_empty() {
            continue;
        }
        block.push_str(&format!("127.0.0.1 {domain}\n"));
        block.push_str(&format!("::1 {domain}\n"));
        if !domain.starts_with("www.") {
            block.push_str(&format!("127.0.0.1 www.{domain}\n"));
            block.push_str(&format!("::1 www.{domain}\n"));
        }
    }

    block.push_str(HOSTS_TAG_END);

    let trimmed = clean.trim_end();
    if trimmed.is_empty() {
        format!("{block}\n")
    } else {
        format!("{trimmed}\n\n{block}\n")
    }
}

pub fn remove_hosts_block(content: &str) -> String {
    if let (Some(start_idx), Some(end_idx)) = (content.find(HOSTS_TAG_BEGIN), content.find(HOSTS_TAG_END)) {
        if start_idx <= end_idx {
            let after_end = end_idx + HOSTS_TAG_END.len();
            let mut result = String::with_capacity(content.len());
            result.push_str(&content[..start_idx]);
            if after_end < content.len() {
                result.push_str(&content[after_end..]);
            }
            // Normalize trailing whitespace
            let trimmed = result.trim_end();
            if trimmed.is_empty() {
                String::new()
            } else {
                format!("{trimmed}\n")
            }
        } else {
            content.to_string()
        }
    } else {
        content.to_string()
    }
}

pub fn apply_hosts_file(path: &Path, domains: &[String]) -> Result<(), HostsError> {
    let current = if path.exists() {
        fs::read_to_string(path).map_err(|e| HostsError::ReadFailed(e.to_string()))?
    } else {
        String::new()
    };

    let updated = inject_hosts_block(&current, domains);
    fs::write(path, updated).map_err(|e| HostsError::WriteFailed(e.to_string()))?;
    Ok(())
}

pub fn revert_hosts_file(path: &Path) -> Result<(), HostsError> {
    if !path.exists() {
        return Ok(());
    }

    let current = fs::read_to_string(path).map_err(|e| HostsError::ReadFailed(e.to_string()))?;
    let updated = remove_hosts_block(&current);
    fs::write(path, updated).map_err(|e| HostsError::WriteFailed(e.to_string()))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_hosts_block_injection_and_clean_removal() {
        let original = "127.0.0.1 localhost\n::1 localhost\n";
        let domains = vec!["reddit.com".to_string(), "discord.com".to_string()];
        let blocked = inject_hosts_block(original, &domains);

        assert!(blocked.contains(HOSTS_TAG_BEGIN));
        assert!(blocked.contains("127.0.0.1 reddit.com"));
        assert!(blocked.contains("127.0.0.1 www.reddit.com"));
        assert!(blocked.contains("::1 reddit.com"));
        assert!(blocked.contains("127.0.0.1 discord.com"));
        assert!(blocked.contains(HOSTS_TAG_END));

        // Idempotent injection (re-injecting replaces old block without duplicating)
        let reblocked = inject_hosts_block(&blocked, &domains);
        assert_eq!(reblocked.matches(HOSTS_TAG_BEGIN).count(), 1);
        assert_eq!(reblocked.matches(HOSTS_TAG_END).count(), 1);

        let cleaned = remove_hosts_block(&blocked);
        assert_eq!(cleaned, original);
    }

    #[test]
    fn test_empty_domains_cleans_block() {
        let original = "127.0.0.1 localhost\n";
        let domains = vec!["youtube.com".to_string()];
        let blocked = inject_hosts_block(original, &domains);
        assert!(blocked.contains("youtube.com"));

        let empty_domains: Vec<String> = vec![];
        let cleaned = inject_hosts_block(&blocked, &empty_domains);
        assert!(!cleaned.contains("youtube.com"));
        assert!(!cleaned.contains(HOSTS_TAG_BEGIN));
    }
}
