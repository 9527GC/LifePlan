import { useEffect, useRef, useState, type ClipboardEvent } from "react";
import { Alert, Button, Card, Empty, Form, Input, InputNumber, Modal, Pagination, Popconfirm, Space, Spin, Tag, Typography, message } from "antd";
import { Camera, Eye, Gift, History, ImagePlus, Pencil, Plus, Share2, ShoppingBag, Trash2 } from "lucide-react";
import QRCode from "qrcode";
import { rewardsApi } from "@/lib/api";
import type { NewReward, Reward, RewardCheckin, RewardExchange, RewardsOverview } from "@/types";
import { userFacingError } from "@/lib/errors";
import { showSavedToast } from "@/lib/savedToast";
import { track } from "@/lib/analytics";

type RewardFormValues = NewReward;

const REWARD_ICONS = [
  ["🎁", "礼物"], ["☕", "咖啡"], ["🍰", "甜点"], ["🍔", "美食"], ["📚", "书籍"], ["🛍️", "购物"],
  ["📺", "电视剧"], ["🎬", "电影"], ["🎮", "游戏"], ["🎵", "音乐"], ["📱", "手机娱乐"], ["😴", "睡觉"],
  ["🌙", "夜晚"], ["🛌", "睡懒觉"], ["🧘", "冥想"], ["🛁", "泡澡"], ["🧹", "打扫"], ["🍳", "做饭"],
  ["🧽", "清洁"], ["💐", "鲜花"], ["💬", "聊天"], ["📖", "阅读"], ["🎓", "学习"], ["💡", "灵感"],
  ["✍️", "写作"], ["📝", "笔记"], ["🚶", "散步"], ["🥾", "徒步"], ["⛰️", "爬山"], ["🚴", "骑车"], ["🎣", "钓鱼"], ["🏃", "跑步"], ["🤸", "拉伸"],
] as const

const RELEASE_URL = "https://github.com/9527GC/LifePlan/releases";

/** 将图片 dataURL 压缩到最长边不超过 maxEdge，输出 jpeg，减小存储与海报绘制体积。 */
function compressImage(dataUrl: string, maxEdge = 1400): Promise<string> {
  return loadImage(dataUrl).then((img) => {
    const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
    if (scale >= 1) return dataUrl;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return dataUrl;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.88);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("图片加载失败"));
    img.src = src;
  });
}

/** 按最大宽度对文本做换行（支持中英文），返回行数组。 */
function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    if (!paragraph) { lines.push(""); continue; }
    let current = "";
    for (const char of paragraph) {
      const test = current + char;
      if (ctx.measureText(test).width > maxWidth && current) { lines.push(current); current = char; }
      else current = test;
    }
    lines.push(current);
  }
  return lines;
}

function drawCover(ctx: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, w: number, h: number) {
  const radius = 16;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
  ctx.clip();
  const scale = Math.max(w / img.width, h / img.height);
  const dw = img.width * scale;
  const dh = img.height * scale;
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  ctx.restore();
}

interface PosterInput {
  rewardName: string;
  icon: string;
  description?: string | null;
  imageBase64?: string | null;
  exchangedAt: number;
  pointsUsed: number;
}

/** 生成分享海报，返回 PNG dataURL。 */
async function buildPoster(input: PosterInput): Promise<string> {
  const W = 720;
  const PAD = 56;
  const CONTENT_W = W - PAD * 2;
  const IMG_SIZE = CONTENT_W;
  const headerH = 232;
  const descFont = "28px 'PingFang SC', 'Microsoft YaHei', sans-serif";
  const descLineH = 52;
  const footerH = 250;

  // 预加载图片与二维码
  const qrDataUrl = await QRCode.toDataURL(RELEASE_URL, { width: 320, margin: 1, color: { dark: "#1f2733", light: "#ffffff" } });
  const [qrImg, photo] = await Promise.all([
    loadImage(qrDataUrl),
    input.imageBase64 ? loadImage(input.imageBase64) : Promise.resolve(null as HTMLImageElement | null),
  ]);

  // 测量描述换行
  const measure = document.createElement("canvas").getContext("2d")!;
  measure.font = descFont;
  const descText = (input.description || "").trim();
  const descLines = descText ? wrapText(measure, descText, CONTENT_W) : [];
  const descH = descLines.length ? descLines.length * descLineH + 44 : 0;

  const H = headerH + IMG_SIZE + (descH ? descH + 24 : 0) + footerH;

  const canvas = document.createElement("canvas");
  const ratio = 2;
  canvas.width = W * ratio;
  canvas.height = H * ratio;
  canvas.style.width = `${W}px`;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(ratio, ratio);

  // 背景
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);
  const topBand = ctx.createLinearGradient(0, 0, W, 0);
  topBand.addColorStop(0, "#1778ff");
  topBand.addColorStop(1, "#4f9bff");
  ctx.fillStyle = topBand;
  ctx.fillRect(0, 0, W, 8);

  // 头部：logo + 标题（复刻应用内 SVG logo：蓝色圆角方块 + 白色折角）
  ctx.fillStyle = "#1778ff";
  roundRect(ctx, PAD, 40, 40, 40, 10); ctx.fill();
  ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 3; ctx.lineCap = "round"; ctx.lineJoin = "round";
  ctx.beginPath(); ctx.moveTo(PAD + 18.75, 51.875); ctx.lineTo(PAD + 18.75, 63.75); ctx.lineTo(PAD + 26.875, 63.75); ctx.stroke();
  ctx.fillStyle = "#1f2733"; ctx.font = "bold 26px 'PingFang SC', 'Microsoft YaHei', sans-serif"; ctx.textBaseline = "middle"; ctx.textAlign = "left"; ctx.fillText("LifePlan", PAD + 52, 61);
  ctx.fillStyle = "#8a94a6"; ctx.font = "17px 'PingFang SC', 'Microsoft YaHei', sans-serif"; ctx.textAlign = "right"; ctx.fillText("奖励打卡", W - PAD, 62); ctx.textAlign = "left";

  // 奖励名 + 元信息
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#1f2733"; ctx.font = "bold 34px 'PingFang SC', 'Microsoft YaHei', sans-serif";
  const title = `${input.icon || "🎁"} ${input.rewardName}`;
  ctx.fillText(title, PAD, 150);
  ctx.fillStyle = "#8a94a6"; ctx.font = "18px 'PingFang SC', 'Microsoft YaHei', sans-serif";
  const meta = `${new Date(input.exchangedAt).toLocaleString("zh-CN")} · 消耗 ${input.pointsUsed} 积分`;
  ctx.fillText(meta, PAD, 186);

  // 图片区
  const imgY = headerH;
  if (photo) {
    drawCover(ctx, photo, PAD, imgY, IMG_SIZE, IMG_SIZE);
    ctx.strokeStyle = "#eef1f6"; ctx.lineWidth = 1; roundRect(ctx, PAD + .5, imgY + .5, IMG_SIZE - 1, IMG_SIZE - 1, 16); ctx.stroke();
  } else {
    ctx.fillStyle = "#f5f7fb"; roundRect(ctx, PAD, imgY, IMG_SIZE, IMG_SIZE, 16); ctx.fill();
    ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.font = "120px serif"; ctx.fillText(input.icon || "🎁", W / 2, imgY + IMG_SIZE / 2);
    ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
  }

  // 描述
  let cursorY = imgY + IMG_SIZE + 64;
  if (descLines.length) {
    ctx.fillStyle = "#33405a"; ctx.font = descFont;
    for (const line of descLines) { ctx.fillText(line, PAD, cursorY); cursorY += descLineH; }
  }

  // 底部
  const footerY = H - footerH;
  ctx.strokeStyle = "#eef1f6"; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(PAD, footerY); ctx.lineTo(W - PAD, footerY); ctx.stroke();
  ctx.fillStyle = "#1f2733"; ctx.font = "bold 24px 'PingFang SC', 'Microsoft YaHei', sans-serif";
  ctx.fillText("LifePlan·人生大事拆为可落地小行动", PAD, footerY + 76);
  ctx.fillStyle = "#5a6472"; ctx.font = "19px 'PingFang SC', 'Microsoft YaHei', sans-serif";
  ctx.fillText("再微不足道的成就都值得大肆庆祝", PAD, footerY + 112);
  ctx.fillStyle = "#5a6472"; ctx.font = "17px 'PingFang SC', 'Microsoft YaHei', sans-serif"; ctx.fillText(RELEASE_URL, PAD, footerY + 144);
  const qrSize = 108; const qrX = W - PAD - qrSize; const qrY = footerY + 44;
  ctx.drawImage(qrImg, qrX, qrY, qrSize, qrSize); ctx.fillStyle = "#8a94a6"; ctx.font = "16px 'PingFang SC', 'Microsoft YaHei', sans-serif"; ctx.textAlign = "center"; ctx.fillText("扫码获取 LifePlan", qrX + qrSize / 2, qrY + qrSize + 18); ctx.textAlign = "left";

  return canvas.toDataURL("image/png");
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function CheckinModal({ open, exchange, onClose, onSaved, onOpenPoster }: { open: boolean; exchange: RewardExchange | null; onClose: () => void; onSaved: (exchangeId: number, openPoster: boolean) => void; onOpenPoster: (exchangeId: number) => void }) {
  const [image, setImage] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const hasCheckin = !!exchange?.checkin;
  const [editing, setEditing] = useState(false);
  const [original, setOriginal] = useState<{ image: string | null; description: string }>({ image: null, description: "" });
  const canEdit = !hasCheckin || editing;

  useEffect(() => {
    if (!open || !exchange) return;
    setEditing(!exchange.checkin);
    if (exchange.checkin) {
      setLoading(true);
      void rewardsApi.getCheckin(exchange.id).then((record) => {
        const img = record.image_base64 || null;
        const desc = record.description || "";
        setImage(img);
        setDescription(desc);
        setOriginal({ image: img, description: desc });
      }).catch((cause) => message.error(userFacingError(cause))).finally(() => setLoading(false));
    } else {
      setImage(null);
      setDescription("");
    }
  }, [open, exchange]);

  const pickFile = async (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) { message.warning("请选择图片文件"); return; }
    const reader = new FileReader();
    reader.onload = async () => {
      try { setImage(await compressImage(reader.result as string)); }
      catch { setImage(reader.result as string); }
    };
    reader.readAsDataURL(file);
  };

  // 粘贴图片：仅当焦点在“上传图片”框上时生效（Ctrl+V）；已上传图片时该框不渲染，需先删除才能粘贴
  const uploadRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open || image || !canEdit) return;
    // 双保险：Modal 内容经 portal 挂载后，下一帧再聚焦，确保蓝框与可粘贴状态生效
    const raf = requestAnimationFrame(() => uploadRef.current?.focus());
    return () => cancelAnimationFrame(raf);
  }, [open, image, canEdit]);
  const handlePaste = (event: ClipboardEvent<HTMLButtonElement>) => {
    const items = event.clipboardData?.items;
    if (!items) return;
    for (let idx = 0; idx < items.length; idx += 1) {
      const item = items[idx];
      if (item.kind === "file" && item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) { event.preventDefault(); void pickFile(file); message.success("已粘贴图片"); return; }
      }
    }
  };

  const save = async (openPoster: boolean) => {
    if (!exchange) return;
    if (!image) { message.warning("请先上传一张图片"); return; }
    setSaving(true);
    try {
      await rewardsApi.saveCheckin({ exchangeId: exchange.id, imageBase64: image, description });
      track("奖励打卡", { points_used: exchange.points_used });
      message.success("打卡已保存");
      if (hasCheckin) {
        // 编辑已有打卡：不关闭弹框，更新原始快照并回到查看态（显示最新内容）
        setOriginal({ image, description });
        setEditing(false);
      } else {
        onSaved(exchange.id, openPoster);
      }
    } catch (cause) {
      message.error(userFacingError(cause));
    } finally {
      setSaving(false);
    }
  };

  // 编辑态的“取消”= 还原到原始记录并回到查看态；其余情况直接关闭弹框
  const cancel = () => {
    if (hasCheckin && editing) { setImage(original.image); setDescription(original.description); setEditing(false); }
    else { onClose(); }
  };

  return <Modal className="checkin-modal" wrapClassName="checkin-modal-wrap" open={open} onCancel={onClose} destroyOnHidden afterOpenChange={(visible) => { if (visible && !image && canEdit) uploadRef.current?.focus(); }} width={520} title={<Space>{hasCheckin ? <Eye size={17} /> : <Camera size={17} />}{hasCheckin ? "查看打卡" : "打卡分享"}</Space>} footer={<Space className="modal-footer-actions"><Button onClick={cancel}>取消</Button>{!hasCheckin && <Button icon={<Share2 size={15} />} loading={saving} onClick={() => void save(true)}>生成海报</Button>}{hasCheckin && !editing && <Button icon={<Share2 size={15} />} onClick={() => exchange && onOpenPoster(exchange.id)}>查看海报</Button>}{hasCheckin && !editing && <Button type="primary" onClick={() => setEditing(true)}>编辑</Button>}{(!hasCheckin || editing) && <Button type="primary" loading={saving} onClick={() => void save(false)}>保存</Button>}</Space>}>
    <Spin spinning={loading}>
      <div className="checkin-reward"><Typography.Text strong>{exchange?.reward_name}</Typography.Text></div>
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={(event) => void pickFile(event.target.files?.[0])} />
      {image ? <div className="checkin-preview"><img src={image} alt="打卡图片" />{canEdit && <Button size="small" className="checkin-preview-change" onClick={() => fileRef.current?.click()}>更换图片</Button>}{canEdit && <Button size="small" danger className="checkin-preview-remove" icon={<Trash2 size={13} />} onClick={() => setImage(null)} />}</div>
        : canEdit ? <button type="button" ref={uploadRef} className="checkin-upload" onPaste={handlePaste} onClick={() => fileRef.current?.click()}><ImagePlus size={26} /><span>上传图片</span><Typography.Text type="secondary" className="checkin-hint">也可 Ctrl+V 粘贴图片</Typography.Text></button> : null}
      {canEdit ? <Input.TextArea className="checkin-desc" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="写下这次的感受或记录…" autoSize={{ minRows: 3, maxRows: 6 }} maxLength={500} showCount /> : description ? <Typography.Paragraph className="checkin-desc-view">{description}</Typography.Paragraph> : null}
    </Spin>
  </Modal>;
}

function PosterModal({ open, checkin, onClose }: { open: boolean; checkin: RewardCheckin | null; onClose: () => void }) {
  const [poster, setPoster] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    if (!open || !checkin) { setPoster(null); return; }
    setGenerating(true);
    void buildPoster({ rewardName: checkin.reward_name, icon: checkin.icon, description: checkin.description, imageBase64: checkin.image_base64, exchangedAt: checkin.exchanged_at, pointsUsed: checkin.points_used })
      .then(setPoster)
      .catch((cause) => message.error(userFacingError(cause)))
      .finally(() => setGenerating(false));
  }, [open, checkin]);

  const download = async () => {
    if (!poster) return;
    setDownloading(true);
    try {
      const path = await rewardsApi.savePoster(poster);
      showSavedToast("海报已下载到「下载」文件夹", path);
    } catch (cause) {
      message.error(userFacingError(cause));
    } finally {
      setDownloading(false);
    }
  };

  return <Modal className="poster-modal" wrapClassName="poster-modal-wrap" open={open} onCancel={onClose} destroyOnHidden width={460} title={<Space><Share2 size={17} />分享海报</Space>} footer={<Space className="modal-footer-actions"><Button onClick={onClose}>关闭</Button><Button type="primary" icon={<ImagePlus size={15} />} loading={downloading} disabled={!poster || generating} onClick={() => void download()}>下载海报</Button></Space>}>
    <div className="poster-stage">{generating || !poster ? <div className="poster-loading"><Spin /><span>正在生成海报…</span></div> : <img src={poster} alt="打卡海报" />}</div>
  </Modal>;
}

export default function Rewards() {
  const [data, setData] = useState<RewardsOverview>({ total_points: 0, rewards: [], exchanges: [] });
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Reward>();
  const [saving, setSaving] = useState(false);
  const [exchangePage, setExchangePage] = useState(1);
  const [checkinTarget, setCheckinTarget] = useState<RewardExchange | null>(null);
  const [posterCheckin, setPosterCheckin] = useState<RewardCheckin | null>(null);
  const [form] = Form.useForm<RewardFormValues>();
  const selectedIcon = Form.useWatch("icon", form) as string | undefined;

  const load = async () => {
    try {
      setData(await rewardsApi.overview());
      setError("");
    } catch (cause) {
      setError(userFacingError(cause));
    }
  };

  useEffect(() => { void load(); }, []);

  const showForm = (reward?: Reward) => {
    setEditing(reward);
    form.resetFields();
    form.setFieldsValue(reward
      ? { name: reward.name, points_required: reward.points_required, icon: reward.icon }
      : { name: "", points_required: 15, icon: REWARD_ICONS[0][0] });
    setOpen(true);
  };

  const chooseIcon = (icon: string) => {
    form.setFieldValue("icon", icon);
  };

  const save = async (values: RewardFormValues) => {
    setSaving(true);
    try {
      const payload: NewReward = { name: values.name, description: "", points_required: values.points_required, category: "其他", icon: values.icon };
      if (editing) await rewardsApi.update({ ...payload, id: editing.id });
      else { await rewardsApi.create(payload); track("创建奖励", { points_required: payload.points_required }); }
      setOpen(false);
      await load();
      message.success(editing ? "奖励已更新" : "奖励已加入奖励池");
    } catch (cause) {
      setError(userFacingError(cause));
    } finally {
      setSaving(false);
    }
  };

  const exchange = async (reward: Reward) => {
    try {
      setData(await rewardsApi.exchange(reward.id)); track("兑换奖励", { points_required: reward.points_required });
      message.success(`已兑换：${reward.name}`);
    } catch (cause) {
      setError(userFacingError(cause));
    }
  };

  const archive = async (id: number) => {
    try {
      await rewardsApi.archive(id);
      await load();
    } catch (cause) {
      setError(userFacingError(cause));
    }
  };

  const handleCheckinSaved = async (exchangeId: number, openPoster: boolean) => {
    setCheckinTarget(null);
    try {
      await load();
      if (openPoster) setPosterCheckin(await rewardsApi.getCheckin(exchangeId));
    } catch (cause) {
      setError(userFacingError(cause));
    }
  };

  return <div className="page rewards-page">
    <header className="page-header">
      <div><Typography.Title level={2} className="page-title">奖励池</Typography.Title><Typography.Paragraph className="page-subtitle">把积分换成真正期待的奖励，让坚持变得有回报。</Typography.Paragraph></div>
      <div className="rewards-header-actions"><Button type="primary" icon={<Plus size={15} />} onClick={() => showForm()}>添加奖励</Button><div className="rewards-balance"><Gift size={20} />{data.total_points}<span>积分</span></div></div>
    </header>
    {error && <Alert className="page-alert" type="error" showIcon message={error} closable onClose={() => setError("")} />}
    <div className="reward-grid">
      {data.rewards.length === 0 ? <Card bordered={false} className="card reward-empty"><Empty description="奖励池还是空的，添加一个想要的奖励吧" /></Card> : data.rewards.map((reward) => <Card key={reward.id} bordered={false} className="reward-card">
        <div className="reward-card-top"><div className="reward-card-icon">{reward.icon || "🎁"}</div><Tag color="gold" className="reward-points-tag">{reward.points_required} 积分</Tag></div>
        <Typography.Title level={4} ellipsis={{ rows: 1 }}>{reward.name}</Typography.Title>
        <div className="reward-card-footer"><Space size={2} className="reward-card-actions"><Button size="small" type="text" icon={<Pencil size={14} />} onClick={() => showForm(reward)} /><Popconfirm title="归档这个奖励？" onConfirm={() => void archive(reward.id)} okText="归档" cancelText="取消"><Button size="small" danger type="text" icon={<Trash2 size={14} />} /></Popconfirm><Button size="small" type="primary" icon={<ShoppingBag size={14} />} disabled={data.total_points < reward.points_required} onClick={() => void exchange(reward)}>兑换</Button></Space></div>
      </Card>)}
    </div>
    <Card title={<Space><History size={17} />兑换记录</Space>} bordered={false} className="exchange-card">
      {data.exchanges.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有兑换记录" /> : <>
        <div className="exchange-list">{data.exchanges.slice((exchangePage - 1) * 10, exchangePage * 10).map((item) => {
          const reward = data.rewards.find((candidate) => candidate.id === item.reward_id);
          const icon = reward?.icon || "🎁";
          return <div className="exchange-row" key={item.id}>
            <div className="exchange-row-content"><span className="exchange-row-icon" aria-hidden="true">{icon}</span><span className="exchange-row-name">{item.reward_name}</span></div>
            <div className="exchange-row-actions"><span className="exchange-row-meta">-{item.points_used} 积分 · {new Date(item.exchanged_at).toLocaleString("zh-CN")}</span><Button size="small" type={item.checkin ? "default" : "primary"} icon={item.checkin ? <Eye size={13} /> : <Camera size={13} />} onClick={() => setCheckinTarget(item)}>{item.checkin ? "查看" : "打卡"}</Button></div>
          </div>;
        })}</div>
        <Pagination className="exchange-pagination" current={exchangePage} pageSize={10} total={data.exchanges.length} hideOnSinglePage showSizeChanger={false} onChange={setExchangePage} />
      </>}
    </Card>
    <Modal title={editing ? "编辑奖励" : "添加奖励"} open={open} onCancel={() => setOpen(false)} footer={null} destroyOnHidden>
      <Form form={form} layout="vertical" onFinish={(values) => void save(values)}>
        <Form.Item name="name" label="奖励名称" rules={[{ required: true, message: "请输入奖励名称" }]}><Input placeholder="例如：看一集喜欢的剧" /></Form.Item>
        <Form.Item name="icon" label="奖励图标" rules={[{ required: true, message: "请选择奖励图标" }]}>
          <div className="reward-icon-picker reward-icon-options">
            {REWARD_ICONS.map(([icon, meaning]) => <button type="button" key={icon} className={`reward-icon-option ${selectedIcon === icon ? "is-selected" : ""}`} onClick={() => chooseIcon(icon)} title={meaning} aria-label={meaning}>{icon}</button>)}
          </div>
        </Form.Item>
        <Form.Item name="points_required" label="所需积分" rules={[{ required: true, type: "number", min: 1, message: "请输入大于 0 的积分" }]}><InputNumber className="full-width" min={1} precision={0} placeholder="建议 15 起" /></Form.Item>
        <Space className="modal-footer-actions"><Button onClick={() => setOpen(false)}>取消</Button><Button type="primary" htmlType="submit" loading={saving}>保存</Button></Space>
      </Form>
    </Modal>
    <CheckinModal open={!!checkinTarget} exchange={checkinTarget} onClose={() => setCheckinTarget(null)} onSaved={(id, withPoster) => void handleCheckinSaved(id, withPoster)} onOpenPoster={(id) => void rewardsApi.getCheckin(id).then(setPosterCheckin).catch((cause) => setError(userFacingError(cause)))} />
    <PosterModal open={!!posterCheckin} checkin={posterCheckin} onClose={() => setPosterCheckin(null)} />
  </div>;
}







