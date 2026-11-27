import { create } from "zustand";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { toast } from "@/components/ui/toast";
import {
  fetchGitHubReleaseNotes,
  isTauriRuntime,
  prepareAppUpdateRestart,
} from "@/ipc/system";
import { formatUserError } from "@/lib/errors";

export type UpdatePhase =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "ready"
  | "installing";

export interface CheckForUpdatesOptions {
  silent?: boolean;
}

interface UpdaterStoreState {
  availableUpdate: Update | null;
  releaseNotes: string | null;
  notesLoading: boolean;
  phase: UpdatePhase;
  downloadPercent: number | null;
  downloadedBytes: number;
  totalBytes: number;
  lastCheckedAt: string | null;
  statusText: string;
  error: string | null;
  promptOpen: boolean;
  bannerDismissedVersion: string | null;

  checkForUpdates: (
    currentVersion: string,
    options?: CheckForUpdatesOptions,
  ) => Promise<void>;
  downloadUpdate: () => Promise<void>;
  installDownloadedUpdate: () => Promise<void>;
  deferInstall: () => void;
  dismissBanner: () => void;
  setPromptOpen: (open: boolean) => void;
}

export const useUpdaterStore = create<UpdaterStoreState>((set, get) => ({
  availableUpdate: null,
  releaseNotes: null,
  notesLoading: false,
  phase: "idle",
  downloadPercent: null,
  downloadedBytes: 0,
  totalBytes: 0,
  lastCheckedAt: null,
  statusText: "Signed updates delivered via GitHub Releases (latest.json).",
  error: null,
  promptOpen: false,
  bannerDismissedVersion: null,

  checkForUpdates: async (
    currentVersion: string,
    options?: CheckForUpdatesOptions,
  ) => {
    const silent = options?.silent ?? false;
    const { phase, availableUpdate } = get();
    if (
      phase === "checking" ||
      phase === "downloading" ||
      phase === "installing"
    ) {
      return;
    }

    if (!silent) {
      set({ error: null });
    }

    if (!isTauriRuntime()) {
      if (!silent) {
        set({
          statusText:
            "Update checking requires the installed Tauri desktop runtime.",
        });
        toast.info(
          "Desktop runtime required",
          "Run EmbedBay via Tauri to check signed GitHub Releases.",
        );
      }
      return;
    }

    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      if (!silent) {
        set({
          statusText: "Offline — connect to the internet to check for updates.",
        });
        toast.info(
          "You are offline",
          "Connect to the internet to check for EmbedBay updates.",
        );
      }
      return;
    }

    const previousPhase = phase;
    set({
      phase: "checking",
      ...(silent ? {} : { statusText: "Contacting release feed..." }),
    });

    try {
      const next = await check({ timeout: silent ? 4000 : 15000 });
      const checkedAt = new Date().toLocaleTimeString();

      if (next) {
        const version = next.version;
        const alreadyReady =
          previousPhase === "ready" &&
          availableUpdate &&
          availableUpdate.version === version;

        if (alreadyReady) {
          await next.close().catch(() => {});
          set({
            phase: "ready",
            lastCheckedAt: checkedAt,
            statusText: `EmbedBay v${availableUpdate.version} is downloaded and ready to install.`,
          });
        } else {
          if (availableUpdate) {
            await availableUpdate.close().catch(() => {});
          }
          set({
            availableUpdate: next,
            releaseNotes: next.body ?? null,
            notesLoading: true,
            phase: "available",
            downloadPercent: null,
            downloadedBytes: 0,
            totalBytes: 0,
            lastCheckedAt: checkedAt,
            error: null,
            statusText: `EmbedBay v${next.version} is available (installed: v${next.currentVersion}).`,
          });
          if (!silent) {
            toast.success(`Update v${next.version} available`);
          }
        }

        // Enrich with the live GitHub Release description so edited What's New / Bug Fixes always show.
        void fetchGitHubReleaseNotes(version)
          .then((liveNotes) => {
            const current = get().availableUpdate;
            if (!current || current.version !== version) return;
            set({
              releaseNotes: liveNotes ?? get().releaseNotes ?? current.body ?? null,
              notesLoading: false,
            });
          })
          .catch(() => {
            const current = get().availableUpdate;
            if (!current || current.version !== version) return;
            set({ notesLoading: false });
          });
      } else {
        if (availableUpdate) {
          await availableUpdate.close().catch(() => {});
        }
        set({
          availableUpdate: null,
          releaseNotes: null,
          notesLoading: false,
          phase: "idle",
          downloadPercent: null,
          downloadedBytes: 0,
          totalBytes: 0,
          lastCheckedAt: checkedAt,
          statusText: `You are running the latest version (v${currentVersion}).`,
        });
        if (!silent) {
          toast.success("Up to date", "No newer EmbedBay release found.");
        }
      }
    } catch (err: unknown) {
      const msg = formatUserError(err);
      set({
        phase: availableUpdate
          ? previousPhase === "ready"
            ? "ready"
            : "available"
          : "idle",
        ...(silent
          ? {}
          : {
              error: msg,
              statusText: "Unable to fetch update manifest.",
            }),
      });
    }
  },

  downloadUpdate: async () => {
    const { availableUpdate, phase } = get();
    if (!availableUpdate || phase !== "available") return;

    set({
      phase: "downloading",
      error: null,
      downloadPercent: 0,
      downloadedBytes: 0,
      totalBytes: 0,
      statusText: `Downloading EmbedBay v${availableUpdate.version}...`,
    });

    let total = 0;
    let downloaded = 0;

    try {
      await availableUpdate.download((event) => {
        if (event.event === "Started") {
          total = event.data.contentLength ?? 0;
          downloaded = 0;
          set({
            totalBytes: total,
            downloadedBytes: 0,
            downloadPercent: 0,
          });
        } else if (event.event === "Progress") {
          downloaded += event.data.chunkLength;
          const percent =
            total > 0
              ? Math.min(100, Math.round((downloaded / total) * 100))
              : null;
          set({
            downloadedBytes: downloaded,
            totalBytes: total,
            downloadPercent: percent,
          });
        } else if (event.event === "Finished") {
          set({
            downloadedBytes: total > 0 ? total : downloaded,
            downloadPercent: 100,
          });
        }
      });

      set({
        phase: "ready",
        downloadPercent: 100,
        promptOpen: true,
        statusText: `EmbedBay v${availableUpdate.version} is downloaded and ready to install.`,
      });
    } catch (err: unknown) {
      const msg = formatUserError(err);
      set({
        phase: "available",
        downloadPercent: null,
        error: msg,
        statusText: `EmbedBay v${availableUpdate.version} is available (installed: v${availableUpdate.currentVersion}).`,
      });
      toast.error("Update download failed", msg);
    }
  },

  installDownloadedUpdate: async () => {
    const { availableUpdate, phase } = get();
    if (!availableUpdate || phase !== "ready") return;

    set({
      phase: "installing",
      promptOpen: false,
      error: null,
      statusText: `Installing EmbedBay v${availableUpdate.version} and restarting...`,
    });

    try {
      await prepareAppUpdateRestart().catch(() => {});
      await availableUpdate.install({ restartAfterInstall: true });
      toast.success("Update installed", "Restarting EmbedBay to finish update.");
    } catch (err: unknown) {
      const msg = formatUserError(err);
      set({
        phase: "ready",
        error: msg,
        statusText: `EmbedBay v${availableUpdate.version} is downloaded and ready to install.`,
      });
      toast.error("Update install failed", msg);
    }
  },

  deferInstall: () => {
    const { availableUpdate } = get();
    set({ promptOpen: false });
    if (availableUpdate) {
      toast.info(
        `Update v${availableUpdate.version} ready`,
        "Install anytime from the Status Bar or Settings → About.",
      );
    }
  },

  dismissBanner: () => {
    const { availableUpdate } = get();
    if (availableUpdate) {
      set({ bannerDismissedVersion: availableUpdate.version });
    }
  },

  setPromptOpen: (open: boolean) => set({ promptOpen: open }),
}));
