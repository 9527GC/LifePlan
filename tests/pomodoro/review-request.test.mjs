import test from "node:test";
import assert from "node:assert/strict";
import { savePomodoroReviewRequest, consumePomodoroReviewRequest, hasPendingPomodoroReviewRequest } from "../../src/lib/pomodoroSession.ts";

const data = new Map();
globalThis.localStorage = {
  getItem: (key) => data.get(key) ?? null,
  setItem: (key, value) => data.set(key, value),
  removeItem: (key) => data.delete(key),
};

test("关联行动请求在主窗口消费前保持待处理，事件和焦点只处理一次", () => {
  data.clear();
  savePomodoroReviewRequest(42);
  assert.equal(hasPendingPomodoroReviewRequest(), true);
  assert.deepEqual(consumePomodoroReviewRequest(), { actionId: 42 });
  assert.equal(hasPendingPomodoroReviewRequest(), false);
  assert.equal(consumePomodoroReviewRequest(), null);
});

test("无关联行动仍能确认请求已接收", () => {
  data.clear();
  savePomodoroReviewRequest();
  assert.equal(hasPendingPomodoroReviewRequest(), true);
  assert.deepEqual(consumePomodoroReviewRequest(), {});
  assert.equal(hasPendingPomodoroReviewRequest(), false);
});

test("损坏的旧请求被清除，不会反复触发跳转", () => {
  data.clear();
  data.set("lifeplan-pomodoro-review-request", "无效数据");
  assert.equal(consumePomodoroReviewRequest(), null);
  assert.equal(hasPendingPomodoroReviewRequest(), false);
});
