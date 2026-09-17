import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { findReleaseAssets, renderReleaseBody } from "./release-utils.mjs";

function parseArguments(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith("--")) throw new Error(`不支持的参数：${argument}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`参数 ${argument} 缺少值。`);
    values.set(argument.slice(2), value);
    index += 1;
  }
  return values;
}

function readRequiredArgument(argumentsMap, name) {
  const value = argumentsMap.get(name);
  if (!value) throw new Error(`缺少必填参数：--${name}`);
  return resolve(value);
}

async function listFiles(directory) {
  const files = [];
  async function visit(currentDirectory) {
    const entries = await readdir(currentDirectory, { withFileTypes: true });
    for (const entry of entries) {
      const filePath = resolve(currentDirectory, entry.name);
      if (entry.isDirectory()) await visit(filePath);
      else if (entry.isFile()) files.push({ name: entry.name, path: filePath });
    }
  }
  await visit(directory);
  return files;
}

async function getFileHash(filePath) {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

async function deduplicateAllowedFiles(files) {
  const groups = new Map();
  for (const file of files) {
    const entries = groups.get(file.name) ?? [];
    entries.push(file);
    groups.set(file.name, entries);
  }

  const result = [];
  for (const [name, entries] of groups) {
    if (entries.length === 1) {
      result.push(entries[0]);
      continue;
    }

    const hashes = await Promise.all(entries.map(({ path }) => getFileHash(path)));
    const isAllowedDuplicate = name === "latest.json" || name.endsWith(".sig");
    if (!isAllowedDuplicate) throw new Error(`发布资产不允许重名：${name}`);
    if (new Set(hashes).size !== 1) throw new Error(`发布资产重名且内容不同：${name}`);
    result.push(entries[0]);
  }
  return result;
}

function chooseUpdaterBundle(files, pattern, description) {
  const matches = files.filter(({ name }) => pattern.test(name));
  if (matches.length !== 1) {
    throw new Error(`${description}应存在且仅存在一个，实际找到 ${matches.length} 个。`);
  }
  return matches[0];
}

async function createLatestJson(context, files, outputDirectory) {
  const updaterBundles = [
    {
      platform: "windows-x86_64",
      description: "Windows 更新包",
      bundle: chooseUpdaterBundle(files, /\.zip$/iu, "Windows 更新包"),
    },
    {
      platform: "darwin-aarch64",
      description: "macOS Apple Silicon 更新包",
      bundle: chooseUpdaterBundle(files, /(?:aarch64|arm64).*\.app\.tar\.gz$/iu, "macOS Apple Silicon 更新包"),
    },
    {
      platform: "darwin-x86_64",
      description: "macOS Intel 更新包",
      bundle: chooseUpdaterBundle(files, /(?:x86_64|x64).*\.app\.tar\.gz$/iu, "macOS Intel 更新包"),
    },
  ];

  const platforms = {};
  for (const { platform, description, bundle } of updaterBundles) {
    const signature = files.find(({ name }) => name === `${bundle.name}.sig`);
    if (!signature) throw new Error(`${description}缺少同名签名文件：${bundle.name}.sig`);
    platforms[platform] = {
      signature: (await readFile(signature.path, "utf8")).trim(),
      url: `https://github.com/${context.repository}/releases/download/${context.tag}/${encodeURIComponent(bundle.name)}`,
    };
  }

  const latestPath = resolve(outputDirectory, "latest.json");
  const latestJson = {
    version: context.version,
    notes: context.releaseNotesMarkdown,
    pub_date: `${context.date}T00:00:00+08:00`,
    platforms,
  };
  await writeFile(latestPath, `${JSON.stringify(latestJson, null, 2)}\n`, "utf8");
  return { name: "latest.json", path: latestPath };
}

async function copyAssets(files, outputDirectory) {
  const copied = new Map();
  for (const file of files) {
    if (copied.has(file.name)) continue;
    const destination = resolve(outputDirectory, file.name);
    if (resolve(file.path) !== destination) await copyFile(file.path, destination);
    copied.set(file.name, destination);
  }
  return copied.size;
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  const contextFile = readRequiredArgument(args, "context-file");
  const assetsDirectory = readRequiredArgument(args, "assets-dir");
  const outputDirectory = readRequiredArgument(args, "output-dir");
  const bodyFile = readRequiredArgument(args, "body-file");
  const context = JSON.parse(await readFile(contextFile, "utf8"));

  if (!(await stat(assetsDirectory)).isDirectory()) throw new Error(`资产目录不是目录：${assetsDirectory}`);
  await rm(outputDirectory, { recursive: true, force: true });
  await mkdir(outputDirectory, { recursive: true });

  const files = await deduplicateAllowedFiles(await listFiles(assetsDirectory));
  const latestJson = await createLatestJson(context, files, outputDirectory);
  const installerAssets = files.filter(({ name }) => /\.(?:exe|dmg)$/iu.test(name));
  const assets = findReleaseAssets([...installerAssets, latestJson]);
  assets.signatures = files.filter(({ name }) => name.endsWith(".sig"));
  if (assets.signatures.length === 0) throw new Error("未找到 updater 签名文件（.sig）。");

  const updaterBundles = [
    chooseUpdaterBundle(files, /\.zip$/iu, "Windows 更新包"),
    chooseUpdaterBundle(files, /(?:aarch64|arm64).*\.app\.tar\.gz$/iu, "macOS Apple Silicon 更新包"),
    chooseUpdaterBundle(files, /(?:x86_64|x64).*\.app\.tar\.gz$/iu, "macOS Intel 更新包"),
  ];
  const outputFiles = [
    assets.windows,
    assets.macosArm64,
    assets.macosX64,
    latestJson,
    ...updaterBundles,
    ...assets.signatures,
  ];
  const uploadedCount = await copyAssets(outputFiles, outputDirectory);
  const releaseBody = renderReleaseBody({ ...context, assets }).replace(/\r\n/g, "\n");
  await mkdir(dirname(bodyFile), { recursive: true });
  await writeFile(bodyFile, releaseBody, "utf8");

  console.log(`已校验 ${uploadedCount} 个待发布资产，并生成 Release 正文：${bodyFile}`);
}

main().catch((error) => {
  console.error(`发布资产校验失败：${error.message}`);
  process.exitCode = 1;
});
