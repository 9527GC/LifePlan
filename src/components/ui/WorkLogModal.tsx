import { useEffect, useMemo, useState } from "react";
import { Alert, Button, Form, Input, Modal, Space, Typography, message } from "antd";
import { FileText, KeyRound, Settings } from "lucide-react";
import type { DailyScheduleSlot } from "@/types";

const API_KEY_STORAGE = "lifeplan-ai-api-key";
const API_URL_STORAGE = "lifeplan-ai-api-url";
const MODEL_STORAGE = "lifeplan-ai-model";
const CONFIG_VERSION_STORAGE = "lifeplan-ai-config-version";
const AI_CONFIG_VERSION = "2";
const LOG_TEMPLATE_STORAGE = "lifeplan-ai-log-template";
const LOG_REQUIREMENTS_STORAGE = "lifeplan-ai-log-requirements";
const WORK_LOG_STORAGE_PREFIX = "lifeplan-work-log-";
const DEFAULT_API_URL = "https://api.openai.com/v1/chat/completions";
const DEFAULT_MODEL = "gpt-5.6-luna";
const DEFAULT_LOG_REQUIREMENTS = `1. 要求日志正文 150-250 字左右；
2. 按所属项目分组描述行动完成情况，必须按照“项目-行动”维度罗列，不要按照时间段维度罗列，不要出现“某个时间段安排了某件事”的描述；
3. 统一使用“已完成、进行中、未完成、已取消或阻塞”等状态；
4. 复盘记录中如有与计划事项不一致的实际工作情况，应如实补充说明；
5. 下一工作日计划列出当日已安排但未完成的行动；
6. 无待顺延事项时明确写“无待顺延行动”；
7. 禁止推测或编造完成比例、时间、原因、成果等事实；
8. 保持专业、简洁、条目化表达，仅输出日志正文。`;
const MAX_ERROR_DETAIL_LENGTH = 4000;
type AiError = { summary: string; detail: string; status?: number; url: string; model: string; time: string };

const DEFAULT_LOG_TEMPLATE = `一、今日工作及完成情况 (必填)
  1.
  2.
二、工作思考及成果展示
  1.
三、下一工作日计划 (必填)
  1.
  2.`;

const readSetting = (key: string, fallback: string) => localStorage.getItem(key) || fallback;
function buildPrompt(date: string, slots: DailyScheduleSlot[], template: string, requirements: string) {
  const details = slots.map((slot, index) => {
    const action = slot.action?.title || "未安排行动";
    const status = slot.met_expectation === undefined ? "未填写" : slot.met_expectation === 1 ? "达到预期" : "未达预期";
    const focus = slot.focused === undefined ? "未填写" : slot.focused === 1 ? "专注" : "未专注";
    return `${index + 1}. ${slot.start_time}-${slot.end_time}｜行动：${action}｜完成预期：${status}｜专注度：${focus}｜复盘：${slot.actual_notes || "未填写"}`;
  }).join("\n");
  return `请根据 ${date} 的时间安排和逐时段复盘，生成一份中文《工作日志》。不要编造未提供的事实，语气专业、具体、适合直接提交给主管或归档。\n\n复盘数据：\n${details || "当天没有可用的时间段复盘数据。"}\n\n请严格按照下面的日志模板输出，保留模板中的章节和编号；模板内容由用户维护：\n${template}\n\n日志生成要求（请与上述模板同时遵守）：\n${requirements}`;
}

async function generateWorkLog(apiKey: string, apiUrl: string, model: string, date: string, slots: DailyScheduleSlot[], template: string, requirements: string) {
  const time = new Date().toLocaleString("zh-CN");
  let response: Response;
  try {
    response = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, temperature: 0.7, messages: [{ role: "user", content: buildPrompt(date, slots, template, requirements) }] }),
    });
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    throw { summary: "无法连接 AI 服务，可能是网络、代理、证书或 CORS 限制。", detail, url: apiUrl, model, time } satisfies AiError;
  }

  const raw = await response.text();
  let payload: { choices?: Array<{ message?: { content?: string } }>; error?: { message?: string }; message?: string } = {};
  try { payload = raw ? JSON.parse(raw) : {}; } catch { /* 服务商返回的可能不是 JSON */ }
  const responseDetail = (payload.error?.message || payload.message || raw || "服务未返回错误详情").trim().slice(0, MAX_ERROR_DETAIL_LENGTH);
  if (!response.ok) {
    const hint = response.status === 400 ? "请求参数不符合服务商要求，请检查模型或接口协议。" : response.status === 401 ? "API Key 无效或未授权。" : response.status === 403 ? "当前 API Key 没有调用权限。" : response.status === 404 ? "接口地址或模型不存在，请检查配置。" : response.status === 429 ? "请求过于频繁或账户额度不足。" : "请根据服务商返回的错误详情检查配置。";
    throw { summary: `AI 请求失败（HTTP ${response.status}）：${hint}`, detail: responseDetail, status: response.status, url: apiUrl, model, time } satisfies AiError;
  }
  const content = payload.choices?.[0]?.message?.content?.trim();
  if (!content) throw { summary: "AI 已返回响应，但格式不兼容，未找到 choices[0].message.content。", detail: responseDetail, status: response.status, url: apiUrl, model, time } satisfies AiError;
  return content;
}

export default function WorkLogModal({ date, slots, onClose }: { date: string; slots: DailyScheduleSlot[]; onClose: () => void }) {
  const [apiKey, setApiKey] = useState(() => readSetting(API_KEY_STORAGE, ""));
  const [apiUrl, setApiUrl] = useState(() => readSetting(API_URL_STORAGE, DEFAULT_API_URL));
  const [model, setModel] = useState(() => readSetting(MODEL_STORAGE, DEFAULT_MODEL));
  const [logTemplate, setLogTemplate] = useState(() => readSetting(LOG_TEMPLATE_STORAGE, DEFAULT_LOG_TEMPLATE));
  const [logRequirements, setLogRequirements] = useState(() => readSetting(LOG_REQUIREMENTS_STORAGE, DEFAULT_LOG_REQUIREMENTS));
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [content, setContent] = useState(() => localStorage.getItem(`${WORK_LOG_STORAGE_PREFIX}${date}`) || "");
  const [aiError, setAiError] = useState<AiError | null>(null);

  const reviewCount = useMemo(() => slots.filter((slot) => Boolean(slot.actual_notes?.trim()) && slot.met_expectation !== undefined && slot.focused !== undefined).length, [slots]);
  useEffect(() => { setContent(localStorage.getItem(`${WORK_LOG_STORAGE_PREFIX}${date}`) || ""); }, [date]);
  useEffect(() => {
    if (!apiKey) setSettingsOpen(true);
    if (localStorage.getItem(CONFIG_VERSION_STORAGE) !== AI_CONFIG_VERSION) {
      localStorage.setItem(CONFIG_VERSION_STORAGE, AI_CONFIG_VERSION);
      message.info("AI 配置格式已更新，请确认接口地址和模型名称");
    }
  }, [apiKey]);

  const saveSettings = () => {
    const normalizedKey = apiKey.trim();
    const normalizedUrl = apiUrl.trim() || DEFAULT_API_URL;
    const normalizedModel = model.trim() || DEFAULT_MODEL;
    if (!normalizedKey) { message.warning("请输入 AI API Key"); return; }
    localStorage.setItem(API_KEY_STORAGE, normalizedKey);
    localStorage.setItem(API_URL_STORAGE, normalizedUrl);
    localStorage.setItem(MODEL_STORAGE, normalizedModel);
    localStorage.setItem(CONFIG_VERSION_STORAGE, AI_CONFIG_VERSION);
    localStorage.setItem(LOG_TEMPLATE_STORAGE, logTemplate.trim() || DEFAULT_LOG_TEMPLATE);
    localStorage.setItem(LOG_REQUIREMENTS_STORAGE, logRequirements.trim() || DEFAULT_LOG_REQUIREMENTS);
    setApiKey(normalizedKey); setApiUrl(normalizedUrl); setModel(normalizedModel); setLogTemplate(logTemplate.trim() || DEFAULT_LOG_TEMPLATE); setLogRequirements(logRequirements.trim() || DEFAULT_LOG_REQUIREMENTS); setSettingsOpen(false);
    message.success("AI 配置已保存到本机");
  };

  const resetAiDefaults = () => {
    setApiUrl(DEFAULT_API_URL);
    setModel(DEFAULT_MODEL);
    setLogTemplate(DEFAULT_LOG_TEMPLATE);
    setLogRequirements(DEFAULT_LOG_REQUIREMENTS);
    localStorage.removeItem(API_URL_STORAGE);
    localStorage.removeItem(MODEL_STORAGE);
    localStorage.removeItem(LOG_TEMPLATE_STORAGE);
    localStorage.removeItem(LOG_REQUIREMENTS_STORAGE);
    localStorage.setItem(CONFIG_VERSION_STORAGE, AI_CONFIG_VERSION);
    message.success("已恢复默认配置，API Key 未被清除");
  };

  const generate = async () => {
    if (reviewCount === 0) {
      message.warning("请先安排行动并复盘当日完成情况");
      return;
    }
    if (!apiKey.trim()) { setSettingsOpen(true); return; }
    setGenerating(true);
    setAiError(null);
    try { const nextContent = await generateWorkLog(apiKey.trim(), apiUrl.trim() || DEFAULT_API_URL, model.trim() || DEFAULT_MODEL, date, slots, logTemplate.trim() || DEFAULT_LOG_TEMPLATE, logRequirements.trim() || DEFAULT_LOG_REQUIREMENTS); setContent(nextContent); localStorage.setItem(`${WORK_LOG_STORAGE_PREFIX}${date}`, nextContent); }
    catch (cause) {
      const error = cause as AiError;
      const normalized = error?.summary ? error : { summary: "AI 请求失败", detail: cause instanceof Error ? cause.message : String(cause), url: apiUrl, model, time: new Date().toLocaleString("zh-CN") };
      setAiError(normalized);
      console.error("AI 工作日志生成失败", normalized);
      message.error(normalized.summary);
    }
    finally { setGenerating(false); }
  };

  return <>
    <Modal className="work-log-modal" wrapClassName="work-log-modal-wrap" open title="工作日志" width={720} style={{ top: 24, marginBottom: 24 }} onCancel={onClose} destroyOnHidden footer={<Space><Button icon={<Settings size={15} />} onClick={() => setSettingsOpen(true)}>AI 配置</Button><Button onClick={onClose}>关闭</Button>{content && <Button type="primary" onClick={() => { void navigator.clipboard?.writeText(content); message.success("日志已复制"); }}>复制日志</Button>}<Button type="primary" loading={generating} onClick={() => void generate()}>{content ? "重新生成" : "生成工作日志"}</Button></Space>}>
      <div className="work-log-meta"><FileText size={17} /><span>{date} · 已填写 {reviewCount}/{slots.length} 个时段复盘</span></div>
      {!apiKey && <Alert type="info" showIcon icon={<KeyRound size={16} />} message="请先接入自己的 AI API Key" description="API Key 仅保存在本机浏览器中，用于调用你配置的 AI 服务。" />}
      {aiError && <Alert type="error" showIcon message={aiError.summary} description={<Space direction="vertical" size={4}><Typography.Text>请求地址：{aiError.url}</Typography.Text><Typography.Text>实际模型：{aiError.model}</Typography.Text><Typography.Text>发生时间：{aiError.time}</Typography.Text><Button type="link" onClick={() => Modal.info({ title: "AI 错误详情", width: 680, content: <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: 360, overflow: "auto" }}>{aiError.detail}</pre> })}>查看返回详情</Button></Space>} closable onClose={() => setAiError(null)} />}
      {content ? <Input.TextArea className="work-log-content" value={content} onChange={(event) => { const nextContent = event.target.value; setContent(nextContent); localStorage.setItem(`${WORK_LOG_STORAGE_PREFIX}${date}`, nextContent); }} autoSize={{ minRows: 12, maxRows: 20 }} /> : <Typography.Paragraph type="secondary" className="work-log-empty">点击“生成工作日志”，AI 会根据当天每个时间段的行动与复盘，按指定模板整理成一份日志。</Typography.Paragraph>}
    </Modal>
    <Modal className="ai-settings-modal" wrapClassName="ai-settings-modal-wrap" open={settingsOpen} title="AI 配置" style={{ top: 24, marginBottom: 24 }} onCancel={() => setSettingsOpen(false)} onOk={saveSettings} okText="保存配置" cancelText="取消" destroyOnHidden>
      <Form layout="vertical">
        <Form.Item label="API Key" required help="密钥会保存在本机 localStorage，请勿在公共电脑使用。"><Input.Password value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="请输入你的 API Key" /></Form.Item>
        <Form.Item label="接口地址" help="默认使用 OpenAI 兼容接口，也支持其他兼容服务。"><Input value={apiUrl} onChange={(event) => setApiUrl(event.target.value)} placeholder={DEFAULT_API_URL} /></Form.Item>
        <Form.Item label="模型名称"><Input value={model} onChange={(event) => setModel(event.target.value)} placeholder={DEFAULT_MODEL} /></Form.Item>
        <Button type="link" onClick={resetAiDefaults}>恢复默认配置（不清除 API Key）</Button>
        <Form.Item label="日志模板" help="这是发送给 AI 的日志结构提示词，可以按需修改。"><Input.TextArea value={logTemplate} onChange={(event) => setLogTemplate(event.target.value)} autoSize={{ minRows: 8, maxRows: 16 }} /></Form.Item>
        <Form.Item label="日志生成要求" help="AI 会同时遵守日志模板和这里的生成要求。"><Input.TextArea value={logRequirements} onChange={(event) => setLogRequirements(event.target.value)} autoSize={{ minRows: 5, maxRows: 12 }} /></Form.Item>
      </Form>
    </Modal>
  </>;
}

