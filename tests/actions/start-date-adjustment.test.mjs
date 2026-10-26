import test from "node:test";
import assert from "node:assert/strict";
import { planStartDateAdjustment as plan } from "../../src/lib/actionStartDateAdjustment.ts";
const action = (id, start_date, extra = {}) => ({
  id,
  event_id: 1,
  status: 0,
  start_date,
  ...extra,
});
const current = action(1, "2026-10-10");
const following = [
  action(2, "2026-10-12"),
  action(3, undefined),
  action(4, "2026-10-15"),
];
test("后延保留日期间隔并跳过无日期行动", () => {
  const result = plan(current, following, "2026-10-13", true);
  assert.equal(result.delta, 3);
  assert.deepEqual(
    result.preview.map((item) => item.date),
    ["2026-10-13", "2026-10-15", "2026-10-18"],
  );
  assert.equal(result.skipped, 1);
});
test("允许提前到过去并跨月计算", () => {
  const result = plan(current, following, "2026-09-30", true);
  assert.equal(result.delta, -10);
  assert.deepEqual(
    result.preview.map((item) => item.date),
    ["2026-09-30", "2026-10-02", "2026-10-05"],
  );
});
test("清空联动包括原本无日期行动但不产生无效修改", () => {
  const result = plan(current, following, null, true);
  assert.equal(result.preview.length, 4);
  assert.equal(result.changes.length, 3);
  assert.ok(result.preview.every((item) => item.date === null));
});
test("不勾选只调整当前行动", () => {
  assert.equal(plan(current, following, "2026-10-13", false).changes.length, 1);
});
test("无原日期仅调整当前行动，设置和清空均不联动", () => {
  assert.equal(
    plan(action(1), following, "2026-10-13", true).canCascade,
    false,
  );
  assert.equal(
    plan(action(1), following, "2026-10-13", true).preview.length,
    1,
  );
  assert.equal(plan(action(1), following, null, true).changes.length, 0);
  assert.equal(plan(action(1), following, null, true).preview.length, 1);
});
test("同日期不产生修改", () => {
  assert.equal(
    plan(current, following, current.start_date, true).changes.length,
    0,
  );
});
test("已完成和其他事件的行动不会参与联动", () => {
  assert.equal(
    plan(
      current,
      [
        action(2, "2026-10-12", { status: 1 }),
        action(3, "2026-10-12", { event_id: 2 }),
      ],
      null,
      true,
    ).preview.length,
    1,
  );
});
test("联动超期仅生成提醒，仍保留全部待保存修改，清空无提醒", () => {
  const list = [action(2, "2026-10-12", { event_deadline: "2026-10-14" })];
  const result = plan(current, list, "2026-10-13", true);
  assert.equal(result.deadlineWarnings.length, 1);
  assert.deepEqual(result.changes.map((item) => item.date), ["2026-10-13", "2026-10-15"]);
  assert.equal(plan(current, list, null, true).deadlineWarnings.length, 0);
});

test("事件延期或取消期限后不受行动历史截止日期限制", () => {
  const legacy = action(1, "2026-10-10", { deadline: "2026-10-11", event_deadline: "2026-11-30" });
  assert.equal(plan(legacy, [], "2026-11-15", false).deadlineWarnings.length, 0);
  assert.equal(plan({ ...legacy, event_deadline: undefined }, [], "2026-12-15", false).deadlineWarnings.length, 0);
});


test("截止当日无提醒，超过截止日期仍可单独保存，无期限不提醒", () => {
  const target = action(1, "2026-10-10", { event_deadline: "2026-10-14" });
  assert.equal(plan(target, [], "2026-10-14", false).deadlineWarnings.length, 0);
  const overdue = plan(target, [], "2026-10-15", false);
  assert.equal(overdue.deadlineWarnings.length, 1);
  assert.equal(overdue.changes[0].date, "2026-10-15");
  assert.equal(plan(current, [], "2026-10-15", false).deadlineWarnings.length, 0);
});
