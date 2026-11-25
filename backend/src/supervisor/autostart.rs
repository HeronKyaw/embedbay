use std::sync::Arc;
use std::time::Duration;

use crate::db::Database;
use crate::supervisor::process_manager::ProcessManager;

/// Sequentially starts instances configured with `auto_start = true` using
/// staggered delays so boot I/O does not spike.
pub async fn run_autostart_sequence(pm: Arc<ProcessManager>, db: Arc<Database>) {
    let Ok(instances) = db.list_autostart_instances() else {
        return;
    };

    for (idx, inst) in instances.into_iter().enumerate() {
        if idx > 0 {
            tokio::time::sleep(Duration::from_millis(500)).await;
        }
        if let Err(err) = pm.start_instance(&inst.id).await {
            pm.log_system(
                &inst.id,
                &format!("Boot auto-start failed for '{}': {}", inst.name, err),
            );
        }
    }
}
