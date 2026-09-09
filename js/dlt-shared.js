/*
 * DltShared — 大乐透数据分析：通用基础工具（浏览器 / Node 共用，零依赖）
 *
 * 设计目的：原先 server.js / update.js / app.js 各自复制了一份「官网记录 → 紧凑行」转换、
 * 数据校验与 data.js 生成逻辑，三处容易改一处漏两处。本文件是唯一实现，
 * Node 端 require 使用，浏览器端经 <script defer src="js/dlt-shared.js"> 暴露为 window.DltShared。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DltShared = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------- 常量 ----------
  var FRONT_MAX = 35, BACK_MAX = 12;      // 前区 01–35、后区 01–12
  var FRONT_PICK = 5, BACK_PICK = 2;      // 单注基本投注个数
  var FRONT_MAX_PICK = 12, BACK_MAX_PICK = 6; // 复式投注个数上限（大乐透规则）
  var EIGHT_YI = 800000000;               // 奖池 ≥ 8 亿 → 三至七等奖按升级档兑付
  var NEW_RULE_DATE = '2026-02-02';       // 2026 新规（9 奖级 → 7 奖级 + 8 亿升级档）施行日
  var DRAW_WEEKDAYS = [1, 3, 6];          // 开奖日：周一 / 周三 / 周六
  var DRAW_HOUR = 21, DRAW_MINUTE = 25;   // 开奖时间 21:25（21:00 停售）
  var WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

  // ---------- 数字 / 文本格式化 ----------
  function pad2(n) { return n < 10 ? '0' + n : '' + n; }

  // HTML 转义：所有进入 innerHTML 的外部数据（官网奖级名、用户搜索词、期号等）都必须过一遍，
  // 否则「🎯 中奖查询」的搜索框或官网返回字段可注入脚本（DOM-based XSS）。
  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function fmtPct(x) { return (x * 100).toFixed(2) + '%'; }
  function fmtYi(n) { return (Number(n) / 100000000).toFixed(2) + ' 亿'; }
  function fmtMoney(n) {
    n = Number(n) || 0;
    if (n <= 0) return '—';
    if (n >= 100000000) return (n / 100000000).toFixed(2) + ' 亿元';
    if (n >= 10000) return (n / 10000).toFixed(1) + ' 万元';
    return n.toLocaleString('zh-CN') + ' 元';
  }
  function fmtNum(n) { return n ? Number(n).toLocaleString('zh-CN') : '—'; }

  function fmtDate(d) {
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }
  function weekdayName(dateStr) {
    var d = new Date(String(dateStr).replace(/-/g, '/'));
    return isNaN(d.getTime()) ? '' : WEEKDAYS[d.getDay()];
  }

  // ---------- 开奖时间推算（取代原先硬编码「周三←周一」的易错写法） ----------
  function isDrawDay(d) { return DRAW_WEEKDAYS.indexOf(d.getDay()) >= 0; }

  // 下一次开奖（严格晚于 now）；now 省略则取当前时间
  function nextDrawInfo(now) {
    var base = now ? new Date(now) : new Date();
    for (var i = 0; i < 8; i++) {
      var d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + i, DRAW_HOUR, DRAW_MINUTE, 0, 0);
      if (isDrawDay(d) && d.getTime() > base.getTime()) {
        return { time: d, label: fmtDate(d) + '（' + WEEKDAYS[d.getDay()] + '）' };
      }
    }
    return null;
  }

  // 最近一次已到点的开奖（<= now）
  function prevDrawInfo(now) {
    var base = now ? new Date(now) : new Date();
    for (var i = 0; i < 8; i++) {
      var d = new Date(base.getFullYear(), base.getMonth(), base.getDate() - i, DRAW_HOUR, DRAW_MINUTE, 0, 0);
      if (isDrawDay(d) && d.getTime() <= base.getTime()) {
        return { time: d, label: fmtDate(d) + '（' + WEEKDAYS[d.getDay()] + '）' };
      }
    }
    return null;
  }

  // ---------- 可复现随机数（回测/模拟选号需要稳定的结果） ----------
  // mulberry32：32 位种子 → [0,1) 均匀随机，速度快、周期足够统计使用
  function mulberry32(seed) {
    var a = (seed >>> 0) || 1;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // 无放回均匀抽样（rng 省略时用 Math.random）
  function sampleUniform(pool, k, rng) {
    rng = rng || Math.random;
    var items = pool.slice(), out = [];
    while (out.length < k && items.length) {
      var i = Math.floor(rng() * items.length);
      out.push(items[i]);
      items.splice(i, 1);
    }
    return out.sort(function (a, b) { return a - b; });
  }

  // 无放回加权抽样：weights 可为 {num: w} 或 function(num) → w
  function sampleWeighted(pool, weights, k, rng) {
    rng = rng || Math.random;
    var items = pool.slice(), out = [];
    var wOf = typeof weights === 'function' ? weights : function (n) { return weights[n]; };
    while (out.length < k && items.length) {
      var tot = 0, ws = [], i, w;
      for (i = 0; i < items.length; i++) { w = Number(wOf(items[i])) || 0; ws.push(w); tot += w; }
      var chosen = items.length - 1;
      if (tot > 0) {
        var r = rng() * tot, acc = 0;
        for (i = 0; i < items.length; i++) { acc += ws[i]; if (r <= acc) { chosen = i; break; } }
      } else {
        chosen = Math.floor(rng() * items.length);
      }
      out.push(items[chosen]);
      items.splice(chosen, 1);
    }
    return out.sort(function (a, b) { return a - b; });
  }

  // 组合数 C(n,k)（大乐透复式注数计算，n 最大 12，用整数递推避免浮点误差）
  function comb(n, k) {
    if (k < 0 || k > n || n < 0) return 0;
    var r = 1;
    for (var i = 0; i < k; i++) r = r * (n - i) / (i + 1);
    return Math.round(r);
  }

  // ---------- 数据行 ----------
  // 紧凑行格式 v2：[期号, 开奖日期, 前区[5], 后区[2], 奖池(开奖后滚存), 销量, 开奖公告[[奖级,注数,单注奖金],...]]

  // 官网接口单条记录 → 紧凑行
  function toRow(it) {
    if (!it || !it.lotteryDrawResult) throw new Error('官网记录缺少开奖号码字段');
    var nums = String(it.lotteryDrawResult).trim().split(/\s+/).filter(Boolean).map(Number);
    if (nums.length !== FRONT_PICK + BACK_PICK) {
      throw new Error('期号 ' + it.lotteryDrawNum + ' 开奖号码异常：' + it.lotteryDrawResult);
    }
    if (nums.some(function (n) { return !Number.isInteger(n); })) {
      throw new Error('期号 ' + it.lotteryDrawNum + ' 开奖号码非整数：' + it.lotteryDrawResult);
    }
    var pool = Number(String(it.poolBalanceAfterdraw || '0').replace(/,/g, '')) || 0;
    var sales = Number(String(it.totalSaleAmount || '').replace(/,/g, '')) || 0;
    // 官网对「无人中奖」的奖级返回占位符（stakeAmountFormat: "-1"、stakeAmount: "---"），
    // 负数 / NaN 统一归一为 0（0 注即 0 元，与官方语义一致，也能通过 assertRows 校验）
    var toNum = function (v) {
      var n = Number(String(v == null ? '' : v).replace(/,/g, ''));
      return Number.isFinite(n) && n > 0 ? n : 0;
    };
    var prizes = (it.prizeLevelList || []).map(function (p) {
      return [String(p.prizeLevel || ''), toNum(p.stakeCount), toNum(p.stakeAmountFormat) || toNum(p.stakeAmount)];
    }).filter(function (p) { return p[0]; });
    return [String(it.lotteryDrawNum), String(it.lotteryDrawTime), nums.slice(0, FRONT_PICK), nums.slice(FRONT_PICK), pool, sales, prizes];
  }

  // 全量校验：期号唯一、号码范围合法且升序、日期格式、奖池/销量/公告结构。
  // 写入 data.js 之前必须通过，避免坏数据破坏页面。
  function assertRows(rows, opts) {
    opts = opts || {};
    if (!Array.isArray(rows)) throw new Error('数据不是数组');
    var min = opts.min == null ? 1 : opts.min;
    if (rows.length < min) throw new Error('数据异常：期数过少（' + rows.length + ' < ' + min + '）');
    var seen = Object.create(null);
    for (var idx = 0; idx < rows.length; idx++) {
      var r = rows[idx];
      if (!Array.isArray(r) || r.length < 4) throw new Error('第 ' + (idx + 1) + ' 行格式异常');
      var issue = String(r[0]);
      if (!/^\d{5}$/.test(issue)) throw new Error('期号格式异常：' + r[0]);
      if (seen[issue]) throw new Error('期号重复：' + issue);
      seen[issue] = true;
      if (!/^\d{4}-\d{2}-\d{2}/.test(String(r[1]))) throw new Error('开奖日期格式异常：' + issue + ' → ' + r[1]);
      if (!Array.isArray(r[2]) || r[2].length !== FRONT_PICK) throw new Error('前区异常：' + issue);
      if (!Array.isArray(r[3]) || r[3].length !== BACK_PICK) throw new Error('后区异常：' + issue);
      var i, n;
      for (i = 0; i < FRONT_PICK; i++) {
        n = Number(r[2][i]);
        if (!Number.isInteger(n) || n < 1 || n > FRONT_MAX || (i > 0 && n <= Number(r[2][i - 1]))) throw new Error('前区异常：' + issue);
      }
      for (i = 0; i < BACK_PICK; i++) {
        n = Number(r[3][i]);
        if (!Number.isInteger(n) || n < 1 || n > BACK_MAX || (i > 0 && n <= Number(r[3][i - 1]))) throw new Error('后区异常：' + issue);
      }
      if (r[4] !== undefined && r[4] !== null && (!Number.isFinite(Number(r[4])) || Number(r[4]) < 0)) throw new Error('奖池异常：' + issue);
      if (r[5] !== undefined && r[5] !== null && (!Number.isFinite(Number(r[5])) || Number(r[5]) < 0)) throw new Error('销量异常：' + issue);
      if (r[6] !== undefined && r[6] !== null) {
        if (!Array.isArray(r[6])) throw new Error('公告异常：' + issue);
        for (var p = 0; p < r[6].length; p++) {
          var row = r[6][p];
          if (!Array.isArray(row) || row.length < 3) throw new Error('公告条目异常：' + issue);
          if (typeof row[0] !== 'string' || !row[0]) throw new Error('公告奖级异常：' + issue);
          if (!Number.isInteger(Number(row[1])) || Number(row[1]) < 0) throw new Error('公告注数异常：' + issue);
          if (!Number.isFinite(Number(row[2])) || Number(row[2]) < 0) throw new Error('公告奖金异常：' + issue);
        }
      }
    }
    // 期号须严格降序（最新在前）：统计、分页与增量更新都依赖这一前提
    for (var q = 1; q < rows.length; q++) {
      if (String(rows[q][0]) >= String(rows[q - 1][0])) {
        throw new Error('期号未按降序排列：' + rows[q - 1][0] + ' → ' + rows[q][0]);
      }
    }
    return true;
  }

  // 新数据（最新在前）+ 旧数据合并去重，按期号降序
  function mergeRows(newRows, oldRows) {
    var seen = Object.create(null), clean = [];
    oldRows.forEach(function (r) { seen[String(r[0])] = true; });
    // 先对 newRows 内部去重（官网偶发重复返回同一条记录），否则 assertRows 会因期号重复而拒绝写入
    newRows.forEach(function (r) {
      var k = String(r[0]);
      if (seen[k]) return;
      seen[k] = true;
      clean.push(r);
    });
    var merged = clean.concat(oldRows);
    merged.sort(function (a, b) { return String(b[0]) < String(a[0]) ? -1 : String(b[0]) > String(a[0]) ? 1 : 0; });
    return merged;
  }

  // 生成 data.js 文件内容（update.js 与 server.js 共用，保证两处输出完全一致）
  function dataFileContent(rows) {
    return [
      '// 大乐透历史开奖数据（自动生成，请勿手动编辑）',
      '// 数据来源：中国体育彩票官网 webapi.sporttery.cn',
      '// 数据格式 v2：每期为 [期号, 开奖日期, 前区[5], 后区[2], 奖池, 销量, 开奖公告[[奖级,注数,单注奖金],...]]',
      '// 最新一期：第 ' + rows[0][0] + ' 期（' + rows[0][1] + '），共 ' + rows.length + ' 期',
      'var RAW_DATA = ' + JSON.stringify(rows) + ';',
      ''
    ].join('\n');
  }

  // 从 data.js 文本中取出 RAW_DATA 数组（括号匹配定位，不依赖分号/换行）
  function parseDataFileText(content) {
    var marker = 'var RAW_DATA = ';
    var start = String(content).indexOf(marker);
    if (start < 0) throw new Error('data.js 中未找到 RAW_DATA 标记');
    var arrStart = start + marker.length;
    var depth = 0, arrEnd = -1;
    for (var i = arrStart; i < content.length; i++) {
      var ch = content[i];
      if (ch === '[') depth++;
      else if (ch === ']') { depth--; if (depth === 0) { arrEnd = i; break; } }
    }
    if (arrEnd < 0) throw new Error('data.js 数据块不完整');
    var parsed = JSON.parse(content.slice(arrStart, arrEnd + 1));
    if (!Array.isArray(parsed)) throw new Error('data.js 数据块不是数组');
    return parsed;
  }

  // ---------- 输入解析 ----------
  // 解析用户输入的号码串（空格 / 逗号 / 顿号分隔）
  function parseNumsInput(str, max, min, maxCount, label) {
    var arr = String(str == null ? '' : str).trim().split(/[\s,，、]+/).filter(Boolean).map(function (x) {
      var n = parseInt(x, 10);
      if (isNaN(n) || n < 1 || n > max) throw new Error(label + '号码需在 1–' + max + ' 之间：' + x);
      return n;
    });
    if (arr.length < min) throw new Error(label + '至少需要 ' + min + ' 个号码');
    if (arr.length > maxCount) throw new Error(label + '号码太多（复式最多 ' + maxCount + ' 个）');
    if (new Set(arr).size !== arr.length) throw new Error(label + '号码不能重复');
    return arr.sort(function (a, b) { return a - b; });
  }

  // ---------- CSV ----------
  function csvCell(v) {
    var s = String(v == null ? '' : v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function buildCsv(header, rows) {
    var lines = [header.map(csvCell).join(',')];
    rows.forEach(function (r) { lines.push(r.map(csvCell).join(',')); });
    return '\ufeff' + lines.join('\r\n');   // BOM：Excel 正确识别 UTF-8
  }

  return {
    FRONT_MAX: FRONT_MAX, BACK_MAX: BACK_MAX,
    FRONT_PICK: FRONT_PICK, BACK_PICK: BACK_PICK,
    FRONT_MAX_PICK: FRONT_MAX_PICK, BACK_MAX_PICK: BACK_MAX_PICK,
    EIGHT_YI: EIGHT_YI, WEEKDAYS: WEEKDAYS, NEW_RULE_DATE: NEW_RULE_DATE,
    DRAW_HOUR: DRAW_HOUR, DRAW_MINUTE: DRAW_MINUTE,
    pad2: pad2, esc: esc,
    fmtPct: fmtPct, fmtYi: fmtYi, fmtMoney: fmtMoney, fmtNum: fmtNum,
    fmtDate: fmtDate, weekdayName: weekdayName,
    isDrawDay: isDrawDay, nextDrawInfo: nextDrawInfo, prevDrawInfo: prevDrawInfo,
    mulberry32: mulberry32, sampleUniform: sampleUniform, sampleWeighted: sampleWeighted, comb: comb,
    toRow: toRow, assertRows: assertRows, mergeRows: mergeRows,
    dataFileContent: dataFileContent, parseDataFileText: parseDataFileText,
    parseNumsInput: parseNumsInput, buildCsv: buildCsv
  };
});
