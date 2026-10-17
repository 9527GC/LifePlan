import type { Action } from "../types/index.ts";

export function sortEventActions(actions: Action[]): Action[] {
  const byStoredOrder = [...actions].sort((left, right) => {
    const leftOrder =
      (left.sort_order ?? 0) > 0 ? left.sort_order : Number.MAX_SAFE_INTEGER;
    const rightOrder =
      (right.sort_order ?? 0) > 0 ? right.sort_order : Number.MAX_SAFE_INTEGER;
    return leftOrder !== rightOrder
      ? leftOrder - rightOrder
      : left.created_at - right.created_at || left.id - right.id;
  });
  const positionById = new Map(
    byStoredOrder.map((action, index) => [action.id, index]),
  );
  const datedActions = byStoredOrder
    .filter((action) => action.start_date)
    .sort((left, right) => {
      const dateCompare = left.start_date!.localeCompare(right.start_date!);
      return dateCompare !== 0
        ? dateCompare
        : (positionById.get(left.id) ?? 0) -
            (positionById.get(right.id) ?? 0);
    });

  let datedIndex = 0;
  return byStoredOrder.map((action) => {
    // 未设置开始日期的行动固定在其原有位置；仅让有日期的行动按日期填入其余位置。
    // 因此清空日期不会把行动自动移到列表末尾，同日行动仍可按手动顺序排列。
    if (!action.start_date) return action;
    return datedActions[datedIndex++];
  });
}
