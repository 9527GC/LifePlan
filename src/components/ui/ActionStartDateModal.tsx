import { useState } from "react";
import dayjs, { type Dayjs } from "dayjs";
import {
  Alert,
  Button,
  Checkbox,
  Modal,
  Space,
  Typography,
  message,
} from "antd";
import DatePickerWithWeekday from "./DatePickerWithWeekday";
import { planStartDateAdjustment } from "@/lib/actionStartDateAdjustment";
import { actionsApi } from "@/lib/api";
import { userFacingError } from "@/lib/errors";
import type { Action } from "@/types";

export default function ActionStartDateModal({
  action,
  following,
  onClose,
  onSaved,
}: {
  action: Action;
  following: Action[];
  onClose: () => void;
  onSaved: (actions: Action[]) => void;
}) {
  const [messageApi, messageContextHolder] = message.useMessage();
  const [date, setDate] = useState<Dayjs | null>(() =>
    action.start_date ? dayjs(action.start_date) : null,
  );
  const [touched, setTouched] = useState(false);
  const [cascade, setCascade] = useState(false);
  const [saving, setSaving] = useState(false);
  const newDate = date?.format("YYYY-MM-DD") ?? null;
  const { delta, canCascade, preview, changes, conflicts, skipped } =
    planStartDateAdjustment(action, following, newDate, cascade);
  const pastCount = preview.filter(
    (item) => item.date && item.date < dayjs().format("YYYY-MM-DD"),
  ).length;
  const save = async () => {
    if (!touched || !changes.length || conflicts.length) return;
    setSaving(true);
    try {
      const updated = await actionsApi.adjustStartDates({
        changes: changes.map((item) => ({
          id: item.action.id,
          expected_updated_at: item.action.updated_at,
          start_date: item.date,
        })),
      });
      onSaved(updated);
    } catch (cause) {
      messageApi.error(userFacingError(cause));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal
      open
      title="调整开始日期"
      width={520}
      onCancel={onClose}
      closable={!saving}
      mask={{ closable: !saving }}
      keyboard={!saving}
      footer={
        <Space>
          <Button disabled={saving} onClick={onClose}>
            取消
          </Button>
          <Button
            type="primary"
            loading={saving}
            disabled={!touched || !changes.length || Boolean(conflicts.length)}
            onClick={() => void save()}
          >
            {newDate === null && touched ? "确认清空" : "确认调整"}
          </Button>
        </Space>
      }
    >
      {messageContextHolder}
      <div className="action-start-date-form">
        <Typography.Text strong>{action.title}</Typography.Text>
        <Typography.Text type="secondary">
          原开始日期：{action.start_date || "未设置"}
        </Typography.Text>
        <div className="action-start-date-input">
          <DatePickerWithWeekday
            className="full-width"
            value={date}
            allowClear
            disabled={saving}
            placeholder="选择新的开始日期"
            onChange={(value) => {
              setDate(value);
              setTouched(true);
            }}
          />
        </div>
        {canCascade && (
          <Checkbox
            checked={cascade}
            disabled={saving || !following.length}
            onChange={(event) => setCascade(event.target.checked)}
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
                      item.action.deadline &&
                      item.date > item.action.deadline
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
            {conflicts.length > 0 && (
              <Alert
                type="error"
                showIcon
                title="开始日期不能晚于截止日期"
                description={conflicts
                  .map(
                    (item) =>
                      `${item.action.title}（截止 ${item.action.deadline}）`,
                  )
                  .join("、")}
              />
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
