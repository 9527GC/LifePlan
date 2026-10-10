// 在生产预览服务（1432 端口）上运行；所有 IPC 为测试桩，不访问真实数据。
async (page) => {
  await (async (page) => {
  await page.addInitScript(() => {
    localStorage.setItem('lifeplan-onboarding-v1-completed', '1');
    localStorage.setItem('lifeplan-ai-api-key', '仅供本地验收，不发送请求');
    localStorage.setItem('lifeplan-ai-config-version', '3');
    window.__qaCalls = []; window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
    window.__TAURI_INTERNALS__ = { metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } }, transformCallback: () => 1, unregisterCallback: () => {}, invoke: async (cmd, args = {}) => {
      window.__qaCalls.push({cmd, args});
      if (cmd === 'get_startup_notice' || cmd === 'plugin:updater|check') return null;
      if (cmd === 'check_due_delays') return false;
      if (cmd === 'get_daily_schedule') {
        if (!localStorage.getItem('lifeplan-work-log-' + args.listDate)) localStorage.setItem('lifeplan-work-log-' + args.listDate, '已有工作日志测试内容');
        return {list_date: args.listDate, slots:[{id:1, list_date:args.listDate, start_time:'09:00', end_time:'10:00', sort_order:1}]};
      }
      if (cmd === 'get_pomodoro_status') return {total_points: 0};
      if (cmd === 'get_rewards_overview') return {total_points: 0, rewards: [], exchanges: []};
      if (cmd === 'get_daily_review') return {review: {review_date: args.reviewDate, reflection_text: ''}, summary: {planned_event_count: 0, completed_event_count: 0, incomplete_event_count: 0, involved_event_count: 0, quadrants_json: '{}'}};
      if (cmd === 'save_daily_review_draft') return args.payload;
      return [];
    }};
  });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:1432/#/daily-list');
  await page.reload();
  await page.getByRole('link', {name: '今日事', exact: true}).waitFor();
  await page.getByText('正在加载页面…', {exact: true}).waitFor({state: 'hidden'});
  const resources = () => page.evaluate(() => performance.getEntriesByType('resource').map(r => r.name));
  const first = await resources();
  for (const name of ['Inbox-', 'Rewards-', 'Pomodoro-', 'FloatingPomodoro-', 'DailyReviewDemo-', 'MarkdownEditorImpl-', 'OnboardingCarousel-', 'FeedbackModal-']) {
    if (first.some(url => url.includes(name))) throw Error('首屏提前加载了 ' + name);
  }
  console.log('今日事首屏按需加载边界通过');
  await page.screenshot({path:'output/playwright/lazy-daily-list.png'});
  await page.getByRole('button', {name:'工作日志', exact:true}).click();
  const workLog = page.getByRole('dialog', {name:'工作日志', exact:true});
  await workLog.locator('.md-wysiwyg[contenteditable="true"]').waitFor();
  await workLog.locator('.md-wysiwyg[contenteditable="true"]').fill('工作日志按需加载回归验证');
  await page.waitForFunction(() => Object.keys(localStorage).some(key => key.startsWith('lifeplan-work-log-') && localStorage.getItem(key).includes('工作日志按需加载回归验证')));
  await workLog.getByRole('button', {name:/关\s*闭/}).last().click();
  await workLog.waitFor({state:'hidden'});
  console.log('工作日志编辑器、输入和本地保存回调通过');
  await page.route('**/assets/Inbox-*.js', async route => { await page.evaluate(() => { window.__qaSlowLoading = true; }); await new Promise(resolve => setTimeout(resolve, 800)); await route.continue(); });
  for (const [name, chunk] of [['事件篮','Inbox-'], ['番茄钟','Pomodoro-'], ['奖励池','Rewards-'], ['今日事','DailyList-']]) {
    await page.getByRole('link', {name, exact: true}).click();
    if (name === '事件篮') {
      await page.waitForFunction(() => window.__qaSlowLoading);
      if (!await page.getByRole('link',{name:'今日事', exact:true}).isVisible()) throw Error('慢加载时导航消失');
    }
    await page.waitForFunction(chunk => performance.getEntriesByType('resource').some(r => r.name.includes(chunk)), chunk);
    await page.getByText('正在加载页面…', {exact: true}).waitFor({state:'hidden'});
    if (!(await resources()).some(url => url.includes(chunk))) throw Error('切换未加载 ' + chunk);
    if (!await page.getByRole('link',{name:'今日事', exact:true}).isVisible()) throw Error('切换导致导航消失');
  }
  console.log('四个导航页面切换、返回和壳层保留通过');
  await page.evaluate(() => { location.hash = '#/daily-review'; });
  await page.locator('.md-wysiwyg[contenteditable="true"]').waitFor();
  await page.locator('.md-wysiwyg[contenteditable="true"]').fill('懒加载编辑器回归验证');
  await page.waitForFunction(() => window.__qaCalls.some(c => c.cmd === 'save_daily_review_draft' && c.args.payload.reflection_text.includes('懒加载编辑器回归验证')));
  await page.screenshot({path:'output/playwright/lazy-review-editor.png'});
  console.log('复盘页面、富文本输入与自动保存回调通过');
  await page.evaluate(() => window.dispatchEvent(new Event('lifeplan:open-onboarding')));
  await page.getByText('先把事情放进事件篮', {exact:true}).waitFor();
  await page.getByRole('button', {name:'跳过引导', exact:true}).click();
  await page.getByRole('button', {name:'问题反馈', exact:true}).click();
  await page.getByRole('dialog', {name:'问题反馈', exact:true}).waitFor();
  await page.getByRole('button', {name:/取\s*消/}).click();
  console.log('手动打开和关闭新手引导、反馈弹框按需加载通过');
  if (errors.length) throw Error('页面异常：' + errors.join('; '));
  console.log('主窗口回归未出现未捕获异常');
  await page.addInitScript(() => {
    if (location.search.includes('qaOnboarding=1')) { localStorage.removeItem('lifeplan-onboarding-v1-completed'); localStorage.removeItem('lifeplan-onboarding-completed'); }
  });
  await page.setViewportSize({width:1050, height:650});
  await page.goto('http://127.0.0.1:1432/?qaOnboarding=1#/daily-list');
  await page.getByRole('dialog', {name:'LifePlan 新用户引导'}).waitFor();
  await page.getByRole('button', {name:'跳过引导', exact:true}).click();
  await page.getByRole('dialog', {name:'LifePlan 新用户引导'}).waitFor({state:'hidden'});
  await page.screenshot({path:'output/playwright/lazy-small-window.png'});
  console.log('首次启动引导与 1050×650 主窗口通过');
})(page);
  await (async (page) => {
  await page.addInitScript(() => {
    // 前一轮脚本已经安装完整 IPC 桩，这里只覆盖悬浮窗口场景。
    const original = window.__TAURI_INTERNALS__.invoke;
    window.__TAURI_INTERNALS__.metadata.currentWindow.label = 'pomodoro-floating';
    window.__TAURI_INTERNALS__.invoke = async (cmd, args) => {
      if (cmd === 'get_pomodoro_status') return { total_points: 0, active: {id: 1, start_time: Date.now(), planned_seconds: 1500, status: 0, points_awarded: 0} };
      return original(cmd, args);
    };
  });
  const errors = [];
  const onError = error => errors.push(error.message);
  page.on('pageerror', onError);
  await page.setViewportSize({width:280, height:300});
  await page.goto('http://127.0.0.1:1432/#/pomodoro-floating');
  await page.reload();
  await page.locator('.pomodoro-floating-window').waitFor();
  await page.locator('.pomodoro-time').waitFor();
  const style = await page.locator('.pomodoro-floating-window').evaluate(el => getComputedStyle(el).display);
  if (style !== 'flex') throw Error('悬浮窗口公共样式未加载：' + style);
  const urls = await page.evaluate(() => performance.getEntriesByType('resource').map(r => r.name));
  for (const name of ['Layout-', 'DailyList-', 'Inbox-', 'Rewards-', 'MarkdownEditorImpl-', 'OnboardingCarousel-']) if (urls.some(url => url.includes(name))) throw Error('悬浮窗口加载了主界面 ' + name);
  const calls = await page.evaluate(() => window.__qaCalls);
  if (calls.some(call => ['get_startup_notice', 'initialize_recurring_actions_for_date', 'check_due_delays'].includes(call.cmd))) throw Error('悬浮窗口执行了主窗口初始化');
  await page.screenshot({path:'output/playwright/lazy-floating.png'});
  await page.setViewportSize({width:220, height:240});
  await page.screenshot({path:'output/playwright/lazy-floating-min.png'});
  if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw Error('最小悬浮窗口水平溢出');
  if (errors.length) throw Error(errors.join(';'));
  page.off('pageerror', onError);
  console.log('悬浮番茄钟计时展示、样式、加载隔离和无主窗口初始化通过');
  // 重新加载文档验证分包请求失败及恢复，清空当前页面的模块缓存。
  await page.setViewportSize({width:1050, height:650});
  await page.route('**/assets/Rewards-*.js', route => route.abort());
  await page.goto('http://127.0.0.1:1432/#/rewards');
  await page.reload();
  await page.getByRole('alert').filter({hasText:'界面加载失败'}).waitFor();
  await page.getByRole('button', {name:'重新加载', exact:true}).waitFor();
  await page.unroute('**/assets/Rewards-*.js');
  await page.getByRole('button', {name:'重新加载', exact:true}).click();
  await page.getByRole('link', {name:'奖励池', exact:true}).waitFor();
  await page.getByText('正在加载页面…',{exact:true}).waitFor({state:'hidden'});
  if (await page.getByRole('alert').filter({hasText:'界面加载失败'}).count()) throw Error('恢复后仍显示错误');
  console.log('分包加载失败提示与重新加载恢复通过');
})(page);
}
