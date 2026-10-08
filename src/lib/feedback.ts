export type FeedbackType = "bug" | "suggestion" | "question" | "other";

export interface FeedbackAttachment { name: string; mimeType: string; dataUrl: string; }
export interface FeedbackPayload {
  type: FeedbackType;
  content: string;
  contact?: string;
  allowContact: boolean;
  includeDiagnostics: boolean;
  currentPage: string;
  attachments: FeedbackAttachment[];
}

const FEEDBACK_API_URL = import.meta.env.VITE_FEEDBACK_API_URL || "https://api.lifeplan.gc9527.com/api/feedback";

export async function submitFeedback(payload: FeedbackPayload) {
  const { includeDiagnostics, ...feedback } = payload;
  const body = {
    ...feedback,
    includeDiagnostics,
    ...(includeDiagnostics ? {
      appVersion: "1.1.0",
      platform: navigator.platform,
      userAgent: navigator.userAgent,
      clientTime: new Date().toISOString(),
    } : {}),
  };
  let response: Response;
  try { response = await fetch(FEEDBACK_API_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); }
  catch { throw new Error("暂时无法连接反馈服务，请检查网络后重试。"); }
  if (!response.ok) {
    const result = await response.json().catch(() => ({})) as { message?: string };
    throw new Error(result.message || "反馈提交失败，请稍后再试。");
  }
}
