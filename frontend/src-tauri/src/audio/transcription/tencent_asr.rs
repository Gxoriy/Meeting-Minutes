// audio/transcription/tencent_asr.rs
//
// Tencent Cloud realtime ASR (streaming WebSocket) session.
//
// Protocol (https://cloud.tencent.com/document/api/1093/48982):
// - Connect to wss://asr.cloud.tencent.com/asr/v2/<appid>?<params>&signature=...
// - signature = url_encode(base64(hmac_sha1(secret_key, sign_text)))
// - sign_text = "asr.cloud.tencent.com/asr/v2/<appid>?" + lexicographically
//   sorted "k=v&..." of every parameter except signature (no wss:// prefix)
// - Audio: 16kHz mono 16-bit PCM frames, sent at 1:1 realtime pacing
// - Results: JSON with result.slice_type (0=start, 1=partial, 2=stable)
//
// The session owns one WebSocket connection for the whole recording. Feed it
// VAD speech segments with `feed()`; gaps longer than KEEPALIVE_INTERVAL are
// bridged with silence frames so the server does not drop the stream. Stable
// and partial results are emitted directly to the frontend as
// `transcript-update` events (partial => is_partial=true).

use base64::Engine as _;
use futures_util::{SinkExt, StreamExt};
use log::{error, info, warn};
use serde::{Deserialize, Serialize};
use tauri::Emitter;
use std::sync::atomic::Ordering;
use std::time::Duration;
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::Message;

use super::worker::TranscriptUpdate;

const ASR_HOST_PATH: &str = "asr.cloud.tencent.com/asr/v2";
const SAMPLE_RATE: u32 = 16000;
/// 200ms of 16kHz mono 16-bit PCM = 6400 bytes.
const FRAME_BYTES: usize = SAMPLE_RATE as usize * 2 / 5;
/// Realtime pacing between frames (protocol requires <= 1:1 rate).
const FRAME_INTERVAL: Duration = Duration::from_millis(200);
/// Silence-keepalive gap: the server disconnects after 6s without audio.
const KEEPALIVE_INTERVAL: Duration = Duration::from_secs(4);

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TencentAsrCredentials {
    #[serde(rename = "appId")]
    pub app_id: String,
    #[serde(rename = "secretId")]
    pub secret_id: String,
    #[serde(rename = "secretKey")]
    pub secret_key: String,
    /// Engine model type, defaults to 16k_zh (Mandarin general).
    #[serde(rename = "engineModelType", default = "default_engine")]
    pub engine_model_type: String,
}

pub fn default_engine() -> String {
    "16k_zh".to_string()
}

impl TencentAsrCredentials {
    pub fn is_complete(&self) -> bool {
        !self.app_id.trim().is_empty()
            && !self.secret_id.trim().is_empty()
            && !self.secret_key.trim().is_empty()
    }
}

/// Build the signed WebSocket URL (see module docs for the algorithm).
pub fn build_signed_url(credentials: &TencentAsrCredentials) -> String {
    use hmac::{Hmac, Mac};
    type HmacSha1 = Hmac<sha1::Sha1>;

    let ts = chrono::Utc::now().timestamp();
    let mut params: Vec<(String, String)> = vec![
        ("secretid".into(), credentials.secret_id.clone()),
        ("timestamp".into(), ts.to_string()),
        ("expired".into(), (ts + 86_400).to_string()),
        ("nonce".into(), ts.to_string()),
        (
            "engine_model_type".into(),
            credentials.engine_model_type.clone(),
        ),
        ("voice_format".into(), "1".into()), // 1 = pcm
        ("voice_id".into(), uuid::Uuid::new_v4().to_string()),
        ("needvad".into(), "1".into()),
        ("filter_dirty".into(), "1".into()),
        ("filter_modal".into(), "2".into()),
        ("convert_num_mode".into(), "1".into()),
        ("word_info".into(), "0".into()),
    ];
    params.sort();

    let query = params
        .iter()
        .map(|(k, v)| format!("{k}={v}"))
        .collect::<Vec<_>>()
        .join("&");
    let sign_text = format!("{ASR_HOST_PATH}/{}?{}", credentials.app_id, query);

    let mut mac = HmacSha1::new_from_slice(credentials.secret_key.as_bytes())
        .expect("HMAC accepts any key length");
    mac.update(sign_text.as_bytes());
    let signature = base64::engine::general_purpose::STANDARD.encode(mac.finalize().into_bytes());
    let signature_encoded = urlencoding::encode(&signature);

    format!(
        "wss://{ASR_HOST_PATH}/{}?{}&signature={}",
        credentials.app_id, query, signature_encoded
    )
}

#[derive(Debug, Deserialize)]
struct AsrResult {
    #[serde(default)]
    slice_type: Option<i32>,
    #[serde(default)]
    index: Option<i64>,
    #[serde(default)]
    start_time: Option<i64>,
    #[serde(default)]
    end_time: Option<i64>,
    #[serde(default, rename = "voice_text_str")]
    text: Option<String>,
}

#[derive(Debug, Deserialize)]
struct AsrMessage {
    code: i32,
    #[serde(default)]
    message: String,
    #[serde(default)]
    result: Option<AsrResult>,
    #[serde(default, rename = "final")]
    final_field: Option<i32>,
}

/// A live streaming session bound to one recording.
pub struct TencentAsrSession {
    /// PCM frames (i16 little-endian bytes) to stream to the server.
    sender: mpsc::UnboundedSender<Vec<u8>>,
    shutdown: tokio_util::sync::CancellationToken,
    /// Join handle for the internal tasks; aborted on shutdown.
    tasks: Vec<tokio::task::JoinHandle<()>>,
}

impl TencentAsrSession {
    /// Connect and start the streaming tasks. `app` is used to emit
    /// `transcript-update` events.
    pub async fn start<R: tauri::Runtime>(
        app: tauri::AppHandle<R>,
        credentials: &TencentAsrCredentials,
    ) -> Result<Self, String> {
        if !credentials.is_complete() {
            return Err("Tencent ASR credentials are incomplete".to_string());
        }
        let url = build_signed_url(credentials);
        info!(
            "Tencent ASR: connecting (engine={}, appid_origin_len={})",
            credentials.engine_model_type,
            credentials.app_id.len()
        );

        let request = url
            .into_client_request()
            .map_err(|e| format!("Tencent ASR: invalid request url: {e}"))?;
        let (ws_stream, _response) = tokio_tungstenite::connect_async(request)
            .await
            .map_err(|e| format!("Tencent ASR: connect failed: {e}"))?;
        info!("Tencent ASR: connected");

        let (write, read) = ws_stream.split();
        let (frame_tx, mut frame_rx) = mpsc::unbounded_channel::<Vec<u8>>();
        let shutdown = tokio_util::sync::CancellationToken::new();

        // ---- sender task: pace frames at 1:1 realtime, keepalive with silence
        let sender_shutdown = shutdown.clone();
        let sender = tokio::spawn(async move {
            let shutdown = sender_shutdown;
            let mut write = write;
            let mut pending: Vec<u8> = Vec::new();
            let mut pos = 0usize;
            loop {
                tokio::select! {
                    _ = shutdown.cancelled() => { break; }
                    frame = frame_rx.recv() => {
                        match frame {
                            Some(data) => pending.extend(data),
                            None => { break; }
                        }
                    }
                    _ = tokio::time::sleep(KEEPALIVE_INTERVAL) => {
                        // No fresh speech for a while: bridge with silence so
                        // the server keeps the stream open.
                        pending.extend(vec![0u8; FRAME_BYTES]);
                    }
                }

                while pending.len() - pos >= FRAME_BYTES {
                    let frame = pending[pos..pos + FRAME_BYTES].to_vec();
                    pos += FRAME_BYTES;
                    if write.send(Message::Binary(frame)).await.is_err() {
                        error!("Tencent ASR: write failed, stopping sender");
                        return;
                    }
                    tokio::time::sleep(FRAME_INTERVAL).await;
                }
                // Drop consumed bytes periodically to bound memory.
                if pos > 1 << 20 {
                    pending.drain(..pos);
                    pos = 0;
                }
            }
            // Flush the tail (short final frame) if any.
            if pos < pending.len() && !pending[pos..].is_empty() {
                let _ = write.send(Message::Binary(pending[pos..].to_vec())).await;
            }
            let _ = write.close().await;
        });

        // ---- receiver task: parse results and emit transcript-update
        let struct_shutdown = shutdown.clone();
        let receiver = tokio::spawn(async move {
            let shutdown = shutdown;
            let mut read = read;
            let t_start = std::time::Instant::now();
            while let Some(msg) = tokio::select! {
                _ = shutdown.cancelled() => None,
                msg = read.next() => msg,
            } {
                let msg = match msg {
                    Ok(m) => m,
                    Err(e) => {
                        error!("Tencent ASR: read error: {e}");
                        break;
                    }
                };
                let text = match msg {
                    Message::Text(t) => t,
                    Message::Close(c) => {
                        warn!("Tencent ASR: server closed: {c:?}");
                        break;
                    }
                    _ => continue,
                };

                let parsed: AsrMessage = match serde_json::from_str(&text) {
                    Ok(p) => p,
                    Err(e) => {
                        warn!("Tencent ASR: bad json: {e}");
                        continue;
                    }
                };
                if parsed.code != 0 {
                    error!(
                        "Tencent ASR: server error code={} message={}",
                        parsed.code, parsed.message
                    );
                    let _ = app.emit(
                        "transcription-error",
                        serde_json::json!({
                            "error": format!("tencent-asr code {}", parsed.code),
                            "userMessage": format!("腾讯云实时识别出错：{}（code {}）", parsed.message, parsed.code),
                            "actionable": true,
                            "phase": "active",
                        }),
                    );
                    break;
                }

                let Some(result) = parsed.result else { continue };
                let Some(slice_type) = result.slice_type else { continue };
                let text = result.text.unwrap_or_default();
                let is_final_slice = slice_type == 2;
                if text.trim().is_empty() && !is_final_slice {
                    continue;
                }

                // Speech latch shared with the batch workers.
                if !text.trim().is_empty() {
                    let _ = super::worker::SPEECH_DETECTED_EMITTED.compare_exchange(
                        false,
                        true,
                        Ordering::SeqCst,
                        Ordering::SeqCst,
                    );
                }

                let now_secs = t_start.elapsed().as_secs_f64();
                let start = result.start_time.unwrap_or(0).max(0) as f64 / 1000.0;
                let end = result.end_time.unwrap_or(0).max(0) as f64 / 1000.0;
                let update = TranscriptUpdate {
                    text: text.clone(),
                    timestamp: chrono::Local::now().format("%H:%M:%S").to_string(),
                    source: "Audio".to_string(),
                    sequence_id: super::worker::SEQUENCE_COUNTER.fetch_add(1, Ordering::SeqCst),
                    chunk_start_time: now_secs,
                    is_partial: !is_final_slice,
                    confidence: 0.95,
                    audio_start_time: start,
                    audio_end_time: end.max(start),
                    duration: (end - start).max(0.0),
                };
                if let Err(e) = app.emit("transcript-update", &update) {
                    error!("Tencent ASR: emit transcript-update failed: {e}");
                }
                info!(
                    "Tencent ASR: {} idx={:?} {}",
                    if is_final_slice { "stable" } else { "partial" },
                    result.index,
                    crate::utils::log_snippet(&text, 120)
                );
                if parsed.final_field.unwrap_or(0) == 1 {
                    info!("Tencent ASR: stream marked final by server");
                    break;
                }
            }
        });

        Ok(Self {
            sender: frame_tx,
            shutdown: struct_shutdown,
            tasks: vec![sender, receiver],
        })
    }

    /// Feed one VAD speech segment (f32 samples, already 16kHz mono).
    pub fn feed(&self, samples: &[f32]) {
        // Convert f32 [-1,1] to 16-bit LE PCM.
        let mut bytes = Vec::with_capacity(samples.len() * 2);
        for s in samples {
            let clamped = s.clamp(-1.0, 1.0);
            let v = (clamped * 32767.0) as i16;
            bytes.extend_from_slice(&v.to_le_bytes());
        }
        if self.sender.send(bytes).is_err() {
            warn!("Tencent ASR: sender channel closed");
        }
    }

    /// Stop the session. The internal tasks observe the cancellation token and
    /// exit on their own; we yield briefly so they can wind down.
    pub async fn shutdown(&self) {
        self.shutdown.cancel();
        let _ = self.sender.send(Vec::new()); // wake the sender so it exits
        tokio::time::sleep(Duration::from_millis(300)).await;
        info!("Tencent ASR: session shut down");
    }
}

/// true when the configured transcript provider is the Tencent streaming ASR.
pub fn is_tencent_provider(provider: &str) -> bool {
    provider == "tencent-asr" || provider == "tencent"
}
