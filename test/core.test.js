/*
 * dlt-core.js 统计引擎单元测试
 * 既有小规模合成数据的手算校验，也有真实 data.js 上的不变量校验。
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Shared = require('../js/dlt-shared.js');
const Core = require('../js/dlt-core.js');

// ---------- 合成数据 ----------
// 3 期，最新在前。手工可验证每个统计量。
const SYNTH = [
  ['00003', '2020-01-03', [1, 2, 3, 4, 5], [1, 2], 100000000, 1000, [['一等奖', 1, 5000000], ['七等奖', 10, 5]]],
  ['00002', '2020-01-02', [1, 2, 3, 4, 6], [1, 3], 200000000, 2000, [['一等奖', 2, 3000000]]],
  ['00001', '2020-01-01', [10, 20, 30, 34, 35], [5, 12], 300000000, 3000, []]
];

test('computeAll：基础计数与频次', () => {
  const S = Core.computeAll(SYNTH);
  assert.equal(S.n, 3);
  assert.equal(S.frontFreq[1], 2);
  assert.equal(S.frontFreq[35], 1);
  assert.equal(S.backFreq[1], 2);
  assert.equal(S.backFreq[12], 1);
  assert.equal(S.frontFreqList[0].num, 1, '出现 2 次的号码应排最前');
  assert.equal(S.lastDraw[0], '00003');
  assert.equal(S.firstDraw[0], '00001');
  assert.deepEqual(S.chrono[0][0], '00001', 'chrono 应为从旧到新');
});

test('computeAll：和值 / 跨度 / 结构', () => {
  const S = Core.computeAll(SYNTH);
  assert.deepEqual(S.sums, [129, 16, 15]);            // 10+20+30+34+35, 1+2+3+4+6, 1+2+3+4+5
  assert.equal(S.sumStats.min, 15);
  assert.equal(S.sumStats.max, 129);
  assert.equal(S.sumStats.median, 16);
  assert.deepEqual(S.spans, [25, 5, 4]);              // 35-10, 6-1, 5-1
  assert.equal(S.spanStats.max, 25);
  assert.deepEqual(S.oddDist, { 1: 1, 2: 1, 3: 1 });  // 三期奇数个数分别为 1 / 2 / 3
  assert.deepEqual(S.bigDist, { 0: 2, 4: 1 });        // [10,20,30,34,35] 有 4 个大号，另两期各 0 个
  assert.deepEqual(S.zoneTotal, [11, 1, 3]);
});

test('computeAll：重号 / 邻号 / 同尾 / AC 值', () => {
  const S = Core.computeAll(SYNTH);
  // 期3 [1,2,3,4,5] vs 期2 [1,2,3,4,6]：重号 4 个；期2 vs 期1：重号 0 个
  assert.deepEqual(S.repeatSeries, [null, 0, 4]);
  // 期2 [1,2,3,4,6] vs 期1 [10,20,30,34,35]：无重号、无邻号
  assert.equal(S.neighborSeries[1], 0);
  assert.equal(S.repeat.avg, 2);                       // (4 + 0) / 2
  // AC 值：期3 差值集合 {1,2,3,4} → 4-4=0；期2 {1,2,3,4,5}→1；期1 {10,5,15,4,14,24,9,19,5,1}→ 去重 {1,4,5,9,10,14,15,19,24}=9 → 5
  assert.deepEqual(S.acStats.hist, { 0: 1, 1: 1, 5: 1 });
  assert.equal(S.acStats.avg.toFixed(2), '2.00');
  // 同尾：[1,2,3,4,5] 无同尾；[1,2,3,4,6] 无；[10,20,30] 尾 0 三个 → 2 个同尾号
  assert.deepEqual(S.tailGroup.rows.map((r) => r.count), [2, 0, 1, 0, 0]);
  assert.deepEqual(S.tailOccFront.slice(0, 2), [3, 2]);   // 尾 0 出现 3 次，尾 1 出现 2 次
});

test('computeAll：遗漏分析', () => {
  const S = Core.computeAll(SYNTH);
  const n1 = S.frontOmit[0];                 // 号码 01
  assert.equal(n1.num, 1);
  assert.equal(n1.count, 2);
  assert.equal(n1.curOmit, 0, '号码 1 在最新一期开出，当前遗漏应为 0');
  const n35 = S.frontOmit[34];               // 号码 35 只在最早一期出现
  assert.equal(n35.curOmit, 2);
  assert.equal(n35.maxOmit, 0, '仅出现一次，间隔样本为空');
  const n10 = S.frontOmit[9];
  assert.equal(n10.count, 1);
  assert.equal(n10.curOmit, 2);
  assert.equal(n10.freq, 33.33);
});

test('computeAll：共现矩阵与连号', () => {
  const S = Core.computeAll(SYNTH);
  assert.equal(S.coMatrix[1][2], 2, '01 与 02 同现 2 次');
  assert.equal(S.coMatrix[2][1], 2, '矩阵应左右对称');
  let total = 0;
  for (let a = 1; a <= 35; a++) for (let b = a + 1; b <= 35; b++) total += S.coMatrix[a][b];
  assert.equal(total, 3 * 10, '每期 5 个号码产生 C(5,2)=10 对');
  // 连号：[1,2,3,4,5] 有 1 组（最长 5 连）；[1,2,3,4,6] 1 组（4 连）；[10,20,30,34,35] 1 组
  assert.equal(S.consec.hasCount, 3);
  assert.equal(S.consec.maxRun, 5);
  assert.equal(S.consec.groupDist[1], 3);
});

test('computeAll：奖金与返奖率', () => {
  const S = Core.computeAll(SYNTH);
  const ps = S.prizeStats;
  assert.equal(ps.jackpot.length, 2, '两期含一等奖公告');
  assert.equal(ps.jackpot[0].issue, '00003');
  assert.equal(ps.jackpot[0].prePool, 200000000, '期3 开奖前奖池 = 期2 开奖后滚存');
  assert.equal(ps.levels['一等奖'].notes, 3);
  assert.equal(ps.levels['一等奖'].money, 5000000 + 2 * 3000000);
  assert.equal(ps.levels['七等奖'].money, 50);
  // 返奖率：期3 = (5000000+50)/1000，期2 = 6000000/2000
  assert.equal(ps.payout.length, 2);
  assert.equal(ps.payout[0].rate, (5000000 + 50) / 1000);
  assert.equal(ps.hasAnnouncement, 2);
  assert.equal(ps.newRuleDraws, 0, '2020 年数据不属于 2026 新规');
  assert.equal(ps.upgradedDraws, 0);
});

test('computeAll：空数据抛错', () => {
  assert.throws(() => Core.computeAll([]), /数据为空/);
});

test('sumTheoretical：精确组合分布', () => {
  const th = Core.sumTheoretical();
  assert.equal(th.total, Shared.comb(35, 5), '总组合数应为 C(35,5)=324632');
  const sum = th.bandProbs.reduce((a, c) => a + c, 0);
  assert.ok(Math.abs(sum - 1) < 1e-12, '各区段概率之和应为 1');
  // 和值 90 附近是众数区，概率应显著高于两端
  assert.ok(th.bandProbs[2] > th.bandProbs[0]);
  assert.ok(th.bandProbs[2] > th.bandProbs[4]);
  assert.equal(Core.sumTheoretical(), th, '应缓存同一对象');
});

test('movingAvg：窗口未满处为 null', () => {
  assert.deepEqual(Core.movingAvg([1, 2, 3, 4, 5], 3), [null, null, 2, 3, 4]);
  assert.deepEqual(Core.movingAvg([2, 4], 2), [null, 3]);
});

test('rollingOccurrence：滑动窗口计数', () => {
  const r = Core.rollingOccurrence(SYNTH, 'f', 1, 2);
  // chrono: 期1(无 1) 期2(有 1) 期3(有 1)
  assert.deepEqual(r.series, [null, 1, 2]);
  assert.equal(r.labels.length, 3);
  const r2 = Core.rollingOccurrence(SYNTH, 'b', 1, 3);
  assert.deepEqual(r2.series, [null, null, 2]);
});

test('backtest：同种子结果可复现且结构完整', () => {
  const rows = buildLongRows(260);
  const a = Core.backtest(rows, { periods: 30, trials: 2, minHistory: 200, seed: 12345 });
  const b = Core.backtest(rows, { periods: 30, trials: 2, minHistory: 200, seed: 12345 });
  assert.deepEqual(a, b, '固定种子必须给出完全一致的回测结果');
  const c = Core.backtest(rows, { periods: 30, trials: 2, minHistory: 200, seed: 999 });
  assert.notDeepEqual(a, c, '不同种子应给出不同结果');
  assert.equal(a.periods, 30);
  assert.equal(a.methods.length, 7);
  a.methods.forEach((m) => {
    assert.ok(m.frontAvg >= 0 && m.frontAvg <= 5);
    assert.ok(m.backAvg >= 0 && m.backAvg <= 2);
    assert.ok(m.frontHit1 >= 0 && m.frontHit1 <= 1);
    assert.ok(m.frontHit3 <= m.frontHit1, '≥3 命中率不可能高于 ≥1 命中率');
  });
  assert.ok(a.baseline.frontAvg > 0.7 && a.baseline.frontAvg < 0.72, '随机基准 ≈ 5×5/35');
});

test('predictMethod：可复现、号码合法且不重复', () => {
  const rows = buildLongRows(220);
  const st = Core.buildPredStats(rows);
  ['ensemble', 'freq', 'recent', 'omit', 'follow', 'hotcold', 'sumrange'].forEach((m) => {
    const picks = Core.predictMethod(m, st, 3, Shared.mulberry32(2026));
    assert.equal(picks.length, 3, m);
    picks.forEach((p) => {
      assert.equal(p.f.length, 5, m + ' 前区应有 5 个号码');
      assert.equal(p.b.length, 2, m + ' 后区应有 2 个号码');
      assert.equal(new Set(p.f).size, 5, m + ' 前区不应重复');
      assert.equal(new Set(p.b).size, 2, m + ' 后区不应重复');
      p.f.forEach((n) => assert.ok(n >= 1 && n <= 35, m));
      p.b.forEach((n) => assert.ok(n >= 1 && n <= 12, m));
    });
    assert.deepEqual(Core.predictMethod(m, st, 3, Shared.mulberry32(2026)), picks, m + ' 同种子应可复现');
  });
});

test('rankNorm / scoreFor / topN', () => {
  const sF = new Array(36).fill(0), sB = new Array(13).fill(0);
  sF[7] = 100; sF[8] = 50; sB[3] = 10;
  const rn = Core.rankNorm({ sF, sB });
  assert.equal(rn.sF[7], 100, '最高分应为 100');
  assert.equal(rn.sB[3], 100);
  assert.ok(rn.sF[8] < rn.sF[7]);
  assert.deepEqual(Core.topN(sF, 35, 2).map((x) => x.num), [7, 8]);
  const rows = buildLongRows(220);
  const st = Core.buildPredStats(rows);
  ['ensemble', 'freq', 'recent', 'omit', 'follow'].forEach((m) => {
    const sc = Core.scoreFor(m, st);
    assert.equal(sc.sF.length, 36);
    assert.equal(sc.sB.length, 13);
    sc.sF.slice(1).forEach((v) => assert.ok(v >= 0 && v <= 100, m));
  });
});

test('回归：综合加权评分必须由数据决定，不能退化为按号码序号排序', () => {
  const rows = buildLongRows(220);
  const st = Core.buildPredStats(rows);
  const sc = Core.scoreFor('ensemble', st);

  // 1) 不得严格单调递减（曾经因 SCORE_BASED 误含 ensemble 而退化为 100,97.1,...,0）
  const front = [];
  for (let i = 1; i <= 35; i++) front.push(sc.sF[i]);
  const monotonic = front.every((v, i) => i === 0 || v <= front[i - 1]);
  assert.ok(!monotonic, '综合加权评分不应按号码序号单调递减');
  assert.ok(new Set(front).size > 5, '评分应有足够多样性');

  // 2) 必须等于四项排名分的等权平均
  const parts = ['freq', 'recent', 'omit', 'follow'].map((m) => Core.rankNorm(Core.rawScore(m, st)));
  for (let n = 1; n <= 35; n++) {
    const avg = parts.reduce((a, p) => a + p.sF[n], 0) / parts.length;
    assert.ok(Math.abs(sc.sF[n] - avg) < 1e-9, '号码 ' + n + ' 的综合评分应等于四项排名分平均');
  }

  // 3) 单信号方法仍应使用自身排名分
  const freqSc = Core.scoreFor('freq', st);
  assert.deepEqual(freqSc.sF, Core.rankNorm(Core.rawScore('freq', st)).sF);
  assert.notDeepEqual(freqSc.sF, sc.sF, '频次评分应与综合加权不同');
});

// ---------- 真实数据不变量 ----------
function loadRealRows() {
  const file = path.join(__dirname, '..', 'data.js');
  if (!fs.existsSync(file)) return null;
  return Shared.parseDataFileText(fs.readFileSync(file, 'utf8'));
}
const REAL = loadRealRows();

test('真实 data.js：结构合法且严格降序', { skip: !REAL && 'data.js 不存在' }, () => {
  assert.ok(REAL.length > 1000);
  assert.equal(Shared.assertRows(REAL), true);
});

test('真实数据：频次 / 分布 / 矩阵等守恒关系', { skip: !REAL && 'data.js 不存在' }, () => {
  const S = Core.computeAll(REAL);
  const n = S.n;

  let fSum = 0;
  for (let i = 1; i <= 35; i++) fSum += S.frontFreq[i];
  assert.equal(fSum, 5 * n, '前区总出现次数 = 5 × 期数');

  let bSum = 0;
  for (let i = 1; i <= 12; i++) bSum += S.backFreq[i];
  assert.equal(bSum, 2 * n, '后区总出现次数 = 2 × 期数');

  assert.equal(S.sums.length, n);
  assert.equal(S.spans.length, n);
  assert.equal(S.backSums.length, n);
  S.spans.forEach((sp, i) => assert.equal(sp, S.chrono[i][2][4] - S.chrono[i][2][0]));
  S.backSums.forEach((s, i) => assert.equal(s, S.chrono[i][3][0] + S.chrono[i][3][1]));

  const oddSum = Object.keys(S.oddDist).reduce((a, k) => a + S.oddDist[k], 0);
  assert.equal(oddSum, n);
  const bigSum = Object.keys(S.bigDist).reduce((a, k) => a + S.bigDist[k], 0);
  assert.equal(bigSum, n);
  assert.equal(S.zoneTotal[0] + S.zoneTotal[1] + S.zoneTotal[2], 5 * n);
  assert.equal(S.oddDist[5] === undefined ? 0 : S.oddDist[5], countFrontOdd5(REAL));

  let co = 0;
  for (let a = 1; a <= 35; a++) for (let b = a + 1; b <= 35; b++) co += S.coMatrix[a][b];
  assert.equal(co, 10 * n);
  assert.ok(Math.abs(S.pairExpected - n * 20 / 1190) < 0.01);

  assert.ok(S.frontOmit.every((o) => o.curOmit >= 0 && o.curOmit <= n));
  assert.ok(S.backOmit.every((o) => o.curOmit >= 0 && o.curOmit <= n));
  assert.equal(S.frontOmit.length, 35);
  assert.equal(S.backOmit.length, 12);

  // 重号期望值：E[重号数] = 5 × 5/35 ≈ 0.714
  assert.ok(Math.abs(S.repeat.avg - 5 * 5 / 35) < 0.08, '实际重号均值应接近理论值，实际 ' + S.repeat.avg);

  // 和值理论与实际应量级一致
  const th = Core.sumTheoretical();
  let obsMid = 0;
  for (let s = Core.SUM_BANDS[2][0]; s <= Core.SUM_BANDS[2][1]; s++) obsMid += S.sumHist[s] || 0;
  assert.ok(Math.abs(obsMid / n - th.bandProbs[2]) < 0.08, '中间和值区占比应接近理论概率');
});

test('真实数据：奖金统计与公告一致', { skip: !REAL && 'data.js 不存在' }, () => {
  const S = Core.computeAll(REAL);
  const expectedJackpot = REAL.filter((r) => (r[6] || []).some((p) => p[0] === '一等奖')).length;
  assert.equal(S.prizeStats.jackpot.length, expectedJackpot);
  const withSales = REAL.filter((r) => Number(r[5]) > 0 && (r[6] || []).length).length;
  assert.equal(S.prizeStats.payout.length, withSales);
  assert.ok(S.prizeStats.overallRate > 0.3 && S.prizeStats.overallRate < 0.9, '整体返奖率应在合理区间');
  // 各奖级金额之和应等于逐期派奖之和
  let levelMoney = 0;
  Object.keys(S.prizeStats.levels).forEach((k) => { levelMoney += S.prizeStats.levels[k].money; });
  assert.equal(levelMoney, S.prizeStats.totalMoney);
  assert.equal(S.prizeStats.upgradedDraws + S.prizeStats.basicDraws, S.prizeStats.newRuleDraws);
  assert.ok(S.prizeStats.newRuleDraws > 0, '数据应包含 2026 新规施行后的期数');
});

test('真实数据：computeAll 性能可接受', { skip: !REAL && 'data.js 不存在' }, () => {
  const t0 = Date.now();
  Core.computeAll(REAL);
  const cost = Date.now() - t0;
  assert.ok(cost < 3000, '单次全量统计应在 3 秒内完成（实际 ' + cost + 'ms）');
});

// ---------- 辅助 ----------
function countFrontOdd5(rows) {
  return rows.filter((r) => r[2].every((n) => n % 2 === 1)).length;
}

// 生成 length 期合法随机数据（用于预测/回测测试）
function buildLongRows(length) {
  const rng = Shared.mulberry32(20260829);
  const rows = [];
  const start = new Date(2020, 0, 1);
  for (let i = 0; i < length; i++) {
    const d = new Date(start.getTime() + i * 3 * 86400000);
    const iso = d.getFullYear() + '-' + Shared.pad2(d.getMonth() + 1) + '-' + Shared.pad2(d.getDate());
    const issue = String(20001 + i);
    rows.push([issue, iso,
      Shared.sampleUniform(Core.FRONT_POOL, 5, rng),
      Shared.sampleUniform(Core.BACK_POOL, 2, rng),
      100000000 + i, 200000000, []]);
  }
  return rows.reverse();   // 最新在前
}
