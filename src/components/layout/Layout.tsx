import { NavLink, Outlet, useLocation } from "react-router-dom";
import { Archive, ListChecks } from "lucide-react";
import { Layout as AntLayout, Menu } from "antd";
import "@/App.css";

const navItems = [
  { to: "/inbox", icon: Archive, label: "事件篮" },
  { to: "/actions", icon: ListChecks, label: "行动" },
];

export default function Layout() {
  const location = useLocation();
  return <AntLayout className="app-shell">
    <AntLayout.Sider className="sidebar" width={148} theme="light">
      <div className="brand"><span className="brand-mark">L</span><span>LifePlan</span></div>
      <Menu mode="inline" selectedKeys={[location.pathname]} items={navItems.map(({ to, icon: Icon, label }) => ({ key: to, label: <NavLink to={to}>{label}</NavLink>, icon: <Icon size={17} /> }))} />
      <div className="sidebar-note">把想法变成<br />下一步行动</div>
    </AntLayout.Sider>
    <AntLayout><AntLayout.Content className="main-content"><Outlet /></AntLayout.Content></AntLayout>
  </AntLayout>;
}
