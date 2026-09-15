import { useEffect, useState, type MouseEvent } from "react";
import { availableMonitors, getCurrentWindow, PhysicalPosition, PhysicalSize } from "@tauri-apps/api/window";
import { isFloatingModeSaved, loadWindowGeometry, saveWindowGeometry } from "@/lib/windowPreferences";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { Archive, CalendarCheck, ArrowDown, Gift, HelpCircle, LoaderCircle, Minus, Square, Timer, X } from "lucide-react";
import { Layout as AntLayout, Menu, message, Tooltip } from "antd";
import "@/App.css";
import { exportAnalyticsLog, track } from "@/lib/analytics";
import { checkForUpdate, installUpdate, type AvailableUpdate } from "@/lib/updater";

const navItems = [
  { to: "/daily-list", icon: CalendarCheck, label: "今日事" },
  { to: "/inbox", icon: Archive, label: "事件篮" },
  { to: "/pomodoro", icon: Timer, label: "番茄钟" },
  { to: "/rewards", icon: Gift, label: "奖励池" },
];

const quotes = [
  "先做最重要的事",
  "把大任务拆成小行动更容易开始",
  "清空大脑，专注行动。",
  "一次只做一件重要的事。",
  "先完成，再追求完美。",
  "用清单减少反复思考。",
  "给任务安排明确的下一步。",
  "时间有限，先做高价值的事。",
  "拖延的任务，往往就是那只青蛙。",
  "让环境帮助你保持专注。",
  "像整理衣柜一样整理要做的事",
  "人生就像在雪地里行走，向后看，是自己一路走来的轨迹；向前看，是白茫茫的一片。不要问‘该往哪儿走’，只要回答‘想往哪儿走’。自己的双脚就是书写历史的工具。",
  "培养习惯的秘诀是少、慢，而不是多、快，刚则易脆。",
  "首先我们养成习惯，然后习惯改变我们。",
  "培养习惯要给自己奖励，再微不足道的成就都要大肆庆祝。",
  "面对突发事件，先处理情绪、专注当下，下一步行动是什么？",
  "处理突发事件占用额外时间时，给自己设置底线，超过时间，请求帮助",
  "突发事件无法避免，只能降低出现的可能性和负面影响——形成系统",
  "要事第一：做完必须做的琐事，就立刻回到要事上来。",
  "可以用番茄钟搬走最大的石头。",
  "做十分重要的事，就会变成十分重要的人，做七分重要的事就会变成七分重要的人，而不重要的事，就会变成不重要的人。",
  "拆解事件时，2分钟可以搞定的事，立即去做，不要往后排。",
  "拆解事件时，需要别人做的，立即安排其他人做，并确定ddl，做好日程记录",
  "行动是可以直接去做的事，颗粒度为不用再往下拆的程度。",
  "职场里大家关注结果甚于关注过程。",
  "只要能将任务完成，省下来的时间都是自己的。",
].map((quote) => quote.replace(/\s+/g, ""));

export default function Layout() {
  const location = useLocation();
  const [logoClicks, setLogoClicks] = useState<number[]>([]);
  const [quote, setQuote] = useState(() => quotes[Math.floor(Math.random() * quotes.length)]);
  const [availableUpdate, setAvailableUpdate] = useState<AvailableUpdate | null>(null);
  const [isInstallingUpdate, setIsInstallingUpdate] = useState(false);

  useEffect(() => { track("查看页面", { path: location.pathname }); }, [location.pathname]);

  useEffect(() => {

    let disposed = false;

    void checkForUpdate()
      .then((update) => {
        if (!disposed) setAvailableUpdate(update);
      })
      .catch(() => {
        // 更新检查失败不影响用户正常使用。
      });

    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    const appWindow = getCurrentWindow();
    let disposed = false;
    let unlistenResize: (() => void) | undefined;
    let unlistenMove: (() => void) | undefined;
    const restore = async () => {
      try {
        const saved = loadWindowGeometry();
        if (saved) {
          const size = { width: Math.max(1050, saved.width), height: Math.max(650, saved.height) };
          const monitors = await availableMonitors();
          const isVisibleOnAnyMonitor = monitors.some((monitor) => {
            const left = Math.max(saved.x, monitor.position.x);
            const top = Math.max(saved.y, monitor.position.y);
            const right = Math.min(saved.x + size.width, monitor.position.x + monitor.size.width);
            const bottom = Math.min(saved.y + size.height, monitor.position.y + monitor.size.height);
            return right - left >= 80 && bottom - top >= 80;
          });

          await appWindow.setSize(new PhysicalSize(size.width, size.height));
          if (isVisibleOnAnyMonitor) {
            await appWindow.setPosition(new PhysicalPosition(saved.x, saved.y));
          } else {
            await appWindow.center();
            const position = await appWindow.outerPosition();
            saveWindowGeometry({ ...size, x: position.x, y: position.y });
          }
        }
      } catch (error) {
        // 恢复窗口状态失败时保留 Tauri 的默认居中窗口，避免影响页面正常渲染。
        console.error("恢复窗口状态失败：", error);
      }
      if (disposed) return;
      unlistenResize = await appWindow.onResized(async ({ payload }) => {
        if (isFloatingModeSaved()) return;
        const position = await appWindow.outerPosition();
        saveWindowGeometry({ width: payload.width, height: payload.height, x: position.x, y: position.y });
      });
      unlistenMove = await appWindow.onMoved(async ({ payload }) => {
        if (isFloatingModeSaved()) return;
        const size = await appWindow.innerSize();
        saveWindowGeometry({ width: size.width, height: size.height, x: payload.x, y: payload.y });
      });
    };
    void restore();
    return () => { disposed = true; unlistenResize?.(); unlistenMove?.(); };
  }, []);

  const handleInstallUpdate = async () => {
    if (!availableUpdate || isInstallingUpdate) return;

    setIsInstallingUpdate(true);
    message.loading({ content: `正在下载 LifePlan ${availableUpdate.version} 更新…`, key: "app-update", duration: 0 });

    try {
      await installUpdate(availableUpdate);
    } catch (error) {
      message.error({ content: "更新下载或安装失败，请稍后重试。", key: "app-update", duration: 4 });
      setIsInstallingUpdate(false);
      console.error("安装应用更新失败：", error);
    }
  };

  const handleLogoClick = () => {
    const now = Date.now();
    const next = [...logoClicks.filter((time) => now - time < 1200), now];
    setLogoClicks(next);
    if (next.length >= 3) { setLogoClicks([]); void exportAnalyticsLog(); }
  };

  const refreshQuote = () => {
    setQuote((currentQuote) => {
      let nextQuote = currentQuote;
      while (nextQuote === currentQuote) {
        nextQuote = quotes[Math.floor(Math.random() * quotes.length)];
      }
      return nextQuote;
    });
  };

  const appWindow = getCurrentWindow();
  const minimize = () => void appWindow.minimize();
  const toggleMaximize = () => void appWindow.toggleMaximize();
  const close = () => void appWindow.close();
  const openOnboarding = () => window.dispatchEvent(new CustomEvent("lifeplan:open-onboarding"));
  const startDrag = (event: MouseEvent<HTMLDivElement>) => { if (event.button === 0) void appWindow.startDragging(); };

  return <AntLayout className="app-shell">
    <div className="custom-titlebar" data-tauri-drag-region onMouseDown={startDrag}>
      <div className="custom-titlebar-drag" data-tauri-drag-region />
      <div className="custom-titlebar-controls">
        <button type="button" aria-label="了解 LifePlan" title="了解 LifePlan" onMouseDown={(event) => event.stopPropagation()} onClick={openOnboarding}><HelpCircle size={16} /></button>
        <button type="button" aria-label="最小化" onMouseDown={(event) => event.stopPropagation()} onClick={minimize}><Minus size={16} /></button>
        <button type="button" aria-label="最大化" onMouseDown={(event) => event.stopPropagation()} onClick={toggleMaximize}><Square size={13} /></button>
        <button type="button" aria-label="关闭" className="custom-titlebar-close" onMouseDown={(event) => event.stopPropagation()} onClick={close}><X size={16} /></button>
      </div>
    </div>
    <AntLayout.Sider className="sidebar" width={148} theme="light">
      <div className="brand" onClick={handleLogoClick} role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter") handleLogoClick(); }} aria-label="LifePlan"><span className="brand-mark" aria-hidden="true"><svg viewBox="0 0 32 32" focusable="false"><rect x="1.5" y="1.5" width="29" height="29" rx="8" fill="currentColor" /><path d="M15 19V9.5M15 19H21.5" fill="none" stroke="white" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg></span><span>LifePlan</span>{availableUpdate && (<Tooltip title={isInstallingUpdate ? "正在下载并安装更新" : `发现新版本 ${availableUpdate.version}，点击下载更新`}><button type="button" className="brand-update-button" aria-label={isInstallingUpdate ? "正在下载并安装更新" : `下载 LifePlan ${availableUpdate.version} 更新`} disabled={isInstallingUpdate} onMouseDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); void handleInstallUpdate(); }}>{isInstallingUpdate ? <LoaderCircle className="brand-update-spinner" size={10} /> : <ArrowDown size={10} />}</button></Tooltip>)}</div>
      <Menu mode="inline" selectedKeys={[location.pathname]} items={navItems.map(({ to, icon: Icon, label }) => ({ key: to, label: <NavLink to={to}>{label}</NavLink>, icon: <Icon size={17} /> }))} />
      <Tooltip title={quote} placement="right" mouseEnterDelay={0.2} color="#fff" classNames={{ root: "sidebar-quote-tooltip" }} styles={{ container: { color: "#303133", backgroundColor: "#fff", boxShadow: "0 4px 12px rgba(0, 0, 0, .12)" } }}>
        <div className="sidebar-note" tabIndex={0} onMouseDown={(event) => event.preventDefault()} onDoubleClick={refreshQuote} aria-label="双击更换名言警句">{quote}</div>
      </Tooltip>
    </AntLayout.Sider>
    <AntLayout><AntLayout.Content className="main-content"><Outlet /></AntLayout.Content></AntLayout>
  </AntLayout>;
}
