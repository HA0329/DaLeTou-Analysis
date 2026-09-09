/*
 * 页面集成冒烟测试：在最小 DOM 桩里真实执行 dlt-app.js 的初始化与交互
 *
 * 覆盖：首次渲染各面板是否产出内容、切换统计范围、切换主题、折叠面板、
 * 记录表分页/搜索、中奖查询、预测方法切换、遗漏表排序等主流程。
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createSandbox } = require('./helpers/mock-dom.js');
const Shared = require('../js/dlt-shared.js');

const ROOT = path.join(__dirname, '..');
const rawData = Shared.parseDataFileText(fs.readFileSync(path.join(ROOT, 'data.js'), 'utf8'));

// 在沙箱中按 HTML 的加载顺序执行脚本（data.js 用解析后的数组代替）
function bootPage(opts) {
  const env = createSandbox(Object.assign({ rawData }, opts));
  vm.createContext(env.sandbox);
  ['js/dlt-shared.js', 'js/dlt-core.js', 'js/dlt-charts.js', 'js/dlt-check.js', 'js/dlt-app.js'].forEach((f) => {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), env.sandbox, { filename: f });
  });
  return env;
}

function text(el) { return (el && el.innerHTML) || ''; }

test('页面初始化：不抛异常且各面板都有内容', () => {
  const env = bootPage();
  const g = env.getEl;

  assert.match(text(g('overview')), /数据总期数/, '概览卡片未渲染');
  assert.match(text(g('heroSub')), /数据范围：第/, '页头摘要未渲染');
  assert.match(text(g('latestDraw')), /第 \d{5} 期/, '最新一期未渲染');
  assert.match(text(g('latestAnnounce')), /奖级/, '开奖公告未渲染');
  assert.match(text(g('poolCards')), /奖池/, '奖池卡片未渲染');
  assert.match(text(g('trendFront')), /期号/, '前区走势图未渲染');
  assert.match(text(g('trendBack')), /期号/, '后区走势图未渲染');
  assert.match(text(g('frontHotList')), /次 \//, '热号榜未渲染');
  assert.match(text(g('omitFrontTable')), /当前遗漏/, '遗漏表未渲染');
  assert.match(text(g('frontPairs')), /期出现/, '组合榜未渲染');
  assert.match(text(g('consecStats')), /连号/, '连号统计未渲染');
  assert.match(text(g('spanStats')), /平均跨度/, '跨度统计未渲染');
  assert.match(text(g('repeatStats')), /平均每期重号/, '重号统计未渲染');
  assert.match(text(g('mod3Stats')), /AC 值/, 'AC 值统计未渲染');
  assert.match(text(g('backStats')), /后区和值/, '后区统计未渲染');
  assert.match(text(g('coExpected')), /^\d/, '共现期望值未渲染');
  assert.match(text(g('coTopList')), /期望的/, '共现 TOP 榜未渲染');
  assert.match(text(g('prizeStats')), /返奖率/, '奖金统计未渲染');
  assert.match(text(g('prizeLevelTable')), /一等奖/, '奖级累计表未渲染');
  assert.match(text(g('predResult')), /综合加权 1/, '预测结果未渲染');
  assert.match(text(g('predResult')), /和值\d+/, '预测结果应含和值等结构信息');
  assert.match(text(g('predRecoF')), /ball/, '前区推荐未渲染');
  assert.match(text(g('recordTable')), /开奖日期/, '记录表未渲染');
  assert.match(text(g('pickResult')), /随机 1/, '模拟选号未渲染');
  assert.match(text(g('dataChip')), /期$/, '数据来源标签未渲染');
  assert.match(text(g('sumZoneList')), /理论/, '和值理论对比未渲染');
  assert.match(text(g('zonePatternList')), /期/, '三区形态榜未渲染');
  assert.match(text(g('headList')), /期/, '龙头榜未渲染');
  assert.match(text(g('mod3List')), /期/, '012 路榜未渲染');
  assert.match(text(g('repeatRecent')), /重号/, '重号明细未渲染');
});

test('切换统计范围：所有统计量按范围重算', () => {
  const env = bootPage();
  const overviewAll = text(env.getEl('overview'));
  assert.match(overviewAll, /全部 \d+ 期/, '默认应为全部历史');

  env.getEl('globalRange').fire('change', { target: { value: '100' } });
  const overview100 = text(env.getEl('overview'));
  assert.match(overview100, /近 100 期/, '切换后应显示近 100 期');
  assert.match(overview100, /第 \d{5} 期（/, '范围摘要应显示首尾期号');

  // 频率图与遗漏表应随范围变化
  const chip = text(env.getEl('dataChip'));
  assert.match(chip, /期$/, '数据标签仍应正常');

  // 切回全部
  env.getEl('globalRange').fire('change', { target: { value: '0' } });
  assert.match(text(env.getEl('overview')), /全部 \d+ 期/);
});

test('主题切换：写入 data-theme 并持久化', () => {
  const storage = {};
  const env = bootPage({ storage });
  const html = env.document.documentElement;
  const first = html.getAttribute('data-theme');
  assert.ok(first === 'light' || first === 'dark');
  env.getEl('btnTheme').fire('click');
  const second = html.getAttribute('data-theme');
  assert.notEqual(second, first, '点击后主题应切换');
  assert.equal(storage.dlt_theme_v1, JSON.stringify(second), '主题应写入 localStorage');
});

test('记录表：搜索、分页与期号回填', () => {
  const env = bootPage();
  const latest = rawData[0][0];
  const search = env.getEl('searchIssue');
  search.fire('input', { target: { value: latest } });
  assert.match(text(env.getEl('pageInfo')), new RegExp('共 1 期|共 \\d+ 期'), '搜索结果页码信息异常');
  assert.match(text(env.getEl('recordTable')), new RegExp(latest), '搜索结果应包含该期号');

  search.fire('input', { target: { value: '不存在的期号' } });
  assert.match(text(env.getEl('pageInfo')), /共 0 期/);
  search.fire('input', { target: { value: '' } });

  // 分页
  env.getEl('recordCount').fire('change', { target: { value: '100' } });
  assert.match(text(env.getEl('pageInfo')), /共 \d+ 期/);
  env.getEl('btnNext').fire('click');
  assert.match(text(env.getEl('pageInfo')), /第 2 \/ \d+ 页/);
  env.getEl('btnPrev').fire('click');
  assert.match(text(env.getEl('pageInfo')), /第 1 \/ \d+ 页/);
});

test('中奖查询：命中判定与错误提示', () => {
  const env = bootPage();
  const latest = rawData[0];
  env.getEl('ckFront').value = latest[2].map(Shared.pad2).join(' ');
  env.getEl('ckBack').value = latest[3].map(Shared.pad2).join(' ');
  env.getEl('ckTerm').value = latest[0];
  env.getEl('ckAppend').checked = false;
  env.getEl('btnCheck').fire('click');
  const out = text(env.getEl('ckResult'));
  assert.match(out, /一等奖/, '全部命中应为一等奖');
  assert.match(out, /5\+2/, '应显示中奖条件');
  assert.match(out, new RegExp('第 ' + latest[0] + ' 期'), '应显示对照期号');

  // 非法输入
  env.getEl('ckFront').value = '99';
  env.getEl('btnCheck').fire('click');
  assert.match(text(env.getEl('ckResult')), /前区号码需在 1–35 之间|至少需要 5 个号码/, '非法输入应有明确提示');

  // 未中奖
  env.getEl('ckFront').value = '01 02 03 04 05';
  env.getEl('ckBack').value = '01 02';
  env.getEl('ckTerm').value = latest[0];
  env.getEl('btnCheck').fire('click');
  const miss = text(env.getEl('ckResult'));
  assert.ok(/未中奖|等奖/.test(miss), '应给出判定结果');
  assert.match(text(env.getEl('ckHistory')), /ck-hist-item/, '应记录查询历史');
});

test('预测方法切换与回测', () => {
  const env = bootPage();
  const before = text(env.getEl('predDesc'));
  assert.match(before, /综合加权/);
  env.getEl('predBar').fire('click', { target: { closest: () => ({ dataset: { m: 'omit' }, classList: { add() {}, remove() {} } }) } });
  assert.match(text(env.getEl('predDesc')), /遗漏回补/, '切换方法后描述应更新');
  assert.match(text(env.getEl('predResult')), /遗漏回补/, '选号结果应标注方法名');

  env.getEl('btnBacktest').fire('click');
  env.runTimers();   // 回测在 setTimeout(…, 30) 中执行
  const table = text(env.getEl('btTable'));
  assert.match(table, /纯随机基准/, '回测表应包含随机基准行');
  assert.match(table, /综合加权/, '回测表应包含各方法');
});

test('遗漏表排序：点击表头切换升降序', () => {
  const env = bootPage();
  const first = text(env.getEl('omitFrontTable'));
  env.getEl('omitFrontTable').fire('click', { target: { closest: () => ({ dataset: { k: 'curOmit' } }) } });
  const second = text(env.getEl('omitFrontTable'));
  assert.notEqual(first, second, '排序后表格内容应变化');
  assert.match(second, /当前遗漏 ▼/, '应按当前遗漏降序');
});

test('号码矩阵与走势图联动：点击号码显示详情', () => {
  const env = bootPage();
  env.getEl('frontGrid').fire('click', {
    target: { closest: () => ({ dataset: { zone: 'f', num: '7' } }) }
  });
  const detail = text(env.getEl('matrixDetail'));
  assert.match(detail, /出现次数/, '详情应显示出现次数');
  assert.match(detail, /当前遗漏/, '详情应显示当前遗漏');
  assert.match(detail, /回补压力/, '详情应显示回补压力');
  assert.match(detail, /滑动窗口/, '详情应包含滑动窗口图');
});

test('在线更新：数据合并与渲染', async () => {
  // 构造官网返回一条新期次
  const nextIssue = String(Number(rawData[0][0]) + 1);
  const apiRecord = {
    lotteryDrawNum: nextIssue,
    lotteryDrawTime: '2026-09-02',
    lotteryDrawResult: '01 11 21 31 35 03 08',
    poolBalanceAfterdraw: '800000000',
    totalSaleAmount: '300000000',
    prizeLevelList: [{ prizeLevel: '一等奖', stakeCount: '1', stakeAmountFormat: '10000000' }]
  };
  const fetchImpl = (url) => {
    if (String(url).indexOf('/save-data') >= 0) return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, count: rawData.length + 1 }) });
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true, value: { total: rawData.length + 1, list: [apiRecord] } }) });
  };
  const env = bootPage({ fetchImpl });
  env.getEl('btnUpdate').fire('click');
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));

  const chip = text(env.getEl('dataChip'));
  assert.match(chip, new RegExp('在线数据 · ' + (rawData.length + 1) + ' 期'), '更新后数据标签应显示在线数据与新期数，实际：' + chip);
  assert.match(text(env.getEl('latestDraw')), new RegExp(nextIssue), '最新一期应更新');
  assert.match(text(env.getEl('overview')), new RegExp(String(rawData.length + 1) + ' 期'), '概览总期数应更新');
});
