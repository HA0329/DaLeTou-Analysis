/*
 * DltCore — 大乐透历史数据分析核心：纯统计计算（浏览器 / Node 共用，零依赖）
 *
 * 输入 raw：紧凑行数组，最新一期在前，每行为
 *   [期号, 开奖日期, 前区[5], 后区[2], 奖池(开奖后滚存), 销量, 开奖公告[[奖级,注数,单注奖金],...]]
 *
 * computeAll(raw) 一次性算出全部统计量，UI 只负责渲染；本文件不触碰 DOM，
 * 因此可以直接被 node:test 单测覆盖（见 test/）。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./dlt-shared.js'));
  } else {
    root.DltCore = factory(root.DltShared);
  }
})(typeof self !== 'undefined' ? self : this, function (Shared) {
  'use strict';

  var FRONT_MAX = Shared.FRONT_MAX, BACK_MAX = Shared.BACK_MAX;
  var EIGHT_YI = Shared.EIGHT_YI;

  // ---------- 小工具 ----------
  function sum(arr) { var s = 0; for (var i = 0; i < arr.length; i++) s += arr[i]; return s; }
  function mean(arr) { return arr.length ? sum(arr) / arr.length : 0; }
  function median(arr) {
    if (!arr.length) return 0;
    var s = arr.slice().sort(function (a, b) { return a - b; });
    var mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  }
  function maxOf(arr) { return arr.length ? Math.max.apply(null, arr) : 0; }
  function minOf(arr) { return arr.length ? Math.min.apply(null, arr) : 0; }
  function stdDev(arr) {
    if (arr.length < 2) return 0;
    var m = mean(arr), s = 0;
    for (var i = 0; i < arr.length; i++) s += (arr[i] - m) * (arr[i] - m);
    return Math.sqrt(s / (arr.length - 1));
  }
  // 滑动平均：前 w-1 项为 null（窗口未满，避免用不足窗口的数据误导趋势）
  function movingAvg(arr, w) {
    var out = new Array(arr.length).fill(null);
    var acc = 0;
    for (var i = 0; i < arr.length; i++) {
      acc += arr[i];
      if (i >= w) acc -= arr[i - w];
      if (i >= w - 1) out[i] = +(acc / w).toFixed(2);
    }
    return out;
  }
  // 计数分布：数组 → {值: 次数}
  function distCounts(arr) {
    var o = {};
    for (var i = 0; i < arr.length; i++) o[arr[i]] = (o[arr[i]] || 0) + 1;
    return o;
  }
  function topFromMap(map, k) {
    var arr = Object.keys(map).map(function (key) { return { key: key, count: map[key] }; });
    arr.sort(function (a, b) { return b.count - a.count || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0); });
    return arr.slice(0, k);
  }

  // 遗漏分析：当前遗漏（从最新往回数）、平均遗漏、最大遗漏
  function omissionFor(raw, maxNum, freqArr, zoneIdx) {
    var n = raw.length;
    var chrono = raw.slice().reverse();
    var cur = new Array(maxNum + 1).fill(n);
    var gaps = [], firstSeen = new Array(maxNum + 1).fill(null), prevPos = new Array(maxNum + 1).fill(-1);
    for (var q = 0; q <= maxNum; q++) gaps.push([]);
    var i, j, v;
    for (i = 0; i < n; i++) {
      var nums = raw[i][zoneIdx];
      for (j = 0; j < nums.length; j++) { v = nums[j]; if (cur[v] === n) cur[v] = i; }
    }
    for (i = 0; i < n; i++) {
      var nums2 = chrono[i][zoneIdx];
      for (j = 0; j < nums2.length; j++) {
        v = nums2[j];
        if (firstSeen[v] === null) firstSeen[v] = i;
        if (prevPos[v] !== -1) gaps[v].push(i - prevPos[v] - 1);
        prevPos[v] = i;
      }
    }
    var out = [];
    for (var num = 1; num <= maxNum; num++) {
      var g = gaps[num];
      var avg = g.length ? mean(g) : (firstSeen[num] === null ? 0 : n - 1 - firstSeen[num]);
      out.push({
        num: num,
        count: freqArr[num],
        freq: +(freqArr[num] / n * 100).toFixed(2),
        curOmit: cur[num] === n ? n : cur[num],
        avgOmit: +avg.toFixed(1),
        maxOmit: maxOf(g),
        // 遗漏标准差：衡量该号码遗漏的「规律性」，越小越规律
        omitStd: +stdDev(g).toFixed(1),
        // 回补压力：当前遗漏 / 平均遗漏，>1 表示比平时更久没出
        pressure: avg > 0 ? +(cur[num] / avg).toFixed(2) : (cur[num] > 0 ? 9.99 : 0)
      });
    }
    return out;
  }

  // ---------- 和值理论分布（组合数学精确值，用于和实际开奖对比） ----------
  // 前区从 01–35 中任取 5 个不重复号码，和值的精确概率分布由动态规划计数得出。
  var SUM_BANDS = [[15, 60], [61, 85], [86, 110], [111, 135], [136, 165]];
  var sumTheoryCache = null;
  function sumTheoretical() {
    if (sumTheoryCache) return sumTheoryCache;
    var MAX_SUM = 165, K = 5;
    var dp = [], k, s, n;
    for (k = 0; k <= K; k++) dp.push(new Array(MAX_SUM + 1).fill(0));
    dp[0][0] = 1;
    for (n = 1; n <= FRONT_MAX; n++) {
      for (k = K; k >= 1; k--) {
        for (s = MAX_SUM; s >= n; s--) dp[k][s] += dp[k - 1][s - n];
      }
    }
    var ways = dp[K];
    var total = 0;
    for (s = 0; s <= MAX_SUM; s++) total += ways[s];
    var bandProbs = SUM_BANDS.map(function (b) {
      var c = 0;
      for (s = b[0]; s <= b[1]; s++) c += ways[s];
      return c / total;
    });
    sumTheoryCache = { ways: ways, total: total, bandProbs: bandProbs, bands: SUM_BANDS };
    return sumTheoryCache;
  }

  // ---------- 主入口 ----------
  function computeAll(raw, opts) {
    opts = opts || {};
    if (!Array.isArray(raw) || !raw.length) throw new Error('数据为空，无法统计');
    var n = raw.length;
    var chrono = raw.slice().reverse();          // 从旧到新
    var i, j, k, v;

    var freqFront = new Array(FRONT_MAX + 1).fill(0);
    var freqBack = new Array(BACK_MAX + 1).fill(0);
    var sums = [], oddCounts = [], bigCounts = [], zoneCounts = [], consecInfo = [];
    var spans = [], heads = [], tails = [];
    var backSums = [], backSpans = [];
    var repeatCounts = [], neighborCounts = [], tailGroupCounts = [];
    var repeatSeries = [], neighborSeries = [];
    var acValues = [], mod3Patterns = [];
    var frontPairFreq = {}, frontTripleFreq = {}, backPairFreq = {};
    var coMatrix = [];
    for (i = 0; i <= FRONT_MAX; i++) coMatrix.push(new Array(FRONT_MAX + 1).fill(0));
    var tailOccFront = new Array(10).fill(0), tailOccBack = new Array(10).fill(0);
    var headFreq = new Array(FRONT_MAX + 1).fill(0), tailFreq = new Array(FRONT_MAX + 1).fill(0);

    for (i = 0; i < n; i++) {
      var d = chrono[i], f = d[2], b = d[3];
      var s = 0, odd = 0, big = 0, z1 = 0, z2 = 0, z3 = 0;
      var tailsSeen = {}, distinctTails = 0;
      for (j = 0; j < f.length; j++) {
        v = f[j];
        freqFront[v]++;
        s += v;
        if (v % 2 === 1) odd++;
        if (v >= 18) big++;
        if (v <= 12) z1++; else if (v <= 24) z2++; else z3++;
        var tl = v % 10;
        tailOccFront[tl]++;
        if (!tailsSeen[tl]) { tailsSeen[tl] = 1; distinctTails++; }
      }
      for (j = 0; j < b.length; j++) { freqBack[b[j]]++; tailOccBack[b[j] % 10]++; }

      sums.push(s);
      oddCounts.push(odd);
      bigCounts.push(big);
      zoneCounts.push([z1, z2, z3]);
      spans.push(f[4] - f[0]);
      heads.push(f[0]);
      tails.push(f[4]);
      headFreq[f[0]]++;
      tailFreq[f[4]]++;
      backSums.push(b[0] + b[1]);
      backSpans.push(b[1] - b[0]);
      tailGroupCounts.push(f.length - distinctTails);   // 同尾号个数（5 - 不同尾数个数）

      // 012 路（除 3 余数）分布
      var r0 = 0, r1 = 0, r2 = 0;
      for (j = 0; j < f.length; j++) { var m = f[j] % 3; if (m === 0) r0++; else if (m === 1) r1++; else r2++; }
      mod3Patterns.push(r0 + ':' + r1 + ':' + r2);

      // AC 值 = 两两差值中不同值的个数 - (号码个数 - 1)
      var diffSet = {};
      for (j = 0; j < f.length; j++) for (k = j + 1; k < f.length; k++) diffSet[f[k] - f[j]] = 1;
      acValues.push(Object.keys(diffSet).length - (f.length - 1));

      // 连号（相邻号码差 1）
      var groups = 0, inRun = false, runLen = 0, maxRun = 0;
      for (j = 1; j < f.length; j++) {
        if (f[j] - f[j - 1] === 1) {
          runLen++;
          if (!inRun) { groups++; inRun = true; }
        } else { inRun = false; runLen = 0; }
        if (runLen + 1 > maxRun) maxRun = runLen + 1;
      }
      if (f.length) maxRun = Math.max(maxRun, 1);
      consecInfo.push({ has: groups > 0, groups: groups, maxRun: maxRun });

      // 重号（与上一期前区重复个数）与邻号（上一期号码 ±1）
      if (i > 0) {
        var pf = chrono[i - 1][2];
        var rep = 0, nb = 0;
        for (j = 0; j < f.length; j++) {
          if (pf.indexOf(f[j]) >= 0) { rep++; continue; }
          for (k = 0; k < pf.length; k++) {
            if (Math.abs(f[j] - pf[k]) === 1) { nb++; break; }
          }
        }
        repeatCounts.push(rep);
        neighborCounts.push(nb);
        repeatSeries.push(rep);
        neighborSeries.push(nb);
      } else {
        repeatSeries.push(null);
        neighborSeries.push(null);
      }

      // 组合频次 + 共现矩阵
      var bpKey = b[0] < b[1] ? b[0] + ',' + b[1] : b[1] + ',' + b[0];
      backPairFreq[bpKey] = (backPairFreq[bpKey] || 0) + 1;
      for (j = 0; j < 5; j++) {
        for (k = j + 1; k < 5; k++) {
          var a1 = f[j], a2 = f[k];
          var pk = a1 < a2 ? a1 + ',' + a2 : a2 + ',' + a1;
          frontPairFreq[pk] = (frontPairFreq[pk] || 0) + 1;
          coMatrix[a1][a2]++; coMatrix[a2][a1]++;
        }
      }
      for (j = 0; j < 5; j++) {
        for (k = j + 1; k < 5; k++) {
          for (var l = k + 1; l < 5; l++) {
            var t = [f[j], f[k], f[l]].sort(function (a, b2) { return a - b2; });
            var tk = t.join(',');
            frontTripleFreq[tk] = (frontTripleFreq[tk] || 0) + 1;
          }
        }
      }
    }

    var frontOmit = omissionFor(raw, FRONT_MAX, freqFront, 2);
    var backOmit = omissionFor(raw, BACK_MAX, freqBack, 3);

    // ---------- 和值 ----------
    var sumStats = {
      min: minOf(sums), max: maxOf(sums),
      avg: +mean(sums).toFixed(1), median: +median(sums).toFixed(1),
      std: +stdDev(sums).toFixed(1)
    };
    var sumHist = distCounts(sums);

    // ---------- 结构分布 ----------
    var oddDist = distCounts(oddCounts);
    var bigDist = distCounts(bigCounts);
    var zoneTotal = [0, 0, 0], zonePatternFreq = {};
    for (i = 0; i < zoneCounts.length; i++) {
      zoneTotal[0] += zoneCounts[i][0]; zoneTotal[1] += zoneCounts[i][1]; zoneTotal[2] += zoneCounts[i][2];
      var zpk = zoneCounts[i].join(':');
      zonePatternFreq[zpk] = (zonePatternFreq[zpk] || 0) + 1;
    }

    // ---------- 连号 ----------
    var consec = { hasCount: 0, groupTotal: 0, groupDist: {}, maxRun: 0, runLenDist: {} };
    for (i = 0; i < consecInfo.length; i++) {
      if (consecInfo[i].has) consec.hasCount++;
      consec.groupTotal += consecInfo[i].groups;
      var gk = consecInfo[i].groups;
      consec.groupDist[gk] = (consec.groupDist[gk] || 0) + 1;
      if (consecInfo[i].maxRun > consec.maxRun) consec.maxRun = consecInfo[i].maxRun;
      var rk = consecInfo[i].maxRun;
      consec.runLenDist[rk] = (consec.runLenDist[rk] || 0) + 1;
    }
    consec.avgGroups = +(consec.groupTotal / n).toFixed(3);
    consec.hasRate = +(consec.hasCount / n * 100).toFixed(2);

    // ---------- 跨度 / 龙头凤尾 ----------
    var spanStats = {
      min: minOf(spans), max: maxOf(spans), avg: +mean(spans).toFixed(1),
      median: median(spans), std: +stdDev(spans).toFixed(1)
    };
    var headTop = [], tailTop = [];
    for (i = 1; i <= FRONT_MAX; i++) {
      if (headFreq[i]) headTop.push({ num: i, count: headFreq[i] });
      if (tailFreq[i]) tailTop.push({ num: i, count: tailFreq[i] });
    }
    headTop.sort(function (a, b) { return b.count - a.count || a.num - b.num; });
    tailTop.sort(function (a, b) { return b.count - a.count || a.num - b.num; });

    // ---------- 后区 ----------
    var backSumStats = {
      min: minOf(backSums), max: maxOf(backSums), avg: +mean(backSums).toFixed(2),
      median: median(backSums), std: +stdDev(backSums).toFixed(2)
    };

    // ---------- 重号 / 邻号 / 同尾 / 012 路 / AC 值 ----------
    function distSummary(arr, maxKey) {
      var dist = distCounts(arr), rows = [];
      var hi = maxKey == null ? maxOf(arr) : maxKey;
      for (var q = 0; q <= hi; q++) rows.push({ k: q, count: dist[q] || 0, rate: +((dist[q] || 0) / n * 100).toFixed(2) });
      return { dist: dist, rows: rows, avg: +mean(arr).toFixed(3), max: maxOf(arr), zeroRate: +((dist[0] || 0) / n * 100).toFixed(2) };
    }
    // 重号/邻号的样本量是 n-1（第一期为最早一期，无上一期）
    var repeat = distSummary(repeatCounts, 5);
    var neighbor = distSummary(neighborCounts, 5);
    var tailGroup = distSummary(tailGroupCounts, 4);
    var acStats = {
      hist: distCounts(acValues), avg: +mean(acValues).toFixed(2),
      min: minOf(acValues), max: maxOf(acValues)
    };
    var mod3Freq = distCounts(mod3Patterns);
    var mod3Top = topFromMap(mod3Freq, 8);

    // ---------- 共现矩阵（前区两两同现次数） ----------
    // 期望值：任一对号码在同一期出现的概率 = C(33,3)/C(35,5) = 20/1190
    var pairExpected = n * 20 / 1190;
    var coTop = [];
    for (i = 1; i <= FRONT_MAX; i++) {
      for (j = i + 1; j <= FRONT_MAX; j++) {
        if (coMatrix[i][j]) coTop.push({ a: i, b: j, count: coMatrix[i][j] });
      }
    }
    coTop.sort(function (x, y) { return y.count - x.count || x.a - y.a || x.b - y.b; });
    var coMax = coTop.length ? coTop[0].count : 0;

    // ---------- 奖金 / 返奖率（来自开奖公告） ----------
    var prizeStats = computePrizeStats(raw, chrono);

    // ---------- 排序后的频次列表 ----------
    function freqList(maxNum, freqArr) {
      var list = [];
      for (var num = 1; num <= maxNum; num++) list.push({ num: num, count: freqArr[num] });
      return list;
    }
    var frontFreqList = freqList(FRONT_MAX, freqFront).sort(function (a, b) { return b.count - a.count || a.num - b.num; });
    var backFreqList = freqList(BACK_MAX, freqBack).sort(function (a, b) { return b.count - a.count || a.num - b.num; });

    return {
      n: n,
      firstDraw: chrono[0],
      lastDraw: raw[0],
      raw: raw,
      chrono: chrono,
      freqFront: freqFront, freqBack: freqBack,
      frontFreq: freqFront, backFreq: freqBack,   // 与页面调用保持一致（frontFreq[n] = 号码 n 出现次数）
      frontFreqList: frontFreqList, backFreqList: backFreqList,
      frontOmit: frontOmit, backOmit: backOmit,
      sums: sums, sumStats: sumStats, sumHist: sumHist,
      sumMA5: movingAvg(sums, 5), sumMA20: movingAvg(sums, 20), sumMA50: movingAvg(sums, 50),
      oddDist: oddDist, bigDist: bigDist,
      zoneTotal: zoneTotal, zonePatternFreq: zonePatternFreq,
      consec: consec,
      spans: spans, spanStats: spanStats, spanHist: distCounts(spans),
      headFreq: headFreq, tailFreq: tailFreq, headTop: headTop, tailTop: tailTop,
      backSums: backSums, backSumStats: backSumStats, backSumHist: distCounts(backSums),
      backSpans: backSpans, backSpanHist: distCounts(backSpans),
      backSumMA20: movingAvg(backSums, 20), backSumMA50: movingAvg(backSums, 50),
      repeat: repeat, neighbor: neighbor, tailGroup: tailGroup,
      repeatSeries: repeatSeries, neighborSeries: neighborSeries,
      tailOccFront: tailOccFront, tailOccBack: tailOccBack,
      acStats: acStats, mod3Top: mod3Top, mod3Freq: mod3Freq,
      coMatrix: coMatrix, coTop: coTop.slice(0, 15), coMax: coMax, pairExpected: +pairExpected.toFixed(2),
      prizeStats: prizeStats,
      frontPairTop: topFromMap(frontPairFreq, 20),
      frontTripleTop: topFromMap(frontTripleFreq, 20),
      backPairTop: topFromMap(backPairFreq, 15)
    };
  }

  // 开奖公告聚合：各奖级累计注数/金额、一等奖走势、返奖率
  function computePrizeStats(raw, chrono) {
    var n = raw.length;
    var levels = {}, jackpot = [], payout = [], upgraded = 0, basic = 0, newRuleDraws = 0;
    var totalMoney = 0, totalSales = 0;
    for (var i = 0; i < n; i++) {
      var d = raw[i];
      var prizes = d[6] || [];
      var sales = Number(d[5]) || 0;
      // 该期开奖前奖池 = 上一期开奖后滚存（最早一期用当期值近似）
      var pre = i + 1 < n ? (Number(raw[i + 1][4]) || 0) : (Number(d[4]) || 0);
      // 「8 亿升级档」是 2026 新规产物，只统计新规施行后的期数，否则历史旧奖级的期数会被误算进来
      if (String(d[1]) >= Shared.NEW_RULE_DATE) {
        newRuleDraws++;
        if (pre >= EIGHT_YI) upgraded++; else basic++;
      }
      var drawMoney = 0;
      for (var j = 0; j < prizes.length; j++) {
        var name = String(prizes[j][0]), cnt = Number(prizes[j][1]) || 0, amt = Number(prizes[j][2]) || 0;
        var L = levels[name] || (levels[name] = { name: name, draws: 0, notes: 0, money: 0 });
        // draws 统计「真正有人中奖的期数」（官网每期都会列出全部奖级，含 0 注的，直接计数没有意义）
        if (cnt > 0) L.draws++;
        L.notes += cnt; L.money += cnt * amt;
        drawMoney += cnt * amt;
        if (name === '一等奖') jackpot.push({ issue: d[0], date: d[1], count: cnt, amount: amt, prePool: pre });
      }
      totalMoney += drawMoney;
      // 只统计「有开奖公告」的期次：早期期次官网未公布各奖级明细，若按 0 计入会严重拉低平均返奖率
      if (sales > 0 && prizes.length) {
        totalSales += sales;
        payout.push({ issue: d[0], date: d[1], sales: sales, money: drawMoney, rate: drawMoney / sales });
      }
    }
    var rates = payout.map(function (x) { return x.rate; });
    return {
      levels: levels,
      levelList: Object.keys(levels).map(function (k) { return levels[k]; })
        .sort(function (a, b) { return b.money - a.money; }),
      jackpot: jackpot,                     // 最新在前
      payout: payout,                       // 最新在前，含返奖率
      payoutAvg: +mean(rates).toFixed(4),
      payoutMedian: +median(rates).toFixed(4),
      payoutMin: rates.length ? +minOf(rates).toFixed(4) : 0,
      payoutMax: rates.length ? +maxOf(rates).toFixed(4) : 0,
      totalMoney: totalMoney, totalSales: totalSales,
      overallRate: totalSales > 0 ? totalMoney / totalSales : 0,
      upgradedDraws: upgraded, basicDraws: basic, newRuleDraws: newRuleDraws,
      hasAnnouncement: jackpot.length
    };
  }

  // 单个号码的滑动窗口出现次数（chrono 顺序；窗口不足处为 null）
  function rollingOccurrence(raw, zone, num, win) {
    var chrono = raw.slice().reverse();
    var idx = zone === 'f' ? 2 : 3;
    var hit = chrono.map(function (d) { return d[idx].indexOf(num) >= 0 ? 1 : 0; });
    var out = new Array(chrono.length).fill(null);
    var acc = 0;
    for (var i = 0; i < hit.length; i++) {
      acc += hit[i];
      if (i >= win) acc -= hit[i - win];
      if (i >= win - 1) out[i] = acc;
    }
    return { series: out, labels: chrono.map(function (d) { return d[0]; }), win: win };
  }

  // ================= 预测（纯统计，仅供娱乐） =================
  var RECENT_WIN = 50;

  var PRED_METHODS = {
    ensemble: { name: '综合加权', desc: '综合「频次」「近 50 期热度」「遗漏回补」「转移跟随」四项评分的排名分等权平均，再按分数加权抽取 5 注。' },
    freq: { name: '频次加权', desc: '按全部历史开奖的出现频率加权抽取，历史越常出的号码越容易被选中。' },
    recent: { name: '近期热度', desc: '只看最近 50 期的出现频率，捕捉近期热号趋势（比全量频次更敏感）。' },
    omit: { name: '遗漏回补', desc: '当前遗漏期数 ÷ 平均遗漏期数越大优先级越高，押注长期未出号码的「回补」。' },
    follow: { name: '转移跟随', desc: '以上一期开出的 5+2 个号码为种子，统计历史上这些号码开出后「下一期」的跟随出现概率，按概率加权。' },
    hotcold: { name: '冷热混合', desc: '每注前区 2 热 + 2 冷 + 1 中、后区 1 热 + 1 冷（热 = 频次 TOP8，冷 = 频次 BOTTOM8）。' },
    sumrange: { name: '和值区间', desc: '前区和值约束在历史最密集区间（众数 ±12），并兼顾奇偶 2:3 / 3:2、大小均衡、三区至少各 1 个。' }
  };
  // 只有「单一信号」的方法才直接用自己的评分；ensemble / hotcold / sumrange 走综合加权
  // （注意：ensemble 不能出现在这里，否则会退化为 rankNorm(全零数组) —— 评分变成按号码序号排序）
  var SCORE_BASED = { freq: 1, recent: 1, omit: 1, follow: 1 };

  // 从开奖数据构建预测所需的统计量（rows 最新在前）
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
      var f = rows[pos][2], b = rows[pos][3], s = 0;
      for (j = 0; j < 5; j++) {
        var v = f[j];
        freqF[v]++; s += v;
        if (pos < RECENT_WIN) recentF[v]++;
        if (omitF[v] === n) omitF[v] = pos;
        if (pos > 0) { var nf = rows[pos - 1][2]; for (k = 0; k < 5; k++) transF[v][nf[k]]++; }
      }
      sumHist[s] = (sumHist[s] || 0) + 1;
      if (sumHist[s] > sumMax) { sumMax = sumHist[s]; sumMode = s; }
      for (j = 0; j < 2; j++) {
        var v2 = b[j];
        freqB[v2]++;
        if (pos < RECENT_WIN) recentB[v2]++;
        if (omitB[v2] === n) omitB[v2] = pos;
        if (pos > 0) { var nb = rows[pos - 1][3]; for (k = 0; k < 2; k++) transB[v2][nb[k]]++; }
      }
    }
    var chrono = rows.slice().reverse();
    for (i = 0; i < chrono.length; i++) {
      var cf = chrono[i][2], cb = chrono[i][3];
      for (j = 0; j < 5; j++) { v = cf[j]; if (prevPosF[v] !== -1) gapsF[v].push(i - prevPosF[v] - 1); prevPosF[v] = i; }
      for (j = 0; j < 2; j++) { v = cb[j]; if (prevPosB[v] !== -1) gapsB[v].push(i - prevPosB[v] - 1); prevPosB[v] = i; }
    }
    var avgOmitF = new Array(36).fill(0), avgOmitB = new Array(13).fill(0);
    for (i = 1; i <= 35; i++) avgOmitF[i] = mean(gapsF[i]);
    for (i = 1; i <= 12; i++) avgOmitB[i] = mean(gapsB[i]);
    return {
      n: n, freqF: freqF, freqB: freqB,
      recentF: recentF, recentB: recentB,
      omitF: omitF, omitB: omitB,
      avgOmitF: avgOmitF, avgOmitB: avgOmitB,
      transF: transF, transB: transB,
      lastF: rows[0][2], lastB: rows[0][3],
      sumMode: sumMode,
      sumLo: Math.max(15, sumMode - 12), sumHi: Math.min(165, sumMode + 12)
    };
  }

  function rawScore(kind, st) {
    var sF = new Array(36).fill(0), sB = new Array(13).fill(0), i, j;
    var win = Math.min(RECENT_WIN, st.n) || 1;
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
      var list = [], i;
      for (i = 1; i <= maxNum; i++) list.push({ num: i, v: arr[i] });
      list.sort(function (a, b) { return b.v - a.v || a.num - b.num; });
      var out = new Array(maxNum + 1);
      list.forEach(function (it, idx) { out[it.num] = (maxNum - 1 - idx) / (maxNum - 1) * 100; });
      return out;
    }
    return { sF: zone(sc.sF, 35), sB: zone(sc.sB, 12) };
  }

  function avgScores(list) {
    var sF = new Array(36).fill(0), sB = new Array(13).fill(0), i;
    for (i = 1; i <= 35; i++) { var a = 0; for (var q = 0; q < list.length; q++) a += list[q].sF[i]; sF[i] = a / list.length; }
    for (i = 1; i <= 12; i++) { var b = 0; for (var q2 = 0; q2 < list.length; q2++) b += list[q2].sB[i]; sB[i] = b / list.length; }
    return { sF: sF, sB: sB };
  }

  function scoreFor(m, st) {
    if (SCORE_BASED[m]) return rankNorm(rawScore(m, st));
    return avgScores([
      rankNorm(rawScore('freq', st)), rankNorm(rawScore('recent', st)),
      rankNorm(rawScore('omit', st)), rankNorm(rawScore('follow', st))
    ]);
  }

  function topN(sArr, maxNum, k) {
    var l = [];
    for (var i = 1; i <= maxNum; i++) l.push({ num: i, v: sArr[i] });
    l.sort(function (a, b) { return b.v - a.v || a.num - b.num; });
    return l.slice(0, k);
  }

  var FRONT_POOL = [], BACK_POOL = [];
  for (var _p = 1; _p <= FRONT_MAX; _p++) FRONT_POOL.push(_p);
  for (var _q = 1; _q <= BACK_MAX; _q++) BACK_POOL.push(_q);

  function pickHotCold(st, rng) {
    var i, sortedF = [];
    for (i = 1; i <= 35; i++) sortedF.push(i);
    sortedF.sort(function (a, b) { return st.freqF[b] - st.freqF[a] || a - b; });
    var f = Shared.sampleUniform(sortedF.slice(0, 8), 2, rng)
      .concat(Shared.sampleUniform(sortedF.slice(27), 2, rng))
      .concat(Shared.sampleUniform(sortedF.slice(8, 27), 1, rng))
      .sort(function (a, b) { return a - b; });
    var sortedB = [];
    for (i = 1; i <= 12; i++) sortedB.push(i);
    sortedB.sort(function (a, b) { return st.freqB[b] - st.freqB[a] || a - b; });
    var b = Shared.sampleUniform(sortedB.slice(0, 4), 1, rng)
      .concat(Shared.sampleUniform(sortedB.slice(8), 1, rng))
      .sort(function (a, b2) { return a - b2; });
    return { f: f, b: b };
  }

  function pickSumRange(st, rng) {
    var tries = 0;
    while (tries++ < 4000) {
      var f = Shared.sampleUniform(FRONT_POOL, 5, rng);
      var s = sum(f);
      if (s >= st.sumLo && s <= st.sumHi) {
        var odd = f.filter(function (x) { return x % 2 === 1; }).length;
        var big = f.filter(function (x) { return x >= 18; }).length;
        var z1 = f.filter(function (x) { return x <= 12; }).length;
        var z3 = f.filter(function (x) { return x >= 25; }).length;
        if (odd >= 2 && odd <= 3 && big >= 2 && big <= 3 && z1 >= 1 && z3 >= 1) {
          return { f: f, b: Shared.sampleUniform(BACK_POOL, 2, rng) };
        }
      }
    }
    return { f: Shared.sampleUniform(FRONT_POOL, 5, rng), b: Shared.sampleUniform(BACK_POOL, 2, rng) };
  }

  function predictMethod(m, st, k, rng) {
    var out = [], i;
    for (i = 0; i < k; i++) {
      if (m === 'hotcold') out.push(pickHotCold(st, rng));
      else if (m === 'sumrange') out.push(pickSumRange(st, rng));
      else {
        var sc = scoreFor(m, st);
        var wF = {}, wB = {}, x;
        for (x = 1; x <= 35; x++) wF[x] = sc.sF[x] + 1;
        for (x = 1; x <= 12; x++) wB[x] = sc.sB[x] + 1;
        out.push({ f: Shared.sampleWeighted(FRONT_POOL, wF, 5, rng), b: Shared.sampleWeighted(BACK_POOL, wB, 2, rng) });
      }
    }
    return out;
  }

  function countMatch(pred, actual) {
    var c = 0;
    for (var i = 0; i < pred.length; i++) if (actual.indexOf(pred[i]) >= 0) c++;
    return c;
  }

  // 历史回测：用「该期之前的所有数据」预测该期，对照纯随机基准。
  // seed 固定 → 结果可复现（原先用 Math.random，每次点按钮数字都不一样，无法比较）。
  function backtest(rows, opts) {
    opts = opts || {};
    var K = opts.periods || 100;          // 回测期数
    var trials = opts.trials || 3;        // 每期重复抽样次数（降低随机噪声）
    var seed = opts.seed == null ? 20260101 : opts.seed;
    var minHistory = opts.minHistory == null ? 200 : opts.minHistory;
    var methods = opts.methods || ['ensemble', 'freq', 'recent', 'omit', 'follow', 'hotcold', 'sumrange'];
    var agg = {}, i, t, k;
    for (i = 0; i < methods.length; i++) {
      agg[methods[i]] = { fh: 0, bh: 0, hit1: 0, hit3: 0, bhit1: 0, t: 0 };
    }
    var done = 0;
    for (t = 0; t < K && rows.length - t - 1 >= minHistory; t++) {
      var target = rows[t];
      var st = buildPredStats(rows.slice(t + 1));
      for (i = 0; i < methods.length; i++) {
        var mm = methods[i];
        var rng = Shared.mulberry32(seed + i * 7919);   // 每种方法用同一条随机流，横向可比
        for (k = 0; k < trials; k++) {
          var picks = predictMethod(mm, st, 1, rng)[0];
          var hf = countMatch(picks.f, target[2]);
          var hb = countMatch(picks.b, target[3]);
          agg[mm].fh += hf; agg[mm].bh += hb;
          agg[mm].hit1 += hf >= 1 ? 1 : 0;
          agg[mm].hit3 += hf >= 3 ? 1 : 0;
          agg[mm].bhit1 += hb >= 1 ? 1 : 0;
          agg[mm].t++;
        }
      }
      done++;
    }
    // 纯随机基准：前区 5 中 k 的超几何期望；后区同理
    var baseF = 5 * 5 / 35;
    var baseB = 2 * 2 / 12;
    var base1 = 1 - Shared.comb(30, 5) / Shared.comb(35, 5);
    var base3 = (Shared.comb(5, 3) * Shared.comb(30, 2) + Shared.comb(5, 4) * Shared.comb(30, 1) + Shared.comb(5, 5)) / Shared.comb(35, 5);
    var baseB1 = 1 - Shared.comb(10, 2) / Shared.comb(12, 2);
    var results = methods.map(function (m) {
      var a = agg[m];
      if (!a.t) return { method: m, name: (PRED_METHODS[m] || {}).name || m, sample: 0 };
      return {
        method: m, name: (PRED_METHODS[m] || {}).name || m, sample: done,
        frontAvg: a.fh / a.t, backAvg: a.bh / a.t,
        frontHit1: a.hit1 / a.t, frontHit3: a.hit3 / a.t, backHit1: a.bhit1 / a.t,
        frontDelta: a.fh / a.t - baseF
      };
    });
    return {
      periods: done, trials: trials, seed: seed, methods: results,
      baseline: { frontAvg: baseF, backAvg: baseB, frontHit1: base1, frontHit3: base3, backHit1: baseB1 }
    };
  }

  return {
    computeAll: computeAll,
    rollingOccurrence: rollingOccurrence,
    sumTheoretical: sumTheoretical,
    SUM_BANDS: SUM_BANDS,
    PRED_METHODS: PRED_METHODS,
    SCORE_BASED: SCORE_BASED,
    RECENT_WIN: RECENT_WIN,
    FRONT_POOL: FRONT_POOL,
    BACK_POOL: BACK_POOL,
    buildPredStats: buildPredStats,
    scoreFor: scoreFor,
    rankNorm: rankNorm,
    rawScore: rawScore,
    topN: topN,
    predictMethod: predictMethod,
    countMatch: countMatch,
    backtest: backtest,
    movingAvg: movingAvg,
    mean: mean,
    median: median
  };
});
