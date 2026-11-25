#!/usr/bin/env node
/**
 * Fetch latest official GitHub release metadata & compute SHA-256 checksums
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

async function computeSha256(url: string): Promise<{ sha256: string; sizeBytes: number }> {
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

async function main() {
  const shouldWrite = process.argv.includes("--write");
  const manifestPath = path.resolve(process.cwd(), "manifests", "engines.json");
  const manifest = JSON.parse(
    fs.readFileSync(manifestPath, "utf-8"),
  ) as EngineManifest;

  console.log(`Loaded ${manifestPath} (${manifest.engines.length} engines)`);

  const qdrantRel = await fetchLatestRelease("qdrant/qdrant");
  const qdrantWin = qdrantRel.assets.find((a) =>
    a.name.includes("x86_64-pc-windows-msvc.zip"),
  );
  if (qdrantWin) {
    const version = qdrantRel.tag_name.replace(/^v/, "");
    console.log(`Checking Qdrant ${version}: ${qdrantWin.browser_download_url}`);
    const digest = await computeSha256(qdrantWin.browser_download_url);
    console.log(`  -> sha256=${digest.sha256} (${digest.sizeBytes} bytes)`);

    const qdrant = manifest.engines.find((e) => e.engine_type === "qdrant");
    if (qdrant && !qdrant.versions.some((v) => v.version === version)) {
      for (const v of qdrant.versions) v.recommended = false;
      qdrant.versions.unshift({
        version,
        recommended: true,
        targets: {
          "x86_64-pc-windows-msvc": {
            url: qdrantWin.browser_download_url,
            sha256: digest.sha256,
            size_bytes: digest.sizeBytes,
            archive_type: "zip",
            binary_rel_path: "qdrant.exe",
            extra_archives: [],
          },
        },
      });
    }
  }

  const pgVecRel = await fetchLatestRelease("pgvector/pgvector");
  const pgVecWin = pgVecRel.assets.find((a) =>
    /vector\.v.*-pg17\.zip$/i.test(a.name),
  );
  if (pgVecWin) {
    console.log(`Checking pgvector ${pgVecRel.tag_name}: ${pgVecWin.browser_download_url}`);
    const digest = await computeSha256(pgVecWin.browser_download_url);
    console.log(`  -> sha256=${digest.sha256} (${digest.sizeBytes} bytes)`);
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
