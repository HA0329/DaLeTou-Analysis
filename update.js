/*
 * 大乐透历史数据分析 —— 数据更新脚本（离线备用入口）
 * 用法：node update.js          → 增量更新（仅抓取缺失的新期次）
 *       node update.js --full   → 强制全量重建（从官网抓取全部历史）
 * 作用：从中国体育彩票官网接口抓取最新开奖 → 校验 → 合并写入同目录 data.js 数据文件。
 *       页面通过 <script src="data.js"> 加载数据，不内嵌于 HTML；
 *       页面「🔄 在线更新」按钮（浏览器内抓取并缓存到 localStorage）与
 *       「💾 更新并写入数据文件」按钮（写回 data.js）与本脚本结果一致。
 * 增量原理：官网接口按「最新在前」分页返回，抓取时一旦遇到 data.js 中已存在的期号即可停止，
 *           只拉取缺失的新期次，避免每次从最新一期一路翻到最早（全量约 29 页 → 通常仅需 1 页）。
 * 数据格式 v2：每期为 [期号, 开奖日期, 前区[5], 后区[2], 奖池, 销量, 开奖公告[[奖级,注数,单注奖金],...]]
 * 注意：data.js 以 `var RAW_DATA = ` 开头（全局变量），页面布局编辑时请勿删除
 *       `<script src="data.js"></script>` 引入。
 */
'use strict';
const fs = require('fs');
const path = require('path');

// 本脚本依赖 Node 18+ 的全局 fetch；版本过低时直接退出并给出明确提示
const NODE_MAJOR = parseInt(process.versions.node.split('.')[0], 10);
if (NODE_MAJOR < 18) {
  console.error('需要 Node.js ≥ 18（当前 ' + process.versions.node + '）：本脚本依赖全局 fetch 抓取官网数据，请先升级 Node.js。');
  process.exit(1);
}

const DATA_FILE = path.join(__dirname, 'data.js');
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

// 全量抓取（--full / data.js 缺失或不可读时使用）：从最新一页一路翻到最早
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

// 增量抓取：遇到已存在的期号即停止（列表为最新在前）
// 返回 { list, total, stopped }：list 为抓取到的新数据，total 为官网数据总期数，
// stopped 表示是否因遇到已存在的期号而提前停止（供 main 做「跳期」兜底判断）。
async function fetchNew(existingSet) {
  const all = [];
  let page = 1, total = null, stopped = false;
  while (true) {
    const url = 'https://webapi.sporttery.cn/gateway/lottery/getHistoryPageListV1.qry' +
      '?gameNo=85&provinceId=0&pageSize=' + PAGE_SIZE + '&isVerify=1&pageNo=' + page;
    const j = await fetchPage(url);
    if (!j || !j.success || !j.value || !Array.isArray(j.value.list)) throw new Error('接口返回格式异常');
    if (total === null) total = j.value.total;
    const list = j.value.list;
    for (const it of list) {
      if (existingSet.has(String(it.lotteryDrawNum))) { stopped = true; break; }
      all.push(it);
    }
    console.log('第 ' + page + ' 页：发现 ' + all.length + ' 期新数据' + (stopped ? '（遇到已存在的期号，停止翻页）' : ''));
    if (stopped) break;
    if (list.length < PAGE_SIZE || all.length >= total) break;
    page++;
    await new Promise((r) => setTimeout(r, 150));
  }
  return { list: all, total: total, stopped: stopped };
}

// 单条官网记录 → 紧凑行
function toRow(it) {
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
}

// 校验：期号唯一、号码范围合法且升序
function assertRows(rows) {
  const seen = new Set();
  for (const r of rows) {
    if (seen.has(r[0])) throw new Error('期号重复：' + r[0]);
    seen.add(r[0]);
    const f = r[2], b = r[3];
    for (let i = 0; i < 5; i++) if (f[i] < 1 || f[i] > 35 || (i > 0 && f[i] <= f[i - 1])) throw new Error('前区异常：' + r[0]);
    for (let i = 0; i < 2; i++) if (b[i] < 1 || b[i] > 12 || (i > 0 && b[i] <= b[i - 1])) throw new Error('后区异常：' + r[0]);
  }
}

function toCompact(list) {
  const rows = list.map(toRow);
  assertRows(rows);
  return rows;
}

// 读取 data.js 中的 RAW_DATA（括号匹配定位，不依赖分号）
function readDataFile() {
  const content = fs.readFileSync(DATA_FILE, 'utf8');
  const marker = 'var RAW_DATA = ';
  const start = content.indexOf(marker);
  if (start < 0) throw new Error('data.js 中未找到 RAW_DATA 标记');
  const arrStart = start + marker.length;
  let depth = 0, arrEnd = -1;
  for (let i = arrStart; i < content.length; i++) {
    const ch = content[i];
    if (ch === '[') depth++;
    else if (ch === ']') { depth--; if (depth === 0) { arrEnd = i; break; } }
  }
  if (arrEnd < 0) throw new Error('data.js 数据块不完整');
  return JSON.parse(content.slice(arrStart, arrEnd + 1));
}

// 生成 data.js 文件内容（与 server.js /save-data 输出格式一致）
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

async function main() {
  const isFull = process.argv.includes('--full');

  // 尝试读取 data.js 现有数据；缺失或格式异常时回退为全量抓取
  let existing = null;
  if (fs.existsSync(DATA_FILE)) {
    try {
      const parsed = readDataFile();
      if (Array.isArray(parsed) && parsed.length >= 100 && /^\d{5}$/.test(String(parsed[0][0]))) existing = parsed;
    } catch (e) { /* 回退全量 */ }
  }

  let rows, newRows;
  let fullRebuilt = false;   // 全量重建时 list 已是完整数据（最新在前），不能再按「新 + 旧」拼接
  if (isFull || !existing) {
    console.log(isFull ? '全量重建模式…' : '无法读取 data.js 内嵌数据，改为全量抓取…');
    rows = toCompact(await fetchAll());
  } else {
    const existingSet = new Set(existing.map((r) => String(r[0])));
    console.log('现有数据：' + existing.length + ' 期，最新 ' + existing[0][0] + '（' + existing[0][1] + '），增量抓取中…');
    let res = await fetchNew(existingSet);
    let list = res.list;
    // 兜底：增量抓取在遇到已存在期号时停止；若官网总期数仍多于「本地 + 本次新增」，
    // 说明历史中间可能有跳期缺失（如官网某期未发布而漏补），改为全量重建一次性补全。
    if (res.stopped && res.total != null && res.total > existing.length + list.length) {
      console.log('检测到官网总期数（' + res.total + '）多于本地数据（现有 ' + existing.length + ' 期 + 本次新增 ' + list.length + ' 期）——可能存在中间跳期，改为全量重建…');
      list = await fetchAll();
      fullRebuilt = true;
    }
    newRows = toCompact(list).filter((r) => !existingSet.has(String(r[0])));
    if (!newRows.length) {
      console.log('已是最新（最新 ' + existing[0][0] + ' 期），无需更新。');
      return;
    }
    rows = fullRebuilt ? toCompact(list) : newRows.concat(existing);
  }
  assertRows(rows);

  fs.writeFileSync(DATA_FILE, dataFileContent(rows), 'utf8');
  // 自校验：重读 data.js，确认数据可解析且期数一致
  const parsed = readDataFile();
  if (parsed.length !== rows.length) throw new Error('自校验失败：期数不一致 ' + parsed.length + ' vs ' + rows.length);
  console.log('完成：' + (isFull || !existing ? '全量重建，共 ' : '新增 ' + newRows.length + ' 期，共 ') + rows.length +
    ' 期数据已更新（' + rows[rows.length - 1][0] + ' ～ ' + rows[0][0] + '）→ ' + DATA_FILE);
}

main().catch((e) => { console.error('失败：' + e.message); process.exit(1); });
