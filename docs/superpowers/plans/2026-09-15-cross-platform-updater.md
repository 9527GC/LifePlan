# LifePlan 跨平台自动更新实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 Windows 与 macOS 的 LifePlan 客户端提供 GitHub Release 驱动、用户点击触发安装的安全自动更新能力。

**Architecture:** Tauri 2 官方 updater 负责获取 GitHub Release 的 `latest.json`、校验签名并安装更新；前端将该能力封装在独立模块中，由根布局在启动时静默查询，并按查询结果在 Logo 后渲染下载入口。GitHub Actions 在发布标签时构建 Windows、macOS arm64、macOS x64 产物，并向同一个 Release 上传 updater 所需文件。

**Tech Stack:** React 19、TypeScript、Ant Design 6、Lucide React、Tauri 2、Rust、GitHub Actions、NSIS。

## Global Constraints

- 更新源固定为公开 GitHub 仓库 `9527GC/LifePlan` 的 Release。
- 支持 Windows x64、macOS Apple Silicon（arm64）和 macOS Intel（x64）。
- 启动检查必须静默、异步且不阻塞用户操作；无更新或异常时不显示 UI。
- 仅在发现更新时显示 Logo 后的圆形下载按钮；用户点击后才下载、安装和重启。
- 使用 Tauri updater 签名；私钥不得提交版本库，只通过 `TAURI_SIGNING_PRIVATE_KEY` 与 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` GitHub Secrets 注入。
- 所有新增代码注释、文档与提交信息使用中文。
- 本计划不配置 Apple Developer 签名与 notarization 公证。

---

## 文件职责

| 文件 | 职责 |
| --- | --- |
| `package.json` / `package-lock.json` | 安装前端 updater/process 插件依赖。 |
| `src-tauri/Cargo.toml` / `src-tauri/Cargo.lock` | 安装 Rust updater/process 插件依赖。 |
| `src-tauri/src/lib.rs` | 注册 updater 和 process 插件。 |
| `src-tauri/capabilities/default.json` | 授予前端调用 updater/process 的能力权限。 |
| `src-tauri/tauri.conf.json` | 开启 updater artifacts、内置公钥、配置 GitHub 更新端点与 Windows NSIS 安装模式。 |
| `src/lib/updater.ts` | 集中封装检查、下载、安装、重启的 Tauri API。 |
| `src/components/layout/Layout.tsx` | 触发一次启动检查、维护更新状态并呈现 Logo 后按钮。 |
| `src/App.css` | 定义下载按钮和旋转加载状态样式。 |
| `.github/workflows/release.yml` | 构建发布 Windows 与两种 macOS 架构的签名更新资产。 |
| `.github/workflows/build-macos.yml` | 保留首次下载 ZIP，并使 macOS 构建同时产生 updater artifacts。 |
| `docs/自动更新发布指南.md` | 记录密钥生成、Secrets、版本发布和 macOS 限制。 |

## 先决人工配置

Tauri 公钥必须在实现前生成，不能由源码替代。执行：

```powershell
npm run tauri signer generate -w "$HOME\.tauri\lifeplan-updater.key"
Get-Content "$HOME\.tauri\lifeplan-updater.key.pub"
```

将公钥完整文本替换到 `src-tauri/tauri.conf.json` 的 `plugins.updater.pubkey`。将以下私钥信息写到 GitHub 仓库 `9527GC/LifePlan` 的 Actions Secrets：

```powershell
Get-Content "$HOME\.tauri\lifeplan-updater.key" -Raw
```

- `TAURI_SIGNING_PRIVATE_KEY`：上述私钥完整文本。
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`：生成密钥时设置的密码；若未设置，仍创建为空字符串 Secret。

私钥文件不可进入工作区、Git 索引、日志或文档。

### Task 1: 接入 Tauri 更新基础设施

**Files:**
- Modify: `E:/项目/LifePlanTodolist/package.json`
- Modify: `E:/项目/LifePlanTodolist/package-lock.json`
- Modify: `E:/项目/LifePlanTodolist/src-tauri/Cargo.toml`
- Modify: `E:/项目/LifePlanTodolist/src-tauri/Cargo.lock`
- Modify: `E:/项目/LifePlanTodolist/src-tauri/src/lib.rs:15-20`
- Modify: `E:/项目/LifePlanTodolist/src-tauri/capabilities/default.json:8-24`

**Interfaces:**
- Consumes: Tauri 2 已注册的 `tauri_plugin_opener::init()`、现有应用状态与 command handler。
- Produces: 前端可调用的 `@tauri-apps/plugin-updater`、`@tauri-apps/plugin-process` 插件和对应 capability 权限。

- [ ] **Step 1: 安装 npm 依赖**

运行：

```powershell
npm install @tauri-apps/plugin-updater @tauri-apps/plugin-process
```

预期：`package.json` 的 `dependencies` 新增两个 `@tauri-apps/plugin-*` 条目，锁文件随之更新。

- [ ] **Step 2: 安装 Rust 依赖**

在 `src-tauri/Cargo.toml` 的 `[dependencies]` 追加：

```toml
tauri-plugin-updater = "2"
tauri-plugin-process = "2"
```

运行：

```powershell
cargo check --manifest-path src-tauri/Cargo.toml
```

预期：Cargo 下载依赖并显示 `Finished`。

- [ ] **Step 3: 注册 Rust 插件**

将 `src-tauri/src/lib.rs` 的 Builder 前缀调整为：

```rust
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(app_state)
```

保留现有 `.setup`、`.invoke_handler` 和 command 列表，不移动或删除它们。

- [ ] **Step 4: 增加 capability 权限**

在 `src-tauri/capabilities/default.json` 的 `permissions` 数组追加：

```json
"updater:default",
"process:allow-restart"
```

最终结构应保持原有窗口权限，并确保每个字符串均以逗号分隔。

- [ ] **Step 5: 验证 Rust 编译**

运行：

```powershell
cargo check --manifest-path src-tauri/Cargo.toml
```

预期：成功完成，无 updater/process 未解析错误。

- [ ] **Step 6: 提交基础设施改动**

```powershell
git add package.json package-lock.json src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/lib.rs src-tauri/capabilities/default.json
git commit -m "功能：接入 Tauri 自动更新基础设施"
```

### Task 2: 配置签名更新产物与 GitHub 更新端点

**Files:**
- Modify: `E:/项目/LifePlanTodolist/src-tauri/tauri.conf.json:1-42`

**Interfaces:**
- Consumes: Task 1 注册的 updater 插件，以及人工生成的 updater 公钥。
- Produces: Tauri 打包时的 updater artifacts、客户端检查的 `latest.json` URL 与 Windows NSIS 安装方式。

- [ ] **Step 1: 先验证当前配置不能生成更新产物**

运行：

```powershell
npm run tauri -- build -- --help
```

预期：只显示 Tauri build 帮助，不修改工作区；当前 `tauri.conf.json` 尚无 `createUpdaterArtifacts`。

- [ ] **Step 2: 修改 bundle 和 updater 配置**

将 `bundle` 扩展为以下结构（保留现有 icon）：

```json
"bundle": {
  "active": true,
  "targets": "all",
  "createUpdaterArtifacts": true,
  "windows": {
    "nsis": {
      "installMode": "passive"
    }
  },
  "icon": [
    "icons/32x32.png",
    "icons/128x128.png",
    "icons/128x128@2x.png",
    "icons/icon.icns",
    "icons/icon.ico"
  ]
},
"plugins": {
  "updater": {
    "pubkey": "在此粘贴 lifeplan-updater.key.pub 的完整单行内容",
    "endpoints": [
      "https://github.com/9527GC/LifePlan/releases/latest/download/latest.json"
    ]
  }
}
```

将示例公钥字符串替换为实际公钥后再提交；不得填写私钥、文件路径或密码。

- [ ] **Step 3: 校验 JSON 与 Tauri 配置**

运行：

```powershell
Get-Content src-tauri/tauri.conf.json -Raw | ConvertFrom-Json | Out-Null
npm run tauri -- info
```

预期：PowerShell JSON 解析无输出，Tauri info 正常显示环境信息。

- [ ] **Step 4: 提交配置改动**

```powershell
git add src-tauri/tauri.conf.json
git commit -m "配置：启用签名更新产物和 GitHub 更新源"
```

### Task 3: 实现前端更新服务与 Logo 下载入口

**Files:**
- Create: `E:/项目/LifePlanTodolist/src/lib/updater.ts`
- Modify: `E:/项目/LifePlanTodolist/src/components/layout/Layout.tsx:1-102`
- Modify: `E:/项目/LifePlanTodolist/src/App.css:17-20`

**Interfaces:**
- Consumes: `@tauri-apps/plugin-updater` 的 `check()` 与 `Update`；`@tauri-apps/plugin-process` 的 `relaunch()`；Task 1 capability。
- Produces: `checkForUpdate(): Promise<Update | null>`、`installUpdate(update: Update): Promise<void>`，以及用户点击可触发的下载图标。

- [ ] **Step 1: 新建更新服务**

创建 `src/lib/updater.ts`：

```ts
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export type AvailableUpdate = Update;

export async function checkForUpdate(): Promise<AvailableUpdate | null> {
  return check();
}

export async function installUpdate(update: AvailableUpdate): Promise<void> {
  await update.downloadAndInstall();
  await relaunch();
}
```

不在此模块显示 message、Modal 或写入 UI 状态。

- [ ] **Step 2: 在 Layout 增加状态与启动检查**

将 Lucide 导入改为包含 `Download` 和 `LoaderCircle`，将 Ant Design 导入改为包含 `message`，并添加：

```ts
import { checkForUpdate, installUpdate, type AvailableUpdate } from "@/lib/updater";
```

在组件顶部状态中添加：

```ts
const [availableUpdate, setAvailableUpdate] = useState<AvailableUpdate | null>(null);
const [isInstallingUpdate, setIsInstallingUpdate] = useState(false);
```

在现有页面埋点 effect 后添加启动检查 effect：

```ts
useEffect(() => {
  let disposed = false;

  void checkForUpdate()
    .then((update) => {
      if (!disposed) setAvailableUpdate(update);
    })
    .catch(() => {
      // 更新检查失败不影响使用，也不打扰用户。
    });

  return () => {
    disposed = true;
  };
}, []);
```

- [ ] **Step 3: 在 Layout 增加安装处理函数**

在 `handleLogoClick` 前添加：

```ts
const handleInstallUpdate = async () => {
  if (!availableUpdate || isInstallingUpdate) return;

  setIsInstallingUpdate(true);
  message.loading({ content: `正在下载 LifePlan ${availableUpdate.version} 更新…`, key: "app-update", duration: 0 });

  try {
    await installUpdate(availableUpdate);
  } catch (error) {
    message.error({ content: "更新下载或安装失败，请稍后重试。", key: "app-update", duration: 4 });
    setIsInstallingUpdate(false);
    console.error("安装应用更新失败：", error);
  }
};
```

- [ ] **Step 4: 在 Logo 后渲染按钮**

将现有单行 `.brand` JSX 改为保持相同 SVG 和文字，同时在 `LifePlan` 文字后追加：

```tsx
{availableUpdate && (
  <Tooltip title={isInstallingUpdate ? "正在下载并安装更新" : `发现新版本 ${availableUpdate.version}，点击下载更新`}>
    <button
      type="button"
      className="brand-update-button"
      aria-label={isInstallingUpdate ? "正在下载并安装更新" : `下载 LifePlan ${availableUpdate.version} 更新`}
      disabled={isInstallingUpdate}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        void handleInstallUpdate();
      }}
    >
      {isInstallingUpdate ? <LoaderCircle className="brand-update-spinner" size={14} /> : <Download size={14} />}
    </button>
  </Tooltip>
)}
```

按钮必须位于 `brand` 点击容器中，但通过冒泡阻止避免干扰三击日志导出。

- [ ] **Step 5: 添加样式**

在 `src/App.css` 的 `.brand` 样式之后插入：

```css
.brand-update-button { display: inline-grid; flex: 0 0 auto; width: 22px; height: 22px; margin-left: -3px; padding: 0; place-items: center; border: 1px solid #b9d9ff; border-radius: 50%; color: #1778ff; background: #f0f7ff; cursor: pointer; transition: color .2s ease, background .2s ease, border-color .2s ease, transform .2s ease; }
.brand-update-button:hover:not(:disabled) { border-color: #1778ff; color: #fff; background: #1778ff; transform: translateY(-1px); }
.brand-update-button:focus-visible { outline: 2px solid #91caff; outline-offset: 2px; }
.brand-update-button:disabled { cursor: wait; opacity: .72; }
.brand-update-spinner { animation: brand-update-rotate .9s linear infinite; }
@keyframes brand-update-rotate { to { transform: rotate(360deg); } }
```

- [ ] **Step 6: 验证前端静态构建**

运行：

```powershell
npm run build
```

预期：TypeScript 与 Vite 均成功完成。手动启动 `npm run tauri dev`，在无可用更新的情况下确认 Logo 不出现按钮，且正常使用页面无额外弹窗。

- [ ] **Step 7: 提交前端改动**

```powershell
git add src/lib/updater.ts src/components/layout/Layout.tsx src/App.css
git commit -m "功能：增加启动检查和更新下载入口"
```

### Task 4: 建立 Windows 和 macOS 的签名发布流水线

**Files:**
- Create: `E:/项目/LifePlanTodolist/.github/workflows/release.yml`
- Modify: `E:/项目/LifePlanTodolist/.github/workflows/build-macos.yml`

**Interfaces:**
- Consumes: Task 2 的 `createUpdaterArtifacts` 配置及 GitHub Secrets `TAURI_SIGNING_PRIVATE_KEY`、`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`。
- Produces: GitHub Release 中的 Windows NSIS、macOS ZIP、macOS arm64/x64 updater artifacts、签名文件和 `latest.json`。

- [ ] **Step 1: 创建统一 Release 工作流**

创建 `.github/workflows/release.yml`：

```yaml
name: 发布 LifePlan

on:
  push:
    tags:
      - "v*"

permissions:
  contents: write

jobs:
  release:
    strategy:
      fail-fast: false
      matrix:
        include:
          - runner: windows-latest
            args: ""
          - runner: macos-14
            args: "--target aarch64-apple-darwin"
          - runner: macos-14
            args: "--target x86_64-apple-darwin"
    runs-on: ${{ matrix.runner }}
    steps:
      - name: 检出代码
        uses: actions/checkout@v4

      - name: 设置 Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm

      - name: 安装 Rust
        uses: dtolnay/rust-toolchain@stable
        with:
          targets: aarch64-apple-darwin,x86_64-apple-darwin

      - name: 安装依赖
        run: npm ci --no-audit --no-fund

      - name: 构建并发布
        uses: tauri-apps/tauri-action@v0
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
          TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}
        with:
          tagName: ${{ github.ref_name }}
          releaseName: "LifePlan ${{ github.ref_name }}"
          releaseBody: "请查看本次版本的更新说明。"
          releaseDraft: false
          prerelease: false
          args: ${{ matrix.args }}
```

- [ ] **Step 2: 避免同一标签触发两个 Release 工作流**

将 `.github/workflows/build-macos.yml` 的触发器从：

```yaml
on:
  workflow_dispatch:
  push:
    tags:
      - 'v*'
```

改为：

```yaml
on:
  workflow_dispatch:
```

保留该工作流作为人工触发的 macOS ZIP 构建；标签发布由 `release.yml` 统一处理。

- [ ] **Step 3: 使人工 macOS 工作流可以签名 updater artifacts**

在 `构建 macOS 应用` 步骤增加：

```yaml
env:
  TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
  TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}
```

并在压缩 APP 后添加检查步骤：

```yaml
      - name: 检查 macOS 更新产物
        shell: bash
        run: |
          set -euo pipefail
          bundle_dir="src-tauri/target/${{ matrix.rust_target }}/release/bundle/macos"
          find "$bundle_dir" -maxdepth 1 -type f -name '*.app.tar.gz*' -print
          test "$(find "$bundle_dir" -maxdepth 1 -type f -name '*.app.tar.gz' | wc -l)" -eq 1
          test "$(find "$bundle_dir" -maxdepth 1 -type f -name '*.app.tar.gz.sig' | wc -l)" -eq 1
```

- [ ] **Step 4: 验证 YAML 结构与工作流差异**

运行：

```powershell
Get-Content .github/workflows/release.yml -Raw | ConvertFrom-Yaml | Out-Null
Get-Content .github/workflows/build-macos.yml -Raw | ConvertFrom-Yaml | Out-Null
git diff --check
```

若本机 PowerShell 不带 `ConvertFrom-Yaml`，运行：

```powershell
npx prettier --check .github/workflows/release.yml .github/workflows/build-macos.yml
```

预期：两个 YAML 文件没有缩进、语法或尾随空白错误。

- [ ] **Step 5: 提交发布工作流**

```powershell
git add .github/workflows/release.yml .github/workflows/build-macos.yml
git commit -m "构建：增加跨平台签名自动发布流程"
```

### Task 5: 编写配置和发布操作指南

**Files:**
- Create: `E:/项目/LifePlanTodolist/docs/自动更新发布指南.md`

**Interfaces:**
- Consumes: Tasks 1-4 的依赖、配置、工作流和 GitHub Secrets。
- Produces: 可独立执行的维护手册，防止泄露私钥并说明测试/发布操作。

- [ ] **Step 1: 编写指南**

创建文档，必须包含以下明确命令与内容：

```markdown
# 自动更新发布指南

## 一次性配置

```powershell
npm run tauri signer generate -w "$HOME\.tauri\lifeplan-updater.key"
Get-Content "$HOME\.tauri\lifeplan-updater.key.pub"
Get-Content "$HOME\.tauri\lifeplan-updater.key" -Raw
```

将公钥填入 `src-tauri/tauri.conf.json`；将私钥和密码分别创建成 GitHub Actions Secrets `TAURI_SIGNING_PRIVATE_KEY`、`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`。

## 发布版本

```powershell
# 同步 package.json、src-tauri/Cargo.toml、src-tauri/tauri.conf.json 的版本后：
npm run build
git add package.json src-tauri/Cargo.toml src-tauri/tauri.conf.json
git commit -m "发布：LifePlan 1.0.4"
git push github main
git tag v1.0.4
git push github v1.0.4
```

## 发布后核查

确认 GitHub Release 的 `latest.json` 包含 `windows-x86_64`、`darwin-aarch64` 和 `darwin-x86_64`；确认每个更新 URL 可公开下载；使用上一正式版本启动后检查 Logo 后下载图标和更新结果。

## macOS 正式分发说明

说明未配置 Apple Developer 签名和 notarization 时，Gatekeeper 可能阻止首次启动；正式对外分发前需补充 Developer ID Application 签名和 Apple 公证。
```

- [ ] **Step 2: 检查文档不含私钥**

运行：

```powershell
git diff -- docs/自动更新发布指南.md
Select-String -Path docs/自动更新发布指南.md -Pattern "BEGIN PRIVATE KEY|TAURI_SIGNING_PRIVATE_KEY=.*[A-Za-z0-9]{40}" -AllMatches
```

预期：diff 中只包含命令和变量名；`Select-String` 无匹配结果。

- [ ] **Step 3: 提交操作文档**

```powershell
git add -f docs/自动更新发布指南.md
git commit -m "文档：补充自动更新发布指南"
```

### Task 6: 端到端本地验证与首个发布前检查

**Files:**
- Modify if needed: `E:/项目/LifePlanTodolist/package.json`
- Modify if needed: `E:/项目/LifePlanTodolist/src-tauri/Cargo.toml`
- Modify if needed: `E:/项目/LifePlanTodolist/src-tauri/tauri.conf.json`

**Interfaces:**
- Consumes: Tasks 1-5 全部实现以及已配置的公钥/Secrets。
- Produces: 可安全推送和打标签发布的验证结论。

- [ ] **Step 1: 执行前端和 Rust 检查**

```powershell
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
git diff --check
git status --short
```

预期：前两项成功、diff 检查无输出、状态为空。

- [ ] **Step 2: 在开发模式验证无更新退化路径**

```powershell
npm run tauri dev
```

预期：在开发环境无法读取生产更新端点或未发现更新时，应用正常显示；Logo 后没有下载按钮；控制台可有开发环境 updater 提示但不得导致白屏、崩溃或阻断操作。

- [ ] **Step 3: 在 GitHub Actions 验证发布工作流**

推送测试标签（在版本号已更新后）：

```powershell
git push github main
git tag v1.0.4
git push github v1.0.4
```

预期：`发布 LifePlan` 工作流的 Windows、macOS arm64、macOS x64 job 均完成；Release 中存在 `latest.json` 和对应 updater `.sig` 资产。

- [ ] **Step 4: 验证真实客户端更新路径**

1. 安装版本低于 Release 的 Windows 或 macOS 应用。
2. 启动旧版本，等待主界面出现。
3. 预期 Logo 后出现圆形下载图标。
4. 点击图标，预期图标旋转且 toast 显示下载中。
5. 预期安装完成后应用自动重启，并显示新的版本。
6. 若失败，预期 toast 显示失败文案、图标恢复，点击后可再次尝试。

- [ ] **Step 5: 提交任何验证修复并记录发布结果**

```powershell
git status --short
# 若存在修复：
git add <修复文件>
git commit -m "修复：完善自动更新发布校验"
```

预期：结束时工作区无未提交文件，Release 资产和客户端更新链路均已核查。

## 计划自检

- **需求覆盖：** Task 1-2 提供安全更新基础与配置；Task 3 实现静默检查、Logo 图标、点击下载和失败重试；Task 4 生成 Windows/macOS 三种平台发布资产；Task 5 记录密钥和发布流程；Task 6 覆盖构建、发布和真实更新验证。
- **无占位符：** 检查任务步骤未使用 TBD、TODO 或“后续实现”等不可执行表述；唯一需人工填入的是实际公钥，其来源和禁止写入私钥的限制已明确。
- **接口一致性：** `AvailableUpdate`、`checkForUpdate`、`installUpdate` 在 Task 3 内定义与使用；Task 1 的插件和权限是其唯一运行时前置条件；Task 2 的端点由 Task 4 发布 `latest.json` 提供。
