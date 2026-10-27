import dayjs from "dayjs";
import { Alert, Checkbox, Typography } from "antd";
import { planStartDateAdjustment } from "@/lib/actionStartDateAdjustment";
import type { Action } from "@/types";

/** 日期编辑入口共用联动文案、预览与提醒。 */
export default function ActionStartDateAdjustmentPreview({ action, following, newDate, touched, cascade, saving, onCascadeChange }: {
  action: Action; following: Action[]; newDate: string | null;
  touched: boolean; cascade: boolean; saving: boolean;
  onCascadeChange: (value: boolean) => void;
}) {
  const { delta, canCascade, preview, changes, deadlineWarnings, skipped } = planStartDateAdjustment(action, following, newDate, cascade);
  const pastCount = preview.filter((item) => item.date && item.date < dayjs().format("YYYY-MM-DD")).length;
  return <div className="action-start-date-form">
        {canCascade && (
          <Checkbox
            checked={cascade}
            disabled={saving || !following.length}
            onChange={(event) => onCascadeChange(event.target.checked)}
          >
            同时调整该事件下的后续未完成行动
          </Checkbox>
        )}
        {!canCascade && (
          <Typography.Text type="secondary">
            当前行动未设置开始日期，本次仅调整该条行动。
          </Typography.Text>
        )}
        {touched && (
          <>
            <Typography.Text type="secondary">
              {newDate === null
                ? "清空开始日期"
                : delta > 0
                  ? `统一后延 ${delta} 天`
                  : delta < 0
                    ? `统一提前 ${Math.abs(delta)} 天`
                    : "设置开始日期"}{" "}
              · 将修改 {changes.length} 条行动
            </Typography.Text>
            <div className="action-start-date-preview">
              {preview.map((item) => (
                <div
                  className="action-start-date-preview-row"
                  key={item.action.id}
                >
                  <Typography.Text ellipsis={{ tooltip: item.action.title }}>
                    {item.action.title}
                  </Typography.Text>
                  <span
                    className={
                      item.date &&
                      item.action.event_deadline &&
                      item.date > item.action.event_deadline
                        ? "action-start-date-conflict"
                        : ""
                    }
                  >
                    {item.action.start_date || "未设置"} →{" "}
                    {item.date || "未设置"}
                  </span>
                </div>
              ))}
            </div>
            {skipped > 0 && (
              <Typography.Text type="secondary">
                另有 {skipped} 条后续行动未设置开始日期，不作调整。
              </Typography.Text>
            )}
            {pastCount > 0 && (
              <Alert
                type="info"
                showIcon
                title={`${pastCount} 条行动的开始日期早于今日，将视为已到可开始日期。`}
              />
            )}
            {deadlineWarnings.length > 0 && (
              <Alert
                type="warning"
                showIcon
                title="开始日期已超过事件截止日期"
              />
            )}
          </>
        )}
  </div>;
}
