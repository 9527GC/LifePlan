import { useRef, useState } from "react";
import { Button, Checkbox, Input, Modal, Radio, Space, message } from "antd";
import { ImagePlus, X } from "lucide-react";
import { createAnalyticsLogAttachment } from "@/lib/analytics";
import { submitFeedback, type FeedbackAttachment, type FeedbackPayload } from "@/lib/feedback";

const feedbackTypes = [
  { value: "bug", label: "遇到 Bug" },
  { value: "suggestion", label: "功能建议" },
  { value: "question", label: "使用疑问" },
  { value: "other", label: "其他" },
] as const;

const MAX_ATTACHMENTS = 5;
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("读取图片失败"));
    reader.readAsDataURL(file);
  });
}

export default function FeedbackModal({ open, onClose, currentPage }: { open: boolean; onClose: () => void; currentPage: string }) {
  const [type, setType] = useState<FeedbackPayload["type"]>("bug");
  const [content, setContent] = useState("");
  const [contact, setContact] = useState("");
  const [allowContact, setAllowContact] = useState(true);
  const [includeDiagnostics, setIncludeDiagnostics] = useState(true);
  const [attachments, setAttachments] = useState<FeedbackAttachment[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setType("bug"); setContent(""); setContact(""); setAllowContact(true); setIncludeDiagnostics(true); setAttachments([]);
  };

  const handleClose = () => { if (!submitting) { reset(); onClose(); } };

  const addFiles = async (files: File[]) => {
    const images = files.filter((file) => file.type.startsWith("image/"));
    if (images.length !== files.length) message.warning("只能添加图片文件。");
    for (const file of images) {
      if (attachments.length >= MAX_ATTACHMENTS) { message.warning(`最多添加 ${MAX_ATTACHMENTS} 张截图。`); break; }
      if (file.size > MAX_ATTACHMENT_BYTES) { message.warning(`${file.name} 超过 5 MB，已跳过。`); continue; }
      try {
        const dataUrl = await readFile(file);
        setAttachments((current) => current.length < MAX_ATTACHMENTS ? [...current, { name: file.name, mimeType: file.type, dataUrl }] : current);
      } catch { message.error(`读取 ${file.name} 失败。`); }
    }
  };

  const handleSubmit = async () => {
    const description = content.trim();
    if (!description) { message.warning("问题描述不能为空。"); return; }
    if (Array.from(description).length < 8) { message.warning("问题描述不能少于 8 个字。"); return; }
    setSubmitting(true);
    try {
      let feedbackAttachments = attachments;
      if (includeDiagnostics) {
        try {
          feedbackAttachments = [...attachments, await createAnalyticsLogAttachment()];
        } catch (error) {
          // 日志附件生成失败不应打断反馈，也不向普通用户暴露开发侧限制。
          console.warn("反馈操作日志附件生成失败：", error);
        }
      }
      await submitFeedback({ type, content, contact: contact.trim() || undefined, allowContact, includeDiagnostics, currentPage, attachments: feedbackAttachments });
      message.success("反馈已提交，感谢你的建议！");
      reset(); onClose();
    } catch (error) {
      message.error(error instanceof Error ? error.message : "反馈提交失败，稍后再试。");
    } finally { setSubmitting(false); }
  };

  return <Modal open={open} title="问题反馈" onCancel={handleClose} destroyOnHidden width={640} footer={<Space><Button onClick={handleClose} disabled={submitting}>取消</Button><Button type="primary" loading={submitting} onClick={() => void handleSubmit()}>提交反馈</Button></Space>}>
    <div className="feedback-form">
      <label className="feedback-field">
        <span>反馈类型</span>
        <Radio.Group className="feedback-type-group" value={type} onChange={(event) => setType(event.target.value as FeedbackPayload["type"])} optionType="button" buttonStyle="solid">
          {feedbackTypes.map((item) => <Radio.Button key={item.value} value={item.value}>{item.label}</Radio.Button>)}
        </Radio.Group>
      </label>
      <label className="feedback-field">
        <span className="feedback-field-label-required">问题描述</span>
        <Input.TextArea value={content} onChange={(event) => setContent(event.target.value)} required minLength={8} autoSize={{ minRows: 4, maxRows: 12 }} placeholder="请描述操作步骤、实际结果和期望结果……" />
      </label>
      <div className="feedback-attachments"><div className="feedback-field-label">截图（选填）</div><div className="feedback-attachment-list">{attachments.map((attachment, index) => <div className="feedback-attachment" key={`${attachment.name}-${index}`}><img src={attachment.dataUrl} alt={attachment.name} /><button type="button" aria-label={`移除 ${attachment.name}`} onClick={() => setAttachments((current) => current.filter((_, itemIndex) => itemIndex !== index))}><X size={14} /></button></div>)}<Button className="feedback-add-image" type="dashed" icon={<ImagePlus size={22} />} aria-label="添加图片" title="添加图片" onClick={() => fileInputRef.current?.click()} disabled={attachments.length >= MAX_ATTACHMENTS} /></div><input ref={fileInputRef} hidden type="file" accept="image/png,image/jpeg,image/webp" multiple onChange={(event) => { void addFiles(Array.from(event.target.files ?? [])); event.currentTarget.value = ""; }} /></div>
      <label className="feedback-field"><span>联系方式（选填）</span><Input value={contact} onChange={(event) => setContact(event.target.value)} placeholder="邮箱或其他联系方式" maxLength={200} /></label>
      <Checkbox checked={allowContact} onChange={(event) => setAllowContact(event.target.checked)}>允许我们通过联系方式回复</Checkbox>
      <Checkbox checked={includeDiagnostics} onChange={(event) => setIncludeDiagnostics(event.target.checked)}>附带应用诊断信息和操作日志（均不包含任务内容）</Checkbox>
    </div>
  </Modal>;
}
