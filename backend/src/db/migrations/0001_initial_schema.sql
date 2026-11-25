CREATE TABLE installed_engines (
    id TEXT PRIMARY KEY,              -- e.g. 'qdrant-1.20.2'
    engine_type TEXT NOT NULL,        -- 'qdrant' | 'chroma' | 'pgvector' | 'lancedb'
    version TEXT NOT NULL,
    target_triple TEXT NOT NULL,      -- e.g. 'x86_64-pc-windows-msvc'
    binary_path TEXT NOT NULL,
    sha256 TEXT NOT NULL,
    installed_at INTEGER NOT NULL
);

CREATE TABLE connection_groups (
    id TEXT PRIMARY KEY,              -- UUID
    name TEXT NOT NULL UNIQUE,        -- e.g. 'Work RAG', 'Local Experiments'
    color TEXT,                       -- Hex swatch e.g. '#14B8A6'
    icon TEXT,                        -- Lucide icon name
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_collapsed INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
);

CREATE TABLE tags (
    id TEXT PRIMARY KEY,              -- UUID
    name TEXT NOT NULL UNIQUE,        -- e.g. 'dev', 'prod', 'local', 'openai-1536'
    color TEXT NOT NULL DEFAULT '#14B8A6'
);

CREATE TABLE instances (
    id TEXT PRIMARY KEY,              -- UUID
    name TEXT NOT NULL UNIQUE,        -- Custom display name e.g. 'Local Qdrant Dev'
    description TEXT,
    color TEXT,                       -- Optional badge color
    group_id TEXT REFERENCES connection_groups(id) ON DELETE SET NULL,
    engine_type TEXT NOT NULL,
    engine_version TEXT NOT NULL,
    host TEXT NOT NULL DEFAULT '127.0.0.1',
    port INTEGER NOT NULL,
    grpc_port INTEGER,                -- Optional (e.g. Qdrant 6334)
    data_dir TEXT NOT NULL,
    config_json TEXT NOT NULL,        -- Engine-specific overrides
    auto_start INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
);

CREATE TABLE remote_connections (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,               -- Custom display name e.g. 'Prod Pinecone US-East'
    description TEXT,
    color TEXT,                       -- e.g. '#F43F5E' for production warning
    group_id TEXT REFERENCES connection_groups(id) ON DELETE SET NULL,
    engine_type TEXT NOT NULL,        -- 'qdrant' | 'chroma' | 'pgvector' | 'pinecone' | 'weaviate' | 'milvus'
    endpoint_url TEXT NOT NULL,
    auth_type TEXT NOT NULL,          -- 'none' | 'api_key' | 'basic'
    secret_ref TEXT,                  -- Key stored in OS keyring (never plaintext)
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
);

CREATE TABLE entity_tags (
    entity_type TEXT NOT NULL,        -- 'instance' | 'remote_connection'
    entity_id TEXT NOT NULL,
    tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (entity_type, entity_id, tag_id)
);

CREATE TABLE embedding_profiles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    provider TEXT NOT NULL,           -- 'ollama' | 'openai_compatible' | 'local_onnx'
    model_name TEXT NOT NULL,
    base_url TEXT,
    dimensions INTEGER,
    secret_ref TEXT
);
