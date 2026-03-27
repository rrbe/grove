import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export type { Update };

export interface UpdateInfo {
  version: string;
  body?: string;
  date?: string;
  currentVersion: string;
}

export interface DownloadProgress {
  phase: "idle" | "downloading" | "installing" | "done" | "error";
  downloaded: number;
  total: number | null;
  error?: string;
}

export const INITIAL_PROGRESS: DownloadProgress = {
  phase: "idle",
  downloaded: 0,
  total: null,
};

export async function checkForUpdate(): Promise<Update | null> {
  try {
    const update = await check();
    return update ?? null;
  } catch (e) {
    console.error("Update check failed:", e);
    return null;
  }
}

export async function downloadAndInstallUpdate(
  update: Update,
  onProgress: (progress: DownloadProgress) => void,
): Promise<void> {
  let downloaded = 0;
  let total: number | null = null;

  onProgress({ phase: "downloading", downloaded: 0, total: null });

  try {
    await update.downloadAndInstall((event) => {
      switch (event.event) {
        case "Started":
          total = event.data.contentLength ?? null;
          onProgress({ phase: "downloading", downloaded: 0, total });
          break;
        case "Progress":
          downloaded += event.data.chunkLength;
          onProgress({ phase: "downloading", downloaded, total });
          break;
        case "Finished":
          onProgress({ phase: "installing", downloaded, total });
          break;
      }
    });

    onProgress({ phase: "done", downloaded, total });

    // Brief pause to let the UI show "done" before restarting
    setTimeout(async () => {
      await relaunch();
    }, 1500);
  } catch (e) {
    onProgress({
      phase: "error",
      downloaded,
      total,
      error: String(e),
    });
  }
}
