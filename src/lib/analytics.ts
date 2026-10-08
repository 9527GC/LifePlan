import { invoke } from "@tauri-apps/api/core";
import { showSavedToast } from "@/lib/savedToast";

type TauriWindow = Window & { __TAURI_INTERNALS__?: { invoke?: unknown } };
const invokeCommand = <T>(command: string, args?: Record<string, unknown>) => {
  const tauriInvoke = (window as TauriWindow).__TAURI_INTERNALS__?.invoke;
  if (typeof tauriInvoke !== "function") return Promise.reject(new Error("当前为浏览器测试环境，请启动桌面客户端后使用。"));
  return invoke<T>(command, args);
};

type AnalyticsValue = string | number | boolean | null;
type AnalyticsLogEntry = { id: number; event_name: string; occurred_at: number; app_version: string; platform: string; payload_json: string };
export type AnalyticsEvent = "应用启动" | "查看页面" | "创建事件" | "处理事件" | "创建事件行动" | "安排到今日" | "完成行动" | "完成事件" | "启动番茄钟" | "完成番茄钟" | "完成每日复盘" | "创建奖励" | "兑换奖励" | "奖励打卡" | "导出埋点" | "查看新用户引导" | "完成新用户引导";

export function track(eventName: AnalyticsEvent, payload: Record<string, AnalyticsValue> = {}) {
  void invokeCommand<void>("record_analytics_event", { eventName, payloadJson: JSON.stringify(payload) }).catch(() => undefined);
}

export async function exportAnalyticsLog() {
  const rows = await invokeCommand<AnalyticsLogEntry[]>("export_analytics_events");
  const filename = `lifeplan-analytics-${new Date().toISOString().slice(0, 10)}.json`;
  const path = await invokeCommand<string>("save_download_text_file", { filename, content: JSON.stringify(rows, null, 2) });
  track("导出埋点", { count: rows.length });
  showSavedToast("操作日志（脱敏）已下载", path);
  return path;
}

/** 将与“连续点击 Logo”导出内容相同的脱敏操作日志转换为邮件附件。 */
export async function createAnalyticsLogAttachment() {
  const rows = await invokeCommand<AnalyticsLogEntry[]>("export_analytics_events");
  const content = JSON.stringify(rows, null, 2);
  const bytes = new TextEncoder().encode(content);
  // 防止历史日志异常庞大时导致反馈请求超过服务端的上传上限。
  if (bytes.byteLength > 2 * 1024 * 1024) throw new Error("操作日志超过 2 MB，请先通过 Logo 导出后再联系开发者。");
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return {
    name: `lifeplan-analytics-${new Date().toISOString().slice(0, 10)}.json`,
    mimeType: "application/json",
    dataUrl: `data:application/json;base64,${btoa(binary)}`,
  };
}
