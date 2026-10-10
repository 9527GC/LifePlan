type Props = { label?: string; minHeight?: number; variant?: "content" | "startup" | "floating" };

// 占位沿用正式界面的配色；短暂加载延迟显示文字，减少切换闪烁。
export default function LoadingState({ label = "正在加载页面…", minHeight = 120, variant = "content" }: Props) {
  return <div role="status" aria-live="polite" aria-label={label} className={`loading-state loading-state--${variant}`} style={{ minHeight }}>
    {variant === "startup" && <div className="loading-state-sidebar" aria-hidden="true">LifePlan</div>}
    <div className="loading-state-body"><span className="loading-state-label">{label}</span></div>
  </div>;
}
