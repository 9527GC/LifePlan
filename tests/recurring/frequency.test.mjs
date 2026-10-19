import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = readFileSync(new URL("../../src/pages/DailyList.tsx", import.meta.url), "utf8");
const file = ts.createSourceFile("DailyList.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

function findNode(predicate, root = file) {
  if (predicate(root)) return root;
  return ts.forEachChild(root, (child) => findNode(predicate, child));
}

// 执行真实表单提交回调，覆盖用户选择到 API 入参的转换。
function submitForm(action, values) {
  const form = findNode((node) => ts.isFunctionDeclaration(node) && node.name?.text === "NewRecurringActionForm");
  const onFinish = findNode((node) => ts.isJsxAttribute(node) && node.name.getText(file) === "onFinish", form);
  const callback = ts.transpile(`const submit = ${onFinish.initializer.expression.getText(file)};`, {
    target: ts.ScriptTarget.ES2020,
  });
  let payload;
  new Function("action", "onSubmit", "values", `${callback}\nsubmit(values);`)(action, (value) => { payload = value; }, values);
  return payload;
}

for (const scheduleType of ["daily", "weekly"]) {
  for (const action of [null, { id: 42 }]) {
    test(`${action ? "编辑" : "新增"}${scheduleType === "daily" ? "每日" : "每周"}行动保留重复间隔和开始日期`, () => {
      for (const interval of [1, 2, 3, 4]) {
        const payload = submitForm(action, {
          title: "周期行动", estimated_hours: 0.5,
          schedule_type: scheduleType, frequency_count: interval,
          schedule_start_date: { format: (format) => {
            assert.equal(format, "YYYY-MM-DD");
            return "2026-10-21";
          } },
          schedule_days: scheduleType === "weekly" ? [2, 5] : [],
          start_time: ["15:00"],
        });
        assert.equal(payload.frequency_count, interval);
        assert.equal(payload.schedule_start_date, "2026-10-21");
        assert.equal(payload.schedule_type, scheduleType);
        assert.equal(payload.id, action?.id);
      }
    });
  }
}

test("新增行动传给 API 时保留开始日期和间隔", () => {
  const declaration = findNode((node) => ts.isVariableDeclaration(node) && node.name.getText(file) === "newPayload");
  const expression = ts.transpile(`const result = ${declaration.initializer.getText(file)};`, { target: ts.ScriptTarget.ES2020 });
  const result = new Function("payload", `${expression}\nreturn result;`)({ frequency_count: 3, schedule_start_date: "2026-10-21" });
  assert.equal(result.frequency_count, 3);
  assert.equal(result.schedule_start_date, "2026-10-21");
});

test("切换到每月后不提交隐藏的每日每周设置", () => {
  const payload = submitForm(null, {
    title: "每月行动", estimated_hours: 1, schedule_type: "monthly",
    frequency_count: 4, schedule_days: [15], start_time: ["15:00"],
  });
  assert.equal(payload.frequency_count, 1);
  assert.equal(payload.schedule_start_date, "");
  assert.equal(payload.schedule_days, "15");
});
