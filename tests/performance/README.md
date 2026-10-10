# 前端按需加载回归验证

## 执行方式

```powershell
npm run test:performance
node --test tests/actions/start-date-adjustment.test.mjs tests/recurring/start-times.test.mjs tests/release/release-utils.test.mjs
cargo test --manifest-path src-tauri/Cargo.toml --lib --locked
```

浏览器验收使用生产构建和模拟 Tauri IPC，不读写真实数据库：

```powershell
npm run preview -- --host 127.0.0.1 --port 1432
# 在另一终端执行
npx --yes --package @playwright/cli playwright-cli -s=lazy-regression open about:blank
npx --yes --package @playwright/cli playwright-cli -s=lazy-regression run-code --filename tests/performance/browser-qa.js
npx --yes --package @playwright/cli playwright-cli -s=lazy-regression close
```

浏览器脚本必须完整执行；悬浮窗口部分复用前半段安装的 IPC 测试桩。截图保存在已忽略的 `output/playwright/` 目录。

## 覆盖范围

- 验证真实 manifest 中的动态入口和静态依赖闭包，不把入口文件大小误当作首屏总加载量。
- 今日事首屏不请求其他页面、引导、反馈和富文本编辑器分包。
- 四个导航页面首次切换及返回；延迟事件篮分包时导航保持可用。
- 工作日志编辑器输入及本地保存；每日复盘编辑器输入及自动保存回调。
- 首次启动引导、手动重开与关闭引导、反馈弹框打开及取消。
- 1050×650 主窗口，以及 280×300 默认尺寸、220×240 最小尺寸的悬浮番茄钟样式与计时展示。
- 悬浮窗口不加载主窗口布局，不执行主窗口初始化。
- 主窗口和悬浮窗口正常流程无未捕获页面异常。
- 人为阻断奖励页分包后显示恢复提示，解除阻断后重新加载恢复。

## 2026-10-10 构建对比

| 指标 | 优化前 | 优化后 |
| --- | ---: | ---: |
| 最大 JS 分包 | 约 1,767 kB | 约 446 kB |
| 今日事首屏静态依赖合计（不含首次引导） | 约 1,767 kB | 约 1,045 kB |
| 悬浮番茄钟静态依赖合计 | 约 1,767 kB | 约 544 kB |
| 全部 JS 产物合计 | 约 1,767 kB | 约 1,781 kB |

这里采用十进制 kB；分包后 JS 总量略增，优化目标是降低启动时加载、解析的代码量，而非降低安装包总体积。逐包 gzip 合计只是压缩大小参考，不等同于桌面客户端实际传输量。未进行原生 WebView 冷启动耗时基准测量，也未覆盖原生窗口拖拽、真实多窗口 IPC 和安装包升级流程。

未提高 Vite 默认警告阈值，也未强制将所有依赖划入单一 vendor 包。
