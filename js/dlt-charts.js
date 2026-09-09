/*
 * DltCharts — 轻量 canvas 图表引擎（零依赖，浏览器专用）
 *
 * 支持三种图：bar（柱状）/ line（折线，多序列 + 参考线）/ heat（矩阵热力图）。
 * 统一负责：DPR 高清适配、响应式重绘（register + redrawAll）、悬停高亮与 tooltip、
 * 暗色 / 亮色主题（setTheme）。
 *
 * 用法：
 *   DltCharts.register(canvasEl, function () {
 *     DltCharts.bar(canvasEl, { labels: [...], values: [...], valueTop: true });
 *   });
 */
(function (root) {
  'use strict';

  var THEME = {
    grid: '#edf0f5', axis: '#9aa1ad', label: '#7a8291', value: '#4a5160',
    highlight: '#20242e', tipBg: 'rgba(32,36,46,.93)', tipFg: '#fff',
    heatEmpty: '#f7f8fb',
    heatPalette: ['#eef3fb', '#f8d7d7', '#f4b1b1', '#ef8a8a', '#e55d5d', '#c22a2a'],
    heatDiverging: ['#2f6fd6', '#7fa4e0', '#c9dbf5', '#f2f4f8', '#f4b1b1', '#e55d5d', '#c22a2a']
  };
  function setTheme(t) {
    for (var k in t) if (Object.prototype.hasOwnProperty.call(t, k)) THEME[k] = t[k];
    redrawAll();
  }
  function getTheme() { return THEME; }

  var canvases = [];                 // 已注册的 canvas（供重绘）
  var hoverMap = new WeakMap();      // canvas → 当前悬停索引（-1 表示无）
  var tipTimers = new WeakMap();

  function hoverOf(canvas) {
    var v = hoverMap.get(canvas);
    return v == null ? -1 : v;
  }

  // 注册并立即绘制；builder 内调用 bar/line/heat
  function register(canvas, builder) {
    if (!canvas) return;
    // 清掉已从文档移除的旧画布（详情区每次重建都会产生新 canvas）
    canvases = canvases.filter(function (c) { return c.isConnected; });
    if (canvases.indexOf(canvas) < 0) canvases.push(canvas);
    canvas._builder = builder;
    canvas._redraw = function (idx) {
      if (idx !== undefined) hoverMap.set(canvas, idx);
      builder();
    };
    builder();
  }

  function redrawAll() {
    canvases.forEach(function (c) {
      if (!c.isConnected) return;
      if (c.offsetParent === null && !c.clientWidth) return;  // 折叠面板内不绘制
      if (c._builder) c._builder();
    });
  }

  // ---------- 画布初始化 ----------
  function setupCanvas(canvas, heightOverride) {
    var dpr = root.devicePixelRatio || 1;
    var w = canvas.clientWidth || (canvas.parentNode && canvas.parentNode.clientWidth) || 600;
    var h = heightOverride || parseInt(canvas.getAttribute('height'), 10) || 220;
    canvas.width = Math.max(1, Math.round(w * dpr));
    canvas.height = Math.max(1, Math.round(h * dpr));
    canvas.style.height = h + 'px';
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    return { ctx: ctx, w: w, h: h };
  }

  // 坐标轴刻度文字（数值）
  function drawYGrid(ctx, opts) {
    var padL = opts.padL, padT = opts.padT, padR = opts.padR, plotW = opts.plotW, plotH = opts.plotH, w = opts.w;
    var ticks = opts.ticks || 4, t;
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (t = 0; t <= ticks; t++) {
      var yv = opts.yMin + (opts.yMax - opts.yMin) * t / ticks;
      var y = padT + plotH - plotH * t / ticks;
      ctx.strokeStyle = THEME.grid;
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w - padR, y); ctx.stroke();
      ctx.fillStyle = THEME.axis;
      ctx.fillText(opts.yFmt ? opts.yFmt(yv) : String(Math.round(yv)), padL - 5, y);
    }
  }

  // X 轴标签：按可用宽度自动跳格，避免 35 个柱的标签挤成一团
  function drawXLabels(ctx, labels, X, y, slot) {
    var step = Math.max(1, Math.ceil(22 / Math.max(slot, 1)));
    ctx.fillStyle = THEME.label;
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (var i = 0; i < labels.length; i++) {
      if (i % step !== 0 && i !== labels.length - 1) continue;
      ctx.fillText(String(labels[i]), X(i), y);
    }
  }

  // ---------- 柱状图 ----------
  function bar(canvas, opts) {
    var s = setupCanvas(canvas), ctx = s.ctx, w = s.w, h = s.h;
    var padL = opts.padL || 42, padR = 10, padT = 18, padB = opts.padB || 26;
    var labels = opts.labels || [], values = opts.values || [];
    if (!labels.length) return;
    var max = Math.max.apply(null, values.concat([0])) || 1;
    var yMax = opts.yMax || max * 1.12 || 1;
    var yMin = opts.yMin || 0;
    var plotW = w - padL - padR, plotH = h - padT - padB;
    var bw = plotW / labels.length;
    var barW = Math.min(bw * 0.68, opts.maxBarWidth || 26);
    var hoverIdx = hoverOf(canvas);

    drawYGrid(ctx, { padL: padL, padR: padR, padT: padT, plotW: plotW, plotH: plotH, w: w, yMin: yMin, yMax: yMax, yFmt: opts.yFmt, ticks: opts.ticks });

    var i;
    for (i = 0; i < labels.length; i++) {
      var x = padL + bw * i + bw / 2;
      var vh = plotH * (values[i] - yMin) / (yMax - yMin || 1);
      vh = Math.max(vh, values[i] > yMin ? 1 : 0);
      var color = opts.colors
        ? (typeof opts.colors === 'function' ? opts.colors(i, values[i]) : opts.colors[i % opts.colors.length])
        : '#e25b5b';
      var rx = x - barW / 2, ry = padT + plotH - vh;
      ctx.fillStyle = color;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(rx, ry, barW, Math.max(vh, 1), [3, 3, 0, 0]); else ctx.rect(rx, ry, barW, Math.max(vh, 1));
      ctx.fill();
      if (hoverIdx === i) {
        ctx.strokeStyle = THEME.highlight; ctx.lineWidth = 1.5; ctx.stroke(); ctx.lineWidth = 1;
      }
      if (opts.valueTop && bw >= 15 && vh > 9) {
        ctx.fillStyle = THEME.value; ctx.font = '9.5px sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
        ctx.fillText(String(opts.valueFmt ? opts.valueFmt(values[i]) : values[i]), x, ry - 2);
      }
    }
    drawXLabels(ctx, labels, function (i) { return padL + bw * i + bw / 2; }, padT + plotH + 6, bw);
    ctx.textBaseline = 'alphabetic';

    canvas._dl = { kind: 'bar', labels: labels, values: values, padL: padL, bw: bw, tipFmt: opts.tipFmt, xFmt: opts.xFmt };
  }

  // ---------- 折线图（多序列） ----------
  function line(canvas, opts) {
    var s = setupCanvas(canvas), ctx = s.ctx, w = s.w, h = s.h;
    var padL = opts.padL || 44, padR = 12, padT = 16, padB = opts.padB || 24;
    var series = opts.series || [];
    if (!series.length || !series[0].data.length) return;
    var n = series[0].data.length;
    var lo = Infinity, hi = -Infinity, i;
    series.forEach(function (se) {
      se.data.forEach(function (v) { if (v != null && isFinite(v)) { if (v < lo) lo = v; if (v > hi) hi = v; } });
    });
    if (!isFinite(lo)) { lo = 0; hi = 1; }
    var span = (hi - lo) || 1;
    var yMin = opts.yMin != null ? opts.yMin : Math.floor(lo - span * 0.12);
    var yMax = opts.yMax != null ? opts.yMax : Math.ceil(hi + span * 0.12);
    if (yMax === yMin) yMax = yMin + 1;
    var plotW = w - padL - padR, plotH = h - padT - padB;
    function X(i2) { return padL + plotW * (n <= 1 ? 0.5 : i2 / (n - 1)); }
    function Y(v) { return padT + plotH * (1 - (v - yMin) / (yMax - yMin)); }

    drawYGrid(ctx, { padL: padL, padR: padR, padT: padT, plotW: plotW, plotH: plotH, w: w, yMin: yMin, yMax: yMax, yFmt: opts.yFmt, ticks: opts.ticks });

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
        if (v == null || !isFinite(v)) { started = false; continue; }
        var x = X(i), y = Y(v);
        if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    });

    var hoverIdx = hoverOf(canvas);
    if (hoverIdx != null && hoverIdx >= 0 && hoverIdx < n) {
      var hx = X(hoverIdx);
      ctx.strokeStyle = 'rgba(32,36,46,.38)'; ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(hx, padT); ctx.lineTo(hx, padT + plotH); ctx.stroke();
      ctx.setLineDash([]);
      series.forEach(function (se) {
        var v = se.data[hoverIdx];
        if (v == null || !isFinite(v)) return;
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(hx, Y(v), 3.2, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = se.color; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(hx, Y(v), 3.2, 0, Math.PI * 2); ctx.stroke();
        ctx.lineWidth = 1;
      });
    }

    if (opts.xLabels) {
      drawXLabels(ctx, opts.xLabels, X, padT + plotH + 7, plotW / Math.max(n - 1, 1));
    }
    ctx.textBaseline = 'alphabetic';
    canvas._dl = { kind: 'line', series: series, n: n, xLabels: opts.xLabels, padL: padL, plotW: plotW };
  }

  // ---------- 热力图（矩阵） ----------
  // opts: { rowLabels, colLabels, matrix[rowIdx][colIdx], center, expected, cell }
  // 传 center（如理论期望次数）时使用「以期望为中心」的双向色阶：偏少偏蓝、偏多偏红，
  // 比单纯按最大值归一化更能凸显显著偏差（同现次数分布很集中，按 max 归一化会一片通红）。
  function heat(canvas, opts) {
    var rows = opts.rowLabels.length, cols = opts.colLabels.length;
    var w0 = canvas.clientWidth || (canvas.parentNode && canvas.parentNode.clientWidth) || 600;
    var padL = 30, padT = 24, padB = 8, padR = 6;
    var cell = Math.max(8, Math.min(opts.cell || 16, Math.floor((w0 - padL - padR) / cols)));
    var needH = padT + cell * rows + padB;
    var s = setupCanvas(canvas, needH), ctx = s.ctx, w = s.w;
    var i, j, v;
    var maxV = 0, maxDev = 0;
    var center = opts.center;
    for (i = 0; i < rows; i++) {
      for (j = 0; j < cols; j++) {
        v = opts.matrix[i][j];
        if (v > maxV) maxV = v;
        if (center != null) { var dv = Math.abs(v - center); if (dv > maxDev) maxDev = dv; }
      }
    }
    if (!maxV) maxV = 1;
    if (!maxDev) maxDev = 1;

    var palette = THEME.heatPalette || ['#eef3fb', '#f8d7d7', '#f4b1b1', '#ef8a8a', '#e55d5d', '#c22a2a'];
    var diverge = THEME.heatDiverging || ['#2f6fd6', '#7fa4e0', '#c9dbf5', '#f2f4f8', '#f4b1b1', '#e55d5d', '#c22a2a'];

    // 返回 {color, ratio}；ratio ∈ [-1,1] 表示相对期望的偏离程度
    function colorOf(val, row, col) {
      if (row === col) return { color: THEME.heatEmpty, ratio: 0 };
      if (!val) return { color: THEME.heatEmpty, ratio: 0 };
      if (center != null) {
        var r = (val - center) / maxDev;
        r = Math.max(-1, Math.min(1, r));
        var idx = Math.round((r + 1) / 2 * (diverge.length - 1));
        return { color: diverge[idx], ratio: r };
      }
      var rr = Math.sqrt(val / maxV);
      return { color: palette[Math.min(palette.length - 1, Math.floor(rr * palette.length))], ratio: rr };
    }

    ctx.font = '9px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (i = 0; i < rows; i++) {
      for (j = 0; j < cols; j++) {
        v = opts.matrix[i][j];
        var c = colorOf(v, i, j);
        var x = padL + j * cell, y = padT + i * cell;
        ctx.fillStyle = c.color;
        ctx.fillRect(x, y, cell - 0.6, cell - 0.6);
        // 只标注「显著偏离期望」的格子，否则 35×35 全是数字会糊成一片
        if (v && cell >= 13 && Math.abs(c.ratio) >= 0.5) {
          ctx.fillStyle = Math.abs(c.ratio) > 0.8 ? '#fff' : (center != null && c.ratio > 0 ? '#7a2020' : THEME.value);
          ctx.fillText(String(v), x + cell / 2 - 0.3, y + cell / 2);
        }
      }
    }
    // 轴标签：每 5 个标一次，避免拥挤
    ctx.fillStyle = THEME.axis;
    ctx.font = '9.5px sans-serif';
    for (i = 0; i < rows; i++) {
      if (i % 5 !== 0 && i !== rows - 1) continue;
      ctx.textAlign = 'right';
      ctx.fillText(String(opts.rowLabels[i]), padL - 3, padT + i * cell + cell / 2);
      ctx.textAlign = 'center';
      ctx.fillText(String(opts.colLabels[i]), padL + i * cell + cell / 2, padT - 10);
    }
    canvas._dl = {
      kind: 'heat', matrix: opts.matrix, rowLabels: opts.rowLabels, colLabels: opts.colLabels,
      cell: cell, padL: padL, padT: padT, expected: opts.expected, valueFmt: opts.valueFmt
    };
  }

  // ---------- 全局悬停：高亮 + tooltip ----------
  function showTip(canvas, html, x, y) {
    var tipEl = canvas.parentNode && canvas.parentNode.querySelector('.chart-tip');
    if (!tipEl) return;
    tipEl.innerHTML = html;
    tipEl.style.display = 'block';
    var boxW = canvas.parentNode.clientWidth;
    var tx = x + 14, ty = y - 8;
    if (tx + tipEl.offsetWidth > boxW - 4) tx = boxW - tipEl.offsetWidth - 4;
    tipEl.style.left = Math.max(2, tx) + 'px';
    tipEl.style.top = Math.max(2, ty) + 'px';
  }
  function hideTip(canvas) {
    var tipEl = canvas.parentNode && canvas.parentNode.querySelector('.chart-tip');
    if (tipEl) tipEl.style.display = 'none';
  }

  function hitTest(canvas, dl, x, y) {
    var i;
    if (dl.kind === 'bar') {
      i = Math.floor((x - dl.padL) / dl.bw);
      if (i < 0 || i >= dl.labels.length || x < dl.padL) return null;
      return { idx: i, html: '<b>' + (dl.xFmt ? dl.xFmt(dl.labels[i]) : dl.labels[i]) + '</b>：' + (dl.tipFmt ? dl.tipFmt(dl.values[i], i) : dl.values[i]) };
    }
    if (dl.kind === 'line') {
      i = Math.round((x - dl.padL) / dl.plotW * (dl.n - 1));
      if (i < 0 || i >= dl.n || x < dl.padL || x > dl.padL + dl.plotW) return null;
      var parts = [];
      if (dl.xLabels) parts.push('<b>' + dl.xLabels[i] + '</b>');
      dl.series.forEach(function (se) {
        var v = se.data[i];
        if (v == null) return;
        parts.push('<span style="color:' + se.color + '">●</span> ' + (se.name ? se.name : '') + (se.tipFmt ? se.tipFmt(v) : v));
      });
      return { idx: i, html: parts.join('　') };
    }
    if (dl.kind === 'heat') {
      var col = Math.floor((x - dl.padL) / dl.cell), row = Math.floor((y - dl.padT) / dl.cell);
      if (row < 0 || col < 0 || row >= dl.matrix.length || col >= dl.matrix[0].length) return null;
      var v2 = dl.matrix[row][col];
      if (row === col) return { idx: -1, html: '<b>' + dl.rowLabels[row] + '</b>（对角线）' };
      var ratio = dl.expected ? (v2 / dl.expected) : 0;
      return {
        idx: -1,
        html: '<b>' + dl.rowLabels[row] + ' + ' + dl.colLabels[col] + '</b>：同现 ' + v2 + ' 次' +
          (dl.expected ? '（期望 ' + dl.expected.toFixed(1) + ' 次，' + ratio.toFixed(2) + '×）' : '')
      };
    }
    return null;
  }

  function attachHover() {
    document.addEventListener('mousemove', function (ev) {
      var cv = ev.target;
      var dl = cv && cv._dl ? cv._dl : null;
      // 先清理其它图表的残留高亮与 tooltip
      canvases.forEach(function (c) {
        if (c === cv) return;
        if (hoverOf(c) >= 0) { hoverMap.set(c, -1); if (c._redraw) c._redraw(-1); }
        hideTip(c);
      });
      if (!dl) return;
      var rect = cv.getBoundingClientRect();
      var x = ev.clientX - rect.left, y = ev.clientY - rect.top;
      var hit = hitTest(cv, dl, x, y);
      var idx = hit ? hit.idx : -1;
      if (hoverOf(cv) !== idx) { hoverMap.set(cv, idx); if (cv._redraw) cv._redraw(idx); }
      if (hit) showTip(cv, hit.html, x, y); else hideTip(cv);
    }, { passive: true });

    // 鼠标离开窗口时清除全部 tooltip
    document.addEventListener('mouseleave', function () {
      canvases.forEach(function (c) {
        if (hoverOf(c) >= 0) { hoverMap.set(c, -1); if (c._redraw) c._redraw(-1); }
        hideTip(c);
      });
    });
  }

  root.DltCharts = {
    bar: bar, line: line, heat: heat,
    register: register, redrawAll: redrawAll,
    setTheme: setTheme, getTheme: getTheme,
    attachHover: attachHover,
    hoverOf: hoverOf
  };
})(typeof window !== 'undefined' ? window : this);
