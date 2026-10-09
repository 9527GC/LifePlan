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
import FloatingPomodoro from "@/pages/FloatingPomodoro";
import Rewards from "@/pages/Rewards";
import DailyReviewDemo from "@/pages/DailyReviewDemo";
import { eventsApi, systemApi } from "@/lib/api";
import type { StartupNotice } from "@/types";
import { track } from "@/lib/analytics";
import OnboardingCarousel from "@/components/ui/OnboardingCarousel";

export default function App() {
  const isFloatingPomodoroWindow = typeof window !== "undefined" && window.location.hash.startsWith("#/pomodoro-floating");
  const [notice, setNotice] = useState<StartupNotice | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState("");
  const [showOnboarding, setShowOnboarding] = useState(() => !isFloatingPomodoroWindow && localStorage.getItem("lifeplan-onboarding-v1-completed") !== "1" && localStorage.getItem("lifeplan-onboarding-completed") !== "1");

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
    if (isFloatingPomodoroWindow) return;
    track("应用启动");
    void systemApi.startupNotice().then(setNotice).catch((error) => setRetryError(String(error)));
  }, [isFloatingPomodoroWindow]);

  useEffect(() => {
    if (isFloatingPomodoroWindow) return;
    let running = false;
    let stopped = false;
    let boundaryTimer: number;
    const check = async () => {
      if (running || stopped) return;
      running = true;
      try {
        if (await eventsApi.checkDueDelays() && !stopped) {
          window.dispatchEvent(new Event("lifeplan:delays-restored"));
        }
      } catch (error) {
        console.error("检查推迟事件恢复失败", error);
      } finally {
        running = false;
      }
    };
    // 精确检查每日 17:00；轮询及返回窗口时补查，覆盖休眠、时钟调整等情况。
    const scheduleBoundary = () => {
      const now = new Date();
      const next = new Date(now);
      next.setHours(17, 0, 0, 0);
      if (next <= now) next.setDate(next.getDate() + 1);
      boundaryTimer = window.setTimeout(() => {
        void check();
        scheduleBoundary();
      }, next.getTime() - now.getTime());
    };
    const onReturn = () => {
      if (document.visibilityState === "visible") void check();
    };
    void check();
    scheduleBoundary();
    const interval = window.setInterval(() => void check(), 60_000);
    window.addEventListener("focus", onReturn);
    document.addEventListener("visibilitychange", onReturn);
    return () => {
      stopped = true;
      window.clearTimeout(boundaryTimer);
      window.clearInterval(interval);
      window.removeEventListener("focus", onReturn);
      document.removeEventListener("visibilitychange", onReturn);
    };
  }, [isFloatingPomodoroWindow]);

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
      Tooltip: {
        colorBgSpotlight: "#fff",
        colorTextLightSolid: "#303133",
      },
    },
  }}>
    {!isFloatingPomodoroWindow && notice && <Alert
      className="startup-notice"
      type={notice.kind === "backup_warning" ? "warning" : "info"}
      showIcon
      closable
      onClose={() => setNotice(null)}
      message={notice.kind === "backup_warning" ? "启动备份未完成" : "数据库已恢复"}
      description={<span>{notice.message}{retryError && <span className="startup-notice-error">{retryError}</span>}</span>}
      action={notice.kind === "backup_warning" ? <Button size="small" loading={retrying} onClick={() => void retryBackup()}>立即重试</Button> : undefined}
    />}
    {!isFloatingPomodoroWindow && showOnboarding && <OnboardingCarousel onFinish={() => setShowOnboarding(false)} />}
    <HashRouter><Routes><Route path="pomodoro-floating" element={<FloatingPomodoro />} /><Route path="/" element={<Layout />}><Route index element={<Navigate to="/daily-list" replace />} /><Route path="daily-list" element={<DailyList />} /><Route path="pomodoro" element={<Pomodoro />} /><Route path="rewards" element={<Rewards />} /><Route path="daily-review" element={<DailyReviewDemo />} /><Route path="inbox" element={<Inbox />} /></Route></Routes></HashRouter>
  </ConfigProvider>;
}









