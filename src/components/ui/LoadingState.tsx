type Props = { label?: string; minHeight?: number };

// 页面和编辑器共用轻量占位，避免为加载提示引入额外组件依赖。
export default function LoadingState({ label = "正在加载页面…", minHeight = 120 }: Props) {
  return <div role="status" aria-live="polite" style={{ minHeight, display: "flex", alignItems: "center", justifyContent: "center", color: "#666" }}>{label}</div>;
}
