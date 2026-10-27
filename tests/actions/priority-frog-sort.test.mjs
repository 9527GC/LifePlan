import test from "node:test";
import assert from "node:assert/strict";
import { sortByPriority } from "../../src/lib/prioritySort.ts";
import { sortDailyActions } from "../../src/lib/dailyActionSort.ts";

const ids = (items) => items.map((item) => item.id);
const action = (id, priority, is_frog, start_date) => ({ id, priority, is_frog, start_date });

test("事件及事件分组同 P 级青蛙优先，不跨越 P 级，保持输入不变", () => {
  const items = [action(1, 2, 0), action(2, 2, 1), action(3, 1, 0), action(4, 2, 1)];
  assert.deepEqual(ids(sortByPriority(items)), [3, 2, 4, 1]);
  assert.deepEqual(ids(items), [1, 2, 3, 4]);
});

test("缺少青蛙标记按普通事项处理，其余相同保留原顺序", () => {
  assert.deepEqual(ids(sortByPriority([
    action(1, 1, undefined), action(2, 1, 0), action(3, 1, 1),
  ])), [3, 1, 2]);
  assert.deepEqual(sortByPriority([]), []);
});

test("平铺行动先按日期，同日期按 P 级，同 P 级青蛙优先", () => {
  const items = [
    action(1, 1, 0, "2026-10-27"),
    action(2, 1, 1, "2026-10-27"),
    action(3, 2, 1, "2026-10-27"),
    action(4, 4, 0, "2026-10-26"),
    action(5, 1, 1),
    action(6, 1, 0),
  ];
  assert.deepEqual(ids(sortDailyActions(items)), [4, 2, 1, 3, 5, 6]);
  assert.deepEqual(ids(items), [1, 2, 3, 4, 5, 6]);
});

test("无日期行动同样按 P 级和青蛙排序，相同条件保留顺序", () => {
  assert.deepEqual(ids(sortDailyActions([
    action(1, 2, 1), action(2, 1, 0), action(3, 1, 1), action(4, 1, 1),
  ])), [3, 4, 2, 1]);
});
