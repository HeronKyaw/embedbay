import type { FilterSpec } from "@/types/explorer";

export type SnippetLang = "python" | "typescript" | "curl" | "sql";

export interface CodeSnippet {
  id: SnippetLang;
  label: string;
  code: string;
}

export interface ConnectionSnippetContext {
  name: string;
  engineType: string;
  host?: string;
  port?: number;
  endpointUrl?: string;
  dataDir?: string;
  hasAuth?: boolean;
}

export interface SearchSnippetContext extends ConnectionSnippetContext {
  collection: string;
  topK: number;
  scoreThreshold?: number | null;
  filter?: FilterSpec | null;
  queryVector?: number[];
  queryText?: string;
}

function resolveBaseUrl(ctx: ConnectionSnippetContext): string {
  if (ctx.endpointUrl?.trim()) {
    return ctx.endpointUrl.trim().replace(/\/+$/, "");
  }
  const host = ctx.host?.trim() || "127.0.0.1";
  const connectHost = host === "0.0.0.0" ? "127.0.0.1" : host;
  if (ctx.port) {
    if (ctx.engineType === "pgvector") {
      return `postgresql://postgres@${connectHost}:${ctx.port}/postgres`;
    }
    if (ctx.engineType === "mariadb") {
      return `mysql://root@${connectHost}:${ctx.port}/embedbay`;
    }
    if (ctx.engineType === "redis_stack" || ctx.engineType === "redis") {
      return `redis://${connectHost}:${ctx.port}`;
    }
    return `http://${connectHost}:${ctx.port}`;
  }
  return "http://127.0.0.1:6333";
}

function formatVectorLiteral(vec?: number[]): string {
  if (!vec || vec.length === 0) {
    return "[0.1, 0.2, 0.3]";
  }
  if (vec.length <= 8) {
    return JSON.stringify(vec.map((n) => Number(n.toFixed(6))));
  }
  const head = vec.slice(0, 6).map((n) => Number(n.toFixed(6)));
  return `[${head.join(", ")}]  # ... (${vec.length} dims total)`;
}

function formatVectorJson(vec?: number[]): string {
  if (!vec || vec.length === 0) {
    return "[0.1, 0.2, 0.3]";
  }
  return JSON.stringify(vec.map((n) => Number(n.toFixed(6))));
}

function buildFilterObj(filter?: FilterSpec | null): unknown | null {
  if (!filter) return null;
  if (filter.mode === "raw_json") {
    return filter.json ?? null;
  }
  if (filter.conditions.length === 0) return null;
  const clauses = filter.conditions
    .filter((c) => c.field.trim().length > 0)
    .map((c) => {
      if (c.op === "eq") return { key: c.field, match: { value: c.value } };
      if (c.op === "neq")
        return { must_not: [{ key: c.field, match: { value: c.value } }] };
      if (c.op === "in") return { key: c.field, match: { any: c.value } };
      if (c.op === "contains")
        return { key: c.field, match: { text: String(c.value ?? "") } };
      return { key: c.field, range: { [c.op]: c.value } };
    });
  if (clauses.length === 0) return null;
  return filter.logic === "or" ? { should: clauses } : { must: clauses };
}

export function generateConnectionSnippets(
  ctx: ConnectionSnippetContext,
): CodeSnippet[] {
  const url = resolveBaseUrl(ctx);
  const engine = ctx.engineType.toLowerCase();
  const authNote = ctx.hasAuth;

  if (engine === "pgvector") {
    const dsn = url.startsWith("postgres")
      ? url
      : `postgresql://postgres@127.0.0.1:${ctx.port ?? 5432}/postgres`;
    return [
      {
        id: "python",
        label: "Python",
        code: `import os
import psycopg

dsn = os.environ.get("PGVECTOR_URL", "${dsn}")
with psycopg.connect(dsn) as conn:
    with conn.cursor() as cur:
        cur.execute("SELECT tablename FROM pg_tables WHERE schemaname = 'public';")
        print(cur.fetchall())`,
      },
      {
        id: "typescript",
        label: "TypeScript",
        code: `import { Client } from "pg";

const client = new Client({
  connectionString: process.env.PGVECTOR_URL ?? "${dsn}",
});

await client.connect();
const res = await client.query(
  "SELECT tablename FROM pg_tables WHERE schemaname = 'public';",
);
console.log(res.rows);
await client.end();`,
      },
      {
        id: "sql",
        label: "psql / SQL",
        code: `# Connect with psql
psql "${dsn}"

-- List vector tables
SELECT c.relname AS table_name, format_type(a.atttypid, a.atttypmod) AS vector_type
FROM pg_class c
JOIN pg_attribute a ON a.attrelid = c.oid
JOIN pg_type t ON t.oid = a.atttypid
WHERE t.typname = 'vector' AND a.attnum > 0;`,
      },
    ];
  }

  if (engine === "lancedb") {
    const dir = ctx.dataDir || "./data/lancedb";
    return [
      {
        id: "python",
        label: "Python",
        code: `import lancedb

db = lancedb.connect(r"${dir}")
print(db.table_names())`,
      },
      {
        id: "typescript",
        label: "TypeScript",
        code: `import * as lancedb from "@lancedb/lancedb";

const db = await lancedb.connect("${dir.replace(/\\/g, "/")}");
console.log(await db.tableNames());`,
      },
    ];
  }

  if (engine === "chroma") {
    const parsed = (() => {
      try {
        const u = new URL(url);
        return { host: u.hostname, port: u.port || (u.protocol === "https:" ? "443" : "8000") };
      } catch {
        return { host: "127.0.0.1", port: String(ctx.port ?? 8000) };
      }
    })();
    return [
      {
        id: "python",
        label: "Python",
        code: `import os
import chromadb

client = chromadb.HttpClient(
    host="${parsed.host}",
    port=${parsed.port},${authNote ? '\n    headers={"Authorization": f"Bearer {os.environ[\'CHROMA_API_KEY\']}"},' : ""}
)
print(client.list_collections())`,
      },
      {
        id: "typescript",
        label: "TypeScript",
        code: `import { ChromaClient } from "chromadb";

const client = new ChromaClient({
  path: "${url}",${authNote ? '\n  auth: { provider: "token", credentials: process.env.CHROMA_API_KEY ?? "<YOUR_API_KEY>" },' : ""}
});

console.log(await client.listCollections());`,
      },
      {
        id: "curl",
        label: "cURL",
        code: `curl -s "${url}/api/v2/tenants/default_tenant/databases/default_database/collections"${authNote ? ' \\\n  -H "Authorization: Bearer <YOUR_API_KEY>"' : ""}`,
      },
    ];
  }

  if (engine === "pinecone") {
    return [
      {
        id: "python",
        label: "Python",
        code: `import os
from pinecone import Pinecone

pc = Pinecone(api_key=os.environ.get("PINECONE_API_KEY", "<YOUR_API_KEY>"))
index = pc.Index(host="${url}")
print(index.describe_index_stats())`,
      },
      {
        id: "typescript",
        label: "TypeScript",
        code: `import { Pinecone } from "@pinecone-database/pinecone";

const pc = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY ?? "<YOUR_API_KEY>",
});
const index = pc.index("<INDEX_NAME>", "${url}");
console.log(await index.describeIndexStats());`,
      },
      {
        id: "curl",
        label: "cURL",
        code: `curl -s -X POST "${url}/describe_index_stats" \\
  -H "Api-Key: <YOUR_API_KEY>" \\
  -H "Content-Type: application/json" \\
  -d '{}'`,
      },
    ];
  }

  if (engine === "weaviate") {
    return [
      {
        id: "python",
        label: "Python",
        code: `import os
import weaviate
from weaviate.classes.init import Auth

client = weaviate.connect_to_custom(
    http_host="${url.replace(/^https?:\/\//, "")}",
    http_port=${url.startsWith("https://") ? 443 : 8080},
    http_secure=${url.startsWith("https://") ? "True" : "False"},${authNote ? '\n    auth_credentials=Auth.api_key(os.environ.get("WEAVIATE_API_KEY", "<YOUR_API_KEY>")),' : ""}
)
print(client.collections.list_all())`,
      },
      {
        id: "typescript",
        label: "TypeScript",
        code: `import weaviate from "weaviate-client";

const client = await weaviate.connectToCustom({
  httpHost: "${url.replace(/^https?:\/\//, "")}",
  httpPort: ${url.startsWith("https://") ? 443 : 8080},
  httpSecure: ${url.startsWith("https://")},${authNote ? '\n  authCredentials: new weaviate.ApiKey(process.env.WEAVIATE_API_KEY ?? "<YOUR_API_KEY>"),' : ""}
});
console.log(await client.collections.listAll());`,
      },
      {
        id: "curl",
        label: "cURL",
        code: `curl -s "${url}/v1/schema"${authNote ? ' \\\n  -H "Authorization: Bearer <YOUR_API_KEY>"' : ""}`,
      },
    ];
  }

  if (engine === "milvus") {
    return [
      {
        id: "python",
        label: "Python",
        code: `import os
from pymilvus import MilvusClient

client = MilvusClient(
    uri="${url}",${authNote ? '\n    token=os.environ.get("MILVUS_TOKEN", "<YOUR_API_KEY>"),' : ""}
)
print(client.list_collections())`,
      },
      {
        id: "typescript",
        label: "TypeScript",
        code: `import { MilvusClient } from "@zilliz/milvus2-sdk-node";

const client = new MilvusClient({
  address: "${url}",${authNote ? '\n  token: process.env.MILVUS_TOKEN ?? "<YOUR_API_KEY>",' : ""}
});
console.log(await client.listCollections());`,
      },
      {
        id: "curl",
        label: "cURL",
        code: `curl -s -X POST "${url}/v2/vectordb/collections/list" \\${authNote ? '\n  -H "Authorization: Bearer <YOUR_API_KEY>" \\' : ""}
  -H "Content-Type: application/json" \\
  -d '{}'`,
      },
    ];
  }

  if (engine === "elasticsearch") {
    return [
      {
        id: "python",
        label: "Python",
        code: `import os
from elasticsearch import Elasticsearch

es = Elasticsearch(
    "${url}",${authNote ? '\n    api_key=os.environ.get("ELASTIC_API_KEY", "<YOUR_API_KEY>"),' : ""}
)
print(es.info())`,
      },
      {
        id: "typescript",
        label: "TypeScript",
        code: `import { Client } from "@elastic/elasticsearch";

const client = new Client({
  node: "${url}",${authNote ? '\n  auth: { apiKey: process.env.ELASTIC_API_KEY ?? "<YOUR_API_KEY>" },' : ""}
});
console.log(await client.info());`,
      },
      {
        id: "curl",
        label: "cURL",
        code: `curl -s "${url}/_cat/indices?format=json"${authNote ? ' \\\n  -H "Authorization: ApiKey <YOUR_API_KEY>"' : ""}`,
      },
    ];
  }

  if (engine === "redis_stack" || engine === "redis") {
    return [
      {
        id: "python",
        label: "Python",
        code: `import os
import redis

r = redis.from_url(os.environ.get("REDIS_URL", "${url}"))
print(r.execute_command("FT._LIST"))`,
      },
      {
        id: "typescript",
        label: "TypeScript",
        code: `import { createClient } from "redis";

const client = createClient({
  url: process.env.REDIS_URL ?? "${url}",
});
await client.connect();
console.log(await client.sendCommand(["FT._LIST"]));`,
      },
      {
        id: "curl",
        label: "redis-cli",
        code: `redis-cli -u "${url}" FT._LIST`,
      },
    ];
  }

  if (engine === "meilisearch") {
    return [
      {
        id: "python",
        label: "Python",
        code: `import os
import meilisearch

client = meilisearch.Client(
    "${url}",${authNote ? '\n    os.environ.get("MEILI_MASTER_KEY", "<YOUR_MASTER_KEY>"),' : ""}
)
print(client.get_indexes())`,
      },
      {
        id: "typescript",
        label: "TypeScript",
        code: `import { MeiliSearch } from "meilisearch";

const client = new MeiliSearch({
  host: "${url}",${authNote ? '\n  apiKey: process.env.MEILI_MASTER_KEY ?? "<YOUR_MASTER_KEY>",' : ""}
});
console.log(await client.getIndexes());`,
      },
      {
        id: "curl",
        label: "cURL",
        code: `curl -s "${url}/indexes"${authNote ? ' \\\n  -H "Authorization: Bearer <YOUR_MASTER_KEY>"' : ""}`,
      },
    ];
  }

  if (engine === "surrealdb") {
    return [
      {
        id: "python",
        label: "Python",
        code: `from surrealdb import Surreal

with Surreal("${url.replace(/^http/, "ws")}/rpc") as db:
    db.signin({"username": "root", "password": "root"})
    db.use("embedbay", "default")
    print(db.query("INFO FOR DB;"))`,
      },
      {
        id: "typescript",
        label: "TypeScript",
        code: `import Surreal from "surrealdb";

const db = new Surreal();
await db.connect("${url}/rpc");
await db.signin({ username: "root", password: "root" });
await db.use({ namespace: "embedbay", database: "default" });
console.log(await db.query("INFO FOR DB;"));`,
      },
      {
        id: "curl",
        label: "cURL",
        code: `curl -s -X POST "${url}/sql" \\
  -u root:root \\
  -H "Accept: application/json" \\
  -H "surreal-ns: embedbay" \\
  -H "surreal-db: default" \\
  -d "INFO FOR DB;"`,
      },
    ];
  }

  if (engine === "sqlite_vec") {
    const dbFile = `${(ctx.dataDir || "./data/sqlite_vec").replace(/[\\/]+$/, "")}/vectors.db`;
    return [
      {
        id: "python",
        label: "Python",
        code: `import sqlite3
import sqlite_vec

db = sqlite3.connect(r"${dbFile}")
db.enable_load_extension(True)
sqlite_vec.load(db)
print(db.execute("SELECT name FROM _embedbay_collections;").fetchall())`,
      },
      {
        id: "typescript",
        label: "TypeScript",
        code: `import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";

const db = new Database("${dbFile.replace(/\\/g, "/")}");
sqliteVec.load(db);
console.log(db.prepare("SELECT name FROM _embedbay_collections;").all());`,
      },
    ];
  }

  if (engine === "opensearch") {
    return [
      {
        id: "python",
        label: "Python",
        code: `from opensearchpy import OpenSearch

client = OpenSearch(hosts=["${url}"])
print(client.info())`,
      },
      {
        id: "typescript",
        label: "TypeScript",
        code: `import { Client } from "@opensearch-project/opensearch";

const client = new Client({ node: "${url}" });
console.log(await client.info());`,
      },
      {
        id: "curl",
        label: "cURL",
        code: `curl -s "${url}/_cat/indices?format=json"${authNote ? ' \\\n  -H "Authorization: Bearer <YOUR_API_KEY>"' : ""}`,
      },
    ];
  }

  if (engine === "mariadb") {
    const dsn = url.startsWith("mysql")
      ? url
      : `mysql://root@127.0.0.1:${ctx.port ?? 3306}/embedbay`;
    return [
      {
        id: "python",
        label: "Python",
        code: `import os
import mariadb

# pip install mariadb
conn = mariadb.connect(host="127.0.0.1", port=${ctx.port ?? 3306}, user="root", database="embedbay")
cur = conn.cursor()
cur.execute("SHOW TABLES;")
print(cur.fetchall())`,
      },
      {
        id: "typescript",
        label: "TypeScript",
        code: `import mariadb from "mariadb";

const conn = await mariadb.createConnection(process.env.MARIADB_URL ?? "${dsn}");
console.log(await conn.query("SHOW TABLES;"));
await conn.end();`,
      },
      {
        id: "sql",
        label: "SQL",
        code: `-- Connect via mariadb CLI
mariadb -h 127.0.0.1 -P ${ctx.port ?? 3306} -u root embedbay

SELECT TABLE_NAME, COLUMN_TYPE
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = 'embedbay' AND DATA_TYPE = 'vector';`,
      },
    ];
  }

  if (engine === "duckdb") {
    const dbFile = `${(ctx.dataDir || "./data/duckdb").replace(/[\\/]+$/, "")}/vectors.duckdb`;
    return [
      {
        id: "python",
        label: "Python",
        code: `import duckdb

con = duckdb.connect(r"${dbFile}")
print(con.execute("SELECT name, dimensions, distance_metric FROM _embedbay_collections;").fetchall())`,
      },
      {
        id: "typescript",
        label: "TypeScript",
        code: `import { DuckDBInstance } from "@duckdb/node-api";

const instance = await DuckDBInstance.create("${dbFile.replace(/\\/g, "/")}");
const conn = await instance.connect();
console.log(await (await conn.run("SELECT * FROM _embedbay_collections;")).getRowObjects());`,
      },
      {
        id: "sql",
        label: "SQL",
        code: `-- Open in DuckDB CLI
-- duckdb "${dbFile}"
SELECT name, dimensions, distance_metric FROM _embedbay_collections;`,
      },
    ];
  }

  // Default: Qdrant
  return [
    {
      id: "python",
      label: "Python",
      code: `import os
from qdrant_client import QdrantClient

client = QdrantClient(
    url="${url}",${authNote ? '\n    api_key=os.environ.get("QDRANT_API_KEY", "<YOUR_API_KEY>"),' : ""}
)
print(client.get_collections())`,
    },
    {
      id: "typescript",
      label: "TypeScript",
      code: `import { QdrantClient } from "@qdrant/js-client-rest";

const client = new QdrantClient({
  url: "${url}",${authNote ? '\n  apiKey: process.env.QDRANT_API_KEY ?? "<YOUR_API_KEY>",' : ""}
});

console.log(await client.getCollections());`,
    },
    {
      id: "curl",
      label: "cURL",
      code: `curl -s "${url}/collections"${authNote ? ' \\\n  -H "api-key: <YOUR_API_KEY>"' : ""}`,
    },
  ];
}

export function generateSearchSnippets(
  ctx: SearchSnippetContext,
): CodeSnippet[] {
  const url = resolveBaseUrl(ctx);
  const engine = ctx.engineType.toLowerCase();
  const authNote = ctx.hasAuth;
  const vecPy = formatVectorLiteral(ctx.queryVector);
  const vecJson = formatVectorJson(ctx.queryVector);
  const filterObj = buildFilterObj(ctx.filter);
  const filterJson = filterObj ? JSON.stringify(filterObj, null, 2) : null;
  const queryComment = ctx.queryText?.trim()
    ? `# Query text: ${JSON.stringify(ctx.queryText.trim())}\n`
    : "";
  const tsQueryComment = ctx.queryText?.trim()
    ? `// Query text: ${JSON.stringify(ctx.queryText.trim())}\n`
    : "";

  if (engine === "pgvector") {
    const dsn = url.startsWith("postgres")
      ? url
      : `postgresql://postgres@127.0.0.1:${ctx.port ?? 5432}/postgres`;
    const vecLit = `[${(ctx.queryVector && ctx.queryVector.length > 0 ? ctx.queryVector.slice(0, 6) : [0.1, 0.2, 0.3]).join(",")}]`;
    return [
      {
        id: "python",
        label: "Python",
        code: `${queryComment}import os
import psycopg

dsn = os.environ.get("PGVECTOR_URL", "${dsn}")
query_vector = ${vecPy}

with psycopg.connect(dsn) as conn:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, metadata, document, 1 - (embedding <=> %s::vector) AS score
            FROM "${ctx.collection}"
            ORDER BY embedding <=> %s::vector ASC
            LIMIT %s
            """,
            (str(query_vector), str(query_vector), ${ctx.topK}),
        )
        print(cur.fetchall())`,
      },
      {
        id: "typescript",
        label: "TypeScript",
        code: `${tsQueryComment}import { Client } from "pg";

const client = new Client({
  connectionString: process.env.PGVECTOR_URL ?? "${dsn}",
});
await client.connect();

const queryVector = ${vecJson};
const res = await client.query(
  \`SELECT id, metadata, document, 1 - (embedding <=> $1::vector) AS score
   FROM "${ctx.collection}"
   ORDER BY embedding <=> $1::vector ASC
   LIMIT $2\`,
  [JSON.stringify(queryVector), ${ctx.topK}],
);
console.log(res.rows);
await client.end();`,
      },
      {
        id: "sql",
        label: "psql / SQL",
        code: `-- Search "${ctx.collection}" via cosine distance
SELECT id, metadata, document,
       1 - (embedding <=> '${vecLit}'::vector) AS score
FROM "${ctx.collection}"
ORDER BY embedding <=> '${vecLit}'::vector ASC
LIMIT ${ctx.topK};`,
      },
    ];
  }

  if (engine === "chroma") {
    return [
      {
        id: "python",
        label: "Python",
        code: `${queryComment}import os
import chromadb

client = chromadb.HttpClient(host="${url.replace(/^https?:\/\//, "").split(":")[0]}", port=${ctx.port ?? 8000})
collection = client.get_collection("${ctx.collection}")
results = collection.query(
    query_embeddings=[${vecPy}],
    n_results=${ctx.topK},${filterJson ? `\n    where=${filterJson},` : ""}
)
print(results)`,
      },
      {
        id: "typescript",
        label: "TypeScript",
        code: `${tsQueryComment}import { ChromaClient } from "chromadb";

const client = new ChromaClient({ path: "${url}" });
const collection = await client.getCollection({ name: "${ctx.collection}" });
const results = await collection.query({
  queryEmbeddings: [${vecJson}],
  nResults: ${ctx.topK},${filterJson ? `\n  where: ${filterJson},` : ""}
});
console.log(results);`,
      },
      {
        id: "curl",
        label: "cURL",
        code: `curl -s -X POST "${url}/api/v2/tenants/default_tenant/databases/default_database/collections/${ctx.collection}/query" \\${authNote ? '\n  -H "Authorization: Bearer <YOUR_API_KEY>" \\' : ""}
  -H "Content-Type: application/json" \\
  -d '{
    "query_embeddings": [${vecJson}],
    "n_results": ${ctx.topK}
  }'`,
      },
    ];
  }

  if (engine === "lancedb") {
    const dir = ctx.dataDir || "./data/lancedb";
    return [
      {
        id: "python",
        label: "Python",
        code: `${queryComment}import lancedb

db = lancedb.connect(r"${dir}")
table = db.open_table("${ctx.collection}")
results = table.search(${vecPy}).limit(${ctx.topK}).to_list()
print(results)`,
      },
      {
        id: "typescript",
        label: "TypeScript",
        code: `${tsQueryComment}import * as lancedb from "@lancedb/lancedb";

const db = await lancedb.connect("${dir.replace(/\\/g, "/")}");
const table = await db.openTable("${ctx.collection}");
const results = await table.vectorSearch(${vecJson}).limit(${ctx.topK}).toArray();
console.log(results);`,
      },
    ];
  }

  if (engine === "meilisearch") {
    return [
      {
        id: "python",
        label: "Python",
        code: `${queryComment}import meilisearch

client = meilisearch.Client("${url}")
res = client.index("${ctx.collection}").search(
    "",
    {"vector": ${vecPy}, "hybrid": {"embedder": "default", "semanticRatio": 1.0}, "limit": ${ctx.topK}},
)
print(res["hits"])`,
      },
      {
        id: "typescript",
        label: "TypeScript",
        code: `${tsQueryComment}import { MeiliSearch } from "meilisearch";

const client = new MeiliSearch({ host: "${url}" });
const res = await client.index("${ctx.collection}").search("", {
  vector: ${vecJson},
  hybrid: { embedder: "default", semanticRatio: 1.0 },
  limit: ${ctx.topK},
});
console.log(res.hits);`,
      },
      {
        id: "curl",
        label: "cURL",
        code: `curl -s -X POST "${url}/indexes/${ctx.collection}/search" \\
  -H "Content-Type: application/json" \\
  -d '{"vector": ${vecJson}, "hybrid": {"embedder": "default", "semanticRatio": 1.0}, "limit": ${ctx.topK}}'`,
      },
    ];
  }

  if (engine === "surrealdb") {
    return [
      {
        id: "python",
        label: "Python",
        code: `${queryComment}from surrealdb import Surreal

with Surreal("${url.replace(/^http/, "ws")}/rpc") as db:
    db.signin({"username": "root", "password": "root"})
    db.use("embedbay", "default")
    res = db.query(
        "SELECT id, payload, document, vector::distance::knn() AS dist FROM ${ctx.collection} WHERE vector <|${ctx.topK},40|> $vec ORDER BY dist ASC;",
        {"vec": ${vecPy}},
    )
    print(res)`,
      },
      {
        id: "typescript",
        label: "TypeScript",
        code: `${tsQueryComment}import Surreal from "surrealdb";

const db = new Surreal();
await db.connect("${url}/rpc");
await db.signin({ username: "root", password: "root" });
await db.use({ namespace: "embedbay", database: "default" });
const res = await db.query(
  "SELECT id, payload, document, vector::distance::knn() AS dist FROM ${ctx.collection} WHERE vector <|${ctx.topK},40|> $vec ORDER BY dist ASC;",
  { vec: ${vecJson} },
);
console.log(res);`,
      },
      {
        id: "sql",
        label: "SurrealQL",
        code: `SELECT id, payload, document, vector::distance::knn() AS dist
FROM ${ctx.collection}
WHERE vector <|${ctx.topK},40|> ${vecJson}
ORDER BY dist ASC;`,
      },
    ];
  }

  if (engine === "sqlite_vec") {
    const dbFile = `${(ctx.dataDir || "./data/sqlite_vec").replace(/[\\/]+$/, "")}/vectors.db`;
    return [
      {
        id: "python",
        label: "Python",
        code: `${queryComment}import sqlite3, struct
import sqlite_vec

q_vec = ${vecPy}
q_blob = struct.pack(f"{len(q_vec)}f", *q_vec)
db = sqlite3.connect(r"${dbFile}")
db.enable_load_extension(True)
sqlite_vec.load(db)
rows = db.execute(
    """
    SELECT m.id, m.document, m.payload, v.distance
    FROM "vec_${ctx.collection}" v
    JOIN "meta_${ctx.collection}" m ON m.rowid = v.rowid
    WHERE v.embedding MATCH ? AND k = ?
    ORDER BY v.distance ASC
    """,
    (q_blob, ${ctx.topK}),
).fetchall()
print(rows)`,
      },
      {
        id: "typescript",
        label: "TypeScript",
        code: `${tsQueryComment}import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";

const db = new Database("${dbFile.replace(/\\/g, "/")}");
sqliteVec.load(db);
const qVec = new Float32Array(${vecJson});
const rows = db.prepare(\`
  SELECT m.id, m.document, m.payload, v.distance
  FROM "vec_${ctx.collection}" v
  JOIN "meta_${ctx.collection}" m ON m.rowid = v.rowid
  WHERE v.embedding MATCH ? AND k = ?
  ORDER BY v.distance ASC
\`).all(Buffer.from(qVec.buffer), ${ctx.topK});
console.log(rows);`,
      },
    ];
  }

  if (engine === "elasticsearch" || engine === "opensearch") {
    const body =
      engine === "elasticsearch"
        ? {
            size: ctx.topK,
            knn: {
              field: "embedding",
              query_vector:
                ctx.queryVector && ctx.queryVector.length > 0
                  ? ctx.queryVector
                  : [0.1, 0.2, 0.3],
              k: ctx.topK,
              num_candidates: ctx.topK * 3,
            },
          }
        : {
            size: ctx.topK,
            query: {
              knn: {
                embedding: {
                  vector:
                    ctx.queryVector && ctx.queryVector.length > 0
                      ? ctx.queryVector
                      : [0.1, 0.2, 0.3],
                  k: ctx.topK,
                },
              },
            },
          };
    return [
      {
        id: "python",
        label: "Python",
        code:
          engine === "elasticsearch"
            ? `${queryComment}from elasticsearch import Elasticsearch

es = Elasticsearch("${url}")
res = es.search(
    index="${ctx.collection}",
    knn={"field": "embedding", "query_vector": ${vecPy}, "k": ${ctx.topK}, "num_candidates": ${ctx.topK * 3}},
)
print(res["hits"]["hits"])`
            : `${queryComment}from opensearchpy import OpenSearch

client = OpenSearch(hosts=["${url}"])
res = client.search(
    index="${ctx.collection}",
    body={"size": ${ctx.topK}, "query": {"knn": {"embedding": {"vector": ${vecPy}, "k": ${ctx.topK}}}}},
)
print(res["hits"]["hits"])`,
      },
      {
        id: "curl",
        label: "cURL",
        code: `curl -s -X POST "${url}/${ctx.collection}/_search" \\
  -H "Content-Type: application/json" \\
  -d '${JSON.stringify(body, null, 2)}'`,
      },
    ];
  }

  if (engine === "mariadb") {
    const vecLit = `[${(ctx.queryVector && ctx.queryVector.length > 0 ? ctx.queryVector.slice(0, 6) : [0.1, 0.2, 0.3]).join(",")}]`;
    return [
      {
        id: "python",
        label: "Python",
        code: `${queryComment}import json, mariadb

conn = mariadb.connect(host="127.0.0.1", port=${ctx.port ?? 3306}, user="root", database="embedbay")
cur = conn.cursor()
cur.execute(
    """
    SELECT id, document, payload,
           1.0 - VEC_DISTANCE_COSINE(embedding, VEC_FromText(?)) AS score
    FROM \`${ctx.collection}\`
    ORDER BY VEC_DISTANCE_COSINE(embedding, VEC_FromText(?)) ASC
    LIMIT ?
    """,
    (json.dumps(${vecPy}), json.dumps(${vecPy}), ${ctx.topK}),
)
print(cur.fetchall())`,
      },
      {
        id: "sql",
        label: "SQL",
        code: `SELECT id, document, payload,
       1.0 - VEC_DISTANCE_COSINE(embedding, VEC_FromText('${vecLit}')) AS score
FROM \`${ctx.collection}\`
ORDER BY VEC_DISTANCE_COSINE(embedding, VEC_FromText('${vecLit}')) ASC
LIMIT ${ctx.topK};`,
      },
    ];
  }

  if (engine === "duckdb") {
    const dbFile = `${(ctx.dataDir || "./data/duckdb").replace(/[\\/]+$/, "")}/vectors.duckdb`;
    const dims = ctx.queryVector && ctx.queryVector.length > 0 ? ctx.queryVector.length : 3;
    return [
      {
        id: "python",
        label: "Python",
        code: `${queryComment}import duckdb

con = duckdb.connect(r"${dbFile}")
rows = con.execute(
    """
    SELECT id, document, payload,
           array_cosine_similarity(embedding, ?::FLOAT[${dims}]) AS score
    FROM "${ctx.collection}"
    ORDER BY score DESC
    LIMIT ?
    """,
    (${vecPy}, ${ctx.topK}),
).fetchall()
print(rows)`,
      },
      {
        id: "sql",
        label: "SQL",
        code: `SELECT id, document, payload,
       array_cosine_similarity(embedding, ${vecJson}::FLOAT[${dims}]) AS score
FROM "${ctx.collection}"
ORDER BY score DESC
LIMIT ${ctx.topK};`,
      },
    ];
  }

  // Default & Qdrant (plus generic REST engines)
  const qdrantCurlBody: Record<string, unknown> = {
    query:
      ctx.queryVector && ctx.queryVector.length > 0
        ? ctx.queryVector
        : [0.1, 0.2, 0.3],
    limit: ctx.topK,
    with_payload: true,
  };
  if (ctx.scoreThreshold != null) {
    qdrantCurlBody.score_threshold = ctx.scoreThreshold;
  }
  if (filterObj) {
    qdrantCurlBody.filter = filterObj;
  }

  return [
    {
      id: "python",
      label: "Python",
      code: `${queryComment}import os
from qdrant_client import QdrantClient

client = QdrantClient(
    url="${url}",${authNote ? '\n    api_key=os.environ.get("QDRANT_API_KEY", "<YOUR_API_KEY>"),' : ""}
)

hits = client.query_points(
    collection_name="${ctx.collection}",
    query=${vecPy},
    limit=${ctx.topK},${ctx.scoreThreshold != null ? `\n    score_threshold=${ctx.scoreThreshold},` : ""}${filterJson ? `\n    query_filter=${filterJson},` : ""}
    with_payload=True,
)
print(hits)`,
    },
    {
      id: "typescript",
      label: "TypeScript",
      code: `${tsQueryComment}import { QdrantClient } from "@qdrant/js-client-rest";

const client = new QdrantClient({
  url: "${url}",${authNote ? '\n  apiKey: process.env.QDRANT_API_KEY ?? "<YOUR_API_KEY>",' : ""}
});

const hits = await client.query("${ctx.collection}", {
  query: ${vecJson},
  limit: ${ctx.topK},${ctx.scoreThreshold != null ? `\n  score_threshold: ${ctx.scoreThreshold},` : ""}${filterJson ? `\n  filter: ${filterJson},` : ""}
  with_payload: true,
});
console.log(hits);`,
    },
    {
      id: "curl",
      label: "cURL",
      code: `curl -s -X POST "${url}/collections/${ctx.collection}/points/query" \\${authNote ? '\n  -H "api-key: <YOUR_API_KEY>" \\' : ""}
  -H "Content-Type: application/json" \\
  -d '${JSON.stringify(qdrantCurlBody, null, 2)}'`,
    },
  ];
}
