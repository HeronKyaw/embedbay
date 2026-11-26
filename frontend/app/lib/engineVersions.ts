import type {
  CatalogEngineView,
  CatalogVersionView,
  InstalledEngine,
} from "@/types/runtime";

export interface EngineUpdateInfo {
  recommendedVersion: CatalogVersionView | null;
  installedVersions: string[];
  latestInstalledVersion: string | null;
  hasUpdateAvailable: boolean;
}

/**
 * Compares two version strings numerically on digit runs and lexicographically
 * on non-digit runs (handling semver, compound versions, and embedded tags).
 */
export function compareVersionStrings(a: string, b: string): number {
  const tokensA = a.match(/\d+|\D+/g) ?? [];
  const tokensB = b.match(/\d+|\D+/g) ?? [];
  const len = Math.max(tokensA.length, tokensB.length);

  for (let i = 0; i < len; i++) {
    const ta = tokensA[i];
    const tb = tokensB[i];
    if (ta === undefined) return -1;
    if (tb === undefined) return 1;

    const isNumA = /^\d+$/.test(ta);
    const isNumB = /^\d+$/.test(tb);

    if (isNumA && isNumB) {
      const diff = Number(ta) - Number(tb);
      if (diff !== 0) return diff;
    } else {
      const diff = ta.localeCompare(tb);
      if (diff !== 0) return diff;
    }
  }

  return 0;
}

/**
 * Computes installed version state and whether a newer recommended catalog
 * version is available for a given engine.
 */
export function getEngineUpdateInfo(
  engine: CatalogEngineView,
  installedEngines: InstalledEngine[],
): EngineUpdateInfo {
  const versionSet = new Set<string>();

  for (const inst of installedEngines) {
    if (inst.engine_type === engine.engine_type) {
      versionSet.add(inst.version);
    }
  }
  for (const v of engine.versions) {
    if (v.installed) {
      versionSet.add(v.version);
    }
  }

  const installedVersions = Array.from(versionSet).sort((a, b) =>
    compareVersionStrings(b, a),
  );
  const latestInstalledVersion = installedVersions[0] ?? null;

  const recommendedVersion =
    engine.versions.find((v) => v.recommended) ?? engine.versions[0] ?? null;

  const recommendedInstalled = Boolean(
    recommendedVersion &&
      (recommendedVersion.installed ||
        versionSet.has(recommendedVersion.version)),
  );

  const hasUpdateAvailable = Boolean(
    recommendedVersion &&
      latestInstalledVersion &&
      !recommendedInstalled &&
      compareVersionStrings(
        recommendedVersion.version,
        latestInstalledVersion,
      ) > 0,
  );

  return {
    recommendedVersion,
    installedVersions,
    latestInstalledVersion,
    hasUpdateAvailable,
  };
}
