use std::collections::{HashMap, HashSet};
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use sysinfo::{
    CpuRefreshKind, Disks, MemoryRefreshKind, Pid, ProcessRefreshKind, ProcessesToUpdate,
    RefreshKind, System,
};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Child;
use tokio::sync::Mutex;

use crate::db::models::InstanceRecord;
use crate::db::Database;
use crate::engines::{self, HealthCheckKind};
use crate::platform;
use crate::supervisor::logs::InstanceLogStore;
use crate::supervisor::metrics::{
    dir_size_bytes, select_disk_space_for_path, HostResourceMetrics, InstanceMetrics,
    InstanceStatus, SystemMetricsSummary,
};
use crate::supervisor::EventSink;

const MAX_BACKOFF_RESTARTS: u32 = 5;
const GRACEFUL_STOP_TIMEOUT_SECS: u64 = 10;
const HEALTH_POLL_TIMEOUT_SECS: u64 = 30;

#[derive(Debug, Clone, Serialize)]
pub struct BatchActionResult {
    pub instance_id: String,
    pub name: String,
    pub ok: bool,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct InstanceStatusChangedEvent {
    pub instance_id: String,
    pub status: InstanceStatus,
    pub pid: Option<u32>,
    pub last_error: Option<String>,
}

struct ManagedRuntime {
    status: InstanceStatus,
    pid: Option<u32>,
    child: Option<Child>,
    desired_running: bool,
    started_at: Option<Instant>,
    last_activity_at: i64,
    restart_count: u32,
    last_error: Option<String>,
    ram_bytes: u64,
    cpu_percent: f32,
    disk_bytes: u64,
    disk_sampled_at: Option<Instant>,
    binary_path: Option<PathBuf>,
}

impl ManagedRuntime {
    fn new(is_embedded: bool) -> Self {
        Self {
            status: if is_embedded {
                InstanceStatus::Embedded
            } else {
                InstanceStatus::Stopped
            },
            pid: None,
            child: None,
            desired_running: false,
            started_at: None,
            last_activity_at: now_unix_secs(),
            restart_count: 0,
            last_error: None,
            ram_bytes: 0,
            cpu_percent: 0.0,
            disk_bytes: 0,
            disk_sampled_at: None,
            binary_path: None,
        }
    }
}

pub struct ProcessManager {
    db: Arc<Database>,
    logs: Arc<InstanceLogStore>,
    runtimes: Mutex<HashMap<String, ManagedRuntime>>,
    host_metrics: std::sync::RwLock<HostResourceMetrics>,
    event_sink: std::sync::RwLock<Option<Arc<dyn EventSink>>>,
}

fn sample_initial_host_metrics(data_root: &Path) -> HostResourceMetrics {
    let sys = System::new_with_specifics(
        RefreshKind::nothing()
            .with_cpu(CpuRefreshKind::nothing().with_cpu_usage())
            .with_memory(MemoryRefreshKind::nothing().with_ram()),
    );
    let disks = Disks::new_with_refreshed_list();
    let (disk_available_bytes, disk_total_bytes) = select_disk_space_for_path(&disks, data_root);
    HostResourceMetrics {
        cpu_percent: 0.0,
        cpu_cores: sys.cpus().len(),
        memory_used_bytes: sys.used_memory(),
        memory_total_bytes: sys.total_memory(),
        disk_available_bytes,
        disk_total_bytes,
    }
}

fn now_unix_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

pub fn check_port_available(host: &str, port: u16) -> bool {
    if port == 0 {
        return false;
    }
    let bind_addr = if host.trim().is_empty() {
        "127.0.0.1"
    } else {
        host.trim()
    };
    TcpListener::bind((bind_addr, port)).is_ok()
}

pub fn suggest_available_port(db: &Database, host: &str, start_port: u16) -> Result<u16, String> {
    let mut reserved = HashSet::new();
    if let Ok(instances) = db.list_instances() {
        for inst in instances {
            if inst.port > 0 {
                reserved.insert(inst.port);
            }
            if let Some(grpc) = inst.grpc_port {
                if grpc > 0 {
                    reserved.insert(grpc);
                }
            }
        }
    }

    let base = start_port.max(1024);
    for candidate in base..=65534 {
        if !reserved.contains(&candidate) && check_port_available(host, candidate) {
            return Ok(candidate);
        }
    }
    Err("No free TCP port found above requested range".to_string())
}

impl ProcessManager {
    pub fn new(db: Arc<Database>, logs: Arc<InstanceLogStore>) -> Self {
        let initial_host = sample_initial_host_metrics(db.data_root());
        Self {
            db,
            logs,
            runtimes: Mutex::new(HashMap::new()),
            host_metrics: std::sync::RwLock::new(initial_host),
            event_sink: std::sync::RwLock::new(None),
        }
    }

    pub fn set_event_sink(&self, sink: Arc<dyn EventSink>) {
        if let Ok(mut guard) = self.event_sink.write() {
            *guard = Some(sink);
        }
    }

    fn sink(&self) -> Option<Arc<dyn EventSink>> {
        self.event_sink.read().ok().and_then(|g| g.clone())
    }

    fn emit_event<T: Serialize>(&self, event: &str, payload: T) {
        if let Some(sink) = self.sink() {
            if let Ok(val) = serde_json::to_value(payload) {
                sink.emit_json(event, val);
            }
        }
    }

    fn emit_status_changed(
        &self,
        instance_id: &str,
        status: InstanceStatus,
        pid: Option<u32>,
        last_error: Option<String>,
    ) {
        self.emit_event(
            "instance-status-changed",
            InstanceStatusChangedEvent {
                instance_id: instance_id.to_string(),
                status,
                pid,
                last_error,
            },
        );
    }

    pub fn log_dir_for(&self, instance_id: &str) -> PathBuf {
        self.db.instance_root(instance_id).join("logs")
    }

    pub fn log_system(&self, instance_id: &str, message: &str) {
        let log_dir = self.log_dir_for(instance_id);
        let sink_opt = self.sink();
        self.logs.append(
            instance_id,
            &log_dir,
            "system",
            message,
            sink_opt.as_deref(),
        );
    }

    pub async fn is_instance_running(&self, instance_id: &str) -> bool {
        let guard = self.runtimes.lock().await;
        matches!(
            guard.get(instance_id).map(|r| r.status),
            Some(InstanceStatus::Running | InstanceStatus::Starting | InstanceStatus::Stopping)
        )
    }

    pub async fn record_activity(&self, instance_id: &str) {
        let mut guard = self.runtimes.lock().await;
        if let Some(rt) = guard.get_mut(instance_id) {
            rt.last_activity_at = now_unix_secs();
        }
    }

    pub async fn start_instance(self: &Arc<Self>, instance_id: &str) -> Result<InstanceMetrics, String> {
        let instance = self
            .db
            .get_instance(instance_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("Instance '{}' not found", instance_id))?;

        self.start_instance_internal(instance, false).await
    }

    async fn start_instance_internal(
        self: &Arc<Self>,
        instance: InstanceRecord,
        is_auto_restart: bool,
    ) -> Result<InstanceMetrics, String> {
        let provider = engines::get_provider(&instance.engine_type).map_err(|e| e.to_string())?;
        let log_dir = self.log_dir_for(&instance.id);
        let sink_opt = self.sink();

        if provider.is_embedded() {
            let mut guard = self.runtimes.lock().await;
            let rt = guard
                .entry(instance.id.clone())
                .or_insert_with(|| ManagedRuntime::new(true));
            rt.status = InstanceStatus::Embedded;
            rt.desired_running = false;
            rt.pid = None;
            rt.last_error = None;
            rt.last_activity_at = now_unix_secs();
            rt.disk_bytes = dir_size_bytes(Path::new(&instance.data_dir));
            rt.disk_sampled_at = Some(Instant::now());
            self.emit_status_changed(&instance.id, InstanceStatus::Embedded, None, None);
            return Ok(build_metrics(&instance, rt));
        }

        {
            let guard = self.runtimes.lock().await;
            if let Some(rt) = guard.get(&instance.id) {
                if matches!(rt.status, InstanceStatus::Running | InstanceStatus::Starting) {
                    return Ok(build_metrics(&instance, rt));
                }
            }
        }

        // Verify installed engine binary
        let installed = self
            .db
            .find_installed_engine_by_version(&instance.engine_type, &instance.engine_version)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| {
                format!(
                    "Engine '{}' v{} is not installed. Install it from the Engine Store first.",
                    instance.engine_type, instance.engine_version
                )
            })?;
        let binary_path = PathBuf::from(&installed.binary_path);
        if !binary_path.is_file() {
            return Err(format!(
                "Installed binary missing at '{}'. Reinstall from Engine Store.",
                binary_path.display()
            ));
        }

        // Port conflict checks
        if !check_port_available(&instance.host, instance.port) {
            let suggested = suggest_available_port(&self.db, &instance.host, instance.port + 1)
                .unwrap_or(instance.port + 1);
            return Err(format!(
                "Port {} on {} is already in use. Suggested free port: {}",
                instance.port, instance.host, suggested
            ));
        }
        if let Some(grpc_port) = instance.grpc_port {
            if !check_port_available(&instance.host, grpc_port) {
                let suggested = suggest_available_port(&self.db, &instance.host, grpc_port + 1)
                    .unwrap_or(grpc_port + 1);
                return Err(format!(
                    "gRPC port {} on {} is already in use. Suggested free port: {}",
                    grpc_port, instance.host, suggested
                ));
            }
        }

        let instance_root = self.db.instance_root(&instance.id);
        let spec = provider
            .prepare_instance(&instance, &instance_root, &binary_path)
            .map_err(|e| e.to_string())?;

        self.logs.append(
            &instance.id,
            &log_dir,
            "system",
            &format!(
                "Starting {} v{} on {}:{}",
                instance.engine_type, instance.engine_version, instance.host, instance.port
            ),
            sink_opt.as_deref(),
        );

        let mut cmd = tokio::process::Command::new(&spec.program);
        cmd.args(&spec.args)
            .current_dir(&spec.cwd)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(false);
        for (k, v) in &spec.env {
            cmd.env(k, v);
        }
        // Mandatory OS isolation: applies CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP on Windows.
        platform::configure_tokio_command(&mut cmd);

        let mut child = cmd
            .spawn()
            .map_err(|e| format!("Failed to spawn {}: {}", spec.program.display(), e))?;
        let pid = child.id();

        if let Some(stdout) = child.stdout.take() {
            spawn_log_reader(
                Arc::clone(&self.logs),
                instance.id.clone(),
                log_dir.clone(),
                "stdout".to_string(),
                stdout,
                sink_opt.clone(),
            );
        }
        if let Some(stderr) = child.stderr.take() {
            spawn_log_reader(
                Arc::clone(&self.logs),
                instance.id.clone(),
                log_dir.clone(),
                "stderr".to_string(),
                stderr,
                sink_opt.clone(),
            );
        }

        {
            let mut guard = self.runtimes.lock().await;
            let rt = guard
                .entry(instance.id.clone())
                .or_insert_with(|| ManagedRuntime::new(false));
            rt.status = InstanceStatus::Starting;
            rt.pid = pid;
            rt.child = Some(child);
            rt.desired_running = true;
            rt.started_at = Some(Instant::now());
            rt.last_activity_at = now_unix_secs();
            rt.last_error = None;
            if !is_auto_restart {
                rt.restart_count = 0;
            }
            rt.binary_path = Some(binary_path.clone());
        }
        self.emit_status_changed(&instance.id, InstanceStatus::Starting, pid, None);

        // Wait for health endpoint / TCP readiness while checking early exit
        let health_res = self.wait_for_health(&instance.id, &spec.health).await;
        if let Err(err_msg) = health_res {
            self.logs.append(
                &instance.id,
                &log_dir,
                "system",
                &format!("Startup health check failed: {}", err_msg),
                sink_opt.as_deref(),
            );
            let mut guard = self.runtimes.lock().await;
            if let Some(rt) = guard.get_mut(&instance.id) {
                rt.desired_running = false;
                if let Some(mut c) = rt.child.take() {
                    let _ = c.start_kill();
                }
                rt.pid = None;
                rt.status = InstanceStatus::Error;
                rt.last_error = Some(err_msg.clone());
            }
            self.emit_status_changed(
                &instance.id,
                InstanceStatus::Error,
                None,
                Some(err_msg.clone()),
            );
            return Err(err_msg);
        }

        if let Err(err) = provider.post_start_init(&instance, &binary_path).await {
            let msg = format!("Post-start initialization failed: {}", err);
            self.logs
                .append(&instance.id, &log_dir, "system", &msg, sink_opt.as_deref());
            let mut guard = self.runtimes.lock().await;
            if let Some(rt) = guard.get_mut(&instance.id) {
                rt.desired_running = false;
                if let Some(mut c) = rt.child.take() {
                    let _ = c.start_kill();
                }
                rt.pid = None;
                rt.status = InstanceStatus::Error;
                rt.last_error = Some(msg.clone());
            }
            self.emit_status_changed(&instance.id, InstanceStatus::Error, None, Some(msg.clone()));
            return Err(msg);
        }

        let metrics = {
            let mut guard = self.runtimes.lock().await;
            let rt = guard
                .get_mut(&instance.id)
                .ok_or_else(|| "Runtime disappeared during startup".to_string())?;
            rt.status = InstanceStatus::Running;
            rt.last_activity_at = now_unix_secs();
            rt.disk_bytes = dir_size_bytes(Path::new(&instance.data_dir));
            rt.disk_sampled_at = Some(Instant::now());
            build_metrics(&instance, rt)
        };

        self.logs.append(
            &instance.id,
            &log_dir,
            "system",
            &format!("Instance '{}' is healthy and running (PID {:?})", instance.name, pid),
            sink_opt.as_deref(),
        );
        self.emit_status_changed(&instance.id, InstanceStatus::Running, pid, None);

        // Spawn crash/exit monitor for automatic backoff restarts
        self.spawn_exit_watcher(instance.id.clone());

        Ok(metrics)
    }

    async fn wait_for_health(
        &self,
        instance_id: &str,
        health: &HealthCheckKind,
    ) -> Result<(), String> {
        if matches!(health, HealthCheckKind::None) {
            return Ok(());
        }

        let client = reqwest::Client::builder()
            .no_proxy()
            .timeout(Duration::from_millis(800))
            .build()
            .map_err(|e| e.to_string())?;

        let deadline = Instant::now() + Duration::from_secs(HEALTH_POLL_TIMEOUT_SECS);
        loop {
            // Abort fast if child already exited or stop was requested
            {
                let mut guard = self.runtimes.lock().await;
                let Some(rt) = guard.get_mut(instance_id) else {
                    return Err("Instance runtime removed".to_string());
                };
                if !rt.desired_running {
                    return Err("Startup cancelled".to_string());
                }
                if let Some(child) = rt.child.as_mut() {
                    if let Ok(Some(exit_status)) = child.try_wait() {
                        return Err(format!(
                            "Process exited prematurely with status {} before becoming healthy",
                            exit_status
                        ));
                    }
                }
            }

            let healthy = match health {
                HealthCheckKind::HttpGet { url, fallback_url } => {
                    let primary_ok = client
                        .get(url)
                        .send()
                        .await
                        .map(|r| r.status().is_success())
                        .unwrap_or(false);
                    if primary_ok {
                        true
                    } else if let Some(fb) = fallback_url {
                        client
                            .get(fb)
                            .send()
                            .await
                            .map(|r| r.status().is_success())
                            .unwrap_or(false)
                    } else {
                        false
                    }
                }
                HealthCheckKind::TcpConnect { host, port } => {
                    tokio::net::TcpStream::connect((host.as_str(), *port))
                        .await
                        .is_ok()
                }
                HealthCheckKind::None => true,
            };

            if healthy {
                return Ok(());
            }

            if Instant::now() >= deadline {
                return Err(format!(
                    "Timed out after {}s waiting for health check",
                    HEALTH_POLL_TIMEOUT_SECS
                ));
            }
            tokio::time::sleep(Duration::from_millis(250)).await;
        }
    }

    fn spawn_exit_watcher(self: &Arc<Self>, instance_id: String) {
        let pm = Arc::clone(self);
        tokio::spawn(async move {
            loop {
                tokio::time::sleep(Duration::from_millis(500)).await;

                let exited_unexpectedly = {
                    let mut guard = pm.runtimes.lock().await;
                    let Some(rt) = guard.get_mut(&instance_id) else {
                        break;
                    };
                    if !rt.desired_running || rt.status != InstanceStatus::Running {
                        if rt.child.is_none() {
                            break;
                        }
                        continue;
                    }
                    let Some(child) = rt.child.as_mut() else {
                        break;
                    };
                    match child.try_wait() {
                        Ok(Some(status)) => {
                            rt.child = None;
                            rt.pid = None;
                            rt.ram_bytes = 0;
                            rt.cpu_percent = 0.0;
                            Some(status.to_string())
                        }
                        Ok(None) => None,
                        Err(e) => {
                            rt.child = None;
                            rt.pid = None;
                            Some(format!("wait error: {}", e))
                        }
                    }
                };

                let Some(exit_desc) = exited_unexpectedly else {
                    continue;
                };

                let log_dir = pm.log_dir_for(&instance_id);
                let sink_opt = pm.sink();

                let restart_attempt = {
                    let mut guard = pm.runtimes.lock().await;
                    let Some(rt) = guard.get_mut(&instance_id) else {
                        break;
                    };
                    if !rt.desired_running {
                        break;
                    }
                    if rt.restart_count >= MAX_BACKOFF_RESTARTS {
                        let msg = format!(
                            "Process crashed ({}); exceeded max auto-restart attempts ({})",
                            exit_desc, MAX_BACKOFF_RESTARTS
                        );
                        rt.desired_running = false;
                        rt.status = InstanceStatus::Error;
                        rt.last_error = Some(msg.clone());
                        pm.logs
                            .append(&instance_id, &log_dir, "system", &msg, sink_opt.as_deref());
                        pm.emit_status_changed(
                            &instance_id,
                            InstanceStatus::Error,
                            None,
                            Some(msg),
                        );
                        break;
                    }
                    rt.restart_count += 1;
                    rt.status = InstanceStatus::Starting;
                    rt.restart_count
                };

                let backoff_secs = 1u64 << (restart_attempt - 1).min(4);
                pm.logs.append(
                    &instance_id,
                    &log_dir,
                    "system",
                    &format!(
                        "Process exited unexpectedly ({}). Auto-restarting in {}s (attempt {}/{})",
                        exit_desc, backoff_secs, restart_attempt, MAX_BACKOFF_RESTARTS
                    ),
                    sink_opt.as_deref(),
                );
                pm.emit_status_changed(&instance_id, InstanceStatus::Starting, None, None);

                tokio::time::sleep(Duration::from_secs(backoff_secs)).await;

                // Ensure stop was not requested during backoff sleep
                let still_wanted = {
                    let guard = pm.runtimes.lock().await;
                    guard
                        .get(&instance_id)
                        .map(|r| r.desired_running)
                        .unwrap_or(false)
                };
                if !still_wanted {
                    break;
                }

                match pm.db.get_instance(&instance_id) {
                    Ok(Some(inst)) => {
                        if let Err(err) = pm.start_instance_internal(inst, true).await {
                            pm.logs.append(
                                &instance_id,
                                &log_dir,
                                "system",
                                &format!("Auto-restart attempt {} failed: {}", restart_attempt, err),
                                sink_opt.as_deref(),
                            );
                        }
                    }
                    _ => break,
                }
                break;
            }
        });
    }

    pub async fn stop_instance(&self, instance_id: &str) -> Result<(), String> {
        let instance = self
            .db
            .get_instance(instance_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("Instance '{}' not found", instance_id))?;

        let log_dir = self.log_dir_for(instance_id);
        let sink_opt = self.sink();

        let (mut child_opt, pid_opt, binary_path) = {
            let mut guard = self.runtimes.lock().await;
            let Some(rt) = guard.get_mut(instance_id) else {
                return Ok(());
            };
            rt.desired_running = false;
            if rt.status == InstanceStatus::Embedded {
                return Ok(());
            }
            if rt.child.is_none() {
                rt.status = InstanceStatus::Stopped;
                rt.pid = None;
                rt.ram_bytes = 0;
                rt.cpu_percent = 0.0;
                self.emit_status_changed(instance_id, InstanceStatus::Stopped, None, None);
                return Ok(());
            }
            rt.status = InstanceStatus::Stopping;
            (rt.child.take(), rt.pid, rt.binary_path.clone())
        };
        self.emit_status_changed(instance_id, InstanceStatus::Stopping, pid_opt, None);

        self.logs.append(
            instance_id,
            &log_dir,
            "system",
            &format!("Stopping instance '{}' gracefully...", instance.name),
            sink_opt.as_deref(),
        );

        if let (Some(pid), Some(bin)) = (pid_opt, binary_path) {
            if let Ok(provider) = engines::get_provider(&instance.engine_type) {
                if let Err(err) = provider.graceful_stop(&instance, pid, &bin).await {
                    self.logs.append(
                        instance_id,
                        &log_dir,
                        "system",
                        &format!("Graceful stop signal note: {}", err),
                        sink_opt.as_deref(),
                    );
                }
            }
        }

        if let Some(child) = child_opt.as_mut() {
            let wait_res = tokio::time::timeout(
                Duration::from_secs(GRACEFUL_STOP_TIMEOUT_SECS),
                child.wait(),
            )
            .await;

            if wait_res.is_err() {
                self.logs.append(
                    instance_id,
                    &log_dir,
                    "system",
                    "Graceful stop timed out after 10s; force killing process.",
                    sink_opt.as_deref(),
                );
                let _ = child.kill().await;
            }
        }

        {
            let mut guard = self.runtimes.lock().await;
            if let Some(rt) = guard.get_mut(instance_id) {
                rt.status = InstanceStatus::Stopped;
                rt.pid = None;
                rt.started_at = None;
                rt.ram_bytes = 0;
                rt.cpu_percent = 0.0;
                rt.last_error = None;
            }
        }
        self.emit_status_changed(instance_id, InstanceStatus::Stopped, None, None);
        self.logs.append(
            instance_id,
            &log_dir,
            "system",
            "Instance stopped.",
            sink_opt.as_deref(),
        );
        Ok(())
    }

    pub async fn force_kill_instance(&self, instance_id: &str) -> Result<(), String> {
        let log_dir = self.log_dir_for(instance_id);
        let sink_opt = self.sink();

        let child_opt = {
            let mut guard = self.runtimes.lock().await;
            let Some(rt) = guard.get_mut(instance_id) else {
                return Ok(());
            };
            rt.desired_running = false;
            rt.status = InstanceStatus::Stopping;
            rt.child.take()
        };

        if let Some(mut child) = child_opt {
            let _ = child.kill().await;
        }

        {
            let mut guard = self.runtimes.lock().await;
            if let Some(rt) = guard.get_mut(instance_id) {
                rt.status = InstanceStatus::Stopped;
                rt.pid = None;
                rt.started_at = None;
                rt.ram_bytes = 0;
                rt.cpu_percent = 0.0;
                rt.last_error = None;
            }
        }
        self.logs.append(
            instance_id,
            &log_dir,
            "system",
            "Instance force-killed by user.",
            sink_opt.as_deref(),
        );
        self.emit_status_changed(instance_id, InstanceStatus::Stopped, None, None);
        Ok(())
    }

    pub async fn restart_instance(self: &Arc<Self>, instance_id: &str) -> Result<InstanceMetrics, String> {
        self.stop_instance(instance_id).await?;
        self.start_instance(instance_id).await
    }

    pub async fn start_group_instances(
        self: &Arc<Self>,
        group_id: &str,
    ) -> Result<Vec<BatchActionResult>, String> {
        let instances = self
            .db
            .list_instances_by_group(group_id)
            .map_err(|e| e.to_string())?;
        let mut results = Vec::with_capacity(instances.len());
        for (idx, inst) in instances.into_iter().enumerate() {
            if idx > 0 {
                tokio::time::sleep(Duration::from_millis(350)).await;
            }
            let res = self.start_instance(&inst.id).await;
            results.push(BatchActionResult {
                instance_id: inst.id,
                name: inst.name,
                ok: res.is_ok(),
                error: res.err(),
            });
        }
        Ok(results)
    }

    pub async fn stop_group_instances(&self, group_id: &str) -> Result<Vec<BatchActionResult>, String> {
        let instances = self
            .db
            .list_instances_by_group(group_id)
            .map_err(|e| e.to_string())?;
        let mut results = Vec::with_capacity(instances.len());
        for inst in instances {
            let res = self.stop_instance(&inst.id).await;
            results.push(BatchActionResult {
                instance_id: inst.id,
                name: inst.name,
                ok: res.is_ok(),
                error: res.err(),
            });
        }
        Ok(results)
    }

    pub async fn stop_all_instances(&self) -> Vec<BatchActionResult> {
        let instances = self.db.list_instances().unwrap_or_default();
        let mut results = Vec::new();
        for inst in instances {
            if self.is_instance_running(&inst.id).await {
                let res = self.stop_instance(&inst.id).await;
                results.push(BatchActionResult {
                    instance_id: inst.id,
                    name: inst.name,
                    ok: res.is_ok(),
                    error: res.err(),
                });
            }
        }
        results
    }

    pub async fn stop_idle_instances(&self, default_idle_minutes: i64) -> Vec<BatchActionResult> {
        let instances = self.db.list_instances().unwrap_or_default();
        let now = now_unix_secs();
        let mut to_stop = Vec::new();

        {
            let guard = self.runtimes.lock().await;
            for inst in instances {
                let Some(rt) = guard.get(&inst.id) else {
                    continue;
                };
                if rt.status != InstanceStatus::Running {
                    continue;
                }
                let threshold_mins = if inst.idle_timeout_minutes > 0 {
                    inst.idle_timeout_minutes
                } else {
                    default_idle_minutes
                };
                if threshold_mins > 0 && (now - rt.last_activity_at) >= threshold_mins * 60 {
                    to_stop.push(inst);
                }
            }
        }

        let mut results = Vec::new();
        for inst in to_stop {
            let log_dir = self.log_dir_for(&inst.id);
            let sink_opt = self.sink();
            self.logs.append(
                &inst.id,
                &log_dir,
                "system",
                "Stopping instance due to idle auto-stop policy.",
                sink_opt.as_deref(),
            );
            let res = self.stop_instance(&inst.id).await;
            self.emit_event("instance-idle-stopped", &inst.id);
            results.push(BatchActionResult {
                instance_id: inst.id,
                name: inst.name,
                ok: res.is_ok(),
                error: res.err(),
            });
        }
        results
    }

    pub async fn get_all_instance_metrics(&self) -> Result<SystemMetricsSummary, String> {
        let instances = self.db.list_instances().map_err(|e| e.to_string())?;
        let mut guard = self.runtimes.lock().await;

        let mut map = HashMap::new();
        let mut total_ram_bytes = 0u64;
        let mut total_cpu_percent = 0.0f32;
        let mut total_disk_bytes = 0u64;
        let mut running_count = 0usize;

        for inst in instances {
            let is_embedded = engines::get_provider(&inst.engine_type)
                .map(|p| p.is_embedded())
                .unwrap_or(false);
            let rt = guard
                .entry(inst.id.clone())
                .or_insert_with(|| ManagedRuntime::new(is_embedded));

            let should_sample_disk = rt
                .disk_sampled_at
                .map(|t| t.elapsed() >= Duration::from_secs(30))
                .unwrap_or(true);
            if should_sample_disk {
                rt.disk_bytes = dir_size_bytes(Path::new(&inst.data_dir));
                rt.disk_sampled_at = Some(Instant::now());
            }

            total_disk_bytes = total_disk_bytes.saturating_add(rt.disk_bytes);

            if rt.status == InstanceStatus::Running {
                running_count += 1;
                total_ram_bytes = total_ram_bytes.saturating_add(rt.ram_bytes);
                if rt.cpu_percent.is_finite() {
                    total_cpu_percent += rt.cpu_percent;
                }
            }

            map.insert(inst.id.clone(), build_metrics(&inst, rt));
        }

        let host = self
            .host_metrics
            .read()
            .map(|h| h.clone())
            .unwrap_or_default();

        Ok(SystemMetricsSummary {
            total_ram_bytes,
            total_cpu_percent: total_cpu_percent.clamp(0.0, 100.0),
            total_disk_bytes,
            running_count,
            host,
            instances: map,
        })
    }

    pub async fn spawn_background_monitors(self: Arc<Self>) {
        let pm_metrics = Arc::clone(&self);
        tokio::spawn(async move {
            let mut sys = System::new_with_specifics(
                RefreshKind::nothing()
                    .with_cpu(CpuRefreshKind::nothing().with_cpu_usage())
                    .with_memory(MemoryRefreshKind::nothing().with_ram()),
            );
            let mut disks = Disks::new_with_refreshed_list();
            let mut last_disk_refresh = Instant::now();

            loop {
                tokio::time::sleep(Duration::from_secs(2)).await;

                sys.refresh_cpu_usage();
                sys.refresh_memory_specifics(MemoryRefreshKind::nothing().with_ram());
                if last_disk_refresh.elapsed() >= Duration::from_secs(30) {
                    disks.refresh(true);
                    last_disk_refresh = Instant::now();
                }

                let cpu_cores = sys.cpus().len();
                let raw_cpu = sys.global_cpu_usage();
                let cpu_percent = if raw_cpu.is_finite() {
                    raw_cpu.clamp(0.0, 100.0)
                } else {
                    0.0
                };
                let (disk_available_bytes, disk_total_bytes) =
                    select_disk_space_for_path(&disks, pm_metrics.db.data_root());

                if let Ok(mut host_guard) = pm_metrics.host_metrics.write() {
                    *host_guard = HostResourceMetrics {
                        cpu_percent,
                        cpu_cores,
                        memory_used_bytes: sys.used_memory(),
                        memory_total_bytes: sys.total_memory(),
                        disk_available_bytes,
                        disk_total_bytes,
                    };
                }

                let pids: Vec<(String, Pid)> = {
                    let guard = pm_metrics.runtimes.lock().await;
                    guard
                        .iter()
                        .filter_map(|(id, rt)| {
                            if matches!(rt.status, InstanceStatus::Running | InstanceStatus::Starting)
                            {
                                rt.pid.map(|p| (id.clone(), Pid::from_u32(p)))
                            } else {
                                None
                            }
                        })
                        .collect()
                };

                if !pids.is_empty() {
                    let raw_pids: Vec<Pid> = pids.iter().map(|(_, p)| *p).collect();
                    sys.refresh_processes_specifics(
                        ProcessesToUpdate::Some(&raw_pids),
                        true,
                        ProcessRefreshKind::nothing().with_cpu().with_memory(),
                    );

                    let core_divisor = cpu_cores.max(1) as f32;
                    let mut guard = pm_metrics.runtimes.lock().await;
                    for (id, pid) in &pids {
                        if let (Some(rt), Some(proc_info)) = (guard.get_mut(id), sys.process(*pid))
                        {
                            rt.ram_bytes = proc_info.memory();
                            let normalized_cpu = proc_info.cpu_usage() / core_divisor;
                            rt.cpu_percent = if normalized_cpu.is_finite() {
                                normalized_cpu.clamp(0.0, 100.0)
                            } else {
                                0.0
                            };
                        }
                    }
                }

                if let Ok(summary) = pm_metrics.get_all_instance_metrics().await {
                    pm_metrics.emit_event("instance-metrics", summary);
                }
            }
        });

        // Idle Auto-Stop sweep every 30s (only triggers for instances with idle_timeout_minutes > 0)
        let pm_idle = Arc::clone(&self);
        tokio::spawn(async move {
            loop {
                tokio::time::sleep(Duration::from_secs(30)).await;
                let _ = pm_idle.stop_idle_instances(0).await;
            }
        });
    }
}

fn build_metrics(inst: &InstanceRecord, rt: &ManagedRuntime) -> InstanceMetrics {
    let uptime_secs = if matches!(rt.status, InstanceStatus::Running) {
        rt.started_at.map(|t| t.elapsed().as_secs()).unwrap_or(0)
    } else {
        0
    };
    InstanceMetrics {
        instance_id: inst.id.clone(),
        status: rt.status,
        pid: rt.pid,
        ram_bytes: rt.ram_bytes,
        cpu_percent: rt.cpu_percent,
        uptime_secs,
        disk_bytes: rt.disk_bytes,
        restart_count: rt.restart_count,
        last_error: rt.last_error.clone(),
        last_activity_at: rt.last_activity_at,
    }
}

fn spawn_log_reader<R>(
    logs: Arc<InstanceLogStore>,
    instance_id: String,
    log_dir: PathBuf,
    stream: String,
    reader: R,
    sink: Option<Arc<dyn EventSink>>,
) where
    R: tokio::io::AsyncRead + Unpin + Send + 'static,
{
    tokio::spawn(async move {
        let mut lines = BufReader::new(reader).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            logs.append(&instance_id, &log_dir, &stream, &line, sink.as_deref());
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::models::CreateInstancePayload;

    #[test]
    fn port_conflict_and_suggestion_detect_bound_sockets() {
        let dir = tempfile::tempdir().expect("temp dir");
        let db = Database::init(dir.path().to_path_buf()).expect("db init");

        let listener = TcpListener::bind(("127.0.0.1", 0)).expect("bind ephemeral port");
        let occupied = listener.local_addr().expect("local addr").port();

        assert!(!check_port_available("127.0.0.1", occupied));

        let next_free =
            suggest_available_port(&db, "127.0.0.1", occupied).expect("suggest free port");
        assert_ne!(next_free, occupied);
        assert!(check_port_available("127.0.0.1", next_free));

        // Also skips ports already assigned in SQLite
        db.create_instance(CreateInstancePayload {
            name: "Reserved Port Instance".to_string(),
            description: None,
            color: None,
            group_id: None,
            engine_type: "qdrant".to_string(),
            engine_version: "1.20.2".to_string(),
            host: None,
            port: next_free,
            grpc_port: None,
            data_dir: None,
            config_json: None,
            auto_start: None,
            idle_timeout_minutes: None,
            tag_ids: None,
        })
        .expect("create instance");

        let next_after_db =
            suggest_available_port(&db, "127.0.0.1", next_free).expect("skip db reserved port");
        assert_ne!(next_after_db, next_free);
    }

    #[tokio::test]
    async fn idle_auto_stop_stops_only_expired_running_instances() {
        let dir = tempfile::tempdir().expect("temp dir");
        let db = Arc::new(Database::init(dir.path().to_path_buf()).expect("db init"));
        let logs = Arc::new(InstanceLogStore::default());
        let pm = ProcessManager::new(Arc::clone(&db), logs);

        let inst_idle = db
            .create_instance(CreateInstancePayload {
                name: "Idle Qdrant".to_string(),
                description: None,
                color: None,
                group_id: None,
                engine_type: "qdrant".to_string(),
                engine_version: "1.20.2".to_string(),
                host: Some("127.0.0.1".to_string()),
                port: 16333,
                grpc_port: Some(16334),
                data_dir: None,
                config_json: None,
                auto_start: Some(false),
                idle_timeout_minutes: Some(5),
                tag_ids: None,
            })
            .expect("create idle instance");

        let inst_active = db
            .create_instance(CreateInstancePayload {
                name: "Active Qdrant".to_string(),
                description: None,
                color: None,
                group_id: None,
                engine_type: "qdrant".to_string(),
                engine_version: "1.20.2".to_string(),
                host: Some("127.0.0.1".to_string()),
                port: 16335,
                grpc_port: Some(16336),
                data_dir: None,
                config_json: None,
                auto_start: Some(false),
                idle_timeout_minutes: Some(5),
                tag_ids: None,
            })
            .expect("create active instance");

        {
            let mut guard = pm.runtimes.lock().await;
            let stale_ts = now_unix_secs() - 600;
            let mut rt_idle = ManagedRuntime::new(false);
            rt_idle.status = InstanceStatus::Running;
            rt_idle.last_activity_at = stale_ts;
            guard.insert(inst_idle.id.clone(), rt_idle);

            let mut rt_active = ManagedRuntime::new(false);
            rt_active.status = InstanceStatus::Running;
            rt_active.last_activity_at = stale_ts;
            guard.insert(inst_active.id.clone(), rt_active);
        }

        pm.record_activity(&inst_active.id).await;

        let results = pm.stop_idle_instances(0).await;
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].instance_id, inst_idle.id);
        assert!(results[0].ok);
        assert!(!pm.is_instance_running(&inst_idle.id).await);
        assert!(pm.is_instance_running(&inst_active.id).await);
    }
}
