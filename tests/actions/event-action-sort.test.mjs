import test from "node:test";
import assert from "node:assert/strict";
import { sortEventActions } from "../../src/lib/eventActionSort.ts";

const action = (id, sort_order, start_date, extra = {}) => ({
  id, sort_order, start_date, created_at: id, priority: 1, ...extra,
});
const ids = (actions) => sortEventActions(actions).map((item) => item.id);

test("事件内日期先后优先于保存顺序，同日保留手动顺序", () => {
  const actions = [
    action(1, 1, "2026-10-20"),
    action(2, 3, "2026-10-17"),
    action(3, 2, "2026-10-17", { priority: 4 }),
  ];
  assert.deepEqual(ids(actions), [3, 2, 1]);
  assert.deepEqual(actions.map((item) => item.id), [1, 2, 3]);
});

test("未设置开始日期的行动保持保存位置", () => {
  assert.deepEqual(ids([
    action(1, 1, "2026-10-20"),
    action(2, 2, undefined),
    action(3, 3, "2026-10-17"),
  ]), [3, 2, 1]);
});

test("未保存排序的行动排在已有排序之后，使用创建时间和编号兜底", () => {
  assert.deepEqual(ids([
    action(4, 0, undefined, { created_at: 2 }),
    action(3, undefined, undefined, { created_at: 2 }),
    action(2, 0, undefined, { created_at: 1 }),
    action(1, 1, undefined, { created_at: 3 }),
  ]), [1, 2, 3, 4]);
  assert.deepEqual(ids([]), []);
});
