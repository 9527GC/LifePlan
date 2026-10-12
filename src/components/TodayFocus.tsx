import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { Button, Empty, Tag, Tooltip, theme } from "antd";
import { CheckCircle2, ChevronDown, ChevronUp, CirclePause, Clock3, MessageSquare, Timer } from "lucide-react";
import type { DailyScheduleSlot, PomodoroRecord } from "@/types";
const MINUTE = 60_000;
const time = (value: number) => new Date(value).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
const status = (r: PomodoroRecord) => r.status === 2 ? "已中断" : r.status === 0 ? "已放弃（历史记录）" : r.status === 1 ? "已完成" : "进行中";
const reasons = ["内部分心", "外部干扰", "紧急事务"];
export default function TodayFocus({ records, slots, now, recordLimit, fitHeight = false, recordOrder = "desc" }: { records: PomodoroRecord[]; slots: DailyScheduleSlot[]; now: number; recordLimit?: number; fitHeight?: boolean; recordOrder?: "asc" | "desc" }) {
  const [expanded, setExpanded] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [overflows, setOverflows] = useState(false);
  useLayoutEffect(() => {
    if (!fitHeight) return;
    const list = listRef.current;
    const content = contentRef.current;
    if (!list || !content) return;
    const measure = () => setOverflows(content.scrollHeight > list.clientHeight + 1);
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    observer.observe(content);
    measure();
    return () => observer.disconnect();
  }, [fitHeight, records, slots]);
  const { token } = theme.useToken();
  const midnight = new Date(now); midnight.setHours(0, 0, 0, 0);
  const dayStart = midnight.getTime(); const tomorrow = new Date(midnight); tomorrow.setDate(tomorrow.getDate() + 1); const dayEnd = tomorrow.getTime();
  const at = (s: string) => { const [h, m] = s.split(":").map(Number); const d = new Date(midnight); d.setHours(h, m, 0, 0); return d.getTime(); };
  const items = records.filter(r => r.start_time < dayEnd && (r.end_time ?? now) > dayStart);
  const intervals = items.map(r => ({ r, start: Math.max(dayStart, r.start_time), end: Math.min(dayEnd, r.end_time ?? now, r.start_time + r.planned_seconds * 1000) })).filter(i => i.end > i.start);
  const bounds = slots.flatMap(s => [at(s.start_time), at(s.end_time)]);
  intervals.forEach(i => bounds.push(i.start, i.end));
  if (!bounds.length) return <Empty description="今天还没有时间安排或专注记录" />;
  let start = Math.max(dayStart, Math.floor(Math.min(...bounds) / (60 * MINUTE)) * 60 * MINUTE);
  let end = Math.min(dayEnd, Math.ceil(Math.max(...bounds) / (60 * MINUTE)) * 60 * MINUTE);
  if (slots.length) { start = Math.min(...slots.map(s => at(s.start_time)), ...intervals.map(i => Math.floor(i.start / (60 * MINUTE)) * 60 * MINUTE)); end = Math.max(...slots.map(s => at(s.end_time)), ...intervals.map(i => Math.ceil(i.end / (60 * MINUTE)) * 60 * MINUTE)); }
  if (end <= start) end = Math.min(dayEnd, start + 60 * MINUTE);
  const span = end - start;
  const segments = intervals.flatMap(({ r, start: a, end: b }) => {
    const result: { start: number; end: number; rest: boolean; r: PomodoroRecord }[] = [];
    // 根据当前固定 25 分钟工作、5 分钟休息规则还原实际经过的阶段，不补画提前完成的时间。
    for (let t = r.start_time; t < b; t += 30 * MINUTE) {
      for (const [from, to, rest] of [[t, t + 25 * MINUTE, false], [t + 25 * MINUTE, t + 30 * MINUTE, true]] as const) {
        const left = Math.max(from, a); const right = Math.min(to, b);
        if (right > left) result.push({ start: left, end: right, rest, r });
      }
    }
    return result;
  });
  // 汇总与明细使用同一组有效时段，避免计入裁剪后未展示的历史记录。
  const visibleRecords = intervals.map(interval => interval.r);
  // 仅折叠明细，统计与分布仍使用全天数据；番茄钟默认倒序，复盘可指定正序。
  const orderedIntervals = [...intervals].sort((a, b) => {
    const order = a.r.start_time - b.r.start_time || a.r.id - b.r.id;
    return recordOrder === "asc" ? order : -order;
  });
  const displayedIntervals = recordLimit != null && !expanded ? orderedIntervals.slice(0, recordLimit + 1) : orderedIntervals;
  const canExpand = fitHeight ? overflows : recordLimit != null && intervals.length > recordLimit;
  const focused = segments.filter(s => !s.rest).reduce((sum, s) => sum + s.end - s.start, 0);
  const detail = (r: PomodoroRecord) => <div><strong>{r.action_title || "自由专注"}</strong><div>{time(r.start_time)}–{r.end_time ? time(r.end_time) : "现在"} · {status(r)}</div>{r.status === 2 && r.interrupt_type != null && <div>{reasons[r.interrupt_type]}{r.interrupt_reason ? " · " + r.interrupt_reason : ""}</div>}</div>;
  return <div className={"today-focus" + (fitHeight ? " today-focus--fit" : "") + (fitHeight && overflows && !expanded ? " today-focus--collapsed" : "") + (fitHeight && expanded ? " today-focus--expanded" : "")} style={{ "--focus-work-color": token["blue-4"], "--focus-current-color": token["blue-6"], "--focus-rest-color": token["green-6"], "--focus-interrupted-color": token["orange-6"] } as CSSProperties}>
    <div className="today-focus-summary">
      <div className="today-focus-metric today-focus-metric--duration" style={{ color: token["blue-7"], background: token["blue-1"], borderColor: token["blue-3"] }}>
        <div className="today-focus-metric-label"><Timer size={15} aria-hidden="true" /><span>专注时长</span></div>
        <div className="today-focus-metric-value"><strong>{Math.floor(focused / MINUTE)}</strong><span>分钟</span></div>
      </div>
      <div className="today-focus-metric today-focus-metric--completed" style={{ color: token["green-7"], background: token["green-1"], borderColor: token["green-3"] }}>
        <div className="today-focus-metric-label"><CheckCircle2 size={15} aria-hidden="true" /><span>已完成</span></div>
        <div className="today-focus-metric-value"><strong>{visibleRecords.filter(r => r.status === 1).length}</strong><span>次</span></div>
      </div>
      <div className="today-focus-metric today-focus-metric--interrupted" style={{ color: token["orange-7"], background: token["orange-1"], borderColor: token["orange-3"] }}>
        <div className="today-focus-metric-label"><CirclePause size={15} aria-hidden="true" /><span>已中断</span></div>
        <div className="today-focus-metric-value"><strong>{visibleRecords.filter(r => r.status === 2).length}</strong><span>次</span></div>
      </div>
    </div>
    <div className="today-focus-distribution-header">
      <span className="today-focus-distribution-title">专注分布</span>
      <div className="today-focus-legend"><span><i className="today-focus-dot today-focus-dot--work" aria-hidden="true" />专注</span><span><i className="today-focus-dot today-focus-dot--rest" aria-hidden="true" />休息</span><span><i className="today-focus-dot today-focus-dot--interrupted" aria-hidden="true" />中断</span></div>
    </div>
    <div className="today-focus-ticks">{[0, 1, 2, 3, 4].map(i => <span key={i}>{time(start + span * i / 4)}</span>)}</div>
    <div className="today-focus-track">{segments.map((s, i) => <Tooltip key={i} title={detail(s.r)} trigger={["hover", "click"]}><button aria-label={(s.r.action_title || "自由专注") + " " + time(s.start) + (s.rest ? " 休息" : " 专注")} className={s.rest ? "focus-segment rest" : "focus-segment"} style={{ left: ((s.start - start) / span * 100) + "%", width: ((s.end - s.start) / span * 100) + "%" }} /></Tooltip>)}{intervals.filter(i => i.r.status === 2 || i.r.status === -1).map(i => <Tooltip key={i.r.id} title={detail(i.r)}><span className={i.r.status === 2 ? "focus-end interrupted" : "focus-end ongoing"} style={{ left: Math.min(99.5, (i.end - start) / span * 100) + "%" }} /></Tooltip>)}</div>
    <div ref={listRef} className="pomodoro-history-list today-focus-record-list">
      <div ref={contentRef} className="today-focus-record-content">
      {!visibleRecords.length && <Empty description="今天还没有专注记录" />}
      {displayedIntervals.map(({ r, start: a, end: b }, index) => {
        const isPreview = canExpand && !expanded && index === recordLimit;
        const tone = r.status === 2 ? "interrupted" : r.status === 1 ? "completed" : r.status === 0 ? "historical" : "ongoing";
        const minutes = Math.floor(segments.filter(s => s.r.id === r.id && !s.rest).reduce((sum, s) => sum + s.end - s.start, 0) / MINUTE);
        return <article className={"today-focus-record today-focus-record--" + tone + (isPreview ? " today-focus-record--preview" : "")} aria-hidden={isPreview || undefined} key={r.id}>
          <div className="today-focus-record-header">
            <strong className="today-focus-record-title">{r.action_title || "自由专注"}</strong>
            <Tag className="today-focus-record-status" color={r.status === 1 ? "green" : r.status === 2 ? "orange" : r.status === -1 ? "blue" : "default"}>{status(r)}</Tag>
          </div>
          <div className="today-focus-record-meta">
            <span><Clock3 size={13} aria-hidden="true" />{time(a)}–{r.status === -1 ? "现在" : time(b)}</span>
            <span><Timer size={13} aria-hidden="true" />今日专注 <b>{minutes}</b> 分钟</span>
          </div>
          {r.status === 2 && (r.interrupt_type != null || r.interrupt_reason) && <div className="today-focus-record-reason">
            <MessageSquare size={13} aria-hidden="true" />
            <div>{r.interrupt_type != null && <span className="today-focus-record-reason-label">{reasons[r.interrupt_type] || "中断原因"}</span>}{r.interrupt_reason && <span>{r.interrupt_reason}</span>}</div>
          </div>}
        </article>;
      })}
      </div>
    </div>
    {canExpand && <div className="today-focus-expand-actions">
      <Button type="text" className="today-focus-expand" aria-expanded={expanded} icon={expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />} onClick={() => { if (listRef.current) listRef.current.scrollTop = 0; setExpanded(value => !value); }}>{expanded ? "收起" : `展开全部（共 ${intervals.length} 条）`}</Button>
    </div>}
  </div>;
}
