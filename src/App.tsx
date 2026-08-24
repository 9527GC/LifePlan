import { useEffect, useState } from "react";
import { HashRouter, Navigate, Route, Routes } from "react-router-dom";
import { Alert, Button, ConfigProvider } from "antd";
import zhCN from "antd/locale/zh_CN";
import Layout from "@/components/layout/Layout";
import Inbox from "@/pages/Inbox";
import Actions from "@/pages/Actions";
import { systemApi } from "@/lib/api";
import type { StartupNotice } from "@/types";

export default function App() {
  const [notice, setNotice] = useState<StartupNotice | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState("");

  useEffect(() => {
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

  return <ConfigProvider locale={zhCN} theme={{
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
    <HashRouter><Routes><Route path="/" element={<Layout />}><Route index element={<Navigate to="/inbox" replace />} /><Route path="inbox" element={<Inbox />} /><Route path="projects" element={<Navigate to="/inbox" replace />} /><Route path="actions" element={<Actions />} /></Route></Routes></HashRouter>
  </ConfigProvider>;
}
