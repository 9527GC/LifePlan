import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  assertVersionConsistency,
  buildChangeSections,
  renderChangeSections,
  renderChangelogEntry,
  upsertChangelog,
} from "./release-utils.mjs";

function parseArguments(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith("--")) continue;
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`参数 ${argument} 缺少值。`);
    }
    values.set(argument.slice(2), value);
    index += 1;
  }
  return values;
}

function readRequiredArgument(args, name, fallback) {
  const value = args.get(name) ?? fallback;
  if (!value) throw new Error(`缺少 --${name} 参数。`);
  return value;
}

function runGit(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function getVersionFiles() {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  const cargoToml = readFileSync("src-tauri/Cargo.toml", "utf8");
  const cargoMatch = cargoToml.match(/^version\s*=\s*"([^"]+)"/mu);
  if (!cargoMatch) throw new Error("无法从 src-tauri/Cargo.toml 读取版本号。");
  const tauriConfig = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8"));
  return {
    packageJson: packageJson.version,
    cargoToml: cargoMatch[1],
    tauriConfig: tauriConfig.version,
  };
}

function getShanghaiDate() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function writeUtf8File(filePath, content) {
  mkdirSync(dirname(resolve(filePath)), { recursive: true });
  writeFileSync(filePath, content.replace(/\r\n/g, "\n"), "utf8");
}

function appendGithubOutput(filePath, context) {
  const lines = [
    `tag=${context.tag}`,
    `version=${context.version}`,
    `date=${context.date}`,
    "context_artifact_name=release-context",
  ];
  writeFileSync(filePath, `${lines.join("\n")}\n`, { encoding: "utf8", flag: "a" });
}

function writeSummary(filePath, context, previousTag) {
  const previous = previousTag ?? "无（首次发布）";
  const content = [
    "## 发布准备完成",
    "",
    `- 标签：${context.tag}`,
    `- 版本：${context.version}`,
    `- 上一个版本标签：${previous}`,
    `- 更新日期：${context.date}`,
    "",
    context.releaseNotesMarkdown,
    "",
  ].join("\n");
  writeFileSync(filePath, content, "utf8", { flag: "a" });
}

function collectCommits(range) {
  // %x1f 分隔标题与正文，%x1e 分隔不同提交，确保 commit body 里的细节不被丢弃
  const rawLog = runGit(["log", "--format=%s%x1f%b%x1e", range]);
  return rawLog
    .split("\x1e")
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => {
      const sep = chunk.indexOf("\x1f");
      const subject = (sep >= 0 ? chunk.slice(0, sep) : chunk).trim();
      const bodyText = sep >= 0 ? chunk.slice(sep + 1) : "";
      const body = bodyText
        .split(/\r?\n/)
        .map((line) => line.replace(/^[-*]\s*/, "").trim())
        .filter(Boolean);
      return { subject, body };
    });
}

function main() {
  const args = parseArguments(process.argv.slice(2));
  const tag = readRequiredArgument(args, "tag", process.env.GITHUB_REF_NAME);
  const tagMatch = tag.match(/^v(\d+\.\d+\.\d+)(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?$/u);
  if (!tagMatch) {
    throw new Error(`无效的发布标签：${tag}。标签必须匹配 v主版本.次版本.修订版本，可选第四段修正版或预发布标识。`);
  }

  const version = tagMatch[1];
  assertVersionConsistency(version, getVersionFiles());

  const repository = readRequiredArgument(args, "repository", process.env.GITHUB_REPOSITORY);
  const defaultBranch = readRequiredArgument(args, "default-branch");
  const contextFile = readRequiredArgument(args, "context-file");
  const tags = runGit(["tag", "--list", "v*", "--sort=-version:refname"])
    .split("\n")
    .filter((candidate) => candidate && candidate !== tag);
  // 正式版优先以上一个“正式版”为基线，避免预发布标签（vX.Y.Z-N）截断更新内容
  const previousTag = tags.find((candidate) => !candidate.includes("-")) ?? tags[0];
  const range = previousTag ? `${previousTag}..${tag}` : tag;
  const commits = collectCommits(range);
  const sections = buildChangeSections(commits);
  const date = getShanghaiDate();
  const releaseNotesMarkdown = renderChangeSections(sections);
  const changelogEntry = renderChangelogEntry(tag, date, sections);
  const changelogFile = args.get("changelog-file") ?? "CHANGELOG.md";
  let changelog = "";
  try {
    changelog = readFileSync(changelogFile, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  writeUtf8File(changelogFile, upsertChangelog(changelog, tag, changelogEntry));

  const context = {
    tag,
    version,
    date,
    sections,
    releaseNotesMarkdown,
    repository,
    defaultBranch,
  };
  writeUtf8File(contextFile, `${JSON.stringify(context, null, 2)}\n`);

  const githubOutput = args.get("github-output");
  if (githubOutput) appendGithubOutput(githubOutput, context);
  const summaryFile = args.get("summary-file");
  if (summaryFile) writeSummary(summaryFile, context, previousTag);
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
