import { useEffect, useState } from "react";
import dayjs from "dayjs";
import updateLocale from "dayjs/plugin/updateLocale";
import "dayjs/locale/zh-cn";
import { HashRouter, Navigate, Route, Routes } from "react-router-dom";
import { Alert, Button, ConfigProvider } from "antd";
import zhCN from "antd/locale/zh_CN";

dayjs.extend(updateLocale);
dayjs.updateLocale("zh-cn", {
  weekStart: 1,
  weekdaysMin: ["日", "一", "二", "三", "四", "五", "六"],
  weekdaysShort: ["日", "一", "二", "三", "四", "五", "六"],
});
dayjs.locale("zh-cn");

const chineseCalendarLocale = {
  ...zhCN,
  DatePicker: {
    ...zhCN.DatePicker!,
    lang: {
      ...zhCN.DatePicker!.lang,
      weekStart: 1,
      weekdaysMin: ["日", "一", "二", "三", "四", "五", "六"],
      weekdaysShort: ["日", "一", "二", "三", "四", "五", "六"],
    },
  },
};
import Layout from "@/components/layout/Layout";
import Inbox from "@/pages/Inbox";
import DailyList from "@/pages/DailyList";
import Pomodoro from "@/pages/Pomodoro";
import Rewards from "@/pages/Rewards";
import { systemApi } from "@/lib/api";
import type { StartupNotice } from "@/types";
import { track } from "@/lib/analytics";
import OnboardingCarousel from "@/components/ui/OnboardingCarousel";

export default function App() {
  const [notice, setNotice] = useState<StartupNotice | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState("");
  const [showOnboarding, setShowOnboarding] = useState(() => localStorage.getItem("lifeplan-onboarding-v1-completed") !== "1" && localStorage.getItem("lifeplan-onboarding-completed") !== "1");

  useEffect(() => {
    const handleOpenOnboarding = () => setShowOnboarding(true);
    window.addEventListener("lifeplan:open-onboarding", handleOpenOnboarding);
    return () => window.removeEventListener("lifeplan:open-onboarding", handleOpenOnboarding);
  }, []);

  useEffect(() => {
    const handleContextMenu = (event: MouseEvent) => {
      event.preventDefault();
    };

    document.addEventListener("contextmenu", handleContextMenu);
    return () => document.removeEventListener("contextmenu", handleContextMenu);
  }, []);

  useEffect(() => {
    track("应用启动");
    void systemApi.startupNotice().then(setNotice).catch((error) => setRetryError(String(error)));
  }, []);

  const retryBackup = async () => {
    setRetrying(true);
    setRetryError("");
    try {
      await systemApi.retryStartupBackup();
      setNotice(null);
    } catch (error) {
      setRetryError(String(error).replace(/^Error: /, ""));
    } finally {
      setRetrying(false);
    }
  };

  return <ConfigProvider locale={chineseCalendarLocale} theme={{
    token: {
      colorPrimary: "#1778FF",
      borderRadius: 6,
      controlHeight: 32,
      fontFamily: '"PingFang SC", "Microsoft YaHei", system-ui, sans-serif',
      colorBgLayout: "#f5f7fa",
    },
    components: {
      Button: { controlHeight: 32, borderRadius: 6 },
      Input: { controlHeight: 32, activeShadow: "0 0 0 2px rgba(23, 120, 255, 0.12)" },
      Select: { controlHeight: 32 },
      DatePicker: { controlHeight: 32 },
      Modal: { borderRadiusLG: 8 },
    },
  }}>
    {notice && <Alert
      className="startup-notice"
      type={notice.kind === "backup_warning" ? "warning" : "info"}
      showIcon
      closable
      onClose={() => setNotice(null)}
      message={notice.kind === "backup_warning" ? "启动备份未完成" : "数据库已恢复"}
      description={<span>{notice.message}{retryError && <span className="startup-notice-error">{retryError}</span>}</span>}
      action={notice.kind === "backup_warning" ? <Button size="small" loading={retrying} onClick={() => void retryBackup()}>立即重试</Button> : undefined}
    />}
    {showOnboarding && <OnboardingCarousel onFinish={() => setShowOnboarding(false)} />}
    <HashRouter><Routes><Route path="/" element={<Layout />}><Route index element={<Navigate to="/daily-list" replace />} /><Route path="daily-list" element={<DailyList />} /><Route path="pomodoro" element={<Pomodoro />} /><Route path="rewards" element={<Rewards />} /><Route path="inbox" element={<Inbox />} /></Route></Routes></HashRouter>
  </ConfigProvider>;
}







