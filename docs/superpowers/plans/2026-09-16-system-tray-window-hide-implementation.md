# 系统托盘常驻与窗口隐藏 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在关闭 LifePlan 主窗口时隐藏窗口并保留系统托盘，通过托盘左键或菜单恢复窗口，并通过菜单显式退出应用。

**Architecture:** 在 Tauri Rust 进程中创建原生托盘、菜单和事件处理器；将窗口恢复逻辑集中为一个可复用函数。主窗口的关闭事件被拦截并改为隐藏，只有托盘的“退出”菜单调用应用退出 API，因此不会受到关闭拦截影响。

**Tech Stack:** Rust 2021、Tauri 2.11.5、Tauri 原生菜单与系统托盘 API。

## Global Constraints

- 仅在 `src-tauri` Rust 端实现；不得修改前端 React 代码、窗口样式或现有自定义标题栏布局。
- 启用 Tauri 的 `tray-icon` 特性；不得引入独立第三方托盘依赖。
- 系统托盘菜单文案必须精确为 `打开窗口` 和 `退出`。
- 关闭主窗口必须隐藏窗口并保留托盘；只有点击 `退出` 才能结束应用。
- 所有新增代码注释和提交信息使用中文。

---

## 文件结构

- 修改：`src-tauri/Cargo.toml`
  - 为 `tauri` 依赖开启 `tray-icon` 特性，使 `TrayIconBuilder`、托盘事件和菜单 API 可用。
- 修改：`src-tauri/src/lib.rs`
  - 定义主窗口标签、菜单 ID 与窗口恢复帮助函数；在 `setup` 中建立原生托盘和菜单，注册菜单、图标点击与窗口关闭事件。
- 修改：`src-tauri/Cargo.lock`
  - 由 Cargo 在特性解析后维护；仅在实际发生变化时纳入提交。

## Task 1: 启用托盘能力并实现窗口生命周期

**Files:**
- Modify: `src-tauri/Cargo.toml:20`
- Modify: `src-tauri/src/lib.rs:1-28`
- Modify: `src-tauri/Cargo.lock`（仅在 Cargo 自动变更时）

**Interfaces:**
- Consumes: `tauri::Manager`、`tauri::menu::{Menu, MenuItem}`、`tauri::{TrayIconBuilder, TrayIconEvent, WindowEvent}`。
- Produces: `show_main_window(app: &tauri::AppHandle) -> tauri::Result<()>`，供托盘左键和 `打开窗口` 菜单项复用。
- Produces: ID 为 `open-window`、`quit` 的菜单项；ID 为 `main-tray` 的托盘图标。

- [ ] **Step 1: 为 Tauri 依赖开启托盘特性**

在 `src-tauri/Cargo.toml` 将：

```toml
tauri = { version = "2", features = [] }
```

替换为：

```toml
tauri = { version = "2", features = ["tray-icon"] }
```

- [ ] **Step 2: 运行编译检查，确认当前代码仍可在启用特性后通过**

运行：`cargo check --manifest-path src-tauri/Cargo.toml`

预期：命令成功退出；如 Cargo 更新锁文件，仅保留由特性解析产生的必要变更。

- [ ] **Step 3: 在 `lib.rs` 添加托盘所需导入、常量和窗口恢复函数**

在现有 `use tauri::Manager;` 附近导入菜单、托盘与窗口事件类型，声明：

```rust
const MAIN_WINDOW_LABEL: &str = "main";
const OPEN_WINDOW_MENU_ID: &str = "open-window";
const QUIT_MENU_ID: &str = "quit";

fn show_main_window(app: &tauri::AppHandle) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        window.show()?;
        window.set_focus()?;
    }
    Ok(())
}
```

保留 `Manager` trait 导入，使 `get_webview_window` 可用。函数对窗口不存在保持幂等，不应 panic。

- [ ] **Step 4: 在 `setup` 中创建菜单和系统托盘**

在 `setup(|app| { ... })` 的开头：

1. 使用 `MenuItem::with_id` 创建 `打开窗口` 和 `退出` 菜单项，ID 分别为 `OPEN_WINDOW_MENU_ID`、`QUIT_MENU_ID`；
2. 使用 `Menu::with_items(app, &[&open_window, &quit])` 生成菜单；
3. 使用 `app.default_window_icon().cloned()` 获取图标。若图标不存在，返回 `tauri::Error::AssetNotFound`，避免创建无图标托盘；
4. 使用 `TrayIconBuilder::with_id("main-tray")`、`.menu(&menu)`、`.icon(icon)`、`.on_menu_event(...)`、`.on_tray_icon_event(...)` 和 `.build(app)` 创建托盘；
5. 在菜单回调中：`open-window` 调用 `show_main_window`；`quit` 调用 `app.exit(0)`；忽略未知菜单 ID；
6. 在托盘事件回调中，仅匹配 `TrayIconEvent::Click` 且鼠标按钮为左键、状态为 `Up` 的事件，并调用 `show_main_window`；右键操作交给原生菜单显示机制处理。

所有回调中的 `show_main_window` 错误应记录到标准错误，不应导致应用崩溃。

- [ ] **Step 5: 将启动窗口显示逻辑替换为复用函数，并注册关闭拦截**

1. 以 `show_main_window(app.handle())?` 替换当前 `setup` 中直接取得 `main` 窗口后调用 `show`、`set_focus` 的三行逻辑；
2. 在获得 `main` 窗口后，注册 `window.on_window_event`；
3. 仅在 `WindowEvent::CloseRequested { api, .. }` 时执行：

```rust
api.prevent_close();
if let Err(error) = window.hide() {
    eprintln!("隐藏主窗口失败：{error}");
}
```

此回调不得对最小化、聚焦、移动等其他窗口事件做处理。`退出` 菜单使用 `app.exit(0)`，不调用 `window.close()`，从而不会被本回调阻止。

- [ ] **Step 6: 运行 Rust 静态检查与前端构建回归检查**

运行：

```powershell
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo check --manifest-path src-tauri/Cargo.toml
npm run build
```

预期：三个命令均成功退出。若 `cargo fmt --check` 报告格式差异，运行 `cargo fmt --manifest-path src-tauri/Cargo.toml` 后重跑检查。

- [ ] **Step 7: 手动验证桌面行为**

运行：`npm run tauri dev`

按以下步骤验证：

1. 主窗口正常显示，系统托盘存在 LifePlan 图标；
2. 点击窗口关闭按钮，确认窗口和任务栏图标消失，但托盘图标保留；
3. 左键单击托盘图标，确认窗口重新显示并获得焦点；
4. 右键单击托盘图标，确认菜单仅含 `打开窗口`、`退出`；
5. 先隐藏窗口，再点击 `打开窗口`，确认窗口重新显示并获得焦点；
6. 点击 `退出`，确认进程退出、托盘图标消失，且不残留后台进程。

- [ ] **Step 8: 提交实现**

运行：

```powershell
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/lib.rs
git commit -m "feat: 支持系统托盘常驻"
```

若 `src-tauri/Cargo.lock` 未发生变化，从 `git add` 参数中移除该路径；提交前运行 `git status --short`，确认没有混入无关改动。
