import { useEffect, useState } from "react";
import { Alert, Button, Card, Empty, Form, Input, InputNumber, Modal, Pagination, Popconfirm, Space, Tag, Typography, message } from "antd";
import { Gift, History, Pencil, Plus, ShoppingBag, Trash2 } from "lucide-react";
import { rewardsApi } from "@/lib/api";
import type { NewReward, Reward, RewardsOverview } from "@/types";
import { userFacingError } from "@/lib/errors";
import { track } from "@/lib/analytics";

type RewardFormValues = NewReward;

const REWARD_ICONS = [
  ["🎁", "礼物"], ["☕", "咖啡"], ["🍰", "甜点"], ["🍔", "美食"], ["📚", "书籍"], ["🛍️", "购物"],
  ["📺", "电视剧"], ["🎬", "电影"], ["🎮", "游戏"], ["🎵", "音乐"], ["📱", "手机娱乐"], ["😴", "睡觉"],
  ["🌙", "夜晚"], ["🛌", "睡懒觉"], ["🧘", "冥想"], ["🛁", "泡澡"], ["🧹", "打扫"], ["🍳", "做饭"],
  ["🧽", "清洁"], ["💐", "鲜花"], ["💬", "聊天"], ["📖", "阅读"], ["🎓", "学习"], ["💡", "灵感"],
  ["✍️", "写作"], ["📝", "笔记"], ["🚶", "散步"], ["🥾", "徒步"], ["⛰️", "爬山"], ["🚴", "骑车"], ["🎣", "钓鱼"], ["🏃", "跑步"], ["🤸", "拉伸"],
] as const

export default function Rewards() {
  const [data, setData] = useState<RewardsOverview>({ total_points: 0, rewards: [], exchanges: [] });
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Reward>();
  const [saving, setSaving] = useState(false);
  const [exchangePage, setExchangePage] = useState(1);
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
      : { name: "", points_required: 3, icon: REWARD_ICONS[0][0] });
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
            <span className="exchange-row-meta">-{item.points_used} 积分 · {new Date(item.exchanged_at).toLocaleString("zh-CN")}</span>
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
        <Form.Item name="points_required" label="所需积分" rules={[{ required: true, type: "number", min: 1, message: "请输入大于 0 的积分" }]}><InputNumber className="full-width" min={1} precision={0} /></Form.Item>
        <Space className="modal-footer-actions"><Button onClick={() => setOpen(false)}>取消</Button><Button type="primary" htmlType="submit" loading={saving}>保存</Button></Space>
      </Form>
    </Modal>
  </div>;
}







