import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

test("重复行动开始时间选择器启用多选并保留必填校验", () => {
  const source = readFileSync(new URL("../../src/pages/DailyList.tsx", import.meta.url), "utf8");
  const file = ts.createSourceFile("DailyList.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let startTimeField;
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === "NewRecurringActionForm") {
      function findField(child) {
        if (ts.isJsxElement(child) && child.openingElement.tagName.getText(file) === "Form.Item" &&
          child.openingElement.attributes.properties.some((attr) => ts.isJsxAttribute(attr) && attr.name.getText(file) === "name" && attr.initializer?.text === "start_time")) {
          startTimeField = child;
        }
        ts.forEachChild(child, findField);
      }
      findField(node);
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  assert.ok(startTimeField, "应存在重复行动开始时间字段");
  const select = startTimeField.children.find((child) => ts.isJsxSelfClosingElement(child) && child.tagName.getText(file) === "Select");
  assert.ok(select, "应存在时间选择器");
  assert.ok(select.attributes.properties.some((attr) => ts.isJsxAttribute(attr) && attr.name.getText(file) === "mode" && attr.initializer?.text === "multiple"), "必须启用多选模式");
  assert.match(startTimeField.openingElement.getText(file), /required: true/);
  assert.match(startTimeField.openingElement.getText(file), /label="开始时间（可多选）"/);
  assert.doesNotMatch(startTimeField.openingElement.getText(file), /extra=/);
  assert.match(select.getText(file), /maxTagCount="responsive"/);
  assert.match(select.getText(file), /maxTagPlaceholder=/);
  assert.match(select.getText(file), /<Tooltip title=/);
  assert.match(select.getText(file), /omittedValues\.map/);
  assert.match(source, /start_time: action\.start_time\.split/);
  assert.match(source, /new Set<string>\(values\.start_time\)/);
});
