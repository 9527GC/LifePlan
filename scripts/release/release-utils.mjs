const CATEGORY_RULES = [
  { pattern: /^(?:feat|功能|新增)(?:\([^)]*\))?\s*[:：]\s*/iu, title: "✨ 新增功能" },
  { pattern: /^(?:fix|修复)(?:\([^)]*\))?\s*[:：]\s*/iu, title: "🐛 问题修复" },
  { pattern: /^(?:perf|refactor|优化|重构)(?:\([^)]*\))?\s*[:：]\s*/iu, title: "⚡ 优化改进" },
];

const CATEGORY_ORDER = ["✨ 新增功能", "🐛 问题修复", "⚡ 优化改进", "🔧 其他更新"];
const SKIP_CHANGELOG_MARKER = "[skip changelog]";
// 仅用于识别“纯发布动作”提交；只有当提交没有实质正文时才据此跳过，避免误删真实改动。
const RELEASE_ONLY_PATTERN = /^(?:发布|chore(?:\((?:release|version)\))?|build(?:\(release\))?)\s*[:：]/u;
// 归类时统一剥离的常见前缀（conventional + 中文），保留后面的真实描述。
const STRIP_PREFIX_PATTERN = /^(?:[-*]\s*)?(?:feat|fix|perf|refactor|docs|style|test|chore|build|ci|功能|新增|修复|优化|重构|数据库|渠道隔离|其它|其他|版本)(?:\([^)]*\))?\s*[:：]\s*/iu;
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

// 版本要点保持“条目具体、描述简短”：仅把含多个句子的条目按全角句末标点（。！？）拆成若干条
// 完整要点，内容全部保留、绝不截断丢字；单条过长的情况交由提交规范约束，而非由脚本静默砍字。
function trimEdges(text) {
  return text.replace(/^[，,、：:；;\-]+/, "").replace(/[，,、：:；;\-]+$/u, "").trim();
}
function splitToItems(raw) {
  const base = String(raw ?? "").replace(/\s+/g, " ").trim();
  if (!base) return [];
  const parts = base.split(/[。！？]+/u).map(trimEdges).filter(Boolean);
  return parts.length ? parts : [trimEdges(base)].filter(Boolean);
}

function stripConventionalPrefix(line) {
  const stripped = line.replace(STRIP_PREFIX_PATTERN, "").trim();
  return stripped || line.trim();
}

function classify(text) {
  const rule = CATEGORY_RULES.find(({ pattern }) => pattern.test(text));
  return {
    title: rule?.title ?? "🔧 其他更新",
    item: stripConventionalPrefix(rule ? text.replace(rule.pattern, "").trim() : text),
  };
}

function dedupe(items) {
  const seen = new Set();
  const result = [];
  for (const item of items) {
    const key = item.trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(key);
  }
  return result;
}

/**
 * 根据提交列表生成分类后的更新条目。
 * commits: [{ subject, body: string[] }] —— 传入 { subject } 旧格式亦兼容。
 */
export function buildChangeSections(commits) {
  const sections = new Map(CATEGORY_ORDER.map((title) => [title, []]));
  for (const commit of commits) {
    const subject = (typeof commit === "string" ? commit : commit?.subject ?? "").trim();
    if (!subject || subject.includes(SKIP_CHANGELOG_MARKER)) continue;
    const bodyItems = (typeof commit === "string" ? [] : (commit?.body ?? []).map((line) => line.trim()).filter(Boolean));
    const hasBody = bodyItems.length > 0;

    // 纯发布动作提交（如“发布：准备 v1.0.7”）：没有实质正文时才跳过
    if (!hasBody && RELEASE_ONLY_PATTERN.test(subject)) continue;

    if (hasBody) {
      // 有详细描述时优先采用正文要点，避免只留一个笼统标题造成信息丢失
      for (const line of bodyItems) {
        if (line.includes(SKIP_CHANGELOG_MARKER)) continue;
        const { title, item } = classify(line);
        for (const entry of splitToItems(item || line)) sections.get(title).push(entry);
      }
    } else {
      const { title, item } = classify(subject);
      for (const entry of splitToItems(item || subject)) sections.get(title).push(entry);
    }
  }
  const result = CATEGORY_ORDER.map((title) => ({ title, items: dedupe(sections.get(title)) })).filter(
    ({ items }) => items.length > 0,
  );
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