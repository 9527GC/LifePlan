import type { Dayjs } from "dayjs";
import { DatePicker, type DatePickerProps } from "antd";

export type DatePickerWithWeekdayProps = Omit<DatePickerProps<Dayjs, false>, "value" | "onChange"> & {
  value?: Dayjs | null;
  onChange?: DatePickerProps<Dayjs, false>["onChange"];
};

const weekdayNames = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

/** 在日期选择器输入框内，将中文星期展示在日期文案后面。 */
export default function DatePickerWithWeekday({
  value,
  onChange,
  format = "YYYY-MM-DD",
  ...props
}: DatePickerWithWeekdayProps) {
  const dateFormat = typeof format === "string" ? format : "YYYY-MM-DD";

  return (
    <DatePicker
      {...props}
      value={value}
      onChange={onChange}
      format={(current) => `${current.format(dateFormat)} ${weekdayNames[current.day()]}`}
    />
  );
}
