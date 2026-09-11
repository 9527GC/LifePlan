const technicalPatterns: Array<[RegExp, string]> = [
  [/浏览器测试环境|桌面客户端/i, "当前只能在桌面客户端中使用，请启动客户端后重试。"],
  [/database|sqlite|数据库|connection|连接/i, "暂时无法读取数据，请稍后重试。"],
  [/backup|备份/i, "数据备份未完成，但你的数据仍可继续使用。"],
  [/network|fetch|invoke|tauri|后端|服务/i, "服务暂时不可用，请稍后重试。"],
];

export function userFacingError(cause: unknown, fallback = "保存失败，请检查后重试。") {
  const raw = cause instanceof Error ? cause.message : String(cause ?? "");
  const message = raw.replace(/^Error:\s*/i, "").trim();
  if (!message) return fallback;
  const matched = technicalPatterns.find(([pattern]) => pattern.test(message));
  return matched?.[1] ?? (message.length > 120 ? fallback : message);
}

export function errorDetails(cause: unknown) {
  return cause instanceof Error ? cause.message : String(cause ?? "");
}
