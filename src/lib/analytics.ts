import { invoke } from "@tauri-apps/api/core";

type TauriWindow = Window & { __TAURI_INTERNALS__?: { invoke?: unknown } };
const invokeCommand = <T>(command: string, args?: Record<string, unknown>) => {
  const tauriInvoke = (window as TauriWindow).__TAURI_INTERNALS__?.invoke;
  if (typeof tauriInvoke !== "function") return Promise.reject(new Error("当前为浏览器测试环境，请启动桌面客户端后使用。"));
  return invoke<T>(command, args);
};

type AnalyticsValue = string | number | boolean | null;
export type AnalyticsEvent = "应用启动" | "查看页面" | "创建事件" | "事件转项目" | "创建项目行动" | "安排到今日" | "完成行动" | "完成项目" | "启动番茄钟" | "完成番茄钟" | "完成每日复盘" | "创建奖励" | "兑换奖励" | "导出埋点" | "查看新用户引导" | "完成新用户引导";

export function track(eventName: AnalyticsEvent, payload: Record<string, AnalyticsValue> = {}) {
  void invokeCommand<void>("record_analytics_event", { eventName, payloadJson: JSON.stringify(payload) }).catch(() => undefined);
}

export async function exportAnalyticsLog() {
  const rows = await invokeCommand<Array<{ id: number; event_name: string; occurred_at: number; app_version: string; platform: string; payload_json: string }>>("export_analytics_events");
  const blob = new Blob([JSON.stringify(rows, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `lifeplan-analytics-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
  track("导出埋点", { count: rows.length });
}


