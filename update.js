/*
 * 大乐透历史数据分析 —— 数据更新脚本（离线备用入口）
 * 用法：node update.js
 * 作用：从中国体育彩票官网接口抓取全部历史开奖 → 校验 → 重建页面内嵌数据
 * 说明：页面本身已内置「🔄 在线更新」按钮（浏览器内直接抓取并缓存到 localStorage），
 *       本脚本仅作为无浏览器/离线环境下更新内嵌数据之用，二者结果一致。
 * 数据格式 v2：每期为 [期号, 开奖日期, 前区[5], 后区[2], 奖池, 销量, 开奖公告[[奖级,注数,单注奖金],...]]
 * 注意：页面内嵌数据块必须保留 `const RAW_DATA = ` 标记（布局等直接编辑 HTML 即可）。
 */
'use strict';
const fs = require('fs');
const path = require('path');

const HTML_FILE = path.join(__dirname, '大乐透历史数据分析.html');
const PAGE_SIZE = 100;
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  'Referer': 'https://static.sporttery.cn/',
  'Accept': 'application/json, text/javascript, */*; q=0.01',
  'X-Requested-With': 'XMLHttpRequest'
};

// 带重试的翻页抓取：任一页瞬时网络抖动时自动重试（最多 3 次，退避递增），避免整次更新中断
async function fetchPage(url, retries) {
  retries = retries || 0;
  try {
    const res = await fetch(url, { headers: HEADERS });
    if (!res.ok) throw new Error('接口返回 HTTP ' + res.status);
    return await res.json();
  } catch (e) {
    if (retries < 3) {
      const pageNo = (url.match(/pageNo=(\d+)/) || [])[1] || '?';
      console.log('  第 ' + pageNo + ' 页请求失败（' + e.message + '），' + (retries + 1) + '/3 次重试…');
      await new Promise((r) => setTimeout(r, 1000 * (retries + 1)));
      return fetchPage(url, retries + 1);
    }
    throw e;
  }
}

async function fetchAll() {
  const all = [];
  let page = 1, total = null;
  while (true) {
    const url = 'https://webapi.sporttery.cn/gateway/lottery/getHistoryPageListV1.qry' +
      '?gameNo=85&provinceId=0&pageSize=' + PAGE_SIZE + '&isVerify=1&pageNo=' + page;
    const j = await fetchPage(url);
    if (!j || !j.success || !j.value || !Array.isArray(j.value.list)) throw new Error('接口返回格式异常');
    if (total === null) total = j.value.total;
    for (const it of j.value.list) all.push(it);
    console.log('第 ' + page + ' 页：' + all.length + ' / ' + total);
    if (j.value.list.length < PAGE_SIZE || all.length >= total) break;
    page++;
    await new Promise((r) => setTimeout(r, 150));
  }
  return all;
}

function toCompact(list) {
  const rows = list.map((it) => {
    const nums = String(it.lotteryDrawResult).trim().split(/\s+/).filter(Boolean).map(Number);
    if (nums.length !== 7) throw new Error('期号 ' + it.lotteryDrawNum + ' 开奖号码异常：' + it.lotteryDrawResult);
    const pool = Number(String(it.poolBalanceAfterdraw || '0').replace(/,/g, '')) || 0; // 当期开奖后奖池，供中奖查询判定固定奖升级档
    const sales = Number(String(it.totalSaleAmount || '').replace(/,/g, '')) || 0;       // 本期销量（早期数据可能为空）
    // 官网对"无人中奖"的奖级返回占位符（stakeAmountFormat:"-1"、stakeAmount:"---"），
    // 负数/NaN 统一归一为 0（0 注即 0 元，与官方语义一致，且能通过 server.js 校验）
    const toNum = (v) => { const n = Number(String(v || '').replace(/,/g, '')); return Number.isFinite(n) && n > 0 ? n : 0; };
    const prizes = (it.prizeLevelList || []).map((p) => [                                 // 开奖公告：各奖级中奖注数与单注奖金
      String(p.prizeLevel || ''),
      toNum(p.stakeCount),
      toNum(p.stakeAmountFormat) || toNum(p.stakeAmount)
    ]).filter((p) => p[0]);
    return [it.lotteryDrawNum, it.lotteryDrawTime, nums.slice(0, 5), nums.slice(5, 7), pool, sales, prizes];
  });
  // 校验：期号唯一、号码范围合法且升序
  const seen = new Set();
  for (const r of rows) {
    if (seen.has(r[0])) throw new Error('期号重复：' + r[0]);
    seen.add(r[0]);
    const f = r[2], b = r[3];
    for (let i = 0; i < 5; i++) if (f[i] < 1 || f[i] > 35 || (i > 0 && f[i] <= f[i - 1])) throw new Error('前区异常：' + r[0]);
    for (let i = 0; i < 2; i++) if (b[i] < 1 || b[i] > 12 || (i > 0 && b[i] <= b[i - 1])) throw new Error('后区异常：' + r[0]);
  }
  return rows;
}

async function main() {
  console.log('抓取中…');
  const list = await fetchAll();
  const rows = toCompact(list);
  const json = JSON.stringify(rows);

  if (!fs.existsSync(HTML_FILE)) throw new Error('未找到 ' + HTML_FILE);
  let html = fs.readFileSync(HTML_FILE, 'utf8');
  // 注意：marker 不含 '[' —— 数据 JSON 自带左右括号，避免双重包裹
  const marker = 'const RAW_DATA = ';
  const start = html.indexOf(marker);
  if (start < 0) throw new Error('页面中未找到数据块，请确认文件完整');
  // 用括号匹配定位数组结尾（不依赖分号，更健壮）
  const arrStart = start + marker.length;
  let depth = 0, arrEnd = -1;
  for (let i = arrStart; i < html.length; i++) {
    const ch = html[i];
    if (ch === '[') depth++;
    else if (ch === ']') { depth--; if (depth === 0) { arrEnd = i; break; } }
  }
  if (arrEnd < 0) throw new Error('数据块不完整');
  let tail = html.slice(arrEnd + 1);
  if (tail[0] === ';') tail = tail.slice(1); // 去掉旧分号，统一由本脚本补上
  html = html.slice(0, start) + marker + json + ';' + tail;
  fs.writeFileSync(HTML_FILE, html, 'utf8');
  // 自校验：重读页面，确认数据块可解析且期数一致
  const check = fs.readFileSync(HTML_FILE, 'utf8');
  const cm = check.match(/const RAW_DATA = (\[[\s\S]*?\]);/);
  if (!cm) throw new Error('自校验失败：写入后未找到数据块');
  const parsed = JSON.parse(cm[1]);
  if (parsed.length !== rows.length) throw new Error('自校验失败：期数不一致 ' + parsed.length + ' vs ' + rows.length);
  console.log('完成：' + rows.length + ' 期数据已更新（' + rows[rows.length - 1][0] + ' ' + rows[rows.length - 1][1] +
    ' ～ ' + rows[0][0] + ' ' + rows[0][1] + '）→ ' + HTML_FILE);
}

main().catch((e) => { console.error('失败：' + e.message); process.exit(1); });
