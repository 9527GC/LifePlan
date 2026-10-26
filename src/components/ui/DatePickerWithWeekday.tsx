import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import dayjs, { type Dayjs } from "dayjs";
import { Button, Calendar, DatePicker, Input, Modal, Space, type DatePickerProps } from "antd";

export type DatePickerWithWeekdayProps = Omit<DatePickerProps<Dayjs, false>, "value" | "onChange"> & {
  value?: Dayjs | null;
  onChange?: DatePickerProps<Dayjs, false>["onChange"];
  showWeekday?: boolean;
};

const weekdayNames = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

/** 空间不足时使用独立日期弹框，输入区固定可见，日历单独滚动。 */
export default function DatePickerWithWeekday({
  value, onChange, format = "YYYY-MM-DD", showWeekday = true,
  onOpenChange, open: controlledOpen, panelRender, styles, ...props
}: DatePickerWithWeekdayProps) {
  const host = useRef<HTMLSpanElement>(null);
  const [popupPanel, setPopupPanel] = useState<HTMLDivElement | null>(null);
  const popupSize = useRef<{ width: number; height: number } | null>(null);
  const [opened, setOpened] = useState(false);
  const [measured, setMeasured] = useState(false);
  const [compact, setCompact] = useState(false);
  const [text, setText] = useState("");
  const [invalid, setInvalid] = useState(false);
  const [panelDate, setPanelDate] = useState<Dayjs>(() => value ?? dayjs());
  const dateFormat = typeof format === "string" ? format : "YYYY-MM-DD";
  const isOpen = controlledOpen ?? opened;
  const displayFormat = (current: Dayjs) => showWeekday
    ? current.format(dateFormat) + " " + weekdayNames[current.day()]
    : current.format(dateFormat);
  const measure = useCallback(() => {
    const rect = host.current?.querySelector(".ant-picker")?.getBoundingClientRect();
    const size = popupSize.current;
    if (!rect || !size) return;
    const above = rect.top - 16;
    const below = window.innerHeight - rect.bottom - 16;
    setCompact(window.innerWidth - 32 < size.width || Math.max(above, below) < size.height);
    setMeasured(true);
  }, []);
  useLayoutEffect(() => {
    if (!isOpen || compact || !popupPanel) return;
    const updateSize = () => {
      // 使用实际面板及下拉容器的布局尺寸，避免开启动画缩放影响测量。
      const dropdown = popupPanel.closest<HTMLElement>(".ant-picker-dropdown");
      const width = dropdown?.offsetWidth || popupPanel.offsetWidth;
      const height = dropdown?.offsetHeight || popupPanel.offsetHeight;
      if (width && height) {
        popupSize.current = { width, height };
        measure();
      }
    };
    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(popupPanel);
    return () => observer.disconnect();
  }, [isOpen, compact, popupPanel, measure]);
  useEffect(() => {
    if (!isOpen) return;
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [isOpen, measure]);
  useEffect(() => {
    if (isOpen) {
      setText(value?.format("YYYY-MM-DD") ?? "");
      setPanelDate(value ?? dayjs());
      setInvalid(false);
    }
  }, [isOpen, value]);
  const changeOpen = (next: boolean) => {
    // 已知尺寸直接判断；首次面板仅隐藏测量，避免先闪现下拉再切换弹框。
    if (next) {
      if (popupSize.current) measure();
      else { setMeasured(false); setCompact(false); }
    }
    setOpened(next);
    onOpenChange?.(next);
  };
  const disabledDate = (date: Dayjs) => Boolean(
    (props.minDate && date.isBefore(props.minDate, "day")) ||
    (props.maxDate && date.isAfter(props.maxDate, "day")) ||
    props.disabledDate?.(date, { type: "date" })
  );
  const select = (date: Dayjs | null) => {
    if (date && disabledDate(date)) { setInvalid(true); return; }
    onChange?.(date, date ? displayFormat(date) : "");
    changeOpen(false);
  };
  const submitText = () => {
    if (!text && props.allowClear !== false) { select(null); return; }
    const parsed = dayjs(text);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || !parsed.isValid() || parsed.format("YYYY-MM-DD") !== text) {
      setInvalid(true);
      return;
    }
    select(parsed);
  };
  return (
    <>
      <span ref={host} className="adaptive-date-trigger">
        <DatePicker
          {...props}
          value={value}
          onChange={onChange}
          format={displayFormat}
          styles={(info) => {
            const original = typeof styles === "function" ? styles(info) : styles;
            return {
              ...original,
              popup: {
                ...original?.popup,
                root: {
                  ...original?.popup?.root,
                  ...(!measured || compact ? { visibility: "hidden", pointerEvents: "none" } : {}),
                },
              },
            };
          }}
          open={isOpen && !compact}
          onOpenChange={changeOpen}
          panelRender={(panel) => (
            <div ref={setPopupPanel}>{panelRender ? panelRender(panel) : panel}</div>
          )}
        />
      </span>
      <Modal
        open={isOpen && compact}
        title="选择日期"
        width={360}
        className="compact-date-modal"
        onCancel={() => changeOpen(false)}
        destroyOnHidden
        footer={
          <Space>
            <Button onClick={() => changeOpen(false)}>取消</Button>
            <Button type="primary" onClick={submitText}>确定</Button>
          </Space>
        }
      >
        <div className="compact-date-input">
          <Input
            aria-label="输入日期"
            placeholder="YYYY-MM-DD"
            value={text}
            status={invalid ? "error" : undefined}
            allowClear={props.allowClear !== false}
            onChange={(event) => { setText(event.target.value); setInvalid(false); }}
            onPressEnter={(event) => { event.preventDefault(); event.stopPropagation(); submitText(); }}
          />
          {invalid && <span role="alert">请输入有效且可选择的日期（YYYY-MM-DD）</span>}
        </div>
        <div className="compact-date-calendar">
          <Calendar
            fullscreen={false}
            value={panelDate}
            disabledDate={disabledDate}
            cellRender={props.cellRender}
            onPanelChange={setPanelDate}
            onSelect={(date, info) => { if (info.source === "date") select(date); }}
          />
          {props.showNow !== false && <Button type="link" block disabled={disabledDate(dayjs())} onClick={() => select(dayjs())}>今天</Button>}
        </div>
      </Modal>
    </>
  );
}
