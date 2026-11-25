#[cfg(not(test))]
const SERVICE_NAME: &str = "com.embedbay.app";

#[cfg(not(test))]
pub fn store_secret(secret_ref: &str, secret_value: &str) -> Result<(), String> {
    let entry = keyring::Entry::new(SERVICE_NAME, secret_ref).map_err(|e| e.to_string())?;
    entry.set_password(secret_value).map_err(|e| e.to_string())
}

#[cfg(not(test))]
pub fn get_secret(secret_ref: &str) -> Result<Option<String>, String> {
    let entry = keyring::Entry::new(SERVICE_NAME, secret_ref).map_err(|e| e.to_string())?;
    match entry.get_password() {
        Ok(val) => Ok(Some(val)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(err) => Err(err.to_string()),
    }
}

#[cfg(not(test))]
pub fn delete_secret(secret_ref: &str) -> Result<(), String> {
    let entry = keyring::Entry::new(SERVICE_NAME, secret_ref).map_err(|e| e.to_string())?;
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(err) => Err(err.to_string()),
    }
}

#[cfg(test)]
mod test_store {
    use std::collections::HashMap;
    use std::sync::{Mutex, OnceLock};

    static MEM_SECRETS: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();

    fn map() -> &'static Mutex<HashMap<String, String>> {
        MEM_SECRETS.get_or_init(|| Mutex::new(HashMap::new()))
    }

    pub fn store_secret(secret_ref: &str, secret_value: &str) -> Result<(), String> {
        let mut g = map().lock().map_err(|_| "secret lock poisoned".to_string())?;
        g.insert(secret_ref.to_string(), secret_value.to_string());
        Ok(())
    }

    pub fn get_secret(secret_ref: &str) -> Result<Option<String>, String> {
        let g = map().lock().map_err(|_| "secret lock poisoned".to_string())?;
        Ok(g.get(secret_ref).cloned())
    }

    pub fn delete_secret(secret_ref: &str) -> Result<(), String> {
        let mut g = map().lock().map_err(|_| "secret lock poisoned".to_string())?;
        g.remove(secret_ref);
        Ok(())
    }
}

#[cfg(test)]
pub use test_store::{delete_secret, get_secret, store_secret};
