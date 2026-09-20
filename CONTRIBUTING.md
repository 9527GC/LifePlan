# 贡献指南


本项目发布时，会由 CI（`.github/workflows/release.yml`）自动从 Git 提交生成更新日志（`CHANGELOG.md`）与 GitHub Release 说明。

为保证每个版本“内容完整、分类准确”，请遵守以下约定。


## 提交信息规范


提交标题格式：`类型：简短描述`（冒号支持半角 `:` 与全角 `：`）。自动分类规则：

前缀 | 归入分类
| --- | ---
「功能：」/「新增：」/「feat:」 | ✨ 新增功能
「修复：」/「fix:」 | 🐛 问题修复
「优化：」/「重构：」/「perf:」/「refactor:」 | ⚡ 优化改进
其它（如「文档：」「构建：」） | 🔧 其他更新

示例：`功能：支持奖励兑换打卡`


## 不进入更新日志的提交

- 纯发布动作提交（以「发布：」或「chore(release):」开头）会被自动跳过。
- 任意提交标题末尾加 `[skip changelog]` 可手动跳过。


## 避免“更新内容丢失”的关键习惯

- **不要**用一次性大提交（`git add -A` + 单条「发布：准备 vX」）打包所有功能。应按功能拆分为多条规范提交；发布提交仅用于修改版本号。
- 预发布标签请用 `vX.Y.Z-rc.N` 命名；正式版的更新日志会自动以上一个**正式版**为基线，不会因预发布标签而漏掉期间内容。


## 发布流程

1. 确认三处版本号一致：`package.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json`。
2. 提交：`发布：准备 vX.Y.Z`（仅含版本号变更）。
3. 打标签并推送到 GitHub：`git tag -a vX.Y.Z -m "LifePlan vX.Y.Z"` 后 `git push github vX.Y.Z`。
4. CI 自动构建 Windows/macOS 安装包、生成 CHANGELOG 段落并发布 GitHub Release；随后将更新后的 `main` 同步推送到 Gitee。
