import { Component, type ReactNode } from "react";

type Props = { children: ReactNode };

// 分包加载失败时提供明确恢复入口，避免整个窗口白屏。
export default class ChunkErrorBoundary extends Component<Props, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (this.state.failed) return <div role="alert" style={{ padding: 24 }}>
      <p>界面加载失败，请重新加载。如果问题持续出现，请重启客户端。</p>
      <button type="button" onClick={() => window.location.reload()}>重新加载</button>
    </div>;
    return this.props.children;
  }
}
