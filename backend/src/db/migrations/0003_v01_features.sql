ALTER TABLE remote_connections ADD COLUMN read_only INTEGER NOT NULL DEFAULT 0;

CREATE TABLE search_history (
    id TEXT PRIMARY KEY,
    connection_key TEXT NOT NULL,
    collection TEXT NOT NULL,
    search_mode TEXT NOT NULL,           -- 'text' | 'vector'
    query_text TEXT,
    vector_json TEXT,
    embedding_profile_id TEXT,
    top_k INTEGER NOT NULL DEFAULT 10,
    score_threshold REAL,
    filter_json TEXT,
    result_count INTEGER NOT NULL DEFAULT 0,
    latency_ms INTEGER,
    created_at INTEGER NOT NULL
);
CREATE INDEX idx_search_history_lookup
    ON search_history(connection_key, collection, created_at DESC);

CREATE TABLE search_presets (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    connection_key TEXT NOT NULL,
    collection TEXT NOT NULL,
    search_mode TEXT NOT NULL,
    query_text TEXT,
    vector_json TEXT,
    embedding_profile_id TEXT,
    top_k INTEGER NOT NULL DEFAULT 10,
    score_threshold REAL,
    filter_json TEXT,
    created_at INTEGER NOT NULL
);
