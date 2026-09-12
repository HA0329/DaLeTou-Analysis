/*
 * DltApp — 页面渲染与交互（数据源管理 / 全局统计范围 / 各面板渲染 / 在线更新）
 *
 * 依赖（按 defer 顺序加载）：data.js → dlt-shared.js → dlt-core.js → dlt-charts.js → dlt-check.js
 */
(function () {
  'use strict';

  var Shared = window.DltShared, Core = window.DltCore, Charts = window.DltCharts;
  var $ = function (id) { return document.getElementById(id); };
  var esc = Shared.esc, pad2 = Shared.pad2;
  var FRONT_MAX = Shared.FRONT_MAX, BACK_MAX = Shared.BACK_MAX;
  var EIGHT_YI = Shared.EIGHT_YI;

  var CACHE_KEY = 'dlt_analysis_cache_v3';
  var RANGE_KEY = 'dlt_range_v1';
  var THEME_KEY = 'dlt_theme_v1';
  var COLLAPSE_KEY = 'dlt_collapsed_v1';
  var PAGE_SIZE = 100;

  if (!window.RAW_DATA || !window.RAW_DATA.length) {
    document.body.insertAdjacentHTML('afterbegin',
      '<p style="padding:20px;color:#c0392b;">数据加载失败：未找到同目录 data.js 数据文件（或 RAW_DATA 为空）。请确认 data.js 与页面在同一目录，或运行 node update.js 重新生成。</p>');
    return;
  }

  // ---------- 状态 ----------
  var state = { rows: [], meta: {}, range: 0 };
  // 页面加载时 data.js 的内置数据快照。
  // 必须在此处固定：loadLatestDataJs() 会重写 window.RAW_DATA，
  // 若「恢复内置」直接读 window.RAW_DATA，一旦那次加载拿到的是较旧版本，
  // 用户点「恢复内置」就会把数据倒退回去（缓存更新、内置反而更旧）。
  var INITIAL_RAW = window.RAW_DATA;
  var S = null;        // 当前统计范围下的统计量
  var SAll = null;     // 全量统计量（用于记录表 / 总量卡片）
  var btnBusy = false;
  var selNum = null;   // 当前选中的号码 {zone, num}
  var lastPicks = null;
  var predMethod = 'ensemble';
  var predScores = null;
  var trendRange = 30;
  var trendShowOmit = false;
  var omitSort = { front: { key: 'num', asc: true }, back: { key: 'num', asc: true } };
  var countdownTimer = null;

  // ---------- 基础工具 ----------
  function ball(n, zone, sm, title) {
    return '<span class="ball ' + (zone === 'f' ? 'f' : 'b') + (sm ? ' sm' : '') + '"' +
      (title ? ' title="' + esc(title) + '"' : '') + '>' + pad2(n) + '</span>';
  }
  function balls(arr, zone, sm) { return arr.map(function (n) { return ball(n, zone, sm); }).join(''); }
  function fmtYi(n) { return Shared.fmtYi(n); }
  function fmtNum(n) { return Shared.fmtNum(n); }
  function fmtMoney(n) { return Shared.fmtMoney(n); }
  function pct(x, d) { return (x * 100).toFixed(d == null ? 2 : d) + '%'; }

  function toast(msg, ok, action) {
    var t = $('toast');
    t.textContent = '';
    var span = document.createElement('span');
    span.textContent = msg;
    t.appendChild(span);
    if (action) {
      var b = document.createElement('button');
      b.textContent = action.label;
      b.className = 'toast-btn';
      b.addEventListener('click', function () {
        t.className = 'toast';
        clearTimeout(toast._timer);
        if (action.onClick) action.onClick();
      });
      t.appendChild(b);
    }
    t.className = 'toast show' + (ok ? ' ok' : ok === false ? ' err' : '');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(function () { t.className = 'toast'; }, action ? 20000 : 3400);
  }

  function fmtTime(ts) {
    if (!ts) return '';
    var d = new Date(ts);
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }
  function store(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) { /* 忽略配额/隐私模式 */ } }
  function recall(key, fallback) {
    try { var v = JSON.parse(localStorage.getItem(key) || 'null'); return v == null ? fallback : v; }
    catch (e) { return fallback; }
  }

  // ---------- 主题 ----------
  var CHART_THEME = {
    light: {
      grid: '#edf0f5', axis: '#9aa1ad', label: '#7a8291', value: '#4a5160', highlight: '#20242e', heatEmpty: '#f7f8fb',
      heatPalette: ['#eef3fb', '#f8d7d7', '#f4b1b1', '#ef8a8a', '#e55d5d', '#c22a2a'],
      heatDiverging: ['#2f6fd6', '#7fa4e0', '#c9dbf5', '#f2f4f8', '#f4b1b1', '#e55d5d', '#c22a2a']
    },
    dark: {
      grid: '#252c39', axis: '#7c8598', label: '#8b94a6', value: '#c3cad8', highlight: '#e6eaf2', heatEmpty: '#232a36',
      heatPalette: ['#1e2a3d', '#4a2530', '#7a2f39', '#a83a44', '#d04a52', '#ff6b6b'],
      heatDiverging: ['#3f74c8', '#5b8de0', '#2b3a52', '#232a36', '#7a2f39', '#c04a52', '#ff6b6b']
    }
  };
  function applyTheme(name) {
    document.documentElement.setAttribute('data-theme', name);
    var btn = $('btnTheme');
    if (btn) btn.textContent = name === 'dark' ? '☀️' : '🌙';
    Charts.setTheme(CHART_THEME[name] || CHART_THEME.light);
    store(THEME_KEY, name);
  }
  function initTheme() {
    var saved = recall(THEME_KEY, null);
    if (!saved) saved = (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
    applyTheme(saved);
  }

  // ---------- 数据源：缓存 / 内置 / 在线 ----------
  function readCache() {
    var c = recall(CACHE_KEY, null);
    if (c && Array.isArray(c.rows) && c.rows.length >= 100) return c;
    return null;
  }
  function writeCache(rows, fetchedAt) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ fetchedAt: fetchedAt, rows: rows })); }
    catch (e) {
      // localStorage 上限（约 5MB）可能不够存 2900+ 期完整数据：缓存失败不影响本次使用，但要明确告知
      toast('⚠️ 本地存储空间不足，最新数据未能缓存（本次仍正常使用）。可点「恢复内置」清理旧缓存后重试', false);
    }
  }
  function clearCache() { try { localStorage.removeItem(CACHE_KEY); } catch (e) { /* 忽略 */ } }

  function pickInitialRows() {
    var cache = readCache();
    if (cache && cache.rows.length >= window.RAW_DATA.length) {
      var a = String((cache.rows[0] && cache.rows[0][0]) || '');
      var b = String((window.RAW_DATA[0] && window.RAW_DATA[0][0]) || '');
      if (a >= b) return { rows: cache.rows, meta: { source: 'cache', fetchedAt: cache.fetchedAt } };
    }
    return { rows: window.RAW_DATA, meta: { source: 'builtin', fetchedAt: null } };
  }

  // ---------- 在线数据 ----------
  // 体彩官网真实 API。
  // 关键事实（已实测验证）：该接口响应带 Access-Control-Allow-Origin: *，
  // 浏览器可以从任意站点（含 GitHub Pages）直接 fetch，无需任何代理。
  // 唯一限制是必须带 Referer（缺失会被 WAF 返回 567）——浏览器发 XHR 会自动携带且 JS 无法移除，故不构成障碍。
  var REAL_API = 'https://webapi.sporttery.cn/gateway/lottery/getHistoryPageListV1.qry';
  // 是否本地模式：file:// 或 localhost / 127.0.0.1
  var IS_LOCAL = location.protocol === 'file:' ||
    location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  // 本地模式走 /dlt-api 代理（同源，避开 file:// 的跨域限制）；Pages 模式直连官网
  var API_BASE = IS_LOCAL
    ? (location.protocol === 'file:' ? 'http://127.0.0.1:8123' : location.origin) + '/dlt-api'
    : REAL_API;
  var SAVE_URL = IS_LOCAL
    ? (location.protocol === 'file:' ? 'http://127.0.0.1:8123' : location.origin) + '/save-data'
    : null;

  // 公共 CORS 代理 —— 仅在「直连官网失败」时兜底。
  // 注意：这些免费代理极不稳定（实测 allorigins / codetabs 返回 522、corsproxy.io 返回 401），
  // 因此只作为最后手段，绝不能当主路径。
  var CORS_PROXIES = [
    function (u) { return 'https://api.allorigins.win/raw?url=' + encodeURIComponent(u); },
    function (u) { return 'https://corsproxy.io/?url=' + encodeURIComponent(u); },
    function (u) { return 'https://api.codetabs.com/v1/proxy/?quest=' + encodeURIComponent(u); }
  ];

  // 单次请求（不重试）。每次尝试独立创建超时计时器，
  // 避免多个候选地址共用同一个已过期的 AbortSignal 导致后续尝试瞬间失败。
  function fetchOnce(url) {
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 25000) : null;
    // 只带 Accept（属于 CORS 安全列表头），保证请求是「简单请求」：
    // 一旦触发 OPTIONS 预检，官网 WAF 会返回 567，请求必失败。
    return fetch(url, {
      headers: { 'Accept': 'application/json, text/javascript, */*; q=0.01' },
      signal: ctrl ? ctrl.signal : undefined
    }).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    }).finally(function () { if (timer) clearTimeout(timer); });
  }

  // 取数据：优先直连官网，失败再依次尝试 CORS 代理，最后整体重试
  function tryFetch(url, n) {
    var urls = [url];
    // 本地模式请求的是 server.js 代理（已同源），无需再套公共代理
    if (!IS_LOCAL) CORS_PROXIES.forEach(function (p) { urls.push(p(url)); });

    var lastErr = null;
    function attempt(idx) {
      if (idx >= urls.length) return Promise.reject(lastErr || new Error('所有数据通道均不可用'));
      return fetchOnce(urls[idx]).catch(function (e) {
        lastErr = e;
        return attempt(idx + 1);
      });
    }

    return Promise.resolve().then(function () { return attempt(0); }).catch(function (e) {
      if (n < 2) {
        return new Promise(function (r) { setTimeout(r, 800 * (n + 1)); }).then(function () { return tryFetch(url, n + 1); });
      }
      throw e;
    });
  }

  // 增量抓取：官网列表最新在前，遇到已存在期号即停止（全量约 30 页 → 通常 1 页）
  async function fetchAllFromApi(existingSet, onProgress, maxPages) {
    var all = [], page = 1, total = null, stopped = false;
    while (true) {
      var url = API_BASE + '?gameNo=85&provinceId=0&pageSize=' + PAGE_SIZE + '&isVerify=1&pageNo=' + page;
      var j = await tryFetch(url, 0);
      if (!j || !j.success || !j.value || !Array.isArray(j.value.list)) throw new Error('接口返回格式异常');
      if (total === null) total = j.value.total;
      var list = j.value.list;
      for (var i = 0; i < list.length; i++) {
        if (existingSet && existingSet[list[i].lotteryDrawNum]) { stopped = true; break; }
        all.push(list[i]);
      }
      if (onProgress) onProgress(all.length, total, stopped);
      if (stopped) break;
      if (maxPages && page >= maxPages) break;
      if (list.length < PAGE_SIZE || all.length >= total) break;
      page++;
      await new Promise(function (r) { setTimeout(r, 120); });
    }
    return { list: all, total: total, stopped: stopped };
  }

  function setUpdateUI(running, pct, text) {
    var btn = $('btnUpdate');
    btn.disabled = running;
    btn.textContent = running ? '⏳ 更新中' : '🔄 在线更新';
    $('btnSaveData').disabled = running;
    $('updateBar').hidden = !running;
    if (running) {
      $('updateFill').style.width = Math.max(1, Math.min(100, pct)) + '%';
      $('updateText').textContent = text;
    }
  }

  // 抓取 + 合并（供「在线更新」与「写入数据文件」共用），返回 { rows, added, fullList }
  async function fetchAndMerge() {
    var existing = state.rows;
    var existingSet = {};
    existing.forEach(function (r) { existingSet[r[0]] = true; });
    var progress = function (done, total, stopped) {
      setUpdateUI(true, stopped ? 100 : (total ? Math.round(done / total * 100) : 6), '已获取 ' + done + ' 期新数据（仅拉取缺失期次）');
    };
    var res = await fetchAllFromApi(existingSet, progress);
    var list = res.list, fullList = false;
    // 兜底：官网总期数多于「本地 + 本次新增」时说明历史中间有缺期，改为全量重建
    if (res.stopped && res.total != null && res.total > existing.length + list.length) {
      setUpdateUI(true, 6, '检测到官网期号跳变（中间可能缺期），触发全量重建…');
      res = await fetchAllFromApi(null, function (done, total) {
        setUpdateUI(true, total ? Math.round(done / total * 100) : 6, '全量重建中：已获取 ' + done + ' / ' + total + ' 期');
      });
      list = res.list;
      fullList = true;
    }
    if (!list.length) return { rows: existing, added: 0, fullList: false, empty: true };
    var rows = fullList ? list.map(Shared.toRow) : Shared.mergeRows(list.map(Shared.toRow), existing);
    Shared.assertRows(rows, { min: 100 });
    return { rows: rows, added: rows.length - existing.length, fullList: fullList };
  }

  // Pages 模式下从同源加载最新 data.js（由 GitHub Action 定时更新），绕开 CORS
  function loadLatestDataJs() {
    return new Promise(function (resolve, reject) {
      var script = document.createElement('script');
      script.src = 'data.js?t=' + Date.now();
      var done = false;
      script.onload = function () {
        if (done) return;
        done = true;
        if (script.parentNode) script.parentNode.removeChild(script);
        if (!window.RAW_DATA || !window.RAW_DATA.length) { reject(new Error('data.js 数据为空')); return; }
        resolve(window.RAW_DATA);
      };
      script.onerror = function () {
        if (done) return;
        done = true;
        if (script.parentNode) script.parentNode.removeChild(script);
        reject(new Error('data.js 加载失败'));
      };
      document.head.appendChild(script);
      setTimeout(function () {
        if (done) return;
        done = true;
        if (script.parentNode) script.parentNode.removeChild(script);
        reject(new Error('data.js 加载超时'));
      }, 15000);
    });
  }

  async function doUpdate() {
    if (btnBusy) return;
    btnBusy = true;
    setUpdateUI(true, 2, '正在连接中国体育彩票官网…');
    try {
      var rows = null, added = 0, via = 'online';
      var curLatest = String((state.rows[0] && state.rows[0][0]) || '');

      // 第一优先：直连体彩官网，拿到的是真正的实时数据（官网接口带 ACAO:*，浏览器可直连）
      try {
        var res = await fetchAndMerge();
        if (res.empty) {
          toast('✅ 已是最新：第 ' + state.rows[0][0] + ' 期（' + state.rows[0][1] + '），无需更新', true);
          return;
        }
        rows = res.rows;
        added = res.added;
      } catch (apiErr) {
        // 第二优先：官网不可用时，退回同源 data.js（由 GitHub Action 定时同步，可能略旧）
        if (IS_LOCAL) throw apiErr;   // 本地模式没有这条退路，直接报错
        setUpdateUI(true, 30, '官网接口暂时不可用，改用仓库已同步的数据…');
        var latest = await loadLatestDataJs();
        var newLatest = String((latest[0] && latest[0][0]) || '');
        if (newLatest <= curLatest) {
          toast('✅ 已是最新：第 ' + state.rows[0][0] + ' 期（' + state.rows[0][1] + '），无需更新', true);
          return;
        }
        rows = latest;
        added = Math.max(0, latest.length - state.rows.length);
        via = 'repo';
      }

      var now = Date.now();
      setData(rows, { source: via === 'repo' ? 'repo' : 'online', fetchedAt: now });
      writeCache(rows, now);
      toast('✅ ' + (added > 0 ? '新增 ' + added + ' 期，' : '') + '已更新至第 ' + rows[0][0] + ' 期（' + rows[0][1] + '），共 ' + rows.length + ' 期' +
        (via === 'repo' ? '（官网直连失败，取自仓库同步数据）' : ''), true);
    } catch (e) {
      var msg = e.message;
      if (e instanceof TypeError || /failed to fetch/i.test(msg) || /均不可用/.test(msg)) {
        msg = IS_LOCAL
          ? '浏览器禁止 file:// 页面跨域请求。请通过「启动页面.bat」打开本页（本地服务器模式）后再点在线更新'
          : '无法连接体彩官网，且仓库同步数据不可用。请检查网络后重试；当前仍按已有数据显示';
      }
      toast('❌ 更新失败：' + msg, false);
    } finally {
      btnBusy = false;
      setUpdateUI(false);
    }
  }

  async function doSaveData() {
    if (btnBusy) return;
    // Pages 是纯静态站，没有后端接口，无法写回 data.js
    if (!IS_LOCAL) {
      toast('💡 GitHub Pages 为纯静态站点，无法写回 data.js。点「🔄 在线更新」即可实时获取官网最新开奖并缓存到浏览器本地；若想改写 data.js，请克隆仓库后本地运行「启动页面.bat」', false);
      return;
    }
    btnBusy = true;
    setUpdateUI(true, 2, '正在连接中国体育彩票官网…');
    try {
      var res = await fetchAndMerge();
      if (res.empty) { toast('✅ 已是最新：第 ' + state.rows[0][0] + ' 期（' + state.rows[0][1] + '），data.js 无需更新', true); return; }
      var now = Date.now();
      var resp = await fetch(SAVE_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(res.rows) });
      var j = await resp.json();
      if (!resp.ok || !j.ok) throw new Error(j.error || ('HTTP ' + resp.status));
      setData(res.rows, { source: 'online', fetchedAt: now });
      writeCache(res.rows, now);
      toast('✅ 新增 ' + res.added + ' 期并写入 data.js：已更新至第 ' + res.rows[0][0] + ' 期，共 ' + res.rows.length + ' 期', true);
    } catch (e) {
      var msg = e.message;
      if (e instanceof TypeError || /failed to fetch/i.test(msg)) {
        msg = '请通过「启动页面.bat」打开本页（本地服务器模式）后再使用「写入数据文件」';
      }
      toast('❌ 写入失败：' + msg, false);
    } finally {
      btnBusy = false;
      setUpdateUI(false);
    }
  }

  function doReset() {
    clearCache();
    setData(INITIAL_RAW, { source: 'builtin', fetchedAt: null });
    toast('已恢复 data.js 内置数据（' + INITIAL_RAW.length + ' 期，可在联网时点「🔄 在线更新」获取最新）', true);
  }

  function updateChip() {
    var m = state.meta, rows = state.rows;
    var srcName = m.source === 'online' ? '官网实时' : m.source === 'repo' ? '仓库同步' :
      m.source === 'cache' ? '本地缓存' : '内置数据';
    var chip = $('dataChip');
    chip.textContent = srcName + ' · ' + rows.length + ' 期';
    chip.className = 'data-chip ' + (m.source === 'cache' ? 'cache' : (m.source === 'online' || m.source === 'repo') ? 'online' : '');
    chip.title = '数据来源：' + srcName + '；最新一期：第 ' + rows[0][0] + ' 期（' + rows[0][1] + '）' +
      (m.fetchedAt ? '；更新时间：' + fmtTime(m.fetchedAt) : '') +
      (state.range ? '；当前统计范围：近 ' + state.range + ' 期' : '；当前统计范围：全部历史');
  }

  // 按钮提示随环境变化：Pages 上必须让用户知道「在线更新」是真的去官网取实时数据
  function updateDataSourceHint() {
    var btn = $('btnUpdate');
    if (!btn) return;
    btn.title = IS_LOCAL
      ? '经本地服务器代理从中国体育彩票官网增量拉取最新开奖'
      : '直连中国体育彩票官网增量拉取最新开奖（失败时自动改用仓库已同步的数据）';
  }

  // ---------- 数据 / 统计范围 ----------
  function rebuildStats() {
    var r = state.range;
    S = (r && r < state.rows.length) ? Core.computeAll(state.rows.slice(0, r)) : SAll;
    // 选中号码若超出后区范围（不会发生）或数据变化后仍有效则保留
    if (!selNum) selNum = { zone: 'f', num: S.frontFreqList[0].num };
  }

  function setData(rows, meta) {
    state.rows = rows;
    state.meta = meta;
    window.DLT_CURRENT_ROWS = rows;
    SAll = Core.computeAll(rows);
    rebuildStats();
    renderAll();
    updateChip();
  }

  function setRange(v) {
    state.range = +v || 0;
    store(RANGE_KEY, state.range);
    rebuildStats();
    renderAll();
    updateChip();
  }

  // ---------- 概览卡片 ----------
  function buildOverview() {
    var first = S.firstDraw, last = S.lastDraw;
    var years = ((new Date(last[1]) - new Date(first[1])) / (365.25 * 24 * 3600 * 1000)).toFixed(1);
    var hot3f = S.frontFreqList.slice(0, 3), hot3b = S.backFreqList.slice(0, 3);
    var fmax = S.frontOmit.reduce(function (a, b) { return b.curOmit > a.curOmit ? b : a; });
    var bmax = S.backOmit.reduce(function (a, b) { return b.curOmit > a.curOmit ? b : a; });
    var poolVals = state.rows.slice(0, S.n).map(function (d) { return Number(d[4]) || 0; }).filter(function (v) { return v > 0; });
    var curPool = Number(state.rows[0][4]) || 0;

    var cards = [
      { k: '数据总期数', v: state.rows.length + ' 期', s: '第 ' + state.rows[state.rows.length - 1][0] + ' 期 至 第 ' + state.rows[0][0] + ' 期' },
      { k: '统计范围', v: state.range ? '近 ' + S.n + ' 期' : '全部 ' + S.n + ' 期', s: '第 ' + first[0] + ' 期（' + first[1] + '）~ 第 ' + last[0] + ' 期（' + last[1] + '）' },
      { k: '时间跨度', v: first[1].slice(0, 4) + ' ~ ' + last[1].slice(0, 4), s: '约 ' + years + ' 年' },
      { k: '前区平均和值', v: S.sumStats.avg, s: '区间 ' + S.sumStats.min + ' ~ ' + S.sumStats.max + '，中位数 ' + S.sumStats.median + '，标准差 ' + S.sumStats.std },
      { k: '前区平均跨度', v: S.spanStats.avg, s: '区间 ' + S.spanStats.min + ' ~ ' + S.spanStats.max + '，中位数 ' + S.spanStats.median },
      { k: '前区热号 TOP3', v: balls(hot3f.map(function (x) { return x.num; }), 'f'), s: '分别出现 ' + hot3f.map(function (x) { return x.count + ' 次'; }).join(' / ') },
      { k: '后区热号 TOP3', v: balls(hot3b.map(function (x) { return x.num; }), 'b'), s: '分别出现 ' + hot3b.map(function (x) { return x.count + ' 次'; }).join(' / ') },
      { k: '当前遗漏最大', v: ball(fmax.num, 'f', true) + ' ' + ball(bmax.num, 'b', true), s: '前区 ' + fmax.num + ' 已 ' + fmax.curOmit + ' 期未出，后区 ' + bmax.num + ' 已 ' + bmax.curOmit + ' 期未出' },
      { k: '当前奖池', v: curPool ? fmtYi(curPool) : '—', s: (curPool >= EIGHT_YI ? '≥8亿：下期固定奖按升级档兑付' : '&lt;8亿：固定奖按基本档兑付'), cls: curPool >= EIGHT_YI ? 'big' : '' },
      { k: '范围内最高奖池', v: poolVals.length ? fmtYi(Math.max.apply(null, poolVals)) : '—', s: poolVals.length ? '平均 ' + fmtYi(poolVals.reduce(function (a, c) { return a + c; }, 0) / poolVals.length) : '暂无奖池数据' }
    ];
    $('overview').innerHTML = cards.map(function (c) {
      return '<div class="card"><div class="k">' + c.k + '</div><div class="v ' + (c.cls || '') + '">' + c.v + '</div><div class="s">' + c.s + '</div></div>';
    }).join('');
  }

  // ---------- 最新一期 ----------
  function numStatTitle(zone, num) {
    var o = (zone === 'f' ? S.frontOmit : S.backOmit)[num - 1];
    return '号码 ' + pad2(num) + '：出现 ' + o.count + ' 次（' + o.freq + '%）· 当前遗漏 ' + o.curOmit + ' 期 · 平均遗漏 ' + o.avgOmit + ' 期';
  }

  function startCountdown(next) {
    if (countdownTimer) clearInterval(countdownTimer);
    if (!next) return;
    function tick() {
      var el = $('countdown'), sub = $('countdownSub');
      if (!el) return;
      var diff = next.time.getTime() - Date.now();
      if (diff <= 0) {
        el.textContent = '开奖进行中…';
        sub.textContent = '开奖时间：' + next.label + ' 21:25';
        return;
      }
      var sec = Math.floor(diff / 1000);
      el.textContent = Math.floor(sec / 86400) + ' 天 ' + pad2(Math.floor(sec % 86400 / 3600)) + ':' + pad2(Math.floor(sec % 3600 / 60)) + ':' + pad2(sec % 60);
      sub.textContent = '开奖时间：' + next.label + ' 21:25（21:00 停售）';
    }
    tick();
    countdownTimer = setInterval(tick, 1000);
  }

  // 开奖前奖池 = 上一期开奖后滚存（决定固定奖档位）
  function prePoolOf(draw) {
    var rows = state.rows;
    for (var i = 0; i < rows.length; i++) {
      if (rows[i][0] === draw[0]) return i + 1 < rows.length ? (Number(rows[i + 1][4]) || 0) : (Number(draw[4]) || 0);
    }
    return Number(draw[4]) || 0;
  }

  function buildAnnounceHTML(draw, extra) {
    var prizes = draw[6] || [];
    var pre = prePoolOf(draw);
    var after = Number(draw[4]) || 0;
    var isNewRule = String(draw[1]) >= Shared.NEW_RULE_DATE;
    var upgraded = isNewRule && pre >= EIGHT_YI;
    if (!prizes.length) {
      return '<p class="rules-note">该期开奖公告数据缺失（data.js 未包含），请点击顶部「🔄 在线更新」获取完整公告。</p>';
    }
    // 必须包在 .table-wrap 里：奖级表列多且 white-space:nowrap，窄屏下需要横向滚动，
    // 否则会把整个文档撑宽（移动端出现整页横向滚动条）。
    var html = '<div class="table-wrap"><table class="prize-table"><thead><tr><th>奖级</th><th>中奖注数</th><th>单注奖金</th><th>小计</th>' + (extra ? '<th class="hide-sm">备注</th>' : '') + '</tr></thead><tbody>';
    var totalCount = 0, totalMoney = 0;
    prizes.forEach(function (p) {
      var name = String(p[0]), cnt = Number(p[1]) || 0, amt = Number(p[2]) || 0;
      var sub = cnt * amt;
      totalCount += cnt; totalMoney += sub;
      var note = extra && /一等奖$/.test(name) ? '浮动奖金（按当期销量与奖池计算）' : '';
      html += '<tr><td>' + esc(name) + '</td><td>' + fmtNum(cnt) + '</td><td>' +
        (amt > 0 ? (amt >= 10000 ? (amt / 10000).toFixed(1) + ' 万元' : amt.toLocaleString('zh-CN') + ' 元') : '—') +
        '</td><td>' + fmtNum(sub) + ' 元</td>' + (extra ? '<td class="dim hide-sm">' + note + '</td>' : '') + '</tr>';
    });
    html += '<tr class="tt"><td>合计</td><td>' + fmtNum(totalCount) + ' 注</td><td>—</td><td>' + fmtNum(totalMoney) + ' 元</td>' + (extra ? '<td class="hide-sm"></td>' : '') + '</tr></tbody></table></div>';
    html += '<p class="rules-note">' + (isNewRule
      ? (upgraded ? '该期开奖前奖池 ' + fmtYi(pre) + '（≥8亿），三至七等奖按升级档兑付。' : '该期开奖前奖池 ' + fmtYi(pre) + '（&lt;8亿），固定奖按基本档兑付。')
      : '该期开奖早于 2026 新规施行日，奖级为当时的旧规则（9 奖级）。') +
      (after ? '开奖后滚存 ' + fmtYi(after) + '。' : '') + '金额以中国体育彩票官网开奖公告为准。</p>';
    return html;
  }

  function buildLatest() {
    var last = SAll.lastDraw;
    $('heroSub').textContent = '数据范围：第 ' + SAll.firstDraw[0] + ' 期（' + SAll.firstDraw[1] + '）~ 第 ' + last[0] + ' 期（' + last[1] +
      '），共 ' + SAll.n + ' 期 · 数据来源：中国体育彩票官网';
    var fb = last[2].map(function (n) { return ball(n, 'f', false, numStatTitle('f', n)); }).join('');
    var bb = last[3].map(function (n) { return ball(n, 'b', false, numStatTitle('b', n)); }).join('');
    $('latestDraw').innerHTML =
      '<span class="info">第 ' + last[0] + ' 期 · ' + last[1] + '（' + Shared.weekdayName(last[1]) + '）</span>' + fb +
      '<span style="margin:0 2px;color:var(--muted);">|</span>' + bb +
      '<button class="btn btn-ghost btn-sm act" id="btnCopyLatest" title="复制最新一期开奖号码">📋 复制</button>';
    $('btnCopyLatest').addEventListener('click', function () {
      copyText('第 ' + last[0] + ' 期（' + last[1] + '）：前区 ' + last[2].map(pad2).join(' ') + ' 后区 ' + last[3].map(pad2).join(' '), '已复制最新开奖号码');
    });

    var pool = Number(last[4]) || 0, sales = Number(last[5]) || 0;
    var upgraded = pool >= EIGHT_YI;
    var next = Shared.nextDrawInfo();
    $('latestExtra').innerHTML =
      '<div class="lex' + (upgraded ? ' up' : '') + '"><div class="k">💰 当前奖池（开奖后滚存）</div><div class="v' + (upgraded ? ' big' : '') + '">' +
      (pool ? fmtYi(pool) : '—') + '</div><div class="s">' + (upgraded ? '≥8亿：下一期固定奖按升级档兑付' : '&lt;8亿：下一期固定奖按基本档兑付') + '</div></div>' +
      '<div class="lex"><div class="k">本期销量</div><div class="v">' + (sales ? fmtYi(sales) : '—') + '</div><div class="s">' + (sales ? fmtNum(sales) + ' 元' : '早期数据未公布销量') + '</div></div>' +
      '<div class="lex warm"><div class="k">下一期预计</div><div class="v">第 ' + String(Number(last[0]) + 1) + ' 期</div><div class="s">' + (next ? next.label : '') + ' 21:25 开奖</div></div>' +
      '<div class="lex warm"><div class="k">⏳ 距下次开奖</div><div class="v countdown" id="countdown">计算中…</div><div class="s" id="countdownSub"></div></div>';
    startCountdown(next);
    $('latestAnnounce').innerHTML = buildAnnounceHTML(last, true);
    checkStale();
  }

  // 数据过期检测：最新一期早于「最近一个已到点的开奖日」时提示更新
  function checkStale() {
    var el = $('staleNote');
    var last = SAll.lastDraw;
    var prev = Shared.prevDrawInfo();
    if (!prev) { el.hidden = true; return; }
    var lastTime = new Date(String(last[1]).replace(/-/g, '/') + ' 21:25:00');
    if (lastTime.getTime() < prev.time.getTime()) {
      el.hidden = false;
      el.innerHTML = '⚠️ <b>数据可能不是最新</b>：当前最新一期为 <b>第 ' + esc(last[0]) + ' 期（' + esc(last[1]) + '）</b>，' +
        '而最近一次开奖时间为 <b>' + Shared.fmtDate(prev.time) + '</b>。点击顶部「🔄 在线更新」即可同步最新数据。';
    } else {
      el.hidden = true;
    }
  }

  // ---------- 奖池与销量 ----------
  function buildPoolTrend() {
    var pools = state.rows.slice(0, S.n).map(function (d) { return Number(d[4]) || 0; });
    var valid = pools.filter(function (v) { return v > 0; });
    var max = valid.length ? Math.max.apply(null, valid) : 0;
    var min = valid.length ? Math.min.apply(null, valid) : 0;
    var avg = valid.length ? valid.reduce(function (a, c) { return a + c; }, 0) / valid.length : 0;
    var over8 = valid.filter(function (v) { return v >= EIGHT_YI; }).length;
    var cur = pools[0] || 0;
    var salesVals = state.rows.slice(0, S.n).map(function (d) { return Number(d[5]) || 0; }).filter(function (v) { return v > 0; });
    $('poolCards').innerHTML = [
      { k: '当前奖池（最新一期开奖后）', v: cur ? fmtYi(cur) : '—', s: '第 ' + state.rows[0][0] + ' 期开奖后滚存', cls: cur >= EIGHT_YI ? 'big' : '' },
      { k: '范围内最高奖池', v: fmtYi(max), s: '最低 ' + fmtYi(min) + '，平均 ' + fmtYi(avg), cls: 'big' },
      { k: '奖池 ≥ 8亿 的期数', v: over8 + ' 期', s: valid.length ? '占 ' + pct(over8 / valid.length) + '（范围内）' : '—', cls: 'good' },
      { k: '平均单期销量', v: salesVals.length ? fmtYi(salesVals.reduce(function (a, c) { return a + c; }, 0) / salesVals.length) : '—', s: '共 ' + salesVals.length + ' 期有销量数据' }
    ].map(function (c) {
      return '<div class="card"><div class="k">' + c.k + '</div><div class="v ' + (c.cls || '') + '">' + c.v + '</div><div class="s">' + c.s + '</div></div>';
    }).join('');

    var chrono = S.chrono;
    var labels = chrono.map(function (d) { return d[0]; });
    var poolData = chrono.map(function (d) { return (Number(d[4]) || 0) / 1e8; });
    var salesData = chrono.map(function (d) { return (Number(d[5]) || 0) / 1e8; });

    Charts.register($('chartPool'), function () {
      Charts.line($('chartPool'), {
        series: [{ data: poolData, color: '#2f6fd6', width: 1.4, name: '奖池 ', tipFmt: function (v) { return v.toFixed(2) + ' 亿'; } }],
        xLabels: labels,
        yFmt: function (v) { return v.toFixed(0) + '亿'; },
        hLines: [{ v: 8, color: '#c0392b', label: '8亿升级线' }]
      });
    });

    // 奖池档位分布（每 1 亿一档）
    var hist = {}, i;
    valid.forEach(function (v) { var b = Math.floor(v / 1e8); hist[b] = (hist[b] || 0) + 1; });
    var hl = [], hv = [];
    for (i = 0; i <= Math.max.apply(null, [0].concat(Object.keys(hist).map(Number))); i++) { hl.push(i + '亿'); hv.push(hist[i] || 0); }
    Charts.register($('chartPoolHist'), function () {
      Charts.bar($('chartPoolHist'), {
        labels: hl, values: hv, valueTop: true,
        colors: function (idx) { return idx >= 8 ? '#c22a2a' : '#e98a8a'; },
        tipFmt: function (v) { return v + ' 期'; }
      });
    });

    Charts.register($('chartSales'), function () {
      Charts.line($('chartSales'), {
        series: [{ data: salesData, color: '#e9a23b', width: 1.4, name: '销量 ', tipFmt: function (v) { return v.toFixed(2) + ' 亿'; } }],
        xLabels: labels,
        yFmt: function (v) { return v.toFixed(0) + '亿'; }
      });
    });
  }

  // ---------- 号码走势图 ----------
  function buildTrendGrids() {
    var R = Math.min(trendRange, S.raw.length);
    var rows = S.raw.slice(0, R);
    $('trendFront').innerHTML = trendGridHTML(rows, 'f', FRONT_MAX);
    $('trendBack').innerHTML = trendGridHTML(rows, 'b', BACK_MAX);
  }

  // 每期每号码的「当时遗漏」：从当前行往回数，未开出时显示已遗漏期数
  function trendGridHTML(rows, zone, maxNum) {
    var colTpl = '56px repeat(' + maxNum + ', 24px)';
    var h = '<div class="trend-head" style="grid-template-columns:' + colTpl + ';"><span class="tissue">期号</span>';
    for (var n = 1; n <= maxNum; n++) h += '<span class="tcell">' + pad2(n) + '</span>';
    h += '</div>';
    // 遗漏计数：对每个号码记录它最近一次出现的行索引（-1 表示尚未出现）
    var lastSeen = new Array(maxNum + 1).fill(-1);
    var body = '';
    rows.forEach(function (d, rowIdx) {
      var nums = d[zone === 'f' ? 2 : 3];
      var isSel = selNum && selNum.zone === zone;
      var cell = '', ptr = 0;
      for (var n2 = 1; n2 <= maxNum; n2++) {
        if (ptr < nums.length && nums[ptr] === n2) {
          var hit = isSel && selNum.num === n2;
          cell += '<div class="tcell ' + zone + (hit ? ' sel-' + zone : '') + '" data-zone="' + zone + '" data-num="' + n2 + '" ' +
            'title="' + esc(d[0] + ' 期 · 号码 ' + pad2(n2) + '：' + numStatTitle(zone, n2)) + '"><span class="tb ' + zone + '">' + pad2(n2) + '</span></div>';
          lastSeen[n2] = rowIdx;
          ptr++;
        } else if (trendShowOmit) {
          var omit = lastSeen[n2] < 0 ? rowIdx + 1 : rowIdx - lastSeen[n2];
          cell += '<div class="tcell empty' + (omit >= 10 ? ' omit-hot' : '') + '"><span class="omit">' + omit + '</span></div>';
        } else {
          cell += '<div class="tcell empty"></div>';
        }
      }
      body += '<div class="trend-row" style="grid-template-columns:' + colTpl + ';"><span class="tissue">' + d[0] + '</span>' + cell + '</div>';
    });
    return h + body;
  }

  function onTrendClick(ev) {
    var b = ev.target.closest('.tcell[data-num]');
    if (!b) return;
    selNum = { zone: b.dataset.zone, num: +b.dataset.num };
    buildTrendGrids();
    buildMatrix();
    renderTrendDetail();
  }

  // ---------- 图表绘制 ----------
  function buildFreq() {
    var hotFrontSet = {};
    S.frontFreqList.slice(0, 3).forEach(function (x) { hotFrontSet[x.num] = true; });
    var fl = [], fv = [], i;
    for (i = 1; i <= FRONT_MAX; i++) { fl.push(pad2(i)); fv.push(S.frontFreq[i]); }
    Charts.register($('chartFrontFreq'), function () {
      Charts.bar($('chartFrontFreq'), {
        labels: fl, values: fv, valueTop: true, tipFmt: function (v) { return v + ' 次（' + (v / S.n * 100).toFixed(2) + '%）'; },
        colors: function (idx) { return hotFrontSet[idx + 1] ? '#c22a2a' : '#e98a8a'; }
      });
    });
    var bl = [], bv = [];
    for (i = 1; i <= BACK_MAX; i++) { bl.push(pad2(i)); bv.push(S.backFreq[i]); }
    Charts.register($('chartBackFreq'), function () {
      Charts.bar($('chartBackFreq'), {
        labels: bl, values: bv, valueTop: true, tipFmt: function (v) { return v + ' 次（' + (v / S.n * 100).toFixed(2) + '%）'; },
        colors: function (idx) { return idx < 3 ? '#1f56b0' : '#6f9ce0'; }
      });
    });

    function rankList(arr, zone) {
      return '<ul class="rank-list">' + arr.map(function (x, i) {
        return '<li><span class="rk">' + (i + 1) + '</span>' + ball(x.num, zone, true) +
          '<span style="font-weight:600;">' + pad2(x.num) + '</span><span class="cnt">' + x.count + ' 次 / ' + (x.count / S.n * 100).toFixed(2) + '%</span></li>';
      }).join('') + '</ul>';
    }
    $('frontHotList').innerHTML = rankList(S.frontFreqList.slice(0, 10), 'f');
    $('frontColdList').innerHTML = rankList(S.frontFreqList.slice(-10).reverse(), 'f');
  }

  function buildOmitTables() {
    function omitTable(elId, list, zone, st) {
      var key = st.key, asc = st.asc;
      var rows = list.slice().sort(function (a, b) {
        var va = a[key], vb = b[key];
        return asc ? va - vb : vb - va;
      });
      function th(k, text) {
        return '<th data-k="' + k + '">' + text + (k === key ? (asc ? ' ▲' : ' ▼') : '') + '</th>';
      }
      var html = '<thead><tr>' + th('num', '号码') + th('count', '出现次数') + th('freq', '频率') +
        th('avgOmit', '平均遗漏') + th('maxOmit', '最大遗漏') + th('omitStd', '遗漏标准差') +
        th('curOmit', '当前遗漏') + th('pressure', '回补压力') + '<th>状态</th></tr></thead><tbody>';
      rows.forEach(function (r) {
        var badge = r.curOmit === 0 ? '<span class="badge good">最新开出</span>'
          : r.pressure >= 2 ? '<span class="badge cold">偏冷</span>'
          : r.pressure <= 0.6 ? '<span class="badge hot">活跃</span>'
          : '<span class="badge norm">正常</span>';
        html += '<tr><td>' + ball(r.num, zone, true) + '</td><td>' + r.count + '</td><td>' + r.freq + '%</td>' +
          '<td>' + r.avgOmit + '</td><td>' + r.maxOmit + '</td><td>' + r.omitStd + '</td>' +
          '<td><b>' + r.curOmit + '</b></td><td>' + r.pressure + '</td><td>' + badge + '</td></tr>';
      });
      $(elId).innerHTML = html + '</tbody>';
    }
    omitTable('omitFrontTable', S.frontOmit, 'f', omitSort.front);
    omitTable('omitBackTable', S.backOmit, 'b', omitSort.back);
  }

  function buildSum() {
    var labels = S.chrono.map(function (d) { return d[0]; });
    Charts.register($('chartSum'), function () {
      Charts.line($('chartSum'), {
        series: [
          { data: S.sums, color: '#e23a3a', width: 1.1, name: '和值 ', tipFmt: function (v) { return v; } },
          { data: S.sumMA20, color: '#f39c12', width: 1.5, name: 'MA20 ', tipFmt: function (v) { return v; } },
          { data: S.sumMA50, color: '#2f6fd6', width: 1.5, dash: [5, 4], name: 'MA50 ', tipFmt: function (v) { return v; } }
        ],
        xLabels: labels
      });
    });

    // 和值档位分布（5 点一档）
    var hist = S.sumHist, min = Math.floor(S.sumStats.min / 5) * 5, max = Math.ceil(S.sumStats.max / 5) * 5;
    var hl = [], hv = [], i, b, peak = 0;
    for (b = min; b < max; b += 5) {
      var c = 0;
      for (i = b; i < b + 5; i++) c += hist[i] || 0;
      hl.push(b + '-' + (b + 4)); hv.push(c);
      if (c > peak) peak = c;
    }
    Charts.register($('chartSumHist'), function () {
      Charts.bar($('chartSumHist'), {
        labels: hl, values: hv, valueTop: true,
        colors: function (idx, v) { return v >= peak * 0.5 ? '#e25b5b' : '#f0b6b6'; },
        tipFmt: function (v) { return v + ' 期（' + (v / S.n * 100).toFixed(2) + '%）'; }
      });
    });

    // 和值区间：实际 vs 理论（组合数学精确概率）
    var th = Core.sumTheoretical();
    var bands = Core.SUM_BANDS, rowsHtml = '';
    bands.forEach(function (band, idx) {
      var obs = 0;
      for (i = band[0]; i <= band[1]; i++) obs += hist[i] || 0;
      var obsRate = obs / S.n, thRate = th.bandProbs[idx];
      var diff = obsRate - thRate;
      var badge = Math.abs(diff) < 0.02 ? '<span class="badge norm">接近理论</span>'
        : diff > 0 ? '<span class="badge hot">高于理论</span>' : '<span class="badge cold">低于理论</span>';
      rowsHtml += '<li><span class="rk">' + (idx + 1) + '</span><span style="font-weight:600;">' + band[0] + '–' + band[1] + '</span>' +
        '<span class="cnt">实际 ' + pct(obsRate) + ' / 理论 ' + pct(thRate) + '　' + badge + '</span></li>';
    });
    $('sumZoneList').innerHTML = '<ul class="rank-list">' + rowsHtml + '</ul>' +
      '<p class="rules-note">理论概率由「35 选 5」的全部 ' + th.total.toLocaleString('zh-CN') + ' 种组合精确计算。</p>';
  }

  function buildDist() {
    function distChart(elId, dist, prefix, colors) {
      var labs = [], vals = [];
      for (var k = 0; k <= 5; k++) { labs.push(k + prefix); vals.push(dist[k] || 0); }
      Charts.register($(elId), function () {
        Charts.bar($(elId), {
          labels: labs, values: vals, valueTop: true,
          colors: function (idx) { return colors[idx]; },
          tipFmt: function (v) { return v + ' 期（' + (v / S.n * 100).toFixed(2) + '%）'; }
        });
      });
    }
    distChart('chartOdd', S.oddDist, '奇', ['#dbe6f7', '#b9cff0', '#8fb1e5', '#5f8fd8', '#2f6fd6', '#1f56b0']);
    distChart('chartBig', S.bigDist, '大', ['#fbe3e3', '#f8c9c9', '#f0a3a3', '#e57474', '#d84343', '#c22a2a']);

    var zt = S.zoneTotal;
    Charts.register($('chartZone'), function () {
      Charts.bar($('chartZone'), {
        labels: ['一区 01-12', '二区 13-24', '三区 25-35'],
        values: [zt[0] / S.n, zt[1] / S.n, zt[2] / S.n],
        yFmt: function (v) { return v.toFixed(1); },
        tipFmt: function (v) { return v.toFixed(2) + ' 个/期'; },
        valueTop: true, valueFmt: function (v) { return v.toFixed(2); },
        colors: ['#2f6fd6', '#e23a3a', '#e9a23b']
      });
    });

    var zp = Object.keys(S.zonePatternFreq).map(function (k) { return { k: k, c: S.zonePatternFreq[k] }; })
      .sort(function (a, b) { return b.c - a.c; }).slice(0, 8);
    $('zonePatternList').innerHTML = '<ul class="rank-list">' + zp.map(function (x, i) {
      return '<li><span class="rk">' + (i + 1) + '</span><span style="font-weight:600;">' + x.k + '</span>' +
        '<span class="cnt">' + x.c + ' 期 / ' + pct(x.c / S.n) + '</span></li>';
    }).join('') + '</ul>';
  }

  // ---------- 跨度与龙头凤尾 ----------
  function buildSpan() {
    var st = S.spanStats;
    $('spanStats').innerHTML = [
      { k: '平均跨度', v: st.avg, cls: '' },
      { k: '跨度中位数', v: st.median, cls: '' },
      { k: '跨度范围', v: st.min + ' ~ ' + st.max, cls: '' },
      { k: '跨度标准差', v: st.std, cls: '' },
      { k: '最常见龙头', v: S.headTop.length ? pad2(S.headTop[0].num) : '—', cls: 'big' },
      { k: '最常见凤尾', v: S.tailTop.length ? pad2(S.tailTop[0].num) : '—', cls: 'big' }
    ].map(function (c) {
      return '<div class="mini-stat"><div class="k">' + c.k + '</div><div class="v ' + c.cls + '">' + c.v + '</div></div>';
    }).join('');

    var hl = [], hv = [], i;
    var hMax = Math.max.apply(null, [0].concat(Object.keys(S.spanHist).map(Number)));
    for (i = 0; i <= hMax; i++) { hl.push(i); hv.push(S.spanHist[i] || 0); }
    Charts.register($('chartSpanHist'), function () {
      Charts.bar($('chartSpanHist'), {
        labels: hl, values: hv, valueTop: hv.length <= 40, maxBarWidth: 14,
        colors: function (idx, v) { return v >= Math.max.apply(null, hv) * 0.6 ? '#c22a2a' : '#e98a8a'; },
        tipFmt: function (v) { return v + ' 期（' + (v / S.n * 100).toFixed(2) + '%）'; }
      });
    });

    Charts.register($('chartSpanTrend'), function () {
      Charts.line($('chartSpanTrend'), {
        series: [
          { data: S.spans, color: '#e23a3a', width: 1.1, name: '跨度 ', tipFmt: function (v) { return v; } },
          { data: Core.movingAvg(S.spans, 20), color: '#2f6fd6', width: 1.6, name: 'MA20 ', tipFmt: function (v) { return v; } }
        ],
        xLabels: S.chrono.map(function (d) { return d[0]; })
      });
    });

    function rankList(arr, zone) {
      return '<ul class="rank-list">' + arr.slice(0, 10).map(function (x, i) {
        return '<li><span class="rk">' + (i + 1) + '</span>' + ball(x.num, zone, true) +
          '<span style="font-weight:600;">' + pad2(x.num) + '</span><span class="cnt">' + x.count + ' 期 / ' + pct(x.count / S.n) + '</span></li>';
      }).join('') + '</ul>';
    }
    $('headList').innerHTML = rankList(S.headTop, 'f');
    $('tailList').innerHTML = rankList(S.tailTop, 'f');
  }

  // ---------- 重号 / 邻号 / 同尾 ----------
  function buildRepeat() {
    var rep = S.repeat, nb = S.neighbor, tg = S.tailGroup;
    $('repeatStats').innerHTML = [
      { k: '平均每期重号', v: rep.avg, cls: 'big' },
      { k: '出现重号的期数占比', v: (100 - rep.zeroRate).toFixed(1) + '%', cls: '' },
      { k: '平均每期邻号', v: nb.avg, cls: '' },
      { k: '平均每期同尾号', v: tg.avg, cls: '' },
      { k: '重号最大个数', v: rep.max + ' 个', cls: '' },
      { k: '邻号最大个数', v: nb.max + ' 个', cls: '' }
    ].map(function (c) {
      return '<div class="mini-stat"><div class="k">' + c.k + '</div><div class="v ' + c.cls + '">' + c.v + '</div></div>';
    }).join('');

    function distChart(elId, summary, color) {
      var labs = summary.rows.map(function (r) { return r.k + ' 个'; });
      var vals = summary.rows.map(function (r) { return r.count; });
      Charts.register($(elId), function () {
        Charts.bar($(elId), {
          labels: labs, values: vals, valueTop: true, colors: color,
          tipFmt: function (v, i) { return v + ' 期（' + pct(v / Math.max(S.n - 1, 1)) + '）'; }
        });
      });
    }
    distChart('chartRepeatDist', rep, ['#f4c7c7', '#ef9a9a', '#e57474', '#d84343', '#c22a2a', '#a81f1f']);
    distChart('chartNeighborDist', nb, ['#cfdcf5', '#a8c2ec', '#7fa4e0', '#5b8ad6', '#2f6fd6', '#1f56b0']);
    distChart('chartTailGroup', tg, ['#f3e2c7', '#e9c893', '#dca75f', '#c98a3a', '#a86f22']);

    // 最近 20 期明细（与当前统计范围取交集，避免范围小于 20 期时错位）
    var recent = state.rows.slice(0, Math.min(20, S.n));
    var rowsHtml = '<div class="table-wrap"><table><thead><tr><th>期号</th><th>重号</th><th>邻号</th><th>前区</th></tr></thead><tbody>';
    for (var i = 0; i < recent.length; i++) {
      var cur = recent[i], next = recent[i + 1];
      var r = S.repeatSeries[S.n - 1 - i], n2 = S.neighborSeries[S.n - 1 - i];
      var repNums = [], nbNums = [];
      if (next) {
        for (var j = 0; j < cur[2].length; j++) {
          if (next[2].indexOf(cur[2][j]) >= 0) repNums.push(cur[2][j]);
          else if (next[2].some(function (x) { return Math.abs(x - cur[2][j]) === 1; })) nbNums.push(cur[2][j]);
        }
      }
      rowsHtml += '<tr><td>' + cur[0] + '</td><td>' + (r == null ? '—' : r + (repNums.length ? ' ' + repNums.map(pad2).join(' ') : '')) +
        '</td><td>' + (n2 == null ? '—' : n2 + (nbNums.length ? ' ' + nbNums.map(pad2).join(' ') : '')) + '</td><td>' + balls(cur[2], 'f', true) + '</td></tr>';
    }
    $('repeatRecent').innerHTML = rowsHtml + '</tbody></table></div>';
  }

  // ---------- 012 路 / AC 值 / 尾数 ----------
  function buildMod3() {
    var ac = S.acStats;
    $('mod3Stats').innerHTML = [
      { k: 'AC 值平均', v: ac.avg, cls: 'big' },
      { k: 'AC 值范围', v: ac.min + ' ~ ' + ac.max, cls: '' },
      { k: '最常见 012 路', v: S.mod3Top.length ? S.mod3Top[0].key : '—', cls: '' },
      { k: '常见形态占比', v: S.mod3Top.length ? pct(S.mod3Top[0].count / S.n) : '—', cls: '' }
    ].map(function (c) {
      return '<div class="mini-stat"><div class="k">' + c.k + '</div><div class="v ' + c.cls + '">' + c.v + '</div></div>';
    }).join('');

    $('mod3List').innerHTML = '<ul class="rank-list">' + S.mod3Top.map(function (x, i) {
      return '<li><span class="rk">' + (i + 1) + '</span><span style="font-weight:600;">' + x.key + '</span>' +
        '<span class="cnt">' + x.count + ' 期 / ' + pct(x.count / S.n) + '</span></li>';
    }).join('') + '</ul>';

    var hl = [], hv = [], i;
    var acMax = Math.max.apply(null, [0].concat(Object.keys(ac.hist).map(Number)));
    for (i = 0; i <= acMax; i++) { hl.push(i); hv.push(ac.hist[i] || 0); }
    Charts.register($('chartAc'), function () {
      Charts.bar($('chartAc'), {
        labels: hl, values: hv, valueTop: true, maxBarWidth: 40,
        colors: function (idx, v) { return v >= Math.max.apply(null, hv) * 0.6 ? '#c22a2a' : '#e98a8a'; },
        tipFmt: function (v) { return v + ' 期（' + pct(v / S.n) + '）'; }
      });
    });

    Charts.register($('chartTailOcc'), function () {
      Charts.bar($('chartTailOcc'), {
        labels: ['尾0', '尾1', '尾2', '尾3', '尾4', '尾5', '尾6', '尾7', '尾8', '尾9'],
        values: S.tailOccFront,
        valueTop: true,
        colors: function (idx, v) { return v >= Math.max.apply(null, S.tailOccFront) * 0.7 ? '#c22a2a' : '#e98a8a'; },
        tipFmt: function (v, i) { return '前区 ' + v + ' 次 · 后区 ' + S.tailOccBack[i] + ' 次'; }
      });
    });
  }

  // ---------- 后区专项 ----------
  function buildBackzone() {
    var bs = S.backSumStats;
    $('backStats').innerHTML = [
      { k: '后区和值平均', v: bs.avg, cls: '' },
      { k: '后区和值范围', v: bs.min + ' ~ ' + bs.max, cls: '' },
      { k: '后区和值中位数', v: bs.median, cls: '' },
      { k: '后区跨度平均', v: (S.backSpans.reduce(function (a, c) { return a + c; }, 0) / S.n).toFixed(2), cls: '' },
      { k: '后区热号', v: S.backFreqList.slice(0, 3).map(function (x) { return pad2(x.num); }).join(' '), cls: 'big' },
      { k: '后区冷号', v: S.backFreqList.slice(-3).map(function (x) { return pad2(x.num); }).join(' '), cls: 'big' }
    ].map(function (c) {
      return '<div class="mini-stat"><div class="k">' + c.k + '</div><div class="v ' + c.cls + '">' + c.v + '</div></div>';
    }).join('');

    var i, hl = [], hv = [];
    for (i = bs.min; i <= bs.max; i++) { hl.push(i); hv.push(S.backSumHist[i] || 0); }
    Charts.register($('chartBackSumHist'), function () {
      Charts.bar($('chartBackSumHist'), {
        labels: hl, values: hv, valueTop: hl.length <= 24, maxBarWidth: 22,
        colors: function (idx, v) { return v >= Math.max.apply(null, hv) * 0.6 ? '#c22a2a' : '#e98a8a'; },
        tipFmt: function (v) { return v + ' 期（' + pct(v / S.n) + '）'; }
      });
    });

    var sl = [], sv = [];
    for (i = 1; i <= 11; i++) { sl.push(i); sv.push(S.backSpanHist[i] || 0); }
    Charts.register($('chartBackSpanHist'), function () {
      Charts.bar($('chartBackSpanHist'), {
        labels: sl, values: sv, valueTop: true, maxBarWidth: 30,
        colors: function (idx, v) { return v >= Math.max.apply(null, sv) * 0.6 ? '#1f56b0' : '#6f9ce0'; },
        tipFmt: function (v) { return v + ' 期（' + pct(v / S.n) + '）'; }
      });
    });

    var labels = S.chrono.map(function (d) { return d[0]; });
    Charts.register($('chartBackSumTrend'), function () {
      Charts.line($('chartBackSumTrend'), {
        series: [
          { data: S.backSums, color: '#2f6fd6', width: 1.1, name: '后区和值 ', tipFmt: function (v) { return v; } },
          { data: S.backSumMA20, color: '#e9a23b', width: 1.5, name: 'MA20 ', tipFmt: function (v) { return v; } },
          { data: S.backSumMA50, color: '#2e9e5b', width: 1.5, dash: [5, 4], name: 'MA50 ', tipFmt: function (v) { return v; } }
        ],
        xLabels: labels
      });
    });

    var bl = [], bv = [];
    for (i = 1; i <= BACK_MAX; i++) { bl.push(pad2(i)); bv.push(S.backFreq[i]); }
    Charts.register($('chartBackFreq2'), function () {
      Charts.bar($('chartBackFreq2'), {
        labels: bl, values: bv, valueTop: true, maxBarWidth: 30,
        colors: function (idx) { return idx < 3 ? '#1f56b0' : '#6f9ce0'; },
        tipFmt: function (v) { return v + ' 次（' + pct(v / S.n) + '）'; }
      });
    });
  }

  // ---------- 号码矩阵 ----------
  function appearedIn(zone, num, row) {
    var arr = row[zone === 'f' ? 2 : 3];
    return arr.indexOf(num) >= 0;
  }
  function matrixTip(zone, num) {
    var o = (zone === 'f' ? S.frontOmit : S.backOmit)[num - 1];
    return '出现 ' + o.count + ' 次 · 当前遗漏 ' + o.curOmit + ' 期 · 平均遗漏 ' + o.avgOmit + ' 期';
  }
  function buildMatrix() {
    var i, fh = '', bh = '';
    // 颜色深浅按出现次数归一（热号更深）
    var maxF = Math.max.apply(null, S.frontFreq.slice(1)), minF = Math.min.apply(null, S.frontFreq.slice(1));
    for (i = 1; i <= FRONT_MAX; i++) {
      var o = 0.45 + 0.55 * (S.frontFreq[i] - minF) / Math.max(maxF - minF, 1);
      fh += '<button class="gball f' + (selNum && selNum.zone === 'f' && selNum.num === i ? ' sel' : '') +
        '" style="opacity:' + o.toFixed(2) + '" data-zone="f" data-num="' + i + '" title="' + esc(matrixTip('f', i)) + '">' + pad2(i) + '</button>';
    }
    var maxB = Math.max.apply(null, S.backFreq.slice(1)), minB = Math.min.apply(null, S.backFreq.slice(1));
    for (i = 1; i <= BACK_MAX; i++) {
      var o2 = 0.45 + 0.55 * (S.backFreq[i] - minB) / Math.max(maxB - minB, 1);
      bh += '<button class="gball b' + (selNum && selNum.zone === 'b' && selNum.num === i ? ' sel' : '') +
        '" style="opacity:' + o2.toFixed(2) + '" data-zone="b" data-num="' + i + '" title="' + esc(matrixTip('b', i)) + '">' + pad2(i) + '</button>';
    }
    $('frontGrid').innerHTML = fh;
    $('backGrid').innerHTML = bh;
    renderMatrixDetail($('matrixDetail'));
  }

  function renderMatrixDetail(el) {
    if (!el) return;
    if (!selNum) { el.innerHTML = ''; return; }
    var zone = selNum.zone, num = selNum.num;
    var o = (zone === 'f' ? S.frontOmit : S.backOmit)[num - 1];
    var rows = state.rows;   // 最新在前（详情始终基于全量数据，便于看长期规律）
    var lastIssue = null, i;
    for (i = 0; i < rows.length; i++) if (appearedIn(zone, num, rows[i])) { lastIssue = rows[i]; break; }
    var cnt30 = 0, dots = '';
    rows.slice(0, 30).forEach(function (r) {
      if (appearedIn(zone, num, r)) { cnt30++; dots += '<i class="dot on"></i>'; } else dots += '<i class="dot"></i>';
    });
    function stat(k, v) { return '<div class="md-stat"><span>' + k + '</span><b>' + v + '</b></div>'; }
    el.innerHTML =
      '<div class="md-head">' + ball(num, zone) + ' <b>' + pad2(num) + '</b><span class="md-zone">' + (zone === 'f' ? '前区' : '后区') +
      '（统计范围：' + (state.range ? '近 ' + S.n + ' 期' : '全部历史') + '）</span></div>' +
      '<div class="md-grid">' +
      stat('出现次数', o.count + ' 次') +
      stat('出现频率', o.freq + '%') +
      stat('当前遗漏', '<b style="color:var(--red);">' + o.curOmit + '</b> 期') +
      stat('平均遗漏', o.avgOmit + ' 期') +
      stat('最大遗漏', o.maxOmit + ' 期') +
      stat('回补压力', o.pressure) +
      stat('最近开出', lastIssue ? '第 ' + lastIssue[0] + ' 期' : '从未开出') +
      '</div>' +
      '<div class="md-last30"><span>近 30 期出现 <b>' + cnt30 + '</b> 次：</span><span class="dots">' + dots + '</span></div>' +
      '<div class="chart-box" style="margin-top:12px;"><h3>滑动窗口出现次数（50 / 100 期）</h3>' +
      '<canvas class="rolling-canvas" height="180"></canvas><div class="chart-tip"></div></div>';
    var canvas = el.querySelector('.rolling-canvas');
    var win50 = Core.rollingOccurrence(state.rows, zone, num, 50);
    var win100 = Core.rollingOccurrence(state.rows, zone, num, 100);
    Charts.register(canvas, function () {
      Charts.line(canvas, {
        series: [
          { data: win50.series, color: zone === 'f' ? '#e23a3a' : '#2f6fd6', width: 1.5, name: '近50期 ', tipFmt: function (v) { return v + ' 次'; } },
          { data: win100.series, color: '#e9a23b', width: 1.3, dash: [4, 3], name: '近100期 ', tipFmt: function (v) { return v + ' 次'; } }
        ],
        xLabels: win50.labels,
        yMin: 0
      });
    });
  }

  // ---------- 共现热力图 ----------
  function buildCooccur() {
    var labels = [], i;
    for (i = 1; i <= FRONT_MAX; i++) labels.push(pad2(i));
    $('coExpected').textContent = S.pairExpected;
    Charts.register($('heatCooccur'), function () {
      Charts.heat($('heatCooccur'), {
        rowLabels: labels, colLabels: labels,
        matrix: S.coMatrix, center: S.pairExpected, expected: S.pairExpected, cell: 16
      });
    });
    $('coTopList').innerHTML = '<ul class="rank-list">' + S.coTop.slice(0, 10).map(function (x, idx) {
      var ratio = S.pairExpected ? (x.count / S.pairExpected) : 0;
      return '<li><span class="rk">' + (idx + 1) + '</span>' + ball(x.a, 'f', true) + ball(x.b, 'f', true) +
        '<span style="font-weight:600;">' + pad2(x.a) + ' + ' + pad2(x.b) + '</span>' +
        '<span class="cnt">' + x.count + ' 次 · 期望的 ' + ratio.toFixed(2) + ' 倍</span></li>';
    }).join('') + '</ul>';
  }

  // ---------- 组合 / 连号 ----------
  function buildCombos() {
    function comboList(arr, zone, type) {
      return '<ul class="rank-list">' + arr.slice(0, 15).map(function (x, i) {
        var nums = x.key.split(',').map(Number);
        var text = type === 'back'
          ? ball(nums[0], 'b', true) + ball(nums[1], 'b', true)
          : nums.map(function (n) { return ball(n, 'f', true); }).join('');
        return '<li><span class="rk">' + (i + 1) + '</span>' + text + '<span class="cnt">' + x.count + ' 期出现</span></li>';
      }).join('') + '</ul>';
    }
    $('frontPairs').innerHTML = comboList(S.frontPairTop, 'f', 'front');
    $('frontTriples').innerHTML = comboList(S.frontTripleTop, 'f', 'front');
    $('backPairs').innerHTML = comboList(S.backPairTop, 'b', 'back');

    var c = S.consec;
    var gd = Object.keys(c.groupDist).map(Number).sort(function (a, b) { return a - b; });
    var last20 = S.raw.slice(0, 20);
    var last20Has = last20.filter(function (d) {
      for (var j = 1; j < 5; j++) if (d[2][j] - d[2][j - 1] === 1) return true;
      return false;
    }).length;
    var zk = Object.keys(S.zonePatternFreq).map(function (k) { return { k: k, c: S.zonePatternFreq[k] }; })
      .sort(function (a, b) { return b.c - a.c; })[0];
    $('consecStats').innerHTML =
      '<p>出现连号的期数：<b>' + c.hasCount + '</b> 期，占 ' + pct(c.hasCount / S.n) + '</p>' +
      '<p>平均每期连号组数：<b>' + c.avgGroups + '</b> 组，最长连号 <b>' + c.maxRun + '</b> 连</p>' +
      '<p>连号组数分布：' + gd.map(function (k) { return k + ' 组 ' + c.groupDist[k] + ' 期'; }).join('，') + '</p>' +
      '<p>最近 20 期中有 <b>' + last20Has + '</b> 期含连号</p>' +
      '<p>最常见三区形态：<b>' + zk.k + '</b>（' + zk.c + ' 期，占 ' + pct(zk.c / S.n) + '）</p>';
  }

  // ---------- 奖金与返奖率 ----------
  function buildPrize() {
    var ps = S.prizeStats;
    $('prizeStats').innerHTML = [
      { k: '平均返奖率', v: ps.payoutAvg ? pct(ps.payoutAvg) : '—', cls: 'big' },
      { k: '返奖率中位数', v: ps.payoutMedian ? pct(ps.payoutMedian) : '—', cls: '' },
      { k: '返奖率区间', v: ps.payout.length ? pct(ps.payoutMin) + ' ~ ' + pct(ps.payoutMax) : '—', cls: '' },
      { k: '一等奖中奖注数合计', v: ps.levels['一等奖'] ? fmtNum(ps.levels['一等奖'].notes) + ' 注' : '—', cls: '' },
      { k: '一等奖单注最高（范围内）', v: ps.jackpot.length ? fmtMoney(Math.max.apply(null, ps.jackpot.map(function (x) { return x.amount; }))) : '—', cls: '' },
      { k: '有公告的期数', v: ps.hasAnnouncement + ' / ' + S.n, cls: '' }
    ].map(function (c) {
      return '<div class="mini-stat"><div class="k">' + c.k + '</div><div class="v ' + c.cls + '">' + c.v + '</div></div>';
    }).join('');

    // 一等奖单注奖金走势（近 200 期：全量 2900+ 点会挤成一片红噪声，看不出趋势）
    var RECENT = 200;
    var jk = ps.jackpot.slice(0, RECENT).reverse();
    Charts.register($('chartJackpot'), function () {
      Charts.line($('chartJackpot'), {
        series: [{ data: jk.map(function (x) { return x.amount / 10000; }), color: '#c22a2a', width: 1.4, name: '单注 ', tipFmt: function (v) { return v.toFixed(1) + ' 万元'; } }],
        xLabels: jk.map(function (x) { return x.issue; }),
        yFmt: function (v) { return v.toFixed(0) + '万'; },
        yMin: 0
      });
    });

    var po = ps.payout.slice(0, RECENT).reverse();
    Charts.register($('chartPayout'), function () {
      Charts.line($('chartPayout'), {
        series: [{ data: po.map(function (x) { return x.rate * 100; }), color: '#2e9e5b', width: 1.4, name: '返奖率 ', tipFmt: function (v) { return v.toFixed(2) + '%'; } }],
        xLabels: po.map(function (x) { return x.issue; }),
        yFmt: function (v) { return v.toFixed(0) + '%'; },
        yMin: 0,
        hLines: [{ v: 50, color: '#c0392b', label: '50% 参考线' }]
      });
    });

    var html = '<thead><tr><th>奖级</th><th>有中奖期数</th><th>中奖注数合计</th><th>派奖金额合计</th><th>平均单注</th></tr></thead><tbody>';
    ps.levelList.forEach(function (L) {
      var avg = L.notes ? L.money / L.notes : 0;
      html += '<tr><td style="font-weight:600;text-align:left;">' + esc(L.name) + '</td><td>' + fmtNum(L.draws) + '</td><td>' +
        fmtNum(L.notes) + '</td><td>' + fmtMoney(L.money) + '</td><td>' + (avg ? fmtMoney(avg) : '—') + '</td></tr>';
    });
    html += '<tr class="tt"><td>合计</td><td>—</td><td>—</td><td>' + fmtMoney(ps.totalMoney) + '</td><td>—</td></tr></tbody>';
    $('prizeLevelTable').innerHTML = html;
  }

  // ---------- 模拟选号 ----------
  function pickStrategy(kind) {
    if (kind === 'random') {
      return { f: Shared.sampleUniform(Core.FRONT_POOL, 5), b: Shared.sampleUniform(Core.BACK_POOL, 2) };
    }
    if (kind === 'hot') {
      return {
        f: Shared.sampleWeighted(Core.FRONT_POOL, function (n) { return S.frontFreq[n]; }, 5),
        b: Shared.sampleWeighted(Core.BACK_POOL, function (n) { return S.backFreq[n]; }, 2)
      };
    }
    if (kind === 'omit') {
      var fw = {}, bw = {};
      S.frontOmit.forEach(function (r) { fw[r.num] = r.curOmit + 1; });
      S.backOmit.forEach(function (r) { bw[r.num] = r.curOmit + 1; });
      return { f: Shared.sampleWeighted(Core.FRONT_POOL, fw, 5), b: Shared.sampleWeighted(Core.BACK_POOL, bw, 2) };
    }
    var tries = 0;
    while (tries++ < 3000) {
      var f = Shared.sampleUniform(Core.FRONT_POOL, 5);
      var odd = f.filter(function (n) { return n % 2 === 1; }).length;
      var big = f.filter(function (n) { return n >= 18; }).length;
      var s = f.reduce(function (a, c) { return a + c; }, 0);
      if (odd >= 2 && odd <= 3 && big >= 2 && big <= 3 && s >= S.sumStats.avg - 20 && s <= S.sumStats.avg + 20) {
        return { f: f, b: Shared.sampleUniform(Core.BACK_POOL, 2) };
      }
    }
    return { f: Shared.sampleUniform(Core.FRONT_POOL, 5), b: Shared.sampleUniform(Core.BACK_POOL, 2) };
  }

  var PICK_LABELS = { random: '随机', hot: '热号', omit: '遗漏', balance: '均衡' };
  function renderPicks(kind) {
    var notes = [];
    for (var i = 0; i < 5; i++) notes.push(pickStrategy(kind));
    lastPicks = { kind: kind, notes: notes };
    $('pickResult').innerHTML = notes.map(function (nt, idx) {
      var s = nt.f.reduce(function (a, c) { return a + c; }, 0);
      var odd = nt.f.filter(function (n) { return n % 2 === 1; }).length;
      var big = nt.f.filter(function (n) { return n >= 18; }).length;
      return '<div class="pick-note"><span class="idx">' + PICK_LABELS[kind] + ' ' + (idx + 1) + '</span>' +
        balls(nt.f, 'f') + '<span style="margin:0 3px;color:var(--muted);">|</span>' + balls(nt.b, 'b') +
        '<span class="pred-meta">和值' + s + ' · 奇' + odd + '偶' + (5 - odd) + ' · 大' + big + '小' + (5 - big) + ' · 跨度' + (nt.f[4] - nt.f[0]) + '</span></div>';
    }).join('');
  }
  function copyText(text, okMsg) {
    function done(ok) { toast(ok ? okMsg : '复制失败，请手动复制', ok); }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(false); });
    } else {
      var ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { done(document.execCommand('copy')); } catch (e) { done(false); }
      document.body.removeChild(ta);
    }
  }
  function copyPicks() {
    if (!lastPicks) { toast('请先点击任一策略生成选号', false); return; }
    var lines = lastPicks.notes.map(function (nt, idx) {
      return '第' + (idx + 1) + '注 ' + PICK_LABELS[lastPicks.kind] + '：' + nt.f.map(pad2).join(' ') + ' + ' + nt.b.map(pad2).join(' ');
    });
    copyText(lines.join('\n'), '已复制选号结果');
  }

  // ---------- 预测 ----------
  function buildPrediction() {
    var st = Core.buildPredStats(state.rows.slice(0, S.n));
    var sc = Core.scoreFor(predMethod, st);
    predScores = { st: st, sc: sc };
    var m = Core.PRED_METHODS[predMethod];
    $('predDesc').textContent = '当前方法：' + m.name + ' —— ' + m.desc + '（统计样本：' + (state.range ? '近 ' + S.n + ' 期' : '全部 ' + S.n + ' 期') + '）';
    $('predTitleF').textContent = '前区 01–35 ' + m.name + '评分（悬停查看，红柱为 TOP6）';
    $('predTitleB').textContent = '后区 01–12 ' + m.name + '评分（悬停查看，蓝柱为 TOP3）';
    var fTop = Core.topN(sc.sF, FRONT_MAX, 6), bTop = Core.topN(sc.sB, BACK_MAX, 3);
    $('predRecoF').innerHTML = fTop.map(function (x) { return ball(x.num, 'f'); }).join('') +
      ' <span class="pred-score">评分 ' + fTop.map(function (x) { return x.v.toFixed(0); }).join(' / ') + '</span>';
    $('predRecoB').innerHTML = bTop.map(function (x) { return ball(x.num, 'b'); }).join('') +
      ' <span class="pred-score">评分 ' + bTop.map(function (x) { return x.v.toFixed(0); }).join(' / ') + '</span>';

    var tickets = Core.predictMethod(predMethod, st, 5);
    $('predResult').innerHTML = tickets.map(function (nt, idx) {
      var s = nt.f.reduce(function (a, c) { return a + c; }, 0);
      var odd = nt.f.filter(function (n) { return n % 2 === 1; }).length;
      var big = nt.f.filter(function (n) { return n >= 18; }).length;
      return '<div class="pick-note"><span class="idx">' + m.name + ' ' + (idx + 1) + '</span>' +
        balls(nt.f, 'f') + '<span style="margin:0 3px;color:var(--muted);">|</span>' + balls(nt.b, 'b') +
        '<span class="pred-meta">和值' + s + ' · 奇' + odd + '偶' + (5 - odd) + ' · 大' + big + '小' + (5 - big) + '</span></div>';
    }).join('');

    var fl = [], fv = [], bl = [], bv = [], i;
    for (i = 1; i <= FRONT_MAX; i++) { fl.push(pad2(i)); fv.push(+sc.sF[i].toFixed(1)); }
    for (i = 1; i <= BACK_MAX; i++) { bl.push(pad2(i)); bv.push(+sc.sB[i].toFixed(1)); }
    var fTopSet = fTop.map(function (x) { return x.num; }), bTopSet = bTop.map(function (x) { return x.num; });
    Charts.register($('predChartFront'), function () {
      Charts.bar($('predChartFront'), {
        labels: fl, values: fv, valueTop: true,
        tipFmt: function (v) { return v + ' 分'; },
        colors: function (idx) { return fTopSet.indexOf(idx + 1) >= 0 ? '#c22a2a' : '#e98a8a'; }
      });
    });
    Charts.register($('predChartBack'), function () {
      Charts.bar($('predChartBack'), {
        labels: bl, values: bv, valueTop: true,
        tipFmt: function (v) { return v + ' 分'; },
        colors: function (idx) { return bTopSet.indexOf(idx + 1) >= 0 ? '#1f56b0' : '#6f9ce0'; }
      });
    });
  }

  function runBacktest() {
    var btn = $('btnBacktest');
    if (btn.disabled) return;
    btn.disabled = true;
    $('btWrap').hidden = false;
    $('btTable').innerHTML = '<tr><td colspan="6" style="color:var(--muted);">回测计算中…</td></tr>';
    setTimeout(function () {
      var res = Core.backtest(state.rows, { periods: 100, trials: 3, minHistory: 200, seed: 20260101 });
      var base = res.baseline;
      var html = '<thead><tr><th>方法</th><th>平均前区命中/注</th><th>平均后区命中/注</th><th>前区≥1命中率</th><th>前区≥3命中率</th><th>相对随机（前区）</th></tr></thead><tbody>';
      res.methods.forEach(function (m) {
        if (!m.sample) { html += '<tr><td>' + esc(m.name) + '</td><td colspan="5" style="color:var(--muted);">数据不足</td></tr>'; return; }
        var d = m.frontDelta;
        var badge = d >= 0.03 ? '<span class="badge good">+' + d.toFixed(3) + '</span>'
          : d <= -0.03 ? '<span class="badge cold">' + d.toFixed(3) + '</span>'
          : '<span class="badge norm">' + (d >= 0 ? '+' : '') + d.toFixed(3) + '</span>';
        html += '<tr><td style="font-weight:600;">' + esc(m.name) + '</td><td>' + m.frontAvg.toFixed(3) + '</td><td>' + m.backAvg.toFixed(3) +
          '</td><td>' + pct(m.frontHit1, 1) + '</td><td>' + pct(m.frontHit3, 1) + '</td><td>' + badge + '</td></tr>';
      });
      html += '<tr style="background:var(--table-head);"><td style="font-weight:600;">纯随机基准</td><td>' + base.frontAvg.toFixed(3) +
        '</td><td>' + base.backAvg.toFixed(3) + '</td><td>' + pct(base.frontHit1, 1) + '</td><td>' + pct(base.frontHit3, 1) + '</td><td>—</td></tr>';
      html += '<tr class="tt"><td colspan="6" class="dim" style="text-align:left;">回测样本：' + res.periods + ' 期 × 每期 ' + res.trials +
        ' 次抽样（固定随机种子 ' + res.seed + '，结果可复现）；每期仅使用该期之前的历史数据。样本量有限，小幅偏差属正常波动。</td></tr></tbody>';
      $('btTable').innerHTML = html;
      var h3 = $('btWrap').querySelector('h3');
      if (h3) h3.textContent = '近 100 期历史回测 · 本次样本 ' + res.periods + ' 期 × ' + res.trials + ' 次（固定种子，可复现）';
      btn.disabled = false;
      toast('回测完成：样本 ' + res.periods + ' 期（每期前 ≥200 期历史数据）', true);
    }, 30);
  }

  // ---------- 开奖记录 ----------
  var recPage = 0, recPageSize = 50, recQuery = '';
  var recOpen = {};
  function renderRecords() {
    var list = state.rows;
    if (recQuery) {
      var q = recQuery.toLowerCase();
      list = state.rows.filter(function (d) { return String(d[0]).indexOf(q) >= 0 || String(d[1]).indexOf(q) >= 0; });
    }
    var total = list.length;
    var pages = recPageSize === 0 ? 1 : Math.max(1, Math.ceil(total / recPageSize));
    if (recPage >= pages) recPage = pages - 1;
    if (recPage < 0) recPage = 0;
    var slice = recPageSize === 0 ? list : list.slice(recPage * recPageSize, (recPage + 1) * recPageSize);
    var html = '<thead><tr><th>期号</th><th>开奖日期</th><th>前区</th><th>后区</th><th class="hide-sm">和值</th><th class="hide-sm">跨度</th><th>奖池</th><th class="hide-sm">销量</th><th>公告</th></tr></thead><tbody>';
    slice.forEach(function (d) {
      var pool = Number(d[4]) || 0, sales = Number(d[5]) || 0;
      var hasPrize = (d[6] || []).length > 0;
      var open = recOpen[d[0]];
      var sum = d[2].reduce(function (a, c) { return a + c; }, 0);
      html += '<tr class="' + (open ? 'rec-open' : '') + '" data-issue="' + esc(d[0]) + '" style="cursor:pointer;" title="点击查看该期开奖公告">' +
        '<td style="font-weight:600; color:var(--blue); text-decoration:underline dotted;" class="rec-issue" title="点击填入中奖查询期号">' + esc(d[0]) + '</td>' +
        '<td style="color:var(--muted);">' + esc(d[1]) + '</td>' +
        '<td>' + balls(d[2], 'f', true) + '</td><td>' + balls(d[3], 'b', true) + '</td>' +
        '<td class="hide-sm">' + sum + '</td><td class="hide-sm">' + (d[2][4] - d[2][0]) + '</td>' +
        '<td>' + (pool ? fmtYi(pool) : '—') + '</td>' +
        '<td class="hide-sm">' + (sales ? fmtYi(sales) : '—') + '</td>' +
        '<td>' + (hasPrize ? '<span class="badge good">' + (open ? '收起' : '查看') + '</span>' : '<span class="badge norm">无</span>') + '</td></tr>';
      if (open) html += '<tr class="ann-row"><td colspan="9">' + buildAnnounceHTML(d, false) + '</td></tr>';
    });
    $('recordTable').innerHTML = html + '</tbody>';
    $('pageInfo').textContent =
      '第 ' + (recPage + 1) + ' / ' + pages + ' 页，共 ' + total + ' 期' + (recQuery ? '（搜索“' + recQuery + '”）' : '') +
      (Object.keys(recOpen).length ? '；已展开 ' + Object.keys(recOpen).length + ' 期公告' : '');
    $('btnPrev').disabled = recPage <= 0;
    $('btnNext').disabled = recPage >= pages - 1;
  }

  function exportCSV() {
    var rows = state.rows;
    var header = ['期号', '开奖日期', '前区', '后区', '前区和值', '前区跨度', '后区和值', '奖池(元)', '销量(元)', '一等奖注数', '一等奖单注奖金', '派奖合计(元)', '返奖率'];
    var data = rows.map(function (r) {
      var prizes = r[6] || [];
      var total = 0, j1c = '', j1a = '';
      prizes.forEach(function (p) {
        var c = Number(p[1]) || 0, a = Number(p[2]) || 0;
        total += c * a;
        if (p[0] === '一等奖') { j1c = c; j1a = a; }
      });
      var sales = Number(r[5]) || 0;
      return [r[0], r[1], r[2].map(pad2).join(' '), r[3].map(pad2).join(' '),
        r[2].reduce(function (a, c) { return a + c; }, 0), r[2][4] - r[2][0], r[3][0] + r[3][1],
        Number(r[4]) || 0, sales, j1c, j1a, total, sales > 0 ? (total / sales * 100).toFixed(2) + '%' : ''];
    });
    var blob = new Blob([Shared.buildCsv(header, data)], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = '大乐透历史开奖_' + rows[0][0] + '.csv';
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 200);
    toast('已导出 ' + rows.length + ' 期数据（含和值 / 跨度 / 返奖率）', true);
  }

  // ---------- 渲染总入口 ----------
  function renderAll() {
    buildOverview();
    buildLatest();
    buildPoolTrend();
    buildTrendGrids();
    buildFreq();
    buildOmitTables();
    buildSum();
    buildDist();
    buildSpan();
    buildRepeat();
    buildMod3();
    buildBackzone();
    buildMatrix();
    buildCooccur();
    buildCombos();
    buildPrize();
    buildPrediction();
    renderRecords();
    renderTrendDetail();
    Charts.redrawAll();
  }
  function renderTrendDetail() { renderMatrixDetail($('trendDetail')); }

  // ---------- 事件绑定 ----------
  function bindEvents() {
    $('btnUpdate').addEventListener('click', doUpdate);
    $('btnSaveData').addEventListener('click', doSaveData);
    $('btnReset').addEventListener('click', doReset);
    $('btnTheme').addEventListener('click', function () {
      applyTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
    });
    $('globalRange').addEventListener('change', function (ev) { setRange(ev.target.value); });

    // 走势图范围与遗漏显示
    $('trendRangeBar').addEventListener('click', function (ev) {
      var b = ev.target.closest('button[data-r]');
      if (!b) return;
      trendRange = +b.dataset.r;
      document.querySelectorAll('#trendRangeBar button[data-r]').forEach(function (x) {
        x.classList.remove('btn-primary'); x.classList.add('btn-ghost');
      });
      b.classList.remove('btn-ghost'); b.classList.add('btn-primary');
      buildTrendGrids();
    });
    $('trendOmit').addEventListener('change', function (ev) {
      trendShowOmit = ev.target.checked;
      buildTrendGrids();
    });
    $('trendFront').addEventListener('click', onTrendClick);
    $('trendBack').addEventListener('click', onTrendClick);

    // 号码矩阵
    ['frontGrid', 'backGrid'].forEach(function (id) {
      $(id).addEventListener('click', function (ev) {
        var b = ev.target.closest('.gball');
        if (!b) return;
        selNum = { zone: b.dataset.zone, num: +b.dataset.num };
        buildMatrix();
        buildTrendGrids();
        renderTrendDetail();
      });
    });

    // 遗漏表排序
    ['omitFrontTable', 'omitBackTable'].forEach(function (id) {
      $(id).addEventListener('click', function (ev) {
        var th = ev.target.closest('th');
        if (!th || !th.dataset.k) return;
        var zone = id === 'omitFrontTable' ? 'front' : 'back';
        var st = omitSort[zone];
        if (st.key === th.dataset.k) st.asc = !st.asc;
        else { st.key = th.dataset.k; st.asc = (th.dataset.k === 'num' || th.dataset.k === 'avgOmit' || th.dataset.k === 'maxOmit'); }
        buildOmitTables();
      });
    });

    // 选号
    $('btnRandom').addEventListener('click', function () { renderPicks('random'); });
    $('btnHot').addEventListener('click', function () { renderPicks('hot'); });
    $('btnOmit').addEventListener('click', function () { renderPicks('omit'); });
    $('btnBalance').addEventListener('click', function () { renderPicks('balance'); });
    $('btnCopy').addEventListener('click', copyPicks);

    // 预测方法
    $('predBar').addEventListener('click', function (ev) {
      var b = ev.target.closest('button[data-m]');
      if (!b) return;
      document.querySelectorAll('#predBar button[data-m]').forEach(function (x) {
        x.classList.remove('btn-primary'); x.classList.add('btn-ghost');
      });
      b.classList.remove('btn-ghost'); b.classList.add('btn-primary');
      predMethod = b.dataset.m;
      buildPrediction();
    });
    $('btnBacktest').addEventListener('click', runBacktest);

    // 记录表
    $('recordTable').addEventListener('click', function (ev) {
      var issueEl = ev.target.closest('.rec-issue');
      if (issueEl) {
        var term = issueEl.closest('tr').dataset.issue;
        window.DltCheck.fillTerm(term);
        document.getElementById('check').scrollIntoView({ behavior: 'smooth' });
        toast('已填入期号 ' + term + '，点击「🎯 判定中奖」即可', true);
        return;
      }
      var tr = ev.target.closest('tr[data-issue]');
      if (!tr) return;
      var issue = tr.dataset.issue;
      recOpen[issue] = !recOpen[issue];
      renderRecords();
    });
    $('btnPrev').addEventListener('click', function () { recPage--; renderRecords(); });
    $('btnNext').addEventListener('click', function () { recPage++; renderRecords(); });
    $('recordCount').addEventListener('change', function (ev) { recPageSize = +ev.target.value; recPage = 0; renderRecords(); });
    $('searchIssue').addEventListener('input', function (ev) { recQuery = ev.target.value.trim(); recPage = 0; renderRecords(); });
    $('btnExportCSV').addEventListener('click', exportCSV);

    // 快捷键：/ 聚焦搜索；Esc 关闭 toast
    document.addEventListener('keydown', function (ev) {
      var tag = (document.activeElement && document.activeElement.tagName) || '';
      if (ev.key === '/' && tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') {
        ev.preventDefault();
        $('searchIssue').focus();
      } else if (ev.key === 'Escape') {
        $('toast').className = 'toast';
      }
    });

    // 面板折叠（状态记忆）
    var collapsedMap = recall(COLLAPSE_KEY, {}) || {};
    document.querySelectorAll('.panel-toggle').forEach(function (btn) {
      var panel = btn.closest('.panel');
      var body = panel.querySelector('.panel-body');
      var pid = panel.id;
      if (collapsedMap[pid]) {
        body.classList.add('collapsed');
        panel.classList.add('collapsed');
        btn.textContent = '▸';
        btn.title = '展开';
      }
      btn.addEventListener('click', function () {
        var collapsed = body.classList.toggle('collapsed');
        panel.classList.toggle('collapsed', collapsed);
        btn.textContent = collapsed ? '▸' : '▾';
        btn.title = collapsed ? '展开' : '折叠 / 展开';
        collapsedMap[pid] = collapsed ? 1 : 0;
        store(COLLAPSE_KEY, collapsedMap);
        if (!collapsed) requestAnimationFrame(function () { Charts.redrawAll(); });
      });
    });

    // 回到顶部 / 跳到底部
    window.addEventListener('scroll', function () {
      $('backtop').classList.toggle('show', window.scrollY > 600);
      var nearBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 700;
      $('backbottom').classList.toggle('show', window.scrollY > 600 && !nearBottom);
    }, { passive: true });
    $('backbottom').addEventListener('click', function (ev) {
      ev.preventDefault();
      window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' });
    });

    // 吸顶栏高度变化 → 修正锚点偏移
    function updateScrollOffset() {
      var tb = document.querySelector('.topbar');
      document.documentElement.style.setProperty('--scroll-offset', ((tb ? tb.offsetHeight : 96) + 10) + 'px');
    }
    updateScrollOffset();

    // 导航高亮（scrollspy）+ 让当前项始终滚动可见
    var navLinks = document.querySelectorAll('#mainNav a');
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        navLinks.forEach(function (a) {
          var on = a.dataset.sec === en.target.id;
          a.classList.toggle('active', on);
          if (on && a.scrollIntoView) a.scrollIntoView({ inline: 'center', block: 'nearest' });
        });
      });
    }, { rootMargin: '-40% 0px -55% 0px' });
    document.querySelectorAll('section[id]').forEach(function (el) { io.observe(el); });

    var resizeTimer = null;
    window.addEventListener('resize', function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () { Charts.redrawAll(); updateScrollOffset(); }, 200);
    });
  }

  // ---------- 初始化 ----------
  function init() {
    initTheme();
    Charts.attachHover();
    bindEvents();
    window.DltCheck.init();

    state.range = +recall(RANGE_KEY, 0) || 0;
    $('globalRange').value = String(state.range);

    var initial = pickInitialRows();
    setData(initial.rows, initial.meta);
    updateDataSourceHint();
    renderPicks('random');

    // 静默检查新数据：优先直连官网查最新一页；官网不可用再退回对比仓库 data.js
    function autoCheckNew() {
      if (location.protocol === 'file:') return;
      // 缓存很新时才跳过；若已错过最新一期开奖，则必须继续检查，避免看不到新开奖
      if (state.meta.source === 'cache' && state.meta.fetchedAt && Date.now() - state.meta.fetchedAt < 3600 * 1000) return;
      var pv = Shared.prevDrawInfo ? Shared.prevDrawInfo() : null;
      var hasLatestDraw = pv && String((state.rows[0] && state.rows[0][1]) || '') >= Shared.fmtDate(pv.time);
      if (state.meta.source === 'cache' && state.meta.fetchedAt &&
        Date.now() - state.meta.fetchedAt < 12 * 3600 * 1000 && hasLatestDraw) return;

      var existingSet = {};
      state.rows.forEach(function (r) { existingSet[r[0]] = true; });

      // 第一步：直连官网（本地模式经本地代理），拿到的是实时最新开奖
      fetchAllFromApi(existingSet, null, 1).then(function (res) {
        var list = res.list;
        if (!list || !list.length) return;
        toast(list.length >= PAGE_SIZE ? '发现较多新数据（≥' + list.length + ' 期），可一键更新'
          : '发现 ' + list.length + ' 期新数据（可更新至第 ' + list[0].lotteryDrawNum + ' 期）', null,
          { label: '立即更新', onClick: doUpdate });
      }).catch(function () {
        // 第二步：官网不可用时，退回对比仓库 data.js，至少能提示 Action 同步来的新数据
        if (IS_LOCAL) return;
        loadLatestDataJs().then(function (latest) {
          var curLatest = String((state.rows[0] && state.rows[0][0]) || '');
          var newLatest = String((latest[0] && latest[0][0]) || '');
          if (newLatest <= curLatest) return;
          toast('发现新数据（可更新至第 ' + newLatest + ' 期）', null,
            { label: '立即更新', onClick: doUpdate });
        }).catch(function () { /* 静默失败 */ });
      });
    }
    setTimeout(autoCheckNew, 800);

    // 离线可用（仅 http(s) 下注册；file:// 与不支持的环境自动跳过）
    if ('serviceWorker' in navigator && location.protocol !== 'file:') {
      window.addEventListener('load', function () {
        navigator.serviceWorker.register('sw.js').catch(function () { /* 忽略 */ });
      });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
//（注：内容由AI生成）
