#!/usr/bin/env node
/**
 * Fetch latest official release metadata & compute SHA-256 checksums
 * for EmbedBay's native Windows engine catalog (manifests/engines.json).
 *
 * Usage:
 *   npx tsx scripts/update-manifest.ts          # dry-run report
 *   npx tsx scripts/update-manifest.ts --write  # update manifests/engines.json
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

interface TargetArtifact {
  url: string;
  sha256: string;
  size_bytes: number;
  archive_type: "zip" | "tar_gz" | "binary";
  binary_rel_path: string;
  dest_subdir?: string;
  extra_archives?: TargetArtifact[];
}

interface ManifestVersion {
  version: string;
  recommended: boolean;
  targets: Record<string, TargetArtifact>;
}

interface ManifestEngine {
  engine_type: string;
  display_name: string;
  description: string;
  tier: number;
  embedded: boolean;
  runtime_kind?: "native" | "embedded" | "sql_portable" | "jvm";
  ram_hint?: string | null;
  category?: string | null;
  install_notice?: string | null;
  default_port: number;
  default_grpc_port: number | null;
  versions: ManifestVersion[];
}

interface EngineManifest {
  schema_version: number;
  updated_at?: string;
  engines: ManifestEngine[];
}

interface GitHubReleaseAsset {
  name: string;
  browser_download_url: string;
  size: number;
}

interface GitHubRelease {
  tag_name: string;
  assets: GitHubReleaseAsset[];
}

const WIN_TARGET = "x86_64-pc-windows-msvc";

async function fetchLatestRelease(repo: string): Promise<GitHubRelease> {
  const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "EmbedBay-Manifest-Updater",
    },
  });
  if (!res.ok) {
    throw new Error(`GitHub API ${repo} returned ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as GitHubRelease;
}

function hasHydratedVersion(
  manifest: EngineManifest,
  engineType: string,
  version: string,
): boolean {
  const engine = manifest.engines.find((e) => e.engine_type === engineType);
  const ver = engine?.versions.find((v) => v.version === version);
  const target = ver?.targets[WIN_TARGET];
  return Boolean(target && target.sha256.length === 64 && target.size_bytes > 0);
}

async function fetchLatestMariaDb118(): Promise<{ version: string; url: string }> {
  const res = await fetch("https://downloads.mariadb.org/rest-api/mariadb/11.8/", {
    headers: { "User-Agent": "EmbedBay-Manifest-Updater" },
  });
  if (res.ok) {
    const data = (await res.json()) as {
      releases?: Record<string, { release_id?: string; files?: Array<{ file_name?: string; file_download_url?: string }> }>;
    };
    const entries = Object.values(data.releases ?? {});
    for (const rel of entries) {
      const zip = (rel.files ?? []).find(
        (f) =>
          f.file_name?.endsWith("-winx64.zip") &&
          !f.file_name.includes("debugsymbols"),
      );
      if (zip?.file_download_url && rel.release_id) {
        return {
          version: rel.release_id,
          url: zip.file_download_url.replace(/^http:\/\//i, "https://"),
        };
      }
    }
  }
  return {
    version: "11.8.8",
    url: "https://archive.mariadb.org/mariadb-11.8.8/winx64-packages/mariadb-11.8.8-winx64.zip",
  };
}

async function computeSha256(
  url: string,
): Promise<{ sha256: string; sizeBytes: number }> {
  const res = await fetch(url, {
    headers: { "User-Agent": "EmbedBay-Manifest-Updater" },
  });
  if (!res.ok || !res.body) {
    throw new Error(`Failed downloading ${url}: ${res.status}`);
  }
  const hash = crypto.createHash("sha256");
  let sizeBytes = 0;
  for await (const chunk of res.body) {
    const buf = Buffer.from(chunk);
    sizeBytes += buf.byteLength;
    hash.update(buf);
  }
  return { sha256: hash.digest("hex"), sizeBytes };
}

function upsertRecommendedVersion(
  manifest: EngineManifest,
  engineType: string,
  version: string,
  artifact: TargetArtifact,
) {
  const engine = manifest.engines.find((e) => e.engine_type === engineType);
  if (!engine) return;
  for (const v of engine.versions) {
    v.recommended = false;
  }
  const existing = engine.versions.find((v) => v.version === version);
  if (existing) {
    existing.recommended = true;
    existing.targets[WIN_TARGET] = artifact;
  } else {
    engine.versions.unshift({
      version,
      recommended: true,
      targets: { [WIN_TARGET]: artifact },
    });
  }
}

async function hydrateGitHubEngine(
  manifest: EngineManifest,
  opts: {
    engineType: string;
    repo: string;
    assetMatch: (name: string) => boolean;
    archiveType: "zip" | "binary";
    binaryRelPath: string;
    stripVersionPrefix?: RegExp;
  },
) {
  const rel = await fetchLatestRelease(opts.repo);
  const asset = rel.assets.find((a) => opts.assetMatch(a.name));
  if (!asset) {
    console.warn(`No Windows asset found for ${opts.engineType} (${rel.tag_name})`);
    return;
  }
  const version = rel.tag_name.replace(opts.stripVersionPrefix ?? /^v/, "");
  if (hasHydratedVersion(manifest, opts.engineType, version)) {
    console.log(`Skipping ${opts.engineType} ${version} (already verified)`);
    return;
  }
  console.log(`Checking ${opts.engineType} ${version}: ${asset.browser_download_url}`);
  const digest = await computeSha256(asset.browser_download_url);
  console.log(`  -> sha256=${digest.sha256} (${digest.sizeBytes} bytes)`);

  upsertRecommendedVersion(manifest, opts.engineType, version, {
    url: asset.browser_download_url,
    sha256: digest.sha256,
    size_bytes: digest.sizeBytes,
    archive_type: opts.archiveType,
    binary_rel_path: opts.binaryRelPath,
    extra_archives: [],
  });
}

async function main() {
  const shouldWrite = process.argv.includes("--write");
  const manifestPath = path.resolve(process.cwd(), "manifests", "engines.json");
  const manifest = JSON.parse(
    fs.readFileSync(manifestPath, "utf-8"),
  ) as EngineManifest;

  console.log(`Loaded ${manifestPath} (${manifest.engines.length} engines)`);

  await hydrateGitHubEngine(manifest, {
    engineType: "qdrant",
    repo: "qdrant/qdrant",
    assetMatch: (n) => n.includes("x86_64-pc-windows-msvc.zip"),
    archiveType: "zip",
    binaryRelPath: "qdrant.exe",
  });

  await hydrateGitHubEngine(manifest, {
    engineType: "meilisearch",
    repo: "meilisearch/meilisearch",
    assetMatch: (n) => n === "meilisearch-windows-amd64.exe",
    archiveType: "binary",
    binaryRelPath: "meilisearch.exe",
  });

  await hydrateGitHubEngine(manifest, {
    engineType: "surrealdb",
    repo: "surrealdb/surrealdb",
    assetMatch: (n) => n.endsWith("windows-amd64.exe"),
    archiveType: "binary",
    binaryRelPath: "surreal.exe",
  });

  await hydrateGitHubEngine(manifest, {
    engineType: "duckdb",
    repo: "duckdb/duckdb",
    assetMatch: (n) =>
      n === "duckdb-cli-windows-amd64.zip" || n === "duckdb_cli-windows-amd64.zip",
    archiveType: "zip",
    binaryRelPath: "duckdb.exe",
  });

  // Elasticsearch (official Windows zip with bundled OpenJDK)
  try {
    const esRel = await fetchLatestRelease("elastic/elasticsearch");
    const esVer = esRel.tag_name.replace(/^v/, "");
    if (hasHydratedVersion(manifest, "elasticsearch", esVer)) {
      console.log(`Skipping elasticsearch ${esVer} (already verified)`);
    } else {
      const esUrl = `https://artifacts.elastic.co/downloads/elasticsearch/elasticsearch-${esVer}-windows-x86_64.zip`;
      console.log(`Checking elasticsearch ${esVer}: ${esUrl}`);
      const digest = await computeSha256(esUrl);
      console.log(`  -> sha256=${digest.sha256} (${digest.sizeBytes} bytes)`);
      upsertRecommendedVersion(manifest, "elasticsearch", esVer, {
        url: esUrl,
        sha256: digest.sha256,
        size_bytes: digest.sizeBytes,
        archive_type: "zip",
        binary_rel_path: "bin/elasticsearch.bat",
        extra_archives: [],
      });
    }
  } catch (err) {
    console.warn(`Skipping elasticsearch auto-refresh: ${String(err)}`);
  }

  // OpenSearch (official Windows zip with bundled OpenJDK)
  try {
    const osRel = await fetchLatestRelease("opensearch-project/OpenSearch");
    const osVer = osRel.tag_name.replace(/^v/, "");
    if (hasHydratedVersion(manifest, "opensearch", osVer)) {
      console.log(`Skipping opensearch ${osVer} (already verified)`);
    } else {
      const osUrl = `https://artifacts.opensearch.org/releases/bundle/opensearch/${osVer}/opensearch-${osVer}-windows-x64.zip`;
      console.log(`Checking opensearch ${osVer}: ${osUrl}`);
      const digest = await computeSha256(osUrl);
      console.log(`  -> sha256=${digest.sha256} (${digest.sizeBytes} bytes)`);
      upsertRecommendedVersion(manifest, "opensearch", osVer, {
        url: osUrl,
        sha256: digest.sha256,
        size_bytes: digest.sizeBytes,
        archive_type: "zip",
        binary_rel_path: "bin/opensearch.bat",
        extra_archives: [],
      });
    }
  } catch (err) {
    console.warn(`Skipping opensearch auto-refresh: ${String(err)}`);
  }

  // MariaDB 11.8 LTS (official portable Windows zip)
  try {
    const { version: mdbVer, url: mdbUrl } = await fetchLatestMariaDb118();
    if (hasHydratedVersion(manifest, "mariadb", mdbVer)) {
      console.log(`Skipping mariadb ${mdbVer} (already verified)`);
    } else {
      console.log(`Checking mariadb ${mdbVer}: ${mdbUrl}`);
      const digest = await computeSha256(mdbUrl);
      console.log(`  -> sha256=${digest.sha256} (${digest.sizeBytes} bytes)`);
      upsertRecommendedVersion(manifest, "mariadb", mdbVer, {
        url: mdbUrl,
        sha256: digest.sha256,
        size_bytes: digest.sizeBytes,
        archive_type: "zip",
        binary_rel_path: "bin/mariadbd.exe",
        extra_archives: [],
      });
    }
  } catch (err) {
    console.warn(`Skipping mariadb auto-refresh: ${String(err)}`);
  }

  if (shouldWrite) {
    manifest.updated_at = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf-8");
    console.log(`Updated ${manifestPath}`);
  } else {
    console.log("Dry-run complete. Re-run with --write to update manifests/engines.json.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
