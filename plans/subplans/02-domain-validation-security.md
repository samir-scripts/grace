Status: pending

Context: Implement named finite Pomodoro sessions in Tauri 2/Rust and Svelte 5. Read [master plan](../focus-sessions-master-plan.md) for global constraints and shared contracts. Durations use seconds; Rust owns enforcement and session locks.

# Task 2: Domain Normalization & Passphrase Security

**Files:**
- Create: `src-tauri/src/focus/validation.rs`
- Create: `src-tauri/src/focus/security.rs`
- Modify: `src-tauri/Cargo.toml` (add `idna = "1"`, `argon2 = "0.5"`)
- Test: `src-tauri/src/focus/validation.rs`, `src-tauri/src/focus/security.rs`

**Interfaces:**
- Produces:
```rust
pub fn normalize_domain(input: &str) -> Result<String, ValidationError>;
pub fn hash_passphrase(plain: &str) -> Result<String, SecurityError>;
pub fn verify_passphrase(plain: &str, hash: &str) -> bool;
```

- [ ] **Step 1: Write failing domain validation and passphrase hashing tests**
```rust
#[test]
fn test_domain_normalization() {
    assert_eq!(normalize_domain("https://WWW.Reddit.COM/r/all").unwrap(), "reddit.com");
    assert_eq!(normalize_domain("discord.gg/").unwrap(), "discord.gg");
    assert!(normalize_domain("localhost").is_err());
    assert!(normalize_domain("127.0.0.1").is_err());
    assert!(normalize_domain("invalid..domain").is_err());
}

#[test]
fn test_passphrase_min_length_and_argon2() {
    let short = "too-short-passphrase";
    assert!(hash_passphrase(short).is_err());
    let valid = "this-is-a-long-passphrase-with-more-than-thirty-characters!";
    let hash = hash_passphrase(valid).unwrap();
    assert!(verify_passphrase(valid, &hash));
    assert!(!verify_passphrase("wrong-passphrase-with-more-than-thirty-characters!!", &hash));
}
```

- [ ] **Step 2: Run test to verify it fails**
Run: `cargo test --manifest-path src-tauri/Cargo.toml test_domain_normalization`
Expected: FAIL.

- [ ] **Step 3: Implement domain normalization and Argon2id hashing**
In `src-tauri/src/focus/validation.rs`:
- Strip `http://`, `https://`, trailing slashes, paths, and query parameters.
- Convert to lowercase, strip leading `www.`.
- Run IDNA punycode conversion. Reject IP addresses (`127.0.0.1`, `::1`), `localhost`, and invalid TLDs.
In `src-tauri/src/focus/security.rs`:
- Enforce `plain.chars().count() >= 30`.
- Hash using Argon2id with recommended parameters (`m=19456`, `t=2`, `p=1`).

- [ ] **Step 4: Run tests to verify they pass**
Run: `cargo test --manifest-path src-tauri/Cargo.toml focus::validation focus::security`
Expected: PASS.

- [ ] **Step 5: Commit changes**
`git add src-tauri/Cargo.toml src-tauri/src/focus/validation.rs src-tauri/src/focus/security.rs`
`git commit -m "feat(focus): add domain normalization and secure passphrase hashing"`

---

