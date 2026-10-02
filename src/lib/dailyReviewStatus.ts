import type { DailyScheduleSlot } from "@/types";

export type OverallReviewStatus = "smooth" | "deviated" | "chaotic";

/**
 * 根据当天全部时间段的复盘结果，生成仅用于首次进入每日复盘时的整体状态默认值。
 * 已保存的整体状态始终优先于此计算结果，后续修改时间段复盘不会改写人工选择。
 */
export const getDefaultDailyReviewStatus = (
  slots: DailyScheduleSlot[],
): OverallReviewStatus => {
  if (slots.length === 0) return "smooth";

  const unmetExpectationCount = slots.filter(
    (slot) => slot.met_expectation === 0,
  ).length;
  const unfocusedCount = slots.filter((slot) => slot.focused === 0).length;
  const hasTooManyUnmetExpectations = unmetExpectationCount / slots.length > 0.3;
  const hasTooManyUnfocusedSlots = unfocusedCount / slots.length > 0.3;

  // 同时满足两项时，“比较混乱”的优先级高于“有偏差”。
  if (hasTooManyUnfocusedSlots) return "chaotic";
  if (hasTooManyUnmetExpectations) return "deviated";
  return "smooth";
};

export const isOverallReviewStatus = (
  value: string | null | undefined,
): value is OverallReviewStatus =>
  value === "smooth" || value === "deviated" || value === "chaotic";
