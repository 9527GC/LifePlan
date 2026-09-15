import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export type AvailableUpdate = Update;

/** 静默检查是否存在可安装的新版本。 */
export async function checkForUpdate(): Promise<AvailableUpdate | null> {
  return check();
}

/** 下载、安装已发现的更新，并重启客户端。 */
export async function installUpdate(update: AvailableUpdate): Promise<void> {
  await update.downloadAndInstall();
  await relaunch();
}
