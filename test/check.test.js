/*
 * dlt-check.js 中奖判定逻辑测试（用 vm 注入最小 DOM 桩，覆盖纯计算部分）
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Shared = require('../js/dlt-shared.js');

// 在隔离沙箱里加载浏览器模块（它只在函数内部访问 document，加载阶段是安全的）
function loadCheckModule() {
  const code = fs.readFileSync(path.join(__dirname, '..', 'js', 'dlt-check.js'), 'utf8');
  const sandbox = { window: { DltShared: Shared }, document: { getElementById: () => null }, console };
  sandbox.window.window = sandbox.window;
  sandbox.window.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: 'dlt-check.js' });
  return sandbox.window.DltCheck;
}
const Check = loadCheckModule();

test('奖级映射：13 个中奖条件全部覆盖，且无多余项', () => {
  const PREFIX = Check.RULES.PREFIX;
  const conditions = Object.keys(PREFIX);
  assert.equal(conditions.length, 13);
  // 与「中奖条件」文案表一致
  const expected = ['5+2', '5+1', '5+0', '4+2', '4+1', '4+0', '3+2', '3+1', '2+2', '3+0', '1+2', '2+1', '0+2'];
  assert.deepEqual(conditions.sort(), expected.sort());
  // 5+2 只能是一等奖，0+2 只能是七等奖
  assert.equal(PREFIX['5+2'], 1);
  assert.equal(PREFIX['0+2'], 7);
  assert.equal(PREFIX['4+2'], 3, '4+2 与 5+0 同为三等奖');
  assert.equal(PREFIX['2+2'], 6, '2+2 与 3+1 同为六等奖');
});

test('单注命中：13 个中奖条件逐一判定正确', () => {
  const FD = [1, 2, 3, 4, 5], BD = [1, 2];
  const cases = [
    { cond: '5+2', F: [1, 2, 3, 4, 5], B: [1, 2], level: 1 },
    { cond: '5+1', F: [1, 2, 3, 4, 5], B: [1, 3], level: 2 },
    { cond: '5+0', F: [1, 2, 3, 4, 5], B: [3, 4], level: 3 },
    { cond: '4+2', F: [1, 2, 3, 4, 6], B: [1, 2], level: 3 },
    { cond: '4+1', F: [1, 2, 3, 4, 6], B: [1, 3], level: 4 },
    { cond: '4+0', F: [1, 2, 3, 4, 6], B: [3, 4], level: 5 },
    { cond: '3+2', F: [1, 2, 3, 6, 7], B: [1, 2], level: 5 },
    { cond: '3+1', F: [1, 2, 3, 6, 7], B: [1, 3], level: 6 },
    { cond: '2+2', F: [1, 2, 6, 7, 8], B: [1, 2], level: 6 },
    { cond: '3+0', F: [1, 2, 3, 6, 7], B: [3, 4], level: 7 },
    { cond: '1+2', F: [1, 6, 7, 8, 9], B: [1, 2], level: 7 },
    { cond: '2+1', F: [1, 2, 6, 7, 8], B: [1, 3], level: 7 },
    { cond: '0+2', F: [6, 7, 8, 9, 10], B: [1, 2], level: 7 }
  ];
  cases.forEach((c) => {
    const res = Check.countByLevel(c.F, c.B, FD, BD, false);
    const levels = Object.keys(res.stat).map(Number);
    assert.deepEqual(levels, [c.level], c.cond + ' 应中 ' + c.level + ' 等奖（实际 ' + JSON.stringify(levels) + '）');
    assert.equal(res.stat[c.level].combos, 1, c.cond + ' 单注应恰好 1 注');
    assert.equal(res.covered, 1);
    assert.equal(res.totalCombos, 1);
  });

  // 未中奖
  const miss = Check.countByLevel([6, 7, 8, 9, 10], [3, 4], FD, BD, false);
  assert.deepEqual(Object.keys(miss.stat), []);
  assert.equal(miss.totalCombos, 1);
});

test('复式投注：注数守恒（命中注数合计 = 总注数）', () => {
  // 7+3 复式，命中 5+2：每个中奖注数都应被某个奖级覆盖
  const F = [1, 2, 3, 4, 5, 6, 7], B = [1, 2, 3];
  const FD = [1, 2, 3, 4, 5], BD = [1, 2];
  const res = Check.countByLevel(F, B, FD, BD, false);
  assert.equal(res.totalCombos, Shared.comb(7, 5) * Shared.comb(3, 2), '7+3 复式 = 63 注');
  assert.equal(res.covered, res.totalCombos, '所有 63 注都应落在某个奖级上');
  // 一等奖 1 注、二等奖 2 注（5+1）
  assert.equal(res.stat[1].combos, 1);
  assert.equal(res.stat[2].combos, 2);
});

test('固定奖金额：基本档 / 8 亿升级档', () => {
  const F = [1, 2, 3, 6, 7], B = [1, 4];   // 3+1 → 六等奖
  const FD = [1, 2, 3, 4, 5], BD = [1, 2];
  const basic = Check.countByLevel(F, B, FD, BD, false);
  const upgraded = Check.countByLevel(F, B, FD, BD, true);
  assert.equal(basic.stat[6].money, 15, '六等奖基本档 15 元');
  assert.equal(upgraded.stat[6].money, 18, '六等奖升级档 18 元');

  const F7 = [1, 2, 3, 6, 7], B7 = [3, 4];  // 3+0 → 七等奖
  assert.equal(Check.countByLevel(F7, B7, FD, BD, false).stat[7].money, 5);
  assert.equal(Check.countByLevel(F7, B7, FD, BD, true).stat[7].money, 7);

  const F3 = [1, 2, 3, 4, 6], B3 = [3, 4];  // 4+0 → 五等奖
  assert.equal(Check.countByLevel(F3, B3, FD, BD, false).stat[5].money, 150);
  assert.equal(Check.countByLevel(F3, B3, FD, BD, true).stat[5].money, 200);

  const F4 = [1, 2, 3, 4, 6], B4 = [1, 4];  // 4+1 → 四等奖
  assert.equal(Check.countByLevel(F4, B4, FD, BD, false).stat[4].money, 300);
  assert.equal(Check.countByLevel(F4, B4, FD, BD, true).stat[4].money, 380);

  const F5 = [1, 2, 3, 4, 5], B5 = [3, 4];  // 5+0 → 三等奖
  assert.equal(Check.countByLevel(F5, B5, FD, BD, false).stat[3].money, 5000);
  assert.equal(Check.countByLevel(F5, B5, FD, BD, true).stat[3].money, 6666);
});

test('一、二等奖为浮动奖金，固定奖金额不计入', () => {
  const res = Check.countByLevel([1, 2, 3, 4, 5], [1, 2], [1, 2, 3, 4, 5], [1, 2], true);
  assert.equal(res.stat[1].money, 0, '一等奖浮动，不应有固定金额');
  assert.equal(res.stat[1].combos, 1);
});

test('基本档 / 升级档奖金表与规则表一致', () => {
  // vm 沙箱里的对象属于另一个 realm，展开成宿主对象后再比较
  assert.deepEqual({ ...Check.RULES.BASE }, { 3: 5000, 4: 300, 5: 150, 6: 15, 7: 5 });
  assert.deepEqual({ ...Check.RULES.UP }, { 3: 6666, 4: 380, 5: 200, 6: 18, 7: 7 });
  assert.equal(Check.RULES.NAME[1], '一等奖');
  assert.equal(Check.RULES.NAME[7], '七等奖');
  assert.match(Check.RULES.COND[5], /4\+0 \/ 3\+2/);
});

test('大复式（12+6）注数计算不溢出，未中奖注数符合组合数学', () => {
  const F = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], B = [1, 2, 3, 4, 5, 6];
  const FD = [1, 2, 3, 4, 5], BD = [1, 2];   // 命中 5+2
  const res = Check.countByLevel(F, B, FD, BD, false);
  assert.equal(res.totalCombos, Shared.comb(12, 5) * Shared.comb(6, 2));

  // 未中奖的 (f,b) 组合只有 0+0 / 0+1 / 1+0 / 1+1 / 2+0 五种
  const losing = [[0, 0], [0, 1], [1, 0], [1, 1], [2, 0]].reduce((acc, [f, b]) => acc +
    Shared.comb(5, f) * Shared.comb(12 - 5, 5 - f) * Shared.comb(2, b) * Shared.comb(6 - 2, 2 - b), 0);
  assert.equal(res.covered, res.totalCombos - losing, '中奖注数 = 总注数 − 未中奖注数');
  assert.ok(losing > 0 && res.covered > 0);
});
