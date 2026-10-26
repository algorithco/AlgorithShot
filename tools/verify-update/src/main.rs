use base64::{Engine, engine::general_purpose::STANDARD};
use minisign_verify::{PublicKey, Signature};
use std::{error::Error, fs, io::Read, path::Path};

fn main() {
    if let Err(error) = verify() {
        eprintln!("Updater verification failed: {error}");
        std::process::exit(1);
    }
}

fn verify() -> Result<(), Box<dyn Error>> {
    let arguments: Vec<_> = std::env::args_os().skip(1).collect();
    if arguments.len() != 4 {
        return Err("usage: verify-update <tauri.conf.json> <artifact> <signature.sig> <version>".into());
    }
    let config: serde_json::Value = serde_json::from_slice(&fs::read(&arguments[0])?)?;
    let encoded_key = config["plugins"]["updater"]["pubkey"].as_str().ok_or("Missing updater public key")?;
    let key_text = String::from_utf8(STANDARD.decode(encoded_key.trim())?)?;
    let key = PublicKey::decode(&key_text)?;
    let signature_text = fs::read_to_string(&arguments[2])?;
    let decoded = String::from_utf8(STANDARD.decode(signature_text.trim())?)?;
    let signature = Signature::decode(&decoded)?;
    match key.verify_stream(&signature) {
        Ok(mut verifier) => {
            let mut file = fs::File::open(&arguments[1])?;
            let mut buffer = vec![0u8; 1024 * 1024];
            loop {
                let count = file.read(&mut buffer)?;
                if count == 0 { break; }
                verifier.update(&buffer[..count]);
            }
            verifier.finalize()?;
        }
        Err(minisign_verify::Error::UnsupportedLegacyMode) => key.verify(&fs::read(&arguments[1])?, &signature, true)?,
        Err(error) => return Err(error.into()),
    }
    let version = arguments[3].to_str().ok_or("The version must be UTF-8")?;
    let expected = format!("version:{version}");
    if !signature.trusted_comment().split('\t').any(|field| field == expected) {
        return Err("The signature is not bound to the expected application version".into());
    }
    let name = Path::new(&arguments[1]).file_name().ok_or("Missing artifact filename")?;
    println!("Verified {} for version {version}.", name.to_string_lossy());
    Ok(())
}
