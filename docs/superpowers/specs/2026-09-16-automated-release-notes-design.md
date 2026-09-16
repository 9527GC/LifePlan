# 自动化发布说明与版本历史设计

**日期：** 2026-09-16  
**状态：** 已确认，待审阅

## 目标

当推送形如 `v1.0.5` 的 Git 标签时，GitHub Actions 自动校验应用版本、依据 Git 提交信息生成本次更新说明、在根目录 `CHANGELOG.md` 追加本版本历史记录、构建并发布 Windows/macOS 安装包，以及生成包含下载表格和历史更新入口的 GitHub Release 正文。

该流程不要求发布者手动编辑 `CHANGELOG.md` 或 Release 正文。

## 范围

### 包含

- 仅由 `v*` 标签推送触发发布。
- 校验标签去掉 `v` 后的版本号与 `package.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json` 完全一致。
- 读取上一个版本标签（不含当前标签）到当前标签之间的提交，按 Conventional Commit 前缀自动分类。
- 以北京时间（`Asia/Shanghai`）为日志日期，在 `CHANGELOG.md` 顶部插入本版本记录。
- 将变更后的 `CHANGELOG.md` 自动提交并推送至标签所属提交的默认分支。
- 构建并上传 Windows x64、macOS Apple Silicon、macOS Intel 的发布资产。
- 创建或更新 GitHub Release 正文，包含更新内容、按操作系统分组的安装包表格和完整历史更新日志链接。

### 不包含

- Android、Linux 平台构建；当前工作流只覆盖已存在的 Windows/macOS 发布目标。
- 基于 Pull Request 的 Release Notes 生成。
- 自动修改应用版本号或自动创建版本标签；版本号仍需在打标签前由发布者同步修改并提交。
- macOS 的 Apple Developer 签名、notarization 或额外分发渠道。

## 发布触发与版本一致性

发布者先将三个版本文件修改为同一个语义化版本并提交，例如 `1.0.5`：

- `package.json`
- `src-tauri/Cargo.toml`
- `src-tauri/tauri.conf.json`

然后推送 `v1.0.5` 标签。工作流提取 `github.ref_name` 的 `v` 后版本，分别读取上述三处版本号进行精确比较。

任一版本不一致时，在开始生成日志或构建前直接失败，错误信息列出标签期望版本与三个实际值。这样：

- 新手引导轮播读取的 `package.json` 版本；
- Tauri 客户端与安装包使用的 `Cargo.toml` / `tauri.conf.json` 版本；
- GitHub Release 标签与自动更新版本；

在每个正式发布版本中保持一致。

## 自动变更内容

### 提交范围

工作流找到当前标签之前最近的 `v*` 标签，收集其与当前标签之间的提交；首个标签没有前序版本时，收集当前标签可达的全部提交。

生成逻辑使用提交标题并删除 Conventional Commit 前缀。分类规则如下：

| 前缀（支持英文和中文冒号） | 分类标题 |
| --- | --- |
| `feat:`、`feat：` | `✨ 新增功能` |
| `fix:`、`fix：` | `🐛 问题修复` |
| `perf:`、`perf：`、`refactor:`、`refactor：` | `⚡ 优化改进` |
| 其余提交 | `🔧 其他更新` |

自动回写更新日志的提交使用固定的机器人身份和明确标记，例如 `docs: 自动更新 CHANGELOG v1.0.5 [skip changelog]`。生成下一版本日志时，带该标记的提交会被过滤，不会作为用户可见更新重复出现。

如提交区间没有可展示的提交，则写入 `- 本版本包含构建与发布维护更新。`，保证 Release 和日志均有有效正文。

### CHANGELOG.md 格式

根目录不存在 `CHANGELOG.md` 时创建如下文件；已存在时在一级标题之后、已有版本条目之前插入新版本，保证倒序排列：

```md
# 更新日志

## v1.0.5（2026-09-16）

### ✨ 新增功能
- 示例新增内容

### 🐛 问题修复
- 示例修复内容
```

日期由工作流以 `Asia/Shanghai` 时区生成，格式固定为 `YYYY-MM-DD`。

写入后，工作流将只提交 `CHANGELOG.md` 回默认分支。该提交不会触发发布，因为发布工作流只监听标签推送；若目标分支非标签所在线性历史或推送被保护规则拒绝，工作流应失败并明确指出日志未能回写，不继续制作不完整的 Release。

## 产物与 Release 编排

### 构建目标

沿用现有 Tauri 发布矩阵：

| 平台 | Runner | Rust target |
| --- | --- | --- |
| Windows x64 | `windows-latest` | `x86_64-pc-windows-msvc` |
| macOS Apple Silicon | `macos-14` | `aarch64-apple-darwin` |
| macOS Intel | `macos-14` | `x86_64-apple-darwin` |

各构建 job 仅负责生成资产并上传为 workflow artifact，避免多个矩阵 job 并发写入同一 Release 造成竞态和正文覆盖。

最终汇总 job 下载全部构建产物，统一创建或更新标签对应的 Release，上传安装资产、`latest.json` 和 updater 签名文件，并写入最终正文。若任一构建 job 失败，汇总 job 不运行，避免发布缺少某个平台的版本。

### Release 正文

正文由自动分类的同一份变更内容生成，格式为：

```md
# LifePlan v1.0.5

## ✨ 本次更新

### ✨ 新增功能
- 示例新增内容

## 📦 下载与安装

| 操作系统 | 适用设备 | 下载 |
| --- | --- | --- |
| Windows | x64 | [下载 Windows 安装包](当前 Release 资产链接) |
| macOS | Apple Silicon（M 系列芯片） | [下载 ARM64 安装包](当前 Release 资产链接) |
| macOS | Intel 芯片 | [下载 x64 安装包](当前 Release 资产链接) |

> Windows 请下载 `.exe` 安装包；macOS 请根据芯片类型下载对应的 `.dmg` 或 `.app.zip` 安装包。

---

📚 **历次版本更新记录：** [查看 CHANGELOG.md](默认分支上的 CHANGELOG 链接)
```

下载链接使用 `https://github.com/9527GC/LifePlan/releases/download/<tag>/<asset>` 形式，且资产文件名必须从最终汇总 job 收集的实际构建文件中确定，而不是仅依赖硬编码猜测。若某个预期安装包不存在，汇总 job 失败且不创建/更新 Release。

`CHANGELOG.md` 链接指向默认分支上的仓库文件。每个 Release 正文只提供该历史入口，不重复展开全部历史版本。

## 失败策略与幂等性

- 标签格式非法、版本号不一致、无法读取提交范围或无法生成日志：流程失败，不开始构建。
- 无法将 `CHANGELOG.md` 回写默认分支：流程失败，不开始构建。
- 任一平台构建或产物校验失败：汇总发布 job 不执行，不创建不完整 Release。
- 相同标签重跑：同一版本的 `CHANGELOG.md` 条目若已经存在则不重复插入；Release 使用更新模式，覆盖为本次生成的确定性正文并补齐资产。
- 自动生成的 CHANGELOG 提交不会被记入后续版本更新内容。

## 需要修改的文件

- `.github/workflows/release.yml`：重构为版本校验、日志生成与回写、矩阵构建、最终汇总发布四阶段。
- `CHANGELOG.md`：首次由发布工作流创建，后续由工作流自动在顶部写入版本记录。
- `docs/自动更新发布指南.md`：更新发布前检查、标签发布、自动日志和失败排查说明。

## 验收标准

1. 推送 `vX.Y.Z` 时，三个版本文件任一与 `X.Y.Z` 不一致，构建前失败且输出差异。
2. 三个版本一致且提交标题含 `feat:` / `fix:` / `refactor:` 时，Release 与 CHANGELOG 中均按规则分类展示对应更新。
3. 自动创建或更新的 `CHANGELOG.md` 顶部包含 `## vX.Y.Z（北京时间日期）`，此前版本记录仍保留且倒序展示。
4. Release 正文显示本次更新、Windows x64、macOS ARM64、macOS Intel 下载表格，以及完整更新日志入口。
5. 任何平台构建失败时，不生成缺少平台资产的正式 Release。
6. 新手引导显示版本号、Tauri 安装包版本、Release 标签和 updater 所见版本一致。