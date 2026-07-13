use base64::{engine::general_purpose, Engine as _};
use thiserror::Error;

#[cfg(windows)]
use std::ffi::c_void;

#[cfg(not(windows))]
use rand::RngCore;

cfg_if::cfg_if! {
    if #[cfg(windows)] {
        use windows::Win32::Security::Cryptography::{CryptProtectData, CryptUnprotectData, CRYPT_INTEGER_BLOB};
        extern "system" {
            fn LocalFree(hmem: *mut c_void) -> *mut c_void;
        }
    }
}

#[derive(Debug, Error)]
pub enum SecretError {
    #[error("Secure secrets backend not supported on this platform")]
    Unsupported,
    #[error("Secure secrets backend operation failed: {0}")]
    Platform(String),
    #[error("Invalid base64 payload")]
    InvalidBase64,
    #[error("Invalid UTF-8 payload")]
    InvalidUtf8,
}

pub type Result<T> = std::result::Result<T, SecretError>;

#[cfg(not(windows))]
fn get_or_create_master_key() -> Result<[u8; 32]> {
    const SERVICE: &str = "nobodyworld";
    const ACCOUNT: &str = "nw-secrets-master-key";

    let entry = keyring::Entry::new(SERVICE, ACCOUNT)
        .map_err(|error| SecretError::Platform(format!("keyring init failed: {error}")))?;

    if let Ok(existing) = entry.get_password() {
        let decoded = general_purpose::STANDARD
            .decode(existing)
            .map_err(|_| SecretError::InvalidBase64)?;
        if decoded.len() != 32 {
            return Err(SecretError::Platform(
                "stored master key has invalid length".to_string(),
            ));
        }
        let mut key = [0u8; 32];
        key.copy_from_slice(&decoded);
        return Ok(key);
    }

    let mut key = [0u8; 32];
    rand::rngs::OsRng.fill_bytes(&mut key);
    let encoded = general_purpose::STANDARD.encode(key);
    entry
        .set_password(&encoded)
        .map_err(|error| SecretError::Platform(format!("keyring set failed: {error}")))?;
    Ok(key)
}

pub fn encrypt_bytes(plaintext: &[u8]) -> Result<Vec<u8>> {
    cfg_if::cfg_if! {
        if #[cfg(windows)] {
            let blob = CRYPT_INTEGER_BLOB {
                cbData: plaintext.len() as u32,
                pbData: plaintext.as_ptr() as *mut u8,
            };
            let mut encrypted_blob = CRYPT_INTEGER_BLOB::default();
            unsafe {
                CryptProtectData(
                    &blob,
                    None,
                    None,
                    None,
                    None,
                    0,
                    &mut encrypted_blob,
                )
                .map_err(|error| SecretError::Platform(format!("{error:?}")))?;
            }
            let encrypted = unsafe {
                std::slice::from_raw_parts(
                    encrypted_blob.pbData,
                    encrypted_blob.cbData as usize,
                )
                .to_vec()
            };
            unsafe {
                let _ = LocalFree(encrypted_blob.pbData as *mut _);
            }
            Ok(encrypted)
        } else {
            use aes_gcm::aead::{Aead, Payload};
            use aes_gcm::{Aes256Gcm, KeyInit};

            let key = get_or_create_master_key()?;
            let cipher = Aes256Gcm::new_from_slice(&key)
                .map_err(|error| SecretError::Platform(format!("cipher init failed: {error}")))?;

            let mut nonce = [0u8; 12];
            rand::rngs::OsRng.fill_bytes(&mut nonce);

            let ciphertext = cipher
                .encrypt(
                    (&nonce).into(),
                    Payload {
                        msg: plaintext,
                        aad: b"nw-secrets:v1",
                    },
                )
                .map_err(|_| SecretError::Platform("encrypt failed".to_string()))?;

            let mut output = Vec::with_capacity(12 + ciphertext.len());
            output.extend_from_slice(&nonce);
            output.extend_from_slice(&ciphertext);
            Ok(output)
        }
    }
}

pub fn decrypt_bytes(ciphertext: &[u8]) -> Result<Vec<u8>> {
    cfg_if::cfg_if! {
        if #[cfg(windows)] {
            let blob = CRYPT_INTEGER_BLOB {
                cbData: ciphertext.len() as u32,
                pbData: ciphertext.as_ptr() as *mut u8,
            };
            let mut decrypted_blob = CRYPT_INTEGER_BLOB::default();
            unsafe {
                CryptUnprotectData(
                    &blob,
                    None,
                    None,
                    None,
                    None,
                    0,
                    &mut decrypted_blob,
                )
                .map_err(|error| SecretError::Platform(format!("{error:?}")))?;
            }
            let decrypted = unsafe {
                std::slice::from_raw_parts(
                    decrypted_blob.pbData,
                    decrypted_blob.cbData as usize,
                )
                .to_vec()
            };
            unsafe {
                let _ = LocalFree(decrypted_blob.pbData as *mut _);
            }
            Ok(decrypted)
        } else {
            use aes_gcm::aead::{Aead, Payload};
            use aes_gcm::{Aes256Gcm, KeyInit};

            if ciphertext.len() < 12 {
                return Err(SecretError::Platform("ciphertext too short".to_string()));
            }
            let (nonce, body) = ciphertext.split_at(12);
            let key = get_or_create_master_key()?;
            let cipher = Aes256Gcm::new_from_slice(&key)
                .map_err(|error| SecretError::Platform(format!("cipher init failed: {error}")))?;

            cipher
                .decrypt(
                    nonce.into(),
                    Payload {
                        msg: body,
                        aad: b"nw-secrets:v1",
                    },
                )
                .map_err(|_| SecretError::Platform("decrypt failed".to_string()))
        }
    }
}

pub fn encrypt_to_base64(plaintext: &str) -> Result<String> {
    let ciphertext = encrypt_bytes(plaintext.as_bytes())?;
    Ok(general_purpose::STANDARD.encode(ciphertext))
}

pub fn decrypt_from_base64(ciphertext_b64: &str) -> Result<String> {
    let ciphertext = general_purpose::STANDARD
        .decode(ciphertext_b64)
        .map_err(|_| SecretError::InvalidBase64)?;
    let plaintext = decrypt_bytes(&ciphertext)?;
    String::from_utf8(plaintext).map_err(|_| SecretError::InvalidUtf8)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(windows)]
    #[test]
    fn roundtrip_encrypt_decrypt_bytes() {
        let original = b"my secret api key";
        let encrypted = encrypt_bytes(original).expect("encrypt failed");
        assert_ne!(encrypted, original);
        let decrypted = decrypt_bytes(&encrypted).expect("decrypt failed");
        assert_eq!(decrypted, original);
    }

    #[cfg(windows)]
    #[test]
    fn roundtrip_encrypt_decrypt_base64() {
        let original = "hello secrets";
        let ciphertext = encrypt_to_base64(original).expect("encrypt failed");
        assert_ne!(ciphertext, original);
        let decrypted = decrypt_from_base64(&ciphertext).expect("decrypt failed");
        assert_eq!(decrypted, original);
    }
}
