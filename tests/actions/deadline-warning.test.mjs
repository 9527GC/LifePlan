import test from "node:test";
import assert from "node:assert/strict";
import { actionDeadlineWarning } from "../../src/lib/actionDeadline.ts";

test("仅超过截止日期时提醒，截止当日及之前不提醒", () => {
  assert.equal(actionDeadlineWarning("2026-10-25", "2026-10-26"), undefined);
  assert.equal(actionDeadlineWarning("2026-10-26", "2026-10-26"), undefined);
  assert.equal(
    actionDeadlineWarning("2026-10-27", "2026-10-26"),
    "行动开始日期已超过事件截止日期（2026-10-26）",
  );
});

test("清空日期或未设置事件截止日期时无提醒", () => {
  for (const empty of [undefined, null, ""]) {
    assert.equal(actionDeadlineWarning(empty, "2026-10-26"), undefined);
    assert.equal(actionDeadlineWarning("2026-10-27", empty), undefined);
  }
});

test("重新选择日期或修改截止日期时按最新值判断，跨月跨年正确", () => {
  assert.ok(actionDeadlineWarning("2027-01-01", "2026-12-31"));
  assert.ok(actionDeadlineWarning("2026-11-01", "2026-10-31"));
  assert.equal(actionDeadlineWarning("2026-10-27", "2026-10-28"), undefined);
  assert.ok(actionDeadlineWarning("2026-10-27", "2026-10-26"));
  assert.equal(actionDeadlineWarning("2026-10-25", "2026-10-26"), undefined);
});
