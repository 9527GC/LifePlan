export const REVIEW_REASON_OPTIONS = [
  { value: "plan", label: "计划或估时不合理", description: "排程过满、估时偏短、任务拆分不合理。", suggestion: "减少安排量，为同类任务预留缓冲。" },
  { value: "priority", label: "优先级或主动调整", description: "主动改做了更重要的事项，不属于被动打断。", suggestion: "明确明日最重要事项，避免临时切换。" },
  { value: "interrupt", label: "外部打断", description: "会议、他人请求、临时事务、环境干扰。", suggestion: "预留缓冲时间，集中处理临时事项。" },
  { value: "dependency", label: "前置条件受阻", description: "等待他人、资料、权限、工具或其他资源。", suggestion: "提前确认前置条件，并准备替代任务。" },
  { value: "clarity", label: "任务不清晰", description: "不清楚下一步、完成标准或执行方案。", suggestion: "安排前先明确下一步和完成标准。" },
  { value: "energy", label: "精力与状态不足", description: "疲劳、身体或情绪状态影响了持续投入。", suggestion: "将高认知任务安排在精力较好的时段。" },
  { value: "other", label: "其他", description: "无法归入以上原因时选择。", suggestion: "结合实际情况，为明日留出调整空间。" },
] as const;

export type ReviewReasonCode = (typeof REVIEW_REASON_OPTIONS)[number]["value"];
export const REVIEW_REASON_BY_CODE = Object.fromEntries(REVIEW_REASON_OPTIONS.map((reason) => [reason.value, reason])) as Record<ReviewReasonCode, (typeof REVIEW_REASON_OPTIONS)[number]>;
export const isReviewReasonCode = (value: unknown): value is ReviewReasonCode => REVIEW_REASON_OPTIONS.some((reason) => reason.value === value);
