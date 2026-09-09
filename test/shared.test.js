/*
 * dlt-shared.js 单元测试（node:test，零依赖）
 * 运行：npm test  或  node --test test/
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Shared = require('../js/dlt-shared.js');

test('常量与奖池升级线', () => {
  assert.equal(Shared.FRONT_MAX, 35);
  assert.equal(Shared.BACK_MAX, 12);
  assert.equal(Shared.EIGHT_YI, 800000000);
  assert.equal(Shared.NEW_RULE_DATE, '2026-02-02');
  assert.equal(Shared.FRONT_MAX_PICK, 12);
  assert.equal(Shared.BACK_MAX_PICK, 6);
});

test('esc 转义所有 HTML 危险字符', () => {
  assert.equal(Shared.esc('<img src=x onerror="alert(1)">'),
    '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
  assert.equal(Shared.esc("a&b'c"), 'a&amp;b&#39;c');
  assert.equal(Shared.esc(null), '');
  assert.equal(Shared.esc(0), '0');
});

test('comb 组合数与边界', () => {
  assert.equal(Shared.comb(35, 5), 324632);
  assert.equal(Shared.comb(12, 5), 792);
  assert.equal(Shared.comb(2, 2), 1);
  assert.equal(Shared.comb(5, 0), 1);
  assert.equal(Shared.comb(3, 5), 0);
  assert.equal(Shared.comb(5, -1), 0);
});

test('toRow：官网记录 → 紧凑行（含奖级占位符归一）', () => {
  const row = Shared.toRow({
    lotteryDrawNum: '26098',
    lotteryDrawTime: '2026-08-29',
    lotteryDrawResult: '07 09 18 19 21 02 09',
    poolBalanceAfterdraw: '706,544,163.92',
    totalSaleAmount: '315,878,206',
    prizeLevelList: [
      { prizeLevel: '一等奖', stakeCount: '15', stakeAmountFormat: '5050505' },
      { prizeLevel: '三等奖', stakeCount: '0', stakeAmountFormat: '-1', stakeAmount: '---' }
    ]
  });
  assert.deepEqual(row[0], '26098');
  assert.deepEqual(row[1], '2026-08-29');
  assert.deepEqual(row[2], [7, 9, 18, 19, 21]);
  assert.deepEqual(row[3], [2, 9]);
  assert.equal(row[4], 706544163.92);
  assert.equal(row[5], 315878206);
  assert.deepEqual(row[6], [['一等奖', 15, 5050505], ['三等奖', 0, 0]]);
});

test('toRow：号码个数异常时抛错', () => {
  assert.throws(() => Shared.toRow({ lotteryDrawNum: '1', lotteryDrawResult: '01 02 03' }), /开奖号码异常/);
});

test('assertRows：接受合法数据、拒绝各类坏数据', () => {
  const ok = [['26098', '2026-08-29', [7, 9, 18, 19, 21], [2, 9], 1e8, 1e8, [['一等奖', 1, 5000000]]],
    ['26097', '2026-08-26', [3, 10, 12, 20, 25], [1, 9], 1e8, 1e8, []]];
  assert.equal(Shared.assertRows(ok), true);

  const bad = (mutate, re) => {
    const rows = JSON.parse(JSON.stringify(ok));
    mutate(rows);
    assert.throws(() => Shared.assertRows(rows), re);
  };
  bad((r) => { r[0][0] = '2609'; }, /期号格式异常/);                       // 期号非 5 位
  bad((r) => { r[1][0] = '26098'; }, /期号重复/);                          // 期号重复
  bad((r) => { r[0][1] = '2026/08/29'; }, /开奖日期格式异常/);              // 日期格式
  bad((r) => { r[0][2] = [7, 9, 18, 19]; }, /前区异常/);                   // 前区个数
  bad((r) => { r[0][2] = [7, 9, 18, 19, 36]; }, /前区异常/);               // 前区越界
  bad((r) => { r[0][2] = [7, 9, 18, 19, 18]; }, /前区异常/);               // 前区未升序
  bad((r) => { r[0][3] = [2, 13]; }, /后区异常/);                          // 后区越界
  bad((r) => { r[0][4] = -1; }, /奖池异常/);
  bad((r) => { r[0][5] = 'abc'; }, /销量异常/);
  bad((r) => { r[0][6] = [['一等奖', 1]]; }, /公告条目异常/);
  bad((r) => { r[0][6] = [[1, 1, 1]]; }, /公告奖级异常/);
  bad((r) => { r[0][6] = [['一等奖', 1.5, 1]]; }, /公告注数异常/);
  bad((r) => { r.reverse(); }, /期号未按降序排列/);                        // 顺序错误
  bad((r) => { r[0][2] = [7, 9, 18, 19, 21]; r.pop(); r.pop(); }, /期数过少/);
});

test('mergeRows：去重 + 按期号降序 + 不修改入参', () => {
  const old = [['26097', '2026-08-26', [3, 10, 12, 20, 25], [1, 9]],
    ['26096', '2026-08-24', [1, 2, 3, 4, 5], [6, 7]]];
  const fresh = [['26099', '2026-08-31', [1, 2, 3, 4, 6], [2, 3]],
    ['26098', '2026-08-29', [7, 9, 18, 19, 21], [2, 9]],
    ['26098', '2026-08-29', [7, 9, 18, 19, 21], [2, 9]],   // 官网重复返回
    ['26097', '2026-08-26', [3, 10, 12, 20, 25], [1, 9]]]; // 已存在
  const merged = Shared.mergeRows(fresh, old);
  assert.deepEqual(merged.map((r) => r[0]), ['26099', '26098', '26097', '26096']);
  assert.equal(old.length, 2, '原数组不应被修改');
  Shared.assertRows(merged);
});

test('dataFileContent ↔ parseDataFileText 往返一致', () => {
  const rows = [['26098', '2026-08-29', [7, 9, 18, 19, 21], [2, 9], 706544163.92, 315878206, [['一等奖', 15, 5050505]]],
    ['26097', '2026-08-26', [3, 10, 12, 20, 25], [1, 9], 762988475.69, 296031159, []]];
  const text = Shared.dataFileContent(rows);
  assert.match(text, /^\/\/ 大乐透历史开奖数据/);
  assert.match(text, /var RAW_DATA = \[/);
  assert.deepEqual(Shared.parseDataFileText(text), rows);
});

test('parseDataFileText：缺少标记 / 数据块不完整时报错', () => {
  assert.throws(() => Shared.parseDataFileText('var X = [];'), /未找到 RAW_DATA/);
  assert.throws(() => Shared.parseDataFileText('var RAW_DATA = [[1,2],'), /数据块不完整/);
});

test('parseNumsInput：解析与校验', () => {
  assert.deepEqual(Shared.parseNumsInput('21 03 07', 35, 3, 12, '前区'), [3, 7, 21]);
  assert.deepEqual(Shared.parseNumsInput('01,02，03、04', 35, 2, 12, '前区'), [1, 2, 3, 4]);
  assert.throws(() => Shared.parseNumsInput('0 1 2', 35, 3, 12, '前区'), /需在 1–35 之间/);
  assert.throws(() => Shared.parseNumsInput('1 2', 35, 3, 12, '前区'), /至少需要 3 个/);
  assert.throws(() => Shared.parseNumsInput('1 1 2', 35, 3, 12, '前区'), /不能重复/);
  assert.throws(() => Shared.parseNumsInput('1 2 3 4 5 6 7 8 9 10 11 12 13', 35, 3, 12, '前区'), /号码太多/);
});

test('mulberry32 / 抽样：可复现且不重复', () => {
  const a = Shared.mulberry32(42), b = Shared.mulberry32(42), c = Shared.mulberry32(43);
  const seqA = [a(), a(), a()], seqB = [b(), b(), b()], seqC = [c(), c(), c()];
  assert.deepEqual(seqA, seqB, '同种子结果必须一致');
  assert.notDeepEqual(seqA, seqC, '不同种子应给出不同序列');
  seqA.forEach((v) => assert.ok(v >= 0 && v < 1));

  const pool = Array.from({ length: 35 }, (_, i) => i + 1);
  const pick = Shared.sampleUniform(pool, 5, Shared.mulberry32(7));
  assert.equal(pick.length, 5);
  assert.equal(new Set(pick).size, 5, '无放回抽样不应重复');
  assert.deepEqual(pick, pick.slice().sort((x, y) => x - y), '结果应升序');
  assert.deepEqual(pick, Shared.sampleUniform(pool, 5, Shared.mulberry32(7)), '同种子抽样可复现');

  // 加权抽样：权重为 0 的号码不应被选中
  const weights = {}; pool.forEach((n) => { weights[n] = n === 1 ? 0 : 1; });
  for (let i = 0; i < 50; i++) {
    assert.ok(Shared.sampleWeighted(pool, weights, 5).indexOf(1) < 0);
  }
});

test('开奖时间推算：周一/三/六 21:25', () => {
  // 2026-08-31 是周一；09-02 周三；09-05 周六
  const monday = new Date(2026, 7, 31, 10, 0, 0);
  assert.equal(Shared.nextDrawInfo(monday).time.getDay(), 1);
  assert.equal(Shared.nextDrawInfo(monday).time.getHours(), 21);
  assert.equal(Shared.nextDrawInfo(monday).time.getMinutes(), 25);

  const mondayNight = new Date(2026, 7, 31, 22, 0, 0);         // 周一 22:00 → 下一次是周三
  assert.equal(Shared.nextDrawInfo(mondayNight).time.getDay(), 3);
  assert.equal(Shared.prevDrawInfo(mondayNight).time.getDay(), 1);
  assert.equal(Shared.fmtDate(Shared.prevDrawInfo(mondayNight).time), '2026-08-31');

  const sunday = new Date(2026, 7, 30, 12, 0, 0);              // 周日 → 下次周一，上次周六
  assert.equal(Shared.nextDrawInfo(sunday).time.getDay(), 1);
  assert.equal(Shared.prevDrawInfo(sunday).time.getDay(), 6);
  assert.equal(Shared.weekdayName('2026-08-29'), '周六');
});

test('buildCsv：BOM、转义与换行', () => {
  const csv = Shared.buildCsv(['期号', '备注'], [['26098', '含,逗号'], ['26097', '含"引号"']]);
  assert.ok(csv.startsWith('\ufeff'), '应以 BOM 开头');
  assert.match(csv, /"含,逗号"/);
  assert.match(csv, /"含""引号"""/);
  assert.ok(csv.includes('\r\n'), '应使用 CRLF');
});

test('格式化工具', () => {
  assert.equal(Shared.pad2(7), '07');
  assert.equal(Shared.pad2(12), '12');
  assert.equal(Shared.fmtYi(800000000), '8.00 亿');
  assert.equal(Shared.fmtMoney(0), '—');
  assert.equal(Shared.fmtMoney(5000), '5,000 元');
  assert.match(Shared.fmtMoney(120000), /12\.0 万元/);
  assert.match(Shared.fmtMoney(300000000), /3\.00 亿元/);
  assert.equal(Shared.fmtNum(0), '—');
  assert.equal(Shared.fmtPct(0.5123), '51.23%');
});
