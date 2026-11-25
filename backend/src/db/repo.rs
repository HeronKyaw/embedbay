use std::collections::HashMap;
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{params, Connection, OptionalExtension};
use uuid::Uuid;

use super::models::*;
use super::{Database, DbError};

fn now_unix_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn load_entity_tags_map(
    conn: &Connection,
    entity_type: &str,
) -> Result<HashMap<String, Vec<String>>, DbError> {
    let mut stmt = conn.prepare(
        "SELECT et.entity_id, et.tag_id
         FROM entity_tags et
         JOIN tags t ON t.id = et.tag_id
         WHERE et.entity_type = ?1
         ORDER BY t.name ASC",
    )?;
    let rows = stmt.query_map(params![entity_type], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })?;
    let mut map: HashMap<String, Vec<String>> = HashMap::new();
    for row in rows {
        let (entity_id, tag_id) = row?;
        map.entry(entity_id).or_default().push(tag_id);
    }
    Ok(map)
}

fn load_single_entity_tags(
    conn: &Connection,
    entity_type: &str,
    entity_id: &str,
) -> Result<Vec<String>, DbError> {
    let mut stmt = conn.prepare(
        "SELECT et.tag_id
         FROM entity_tags et
         JOIN tags t ON t.id = et.tag_id
         WHERE et.entity_type = ?1 AND et.entity_id = ?2
         ORDER BY t.name ASC",
    )?;
    let rows = stmt.query_map(params![entity_type, entity_id], |row| row.get(0))?;
    let mut result = Vec::new();
    for row in rows {
        result.push(row?);
    }
    Ok(result)
}

fn replace_entity_tags(
    tx: &rusqlite::Transaction<'_>,
    entity_type: &str,
    entity_id: &str,
    tag_ids: &[String],
) -> Result<(), DbError> {
    tx.execute(
        "DELETE FROM entity_tags WHERE entity_type = ?1 AND entity_id = ?2",
        params![entity_type, entity_id],
    )?;
    for tag_id in tag_ids {
        tx.execute(
            "INSERT OR IGNORE INTO entity_tags (entity_type, entity_id, tag_id) VALUES (?1, ?2, ?3)",
            params![entity_type, entity_id, tag_id],
        )?;
    }
    Ok(())
}

impl Database {
    // -----------------------------------------------------------------------
    // Installed Engines
    // -----------------------------------------------------------------------

    pub fn list_installed_engines(&self) -> Result<Vec<InstalledEngine>, DbError> {
        let conn = self.conn.lock().map_err(|_| DbError::LockPoisoned)?;
        let mut stmt = conn.prepare(
            "SELECT id, engine_type, version, target_triple, binary_path, sha256, installed_at
             FROM installed_engines
             ORDER BY engine_type ASC, installed_at DESC",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(InstalledEngine {
                id: row.get(0)?,
                engine_type: row.get(1)?,
                version: row.get(2)?,
                target_triple: row.get(3)?,
                binary_path: row.get(4)?,
                sha256: row.get(5)?,
                installed_at: row.get(6)?,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>().map_err(DbError::from)
    }

    pub fn get_installed_engine(&self, id: &str) -> Result<Option<InstalledEngine>, DbError> {
        let conn = self.conn.lock().map_err(|_| DbError::LockPoisoned)?;
        conn.query_row(
            "SELECT id, engine_type, version, target_triple, binary_path, sha256, installed_at
             FROM installed_engines
             WHERE id = ?1",
            params![id],
            |row| {
                Ok(InstalledEngine {
                    id: row.get(0)?,
                    engine_type: row.get(1)?,
                    version: row.get(2)?,
                    target_triple: row.get(3)?,
                    binary_path: row.get(4)?,
                    sha256: row.get(5)?,
                    installed_at: row.get(6)?,
                })
            },
        )
        .optional()
        .map_err(DbError::from)
    }

    pub fn find_installed_engine_by_version(
        &self,
        engine_type: &str,
        version: &str,
    ) -> Result<Option<InstalledEngine>, DbError> {
        let conn = self.conn.lock().map_err(|_| DbError::LockPoisoned)?;
        conn.query_row(
            "SELECT id, engine_type, version, target_triple, binary_path, sha256, installed_at
             FROM installed_engines
             WHERE engine_type = ?1 AND version = ?2",
            params![engine_type, version],
            |row| {
                Ok(InstalledEngine {
                    id: row.get(0)?,
                    engine_type: row.get(1)?,
                    version: row.get(2)?,
                    target_triple: row.get(3)?,
                    binary_path: row.get(4)?,
                    sha256: row.get(5)?,
                    installed_at: row.get(6)?,
                })
            },
        )
        .optional()
        .map_err(DbError::from)
    }

    pub fn upsert_installed_engine(&self, engine: &InstalledEngine) -> Result<(), DbError> {
        let conn = self.conn.lock().map_err(|_| DbError::LockPoisoned)?;
        conn.execute(
            "INSERT INTO installed_engines (id, engine_type, version, target_triple, binary_path, sha256, installed_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
             ON CONFLICT(id) DO UPDATE SET
                engine_type = excluded.engine_type,
                version = excluded.version,
                target_triple = excluded.target_triple,
                binary_path = excluded.binary_path,
                sha256 = excluded.sha256,
                installed_at = excluded.installed_at",
            params![
                engine.id,
                engine.engine_type,
                engine.version,
                engine.target_triple,
                engine.binary_path,
                engine.sha256,
                engine.installed_at
            ],
        )?;
        Ok(())
    }

    pub fn delete_installed_engine(&self, id: &str) -> Result<bool, DbError> {
        let conn = self.conn.lock().map_err(|_| DbError::LockPoisoned)?;
        let affected = conn.execute("DELETE FROM installed_engines WHERE id = ?1", params![id])?;
        Ok(affected > 0)
    }

    // -----------------------------------------------------------------------
    // Connection Groups
    // -----------------------------------------------------------------------

    pub fn list_groups(&self) -> Result<Vec<ConnectionGroup>, DbError> {
        let conn = self.conn.lock().map_err(|_| DbError::LockPoisoned)?;
        let mut stmt = conn.prepare(
            "SELECT id, name, color, icon, sort_order, is_collapsed, created_at
             FROM connection_groups
             ORDER BY sort_order ASC, created_at ASC",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(ConnectionGroup {
                id: row.get(0)?,
                name: row.get(1)?,
                color: row.get(2)?,
                icon: row.get(3)?,
                sort_order: row.get(4)?,
                is_collapsed: row.get::<_, i64>(5)? != 0,
                created_at: row.get(6)?,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>().map_err(DbError::from)
    }

    pub fn get_group(&self, id: &str) -> Result<Option<ConnectionGroup>, DbError> {
        let conn = self.conn.lock().map_err(|_| DbError::LockPoisoned)?;
        conn.query_row(
            "SELECT id, name, color, icon, sort_order, is_collapsed, created_at
             FROM connection_groups
             WHERE id = ?1",
            params![id],
            |row| {
                Ok(ConnectionGroup {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    color: row.get(2)?,
                    icon: row.get(3)?,
                    sort_order: row.get(4)?,
                    is_collapsed: row.get::<_, i64>(5)? != 0,
                    created_at: row.get(6)?,
                })
            },
        )
        .optional()
        .map_err(DbError::from)
    }

    pub fn create_group(&self, payload: CreateGroupPayload) -> Result<ConnectionGroup, DbError> {
        let name = payload.name.trim().to_string();
        if name.is_empty() {
            return Err(DbError::Validation("Group name cannot be empty".to_string()));
        }
        let id = Uuid::new_v4().to_string();
        let created_at = now_unix_secs();

        let conn = self.conn.lock().map_err(|_| DbError::LockPoisoned)?;
        let next_order: i64 = conn.query_row(
            "SELECT COALESCE(MAX(sort_order) + 1, 0) FROM connection_groups",
            [],
            |row| row.get(0),
        )?;

        conn.execute(
            "INSERT INTO connection_groups (id, name, color, icon, sort_order, is_collapsed, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6)",
            params![id, name, payload.color, payload.icon, next_order, created_at],
        )?;

        Ok(ConnectionGroup {
            id,
            name,
            color: payload.color,
            icon: payload.icon,
            sort_order: next_order,
            is_collapsed: false,
            created_at,
        })
    }

    pub fn update_group(
        &self,
        id: &str,
        payload: UpdateGroupPayload,
    ) -> Result<ConnectionGroup, DbError> {
        let mut group = self
            .get_group(id)?
            .ok_or_else(|| DbError::NotFound(format!("Group '{}' not found", id)))?;

        if let Some(name) = payload.name {
            let trimmed = name.trim().to_string();
            if trimmed.is_empty() {
                return Err(DbError::Validation("Group name cannot be empty".to_string()));
            }
            group.name = trimmed;
        }
        if let Some(color) = payload.color {
            group.color = color;
        }
        if let Some(icon) = payload.icon {
            group.icon = icon;
        }
        if let Some(sort_order) = payload.sort_order {
            group.sort_order = sort_order;
        }
        if let Some(is_collapsed) = payload.is_collapsed {
            group.is_collapsed = is_collapsed;
        }

        let conn = self.conn.lock().map_err(|_| DbError::LockPoisoned)?;
        conn.execute(
            "UPDATE connection_groups
             SET name = ?1, color = ?2, icon = ?3, sort_order = ?4, is_collapsed = ?5
             WHERE id = ?6",
            params![
                group.name,
                group.color,
                group.icon,
                group.sort_order,
                if group.is_collapsed { 1 } else { 0 },
                group.id
            ],
        )?;
        Ok(group)
    }

    pub fn delete_group(&self, id: &str) -> Result<bool, DbError> {
        let conn = self.conn.lock().map_err(|_| DbError::LockPoisoned)?;
        let affected = conn.execute("DELETE FROM connection_groups WHERE id = ?1", params![id])?;
        Ok(affected > 0)
    }

    // -----------------------------------------------------------------------
    // Tags & Entity Tag Assignments
    // -----------------------------------------------------------------------

    pub fn list_tags(&self) -> Result<Vec<Tag>, DbError> {
        let conn = self.conn.lock().map_err(|_| DbError::LockPoisoned)?;
        let mut stmt = conn.prepare("SELECT id, name, color FROM tags ORDER BY name ASC")?;
        let rows = stmt.query_map([], |row| {
            Ok(Tag {
                id: row.get(0)?,
                name: row.get(1)?,
                color: row.get(2)?,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>().map_err(DbError::from)
    }

    pub fn create_tag(&self, name: String, color: String) -> Result<Tag, DbError> {
        let trimmed = name.trim().to_string();
        if trimmed.is_empty() {
            return Err(DbError::Validation("Tag name cannot be empty".to_string()));
        }
        let id = Uuid::new_v4().to_string();
        let conn = self.conn.lock().map_err(|_| DbError::LockPoisoned)?;
        conn.execute(
            "INSERT INTO tags (id, name, color) VALUES (?1, ?2, ?3)",
            params![id, trimmed, color],
        )?;
        Ok(Tag {
            id,
            name: trimmed,
            color,
        })
    }

    pub fn update_tag(
        &self,
        id: &str,
        name: Option<String>,
        color: Option<String>,
    ) -> Result<Tag, DbError> {
        let conn = self.conn.lock().map_err(|_| DbError::LockPoisoned)?;
        let mut tag: Tag = conn
            .query_row(
                "SELECT id, name, color FROM tags WHERE id = ?1",
                params![id],
                |row| {
                    Ok(Tag {
                        id: row.get(0)?,
                        name: row.get(1)?,
                        color: row.get(2)?,
                    })
                },
            )
            .optional()?
            .ok_or_else(|| DbError::NotFound(format!("Tag '{}' not found", id)))?;

        if let Some(new_name) = name {
            let trimmed = new_name.trim().to_string();
            if trimmed.is_empty() {
                return Err(DbError::Validation("Tag name cannot be empty".to_string()));
            }
            tag.name = trimmed;
        }
        if let Some(new_color) = color {
            tag.color = new_color;
        }
        conn.execute(
            "UPDATE tags SET name = ?1, color = ?2 WHERE id = ?3",
            params![tag.name, tag.color, tag.id],
        )?;
        Ok(tag)
    }

    pub fn delete_tag(&self, id: &str) -> Result<bool, DbError> {
        let conn = self.conn.lock().map_err(|_| DbError::LockPoisoned)?;
        let affected = conn.execute("DELETE FROM tags WHERE id = ?1", params![id])?;
        Ok(affected > 0)
    }

    pub fn set_entity_tags(
        &self,
        entity_type: &str,
        entity_id: &str,
        tag_ids: &[String],
    ) -> Result<Vec<String>, DbError> {
        if entity_type != "instance" && entity_type != "remote_connection" {
            return Err(DbError::Validation(format!(
                "Invalid entity_type '{}'",
                entity_type
            )));
        }
        let mut conn = self.conn.lock().map_err(|_| DbError::LockPoisoned)?;
        let tx = conn.transaction()?;
        replace_entity_tags(&tx, entity_type, entity_id, tag_ids)?;
        tx.commit()?;
        load_single_entity_tags(&conn, entity_type, entity_id)
    }

    // -----------------------------------------------------------------------
    // Instances
    // -----------------------------------------------------------------------

    pub fn list_instances(&self) -> Result<Vec<InstanceRecord>, DbError> {
        let conn = self.conn.lock().map_err(|_| DbError::LockPoisoned)?;
        let mut tag_map = load_entity_tags_map(&conn, "instance")?;
        let mut stmt = conn.prepare(
            "SELECT id, name, description, color, group_id, engine_type, engine_version,
                    host, port, grpc_port, data_dir, config_json, auto_start,
                    idle_timeout_minutes, sort_order, created_at
             FROM instances
             ORDER BY sort_order ASC, created_at ASC",
        )?;
        let rows = stmt.query_map([], |row| {
            let id: String = row.get(0)?;
            Ok(InstanceRecord {
                id,
                name: row.get(1)?,
                description: row.get(2)?,
                color: row.get(3)?,
                group_id: row.get(4)?,
                engine_type: row.get(5)?,
                engine_version: row.get(6)?,
                host: row.get(7)?,
                port: row.get::<_, i64>(8)? as u16,
                grpc_port: row.get::<_, Option<i64>>(9)?.map(|v| v as u16),
                data_dir: row.get(10)?,
                config_json: row.get(11)?,
                auto_start: row.get::<_, i64>(12)? != 0,
                idle_timeout_minutes: row.get(13)?,
                sort_order: row.get(14)?,
                created_at: row.get(15)?,
                tag_ids: Vec::new(),
            })
        })?;

        let mut instances = Vec::new();
        for row in rows {
            let mut inst = row?;
            if let Some(tags) = tag_map.remove(&inst.id) {
                inst.tag_ids = tags;
            }
            instances.push(inst);
        }
        Ok(instances)
    }

    pub fn get_instance(&self, id: &str) -> Result<Option<InstanceRecord>, DbError> {
        let conn = self.conn.lock().map_err(|_| DbError::LockPoisoned)?;
        let opt = conn
            .query_row(
                "SELECT id, name, description, color, group_id, engine_type, engine_version,
                        host, port, grpc_port, data_dir, config_json, auto_start,
                        idle_timeout_minutes, sort_order, created_at
                 FROM instances
                 WHERE id = ?1",
                params![id],
                |row| {
                    Ok(InstanceRecord {
                        id: row.get(0)?,
                        name: row.get(1)?,
                        description: row.get(2)?,
                        color: row.get(3)?,
                        group_id: row.get(4)?,
                        engine_type: row.get(5)?,
                        engine_version: row.get(6)?,
                        host: row.get(7)?,
                        port: row.get::<_, i64>(8)? as u16,
                        grpc_port: row.get::<_, Option<i64>>(9)?.map(|v| v as u16),
                        data_dir: row.get(10)?,
                        config_json: row.get(11)?,
                        auto_start: row.get::<_, i64>(12)? != 0,
                        idle_timeout_minutes: row.get(13)?,
                        sort_order: row.get(14)?,
                        created_at: row.get(15)?,
                        tag_ids: Vec::new(),
                    })
                },
            )
            .optional()?;
        match opt {
            Some(mut inst) => {
                inst.tag_ids = load_single_entity_tags(&conn, "instance", &inst.id)?;
                Ok(Some(inst))
            }
            None => Ok(None),
        }
    }

    pub fn create_instance(&self, payload: CreateInstancePayload) -> Result<InstanceRecord, DbError> {
        let name = payload.name.trim().to_string();
        if name.is_empty() {
            return Err(DbError::Validation("Instance name cannot be empty".to_string()));
        }

        let id = Uuid::new_v4().to_string();
        let created_at = now_unix_secs();
        let host = payload
            .host
            .map(|h| h.trim().to_string())
            .filter(|h| !h.is_empty())
            .unwrap_or_else(|| "127.0.0.1".to_string());
        let data_dir = payload
            .data_dir
            .map(|d| d.trim().to_string())
            .filter(|d| !d.is_empty())
            .unwrap_or_else(|| {
                self.instance_root(&id)
                    .join("data")
                    .to_string_lossy()
                    .into_owned()
            });
        let config_json = payload
            .config_json
            .filter(|c| !c.trim().is_empty())
            .unwrap_or_else(|| "{}".to_string());
        let auto_start = payload.auto_start.unwrap_or(false);
        let idle_timeout_minutes = payload.idle_timeout_minutes.unwrap_or(0).max(0);
        let tag_ids = payload.tag_ids.unwrap_or_default();

        let mut conn = self.conn.lock().map_err(|_| DbError::LockPoisoned)?;
        let next_order: i64 = conn.query_row(
            "SELECT COALESCE(MAX(sort_order) + 1, 0) FROM instances",
            [],
            |row| row.get(0),
        )?;

        let tx = conn.transaction()?;
        tx.execute(
            "INSERT INTO instances (
                id, name, description, color, group_id, engine_type, engine_version,
                host, port, grpc_port, data_dir, config_json, auto_start,
                idle_timeout_minutes, sort_order, created_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)",
            params![
                id,
                name,
                payload.description,
                payload.color,
                payload.group_id,
                payload.engine_type,
                payload.engine_version,
                host,
                payload.port as i64,
                payload.grpc_port.map(|p| p as i64),
                data_dir,
                config_json,
                if auto_start { 1 } else { 0 },
                idle_timeout_minutes,
                next_order,
                created_at
            ],
        )?;
        if !tag_ids.is_empty() {
            replace_entity_tags(&tx, "instance", &id, &tag_ids)?;
        }
        tx.commit()?;

        let resolved_tags = load_single_entity_tags(&conn, "instance", &id)?;

        Ok(InstanceRecord {
            id,
            name,
            description: payload.description,
            color: payload.color,
            group_id: payload.group_id,
            engine_type: payload.engine_type,
            engine_version: payload.engine_version,
            host,
            port: payload.port,
            grpc_port: payload.grpc_port,
            data_dir,
            config_json,
            auto_start,
            idle_timeout_minutes,
            sort_order: next_order,
            created_at,
            tag_ids: resolved_tags,
        })
    }

    pub fn update_instance(
        &self,
        id: &str,
        payload: UpdateInstancePayload,
    ) -> Result<InstanceRecord, DbError> {
        let mut inst = self
            .get_instance(id)?
            .ok_or_else(|| DbError::NotFound(format!("Instance '{}' not found", id)))?;

        if let Some(name) = payload.name {
            let trimmed = name.trim().to_string();
            if trimmed.is_empty() {
                return Err(DbError::Validation("Instance name cannot be empty".to_string()));
            }
            inst.name = trimmed;
        }
        if let Some(description) = payload.description {
            inst.description = description;
        }
        if let Some(color) = payload.color {
            inst.color = color;
        }
        if let Some(group_id) = payload.group_id {
            inst.group_id = group_id;
        }
        if let Some(engine_version) = payload.engine_version {
            inst.engine_version = engine_version;
        }
        if let Some(host) = payload.host {
            let trimmed = host.trim().to_string();
            if !trimmed.is_empty() {
                inst.host = trimmed;
            }
        }
        if let Some(port) = payload.port {
            inst.port = port;
        }
        if let Some(grpc_port) = payload.grpc_port {
            inst.grpc_port = grpc_port;
        }
        if let Some(data_dir) = payload.data_dir {
            let trimmed = data_dir.trim().to_string();
            if !trimmed.is_empty() {
                inst.data_dir = trimmed;
            }
        }
        if let Some(config_json) = payload.config_json {
            inst.config_json = config_json;
        }
        if let Some(auto_start) = payload.auto_start {
            inst.auto_start = auto_start;
        }
        if let Some(idle_timeout_minutes) = payload.idle_timeout_minutes {
            inst.idle_timeout_minutes = idle_timeout_minutes.max(0);
        }
        if let Some(sort_order) = payload.sort_order {
            inst.sort_order = sort_order;
        }

        let mut conn = self.conn.lock().map_err(|_| DbError::LockPoisoned)?;
        let tx = conn.transaction()?;
        tx.execute(
            "UPDATE instances SET
                name = ?1, description = ?2, color = ?3, group_id = ?4, engine_version = ?5,
                host = ?6, port = ?7, grpc_port = ?8, data_dir = ?9, config_json = ?10,
                auto_start = ?11, idle_timeout_minutes = ?12, sort_order = ?13
             WHERE id = ?14",
            params![
                inst.name,
                inst.description,
                inst.color,
                inst.group_id,
                inst.engine_version,
                inst.host,
                inst.port as i64,
                inst.grpc_port.map(|p| p as i64),
                inst.data_dir,
                inst.config_json,
                if inst.auto_start { 1 } else { 0 },
                inst.idle_timeout_minutes,
                inst.sort_order,
                inst.id
            ],
        )?;
        if let Some(tag_ids) = payload.tag_ids {
            replace_entity_tags(&tx, "instance", &inst.id, &tag_ids)?;
        }
        tx.commit()?;

        inst.tag_ids = load_single_entity_tags(&conn, "instance", &inst.id)?;
        Ok(inst)
    }

    pub fn delete_instance(&self, id: &str) -> Result<bool, DbError> {
        let mut conn = self.conn.lock().map_err(|_| DbError::LockPoisoned)?;
        let tx = conn.transaction()?;
        tx.execute(
            "DELETE FROM entity_tags WHERE entity_type = 'instance' AND entity_id = ?1",
            params![id],
        )?;
        let affected = tx.execute("DELETE FROM instances WHERE id = ?1", params![id])?;
        tx.commit()?;
        Ok(affected > 0)
    }

    pub fn list_autostart_instances(&self) -> Result<Vec<InstanceRecord>, DbError> {
        Ok(self
            .list_instances()?
            .into_iter()
            .filter(|i| i.auto_start)
            .collect())
    }

    pub fn list_instances_by_group(&self, group_id: &str) -> Result<Vec<InstanceRecord>, DbError> {
        Ok(self
            .list_instances()?
            .into_iter()
            .filter(|i| i.group_id.as_deref() == Some(group_id))
            .collect())
    }

    pub fn list_instances_using_engine(
        &self,
        engine_type: &str,
        version: &str,
    ) -> Result<Vec<InstanceRecord>, DbError> {
        Ok(self
            .list_instances()?
            .into_iter()
            .filter(|i| i.engine_type == engine_type && i.engine_version == version)
            .collect())
    }

    pub fn reorder_items(&self, items: &[ReorderItem]) -> Result<(), DbError> {
        let mut conn = self.conn.lock().map_err(|_| DbError::LockPoisoned)?;
        let tx = conn.transaction()?;
        for item in items {
            match item.entity_type.as_str() {
                "group" => {
                    tx.execute(
                        "UPDATE connection_groups SET sort_order = ?1 WHERE id = ?2",
                        params![item.sort_order, item.id],
                    )?;
                }
                "instance" => {
                    if let Some(group_id) = &item.group_id {
                        tx.execute(
                            "UPDATE instances SET sort_order = ?1, group_id = ?2 WHERE id = ?3",
                            params![item.sort_order, group_id, item.id],
                        )?;
                    } else {
                        tx.execute(
                            "UPDATE instances SET sort_order = ?1 WHERE id = ?2",
                            params![item.sort_order, item.id],
                        )?;
                    }
                }
                "remote_connection" => {
                    if let Some(group_id) = &item.group_id {
                        tx.execute(
                            "UPDATE remote_connections SET sort_order = ?1, group_id = ?2 WHERE id = ?3",
                            params![item.sort_order, group_id, item.id],
                        )?;
                    } else {
                        tx.execute(
                            "UPDATE remote_connections SET sort_order = ?1 WHERE id = ?2",
                            params![item.sort_order, item.id],
                        )?;
                    }
                }
                other => {
                    return Err(DbError::Validation(format!(
                        "Unsupported reorder entity_type '{}'",
                        other
                    )));
                }
            }
        }
        tx.commit()?;
        Ok(())
    }

    // -----------------------------------------------------------------------
    // Remote Connections (used in Phases 3 & 5)
    // -----------------------------------------------------------------------

    pub fn list_remote_connections(&self) -> Result<Vec<RemoteConnection>, DbError> {
        let conn = self.conn.lock().map_err(|_| DbError::LockPoisoned)?;
        let mut tag_map = load_entity_tags_map(&conn, "remote_connection")?;
        let mut stmt = conn.prepare(
            "SELECT id, name, description, color, group_id, engine_type, endpoint_url,
                    auth_type, secret_ref, extra_json, sort_order, created_at
             FROM remote_connections
             ORDER BY sort_order ASC, created_at ASC",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(RemoteConnection {
                id: row.get(0)?,
                name: row.get(1)?,
                description: row.get(2)?,
                color: row.get(3)?,
                group_id: row.get(4)?,
                engine_type: row.get(5)?,
                endpoint_url: row.get(6)?,
                auth_type: row.get(7)?,
                secret_ref: row.get(8)?,
                extra_json: row.get(9)?,
                sort_order: row.get(10)?,
                created_at: row.get(11)?,
                tag_ids: Vec::new(),
            })
        })?;
        let mut list = Vec::new();
        for row in rows {
            let mut item = row?;
            if let Some(tags) = tag_map.remove(&item.id) {
                item.tag_ids = tags;
            }
            list.push(item);
        }
        Ok(list)
    }

    pub fn get_remote_connection(&self, id: &str) -> Result<Option<RemoteConnection>, DbError> {
        let conn = self.conn.lock().map_err(|_| DbError::LockPoisoned)?;
        let opt = conn
            .query_row(
                "SELECT id, name, description, color, group_id, engine_type, endpoint_url,
                        auth_type, secret_ref, extra_json, sort_order, created_at
                 FROM remote_connections
                 WHERE id = ?1",
                params![id],
                |row| {
                    Ok(RemoteConnection {
                        id: row.get(0)?,
                        name: row.get(1)?,
                        description: row.get(2)?,
                        color: row.get(3)?,
                        group_id: row.get(4)?,
                        engine_type: row.get(5)?,
                        endpoint_url: row.get(6)?,
                        auth_type: row.get(7)?,
                        secret_ref: row.get(8)?,
                        extra_json: row.get(9)?,
                        sort_order: row.get(10)?,
                        created_at: row.get(11)?,
                        tag_ids: Vec::new(),
                    })
                },
            )
            .optional()?;
        match opt {
            Some(mut item) => {
                item.tag_ids = load_single_entity_tags(&conn, "remote_connection", &item.id)?;
                Ok(Some(item))
            }
            None => Ok(None),
        }
    }

    pub fn insert_remote_connection(
        &self,
        id: String,
        payload: CreateRemoteConnectionPayload,
        secret_ref: Option<String>,
    ) -> Result<RemoteConnection, DbError> {
        let name = payload.name.trim().to_string();
        if name.is_empty() {
            return Err(DbError::Validation(
                "Connection name cannot be empty".to_string(),
            ));
        }
        let created_at = now_unix_secs();
        let extra_json = payload
            .extra_json
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| "{}".to_string());
        let tag_ids = payload.tag_ids.unwrap_or_default();

        let mut conn = self.conn.lock().map_err(|_| DbError::LockPoisoned)?;
        let next_order: i64 = conn.query_row(
            "SELECT COALESCE(MAX(sort_order) + 1, 0) FROM remote_connections",
            [],
            |row| row.get(0),
        )?;
        let tx = conn.transaction()?;
        tx.execute(
            "INSERT INTO remote_connections (
                id, name, description, color, group_id, engine_type, endpoint_url,
                auth_type, secret_ref, extra_json, sort_order, created_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
            params![
                id,
                name,
                payload.description,
                payload.color,
                payload.group_id,
                payload.engine_type,
                payload.endpoint_url.trim().to_string(),
                payload.auth_type,
                secret_ref,
                extra_json,
                next_order,
                created_at
            ],
        )?;
        if !tag_ids.is_empty() {
            replace_entity_tags(&tx, "remote_connection", &id, &tag_ids)?;
        }
        tx.commit()?;

        let resolved_tags = load_single_entity_tags(&conn, "remote_connection", &id)?;
        Ok(RemoteConnection {
            id,
            name,
            description: payload.description,
            color: payload.color,
            group_id: payload.group_id,
            engine_type: payload.engine_type,
            endpoint_url: payload.endpoint_url.trim().to_string(),
            auth_type: payload.auth_type,
            secret_ref,
            extra_json,
            sort_order: next_order,
            created_at,
            tag_ids: resolved_tags,
        })
    }

    pub fn update_remote_connection_record(
        &self,
        id: &str,
        payload: UpdateRemoteConnectionPayload,
        new_secret_ref: Option<Option<String>>,
    ) -> Result<RemoteConnection, DbError> {
        let mut item = self
            .get_remote_connection(id)?
            .ok_or_else(|| DbError::NotFound(format!("Remote connection '{}' not found", id)))?;

        if let Some(name) = payload.name {
            let trimmed = name.trim().to_string();
            if trimmed.is_empty() {
                return Err(DbError::Validation(
                    "Connection name cannot be empty".to_string(),
                ));
            }
            item.name = trimmed;
        }
        if let Some(description) = payload.description {
            item.description = description;
        }
        if let Some(color) = payload.color {
            item.color = color;
        }
        if let Some(group_id) = payload.group_id {
            item.group_id = group_id;
        }
        if let Some(engine_type) = payload.engine_type {
            item.engine_type = engine_type;
        }
        if let Some(endpoint_url) = payload.endpoint_url {
            item.endpoint_url = endpoint_url.trim().to_string();
        }
        if let Some(auth_type) = payload.auth_type {
            item.auth_type = auth_type;
        }
        if let Some(sr) = new_secret_ref {
            item.secret_ref = sr;
        }
        if let Some(extra_json) = payload.extra_json {
            item.extra_json = extra_json;
        }
        if let Some(sort_order) = payload.sort_order {
            item.sort_order = sort_order;
        }

        let mut conn = self.conn.lock().map_err(|_| DbError::LockPoisoned)?;
        let tx = conn.transaction()?;
        tx.execute(
            "UPDATE remote_connections SET
                name = ?1, description = ?2, color = ?3, group_id = ?4, engine_type = ?5,
                endpoint_url = ?6, auth_type = ?7, secret_ref = ?8, extra_json = ?9, sort_order = ?10
             WHERE id = ?11",
            params![
                item.name,
                item.description,
                item.color,
                item.group_id,
                item.engine_type,
                item.endpoint_url,
                item.auth_type,
                item.secret_ref,
                item.extra_json,
                item.sort_order,
                item.id
            ],
        )?;
        if let Some(tag_ids) = payload.tag_ids {
            replace_entity_tags(&tx, "remote_connection", &item.id, &tag_ids)?;
        }
        tx.commit()?;
        item.tag_ids = load_single_entity_tags(&conn, "remote_connection", &item.id)?;
        Ok(item)
    }

    pub fn delete_remote_connection(&self, id: &str) -> Result<bool, DbError> {
        let mut conn = self.conn.lock().map_err(|_| DbError::LockPoisoned)?;
        let tx = conn.transaction()?;
        tx.execute(
            "DELETE FROM entity_tags WHERE entity_type = 'remote_connection' AND entity_id = ?1",
            params![id],
        )?;
        let affected = tx.execute("DELETE FROM remote_connections WHERE id = ?1", params![id])?;
        tx.commit()?;
        Ok(affected > 0)
    }

    // -----------------------------------------------------------------------
    // Embedding Profiles (used in Phases 3 & 4)
    // -----------------------------------------------------------------------

    pub fn list_embedding_profiles(&self) -> Result<Vec<EmbeddingProfile>, DbError> {
        let conn = self.conn.lock().map_err(|_| DbError::LockPoisoned)?;
        let mut stmt = conn.prepare(
            "SELECT id, name, provider, model_name, base_url, dimensions, secret_ref
             FROM embedding_profiles
             ORDER BY name ASC",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(EmbeddingProfile {
                id: row.get(0)?,
                name: row.get(1)?,
                provider: row.get(2)?,
                model_name: row.get(3)?,
                base_url: row.get(4)?,
                dimensions: row.get(5)?,
                secret_ref: row.get(6)?,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>().map_err(DbError::from)
    }

    pub fn get_embedding_profile(&self, id: &str) -> Result<Option<EmbeddingProfile>, DbError> {
        let conn = self.conn.lock().map_err(|_| DbError::LockPoisoned)?;
        conn.query_row(
            "SELECT id, name, provider, model_name, base_url, dimensions, secret_ref
             FROM embedding_profiles
             WHERE id = ?1",
            params![id],
            |row| {
                Ok(EmbeddingProfile {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    provider: row.get(2)?,
                    model_name: row.get(3)?,
                    base_url: row.get(4)?,
                    dimensions: row.get(5)?,
                    secret_ref: row.get(6)?,
                })
            },
        )
        .optional()
        .map_err(DbError::from)
    }

    pub fn insert_embedding_profile(
        &self,
        id: String,
        payload: CreateEmbeddingProfilePayload,
        secret_ref: Option<String>,
    ) -> Result<EmbeddingProfile, DbError> {
        let name = payload.name.trim().to_string();
        if name.is_empty() {
            return Err(DbError::Validation("Profile name cannot be empty".to_string()));
        }
        let conn = self.conn.lock().map_err(|_| DbError::LockPoisoned)?;
        conn.execute(
            "INSERT INTO embedding_profiles (id, name, provider, model_name, base_url, dimensions, secret_ref)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                id,
                name,
                payload.provider,
                payload.model_name.trim().to_string(),
                payload.base_url,
                payload.dimensions,
                secret_ref
            ],
        )?;
        Ok(EmbeddingProfile {
            id,
            name,
            provider: payload.provider,
            model_name: payload.model_name.trim().to_string(),
            base_url: payload.base_url,
            dimensions: payload.dimensions,
            secret_ref,
        })
    }

    pub fn update_embedding_profile_record(
        &self,
        id: &str,
        payload: UpdateEmbeddingProfilePayload,
        new_secret_ref: Option<Option<String>>,
    ) -> Result<EmbeddingProfile, DbError> {
        let mut profile = self
            .get_embedding_profile(id)?
            .ok_or_else(|| DbError::NotFound(format!("Embedding profile '{}' not found", id)))?;

        if let Some(name) = payload.name {
            let trimmed = name.trim().to_string();
            if trimmed.is_empty() {
                return Err(DbError::Validation("Profile name cannot be empty".to_string()));
            }
            profile.name = trimmed;
        }
        if let Some(provider) = payload.provider {
            profile.provider = provider;
        }
        if let Some(model_name) = payload.model_name {
            profile.model_name = model_name.trim().to_string();
        }
        if let Some(base_url) = payload.base_url {
            profile.base_url = base_url;
        }
        if let Some(dimensions) = payload.dimensions {
            profile.dimensions = dimensions;
        }
        if let Some(sr) = new_secret_ref {
            profile.secret_ref = sr;
        }

        let conn = self.conn.lock().map_err(|_| DbError::LockPoisoned)?;
        conn.execute(
            "UPDATE embedding_profiles
             SET name = ?1, provider = ?2, model_name = ?3, base_url = ?4, dimensions = ?5, secret_ref = ?6
             WHERE id = ?7",
            params![
                profile.name,
                profile.provider,
                profile.model_name,
                profile.base_url,
                profile.dimensions,
                profile.secret_ref,
                profile.id
            ],
        )?;
        Ok(profile)
    }

    pub fn delete_embedding_profile(&self, id: &str) -> Result<bool, DbError> {
        let conn = self.conn.lock().map_err(|_| DbError::LockPoisoned)?;
        let affected = conn.execute("DELETE FROM embedding_profiles WHERE id = ?1", params![id])?;
        Ok(affected > 0)
    }
}
