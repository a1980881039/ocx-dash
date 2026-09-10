use std::path::PathBuf;

#[tauri::command]
fn get_admin_token() -> Result<String, String> {
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .map_err(|e| e.to_string())?;
    let token_path = PathBuf::from(home).join(".opencodex").join("admin-api-token");
    if token_path.exists() {
        let content = std::fs::read_to_string(&token_path)
            .map_err(|e| e.to_string())?;
        Ok(content.trim().to_string())
    } else {
        Err("Token file not found".to_string())
    }
}

#[tauri::command]
async fn fetch_ocx(path: String, token: Option<String>) -> Result<serde_json::Value, String> {
    let admin_token = match token {
        Some(t) if !t.is_empty() => t,
        _ => get_admin_token().unwrap_or_default(),
    };

    if !path.starts_with("/api/") {
        return Err("invalid path".to_string());
    }
    let url = format!("http://127.0.0.1:10100{}", path);

    let mut cmd = std::process::Command::new("curl.exe");
    cmd.arg("-s").arg("-w").arg("\n%{http_code}").arg(&url);
    if !admin_token.is_empty() {
        cmd.arg("-H").arg(format!("Authorization: Bearer {}", admin_token));
    }

    let output = cmd.output().map_err(|e| format!("Failed to exec curl: {}", e))?;
    let text = String::from_utf8(output.stdout).map_err(|e| e.to_string())?;
    let (body, code) = match text.rfind('\n') {
        Some(i) => (&text[..i], text[i + 1..].trim().to_string()),
        None => (text.as_str(), String::new()),
    };
    if code == "401" || code == "403" {
        return Err("auth".to_string());
    }
    if code.starts_with('4') || code.starts_with('5') {
        return Err(format!("HTTP {}", code));
    }
    let val: serde_json::Value = serde_json::from_str(body)
        .map_err(|e| format!("JSON parse error: {}, raw: {}", e, body.chars().take(200).collect::<String>()))?;
    Ok(val)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![get_admin_token, fetch_ocx])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

