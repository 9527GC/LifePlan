import { useState } from "react";
import dayjs, { type Dayjs } from "dayjs";
import {
  Button,
  Modal,
  Space,
  Typography,
  message,
} from "antd";
import ActionStartDateAdjustmentPreview from "./ActionStartDateAdjustmentPreview";
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
  const { changes } = planStartDateAdjustment(action, following, newDate, cascade);
  const save = async () => {
    if (!touched || !changes.length) return;
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
            disabled={!touched || !changes.length}
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
        <ActionStartDateAdjustmentPreview action={action} following={following} newDate={newDate}
          touched={touched} cascade={cascade} saving={saving} onCascadeChange={setCascade} />
      </div>
    </Modal>
  );
}
