# 系统托盘恢复最小化窗口 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 使托盘左键和“打开窗口”菜单可将 LifePlan 的最小化主窗口恢复、显示并聚焦。

**Architecture:** 复用现有的 `show_main_window` 作为所有窗口恢复入口。在显示和聚焦前检查最小化状态并按需解除最小化，因此不需要调整托盘回调、菜单或窗口关闭拦截。

**Tech Stack:** Rust 2021、Tauri 2.11.5。

## Global Constraints

- 仅修改 Rust 端窗口恢复逻辑；不得改变前端、托盘菜单、关闭驻留托盘或退出行为。
- 保留 `show_main_window` 作为托盘左键和“打开窗口”菜单共用的单一恢复入口。
- 所有新增代码注释和提交信息使用中文。

---

## 文件结构

- 修改：`src-tauri/src/lib.rs`
  - 在 `show_main_window` 中按需解除最小化，再继续既有显示和聚焦逻辑。

## Task 1: 恢复最小化窗口

**Files:**
- Modify: `src-tauri/src/lib.rs:21-27`

**Interfaces:**
- Consumes: `WebviewWindow::is_minimized() -> tauri::Result<bool>` 与 `WebviewWindow::unminimize() -> tauri::Result<()>`。
- Produces: `show_main_window(app: &tauri::AppHandle) -> tauri::Result<()>`；隐藏、最小化和已显示窗口均可安全恢复或聚焦。

- [ ] **Step 1: 在窗口显示前解除最小化状态**

将 `show_main_window` 的窗口处理逻辑更新为：

```rust
if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
    if window.is_minimized()? {
        window.unminimize()?;
    }
    window.show()?;
    window.set_focus()?;
}
```

窗口不存在时继续返回 `Ok(())`，不得 panic。

- [ ] **Step 2: 运行 Rust 格式和编译检查**

运行：

```powershell
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo check --manifest-path src-tauri/Cargo.toml
```

预期：两个命令均成功退出。若格式检查失败，运行 `cargo fmt --manifest-path src-tauri/Cargo.toml` 后重新检查。

- [ ] **Step 3: 手动验证窗口状态恢复**

运行：`npm run tauri dev`

验证：

1. 最小化主窗口后左键点击托盘图标，窗口恢复并获得焦点；
2. 最小化主窗口后右键托盘图标，点击“打开窗口”，窗口恢复并获得焦点；
3. 关闭窗口使其隐藏后，以上两种操作仍可恢复窗口；
4. 点击“退出”仍完全退出应用。

- [ ] **Step 4: 提交实现**

运行：

```powershell
git add src-tauri/src/lib.rs
git commit -m "fix: 恢复托盘唤起的最小化窗口"
```

提交前运行 `git status --short`，确认没有包含无关改动。
