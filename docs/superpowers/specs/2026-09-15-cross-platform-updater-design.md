# LifePlan 跨平台客户端自动更新设计

**日期：** 2026-09-15

## 目标

为 LifePlan 的 Windows 与 macOS 桌面客户端接入基于 GitHub Release 的安全自动更新能力。应用启动后在后台静默检查更新；发现新版本时，在左侧边栏 LifePlan Logo 的右侧显示小型圆形下载图标。用户点击图标后下载、校验、安装更新并重启应用。

## 范围

- 支持 Windows x64、macOS Apple Silicon（arm64）和 macOS Intel（x64）。
- 使用 Tauri 2 官方 updater 插件进行版本查询、签名校验、下载和安装。
- GitHub 仓库 `9527GC/LifePlan` 的 Release 作为更新清单和更新包来源。
- 使用 Tauri 签名密钥保证更新包的真实性和完整性。
- Windows 使用 NSIS 安装器更新；macOS 使用 Tauri 生成的 `.app.tar.gz` 更新包。

不在本次实现范围内：

- 自动下载或强制更新。
- 更新历史页、设置页中的手动检查更新入口。
- Apple Developer Developer ID 签名和 notarization 公证配置；此项将在面对外部 macOS 用户正式分发时另行接入。

## 用户体验

### 启动检查

1. 根布局挂载后立即异步检查更新，不能阻塞现有页面、窗口恢复或用户操作。
2. 没有更新、网络不可用、GitHub Release 暂不可访问、检查过程异常时，均不显示提示和下载图标。
3. 发现版本号高于当前版本时，在 LifePlan 文字后显示小型圆形下载按钮。
4. 悬停按钮展示提示：`发现新版本 {version}，点击下载更新`。

### 更新操作状态

| 状态 | Logo 区表现 | 行为 |
| --- | --- | --- |
| 未发现更新 / 检查失败 | 不显示按钮 | 静默继续使用 |
| 发现更新 | 下载图标 | 点击开始下载与安装 |
| 下载或安装中 | 旋转加载图标，禁用 | 防止重复触发 |
| 下载或安装失败 | 下载图标恢复 | 显示错误消息，可重试 |
| 安装完成 | 应用退出并重启 | 使用新版本 |

更新过程使用轻量提示反馈下载开始、失败和重启；不显示启动弹窗，不要求用户在下载前再次确认。

## 前端架构

新增 `src/lib/updater.ts`，作为 Tauri updater API 的唯一封装：

- `checkForUpdate()`：后台调用 updater 插件，返回新版本对象或空值。
- `installUpdate(update)`：执行下载、安装并调用 process 插件重启。
- 将所有 Tauri API 调用收敛在该文件，错误由调用方捕获并转换成用户可理解的提示。

`src/components/layout/Layout.tsx` 维护更新状态：

- 初始状态：无更新且未下载。
- 首次挂载时触发一次检查。
- 保存可安装的更新对象、版本号、下载中状态。
- 在 `.brand` 内部追加独立的更新按钮，不改变 Logo 的三击导出分析日志行为。
- 按钮的鼠标事件必须阻止冒泡，避免触发 Logo 点击统计。

样式写入 `src/App.css`：圆形、紧凑、与现有 #1778ff 品牌色一致，具备悬停、禁用和旋转动画状态，并保证键盘可访问性及 aria 标签。

## Tauri 配置

### 依赖与 Rust 注册

- npm 添加 `@tauri-apps/plugin-updater` 和 `@tauri-apps/plugin-process`。
- Cargo 添加 `tauri-plugin-updater` 与 `tauri-plugin-process`。
- `src-tauri/src/lib.rs` 在 Builder 中注册两个插件，保留 opener、数据库状态、窗口初始化和所有现有 command。
- `src-tauri/capabilities/default.json` 新增 updater 与 process 所需默认权限。

### 更新端点与签名

`src-tauri/tauri.conf.json`：

- 启用 `bundle.createUpdaterArtifacts`。
- 内置 Tauri updater 公钥（私钥绝不提交）。
- 更新端点固定为：
  `https://github.com/9527GC/LifePlan/releases/latest/download/latest.json`
- Windows 使用 NSIS 更新安装模式。

密钥流程：

1. 本地生成一个 Tauri updater 密钥对。
2. 公钥写入 Tauri 配置并可提交版本库。
3. 私钥内容与密码分别存至 GitHub Actions Secrets：
   `TAURI_SIGNING_PRIVATE_KEY`、`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`。
4. 私钥只保留在安全本地备份和 GitHub Secrets，禁止提交 Git。

## 发布架构

GitHub Actions 在推送 `v*` 标签时创建或更新同一个 GitHub Release，并使用 Tauri 生成更新产物及 `latest.json`。

### Windows

Windows runner 构建 NSIS 安装器及其签名产物，作为 Release 资产上传。`latest.json` 为 Windows 平台提供对应 URL 与签名。

### macOS

macOS runner 分别构建：

- `aarch64-apple-darwin`：Apple Silicon；
- `x86_64-apple-darwin`：Intel。

构建过程启用 updater artifacts 后，上传各架构独立命名的 `.app.tar.gz` 与 `.sig`。`latest.json` 中分别用 `darwin-aarch64` 与 `darwin-x86_64` 映射到正确的包。

现有 macOS 工作流保留首次下载可用的 ZIP 资产，同时追加 updater 产物；不再将手工 ZIP 用作 updater 包。

## 版本发布流程

1. 将 `package.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json` 的版本号同步更新为相同的 SemVer 值，例如 `1.0.4`。
2. 本地验证构建成功。
3. 提交并推送代码。
4. 创建并推送对应 tag，例如 `v1.0.4`。
5. GitHub Actions 读取签名 Secrets，构建并发布 Windows/macOS 安装包、签名文件和 `latest.json`。
6. 已安装的旧版客户端下次启动将发现该 Release；用户点击 Logo 后图标进行更新。

## 验收标准

- Windows 和 macOS 的正式打包均开启 updater artifacts。
- `npm run build` 通过。
- Rust/Tauri 配置通过构建或配置检查。
- 启动时检查失败不会影响应用正常使用，也不会显示误导性 UI。
- 当更新服务返回高版本时，Logo 后显示可聚焦、有说明的下载按钮。
- 点击后显示下载中状态，重复点击不重复下载。
- 成功调用下载、安装与重启；失败时显示失败消息并允许再次操作。
- 工作流能够为 Windows、macOS arm64、macOS x64 发布签名更新资产。

## 风险与后续

- GitHub Actions 无法替代 macOS 的 Apple 代码签名与公证。未完成 Developer ID 签名与 notarization 前，外部用户首次启动新下载的 macOS App 仍可能受到 Gatekeeper 限制。
- GitHub Release 必须保持公开可访问，或客户端必须具备读取私有 Release 的授权策略；本设计默认公开 Release。
- 更换 updater 私钥会使旧客户端无法验证新更新，必须长期妥善保存当前密钥。
