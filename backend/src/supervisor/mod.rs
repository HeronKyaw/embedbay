pub mod autostart;
pub mod logs;
pub mod metrics;
pub mod process_manager;
pub mod tray;

pub trait EventSink: Send + Sync {
    fn emit_json(&self, event: &str, payload: serde_json::Value);
}

pub struct NoopEventSink;

impl EventSink for NoopEventSink {
    fn emit_json(&self, _event: &str, _payload: serde_json::Value) {}
}
