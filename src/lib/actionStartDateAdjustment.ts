import dayjs from "dayjs";
import type { Action } from "../types/index.ts";

/** 使用打开弹框时的行动快照计算联动结果，不受保存后的排序影响。 */
export function planStartDateAdjustment(
  action: Action,
  following: Action[],
  newDate: string | null,
  cascade: boolean,
) {
  const delta =
    action.start_date && newDate
      ? dayjs(newDate)
          .startOf("day")
          .diff(dayjs(action.start_date).startOf("day"), "day")
      : 0;
  // 原本没有开始日期的行动只能单独调整，清空操作也不联动。
  const canCascade = Boolean(action.start_date);
  const pending = following.filter(
    (item) => item.status === 0 && item.event_id === action.event_id,
  );
  const targets =
    cascade && canCascade
      ? [
          action,
          ...pending.filter((item) => newDate === null || item.start_date),
        ]
      : [action];
  const preview = targets.map((item) => ({
    action: item,
    date:
      newDate === null
        ? null
        : item.id === action.id
          ? newDate
          : dayjs(item.start_date).add(delta, "day").format("YYYY-MM-DD"),
  }));
  return {
    delta,
    canCascade,
    preview,
    changes: preview.filter(
      (item) => (item.action.start_date || null) !== item.date,
    ),
    conflicts: preview.filter(
      (item) =>
        item.date && item.action.deadline && item.date > item.action.deadline,
    ),
    skipped:
      cascade && canCascade && newDate !== null
        ? pending.filter((item) => !item.start_date).length
        : 0,
  };
}
