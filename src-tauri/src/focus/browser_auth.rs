//! Version-3 role-separated proofs and ordered frames. Session material never persists.
use hmac::{Hmac, Mac};
use sha2::Sha256;
use serde::{Deserialize, Serialize};

type HmacSha256 = Hmac<Sha256>;
const MAX_SEQUENCE: u64 = 9_007_199_254_740_991;

pub(super) struct SessionKeys {
    client: [u8; 32],
    server: [u8; 32],
}

pub(super) fn hex(bytes: &[u8]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    let mut value = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        value.push(DIGITS[(byte >> 4) as usize] as char);
        value.push(DIGITS[(byte & 15) as usize] as char);
    }
    value
}

fn decode_hex(value: &str) -> Result<[u8; 32], String> {
    if value.len() != 64 || !value.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)) {
        return Err("invalid_hex".into());
    }
    let mut bytes = [0; 32];
    for (i, byte) in bytes.iter_mut().enumerate() {
        *byte = u8::from_str_radix(&value[i * 2..i * 2 + 2], 16).map_err(|_| "invalid_hex")?;
    }
    Ok(bytes)
}

fn hmac(key: &[u8], transcript: &str) -> HmacSha256 {
    // HMAC accepts arbitrary key lengths.
    let mut mac = HmacSha256::new_from_slice(key).expect("HMAC accepts any key length");
    mac.update(transcript.as_bytes());
    mac
}

fn derive(token: &str, role: &str, c: &str, s: &str, metadata: &str) -> [u8; 32] {
    hmac(token.as_bytes(), &format!("pomotroid-focus-v3\n{role}\n{c}\n{s}\n{metadata}"))
        .finalize().into_bytes().into()
}

pub(super) fn server_proof(token: &str, client_nonce: &str, server_nonce: &str) -> Result<String, String> {
    decode_hex(client_nonce)?;
    decode_hex(server_nonce)?;
    Ok(hex(&hmac(token.as_bytes(), &format!("pomotroid-focus-v3\nserver\n{client_nonce}\n{server_nonce}")).finalize().into_bytes()))
}

pub(super) fn metadata(value: &str) -> Result<String, String> {
    if value.len() > 4096 {
        return Err("metadata_too_large".into());
    }
    let parsed: (String,) = serde_json::from_str(value).map_err(|_| "invalid_metadata")?;
    if parsed.0.is_empty() {
        return Err("empty_profile".into());
    }
    Ok(parsed.0)
}

pub(super) fn verify_client(token: &str, client_nonce: &str, server_nonce: &str, metadata_value: &str, proof: &str) -> Result<SessionKeys, String> {
    decode_hex(client_nonce)?;
    decode_hex(server_nonce)?;
    metadata(metadata_value)?;
    let tag = decode_hex(proof)?;
    hmac(token.as_bytes(), &format!("pomotroid-focus-v3\nclient\n{client_nonce}\n{server_nonce}\n{metadata_value}"))
        .verify_slice(&tag).map_err(|_| "invalid_client_proof")?;
    Ok(SessionKeys {
        client: derive(token, "key-client", client_nonce, server_nonce, metadata_value),
        server: derive(token, "key-server", client_nonce, server_nonce, metadata_value),
    })
}

#[derive(Serialize)]
#[serde(deny_unknown_fields)]
struct Frame<'a> {
    #[serde(rename = "type")]
    kind: &'a str,
    sequence: u64,
    payload: &'a str,
    mac: &'a str,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct IncomingFrame {
    #[serde(rename = "type")]
    kind: String,
    sequence: u64,
    payload: String,
    mac: String,
}

/// Server direction: outbound uses key-server, inbound uses key-client.
pub(super) struct AuthenticatedChannel {
    keys: SessionKeys,
    sent: u64,
    received: u64,
}

impl AuthenticatedChannel {
    pub(super) fn new(keys: SessionKeys) -> Self {
        Self { keys, sent: 0, received: 0 }
    }

    pub(super) fn encode(&mut self, payload: &str) -> Result<String, String> {
        if self.sent >= MAX_SEQUENCE { return Err("sequence_exhausted".into()); }
        let sequence = self.sent + 1;
        let mac = hex(&hmac(&self.keys.server, &format!("pomotroid-focus-v3\nframe\n{sequence}\n{payload}")).finalize().into_bytes());
        let wire = serde_json::to_string(&Frame { kind: "authenticated", sequence, payload, mac: &mac })
            .map_err(|_| "invalid_frame")?;
        self.sent = sequence;
        Ok(wire)
    }

    pub(super) fn decode(&mut self, wire: &str) -> Result<String, String> {
        let frame: IncomingFrame = serde_json::from_str(wire).map_err(|_| "invalid_frame")?;
        if frame.kind != "authenticated" || self.received >= MAX_SEQUENCE || frame.sequence != self.received + 1 || frame.sequence > MAX_SEQUENCE {
            return Err("invalid_sequence".into());
        }
        let tag = decode_hex(&frame.mac)?;
        hmac(&self.keys.client, &format!("pomotroid-focus-v3\nframe\n{}\n{}", frame.sequence, frame.payload))
            .verify_slice(&tag).map_err(|_| "invalid_frame_mac")?;
        self.received = frame.sequence;
        Ok(frame.payload)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use hmac::{Hmac, Mac};
    use sha2::Sha256;

    #[test]
    fn v3_minimal_identity_and_server_proof() {
        assert!(metadata(r#"["profile-a"]"#).is_ok());
        assert!(metadata(r#"["profile-a","firefox","development",true]"#).is_err());
        assert_eq!(
            server_proof(TOKEN, &"0".repeat(64), &"1".repeat(64)).unwrap(),
            "e3fc9452addcb73ffc16a1f94082e42bd565be154b099aac3ce39a87172026fb"
        );
    }

    const TOKEN: &str = "test-only-shared-secret";
    const M: &str = r#"["profile-a"]"#;
    const PAYLOAD: &str = r#"{"type":"policy","version":3,"revision":0,"active":false,"domains":[],"lease_secs":15}"#;
    fn peer_mac(key: &[u8], text: &str) -> String {
        let mut mac = Hmac::<Sha256>::new_from_slice(key).unwrap();
        mac.update(text.as_bytes());
        mac.finalize().into_bytes().iter().map(|b| format!("{b:02x}")).collect()
    }
    fn proof(c: &str, s: &str, m: &str) -> String {
        peer_mac(TOKEN.as_bytes(), &format!("pomotroid-focus-v3\nclient\n{c}\n{s}\n{m}"))
    }
    fn keys() -> SessionKeys {
        let (c, s) = ("0".repeat(64), "1".repeat(64));
        verify_client(TOKEN, &c, &s, M, &proof(&c, &s, M)).unwrap()
    }
    fn peer_frame(sequence: u64, payload: &str) -> String {
        let k = keys();
        serde_json::json!({"type":"authenticated", "sequence":sequence, "payload":payload,
            "mac":peer_mac(&k.client, &format!("pomotroid-focus-v3\nframe\n{sequence}\n{payload}"))}).to_string()
    }
    #[test]
    fn literal_interoperability_vectors() {
        let (c, s) = ("0".repeat(64), "1".repeat(64));
        assert_eq!(server_proof(TOKEN, &c, &s).unwrap(), "e3fc9452addcb73ffc16a1f94082e42bd565be154b099aac3ce39a87172026fb");
        assert_eq!(proof(&c, &s, M), "a697f84bb151b672d87b2df111883dddb7d9168d1fbd6702640c7be10f04b814");
        let k = keys();
        assert_eq!(hex(&k.client), "e32df8a42114455dca89e6ae6da62fa2c0999b702faf94e228e4e63f143e496f");
        assert_eq!(hex(&k.server), "744d842dc3f2dc5c4f1e5b5bae9148a4261e124917694e0912d3386ecb352a76");
        let mut channel = AuthenticatedChannel::new(k);
        let frame: serde_json::Value = serde_json::from_str(&channel.encode(PAYLOAD).unwrap()).unwrap();
        assert_eq!(frame["mac"], "5e6f93b568a06cf9200947e6653d14461ddc07c12ea97839520f2954eccdb083");
        assert_eq!(frame["payload"], PAYLOAD);
    }
    #[test]
    fn rejects_reflection_metadata_mutation_changed_nonce_and_invalid_hex() {
        let (c, s) = ("0".repeat(64), "1".repeat(64));
        let p = proof(&c, &s, M);
        assert!(verify_client(TOKEN, &c, &s, M, &server_proof(TOKEN, &c, &s).unwrap()).is_err());
        assert!(verify_client(TOKEN, &c, &s, &M.replace("profile-a", "profile-b"), &p).is_err());
        assert!(verify_client(TOKEN, &"2".repeat(64), &s, M, &p).is_err());
        for bad in ["A".repeat(64), "g".repeat(64), "0".repeat(63)] {
            assert!(server_proof(TOKEN, &bad, &s).is_err());
            assert!(verify_client(TOKEN, &c, &s, M, &bad).is_err());
        }
        for metadata in [r#"[""]"#.to_string(), r#"["profile","firefox"]"#.to_string(), "x".repeat(4097)] {
            assert!(verify_client(TOKEN, &c, &s, &metadata, &proof(&c, &s, &metadata)).is_err());
        }
    }
    #[test]
    fn rejects_replay_skips_tampering_reflection_and_fresh_session_replay() {
        let payload = r#"{"type":"ack","revision":0,"profile_id":"profile-a"}"#;
        let frame = peer_frame(1, payload);
        let mut channel = AuthenticatedChannel::new(keys());
        assert_eq!(channel.decode(&frame).unwrap(), payload);
        assert!(channel.decode(&frame).is_err());
        assert!(AuthenticatedChannel::new(keys()).decode(&peer_frame(2, payload)).is_err());
        assert!(AuthenticatedChannel::new(keys()).decode(&frame.replace("profile-a", "profile-b")).is_err());
        let reflected = AuthenticatedChannel::new(keys()).encode(PAYLOAD).unwrap();
        assert!(AuthenticatedChannel::new(keys()).decode(&reflected).is_err());
        let (c, s) = ("2".repeat(64), "3".repeat(64));
        let fresh = verify_client(TOKEN, &c, &s, M, &proof(&c, &s, M)).unwrap();
        assert!(AuthenticatedChannel::new(fresh).decode(&frame).is_err());
        for sequence in [0, 9007199254740992] {
            assert!(AuthenticatedChannel::new(keys()).decode(&peer_frame(sequence, payload)).is_err());
        }
        let mut exhausted = AuthenticatedChannel::new(keys());
        exhausted.sent = 9007199254740991;
        assert!(exhausted.encode(PAYLOAD).is_err());
    }
}
