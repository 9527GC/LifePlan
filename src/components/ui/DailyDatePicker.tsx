import dayjs from "dayjs";
import { DatePicker, Tag, Typography } from "antd";

const weekdayNames = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];

type DailyDatePickerProps = {
  date: string;
  onChange: (date: string) => void;
  actionScheduleDates?: string[];
  disableFutureDates?: boolean;
};

/** 今日事与每日复盘共用的日期选择与日期上下文。 */
export default function DailyDatePicker({
  date,
  onChange,
  actionScheduleDates = [],
  disableFutureDates = false,
}: DailyDatePickerProps) {
  const isToday = date === dayjs().format("YYYY-MM-DD");
  const weekdayName = weekdayNames[dayjs(date).day()];

  return (
    <div className="daily-date-panel">
      {isToday && <Tag color="blue" className="daily-today-tag">今天</Tag>}
      <DatePicker
        className="daily-date-picker"
        value={dayjs(date)}
        format="YYYY年MM月DD日"
        allowClear={false}
        disabledDate={
          disableFutureDates ? (current) => current.isAfter(dayjs(), "day") : undefined
        }
        cellRender={(current, info) => {
          if (info.type !== "date") return info.originNode;
          const hasActionSchedule = actionScheduleDates.includes(
            dayjs(current).format("YYYY-MM-DD"),
          );
          return (
            <div className="daily-date-picker-cell">
              {info.originNode}
              {hasActionSchedule && (
                <span className="daily-date-action-dot" aria-label="当天已安排行动" />
              )}
            </div>
          );
        }}
        onChange={(value) => value && onChange(value.format("YYYY-MM-DD"))}
      />
      <Typography.Text className="daily-date-context">
        <span className="daily-weekday-name">{weekdayName}</span>
      </Typography.Text>
    </div>
  );
}
