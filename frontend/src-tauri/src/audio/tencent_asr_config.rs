// audio/tencent_asr_config.rs
//
// Tencent Cloud ASR credential storage (tauri-plugin-store) and Tauri commands.
// Credentials live in `tencent_asr.json` inside the app data directory, kept
// out of the SQL database and out of the repository.

use super::transcription::tencent_asr::TencentAsrCredentials;
use log::{info, warn};
use tauri::{AppHandle, Runtime};
use tauri_plugin_store::StoreExt;

const STORE_FILE: &str = "tencent_asr.json";
const STORE_KEY: &str = "credentials";

pub(crate) async fn load_credentials<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<TencentAsrCredentials, String> {
    let store = app
        .store(STORE_FILE)
        .map_err(|e| format!("Failed to access Tencent ASR store: {e}"))?;

    match store.get(STORE_KEY) {
        Some(value) => serde_json::from_value(value)
            .map_err(|e| format!("Failed to parse Tencent ASR credentials: {e}")),
        None => Ok(TencentAsrCredentials {
            app_id: String::new(),
            secret_id: String::new(),
            secret_key: String::new(),
            engine_model_type: super::transcription::tencent_asr::default_engine(),
        }),
    }
}

async fn save_credentials<R: Runtime>(
    app: &AppHandle<R>,
    credentials: &TencentAsrCredentials,
) -> Result<(), String> {
    let store = app
        .store(STORE_FILE)
        .map_err(|e| format!("Failed to access Tencent ASR store: {e}"))?;
    let value = serde_json::to_value(credentials)
        .map_err(|e| format!("Failed to serialize Tencent ASR credentials: {e}"))?;
    store.set(STORE_KEY, value);
    store
        .save()
        .map_err(|e| format!("Failed to persist Tencent ASR credentials: {e}"))?;
    info!(
        "Tencent ASR credentials saved (appid_len={}, secret_id_len={}, engine={})",
        credentials.app_id.len(),
        credentials.secret_id.len(),
        credentials.engine_model_type
    );
    Ok(())
}

fn sanitize(mut credentials: TencentAsrCredentials) -> TencentAsrCredentials {
    credentials.app_id = credentials.app_id.trim().to_string();
    credentials.secret_id = credentials.secret_id.trim().to_string();
    credentials.secret_key = credentials.secret_key.trim().to_string();
    if credentials.engine_model_type.trim().is_empty() {
        credentials.engine_model_type = super::transcription::tencent_asr::default_engine();
    } else {
        credentials.engine_model_type = credentials.engine_model_type.trim().to_string();
    }
    credentials
}

#[tauri::command]
pub async fn api_get_tencent_asr_config<R: Runtime>(
    app: AppHandle<R>,
) -> Result<TencentAsrCredentials, String> {
    load_credentials(&app).await
}

#[tauri::command]
pub async fn api_save_tencent_asr_config<R: Runtime>(
    app: AppHandle<R>,
    credentials: TencentAsrCredentials,
) -> Result<(), String> {
    let credentials = sanitize(credentials);
    if credentials.app_id.is_empty()
        || credentials.secret_id.is_empty()
        || credentials.secret_key.is_empty()
    {
        return Err("AppID、SecretId、SecretKey 均为必填项".to_string());
    }
    if !credentials.app_id.chars().all(|c| c.is_ascii_digit()) {
        return Err("AppID 应为纯数字（可在腾讯云账号中心查看）".to_string());
    }
    save_credentials(&app, &credentials).await
}

/// Connection probe used by the settings UI: performs a signed WebSocket
/// handshake and immediately closes. Succeeds only if credentials/signature
/// are valid.
#[tauri::command]
pub async fn api_test_tencent_asr_connection<R: Runtime>(
    app: AppHandle<R>,
) -> Result<serde_json::Value, String> {
    let credentials = sanitize(load_credentials(&app).await?);
    if !credentials.is_complete() {
        return Err("腾讯云凭据不完整，请先保存 AppID / SecretId / SecretKey".to_string());
    }

    let url = super::transcription::tencent_asr::build_signed_url(&credentials);
    use tokio_tungstenite::tungstenite::client::IntoClientRequest;
    let request = url
        .into_client_request()
        .map_err(|e| format!("Invalid request: {e}"))?;

    match tokio::time::timeout(
        std::time::Duration::from_secs(15),
        tokio_tungstenite::connect_async(request),
    )
    .await
    {
        Err(_) => Err("连接超时（15 秒），请检查网络".to_string()),
        Ok(Err(e)) => {
            warn!("Tencent ASR test handshake failed: {e}");
            Err(format!("握手失败：{e}（请检查凭据是否正确）"))
        }
        Ok(Ok((ws, _))) => {
            let (mut write, mut read) = ws.split();
            use futures_util::{SinkExt, StreamExt};
            // Send a short silence frame so the server accepts the stream,
            // then read the first response before closing.
            let mut ok = false;
            let mut err_msg = String::new();
            let _ = write
                .send(tokio_tungstenite::tungstenite::Message::Binary(vec![0u8; 6400]))
                .await;
            let deadline = std::time::Instant::now() + std::time::Duration::from_secs(8);
            while std::time::Instant::now() < deadline {
                match tokio::time::timeout(std::time::Duration::from_secs(8), read.next()).await {
                    Ok(Some(Ok(msg))) => {
                        if let tokio_tungstenite::tungstenite::Message::Text(t) = msg {
                            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&t) {
                                let code = v.get("code").and_then(serde_json::Value::as_i64);
                                if code == Some(0) {
                                    ok = true;
                                    break;
                                }
                                err_msg = v
                                    .get("message")
                                    .and_then(serde_json::Value::as_str)
                                    .unwrap_or("unknown")
                                    .to_string();
                                break;
                            }
                        }
                    }
                    _ => break,
                }
            }
            let _ = write.close().await;
            if ok {
                Ok(serde_json::json!({
                    "status": "success",
                    "message": "连接成功，签名与凭据验证通过",
                }))
            } else if err_msg.is_empty() {
                Err("连接建立但未收到识别响应，请稍后重试".to_string())
            } else {
                Err(format!("服务端返回错误：{err_msg}"))
            }
        }
    }
}
