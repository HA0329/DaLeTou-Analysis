/*
 * DltCheck — 中奖查询（按 2026 年 2 月 2 日起施行的 7 奖级新规判定，支持复式/追加）
 *
 * 与统计引擎解耦：只依赖 window.DLT_CURRENT_ROWS（当前数据集，含在线更新后的数据）
 * 与 window.DltShared 的输入解析 / 组合数工具。
 */
(function (root) {
  'use strict';

  var Shared = root.DltShared;
  var pad2 = Shared.pad2, esc = Shared.esc, comb = Shared.comb;

  // 奖级映射（新规：13 个中奖条件 → 7 个奖级）
  var PREFIX = { '5+2': 1, '5+1': 2, '5+0': 3, '4+2': 3, '4+1': 4, '4+0': 5, '3+2': 5, '3+1': 6, '2+2': 6, '3+0': 7, '1+2': 7, '2+1': 7, '0+2': 7 };
  var BASE = { 3: 5000, 4: 300, 5: 150, 6: 15, 7: 5 };        // 基本档
  var UP = { 3: 6666, 4: 380, 5: 200, 6: 18, 7: 7 };          // 奖池 ≥ 8 亿升级档
  var NAME = { 1: '一等奖', 2: '二等奖', 3: '三等奖', 4: '四等奖', 5: '五等奖', 6: '六等奖', 7: '七等奖' };
  var COND = { 1: '5+2', 2: '5+1', 3: '5+0 / 4+2', 4: '4+1', 5: '4+0 / 3+2', 6: '3+1 / 2+2', 7: '3+0 / 1+2 / 2+1 / 0+2' };

  var STORE_KEY = 'dlt_check_input_v1';
  var HISTORY_KEY = 'dlt_check_history_v1';
  var MAX_HISTORY = 8;

  function $(id) { return document.getElementById(id); }
  function prizeLevel(f, b) { return PREFIX[f + '+' + b] || 0; }
  function numFmt(n) { return Number(n).toLocaleString('zh-CN'); }

  // 纯函数：按命中个数统计各奖级注数与固定奖金额（不依赖 DOM，便于单测）
  // F/B 为投注号码，FD/BD 为开奖号码，upgraded 表示该期固定奖是否按 8 亿升级档兑付
  function countByLevel(F, B, FD, BD, upgraded) {
    var hitF = F.filter(function (n) { return FD.indexOf(n) >= 0; });
    var hitB = B.filter(function (n) { return BD.indexOf(n) >= 0; });
    var mF = hitF.length, mB = hitB.length, nF = F.length, nB = B.length;
    var stat = {}, f, b;
    for (f = 0; f <= 5; f++) {
      for (b = 0; b <= 2; b++) {
        var cnt = comb(mF, f) * comb(nF - mF, 5 - f) * comb(mB, b) * comb(nB - mB, 2 - b);
        if (!cnt) continue;
        var lv = prizeLevel(f, b);
        if (!lv) continue;
        stat[lv] = stat[lv] || { level: lv, combos: 0, money: 0 };
        stat[lv].combos += cnt;
        stat[lv].money += lv <= 2 ? 0 : cnt * (upgraded ? UP[lv] : BASE[lv]);
      }
    }
    var totalCombos = comb(nF, 5) * comb(nB, 2);
    var covered = 0;
    Object.keys(stat).forEach(function (k) { covered += stat[k].combos; });
    return { stat: stat, mF: mF, mB: mB, hitF: hitF, hitB: hitB, totalCombos: totalCombos, covered: covered };
  }

  function loadStore(key, fallback) {
    try { var v = JSON.parse(localStorage.getItem(key) || 'null'); return v == null ? fallback : v; }
    catch (e) { return fallback; }
  }
  function saveStore(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) { /* 忽略 */ } }

  // 找出目标期次的记录；并给出「开奖前奖池」（决定固定奖档位）
  function locate(rows, term) {
    var idx = 0;
    if (term) {
      idx = -1;
      for (var i = 0; i < rows.length; i++) if (rows[i][0] === term) { idx = i; break; }
      if (idx < 0) throw new Error('未找到期号 ' + term + '，请检查期号是否正确');
    }
    var draw = rows[idx];
    var prePool = idx + 1 < rows.length ? (Number(rows[idx + 1][4]) || 0) : (Number(draw[4]) || 0);
    return { draw: draw, prePool: prePool };
  }

  function doCheck() {
    var out = $('ckResult');
    try {
      var rows = root.DLT_CURRENT_ROWS || [];
      if (!rows.length) throw new Error('数据尚未加载完成，请稍后重试');
      var F = Shared.parseNumsInput($('ckFront').value, 35, 5, Shared.FRONT_MAX_PICK, '前区');
      var B = Shared.parseNumsInput($('ckBack').value, 12, 2, Shared.BACK_MAX_PICK, '后区');
      var term = $('ckTerm').value.trim();
      var append = $('ckAppend').checked;
      var loc = locate(rows, term);
      var draw = loc.draw, FD = draw[2], BD = draw[3];
      var pool = Number(draw[4]) || 0, sales = Number(draw[5]) || 0, prizes = draw[6] || [];
      var upgraded = loc.prePool >= Shared.EIGHT_YI;
      var isNewRule = String(draw[1]) >= Shared.NEW_RULE_DATE;

      var res = countByLevel(F, B, FD, BD, upgraded && isNewRule);
      var hitF = res.hitF, hitB = res.hitB, mF = res.mF, mB = res.mB;
      var totalCombos = res.totalCombos;
      var cost = totalCombos * (append ? 3 : 2);
      var stat = res.stat;

      var html = '<div class="ck-box">';
      html += '<p><b>对照：第 ' + esc(draw[0]) + ' 期（' + esc(draw[1]) + '）</b>　开奖号码：' +
        FD.map(pad2).join(' ') + ' <span class="ck-sep">+</span> ' + BD.map(pad2).join(' ') + '</p>';
      html += '<p>你的前区命中 <b class="ck-hit">' + mF + '</b> 个：' + (hitF.length ? hitF.map(pad2).join(' ') : '—') +
        '；后区命中 <b class="ck-hit">' + mB + '</b> 个：' + (hitB.length ? hitB.map(pad2).join(' ') : '—') + '</p>';
      if (loc.prePool || pool || sales) {
        html += '<p class="dim">该期开奖前奖池 ' + (loc.prePool / 1e8).toFixed(2) + ' 亿元' +
          (isNewRule ? (upgraded ? '（≥8亿，固定奖按升级档兑付）' : '（&lt;8亿，按基本档兑付）') : '') +
          (pool ? '；开奖后滚存 ' + (pool / 1e8).toFixed(2) + ' 亿元' : '') +
          (sales ? '；本期销量 ' + (sales / 1e8).toFixed(2) + ' 亿元' : '') + '</p>';
      }
      if (!isNewRule) {
        html += '<p class="warn-note">⚠️ 该期开奖早于 ' + Shared.NEW_RULE_DATE + '，适用旧规则（9 奖级），此处按 2026 新规 7 奖级判定，结果仅供参考。</p>';
      }
      if (prizes.length) {
        html += '<p class="dim">📢 该期官网开奖公告：' + prizes.map(function (p) {
          var amt = p[2];
          return esc(p[0]) + ' 单注 ' + (amt > 0 ? (amt >= 10000 ? (amt / 10000).toFixed(1) + ' 万' : numFmt(amt) + ' 元') : '—') + ' × ' + numFmt(p[1]) + ' 注';
        }).join('；') + '</p>';
      }

      var keys = Object.keys(stat).map(Number).sort(function (a, b2) { return a - b2; });
      if (!keys.length) {
        html += '<p class="ck-miss"><b>很遗憾，未中奖。</b>共 ' + numFmt(totalCombos) + ' 注，投入 ' + numFmt(cost) + ' 元。</p>';
      } else {
        html += '<table class="rules-table"><thead><tr><th>奖级</th><th>中奖条件</th><th>注数</th><th>单注奖金</th><th>小计</th></tr></thead><tbody>';
        var fixedWin = 0, floatCombos = 0;
        keys.forEach(function (lv) {
          var s2 = stat[lv];
          if (lv <= 2) floatCombos += s2.combos; else fixedWin += s2.money;
          var per = lv <= 2 ? (append ? '浮动 ×1.8（追加）' : '浮动') : (upgraded ? UP[lv] + ' 元' : BASE[lv] + ' 元');
          var sub = lv <= 2 ? s2.combos + ' 注' : numFmt(s2.money) + ' 元';
          html += '<tr><td>' + NAME[lv] + '</td><td>' + COND[lv] + '</td><td>' + numFmt(s2.combos) + '</td><td>' + per + '</td><td>' + sub + '</td></tr>';
        });
        html += '</tbody></table>';
        html += '<p><b>固定奖合计：' + numFmt(fixedWin) + ' 元</b>' +
          (floatCombos ? '；另有浮动奖 ' + numFmt(floatCombos) + ' 注（一/二等奖为浮动奖金，以当期官方开奖公告为准；单注最高 ' + (append ? '1800' : '1000') + ' 万）' : '') + '</p>';
        html += '<p>投入 ' + numFmt(cost) + ' 元（' + numFmt(totalCombos) + ' 注' + (append ? '，含追加' : '') + '）；固定奖收益 ' + numFmt(fixedWin) + ' 元' +
          (floatCombos ? '（浮动奖未计入）' : '') + '　→　' +
          (floatCombos ? '净收益待浮动奖确定' : (fixedWin >= cost
            ? '<span class="ck-win">净赚 ' + numFmt(fixedWin - cost) + ' 元 🎉</span>'
            : '<span class="ck-lose">净亏 ' + numFmt(cost - fixedWin) + ' 元</span>')) + '</p>';
      }
      html += '<p class="rules-note">按 2026 年 2 月 2 日起施行的新规判定（9 奖级 → 7 奖级）。彩票开奖为独立随机事件，请理性购彩、量力而行。</p>';
      html += '</div>';
      out.innerHTML = html;

      // 记录查询历史（最近 8 条）
      if (term || F.length || B.length) {
        var hist = loadStore(HISTORY_KEY, []);
        var entry = { f: F.map(pad2).join(' '), b: B.map(pad2).join(' '), term: term, append: append, ts: Date.now(), lv: keys.length ? NAME[keys[0]] : '未中奖' };
        hist = hist.filter(function (h) { return !(h.f === entry.f && h.b === entry.b && h.term === entry.term); });
        hist.unshift(entry);
        saveStore(HISTORY_KEY, hist.slice(0, MAX_HISTORY));
        renderHistory();
      }
    } catch (e) {
      out.innerHTML = '<p class="ck-error">⚠️ ' + esc(e.message) + '</p>';
    }
  }

  function renderHistory() {
    var el = $('ckHistory');
    if (!el) return;
    var hist = loadStore(HISTORY_KEY, []);
    if (!hist.length) { el.innerHTML = '<p class="hint">暂无查询记录。输入号码并判定后会自动记录最近 8 次。</p>'; return; }
    el.innerHTML = '<div class="ck-hist">' + hist.map(function (h, i) {
      return '<button class="ck-hist-item" data-i="' + i + '" title="点击回填该次查询">' +
        '<span class="ck-hist-num">' + esc(h.f) + ' <span class="ck-sep">+</span> ' + esc(h.b) + '</span>' +
        '<span class="ck-hist-meta">' + (h.term ? '第 ' + esc(h.term) + ' 期' : '最新一期') + (h.append ? ' · 追加' : '') + ' · ' + esc(h.lv) + '</span></button>';
    }).join('') + '</div>';
    el.querySelectorAll('.ck-hist-item').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var h = hist[+btn.dataset.i];
        if (!h) return;
        $('ckFront').value = h.f;
        $('ckBack').value = h.b;
        $('ckTerm').value = h.term || '';
        $('ckAppend').checked = !!h.append;
        doCheck();
      });
    });
  }

  function fillRandom() {
    var f = [], b = [], i;
    for (i = 1; i <= 35; i++) f.push(i);
    for (i = 1; i <= 12; i++) b.push(i);
    $('ckFront').value = Shared.sampleUniform(f, 5).map(pad2).join(' ');
    $('ckBack').value = Shared.sampleUniform(b, 2).map(pad2).join(' ');
    $('ckTerm').value = '';
    $('ckResult').innerHTML = '<p class="hint">已随机生成一注（5+2），点击「🎯 判定中奖」对照最新一期开奖。</p>';
  }

  function clearAll() {
    ['ckFront', 'ckBack', 'ckTerm'].forEach(function (id) { $(id).value = ''; });
    $('ckAppend').checked = false;
    $('ckResult').innerHTML = '';
    saveStore(STORE_KEY, null);
  }

  function persistInput() {
    saveStore(STORE_KEY, { f: $('ckFront').value, b: $('ckBack').value, term: $('ckTerm').value, append: $('ckAppend').checked });
  }

  function init() {
    var saved = loadStore(STORE_KEY, null);
    if (saved) {
      $('ckFront').value = saved.f || '';
      $('ckBack').value = saved.b || '';
      $('ckTerm').value = saved.term || '';
      $('ckAppend').checked = !!saved.append;
    }
    $('btnCheck').addEventListener('click', doCheck);
    $('btnCheckRandom').addEventListener('click', fillRandom);
    $('btnCheckClear').addEventListener('click', clearAll);
    ['ckFront', 'ckBack', 'ckTerm'].forEach(function (id) {
      $(id).addEventListener('keydown', function (e) { if (e.key === 'Enter') doCheck(); });
      $(id).addEventListener('change', persistInput);
    });
    $('ckAppend').addEventListener('change', persistInput);
    renderHistory();
  }

  // 供开奖记录「点击期号」调用：填入期号并跳到查询区
  function fillTerm(term) {
    $('ckTerm').value = term;
    persistInput();
  }

  root.DltCheck = {
    init: init, run: doCheck, fillTerm: fillTerm,
    // 供单元测试使用（纯计算，无 DOM 依赖）
    countByLevel: countByLevel,
    RULES: { PREFIX: PREFIX, BASE: BASE, UP: UP, NAME: NAME, COND: COND }
  };
})(typeof window !== 'undefined' ? window : this);
