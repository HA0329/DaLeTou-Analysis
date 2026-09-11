/*
 * 在线更新的「官网直连 / 仓库 data.js 降级」路径测试
 *
 * 背景：体彩官网接口带 Access-Control-Allow-Origin: *，线上（GitHub Pages）页面
 * 应当直连官网取实时数据；仅当官网不可用时，才退回同源 data.js（由 Action 同步）。
 * 这里分别锁定这两条路径的行为，避免以后被改回「只读 data.js」。
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

// 模拟 GitHub Pages 环境（非 localhost）
const PAGES_LOCATION = {
  protocol: 'https:',
  origin: 'https://ha0329.github.io',
  href: 'https://ha0329.github.io/DaLeTou-Analysis/',
  hostname: 'ha0329.github.io'
};

function bootPage(opts) {
  // realTimers：在线更新失败后带 setTimeout 退避重试，需要真实定时器才能推进
  // timerScale：把 800ms/1600ms 退避压缩为 80ms/160ms，避免拖慢测试
  const env = createSandbox(Object.assign({ rawData, location: PAGES_LOCATION, realTimers: true, timerScale: 0.1 }, opts));
  vm.createContext(env.sandbox);
  ['js/dlt-shared.js', 'js/dlt-core.js', 'js/dlt-charts.js', 'js/dlt-check.js', 'js/dlt-app.js'].forEach((f) => {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), env.sandbox, { filename: f });
  });
  return env;
}
function text(el) { return (el && el.innerHTML) || ''; }
// 等待足够多的宏任务轮次，覆盖「重试 → 降级」的完整异步链路
async function settle() {
  for (let i = 0; i < 60; i++) await new Promise((r) => setTimeout(r, 5));
}

// 构造一期「比 data.js 更新」的数据（期号 +1，保证排序仍在最前）
function buildNewerRows() {
  const nextIssue = String(Number(rawData[0][0]) + 1);
  const row = [nextIssue, '2026-09-12', [1, 2, 3, 4, 5], [6, 7], 800000000, 300000000,
    [['一等奖', 1, 10000000]]];
  return { nextIssue, rows: [row].concat(rawData) };
}

test('Pages 模式：优先直连官网（不依赖 data.js，也不依赖第三方代理）', async () => {
  const { nextIssue, rows } = buildNewerRows();
  const called = [];
  const fetchImpl = (url) => {
    called.push(String(url));
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        success: true,
        value: {
          total: rows.length,
          list: [{
            lotteryDrawNum: nextIssue,
            lotteryDrawTime: '2026-09-12',
            lotteryDrawResult: '01 02 03 04 05 06 07',
            poolBalanceAfterdraw: '800000000',
            totalSaleAmount: '300000000',
            prizeLevelList: [{ prizeLevel: '一等奖', stakeCount: '1', stakeAmountFormat: '10000000' }]
          }]
        }
      })
    });
  };

  const env = bootPage({ fetchImpl });
  env.getEl('btnUpdate').fire('click');
  await settle();

  const apiCalls = called.filter((u) => u.indexOf('webapi.sporttery.cn') >= 0);
  assert.ok(apiCalls.length > 0, '应直连体彩官网接口');
  assert.equal(called.filter((u) => /allorigins|corsproxy|codetabs/.test(u)).length, 0,
    '官网直连可用时不应调用任何第三方 CORS 代理');

  const chip = text(env.getEl('dataChip'));
  assert.match(chip, /官网实时/, '数据来源应标记为官网实时，实际：' + chip);
  assert.match(chip, new RegExp(String(rows.length) + ' 期'), '期数应为 ' + rows.length + '，实际：' + chip);
});

test('Pages 模式：官网不可用时降级到同源 data.js，且不出现数据倒退', async () => {
  const { nextIssue, rows } = buildNewerRows();
  // 官网与所有代理全部失败
  const fetchImpl = () => Promise.reject(new TypeError('Failed to fetch'));

  const env = bootPage({ fetchImpl, rawDataMap: { 'data.js': rows } });
  env.getEl('btnUpdate').fire('click');
  await settle();

  const chip = text(env.getEl('dataChip'));
  assert.match(chip, /仓库同步/, '降级后数据来源应标记为仓库同步，实际：' + chip);
  assert.match(chip, new RegExp(String(rows.length) + ' 期'), '应采用 data.js 的新数据，实际：' + chip);
  assert.match(text(env.getEl('latestDraw')), new RegExp(nextIssue), '最新一期应更新到 ' + nextIssue);
});

test('Pages 模式：官网与 data.js 都没有新数据时提示「已是最新」且不改变数据', async () => {
  const fetchImpl = (url) => {
    // 官网返回的第一条就是本地已有期号 → 增量抓取立即停止，视为无新数据
    if (String(url).indexOf('webapi.sporttery.cn') >= 0) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          value: {
            total: rawData.length,
            list: [{ lotteryDrawNum: rawData[0][0], lotteryDrawTime: rawData[0][1], lotteryDrawResult: '01 02 03 04 05 06 07' }]
          }
        })
      });
    }
    return Promise.reject(new TypeError('Failed to fetch'));
  };

  const env = bootPage({ fetchImpl, rawDataMap: { 'data.js': rawData } });
  env.getEl('btnUpdate').fire('click');
  await settle();

  const chip = text(env.getEl('dataChip'));
  assert.match(chip, new RegExp(String(rawData.length) + ' 期'), '期数不应变化，实际：' + chip);
  assert.match(chip, /内置数据|本地缓存/, '来源应保持内置/缓存，实际：' + chip);
});

test('file:// 模式：请求失败后不卡在更新中状态', async () => {
  // file:// 无法跨域，更新必然失败；这里只锁定「不会把界面卡在更新中」这一可观测行为。
  // （提示文案依赖真实浏览器抛出的 TypeError，最小 DOM 桩无法完整复现该分支）
  const env = bootPage({
    location: { protocol: 'file:', origin: 'null', href: 'file:///x.html', hostname: '' },
    fetchImpl: () => Promise.resolve().then(() => { throw new TypeError('Failed to fetch'); })
  });
  env.getEl('btnUpdate').fire('click');
  await settle();
  assert.equal(env.getEl('updateBar').hidden, true, '失败后应复位进度条，不能一直显示更新中');
  assert.equal(env.getEl('btnUpdate').disabled, false, '失败后按钮应恢复可用');
});
