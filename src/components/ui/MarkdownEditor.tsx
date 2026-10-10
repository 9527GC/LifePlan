import { lazy, Suspense } from "react";
import LoadingState from "./LoadingState";
import type { MarkdownEditorProps } from "./MarkdownEditorImpl";

// 仅在实际挂载编辑器时加载富文本依赖，保持原有属性和回调契约。
const MarkdownEditorImpl = lazy(() => import("./MarkdownEditorImpl"));

export default function MarkdownEditor(props: MarkdownEditorProps) {
  return <Suspense fallback={<LoadingState label="正在加载编辑器…" minHeight={props.minHeight ?? 160} />}><MarkdownEditorImpl {...props} /></Suspense>;
}
