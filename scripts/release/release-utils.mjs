const CATEGORY_RULES = [
  { pattern: /^feat(?:\([^)]*\))?\s*[:：]\s*/iu, title: "✨ 新增功能" },
  { pattern: /^fix(?:\([^)]*\))?\s*[:：]\s*/iu, title: "🐛 问题修复" },
  { pattern: /^(?:perf|refactor)(?:\([^)]*\))?\s*[:：]\s*/iu, title: "⚡ 优化改进" },
];

const CATEGORY_ORDER = ["✨ 新增功能", "🐛 问题修复", "⚡ 优化改进", "🔧 其他更新"];
const SKIP_CHANGELOG_MARKER = "[skip changelog]";
const VERSION_LABELS = {
  packageJson: "package.json",
  cargoToml: "Cargo.toml",
  tauriConfig: "tauri.conf.json",
};

export function assertVersionConsistency(expectedVersion, versions) {
  const entries = Object.entries(versions);
  if (entries.some(([, value]) => value !== expectedVersion)) {
    const actual = entries.map(([name, value]) => `${VERSION_LABELS[name] ?? name}：${value}`).join("\n");
    throw new Error(`版本号不一致。标签期望版本：${expectedVersion}\n${actual}`);
  }
  return versions;
}

export function buildChangeSections(commitSubjects) {
  const sections = new Map(CATEGORY_ORDER.map((title) => [title, []]));
  for (const rawSubject of commitSubjects) {
    const subject = rawSubject.trim();
    if (!subject || subject.includes(SKIP_CHANGELOG_MARKER)) continue;
    const rule = CATEGORY_RULES.find(({ pattern }) => pattern.test(subject));
    const title = rule?.title ?? "🔧 其他更新";
    const item = rule ? subject.replace(rule.pattern, "").trim() : subject;
    sections.get(title).push(item || subject);
  }
  const result = CATEGORY_ORDER
    .map((title) => ({ title, items: sections.get(title) }))
    .filter(({ items }) => items.length > 0);
  return result.length > 0
    ? result
    : [{ title: "🔧 其他更新", items: ["本版本包含构建与发布维护更新。"] }];
}

export function renderChangeSections(sections) {
  return sections.map(({ title, items }) => `### ${title}\n${items.map((item) => `- ${item}`).join("\n")}`).join("\n\n");
}

export function renderChangelogEntry(tag, date, sections) {
  return `## ${tag}（${date}）\n\n${renderChangeSections(sections)}\n`;
}

export function upsertChangelog(changelog, tag, entry) {
  const normalized = changelog.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").trimEnd();
  if (new RegExp(`^## ${escapeRegExp(tag)}（`, "m").test(normalized)) return `${normalized}\n`;
  const header = "# 更新日志";
  if (!normalized) return `${header}\n\n${entry}`;
  if (!normalized.startsWith(header)) return `${header}\n\n${entry}\n${normalized}\n`;
  const rest = normalized.slice(header.length).replace(/^\n+/, "");
  return `${header}\n\n${entry}${rest ? `\n${rest}\n` : ""}`;
}

export function findReleaseAssets(files) {
  const choose = (pattern, description) => {
    const matches = files.filter(({ name }) => pattern.test(name));
    if (matches.length !== 1) throw new Error(`${description}应存在且仅存在一个，实际找到 ${matches.length} 个。`);
    return matches[0];
  };
  return {
    windows: choose(/\.exe$/iu, "Windows 安装包"),
    macosArm64: choose(/(?:aarch64|arm64).*(?:\.dmg|\.zip)$/iu, "macOS Apple Silicon 安装包"),
    macosX64: choose(/(?:x86_64|x64).*(?:\.dmg|\.zip)$/iu, "macOS Intel 安装包"),
    latestJson: choose(/^latest\.json$/iu, "latest.json"),
    signatures: files.filter(({ name }) => /\.sig$/iu.test(name)),
  };
}

export function renderReleaseBody({ tag, sections, repository, defaultBranch, assets }) {
  const assetUrl = (name) => `https://github.com/${repository}/releases/download/${tag}/${encodeURIComponent(name)}`;
  return [
    `# LifePlan ${tag}`,
    "",
    "## ✨ 本次更新",
    "",
    renderChangeSections(sections),
    "",
    "## 📦 下载与安装",
    "",
    "| 操作系统 | 适用设备 | 下载 |",
    "| --- | --- | --- |",
    `| Windows | x64 | [下载 Windows 安装包](${assetUrl(assets.windows.name)}) |`,
    `| macOS | Apple Silicon（M 系列芯片） | [下载 ARM64 安装包](${assetUrl(assets.macosArm64.name)}) |`,
    `| macOS | Intel 芯片 | [下载 x64 安装包](${assetUrl(assets.macosX64.name)}) |`,
    "",
    "> Windows 请下载 `.exe` 安装包；macOS 请根据芯片类型下载对应的安装包。",
    "",
    "---",
    "",
    `📚 **历次版本更新记录：** [查看 CHANGELOG.md](https://github.com/${repository}/blob/${defaultBranch}/CHANGELOG.md)`,
    "",
  ].join("\n");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

