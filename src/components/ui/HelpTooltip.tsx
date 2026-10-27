import type { CSSProperties, ReactNode } from "react";
import { Tooltip } from "antd";
import { CircleHelp } from "lucide-react";

/** 复用青蛙说明的问号图标与提示浮层样式。 */
export default function HelpTooltip({ children, label, width = 480 }: { children: ReactNode; label: string; width?: number }) {
  return <Tooltip color="#fff" classNames={{ root: "frog-tooltip-popup" }} styles={{ root: { "--help-tooltip-width": `${width}px`, width: `min(${width}px, calc(100vw - 32px))`, maxWidth: `min(${width}px, calc(100vw - 32px))` } as CSSProperties, container: { width: `min(${width}px, calc(100vw - 32px))`, maxWidth: `min(${width}px, calc(100vw - 32px))`, padding: "12px 14px", border: "0", borderRadius: 6, color: "#303133", backgroundColor: "#fff", boxShadow: "0 4px 12px rgba(0, 0, 0, .12)" } }} title={<div className="frog-tooltip">{children}</div>}><span className="frog-help" tabIndex={0} aria-label={label}><CircleHelp size={14} /></span></Tooltip>;
}
