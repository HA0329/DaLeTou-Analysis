/* DltCore — 大乐透历史数据分析核心（纯计算，浏览器与 Node 通用） */
(function (global) {
  'use strict';

  var FRONT_MAX = 35;
  var BACK_MAX = 12;

  function computeAll(raw) {
    // raw: 数组，每项 [issue, date, front[5], back[2]]，按开奖期号从新到旧排列
    var n = raw.length;
    var chrono = raw.slice().reverse(); // 从旧到新

    var freqFront = new Array(FRONT_MAX + 1).fill(0);
    var freqBack = new Array(BACK_MAX + 1).fill(0);

    var sums = [];            // 每期前区和值（chrono 顺序）
    var oddCounts = [];       // 每期前区奇数个数
    var bigCounts = [];       // 每期前区大号(18-35)个数
    var zoneCounts = [];      // 每期前区三区分布 [一区1-12, 二区13-24, 三区25-35]
    var consecInfo = [];      // 每期连号信息 {has:bool, groups:number}
    var backPairFreq = {};    // 后区两码组合频次 "a,b"
    var frontPairFreq = {};   // 前区两码组合频次
    var frontTripleFreq = {}; // 前区三码组合频次

    var i, j, d, f, b;

    for (i = 0; i < n; i++) {
      d = chrono[i];
      f = d[2];
      b = d[3];
      var sum = 0, odd = 0, big = 0;
      var z1 = 0, z2 = 0, z3 = 0;
      for (j = 0; j < f.length; j++) {
        var v = f[j];
        freqFront[v]++;
        sum += v;
        if (v % 2 === 1) odd++;
        if (v >= 18) big++;
        if (v <= 12) z1++; else if (v <= 24) z2++; else z3++;
      }
      for (j = 0; j < b.length; j++) freqBack[b[j]]++;

      sums.push(sum);
      oddCounts.push(odd);
      bigCounts.push(big);
      zoneCounts.push([z1, z2, z3]);

      // 前区连号（相邻号码差1）
      var groups = 0, inRun = false;
      for (j = 1; j < f.length; j++) {
        if (f[j] - f[j - 1] === 1) {
          if (!inRun) { groups++; inRun = true; }
        } else inRun = false;
      }
      consecInfo.push({ has: groups > 0, groups: groups });

      // 组合频次
      var bpKey = b[0] < b[1] ? b[0] + ',' + b[1] : b[1] + ',' + b[0];
      backPairFreq[bpKey] = (backPairFreq[bpKey] || 0) + 1;
      for (j = 0; j < 5; j++) {
        for (var k = j + 1; k < 5; k++) {
          var pk = f[j] < f[k] ? f[j] + ',' + f[k] : f[k] + ',' + f[j];
          frontPairFreq[pk] = (frontPairFreq[pk] || 0) + 1;
        }
      }
      for (j = 0; j < 5; j++) {
        for (var k2 = j + 1; k2 < 5; k2++) {
          for (var l = k2 + 1; l < 5; l++) {
            var t = [f[j], f[k2], f[l]].sort(function (a, b2) { return a - b2; });
            var tk = t.join(',');
            frontTripleFreq[tk] = (frontTripleFreq[tk] || 0) + 1;
          }
        }
      }
    }

    // ---- 遗漏分析（按从新到旧找第一次出现位置） ----
    function omissionFor(maxNum, freqArr, zoneIdx) {
      var cur = new Array(maxNum + 1).fill(n);       // 当前遗漏（期）
      var gaps = new Array(maxNum + 1).fill(null).map(function () { return []; });
      var firstSeen = new Array(maxNum + 1).fill(null);
      var prevPos = new Array(maxNum + 1).fill(-1);
      // 当前遗漏：从最新一期往回数，第一次出现的期号即当前遗漏
      for (i = 0; i < n; i++) {
        var nums = raw[i][zoneIdx];
        for (j = 0; j < nums.length; j++) {
          var v = nums[j];
          if (cur[v] === n) cur[v] = i;
        }
      }
      // 间隔：从旧到新统计相邻两次出现的间隔期数
      for (i = 0; i < n; i++) {
        var nums2 = chrono[i][zoneIdx];
        for (j = 0; j < nums2.length; j++) {
          var v2 = nums2[j];
          if (firstSeen[v2] === null) firstSeen[v2] = i;
          if (prevPos[v2] !== -1) gaps[v2].push(i - prevPos[v2] - 1);
          prevPos[v2] = i;
        }
      }
      var out = [];
      for (var num = 1; num <= maxNum; num++) {
        var cnt = freqArr[num];
        var g = gaps[num];
        var avg = g.length
          ? g.reduce(function (a, c) { return a + c; }, 0) / g.length
          : (firstSeen[num] === null ? 0 : n - 1 - firstSeen[num]);
        var mx = g.length ? Math.max.apply(null, g) : 0;
        out.push({
          num: num,
          count: cnt,
          freq: +(cnt / n * 100).toFixed(2),
          curOmit: cur[num] === n ? n : cur[num],
          avgOmit: +avg.toFixed(1),
          maxOmit: mx
        });
      }
      return out;
    }

    var frontOmit = omissionFor(FRONT_MAX, freqFront, 2);
    var backOmit = omissionFor(BACK_MAX, freqBack, 3);

    // ---- 和值统计 ----
    var sumStats = {
      min: Math.min.apply(null, sums),
      max: Math.max.apply(null, sums),
      avg: +(sums.reduce(function (a, c) { return a + c; }, 0) / n).toFixed(1),
      median: (function () {
        var s = sums.slice().sort(function (a, b) { return a - b; });
        var mid = Math.floor(s.length / 2);
        return s.length % 2 ? s[mid] : +((s[mid - 1] + s[mid]) / 2).toFixed(1);
      })()
    };
    var sumHist = {};
    for (i = 0; i < sums.length; i++) sumHist[sums[i]] = (sumHist[sums[i]] || 0) + 1;

    // 和值均线（MA5 / MA20 / MA50）
    function movingAvg(arr, w) {
      var out = new Array(arr.length).fill(null);
      var acc = 0;
      for (i = 0; i < arr.length; i++) {
        acc += arr[i];
        if (i >= w) acc -= arr[i - w];
        if (i >= w - 1) out[i] = +(acc / w).toFixed(1);
      }
      return out;
    }
    var sumMA5 = movingAvg(sums, 5);
    var sumMA20 = movingAvg(sums, 20);
    var sumMA50 = movingAvg(sums, 50);

    // ---- 结构分布 ----
    function distCounts(arr) {
      var o = {};
      for (i = 0; i < arr.length; i++) o[arr[i]] = (o[arr[i]] || 0) + 1;
      return o;
    }
    var oddDist = distCounts(oddCounts);
    var bigDist = distCounts(bigCounts);

    var zoneTotal = [0, 0, 0];
    var zonePatternFreq = {};
    for (i = 0; i < zoneCounts.length; i++) {
      zoneTotal[0] += zoneCounts[i][0];
      zoneTotal[1] += zoneCounts[i][1];
      zoneTotal[2] += zoneCounts[i][2];
      var pk = zoneCounts[i].join(':');
      zonePatternFreq[pk] = (zonePatternFreq[pk] || 0) + 1;
    }

    // ---- 连号 ----
    var consec = {
      hasCount: 0,
      groupTotal: 0,
      groupDist: {}
    };
    for (i = 0; i < consecInfo.length; i++) {
      if (consecInfo[i].has) consec.hasCount++;
      consec.groupTotal += consecInfo[i].groups;
      var gk = consecInfo[i].groups;
      consec.groupDist[gk] = (consec.groupDist[gk] || 0) + 1;
    }
    consec.avgGroups = +(consec.groupTotal / n).toFixed(3);

    // ---- 排序后的频次列表 ----
    function freqList(maxNum, freqArr) {
      var l = [];
      for (var num = 1; num <= maxNum; num++) l.push({ num: num, count: freqArr[num] });
      return l;
    }
    var frontFreqList = freqList(FRONT_MAX, freqFront).sort(function (a, b) { return b.count - a.count; });
    var backFreqList = freqList(BACK_MAX, freqBack).sort(function (a, b) { return b.count - a.count; });

    // ---- 组合排行 ----
    function topFromMap(map, k, valFmt) {
      var arr = Object.keys(map).map(function (key) {
        return { key: key, count: map[key] };
      });
      arr.sort(function (a, b) { return b.count - a.count || (a.key < b.key ? -1 : 1); });
      return arr.slice(0, k);
    }

    return {
      n: n,
      firstDraw: chrono[0],   // [issue, date, front, back]
      lastDraw: raw[0],
      frontFreq: freqFront,
      backFreq: freqBack,
      frontFreqList: frontFreqList,
      backFreqList: backFreqList,
      frontOmit: frontOmit,
      backOmit: backOmit,
      sums: sums,
      sumStats: sumStats,
      sumHist: sumHist,
      sumMA5: sumMA5,
      sumMA20: sumMA20,
      sumMA50: sumMA50,
      oddDist: oddDist,
      bigDist: bigDist,
      zoneTotal: zoneTotal,
      zonePatternFreq: zonePatternFreq,
      consec: consec,
      frontPairTop: topFromMap(frontPairFreq, 20),
      frontTripleTop: topFromMap(frontTripleFreq, 20),
      backPairTop: topFromMap(backPairFreq, 15),
      raw: raw,
      chrono: chrono
    };
  }

  global.DltCore = { computeAll: computeAll };
})(typeof window !== 'undefined' ? window : globalThis);



/* DltUI — 页面渲染与交互（含在线数据更新） */
(function () {
  'use strict';

  var CACHE_KEY = 'dlt_analysis_cache_v2';   // v2：数据格式含每期销量与开奖公告（各奖级注数/单注奖金）
  var PAGE_SIZE = 100;

  if (!RAW_DATA || !RAW_DATA.length) {
    document.body.insertAdjacentHTML('afterbegin', '<p style="padding:20px;color:red;">数据加载失败：未找到同目录 data.js 数据文件（或 RAW_DATA 为空）。请确认 data.js 与页面在同一目录，或运行 node update.js 重新生成。</p>');
    return;
  }

  var S = null;          // 当前统计数据
  var state = { rows: null, meta: null };   // 当前数据与来源
  var btnBusy = false;

  // ---------- 基础工具 ----------
  function $(id) { return document.getElementById(id); }
  function pad2(n) { return n < 10 ? '0' + n : '' + n; }
  function ball(n, zone, sm, title) { return '<span class="ball ' + (zone === 'f' ? 'f' : 'b') + (sm ? ' sm' : '') + '"' + (title ? ' title="' + title + '"' : '') + '>' + pad2(n) + '</span>'; }
  function balls(arr, zone, sm) { return arr.map(function (n) { return ball(n, zone, sm); }).join(''); }
  function fmtPct(x) { return (x * 100).toFixed(2) + '%'; }

  // 金额格式化：万 / 亿
  function fmtMoney(n) {
    if (!n || n <= 0) return '—';
    if (n >= 100000000) return (n / 100000000).toFixed(2) + ' 亿元';
    if (n >= 10000) return (n / 10000).toFixed(1) + ' 万元';
    return n.toLocaleString('zh-CN') + ' 元';
  }
  function fmtYi(n) { return (n / 100000000).toFixed(2) + ' 亿'; }
  function fmtNum(n) { return n ? Number(n).toLocaleString('zh-CN') : '—'; }

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

  // ---------- 数据源：缓存 / 内置 / 在线 ----------
  function readCache() {
    try {
      var c = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
      if (c && Array.isArray(c.rows) && c.rows.length >= 100) return c;
    } catch (e) { /* localStorage 不可用时忽略 */ }
    return null;
  }
  function writeCache(rows, fetchedAt) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ fetchedAt: fetchedAt, rows: rows })); }
    catch (e) {
      // localStorage 容量不足（QuotaExceededError，部分浏览器上限 5MB，2916 期 ≈ 2–3MB 已接近上限）等：
      // 缓存失败不影响本次使用（页面仍使用内存中的最新数据），仅提示用户清理，避免静默失败。
      if (e && (e.name === 'QuotaExceededError' || e.code === 22 || e.code === 1014)) {
        toast('⚠️ 本地存储空间不足，最新数据未能缓存到本地（本次仍正常使用最新数据）。可点「恢复内置」清除旧缓存，或清理浏览器中本网站站点数据后重试', false);
      }
    }
  }
  function clearCache() {
    try { localStorage.removeItem(CACHE_KEY); } catch (e) {}
  }

  // 初始数据：若本地缓存比内置数据更新则用缓存，否则用内置
  function pickInitialRows() {
    var cache = readCache();
    if (cache && cache.rows.length >= RAW_DATA.length) {
      var a = (cache.rows[0] && cache.rows[0][0]) || '';
      var b = (RAW_DATA[0] && RAW_DATA[0][0]) || '';
      if (a >= b) return { rows: cache.rows, meta: { source: 'cache', fetchedAt: cache.fetchedAt } };
    }
    return { rows: RAW_DATA, meta: { source: 'builtin', fetchedAt: null } };
  }

  // 与 update.js 一致的校验逻辑（v2：含销量与开奖公告）
  // 单条官网记录 → 紧凑行（供增量抓取逐条转换）
  function toRow(it) {
    var nums = String(it.lotteryDrawResult).trim().split(/\s+/).filter(Boolean).map(Number);
    if (nums.length !== 7) throw new Error('期号 ' + it.lotteryDrawNum + ' 开奖号码异常：' + it.lotteryDrawResult);
    var pool = Number(String(it.poolBalanceAfterdraw || '0').replace(/,/g, '')) || 0; // 当期开奖后奖池，供中奖查询判定固定奖升级档
    var sales = Number(String(it.totalSaleAmount || '').replace(/,/g, '')) || 0;       // 本期销量（早期数据可能为空）
    var toNum = function (v) { var n = Number(String(v || '').replace(/,/g, '')); return Number.isFinite(n) && n > 0 ? n : 0; };
    var prizes = (it.prizeLevelList || []).map(function (p) {                          // 开奖公告：各奖级中奖注数与单注奖金（官网对无人中奖奖级返回 -1/--- 占位符，归一为 0）
      return [String(p.prizeLevel || ''), toNum(p.stakeCount), toNum(p.stakeAmountFormat) || toNum(p.stakeAmount)];
    }).filter(function (p) { return p[0]; });
    return [it.lotteryDrawNum, it.lotteryDrawTime, nums.slice(0, 5), nums.slice(5, 7), pool, sales, prizes];
  }
  // 校验：期号唯一、号码范围合法且升序
  function assertRowsValid(rows) {
    var seen = {};
    rows.forEach(function (r) {
      if (seen[r[0]]) throw new Error('期号重复：' + r[0]);
      seen[r[0]] = true;
      var f = r[2], b = r[3];
      for (var i = 0; i < 5; i++) if (f[i] < 1 || f[i] > 35 || (i > 0 && f[i] <= f[i - 1])) throw new Error('前区异常：' + r[0]);
      for (var j = 0; j < 2; j++) if (b[j] < 1 || b[j] > 12 || (j > 0 && b[j] <= b[j - 1])) throw new Error('后区异常：' + r[0]);
    });
  }
  function toCompact(list) {
    var rows = list.map(toRow);
    assertRowsValid(rows);
    return rows;
  }

  // 数据接口统一走本地服务器代理（/dlt-api）：浏览器直连官网会因 HTTP/2 被其 CDN 拒绝（Failed to fetch），
  // 且官网强制校验 Referer / 受 CORS 限制；由 Node 端以 HTTP/1.1 代访官网即可全部规避。
  // 因此页面需通过「启动页面.bat」以 http://127.0.0.1:8123 打开；file:// 方式打开时自动回退到该地址。
  var API_BASE = (location.protocol === 'file:' ? 'http://127.0.0.1:8123' : location.origin) + '/dlt-api';
  var SAVE_URL = (location.protocol === 'file:' ? 'http://127.0.0.1:8123' : location.origin) + '/save-data';
  function fetchJson(url) { return tryFetch(url, 0); }
  function tryFetch(url, n) {
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 20000) : null;
    return fetch(url, {
      headers: { 'Accept': 'application/json, text/javascript, */*; q=0.01' },
      signal: ctrl ? ctrl.signal : undefined
    }).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    }).catch(function (e) {
      if (n < 2) {
        return new Promise(function (r) { setTimeout(r, 600 * (n + 1)); }).then(function () { return tryFetch(url, n + 1); });
      }
      throw e;
    }).finally(function () { if (timer) clearTimeout(timer); });
  }

  // 增量抓取：官网接口按「最新在前」分页返回，抓取过程中一旦遇到已存在的期号即可停止，
  // 只拉取缺失的新期次，不再每次从最新一页一路翻到最早一页（全量约 29 页 → 通常仅需 1 页）。
  // existingSet：当前已有期号集合（可选，传 null 则全量抓取）；maxPages：最多抓取页数（可选）
  // 返回 { list, total, stopped }：list 为抓取到的新数据（最新在前），total 为官网数据总期数，
  // stopped 表示是否因遇到已存在的期号而提前停止（供调用方做「跳期」兜底判断）。
  async function fetchAllFromApi(existingSet, onProgress, maxPages) {
    var all = [], page = 1, total = null, stopped = false;
    while (true) {
      var url = API_BASE + '?gameNo=85&provinceId=0&pageSize=' + PAGE_SIZE + '&isVerify=1&pageNo=' + page;
      var j = await fetchJson(url);
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
    $('updateBar').hidden = !running;
    if (running) {
      $('updateFill').style.width = Math.max(1, Math.min(100, pct)) + '%';
      $('updateText').textContent = text;
    }
  }

  // 新数据（最新在前）与已有数据合并，按期号去重后整体校验
  function mergeNewRows(newRows, oldRows) {
    var seen = {};
    oldRows.forEach(function (r) { seen[r[0]] = true; });
    var rows = newRows.filter(function (r) { return !seen[r[0]]; }).concat(oldRows);
    assertRowsValid(rows);
    return rows;
  }

  async function doUpdate() {
    if (btnBusy) return;
    btnBusy = true;
    setUpdateUI(true, 2, '正在连接中国体育彩票官网…');
    try {
      var existing = state.rows;
      var existingSet = {};
      existing.forEach(function (r) { existingSet[r[0]] = true; });
      var res = await fetchAllFromApi(existingSet, function (done, total, stopped) {
        setUpdateUI(true, stopped ? 100 : (total ? Math.round(done / total * 100) : 6), '已获取 ' + done + ' 期新数据（仅拉取缺失期次）');
      });
      var list = res.list;
      var fullList = false;   // 全量重建时 list 已是完整数据（最新在前），不能再按「新 + 旧」拼接
      // 兜底：增量抓取在遇到已存在期号时停止；若此时官网总期数仍多于「本地 + 本次新增」，
      // 说明历史中间可能有跳期缺失（如官网某期未发布而漏补），改为全量重建一次性补全。
      if (res.stopped && res.total != null && res.total > existing.length + list.length) {
        setUpdateUI(true, 6, '检测到官网期号跳变（中间可能缺期），触发全量重建…');
        res = await fetchAllFromApi(null, function (done, total) {
          setUpdateUI(true, total ? Math.round(done / total * 100) : 6, '全量重建中：已获取 ' + done + ' / ' + total + ' 期');
        });
        list = res.list;
        fullList = true;
      }
      var now = Date.now();
      if (!list.length) {
        toast('✅ 已是最新：第 ' + existing[0][0] + ' 期（' + existing[0][1] + '），无需更新', true);
        return;
      }
      var rows = fullList ? toCompact(list) : mergeNewRows(toCompact(list), existing);
      applyRows(rows, { source: 'online', fetchedAt: now });
      writeCache(rows, now);
      toast('✅ 新增 ' + (rows.length - existing.length) + ' 期，已更新至第 ' + rows[0][0] + ' 期（' + rows[0][1] + '），共 ' + rows.length + ' 期，已缓存到本地', true);
    } catch (e) {
      var msg = e.message;
      if (e instanceof TypeError || /failed to fetch/i.test(msg)) {
        msg = '浏览器禁止 file:// 页面跨域请求。请通过「启动页面.bat」打开本页（本地服务器模式）后再点在线更新';
      }
      toast('❌ 更新失败：' + msg + '（或点“恢复内置”）', false);
    } finally {
      btnBusy = false;
      setUpdateUI(false);
    }
  }

  // 「💾 更新并写入数据文件」：抓取最新数据 → 校验 → 由本地服务器写回同目录 data.js
  async function doSaveData() {
    if (btnBusy) return;
    btnBusy = true;
    setUpdateUI(true, 2, '正在连接中国体育彩票官网…');
    try {
      var existing = state.rows;
      var existingSet = {};
      existing.forEach(function (r) { existingSet[r[0]] = true; });
      var res = await fetchAllFromApi(existingSet, function (done, total, stopped) {
        setUpdateUI(true, stopped ? 100 : (total ? Math.round(done / total * 100) : 6), '已获取 ' + done + ' 期新数据（仅拉取缺失期次）');
      });
      var list = res.list;
      var fullList = false;   // 全量重建时 list 已是完整数据（最新在前），不能再按「新 + 旧」拼接
      // 兜底：同「在线更新」——官网总期数多于「本地 + 本次新增」时说明中间跳期，全量重建补全
      if (res.stopped && res.total != null && res.total > existing.length + list.length) {
        setUpdateUI(true, 6, '检测到官网期号跳变（中间可能缺期），触发全量重建…');
        res = await fetchAllFromApi(null, function (done, total) {
          setUpdateUI(true, total ? Math.round(done / total * 100) : 6, '全量重建中：已获取 ' + done + ' / ' + total + ' 期');
        });
        list = res.list;
        fullList = true;
      }
      var now = Date.now();
      if (!list.length) {
        toast('✅ 已是最新：第 ' + existing[0][0] + ' 期（' + existing[0][1] + '），HTML 无需更新', true);
        return;
      }
      var rows = fullList ? toCompact(list) : mergeNewRows(toCompact(list), existing);
      // 请求本地服务器把数据写回 data.js（浏览器无文件写权限）
      var resp = await fetch(SAVE_URL, {
        method: 'POST',
        body: JSON.stringify(rows)
      });
      var j = await resp.json();
      if (!resp.ok || !j.ok) throw new Error(j.error || ('HTTP ' + resp.status));
      applyRows(rows, { source: 'online', fetchedAt: now });
      writeCache(rows, now);
      toast('✅ 新增 ' + (rows.length - existing.length) + ' 期并写入 data.js：已更新至第 ' + rows[0][0] + ' 期，共 ' + rows.length + ' 期', true);
    } catch (e) {
      var msg = e.message;
      if (e instanceof TypeError || /failed to fetch/i.test(msg)) {
        msg = '请通过「启动页面.bat」打开本页（本地服务器模式）后再使用「更新并写入数据文件」';
      }
      toast('❌ 写入失败：' + msg, false);
    } finally {
      btnBusy = false;
      setUpdateUI(false);
    }
  }

  function doReset() {
    clearCache();
    applyRows(RAW_DATA, { source: 'builtin', fetchedAt: null });
    toast('已恢复数据文件内置数据（' + RAW_DATA.length + ' 期）', true);
  }

  function updateChip() {
    var m = state.meta, rows = state.rows;
    var srcName = m.source === 'online' ? '在线数据' : m.source === 'cache' ? '本地缓存' : '内置数据';
    var chip = $('dataChip');
    chip.textContent = srcName + ' · ' + rows.length + ' 期';
    chip.className = 'data-chip ' + m.source;
    chip.title = '数据来源：' + srcName + '；最新一期：第 ' + rows[0][0] + ' 期（' + rows[0][1] + '）' +
      (m.fetchedAt ? '；更新时间：' + fmtTime(m.fetchedAt) : '');
  }

  function applyRows(rows, meta) {
    state.rows = rows;
    state.meta = meta;
    window.DLT_CURRENT_ROWS = rows;   // 供中奖查询等模块读取当前数据（含在线更新后的最新数据）
    S = DltCore.computeAll(rows);
    renderAll();
    updateChip();
  }

  // ---------- 概览卡片 ----------
  function buildOverview() {
    var first = S.firstDraw, last = S.lastDraw;
    var years = ((new Date(last[1]) - new Date(first[1])) / (365.25 * 24 * 3600 * 1000)).toFixed(1);
    var hot3f = S.frontFreqList.slice(0, 3);
    var hot3b = S.backFreqList.slice(0, 3);
    var fmax = S.frontOmit.reduce(function (a, b) { return b.curOmit > a.curOmit ? b : a; });
    var bmax = S.backOmit.reduce(function (a, b) { return b.curOmit > a.curOmit ? b : a; });
    var sumLo = S.sumStats.min, sumHi = S.sumStats.max;
    var sumMid = 0;
    for (var s = 80; s <= 110; s++) sumMid += S.sumHist[s] || 0;

    var cards = [
      { k: '数据总期数', v: S.n + ' 期', s: '第 ' + first[0] + ' 期 至 第 ' + last[0] + ' 期' },
      { k: '时间跨度', v: first[1].slice(0, 4) + ' ~ ' + last[1].slice(0, 4), s: '约 ' + years + ' 年' },
      { k: '前区平均和值', v: S.sumStats.avg, s: '和值区间 ' + sumLo + ' ~ ' + sumHi + '，中位数 ' + S.sumStats.median },
      { k: '前区热号 TOP3', v: balls(hot3f.map(function (x) { return x.num; }), 'f'), s: '分别出现 ' + hot3f.map(function (x) { return x.count + ' 次'; }).join(' / ') },
      { k: '后区热号 TOP3', v: balls(hot3b.map(function (x) { return x.num; }), 'b'), s: '分别出现 ' + hot3b.map(function (x) { return x.count + ' 次'; }).join(' / ') },
      { k: '当前遗漏最大', v: ball(fmax.num, 'f', true) + ' ' + ball(bmax.num, 'b', true), s: '前区 ' + fmax.num + ' 已 ' + fmax.curOmit + ' 期未出，后区 ' + bmax.num + ' 已 ' + bmax.curOmit + ' 期未出' }
    ];
    $('overview').innerHTML = cards.map(function (c) {
      return '<div class="card"><div class="k">' + c.k + '</div><div class="v">' + c.v + '</div><div class="s">' + c.s + '</div></div>';
    }).join('');
  }

  // ---------- 页头与最新一期（奖池 / 销量 / 倒计时 / 开奖公告） ----------
  var WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  function weekdayName(dateStr) { return WEEKDAYS[new Date(dateStr).getDay()]; }
  function numStatTitle(zone, num) {
    var o = (zone === 'f' ? S.frontOmit : S.backOmit)[num - 1];
    return '号码 ' + pad2(num) + '：出现 ' + o.count + ' 次（' + o.freq + '%）· 当前遗漏 ' + o.curOmit + ' 期 · 平均遗漏 ' + o.avgOmit + ' 期';
  }

  // 距下次开奖（周一/三/六 21:25）倒计时
  function nextDrawInfo() {
    var now = new Date();
    for (var i = 0; i < 7; i++) {
      var d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
      if (d.getDay() === 1 || d.getDay() === 3 || d.getDay() === 6) {
        var t = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 21, 25, 0, 0);
        if (t.getTime() > now.getTime()) {
          return { time: t, label: d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + '（' + WEEKDAYS[d.getDay()] + '）' };
        }
      }
    }
    return null;
  }
  var countdownTimer = null;
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

  // 该期开奖前奖池（决定固定奖兑付档位）= 上一期开奖后滚存
  function prePoolOf(draw) {
    var rows = state.rows;
    for (var i = 0; i < rows.length; i++) {
      if (rows[i][0] === draw[0]) {
        var prev = rows[i + 1];
        return prev ? (Number(prev[4]) || 0) : (Number(draw[4]) || 0);
      }
    }
    return Number(draw[4]) || 0;
  }
  // 开奖公告表（各奖级中奖注数 / 单注奖金 / 小计）
  function buildAnnounceHTML(draw, extra) {
    var prizes = draw[6] || [];
    var pre = prePoolOf(draw);        // 开奖前奖池 → 决定该期固定奖档位
    var after = Number(draw[4]) || 0; // 开奖后滚存
    var upgraded = pre >= 800000000;
    if (!prizes.length) {
      return '<p class="rules-note">该期开奖公告数据缺失（data.js 未包含），请点击顶部「🔄 在线更新」获取完整公告。</p>';
    }
    var html = '<table class="prize-table"><thead><tr><th>奖级</th><th>中奖注数</th><th>单注奖金</th><th>小计</th>' + (extra ? '<th>备注</th>' : '') + '</tr></thead><tbody>';
    var totalCount = 0, totalMoney = 0;
    prizes.forEach(function (p) {
      var name = p[0], cnt = p[1], amt = p[2];
      var sub = cnt * amt;
      totalCount += cnt; totalMoney += sub;
      var note = extra && /一等奖/.test(name) ? '浮动奖金（按当期销量与奖池计算）' : '';
      html += '<tr><td>' + name + '</td><td>' + fmtNum(cnt) + '</td><td>' + (amt > 0 ? (amt >= 10000 ? (amt / 10000).toFixed(1) + ' 万元' : amt.toLocaleString('zh-CN') + ' 元') : '—') + '</td><td>' + fmtNum(sub) + ' 元</td>' + (extra ? '<td class="dim">' + note + '</td>' : '') + '</tr>';
    });
    html += '<tr class="tt"><td>合计</td><td>' + fmtNum(totalCount) + ' 注</td><td>—</td><td>' + fmtNum(totalMoney) + ' 元</td>' + (extra ? '<td></td>' : '') + '</tr></tbody></table>';
    html += '<p class="rules-note">' + (upgraded ? '该期开奖前奖池 ' + fmtYi(pre) + '（≥8亿），三至七等奖按升级档兑付。' : '该期开奖前奖池 ' + fmtYi(pre) + '（&lt;8亿），固定奖按基本档兑付。') + (after ? '开奖后滚存 ' + fmtYi(after) + '。' : '') + '金额以中国体育彩票官网开奖公告为准。</p>';
    return html;
  }

  function buildLatest() {
    var last = S.lastDraw;
    $('heroSub').textContent =
      '数据范围：第 ' + S.firstDraw[0] + ' 期（' + S.firstDraw[1] + '）~ 第 ' + last[0] + ' 期（' + last[1] + '），共 ' + S.n + ' 期 · 数据来源：中国体育彩票官网';
    var fb = last[2].map(function (n) { return ball(n, 'f', false, numStatTitle('f', n)); }).join('');
    var bb = last[3].map(function (n) { return ball(n, 'b', false, numStatTitle('b', n)); }).join('');
    $('latestDraw').innerHTML =
      '<span class="info">第 ' + last[0] + ' 期 · ' + last[1] + '（' + weekdayName(last[1]) + '）</span>' +
      fb + '<span style="margin:0 2px;color:#c9ced8;">|</span>' + bb +
      '<button class="btn btn-ghost btn-sm act" id="btnCopyLatest" title="复制最新一期开奖号码">📋 复制</button>';
    $('btnCopyLatest').addEventListener('click', function () {
      copyText('第 ' + last[0] + ' 期（' + last[1] + '）：前区 ' + last[2].map(pad2).join(' ') + ' 后区 ' + last[3].map(pad2).join(' '), '已复制最新开奖号码');
    });

    var pool = Number(last[4]) || 0;
    var sales = Number(last[5]) || 0;
    var upgraded = pool >= 800000000;
    var next = nextDrawInfo();
    $('latestExtra').innerHTML =
      '<div class="lex' + (upgraded ? ' up' : '') + '"><div class="k">💰 当前奖池（开奖后滚存）</div><div class="v' + (upgraded ? ' big' : '') + '">' + (pool ? fmtYi(pool) : '—') + '</div><div class="s">' + (upgraded ? '≥8亿：下一期固定奖按升级档兑付' : '&lt;8亿：下一期固定奖按基本档兑付') + '</div></div>' +
      '<div class="lex"><div class="k">本期销量</div><div class="v">' + (sales ? fmtYi(sales) : '—') + '</div><div class="s">' + (sales ? fmtNum(sales) + ' 元' : '早期数据未公布销量') + '</div></div>' +
      '<div class="lex warm"><div class="k">下一期预计</div><div class="v">第 ' + String(Number(last[0]) + 1) + ' 期</div><div class="s">' + (next ? next.label : '') + ' 21:25 开奖</div></div>' +
      '<div class="lex warm"><div class="k">⏳ 距下次开奖</div><div class="v countdown" id="countdown">计算中…</div><div class="s" id="countdownSub"></div></div>';
    startCountdown(next);

    $('latestAnnounce').innerHTML = buildAnnounceHTML(last, true);
    checkStale();
  }

  // 数据过期检测：若最新一期早于官网最近一个开奖日，提示用户在线更新
  function checkStale() {
    var el = $('staleNote');
    var last = S.lastDraw;
    var next = nextDrawInfo();
    if (!next) { el.hidden = true; return; }
    var prev = new Date(next.time.getTime());
    prev.setDate(prev.getDate() - (next.time.getDay() === 6 ? 3 : 2)); // 上一个开奖日：周一←周六、周三←周一、周六←周三
    prev.setHours(21, 25, 0, 0);
    var lastTime = new Date(last[1] + 'T21:25:00');
    if (lastTime.getTime() < prev.getTime()) {
      el.hidden = false;
      el.innerHTML = '⚠️ <b>数据可能不是最新</b>：当前最新一期为 <b>第 ' + last[0] + ' 期（' + last[1] + '）</b>，而官网最近一期开奖日应为 <b>' + prev.getFullYear() + '-' + pad2(prev.getMonth() + 1) + '-' + pad2(prev.getDate()) + '</b>。点击顶部「🔄 在线更新」即可同步最新数据。';
    } else {
      el.hidden = true;
    }
  }

  // ---------- 奖池走势（每期开奖后滚存，8亿升级线） ----------
  var poolRange = 'all';
  function buildPoolTrend() {
    var pools = state.rows.map(function (d) { return Number(d[4]) || 0; }); // 最新在前
    var valid = pools.filter(function (v) { return v > 0; });
    // 早期部分期次官网未公布奖池（按 0 计）：全部为 0 时避免 Math.max/reduce 在空数组上出错
    var max = valid.length ? Math.max.apply(null, valid) : 0;
    var min = valid.length ? Math.min.apply(null, valid) : 0;
    var avg = valid.length ? valid.reduce(function (a, c) { return a + c; }, 0) / valid.length : 0;
    var over8 = valid.filter(function (v) { return v >= 800000000; }).length;
    var cur = pools[0] || 0;
    $('poolCards').innerHTML = [
      { k: '当前奖池（最新一期开奖后）', v: cur ? fmtYi(cur) : '—', s: '第 ' + state.rows[0][0] + ' 期开奖后滚存', cls: cur >= 800000000 ? 'big' : '' },
      { k: '历史最高奖池', v: fmtYi(max), s: '历史最低 ' + fmtYi(min), cls: 'big' },
      { k: '平均奖池', v: fmtYi(avg), s: '共统计 ' + valid.length + ' 期', cls: '' },
      { k: '奖池 ≥ 8亿 的期数', v: over8 + ' 期', s: '占 ' + (valid.length ? fmtPct(over8 / valid.length) : '—') + '，固定奖升级档生效', cls: 'good' }
    ].map(function (c) {
      return '<div class="card"><div class="k">' + c.k + '</div><div class="v ' + (c.cls || '') + '">' + c.v + '</div><div class="s">' + c.s + '</div></div>';
    }).join('');
    drawPoolChart();
  }
  function drawPoolChart() {
    var labels = S.chrono.map(function (d) { return d[0]; });
    var data = S.chrono.map(function (d) { return (Number(d[4]) || 0) / 100000000; });
    if (poolRange !== 'all') {
      var k = +poolRange;
      data = data.slice(-k);
      labels = labels.slice(-k);
    }
    reg($('chartPool'), function () {
      lineChart($('chartPool'), {
        series: [{ data: data, color: '#2f6fd6', width: 1.4, name: '奖池 ', tipFmt: function (v) { return v.toFixed(2) + ' 亿'; } }],
        xLabels: labels,
        hoverIdx: hoverState['chartPool'],
        yFmt: function (v) { return v.toFixed(0) + '亿'; },
        hLines: [{ v: 8, color: '#c0392b', label: '8亿升级线' }]
      });
    });
  }
  $('poolRangeBar').addEventListener('change', function (ev) {
    if (ev.target.name === 'poolRange') { poolRange = ev.target.value; drawPoolChart(); }
  });

  // ---------- 号码走势图（近 N 期，点击号码查看统计） ----------
  var trendRange = 30;
  function buildTrendGrids() {
    var R = Math.min(trendRange, state.rows.length);
    var rows = state.rows.slice(0, R); // 最新在前
    $('trendFront').innerHTML = trendGridHTML(rows, 'f', 35);
    $('trendBack').innerHTML = trendGridHTML(rows, 'b', 12);
  }
  function trendGridHTML(rows, zone, maxNum) {
    var colTpl = '56px repeat(' + maxNum + ', 24px)';
    var h = '<div class="trend-head" style="grid-template-columns:' + colTpl + ';"><span class="tissue">期号</span>';
    for (var n = 1; n <= maxNum; n++) h += '<span class="tcell">' + pad2(n) + '</span>';
    h += '</div>';
    var body = '';
    rows.forEach(function (d) {
      var nums = d[zone === 'f' ? 2 : 3];
      var isSel = selNum && selNum.zone === zone;
      var cell = '';
      var ptr = 0;
      for (var n2 = 1; n2 <= maxNum; n2++) {
        if (ptr < nums.length && nums[ptr] === n2) {
          var hit = isSel && selNum.num === n2;
          cell += '<div class="tcell ' + zone + (hit ? ' sel-' + zone : '') + '" data-zone="' + zone + '" data-num="' + n2 + '" title="' + d[0] + ' 期 · 号码 ' + pad2(n2) + '：' + numStatTitle(zone, n2) + '"><span class="tb ' + zone + '">' + pad2(n2) + '</span></div>';
          ptr++;
        } else {
          cell += '<div class="tcell empty"></div>';
        }
      }
      body += '<div class="trend-row" style="grid-template-columns:' + colTpl + ';"><span class="tissue">' + d[0] + '</span>' + cell + '</div>';
    });
    return h + body;
  }
  function renderTrendDetail() {
    renderMatrixDetail($('trendDetail'));
  }
  function onTrendClick(ev) {
    var b = ev.target.closest('.tcell[data-num]');
    if (!b) return;
    selNum = { zone: b.dataset.zone, num: +b.dataset.num };
    buildTrendGrids();
    buildMatrix();        // 同步号码矩阵面板的选中态
    renderTrendDetail();
  }
  $('trendFront').addEventListener('click', onTrendClick);
  $('trendBack').addEventListener('click', onTrendClick);
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

  // ---------- 画布图表（含悬停） ----------
  function setupCanvas(canvas) {
    var dpr = window.devicePixelRatio || 1;
    var w = canvas.clientWidth || canvas.parentNode.clientWidth || 600;
    var h = parseInt(canvas.getAttribute('height'), 10) || 220;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx: ctx, w: w, h: h };
  }

  var hoverState = {}, chartCanvases = [];
  function reg(canvas, builder) {
    if (chartCanvases.indexOf(canvas) < 0) chartCanvases.push(canvas);
    canvas._redraw = function (idx) {
      if (idx !== undefined) hoverState[canvas.id] = idx;
      builder();
    };
    builder();
  }

  function barChart(canvas, opts) {
    var s = setupCanvas(canvas), ctx = s.ctx, w = s.w, h = s.h;
    var padL = 40, padR = 8, padT = 18, padB = 26;
    var labels = opts.labels, values = opts.values;
    var max = Math.max.apply(null, values) || 1;
    var yMax = opts.yMax || Math.ceil(max * 1.12);
    var plotW = w - padL - padR, plotH = h - padT - padB;
    var bw = plotW / labels.length;
    var barW = Math.min(bw * 0.66, 26);
    var hoverIdx = opts.hoverIdx;
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    var ticks = 4, t, i;
    for (t = 0; t <= ticks; t++) {
      var yv = yMax * t / ticks;
      var y = padT + plotH - plotH * t / ticks;
      ctx.strokeStyle = '#edf0f5';
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w - padR, y); ctx.stroke();
      ctx.fillStyle = '#9aa1ad';
      ctx.fillText(opts.yFmt ? opts.yFmt(yv) : String(Math.round(yv)), padL - 5, y);
    }
    ctx.textAlign = 'center';
    for (i = 0; i < labels.length; i++) {
      var x = padL + bw * i + bw / 2;
      var vh = plotH * values[i] / yMax;
      var color;
      if (opts.colors) color = typeof opts.colors === 'function' ? opts.colors(i, values[i]) : opts.colors[i % opts.colors.length];
      else color = '#e25b5b';
      var rx = x - barW / 2, ry = padT + plotH - vh;
      ctx.fillStyle = color;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(rx, ry, barW, Math.max(vh, 1), [3, 3, 0, 0]); else ctx.rect(rx, ry, barW, Math.max(vh, 1));
      ctx.fill();
      if (hoverIdx === i) {
        ctx.strokeStyle = '#20242e'; ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.lineWidth = 1;
      }
      if (opts.valueTop && bw >= 16 && vh > 10) {
        ctx.fillStyle = '#4a5160'; ctx.font = '9.5px sans-serif'; ctx.textBaseline = 'bottom';
        ctx.fillText(String(values[i]), x, ry - 2);
      }
      ctx.fillStyle = '#7a8291'; ctx.font = '10px sans-serif'; ctx.textBaseline = 'top';
      ctx.fillText(String(labels[i]), x, padT + plotH + 6);
    }
    ctx.textBaseline = 'alphabetic';
    canvas._dl = {
      kind: 'bar', labels: labels, values: values,
      padL: padL, plotW: plotW, bw: bw, tipFmt: opts.tipFmt
    };
  }

  function lineChart(canvas, opts) {
    var s = setupCanvas(canvas), ctx = s.ctx, w = s.w, h = s.h;
    var padL = 40, padR = 10, padT = 16, padB = 24;
    var series = opts.series;
    var n = series[0].data.length;
    var lo = Infinity, hi = -Infinity, i;
    series.forEach(function (se) {
      se.data.forEach(function (v) { if (v !== null && v !== undefined) { if (v < lo) lo = v; if (v > hi) hi = v; } });
    });
    if (!isFinite(lo)) { lo = 0; hi = 1; }
    var span = hi - lo || 1;
    var yMin = opts.yMin != null ? opts.yMin : Math.floor(lo - span * 0.12);
    var yMax = opts.yMax != null ? opts.yMax : Math.ceil(hi + span * 0.12);
    var plotW = w - padL - padR, plotH = h - padT - padB;
    function X(i) { return padL + plotW * (n <= 1 ? 0.5 : i / (n - 1)); }
    function Y(v) { return padT + plotH * (1 - (v - yMin) / (yMax - yMin)); }
    var hoverIdx = opts.hoverIdx;
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    var ticks = 4, t;
    for (t = 0; t <= ticks; t++) {
      var y = padT + plotH - plotH * t / ticks;
      ctx.strokeStyle = '#edf0f5';
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w - padR, y); ctx.stroke();
      ctx.fillStyle = '#9aa1ad';
      ctx.fillText(opts.yFmt ? opts.yFmt(yMin + (yMax - yMin) * t / ticks) : String(Math.round(yMin + (yMax - yMin) * t / ticks)), padL - 5, y);
    }
    // 参考线（如 8 亿升级线）
    (opts.hLines || []).forEach(function (hl) {
      var yv = Y(hl.v);
      if (yv < padT - 4 || yv > padT + plotH + 4) return;
      ctx.strokeStyle = hl.color || '#c0392b';
      ctx.lineWidth = 1.2;
      ctx.setLineDash([6, 4]);
      ctx.beginPath(); ctx.moveTo(padL, yv); ctx.lineTo(w - padR, yv); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = hl.color || '#c0392b';
      ctx.font = 'bold 10px sans-serif';
      ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
      ctx.fillText(hl.label || '', padL + 4, yv - 2);
      ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    });
    series.forEach(function (se) {
      ctx.strokeStyle = se.color; ctx.lineWidth = se.width || 1.6;
      if (se.dash) ctx.setLineDash(se.dash);
      ctx.beginPath();
      var started = false;
      for (i = 0; i < se.data.length; i++) {
        var v = se.data[i];
        if (v === null || v === undefined) { started = false; continue; }
        var x = X(i), y = Y(v);
        if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    });
    if (hoverIdx != null && hoverIdx >= 0 && hoverIdx < n) {
      var hx = X(hoverIdx);
      ctx.strokeStyle = 'rgba(32,36,46,.38)'; ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(hx, padT); ctx.lineTo(hx, padT + plotH); ctx.stroke();
      ctx.setLineDash([]);
      series.forEach(function (se) {
        var v = se.data[hoverIdx];
        if (v === null || v === undefined) return;
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(hx, Y(v), 3.2, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = se.color; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(hx, Y(v), 3.2, 0, Math.PI * 2); ctx.stroke();
        ctx.lineWidth = 1;
      });
    }
    if (opts.xLabels) {
      ctx.fillStyle = '#7a8291'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      var step = Math.max(1, Math.ceil(n / 8));
      for (i = 0; i < n; i += step) ctx.fillText(String(opts.xLabels[i]), X(i), padT + plotH + 7);
    }
    ctx.textBaseline = 'alphabetic';
    canvas._dl = {
      kind: 'line', series: series, n: n, xLabels: opts.xLabels,
      padL: padL, plotW: plotW
    };
  }

  function ma(arr, w) {
    var out = new Array(arr.length).fill(null);
    var acc = 0, i;
    for (i = 0; i < arr.length; i++) {
      acc += arr[i];
      if (i >= w) acc -= arr[i - w];
      if (i >= w - 1) out[i] = +(acc / w).toFixed(1);
    }
    return out;
  }

  // 全局悬停：命中 canvas._dl 显示 tooltip 并重绘高亮。
  // 每次 mousemove 都先清除「其它图表」的高亮与提示（当前命中图表除外），
  // 避免快速跨图表移动时上一个图表的 tip 残影不消失（旧逻辑仅在未命中任何图表时才统一清除）。
  document.addEventListener('mousemove', function (ev) {
    var cv = ev.target;
    var dl = cv && cv._dl ? cv._dl : null;
    chartCanvases.forEach(function (c) {
      if (c === cv) return;
      if (hoverState[c.id] != null && hoverState[c.id] >= 0) {
        hoverState[c.id] = -1;
        if (c._redraw) c._redraw(-1);
      }
      var tip = c.parentNode && c.parentNode.querySelector('.chart-tip');
      if (tip) tip.style.display = 'none';
    });
    if (!dl) return;
    var rect = cv.getBoundingClientRect();
    var x = ev.clientX - rect.left, y = ev.clientY - rect.top;
    var idx = -1, tip = '';
    if (dl.kind === 'bar') {
      var i = Math.floor((x - dl.padL) / dl.bw);
      if (i >= 0 && i < dl.labels.length && x >= dl.padL) {
        idx = i;
        tip = '<b>' + dl.labels[i] + '</b>：' + (dl.tipFmt ? dl.tipFmt(dl.values[i]) : dl.values[i]);
      }
    } else {
      var i2 = Math.round((x - dl.padL) / dl.plotW * (dl.n - 1));
      if (i2 >= 0 && i2 < dl.n && x >= dl.padL && x <= dl.padL + dl.plotW) {
        idx = i2;
        var parts = [];
        if (dl.xLabels) parts.push('<b>' + dl.xLabels[i2] + '</b>');
        dl.series.forEach(function (se) {
          var v = se.data[i2];
          if (v === null || v === undefined) return;
          parts.push('<span style="color:' + se.color + '">●</span> ' + (se.name ? se.name + ' ' : '') + (se.tipFmt ? se.tipFmt(v) : v));
        });
        tip = parts.join('　');
      }
    }
    if (hoverState[cv.id] !== idx) {
      hoverState[cv.id] = idx;
      if (cv._redraw) cv._redraw(idx);
    }
    var tipEl = cv.parentNode && cv.parentNode.querySelector('.chart-tip');
    if (!tipEl) return;
    if (idx >= 0) {
      tipEl.innerHTML = tip;
      tipEl.style.display = 'block';
      var boxW = cv.parentNode.clientWidth;
      var tx = x + 14, ty = y - 8;
      if (tx + tipEl.offsetWidth > boxW - 4) tx = boxW - tipEl.offsetWidth - 4;
      tipEl.style.left = Math.max(2, tx) + 'px';
      tipEl.style.top = Math.max(2, ty) + 'px';
    } else {
      tipEl.style.display = 'none';
    }
  });

  // ---------- 频次图 ----------
  function drawFreqCharts() {
    var hotFrontSet = {};
    S.frontFreqList.slice(0, 3).forEach(function (x) { hotFrontSet[x.num] = true; });
    var fl = [], fv = [], i;
    for (i = 1; i <= 35; i++) { fl.push(pad2(i)); fv.push(S.frontFreq[i]); }
    reg($('chartFrontFreq'), function () {
      barChart($('chartFrontFreq'), {
        labels: fl, values: fv, valueTop: true, hoverIdx: hoverState['chartFrontFreq'],
        colors: function (idx) { return hotFrontSet[idx + 1] ? '#c22a2a' : '#e98a8a'; }
      });
    });
    var bl = [], bv = [];
    for (i = 1; i <= 12; i++) { bl.push(pad2(i)); bv.push(S.backFreq[i]); }
    reg($('chartBackFreq'), function () {
      barChart($('chartBackFreq'), {
        labels: bl, values: bv, valueTop: true, hoverIdx: hoverState['chartBackFreq'],
        colors: function (idx) { return idx < 3 ? '#1f56b0' : '#6f9ce0'; }
      });
    });
  }

  // ---------- 热冷号排行 ----------
  function buildHotCold() {
    function rankList(arr, zone, cnt) {
      return '<ul class="rank-list">' + arr.map(function (x, i) {
        return '<li><span class="rk">' + (i + 1) + '</span>' + ball(x.num, zone, true) + '<span style="font-weight:600;">' + pad2(x.num) + '</span><span class="cnt">' + x.count + ' 次 / ' + (x.count / S.n * 100).toFixed(2) + '%</span></li>';
      }).join('') + '</ul>';
    }
    $('frontHotList').innerHTML = rankList(S.frontFreqList.slice(0, 10), 'f');
    $('frontColdList').innerHTML = rankList(S.frontFreqList.slice(-10).reverse(), 'f');
  }

  // ---------- 和值走势 ----------
  var sumRange = 'all';
  function drawSumChart() {
    var labels = S.chrono.map(function (d) { return d[0]; });
    var data = S.sums, ma20, ma50;
    if (sumRange === 'all') {
      ma20 = S.sumMA20; ma50 = S.sumMA50;
    } else {
      var k = +sumRange;
      data = S.sums.slice(-k);
      labels = labels.slice(-k);
      ma20 = ma(data, 20);
      ma50 = ma(data, 50);
    }
    reg($('chartSum'), function () {
      lineChart($('chartSum'), {
        series: [
          { data: data, color: '#e23a3a', width: 1.1, name: '和值 ' },
          { data: ma20, color: '#f39c12', width: 1.5, name: 'MA20 ' },
          { data: ma50, color: '#2f6fd6', width: 1.5, dash: [5, 4], name: 'MA50 ' }
        ],
        xLabels: labels,
        hoverIdx: hoverState['chartSum']
      });
    });
  }

  // ---------- 分布图 ----------
  function drawDistCharts() {
    // 和值档位（5 点一档）
    var hist = S.sumHist;
    var min = Math.floor(S.sumStats.min / 5) * 5;
    var max = Math.ceil(S.sumStats.max / 5) * 5;
    var labels = [], values = [], i, b;
    var peak = 0;
    for (b = min; b < max; b += 5) {
      var c = 0;
      for (i = b; i < b + 5; i++) c += hist[i] || 0;
      labels.push(b + '-' + (b + 4));
      values.push(c);
      if (c > peak) peak = c;
    }
    reg($('chartSumHist'), function () {
      barChart($('chartSumHist'), {
        labels: labels, values: values, valueTop: true, hoverIdx: hoverState['chartSumHist'],
        colors: function (idx, v) { return v >= peak * 0.5 ? '#e25b5b' : '#f0b6b6'; }
      });
    });

    function distChart(elId, dist, prefix, colors) {
      var labs = [], vals = [];
      for (var k = 0; k <= 5; k++) { labs.push(k + prefix); vals.push(dist[k] || 0); }
      reg($(elId), function () {
        barChart($(elId), {
          labels: labs, values: vals, valueTop: true, hoverIdx: hoverState[elId],
          colors: function (idx) { return colors[idx]; }
        });
      });
    }
    distChart('chartOdd', S.oddDist, '奇', ['#dbe6f7', '#b9cff0', '#8fb1e5', '#5f8fd8', '#2f6fd6', '#1f56b0']);
    distChart('chartBig', S.bigDist, '大', ['#fbe3e3', '#f8c9c9', '#f0a3a3', '#e57474', '#d84343', '#c22a2a']);

    // 三区
    var zt = S.zoneTotal, zlabels = ['一区 01-12', '二区 13-24', '三区 25-35'];
    reg($('chartZone'), function () {
      barChart($('chartZone'), {
        labels: zlabels,
        values: [zt[0] / S.n, zt[1] / S.n, zt[2] / S.n],
        yFmt: function (v) { return v.toFixed(1); },
        tipFmt: function (v) { return v.toFixed(2) + ' 个/期'; },
        valueTop: true,
        hoverIdx: hoverState['chartZone'],
        colors: ['#2f6fd6', '#e23a3a', '#e9a23b']
      });
    });
  }

  // ---------- 遗漏表格 ----------
  var omitSort = {
    front: { key: 'num', asc: true },
    back: { key: 'num', asc: true }
  };

  function omitTable(elId, list, zone, state2) {
    var key = state2.key, asc = state2.asc;
    var rows = list.slice().sort(function (a, b) {
      var va = a[key], vb = b[key];
      return asc ? va - vb : vb - va;
    });
    function th(k, text) {
      return '<th data-k="' + k + '">' + text + (k === key ? (asc ? ' ▲' : ' ▼') : '') + '</th>';
    }
    var html = '<thead><tr>' +
      th('num', '号码') + th('count', '出现次数') + th('freq', '频率') +
      th('avgOmit', '平均遗漏') + th('maxOmit', '最大遗漏') +
      th('curOmit', '当前遗漏') + '<th>状态</th></tr></thead><tbody>';
    rows.forEach(function (r) {
      var ratio = r.avgOmit > 0 ? r.curOmit / r.avgOmit : (r.curOmit > 0 ? 99 : 0);
      var badge = r.curOmit === 0 ? '<span class="badge good">最新开出</span>'
        : ratio >= 2 ? '<span class="badge cold">偏冷</span>'
        : ratio <= 0.6 ? '<span class="badge hot">活跃</span>'
        : '<span class="badge norm">正常</span>';
      html += '<tr><td>' + ball(r.num, zone, true) + '</td><td>' + r.count + '</td><td>' + r.freq + '%</td>' +
        '<td>' + r.avgOmit + '</td><td>' + r.maxOmit + '</td><td><b>' + r.curOmit + '</b></td><td>' + badge + '</td></tr>';
    });
    html += '</tbody>';
    $(elId).innerHTML = html;
  }

  function renderOmitTables() {
    omitTable('omitFrontTable', S.frontOmit, 'f', omitSort.front);
    omitTable('omitBackTable', S.backOmit, 'b', omitSort.back);
  }

  document.querySelectorAll('#omitFrontTable, #omitBackTable').forEach(function (tb) {
    tb.addEventListener('click', function (ev) {
      var th = ev.target.closest('th');
      if (!th || !th.dataset.k) return;
      var zone = tb.id === 'omitFrontTable' ? 'front' : 'back';
      var st = omitSort[zone];
      if (st.key === th.dataset.k) st.asc = !st.asc;
      else { st.key = th.dataset.k; st.asc = (th.dataset.k === 'num' || th.dataset.k === 'avgOmit' || th.dataset.k === 'maxOmit'); }
      renderOmitTables();
    });
  });

  // ---------- 组合排行 ----------
  function buildCombos() {
    function comboList(arr, zone, type) {
      return '<ul class="rank-list">' + arr.map(function (x, i) {
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
  }

  // ---------- 连号统计 ----------
  function buildConsec() {
    var c = S.consec;
    var gd = Object.keys(c.groupDist).map(Number).sort(function (a, b) { return a - b; });
    var gdText = gd.map(function (k) { return k + ' 组 ' + c.groupDist[k] + ' 期'; }).join('，');
    var last20 = S.raw.slice(0, 20).reverse(); // 最近20期（旧→新）
    var last20Has = last20.filter(function (d) {
      var f = d[2], j, ok = false;
      for (j = 1; j < 5; j++) if (f[j] - f[j - 1] === 1) { ok = true; break; }
      return ok;
    }).length;
    var zk = Object.keys(S.zonePatternFreq).map(function (k) { return { k: k, c: S.zonePatternFreq[k] }; })
      .sort(function (a, b) { return b.c - a.c; })[0];
    $('consecStats').innerHTML =
      '<p>出现连号的期数：<b>' + c.hasCount + '</b> 期，占 ' + fmtPct(c.hasCount / S.n) + '</p>' +
      '<p>平均每期连号组数：<b>' + c.avgGroups + '</b> 组</p>' +
      '<p>连号组数分布：' + gdText + '</p>' +
      '<p>最近 20 期中有 <b>' + last20Has + '</b> 期含连号</p>' +
      '<p>最常见三区形态：<b>' + zk.k + '</b>（' + zk.c + ' 期，占 ' + fmtPct(zk.c / S.n) + '）</p>';
  }

  // ---------- 号码热度矩阵 ----------
  var selNum = null;
  function appearedIn(zone, num, row) {
    var arr = row[zone === 'f' ? 2 : 3];
    for (var j = 0; j < arr.length; j++) if (arr[j] === num) return true;
    return false;
  }
  function matrixTip(zone, num) {
    var o = (zone === 'f' ? S.frontOmit : S.backOmit)[num - 1];
    return '出现 ' + o.count + ' 次 · 当前遗漏 ' + o.curOmit + ' 期 · 平均遗漏 ' + o.avgOmit + ' 期';
  }
  function buildMatrix() {
    var i, fh = '';
    for (i = 1; i <= 35; i++) {
      fh += '<button class="gball f' + (selNum && selNum.zone === 'f' && selNum.num === i ? ' sel' : '') +
        '" data-zone="f" data-num="' + i + '" title="' + matrixTip('f', i) + '">' + pad2(i) + '</button>';
    }
    var bh = '';
    for (i = 1; i <= 12; i++) {
      bh += '<button class="gball b' + (selNum && selNum.zone === 'b' && selNum.num === i ? ' sel' : '') +
        '" data-zone="b" data-num="' + i + '" title="' + matrixTip('b', i) + '">' + pad2(i) + '</button>';
    }
    $('frontGrid').innerHTML = fh;
    $('backGrid').innerHTML = bh;
    renderMatrixDetail($('matrixDetail'));
  }
  function renderMatrixDetail(el) {
    if (!el) { el.innerHTML = ''; return; }
    if (!selNum) { el.innerHTML = ''; return; }
    var zone = selNum.zone, num = selNum.num;
    var o = (zone === 'f' ? S.frontOmit : S.backOmit)[num - 1];
    var rows = state.rows; // 最新在前
    var lastIssue = null, i;
    for (i = 0; i < rows.length; i++) if (appearedIn(zone, num, rows[i])) { lastIssue = rows[i]; break; }
    var cnt30 = 0, dots = '';
    rows.slice(0, 30).forEach(function (r) {
      if (appearedIn(zone, num, r)) { cnt30++; dots += '<i class="dot on"></i>'; }
      else dots += '<i class="dot"></i>';
    });
    function stat(k, v) { return '<div class="md-stat"><span>' + k + '</span><b>' + v + '</b></div>'; }
    el.innerHTML =
      '<div class="md-head">' + (zone === 'f' ? ball(num, 'f') : ball(num, 'b')) +
      ' <b>' + pad2(num) + '</b><span class="md-zone">' + (zone === 'f' ? '前区' : '后区') + '</span></div>' +
      '<div class="md-grid">' +
      stat('出现次数', o.count + ' 次') +
      stat('出现频率', o.freq + '%') +
      stat('当前遗漏', '<b style="color:var(--red);">' + o.curOmit + '</b> 期') +
      stat('平均遗漏', o.avgOmit + ' 期') +
      stat('最大遗漏', o.maxOmit + ' 期') +
      stat('最近开出', lastIssue ? '第 ' + lastIssue[0] + ' 期' : '从未开出') +
      '</div>' +
      '<div class="md-last30"><span>近 30 期出现 <b>' + cnt30 + '</b> 次：</span><span class="dots">' + dots + '</span></div>';
  }
  document.getElementById('frontGrid').addEventListener('click', function (ev) {
    var b = ev.target.closest('.gball');
    if (!b) return;
    selNum = { zone: 'f', num: +b.dataset.num };
    buildMatrix();
    buildTrendGrids();
    renderTrendDetail();
  });
  document.getElementById('backGrid').addEventListener('click', function (ev) {
    var b = ev.target.closest('.gball');
    if (!b) return;
    selNum = { zone: 'b', num: +b.dataset.num };
    buildMatrix();
    buildTrendGrids();
    renderTrendDetail();
  });

  // ---------- 模拟选号 ----------
  function sampleUniform(pool, k) {
    var items = pool.slice(), out = [];
    while (out.length < k) {
      var i = Math.floor(Math.random() * items.length);
      out.push(items[i]);
      items.splice(i, 1);
    }
    return out.sort(function (a, b) { return a - b; });
  }
  function sampleWeighted(pool, weights, k) {
    var items = pool.slice(), out = [];
    while (out.length < k) {
      var tot = 0, i, ws = items.map(function (it) {
        var w = typeof weights === 'function' ? weights(it) : (weights[it] || 1);
        tot += w; return w;
      });
      var r = Math.random() * tot, acc = 0, chosen = items.length - 1;
      for (i = 0; i < items.length; i++) { acc += ws[i]; if (r <= acc) { chosen = i; break; } }
      out.push(items[chosen]);
      items.splice(chosen, 1);
    }
    return out.sort(function (a, b) { return a - b; });
  }
  var FRONT_POOL = [], BACK_POOL = [];
  for (var pn = 1; pn <= 35; pn++) FRONT_POOL.push(pn);
  for (pn = 1; pn <= 12; pn++) BACK_POOL.push(pn);

  function pickStrategy(kind) {
    if (kind === 'random') {
      return { f: sampleUniform(FRONT_POOL, 5), b: sampleUniform(BACK_POOL, 2) };
    }
    if (kind === 'hot') {
      return {
        f: sampleWeighted(FRONT_POOL, function (n) { return S.frontFreq[n]; }, 5),
        b: sampleWeighted(BACK_POOL, function (n) { return S.backFreq[n]; }, 2)
      };
    }
    if (kind === 'omit') {
      var fw = {}, bw = {};
      S.frontOmit.forEach(function (r) { fw[r.num] = r.curOmit + 1; });
      S.backOmit.forEach(function (r) { bw[r.num] = r.curOmit + 1; });
      return { f: sampleWeighted(FRONT_POOL, fw, 5), b: sampleWeighted(BACK_POOL, bw, 2) };
    }
    // balance
    var tries = 0;
    while (tries++ < 3000) {
      var f = sampleUniform(FRONT_POOL, 5);
      var odd = f.filter(function (n) { return n % 2 === 1; }).length;
      var big = f.filter(function (n) { return n >= 18; }).length;
      var sum = f.reduce(function (a, c) { return a + c; }, 0);
      if (odd >= 2 && odd <= 3 && big >= 2 && big <= 3 && sum >= 75 && sum <= 110) {
        return { f: f, b: sampleUniform(BACK_POOL, 2) };
      }
    }
    return { f: sampleUniform(FRONT_POOL, 5), b: sampleUniform(BACK_POOL, 2) };
  }

  var lastPicks = null;
  function renderPicks(kind) {
    var notes = [];
    for (var i = 0; i < 5; i++) notes.push(pickStrategy(kind));
    lastPicks = { kind: kind, notes: notes };
    var labels = { random: '随机', hot: '热号', omit: '遗漏', balance: '均衡' };
    $('pickResult').innerHTML = notes.map(function (nt, idx) {
      return '<div class="pick-note"><span class="idx">' + labels[kind] + ' ' + (idx + 1) + '</span>' +
        balls(nt.f, 'f') + '<span style="margin:0 3px;color:#c9ced8;">|</span>' + balls(nt.b, 'b') + '</div>';
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
    var kindName = { random: '随机', hot: '热号', omit: '遗漏', balance: '均衡' }[lastPicks.kind];
    var lines = lastPicks.notes.map(function (nt, idx) {
      return '第' + (idx + 1) + '注 ' + kindName + '：' + nt.f.map(pad2).join(' ') + ' + ' + nt.b.map(pad2).join(' ');
    });
    copyText(lines.join('\n'), '已复制选号结果');
  }
  $('btnRandom').addEventListener('click', function () { renderPicks('random'); });
  $('btnHot').addEventListener('click', function () { renderPicks('hot'); });
  $('btnOmit').addEventListener('click', function () { renderPicks('omit'); });
  $('btnBalance').addEventListener('click', function () { renderPicks('balance'); });
  $('btnCopy').addEventListener('click', copyPicks);

  // 预测方法切换
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

  // ---------- 下一期预测（多方法） ----------
  var PRED_METHODS = {
    ensemble: { name: '综合加权', desc: '综合「频次」「近50期热度」「遗漏回补」「转移跟随」四项评分的排名分等权平均，再按分数加权抽取 5 注。' },
    freq: { name: '频次加权', desc: '按全部历史开奖的出现频率加权抽取，历史越常出的号码越容易被选中。' },
    recent: { name: '近期热度', desc: '只看最近 50 期的出现频率，捕捉近期热号趋势（比全量频次更敏感）。' },
    omit: { name: '遗漏回补', desc: '当前遗漏期数 ÷ 平均遗漏期数越大优先级越高，押注长期未出号码的「回补」。' },
    follow: { name: '转移跟随', desc: '以上一期开出的 5+2 个号码为种子，统计历史上这些号码开出后「下一期」的跟随出现概率，按概率加权。' },
    hotcold: { name: '冷热混合', desc: '每注前区 2 热 + 2 冷 + 1 中、后区 1 热 + 1 冷（热=频次 TOP8，冷=频次 BOTTOM8）。' },
    sumrange: { name: '和值区间', desc: '前区和值约束在历史最密集区间（众数 ±12），并兼顾奇偶 2:3/3:2、大小均衡、三区至少各 1 个。' }
  };
  var SCORE_BASED = { ensemble: 1, freq: 1, recent: 1, omit: 1, follow: 1 };
  var BT_METHODS = [['ensemble', '综合加权'], ['freq', '频次加权'], ['recent', '近期热度'], ['omit', '遗漏回补'], ['follow', '转移跟随'], ['hotcold', '冷热混合'], ['sumrange', '和值区间']];
  var RECENT_WIN = 50;
  var predMethod = 'ensemble';
  var predScores = null;

  // 从开奖数据构建预测统计（频次/近期/遗漏/转移/和值众数）
  function buildPredStats(rows) {
    var n = rows.length;
    var freqF = new Array(36).fill(0), freqB = new Array(13).fill(0);
    var recentF = new Array(36).fill(0), recentB = new Array(13).fill(0);
    var omitF = new Array(36).fill(n), omitB = new Array(13).fill(n);
    var prevPosF = new Array(36).fill(-1), prevPosB = new Array(13).fill(-1);
    var gapsF = [], gapsB = [], i, j, k;
    for (i = 0; i <= 35; i++) gapsF.push([]);
    for (i = 0; i <= 12; i++) gapsB.push([]);
    var transF = [], transB = [];
    for (i = 0; i <= 35; i++) transF.push(new Array(36).fill(0));
    for (i = 0; i <= 12; i++) transB.push(new Array(13).fill(0));
    var sumHist = {}, sumMax = 0, sumMode = 0;

    for (var pos = 0; pos < n; pos++) {
      var f = rows[pos][2], b = rows[pos][3];
      var sum = 0;
      for (j = 0; j < 5; j++) {
        var v = f[j];
        freqF[v]++; sum += v;
        if (pos < RECENT_WIN) recentF[v]++;
        if (omitF[v] === n) omitF[v] = pos;
        if (pos > 0) {
          var nf = rows[pos - 1][2];
          for (k = 0; k < 5; k++) transF[v][nf[k]]++;
        }
      }
      sumHist[sum] = (sumHist[sum] || 0) + 1;
      if (sumHist[sum] > sumMax) { sumMax = sumHist[sum]; sumMode = sum; }
      for (j = 0; j < 2; j++) {
        var v2 = b[j];
        freqB[v2]++;
        if (pos < RECENT_WIN) recentB[v2]++;
        if (omitB[v2] === n) omitB[v2] = pos;
        if (pos > 0) {
          var nb = rows[pos - 1][3];
          for (k = 0; k < 2; k++) transB[v2][nb[k]]++;
        }
      }
    }
    // 平均遗漏：从旧到新统计相邻两次出现的间隔
    var chrono = rows.slice().reverse();
    for (i = 0; i < chrono.length; i++) {
      var cf = chrono[i][2], cb = chrono[i][3];
      for (j = 0; j < 5; j++) { var v = cf[j]; if (prevPosF[v] !== -1) gapsF[v].push(i - prevPosF[v] - 1); prevPosF[v] = i; }
      for (j = 0; j < 2; j++) { var v2 = cb[j]; if (prevPosB[v2] !== -1) gapsB[v2].push(i - prevPosB[v2] - 1); prevPosB[v2] = i; }
    }
    function avgG(arr) {
      if (!arr.length) return 0;
      var s = 0;
      for (var q = 0; q < arr.length; q++) s += arr[q];
      return s / arr.length;
    }
    var avgOmitF = new Array(36).fill(0), avgOmitB = new Array(13).fill(0);
    for (i = 1; i <= 35; i++) avgOmitF[i] = avgG(gapsF[i]);
    for (i = 1; i <= 12; i++) avgOmitB[i] = avgG(gapsB[i]);
    return {
      n: n,
      freqF: freqF, freqB: freqB,
      recentF: recentF, recentB: recentB,
      omitF: omitF, omitB: omitB,
      avgOmitF: avgOmitF, avgOmitB: avgOmitB,
      transF: transF, transB: transB,
      lastF: rows[0][2], lastB: rows[0][3],
      sumLo: Math.max(15, sumMode - 12), sumHi: Math.min(165, sumMode + 12)
    };
  }

  // 各方法原始评分
  function rawScore(kind, st) {
    var sF = new Array(36).fill(0), sB = new Array(13).fill(0), i, j;
    var win = Math.min(RECENT_WIN, st.n);
    if (kind === 'freq') {
      for (i = 1; i <= 35; i++) sF[i] = st.freqF[i] / st.n * 100;
      for (i = 1; i <= 12; i++) sB[i] = st.freqB[i] / st.n * 100;
    } else if (kind === 'recent') {
      for (i = 1; i <= 35; i++) sF[i] = st.recentF[i] / win * 100;
      for (i = 1; i <= 12; i++) sB[i] = st.recentB[i] / win * 100;
    } else if (kind === 'omit') {
      for (i = 1; i <= 35; i++) sF[i] = st.omitF[i] === st.n ? 999 : (st.avgOmitF[i] > 0 ? st.omitF[i] / st.avgOmitF[i] : 0);
      for (i = 1; i <= 12; i++) sB[i] = st.omitB[i] === st.n ? 999 : (st.avgOmitB[i] > 0 ? st.omitB[i] / st.avgOmitB[i] : 0);
    } else if (kind === 'follow') {
      for (i = 1; i <= 35; i++) {
        var v = 0;
        for (j = 0; j < st.lastF.length; j++) {
          var a = st.lastF[j], denom = st.freqF[a] - 1;
          if (denom > 0) v += st.transF[a][i] / denom * 100;
        }
        sF[i] = v;
      }
      for (i = 1; i <= 12; i++) {
        var v2 = 0;
        for (j = 0; j < st.lastB.length; j++) {
          var a2 = st.lastB[j], denom2 = st.freqB[a2] - 1;
          if (denom2 > 0) v2 += st.transB[a2][i] / denom2 * 100;
        }
        sB[i] = v2;
      }
    }
    return { sF: sF, sB: sB };
  }

  // 排名分归一化：排名越靠前分越高（0~100）
  function rankNorm(sc) {
    function zone(arr, maxNum) {
      var list = [];
      for (var i = 1; i <= maxNum; i++) list.push({ num: i, v: arr[i] });
      list.sort(function (a, b) { return b.v - a.v || a.num - b.num; });
      var out = new Array(maxNum + 1);
      list.forEach(function (it, idx) { out[it.num] = (maxNum - 1 - idx) / (maxNum - 1) * 100; });
      return out;
    }
    return { sF: zone(sc.sF, 35), sB: zone(sc.sB, 12) };
  }

  function avgScores(list) {
    var sF = new Array(36).fill(0), sB = new Array(13).fill(0), i;
    for (i = 1; i <= 35; i++) { var a = 0; list.forEach(function (sc) { a += sc.sF[i]; }); sF[i] = a / list.length; }
    for (i = 1; i <= 12; i++) { var b = 0; list.forEach(function (sc) { b += sc.sB[i]; }); sB[i] = b / list.length; }
    return { sF: sF, sB: sB };
  }

  function scoreFor(m, st) {
    if (m === 'freq' || m === 'recent' || m === 'omit' || m === 'follow') return rankNorm(rawScore(m, st));
    return avgScores([
      rankNorm(rawScore('freq', st)),
      rankNorm(rawScore('recent', st)),
      rankNorm(rawScore('omit', st)),
      rankNorm(rawScore('follow', st))
    ]);
  }

  function topN(sArr, maxNum, k) {
    var l = [];
    for (var i = 1; i <= maxNum; i++) l.push({ num: i, v: sArr[i] });
    l.sort(function (a, b) { return b.v - a.v || a.num - b.num; });
    return l.slice(0, k);
  }

  function pickHotCold(st) {
    var i, sortedF = [];
    for (i = 1; i <= 35; i++) sortedF.push(i);
    sortedF.sort(function (a, b) { return st.freqF[b] - st.freqF[a]; });
    var f = sampleUniform(sortedF.slice(0, 8), 2)
      .concat(sampleUniform(sortedF.slice(27), 2))
      .concat(sampleUniform(sortedF.slice(8, 27), 1))
      .sort(function (a, b) { return a - b; });
    var sortedB = [];
    for (i = 1; i <= 12; i++) sortedB.push(i);
    sortedB.sort(function (a, b) { return st.freqB[b] - st.freqB[a]; });
    var b = sampleUniform(sortedB.slice(0, 4), 1).concat(sampleUniform(sortedB.slice(8), 1)).sort(function (a, b) { return a - b; });
    return { f: f, b: b };
  }

  function pickSumRange(st) {
    var tries = 0;
    while (tries++ < 4000) {
      var f = sampleUniform(FRONT_POOL, 5);
      var sum = f.reduce(function (a, c) { return a + c; }, 0);
      if (sum >= st.sumLo && sum <= st.sumHi) {
        var odd = f.filter(function (n) { return n % 2 === 1; }).length;
        var big = f.filter(function (n) { return n >= 18; }).length;
        var z1 = f.filter(function (n) { return n <= 12; }).length;
        var z3 = f.filter(function (n) { return n >= 25; }).length;
        if (odd >= 2 && odd <= 3 && big >= 2 && big <= 3 && z1 >= 1 && z3 >= 1) {
          return { f: f, b: sampleUniform(BACK_POOL, 2) };
        }
      }
    }
    return { f: sampleUniform(FRONT_POOL, 5), b: sampleUniform(BACK_POOL, 2) };
  }

  function predictMethod(m, st, k) {
    var out = [], i;
    for (i = 0; i < k; i++) {
      if (m === 'hotcold') out.push(pickHotCold(st));
      else if (m === 'sumrange') out.push(pickSumRange(st));
      else {
        var sc = scoreFor(m, st);
        var wF = {}, wB = {}, x;
        for (x = 1; x <= 35; x++) wF[x] = sc.sF[x] + 1;
        for (x = 1; x <= 12; x++) wB[x] = sc.sB[x] + 1;
        out.push({ f: sampleWeighted(FRONT_POOL, wF, 5), b: sampleWeighted(BACK_POOL, wB, 2) });
      }
    }
    return out;
  }

  function drawPredCharts() {
    if (!predScores) return;
    var i, fl = [], fv = [], bl = [], bv = [];
    for (i = 1; i <= 35; i++) { fl.push(pad2(i)); fv.push(+predScores.sc.sF[i].toFixed(1)); }
    for (i = 1; i <= 12; i++) { bl.push(pad2(i)); bv.push(+predScores.sc.sB[i].toFixed(1)); }
    var fTop = topN(predScores.sc.sF, 35, 6).map(function (x) { return x.num; });
    var bTop = topN(predScores.sc.sB, 12, 3).map(function (x) { return x.num; });
    reg($('predChartFront'), function () {
      barChart($('predChartFront'), {
        labels: fl, values: fv, valueTop: true, hoverIdx: hoverState['predChartFront'],
        tipFmt: function (v) { return v + ' 分'; },
        colors: function (idx) { return fTop.indexOf(idx + 1) >= 0 ? '#c22a2a' : '#e98a8a'; }
      });
    });
    reg($('predChartBack'), function () {
      barChart($('predChartBack'), {
        labels: bl, values: bv, valueTop: true, hoverIdx: hoverState['predChartBack'],
        tipFmt: function (v) { return v + ' 分'; },
        colors: function (idx) { return bTop.indexOf(idx + 1) >= 0 ? '#1f56b0' : '#6f9ce0'; }
      });
    });
  }

  function renderPredTickets(tickets, methodName) {
    $('predResult').innerHTML = tickets.map(function (nt, idx) {
      var sum = nt.f.reduce(function (a, c) { return a + c; }, 0);
      var odd = nt.f.filter(function (n) { return n % 2 === 1; }).length;
      var big = nt.f.filter(function (n) { return n >= 18; }).length;
      return '<div class="pick-note"><span class="idx">' + methodName + ' ' + (idx + 1) + '</span>' +
        balls(nt.f, 'f') + '<span style="margin:0 3px;color:#c9ced8;">|</span>' + balls(nt.b, 'b') +
        '<span class="pred-meta">和值' + sum + ' · 奇' + odd + '偶' + (5 - odd) + ' · 大' + big + '小' + (5 - big) + '</span></div>';
    }).join('');
  }

  function buildPrediction() {
    var st = buildPredStats(state.rows);
    var sc = SCORE_BASED[predMethod] ? scoreFor(predMethod, st) : scoreFor('ensemble', st);
    predScores = { st: st, sc: sc };
    var m = PRED_METHODS[predMethod];
    $('predDesc').textContent = '当前方法：' + m.name + ' —— ' + m.desc;
    $('predTitleF').textContent = '前区 01–35 ' + m.name + '评分（悬停查看，红柱为 TOP6）';
    $('predTitleB').textContent = '后区 01–12 ' + m.name + '评分（悬停查看，蓝柱为 TOP3）';
    var fTop = topN(sc.sF, 35, 6), bTop = topN(sc.sB, 12, 3);
    $('predRecoF').innerHTML = fTop.map(function (x) { return ball(x.num, 'f'); }).join('') +
      ' <span class="pred-score">评分 ' + fTop.map(function (x) { return x.v.toFixed(0); }).join(' / ') + '</span>';
    $('predRecoB').innerHTML = bTop.map(function (x) { return ball(x.num, 'b'); }).join('') +
      ' <span class="pred-score">评分 ' + bTop.map(function (x) { return x.v.toFixed(0); }).join(' / ') + '</span>';
    renderPredTickets(predictMethod(predMethod, st, 5), m.name);
    drawPredCharts();
  }

  function countMatch(pred, actual) {
    var c = 0, i, j;
    for (i = 0; i < pred.length; i++) for (j = 0; j < actual.length; j++) if (pred[i] === actual[j]) c++;
    return c;
  }

  function runBacktest() {
    var btn = $('btnBacktest');
    if (btn.disabled) return;
    btn.disabled = true;
    $('btWrap').hidden = false;
    $('btTable').innerHTML = '<tr><td colspan="5" style="color:var(--muted);">回测计算中…</td></tr>';
    setTimeout(function () {
      var K = 100, t, i;
      var rows = state.rows;
      var agg = {};
      for (i = 0; i < BT_METHODS.length; i++) agg[BT_METHODS[i][0]] = { fh: 0, bh: 0, hit1: 0, t: 0 };
      for (t = 0; t < K && rows.length - t - 1 >= 200; t++) {
        var target = rows[t];
        var st = buildPredStats(rows.slice(t + 1));
        for (i = 0; i < BT_METHODS.length; i++) {
          var mm = BT_METHODS[i][0];
          var picks = predictMethod(mm, st, 1)[0];
          var hf = countMatch(picks.f, target[2]);
          var hb = countMatch(picks.b, target[3]);
          agg[mm].fh += hf; agg[mm].bh += hb; agg[mm].hit1 += hf >= 1 ? 1 : 0; agg[mm].t++;
        }
      }
      var baseF = 5 * 5 / 35, baseB = 2 * 2 / 12, base1 = 1 - Math.pow(30 / 35, 5);
      var html = '<thead><tr><th>方法</th><th>平均前区命中/注</th><th>平均后区命中/注</th><th>前区≥1命中率</th><th>相对随机（前区）</th></tr></thead><tbody>';
      for (i = 0; i < BT_METHODS.length; i++) {
        var mm2 = BT_METHODS[i];
        var a = agg[mm2[0]];
        if (!a.t) { html += '<tr><td>' + mm2[1] + '</td><td colspan="4" style="color:var(--muted);">数据不足</td></tr>'; continue; }
        var fh = a.fh / a.t, bh = a.bh / a.t, h1 = a.hit1 / a.t;
        var diff = fh - baseF;
        var badge = diff >= 0.05 ? '<span class="badge good">+' + diff.toFixed(2) + '</span>'
          : diff <= -0.05 ? '<span class="badge cold">' + diff.toFixed(2) + '</span>'
          : '<span class="badge norm">' + diff.toFixed(2) + '</span>';
        html += '<tr><td style="font-weight:600;">' + mm2[1] + '</td><td>' + fh.toFixed(2) + '</td><td>' + bh.toFixed(2) + '</td><td>' + (h1 * 100).toFixed(1) + '%</td><td>' + badge + '</td></tr>';
      }
      html += '<tr style="background:#f4f6fa;"><td style="font-weight:600;">纯随机对照</td><td>' + baseF.toFixed(2) + '</td><td>' + baseB.toFixed(2) + '</td><td>' + (base1 * 100).toFixed(1) + '%</td><td>—</td></tr>';
      html += '<tr class="tt"><td colspan="5" class="dim" style="text-align:left;">回测样本量：' + t + ' 期（从最新一期往回逐期回测，每期须满足 ≥200 期历史数据，故样本随总期数变化）</td></tr></tbody>';
      $('btTable').innerHTML = html;
      var h3 = $('btWrap').querySelector('h3');
      if (h3) h3.textContent = '近 100 期历史回测 · 本次样本 ' + t + ' 期（用每期之前的所有数据预测该期，对照纯随机基准）';
      btn.disabled = false;
      toast('回测完成：样本 ' + t + ' 期（要求每期前 ≥200 期历史数据）', true);
    }, 30);
  }

  // ---------- 开奖记录（点击行展开该期开奖公告；点击期号填入中奖查询） ----------
  var recPage = 0, recPageSize = 50, recQuery = '';
  var recOpen = {};   // 已展开公告的期号
  function renderRecords() {
    var list = state.rows;
    if (recQuery) {
      var q = recQuery.toLowerCase();
      list = state.rows.filter(function (d) { return d[0].indexOf(q) >= 0 || String(d[1]).indexOf(q) >= 0; });
    }
    var total = list.length;
    var pages = recPageSize === 0 ? 1 : Math.max(1, Math.ceil(total / recPageSize));
    if (recPage >= pages) recPage = pages - 1;
    if (recPage < 0) recPage = 0;
    var slice = recPageSize === 0 ? list : list.slice(recPage * recPageSize, (recPage + 1) * recPageSize);
    var html = '<thead><tr><th>期号</th><th>开奖日期</th><th>前区</th><th>后区</th><th>奖池</th><th>销量</th><th>公告</th></tr></thead><tbody>';
    slice.forEach(function (d) {
      var pool = Number(d[4]) || 0, sales = Number(d[5]) || 0;
      var hasPrize = (d[6] || []).length > 0;
      var open = recOpen[d[0]];
      html += '<tr class="' + (open ? 'rec-open' : '') + '" data-issue="' + d[0] + '" style="cursor:pointer;" title="点击查看该期开奖公告">' +
        '<td style="font-weight:600; color:var(--blue); text-decoration:underline dotted;" class="rec-issue" title="点击填入中奖查询期号">' + d[0] + '</td>' +
        '<td style="color:#4a5160;">' + d[1] + '</td>' +
        '<td>' + balls(d[2], 'f', true) + '</td><td>' + balls(d[3], 'b', true) + '</td>' +
        '<td>' + (pool ? fmtYi(pool) : '—') + '</td>' +
        '<td>' + (sales ? fmtYi(sales) : '—') + '</td>' +
        '<td>' + (hasPrize ? '<span class="badge good">' + (open ? '收起' : '查看') + '</span>' : '<span class="badge norm">无</span>') + '</td></tr>';
      if (open) {
        html += '<tr class="ann-row"><td colspan="7">' + buildAnnounceHTML(d, false) + '</td></tr>';
      }
    });
    html += '</tbody>';
    $('recordTable').innerHTML = html;
    $('pageInfo').textContent =
      '第 ' + (recPage + 1) + ' / ' + pages + ' 页，共 ' + total + ' 期' + (recQuery ? '（搜索“' + recQuery + '”）' : '') +
      (Object.keys(recOpen).length ? '；已展开 ' + Object.keys(recOpen).length + ' 期公告' : '');
    $('btnPrev').disabled = recPage <= 0;
    $('btnNext').disabled = recPage >= pages - 1;
  }
  $('recordTable').addEventListener('click', function (ev) {
    var issueEl = ev.target.closest('.rec-issue');
    if (issueEl) {   // 点击期号：填入中奖查询并跳转
      var term = $('ckTerm');
      term.value = issueEl.closest('tr').dataset.issue;
      document.getElementById('check').scrollIntoView({ behavior: 'smooth' });
      toast('已填入期号 ' + term.value + '，点击「🎯 判定中奖」即可', true);
      return;
    }
    var tr = ev.target.closest('tr[data-issue]');   // 点击行其它位置：展开/收起公告
    if (!tr) return;
    var issue = tr.dataset.issue;
    recOpen[issue] = !recOpen[issue];
    renderRecords();
  });
  $('btnPrev').addEventListener('click', function () { recPage--; renderRecords(); });
  $('btnNext').addEventListener('click', function () { recPage++; renderRecords(); });
  $('recordCount').addEventListener('change', function (ev) {
    recPageSize = +ev.target.value; recPage = 0; renderRecords();
  });
  $('searchIssue').addEventListener('input', function (ev) {
    recQuery = ev.target.value.trim(); recPage = 0; renderRecords();
  });

  function exportCSV() {
    var rows = state.rows;
    var lines = ['期号,开奖日期,前区,后区,奖池(元),销量(元)'];
    rows.forEach(function (r) {
      lines.push('"' + r[0] + '",' + r[1] + ',"' + r[2].map(pad2).join(' ') + '","' + r[3].map(pad2).join(' ') + '",' +
        (Number(r[4]) || 0) + ',' + (Number(r[5]) || 0));
    });
    var blob = new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = '大乐透历史开奖_' + rows[0][0] + '.csv';
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 200);
    toast('已导出 ' + rows.length + ' 期数据（CSV）', true);
  }
  $('btnExportCSV').addEventListener('click', exportCSV);

  // 搜索快捷键：按 / 聚焦期号搜索（输入框内除外）
  document.addEventListener('keydown', function (ev) {
    var tag = (document.activeElement && document.activeElement.tagName) || '';
    if (ev.key === '/' && tag !== 'INPUT' && tag !== 'TEXTAREA') {
      ev.preventDefault();
      $('searchIssue').focus();
    }
  });

  // ---------- 汇总绘制 ----------
  function drawAll() {
    drawFreqCharts();
    drawSumChart();
    drawDistCharts();
    drawPredCharts();
    drawPoolChart();
  }

  function renderAll() {
    buildOverview();
    buildLatest();
    buildPoolTrend();
    buildTrendGrids();
    buildHotCold();
    buildCombos();
    buildConsec();
    buildMatrix();
    buildPrediction();
    drawAll();
    renderOmitTables();
    renderRecords();
  }

  $('sumRangeBar').addEventListener('change', function (ev) {
    if (ev.target.name === 'sumRange') { sumRange = ev.target.value; drawSumChart(); }
  });

  // 面板折叠（状态记忆到 localStorage，下次打开保持用户偏好）
  var COLLAPSE_KEY = 'dlt_collapsed_v1';
  function loadCollapsedMap() {
    try { return JSON.parse(localStorage.getItem(COLLAPSE_KEY) || '{}') || {}; } catch (e) { return {}; }
  }
  var collapsedMap = loadCollapsedMap();
  function saveCollapsedMap() {
    try { localStorage.setItem(COLLAPSE_KEY, JSON.stringify(collapsedMap)); } catch (e) {}
  }
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
      saveCollapsedMap();
      if (!collapsed) requestAnimationFrame(function () { drawAll(); });
    });
  });

  // 回到顶部 / 跳到底部（随滚动显隐）
  window.addEventListener('scroll', function () {
    $('backtop').classList.toggle('show', window.scrollY > 600);
    var nearBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 700;
    $('backbottom').classList.toggle('show', window.scrollY > 600 && !nearBottom);
  }, { passive: true });
  $('backbottom').addEventListener('click', function (ev) {
    ev.preventDefault();
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' });
  });

  // 顶部工具栏高度随导航换行变化：动态修正锚点跳转偏移，避免章节被吸顶栏遮挡
  function updateScrollOffset() {
    var tb = document.querySelector('.topbar');
    var h = tb ? tb.offsetHeight : 76;
    document.documentElement.style.setProperty('--scroll-offset', (h + 10) + 'px');
  }
  updateScrollOffset();

  // 导航高亮（scrollspy）
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (en) {
      if (!en.isIntersecting) return;
      document.querySelectorAll('#mainNav a').forEach(function (a) {
        a.classList.toggle('active', a.dataset.sec === en.target.id);
      });
    });
  }, { rootMargin: '-40% 0px -55% 0px' });
  document.querySelectorAll('section[id]').forEach(function (el) { io.observe(el); });

  var resizeTimer = null;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () { drawAll(); updateScrollOffset(); }, 200);
  });

  // ---------- 事件与初始化 ----------
  $('btnUpdate').addEventListener('click', doUpdate);
  $('btnSaveData').addEventListener('click', doSaveData);
  $('btnReset').addEventListener('click', doReset);

  var initial = pickInitialRows();
  state.rows = initial.rows;
  state.meta = initial.meta;
  window.DLT_CURRENT_ROWS = initial.rows;   // 初始即暴露当前数据（含本地缓存），供中奖查询等模块读取
  S = DltCore.computeAll(state.rows);
  renderAll();
  updateChip();

  // 静默检查新数据：只拉最新一页，发现缺失期次时提示一键更新（需本地服务器模式）
  function autoCheckNew() {
    if (location.protocol === 'file:') return;   // file:// 下无法跨域请求，跳过
    if (state.meta.source === 'cache' && state.meta.fetchedAt && Date.now() - state.meta.fetchedAt < 12 * 3600 * 1000) return; // 12 小时内刚更新过则跳过
    var existingSet = {};
    state.rows.forEach(function (r) { existingSet[r[0]] = true; });
    fetchAllFromApi(existingSet, null, 1).then(function (res) {
      var list = res.list;
      if (!list || !list.length) return;
      var msg = list.length >= PAGE_SIZE
        ? '发现较多新数据（≥' + list.length + ' 期），可一键更新'
        : '发现 ' + list.length + ' 期新数据（可更新至第 ' + list[0].lotteryDrawNum + ' 期）';
      toast(msg, null, { label: '立即更新', onClick: doUpdate });
    }).catch(function () { /* 静默失败：不打扰用户 */ });
  }
  setTimeout(autoCheckNew, 800);

  // 默认选中前区最热号码
  selNum = { zone: 'f', num: S.frontFreqList[0].num };
  buildMatrix();
})();

/* 🎯 中奖查询：按 2026 新规 7 奖级判定（支持复式） */
(function () {
  'use strict';
  var PREFIX = { '5+2': 1, '5+1': 2, '5+0': 3, '4+2': 3, '4+1': 4, '4+0': 5, '3+2': 5, '3+1': 6, '2+2': 6, '3+0': 7, '1+2': 7, '2+1': 7, '0+2': 7 };
  var BASE = { 3: 5000, 4: 300, 5: 150, 6: 15, 7: 5 };   // 基本档
  var UP   = { 3: 6666, 4: 380, 5: 200, 6: 18, 7: 7 };   // 奖池 ≥ 8 亿升级档
  var NAME = { 1: '一等奖', 2: '二等奖', 3: '三等奖', 4: '四等奖', 5: '五等奖', 6: '六等奖', 7: '七等奖' };
  var COND = { 1: '5+2', 2: '5+1', 3: '5+0 / 4+2', 4: '4+1', 5: '4+0 / 3+2', 6: '3+1 / 2+2', 7: '3+0 / 1+2 / 2+1 / 0+2' };
  var EIGHT_YI = 800000000;

  function C(n, k) { if (k < 0 || k > n) return 0; var r = 1; for (var i = 0; i < k; i++) r = r * (n - i) / (i + 1); return Math.round(r); }
  function pad2(n) { return n < 10 ? '0' + n : '' + n; }
  function prizeLevel(f, b) { return PREFIX[f + '+' + b] || 0; }

  // 解析输入号码：max 为单号上限（前区 35 / 后区 12），maxCount 为复式投注可选个数上限
  // （大乐透规则：前区最多 12 个、后区最多 6 个，超出即非法复式）
  function parseNums(str, max, min, maxCount, label) {
    var arr = String(str || '').trim().split(/[\s,，、]+/).filter(Boolean).map(function (x) {
      var n = parseInt(x, 10);
      if (isNaN(n) || n < 1 || n > max) throw new Error(label + '号码需在 1–' + max + ' 之间：' + x);
      return n;
    });
    if (arr.length < min) throw new Error(label + '至少需要 ' + min + ' 个号码');
    if (arr.length > maxCount) throw new Error(label + '号码太多（复式最多 ' + maxCount + ' 个）');
    if (new Set(arr).size !== arr.length) throw new Error(label + '号码不能重复');
    return arr.sort(function (a, b) { return a - b; });
  }

  function findDraw(rows, term) {
    if (term) {
      for (var i = 0; i < rows.length; i++) if (rows[i][0] === term) return rows[i];
      throw new Error('未找到期号 ' + term + '，请检查期号是否正确');
    }
    return rows[0]; // 数据按期号倒序，第一条即最新
  }

  function doCheck() {
    var out = document.getElementById('ckResult');
    try {
      var rows = window.DLT_CURRENT_ROWS || RAW_DATA;
      var F = parseNums(document.getElementById('ckFront').value, 35, 5, 12, '前区');  // 复式前区上限 12
      var B = parseNums(document.getElementById('ckBack').value, 12, 2, 6, '后区');    // 复式后区上限 6
      var term = document.getElementById('ckTerm').value.trim();
      var append = document.getElementById('ckAppend').checked;
      var draw = findDraw(rows, term);
      var FD = draw[2], BD = draw[3];
      var pool = draw[4] ? Number(draw[4]) : 0;   // 开奖后滚存
      var sales = draw[5] ? Number(draw[5]) : 0;
      var prizes = draw[6] || [];
      // 开奖前奖池 = 上一期开奖后滚存（决定该期固定奖兑付档位）
      var prePool = pool, di;
      for (di = 0; di < rows.length; di++) {
        if (rows[di][0] === draw[0]) {
          prePool = rows[di + 1] ? (Number(rows[di + 1][4]) || 0) : pool;
          break;
        }
      }
      var upgraded = prePool >= EIGHT_YI;
      var mF = 0, mB = 0, hitF = [], hitB = [];
      for (var i = 0; i < F.length; i++) if (FD.indexOf(F[i]) >= 0) { mF++; hitF.push(F[i]); }
      for (var j = 0; j < B.length; j++) if (BD.indexOf(B[j]) >= 0) { mB++; hitB.push(B[j]); }

      var nF = F.length, nB = B.length;
      var totalCombos = C(nF, 5) * C(nB, 2);
      var cost = totalCombos * (append ? 3 : 2);

      var stat = {};
      for (var f = 0; f <= 5; f++) {
        for (var b = 0; b <= 2; b++) {
          var cnt = C(mF, f) * C(nF - mF, 5 - f) * C(mB, b) * C(nB - mB, 2 - b);
          if (!cnt) continue;
          var lv = prizeLevel(f, b);
          if (!lv) continue;
          stat[lv] = stat[lv] || { combos: 0, money: 0 };
          stat[lv].combos += cnt;
          stat[lv].money += lv <= 2 ? 0 : cnt * (upgraded ? UP[lv] : BASE[lv]);
        }
      }

      var html = '<div class="ck-box">';
      html += '<p><b>对照：第 ' + draw[0] + ' 期（' + draw[1] + '）</b>　开奖号码：' + FD.map(pad2).join(' ') + ' + ' + BD.map(pad2).join(' ') + '</p>';
      html += '<p>你的前区命中 <b>' + mF + '</b> 个：' + (hitF.length ? hitF.map(pad2).join(' ') : '—') + '；后区命中 <b>' + mB + '</b> 个：' + (hitB.length ? hitB.map(pad2).join(' ') : '—') + '</p>';
      if (prePool || pool || sales) html += '<p class="dim">该期开奖前奖池 ' + (prePool / 100000000).toFixed(2) + ' 亿元' + (upgraded ? '（≥8亿，固定奖按升级档兑付）' : '（&lt;8亿，按基本档兑付）') + (pool ? '；开奖后滚存 ' + (pool / 100000000).toFixed(2) + ' 亿元' : '') + (sales ? '；本期销量 ' + (sales / 100000000).toFixed(2) + ' 亿元' : '') + '</p>';
      if (prizes.length) {
        var pLine = prizes.map(function (p) {
          var amt = p[2];
          return p[0] + ' 单注 ' + (amt > 0 ? (amt >= 10000 ? (amt / 10000).toFixed(1) + ' 万' : amt + ' 元') : '—') + ' × ' + p[1] + ' 注';
        }).join('；');
        html += '<p class="dim">📢 该期官网开奖公告：' + pLine + '</p>';
      }

      var keys = Object.keys(stat).map(Number).sort(function (a, b) { return a - b; });
      if (!keys.length) {
        html += '<p><b>很遗憾，未中奖。</b>共 ' + totalCombos + ' 注，投入 ' + cost + ' 元。</p>';
      } else {
        html += '<table class="rules-table"><thead><tr><th>奖级</th><th>中奖条件</th><th>注数</th><th>单注奖金</th><th>小计</th></tr></thead><tbody>';
        var fixedWin = 0, floatCombos = 0;
        keys.forEach(function (lv) {
          var s = stat[lv];
          if (lv <= 2) { floatCombos += s.combos; }
          else fixedWin += s.money;
          var per = lv <= 2 ? (append ? '浮动 ×1.8（追加）' : '浮动') : (upgraded ? UP[lv] + ' 元' : BASE[lv] + ' 元');
          var sub = lv <= 2 ? s.combos + ' 注' : s.money + ' 元';
          html += '<tr><td>' + NAME[lv] + '</td><td>' + COND[lv] + '</td><td>' + s.combos + '</td><td>' + per + '</td><td>' + sub + '</td></tr>';
        });
        html += '</tbody></table>';
        html += '<p><b>固定奖合计：' + fixedWin + ' 元</b>' +
          (floatCombos ? '；另有浮动奖 ' + floatCombos + ' 注（一/二等奖为浮动奖金，以当期官方开奖公告为准；单注最高 ' + (append ? '1800' : '1000') + ' 万）' : '') + '</p>';
        html += '<p>投入 ' + cost + ' 元（' + totalCombos + ' 注' + (append ? '，含追加' : '') + '）' +
          '；固定奖收益 ' + fixedWin + ' 元' + (floatCombos ? '（浮动奖未计入）' : '') + '　→　' +
          (floatCombos ? '净收益待浮动奖确定' : (fixedWin >= cost ? '净赚 ' + (fixedWin - cost) + ' 元 🎉' : '净亏 ' + (cost - fixedWin) + ' 元')) + '</p>';
      }
      html += '<p class="rules-note">按 2026 年 2 月 2 日起施行的新规判定（9 奖级 → 7 奖级）。彩票开奖为独立随机事件，请理性购彩、量力而行。</p>';
      html += '</div>';
      out.innerHTML = html;
    } catch (e) {
      out.innerHTML = '<p style="color:#c0392b;">⚠️ ' + e.message + '</p>';
    }
  }

  document.getElementById('btnCheck').addEventListener('click', doCheck);
  ['ckFront', 'ckBack', 'ckTerm'].forEach(function (id) {
    document.getElementById(id).addEventListener('keydown', function (e) { if (e.key === 'Enter') doCheck(); });
  });

  // 随机填号 / 清空
  function randPick(pool, k) {
    var out = [];
    while (out.length < k) {
      var idx = Math.floor(Math.random() * pool.length);
      out.push(pool.splice(idx, 1)[0]);
    }
    return out.sort(function (a, b) { return a - b; });
  }
  document.getElementById('btnCheckRandom').addEventListener('click', function () {
    var f = [], b = [], i;
    for (i = 1; i <= 35; i++) f.push(i);
    for (i = 1; i <= 12; i++) b.push(i);
    document.getElementById('ckFront').value = randPick(f, 5).map(pad2).join(' ');
    document.getElementById('ckBack').value = randPick(b, 2).map(pad2).join(' ');
    document.getElementById('ckTerm').value = '';
    document.getElementById('ckResult').innerHTML = '<p class="dim" style="margin-top:10px;">已随机生成一注（5+2），点击「🎯 判定中奖」对照最新一期开奖。</p>';
  });
  document.getElementById('btnCheckClear').addEventListener('click', function () {
    ['ckFront', 'ckBack', 'ckTerm'].forEach(function (id) { document.getElementById(id).value = ''; });
    document.getElementById('ckResult').innerHTML = '';
  });
})();

