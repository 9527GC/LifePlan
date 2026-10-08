import Fastify from "fastify";
import cors from "@fastify/cors";
import pg from "pg";
import { Resend } from "resend";

const { Pool } = pg;
const app = Fastify({ logger: true, bodyLimit: 40 * 1024 * 1024 });
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const recipient = process.env.FEEDBACK_TO_EMAIL || "695971316@qq.com";
const sender = process.env.FEEDBACK_FROM_EMAIL || "feedback@lifeplan.gc9527.com";

await app.register(cors, { origin: true, methods: ["POST", "GET", "OPTIONS"] });

const isFeedbackType = (value: unknown): value is "bug" | "suggestion" | "question" | "other" => ["bug", "suggestion", "question", "other"].includes(String(value));
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] || char);

app.get("/health", async () => ({ ok: true }));
app.post<{ Body: Record<string, unknown> }>("/api/feedback", async (request, reply) => {
  const body = request.body;
  if (!isFeedbackType(body.type) || typeof body.content !== "string" || body.content.trim().length < 2) return reply.code(400).send({ message: "反馈类型和问题描述不能为空。" });
  if (body.content.length > 20000) return reply.code(400).send({ message: "反馈内容不能超过 20000 个字符。" });
  const includeDiagnostics = body.includeDiagnostics === true;
  const attachments = Array.isArray(body.attachments) ? body.attachments.slice(0, 6).map((item) => ({ name: String((item as Record<string, unknown>).name || "附件"), mimeType: String((item as Record<string, unknown>).mimeType || "application/octet-stream"), dataUrl: String((item as Record<string, unknown>).dataUrl || "") })) : [];
  const result = await pool.query<{ id: string }>(`INSERT INTO feedback (type, content, contact, allow_contact, include_diagnostics, current_page, app_version, platform, user_agent, client_time, attachments) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`, [body.type, body.content.trim(), typeof body.contact === "string" ? body.contact.trim() || null : null, body.allowContact === true, includeDiagnostics, includeDiagnostics ? String(body.currentPage || "") : null, includeDiagnostics ? String(body.appVersion || "") : null, includeDiagnostics ? String(body.platform || "") : null, includeDiagnostics ? String(body.userAgent || "") : null, includeDiagnostics && body.clientTime ? new Date(String(body.clientTime)) : null, JSON.stringify(attachments.map(({ name, mimeType }) => ({ name, mimeType }))) ]);
  const feedbackId = result.rows[0].id;
  if (resend) {
    try {
      const emailResult = await resend.emails.send({
        from: sender,
        to: recipient,
        subject: `LifePlan 新反馈 #${feedbackId} - ${body.type}`,
        html: `<h2>LifePlan 新反馈 #${feedbackId}</h2><p><strong>类型：</strong>${escapeHtml(String(body.type))}</p><p><strong>描述：</strong></p><pre style="white-space:pre-wrap">${escapeHtml(String(body.content))}</pre><p><strong>联系方式：</strong>${escapeHtml(String(body.contact || "未提供"))}</p>${includeDiagnostics ? `<p><strong>页面：</strong>${escapeHtml(String(body.currentPage || ""))}</p><p><strong>版本：</strong>${escapeHtml(String(body.appVersion || ""))} / ${escapeHtml(String(body.platform || ""))}</p>` : ""}<p><strong>附件：</strong>${attachments.length ? "已作为邮件附件发送。" : "未附带"}</p>`,
        attachments: attachments.map((item) => ({ filename: item.name, content: item.dataUrl.split(",", 2)[1] || "" })),
      });
      if (emailResult.error) request.log.error({ error: emailResult.error, feedbackId }, "反馈通知邮件发送失败");
    } catch (error) {
      // 反馈已经写入数据库，邮件通知失败不应让客户端误以为反馈丢失。
      request.log.error({ error, feedbackId }, "反馈通知邮件发送异常");
    }
  }  return reply.code(201).send({ id: feedbackId });
});

app.listen({ host: process.env.HOST || "127.0.0.1", port: Number(process.env.PORT || 3100) }).catch((error) => { app.log.error(error); process.exit(1); });


