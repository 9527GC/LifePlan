import assert from "node:assert/strict";

const { sortDailyActions } = await import("../src/lib/dailyActionSort.ts");

const createAction = (id, start_date, priority) => ({
  id,
  start_date,
  priority,
  title: `行动 ${id}`,
});

const actions = [
  createAction(1, undefined, 2),
  createAction(2, "2026-09-16", 3),
  createAction(3, "2026-09-15", 4),
  createAction(4, "2026-09-15", 1),
  createAction(5, undefined, 1),
  createAction(6, "2026-09-15", 1),
];
const originalActions = [...actions];

const sorted = sortDailyActions(actions);

assert.deepEqual(
  sorted.map((action) => action.id),
  [4, 6, 3, 2, 5, 1],
  "应按开始日期升序、同日优先级升序、无开始日期置后",
);
assert.deepEqual(actions, originalActions, "不应修改输入数组");
assert.notStrictEqual(sorted, actions, "应返回新数组");

const stableActions = [
  createAction(7, "2026-09-15", 2),
  createAction(8, "2026-09-15", 2),
  createAction(9, undefined, 3),
  createAction(10, undefined, 3),
];
assert.deepEqual(
  sortDailyActions(stableActions).map((action) => action.id),
  [7, 8, 9, 10],
  "日期和优先级完全相同时应保持原顺序",
);
assert.deepEqual(sortDailyActions([]), [], "空数组应返回空数组");

console.log("今日事行动排序检查通过");
