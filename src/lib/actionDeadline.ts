/** 日期统一使用 YYYY-MM-DD；事件截止日期仅用于提醒，不限制保存。 */
export function actionDeadlineWarning(
  date?: string | null,
  deadline?: string | null,
): string | undefined {
  return date && deadline && date > deadline
    ? `行动开始日期已超过事件截止日期（${deadline}）`
    : undefined;
}
