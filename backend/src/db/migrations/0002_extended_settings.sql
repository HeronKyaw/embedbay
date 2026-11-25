ALTER TABLE instances ADD COLUMN idle_timeout_minutes INTEGER NOT NULL DEFAULT 0;
ALTER TABLE remote_connections ADD COLUMN extra_json TEXT NOT NULL DEFAULT '{}';
