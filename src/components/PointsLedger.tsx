import { useEffect, useRef, useState } from "react";
import { Alert, Button, Empty, Modal, Pagination, Select, Space, Spin, Tag, Typography, theme } from "antd";
import { Gift } from "lucide-react";
import { pointsApi, type PointsEntry } from "@/lib/api";
import { userFacingError } from "@/lib/errors";
const labels: Record<string, string> = { focus: "专注奖励", event: "事件完成", exchange: "奖励兑换", revoke: "奖励撤回", opening: "历史余额调整" };
export default function PointsLedger({ open, onClose, balance, onRedeem }: { open: boolean; onClose: () => void; balance: number; onRedeem?: () => void }) {
  const { token } = theme.useToken();
  const [entries, setEntries] = useState<PointsEntry[]>([]);
  const [kind, setKind] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");
  const revision = useRef(0);
  const load = async () => {
    const version = ++revision.current;
    setLoading(true); setError("");
    try {
      const result = await pointsApi.list(page, kind);
      if (version !== revision.current) return;
      setTotal(result.total);
      setEntries(result.entries);
      listRef.current?.scrollTo({ top: 0 });
    } catch (e) { if (version === revision.current) setError(userFacingError(e)); }
    finally { if (version === revision.current) setLoading(false); }
  };
  useEffect(() => { if (open) { setEntries([]); void load(); } return () => { revision.current++; }; }, [open, kind, page]);
  return <Modal className="points-ledger-modal" title="积分流水" open={open} onCancel={onClose} afterClose={() => { setPage(1); setKind(undefined); }} footer={null} width={620}>
    <div className="points-ledger-toolbar">
      <Space size={8} wrap>
        <div className="rewards-balance points-ledger-balance"><Gift size={18} aria-hidden="true" />{balance}<span>积分</span></div>

      </Space>
      <Select aria-label="流水类型" value={kind} placeholder="全部类型" allowClear style={{ width: 150 }} onChange={value => { setKind(value); setPage(1); }} options={["focus", "event", "exchange"].map(value => ({ value, label: labels[value] }))} />
    </div>
    {error && <Alert type="error" title={error} action={<Button onClick={() => void load()}>重试</Button>} />}
    <div className="points-ledger-list" ref={listRef}>
      {!loading && !error && entries.length === 0 && <Empty description="暂无积分流水" />}
      {entries.map(item => <article className="pomodoro-history-item points-ledger-entry" style={{ borderBottomColor: token.colorBorderSecondary }} key={item.id}>
        <div className="points-ledger-entry-row">
          <div className="points-ledger-entry-body">
            <div className="points-ledger-entry-heading">
              <Tag color={item.kind === "focus" ? "blue" : item.kind === "event" ? "green" : item.kind === "exchange" ? "gold" : item.kind === "revoke" ? "error" : undefined}>{labels[item.kind] ?? item.kind}</Tag>
              <Typography.Text>{item.content}</Typography.Text>
            </div>
          </div>
          <div className="points-ledger-amount">
            <Typography.Text type="secondary" className="points-ledger-entry-time" style={{ fontSize: token.fontSizeSM }}>{new Date(item.occurred_at).toLocaleString("zh-CN")}</Typography.Text>
            <Typography.Text strong style={{ color: item.amount > 0 ? token.colorPrimary : item.amount < 0 ? token.colorError : token.colorTextSecondary, fontSize: token.fontSizeLG }}>{item.amount > 0 ? "+" : ""}{item.amount}</Typography.Text>
          </div>
        </div>
      </article>)}
      {loading && <div className="points-ledger-loading"><Spin /></div>}
    </div>
    <div className="points-ledger-footer">
      {onRedeem && <Button type="link" className="points-ledger-redeem" onClick={onRedeem}>前往奖励池兑换 &gt;</Button>}
      <Pagination size="small" current={page} pageSize={20} total={total} showSizeChanger={false} disabled={loading} onChange={setPage} />
    </div>
  </Modal>;
}
