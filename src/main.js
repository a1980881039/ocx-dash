/**
 * ocx-dash — OpenCodex 谷歌反重力额度面板
 * 界面与逻辑移植自 dsh-hub features/agy/client.tsx (ee77052^)
 *
 * 数据源：OpenCodex 管理接口
 *   GET /api/oauth/accounts?provider=google-antigravity&quota=1
 *   加 refresh=1 即 GUI「刷新额度」按钮的同款强制刷新
 */

import { invoke } from '@tauri-apps/api/core';

// ---- 配置 ----
const REFRESH_INTERVAL = 60_000; // 60 秒自动刷新（走服务端 TTL 缓存，零网络开销）
const PROVIDER = 'google-antigravity';

// ---- 工具函数 (移植自 dsh-hub client.tsx) ----

function remPct(fraction) {
  if (fraction === undefined || fraction === null || !Number.isFinite(fraction)) return null;
  return Math.min(100, Math.max(0, Math.round(fraction * 100)));
}

function quotaTone(fraction) {
  if (fraction === undefined || fraction === null || !Number.isFinite(fraction)) return 'none';
  if (fraction <= 0.1) return 'low';
  if (fraction <= 0.3) return 'warn';
  return 'ok';
}

function toneColor(tone) {
  return tone === 'ok' ? '#10b981' : tone === 'warn' ? '#f59e0b' : tone === 'low' ? '#ef4444' : '#94a3b8';
}

/** Unix 毫秒重置时间 → 可读相对时间 */
function formatReset(resetAt) {
  if (!resetAt) return '';
  const diff = resetAt - Date.now();
  if (diff <= 0) return '';
  const mins = Math.round(diff / 60000);
  if (mins < 60) return mins + ' 分钟后重置';
  const totalHours = diff / 3600000;
  if (totalHours < 24) return totalHours.toFixed(1) + ' 小时后重置';
  const days = Math.floor(totalHours / 24);
  const hours = Math.floor(totalHours % 24);
  return hours === 0 ? days + ' 天后重置' : days + ' 天 ' + hours + ' 小时后重置';
}

/** 更新时间 → 可读相对时间 */
function formatUpdatedAt(ts) {
  if (!ts) return '';
  const diff = Date.now() - ts;
  if (diff < 5000) return '刚刚';
  if (diff < 60000) return Math.round(diff / 1000) + ' 秒前';
  if (diff < 3600000) return Math.round(diff / 60000) + ' 分钟前';
  return Math.round(diff / 3600000) + ' 小时前';
}

const HEALTH_LABEL = {
  healthy: '正常',
  auth_required: '需重新登录',
  disabled: '已禁用',
};

// ---- SVG 转盘 (精确移植自 dsh-hub QuotaDial) ----

function renderQuotaDial(fraction, label, size) {
  size = size || 56;
  const pct = remPct(fraction);
  const tone = quotaTone(fraction);
  const totalLen = 92.15;
  const filledLen = pct !== null ? (totalLen * pct) / 100 : 0;
  const color = toneColor(tone);

  let filled = '';
  if (pct !== null && filledLen > 0) {
    filled = '<circle cx="28" cy="28" r="22" fill="none" stroke="' + color + '" '
      + 'stroke-width="4.5" stroke-dasharray="' + filledLen.toFixed(2) + ' 138.23" '
      + 'stroke-dashoffset="0" stroke-linecap="round" transform="rotate(150 28 28)" '
      + 'style="transition: stroke-dasharray 0.3s ease"/>';
  }

  return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 56 56" style="flex-shrink:0;overflow:visible">'
    + '<circle cx="28" cy="28" r="22" fill="none" stroke="currentColor" opacity="0.14" '
    + 'stroke-width="4.5" stroke-dasharray="' + totalLen + ' 138.23" stroke-dashoffset="0" '
    + 'stroke-linecap="round" transform="rotate(150 28 28)"/>'
    + filled
    + '<text x="28" y="26" text-anchor="middle" dominant-baseline="central" fill="currentColor" '
    + 'font-size="12" font-weight="700" font-family="inherit">'
    + (pct === null ? '--' : pct + '%')
    + '</text>'
    + '<text x="28" y="38" text-anchor="middle" dominant-baseline="central" fill="currentColor" '
    + 'opacity="0.6" font-size="8" font-weight="600" font-family="inherit">'
    + label
    + '</text></svg>';
}

// ---- 数据整形：OpenCodex 账号行 → dsh-hub AgyAccountView 同构结构 ----

function windowByLabel(quota, label) {
  return (quota?.customWindows || []).find(w => w.label === label) || null;
}

/** customWindows 的 percent 是「已用」百分比，剩余 = (100 - percent) / 100 */
function usedToRemaining(win) {
  if (!win || win.percent === undefined || win.percent === null) return { remainingFraction: undefined, resetTime: undefined };
  return { remainingFraction: (100 - win.percent) / 100, resetTime: win.resetAt };
}

function toAccountView(account) {
  const q = account.quota || null;
  const gemSession = usedToRemaining(windowByLabel(q, 'Gem'));
  const gemWeekly = usedToRemaining(windowByLabel(q, 'Gem (Weekly)'));
  const claSession = usedToRemaining(windowByLabel(q, 'Cla'));
  const claWeekly = usedToRemaining(windowByLabel(q, 'Cla (Weekly)'));

  const pools = [];
  if (q) {
    pools.push({ id: 'gemini', label: 'Gemini 模型', session: gemSession, weekly: gemWeekly });
    pools.push({ id: 'claude', label: 'Claude 模型', session: claSession, weekly: claWeekly });
  }

  return {
    id: account.id,
    email: account.email || account.id,
    health: account.health?.status || 'healthy',
    active: account.active === true,
    pools,
    quotaUnavailable: account.quotaUnavailable === true || !q,
  };
}

// ---- 总额度折算 (移植自 dsh-hub computeAggregatedPools) ----

function computeAggregatedPools(accounts) {
  const activeAccounts = accounts.filter(a => a.health !== 'disabled');
  const poolIds = [];
  const poolLabels = new Map();

  for (const acc of activeAccounts) {
    for (const pool of acc.pools) {
      if (!poolIds.includes(pool.id)) {
        poolIds.push(pool.id);
        poolLabels.set(pool.id, pool.label);
      }
    }
  }

  return poolIds.map(id => {
    const label = poolLabels.get(id) ?? id;
    const poolInstances = activeAccounts.flatMap(a => a.pools.filter(p => p.id === id));

    const sessionFractions = poolInstances
      .map(p => p.session.remainingFraction)
      .filter(v => typeof v === 'number' && Number.isFinite(v));
    const weeklyFractions = poolInstances
      .map(p => p.weekly.remainingFraction)
      .filter(v => typeof v === 'number' && Number.isFinite(v));

    const sessionResets = poolInstances
      .map(p => p.session.resetTime)
      .filter(t => typeof t === 'number' && t > 0)
      .sort((a, b) => a - b);
    const weeklyResets = poolInstances
      .map(p => p.weekly.resetTime)
      .filter(t => typeof t === 'number' && t > 0)
      .sort((a, b) => a - b);

    const sessionAvg = sessionFractions.length > 0
      ? sessionFractions.reduce((s, v) => s + v, 0) / sessionFractions.length
      : undefined;
    const weeklyAvg = weeklyFractions.length > 0
      ? weeklyFractions.reduce((s, v) => s + v, 0) / weeklyFractions.length
      : undefined;

    return {
      id,
      label,
      sessionAvg,
      weeklyAvg,
      earliestSessionReset: sessionResets[0],
      earliestWeeklyReset: weeklyResets[0],
      hasData: sessionFractions.length > 0,
    };
  });
}

// ---- 数据拉取 ----

let manualToken = localStorage.getItem('ocx-dash-token') || '';

async function fetchAccounts(forceRefresh) {
  const path = '/api/oauth/accounts?provider=' + PROVIDER + '&quota=1' + (forceRefresh ? '&refresh=1' : '');
  try {
    return await invoke('fetch_ocx', { path, token: manualToken || null });
  } catch (err) {
    const msg = typeof err === 'string' ? err : (err?.message || String(err));
    if (msg === 'auth') throw new Error('auth');
    throw new Error(msg);
  }
}

// ---- 渲染 ----

let lastData = null;   // { activeAccountId, accounts: AccountView[] }
let refreshing = false;
let autoTimer = null;

function renderApp() {
  const app = document.getElementById('app');

  if (!lastData) {
    app.innerHTML = '<div class="ocx-loading">正在读取 OpenCodex 账号额度…</div>';
    doFetch(false);
    return;
  }

  app.innerHTML = renderPanel(lastData);
  bindActions();
}

function renderPanel(data) {
  const accounts = data.accounts;
  const activeAccount = accounts.find(a => a.active) || accounts[0];

  let html = '<div class="hub-agy-panel">';

  if (accounts.length > 0) {
    html += renderHero(accounts);
    html += renderAccountSection(accounts, activeAccount);
  } else {
    html += '<div class="hub-agy-empty-state">'
      + renderQuotaDial(undefined, '5H 额度', 56)
      + '<span class="hub-agy-empty-title">暂未添加 Antigravity 账号</span>'
      + '<span class="hub-agy-empty-hint">请先在 OpenCodex 中登录谷歌反重力账号</span>'
      + '</div>';
  }

  html += '</div>';
  return html;
}

/** 1. 顶部置顶：全局总额度仪表盘 (移植自 dsh-hub TotalOverviewHero，去掉添加/设置按钮) */
function renderHero(accounts) {
  const totalCount = accounts.length;
  const healthyCount = accounts.filter(a => a.health === 'healthy').length;
  const isAllHealthy = totalCount > 0 && healthyCount === totalCount;
  const aggregatedPools = computeAggregatedPools(accounts);
  const updatedAt = Math.max(0, ...accounts.map(a => a.updatedAt || 0));

  let html = '<div class="hub-agy-hero-card">';

  // 头部
  html += '<div class="hub-agy-hero-head">';
  html += '<div class="hub-agy-hero-identity">';
  html += '<div class="hub-agy-total-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg></div>';
  html += '<span class="hub-agy-total-title">总额度总览</span>';
  html += '<span class="hub-agy-hero-badge' + (isAllHealthy ? '' : ' hub-agy-badge-warn') + '">'
    + '<span class="hub-agy-hero-dot"></span>'
    + (isAllHealthy ? '全部 ' + totalCount + ' 个账号正常' : healthyCount + '/' + totalCount + ' 账号正常')
    + '</span>';
  html += '</div>';
  html += '<div class="hub-agy-hero-actions">';
  if (updatedAt > 0) {
    html += '<span class="hub-agy-updated" id="updated-label">' + formatUpdatedAt(updatedAt) + '</span>';
  }
  html += '<button type="button" class="hub-agy-btn hub-agy-btn-compact hub-agy-btn-ghost hub-agy-hero-refresh" id="refresh-btn"'
    + (refreshing ? ' disabled' : '') + ' title="从 Google 同步全部账号最新额度">';
  html += '<span class="' + (refreshing ? 'hub-spinning' : '') + '" style="display:inline-block">&#8635;</span>';
  html += '<span>' + (refreshing ? '正在刷新…' : '刷新状态') + '</span>';
  html += '</button>';
  html += '</div></div>';

  // 折算转盘
  if (aggregatedPools.length > 0) {
    html += '<div class="hub-agy-hero-dials">';
    for (const pool of aggregatedPools.slice(0, 2)) {
      const label = pool.label.replace(' 模型', '');
      const sessionReset = formatReset(pool.earliestSessionReset);
      const weeklyPct = remPct(pool.weeklyAvg);
      const weeklyReset = formatReset(pool.earliestWeeklyReset);
      html += '<div class="hub-agy-hero-dial-item">';
      html += renderQuotaDial(pool.sessionAvg, '5H 平均', 60);
      html += '<div class="hub-agy-hero-dial-info">';
      html += '<span class="hub-agy-hero-dial-name">' + label + '</span>';
      html += '<span class="hub-agy-hero-dial-reset">' + (sessionReset ? '最早 ' + sessionReset : '5 小时滚动有效') + '</span>';
      html += '<div class="hub-agy-hero-dial-weekly">';
      html += '<span>周平均: <strong>' + (weeklyPct !== null ? weeklyPct + '%' : '--') + '</strong></span>';
      if (weeklyReset) html += '<span class="hub-agy-hero-dial-weekly-reset"> · 最早 ' + weeklyReset + '</span>';
      html += '</div></div></div>';
    }
    html += '</div>';
  } else {
    html += '<div class="hub-agy-hero-empty"><span>暂无额度数据，点击右上角「刷新状态」同步</span></div>';
  }

  html += '</div>';
  return html;
}

/** 2. 全部账号列表 (移植自 dsh-hub AccountListItem，去掉「设为激活」操作) */
function renderAccountSection(accounts, activeAccount) {
  let html = '<div class="hub-agy-section">';
  html += '<div class="hub-agy-section-head">';
  html += '<span class="hub-agy-section-title">全部账号 (' + accounts.length + ')</span>';
  if (activeAccount) {
    html += '<span class="hub-agy-current-text">当前生效：<strong>' + escapeHtml(activeAccount.email) + '</strong></span>';
  }
  html += '</div>';
  html += '<div class="hub-agy-list">';
  for (const a of accounts) {
    html += renderAccountItem(a);
  }
  html += '</div></div>';
  return html;
}

function renderAccountItem(account) {
  let html = '<div class="hub-agy-list-item' + (account.active ? ' hub-agy-list-item-active' : '') + '">';

  // 身份区
  html += '<div class="hub-agy-list-identity">';
  html += '<span class="hub-agy-list-dot" style="background:' + (account.health === 'healthy' ? '#10b981' : '#f59e0b') + '"></span>';
  html += '<span class="hub-agy-list-email" title="' + escapeHtml(account.email) + '">' + escapeHtml(account.email) + '</span>';
  html += '<span class="hub-agy-health hub-agy-health-' + escapeHtml(account.health) + '">' + (HEALTH_LABEL[account.health] || account.health) + '</span>';
  html += '</div>';

  // 额度池
  html += '<div class="hub-agy-list-pools">';
  if (account.pools.length > 0 && !account.quotaUnavailable) {
    for (const p of account.pools.slice(0, 2)) {
      const name = p.label.replace(' 模型', '');
      const sessionPct = remPct(p.session?.remainingFraction);
      const sessionReset = formatReset(p.session?.resetTime);
      const sessionColor = toneColor(quotaTone(p.session?.remainingFraction));
      const weeklyPct = remPct(p.weekly?.remainingFraction);
      const weeklyReset = formatReset(p.weekly?.resetTime);
      const weeklyColor = toneColor(quotaTone(p.weekly?.remainingFraction));

      const sessionTone = quotaTone(p.session?.remainingFraction);
      const weeklyTone = quotaTone(p.weekly?.remainingFraction);
      const poolTone = sessionTone === 'low' || weeklyTone === 'low' ? 'low'
        : sessionTone === 'warn' || weeklyTone === 'warn' ? 'warn'
        : sessionTone === 'ok' || weeklyTone === 'ok' ? 'ok' : 'none';
      const poolDotColor = toneColor(poolTone);

      html += '<div class="hub-agy-list-pool-cell">';
      html += '<div class="hub-agy-list-pool-row">';
      html += '<span class="hub-agy-pool-dot" style="background:' + poolDotColor + '"></span>';
      html += '<span class="hub-agy-pool-name">' + name + '</span>';
      html += '</div>';
      html += '<div class="hub-agy-list-pool-window">';
      html += '<span class="hub-agy-window-tag">5H</span>';
      html += '<span class="hub-agy-pool-pct" style="color:' + sessionColor + '">' + (sessionPct !== null ? sessionPct + '%' : '--') + '</span>';
      html += '<span class="hub-agy-list-pool-sep">·</span>';
      html += '<span class="hub-agy-list-pool-reset">' + (sessionReset || '5小时有效') + '</span>';
      html += '</div>';
      html += '<div class="hub-agy-list-pool-window">';
      html += '<span class="hub-agy-window-tag">周</span>';
      html += '<span class="hub-agy-pool-pct" style="color:' + weeklyColor + '">' + (weeklyPct !== null ? weeklyPct + '%' : '--') + '</span>';
      html += '<span class="hub-agy-list-pool-sep">·</span>';
      html += '<span class="hub-agy-list-pool-reset">' + (weeklyReset || '本周有效') + '</span>';
      html += '</div>';
      html += '</div>';
    }
  } else {
    html += '<span class="hub-agy-list-pool-empty">暂无额度数据</span>';
  }
  html += '</div>';

  // 状态区
  html += '<div class="hub-agy-list-action">';
  if (account.active) {
    html += '<span class="hub-agy-list-active-tag">当前激活</span>';
  }
  html += '</div>';

  html += '</div>';
  return html;
}

function renderTokenForm() {
  return '<div class="hub-agy-token-form">'
    + '<label>未能自动读取 Admin Token，请手动输入</label>'
    + '<input type="password" id="token-input" placeholder="ocx_admin_..." autofocus>'
    + '<button class="hub-agy-btn" id="token-submit" style="align-self:flex-start">连接</button>'
    + '<div style="font-size:11px;color:var(--text-tertiary);margin-top:4px">'
    + '在 ~/.opencodex/admin-api-token 中查看'
    + '</div></div>';
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ---- 事件绑定 ----

function bindActions() {
  const btn = document.getElementById('refresh-btn');
  if (btn) btn.addEventListener('click', () => doFetch(true));
}

function bindTokenForm() {
  const input = document.getElementById('token-input');
  const btn = document.getElementById('token-submit');
  const submit = () => {
    const val = input.value.trim();
    if (!val) return;
    manualToken = val;
    localStorage.setItem('ocx-dash-token', val);
    doFetch(true);
  };
  btn.addEventListener('click', submit);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
}

async function doFetch(force) {
  if (refreshing) return;
  refreshing = true;
  if (lastData) {
    const btn = document.getElementById('refresh-btn');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<span class="hub-spinning" style="display:inline-block">&#8635;</span><span>正在刷新…</span>';
    }
  }

  try {
    const raw = await fetchAccounts(force);
    lastData = {
      activeAccountId: raw.activeAccountId ?? null,
      accounts: (raw.accounts || []).map(a => ({
        ...toAccountView(a),
        updatedAt: a.quota?.updatedAt || 0,
      })),
    };
    refreshing = false;
    renderApp();
    startAutoRefresh();
  } catch (err) {
    refreshing = false;
    const app = document.getElementById('app');
    if (err.message === 'auth') {
      app.innerHTML = renderTokenForm();
      bindTokenForm();
    } else {
      app.innerHTML = '<div class="hub-agy-error-box">连接失败: ' + escapeHtml(err.message)
        + '<br><button class="hub-agy-btn" id="retry-btn" style="margin-top:8px">重试</button></div>';
      document.getElementById('retry-btn')?.addEventListener('click', () => doFetch(false));
    }
  }
}

function startAutoRefresh() {
  if (autoTimer) clearInterval(autoTimer);
  autoTimer = setInterval(() => doFetch(false), REFRESH_INTERVAL);

  // 每 10 秒更新「更新于」文本与重置倒计时
  setInterval(() => {
    if (!lastData) return;
    const label = document.getElementById('updated-label');
    if (label) {
      const updatedAt = Math.max(0, ...lastData.accounts.map(a => a.updatedAt || 0));
      if (updatedAt > 0) label.textContent = formatUpdatedAt(updatedAt);
    }
    renderApp();
  }, 10000);
}

// ---- 启动 ----
renderApp();

