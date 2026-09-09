/*
 * 大乐透历史数据分析 —— 数据更新脚本（命令行入口）
 *
 * 用法：
 *   node update.js            增量更新（仅抓取缺失的新期次）
 *   node update.js --full     强制全量重建（从官网抓取全部历史）
 *   node update.js --check    只检查是否有新数据，不写入
 *
 * 作用：从中国体育彩票官网抓取最新开奖 → 校验 → 合并写入同目录 data.js。
 * 与页面上的「🔄 在线更新」（缓存到浏览器 localStorage）和
 * 「💾 写入数据文件」（经本地服务器写回 data.js）结果一致，三条路径共用
 * js/dlt-shared.js 的转换与校验逻辑。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const Shared = require('./js/dlt-shared.js');

const NODE_MAJOR = parseInt(process.versions.node.split('.')[0], 10);
if (NODE_MAJOR < 18) {
  console.error('需要 Node.js ≥ 18（当前 ' + process.versions.node + '）：本脚本依赖全局 fetch 抓取官网数据，请先升级 Node.js。');
  process.exit(1);
}

const DATA_FILE = path.join(__dirname, 'data.js');
const BACKUP_FILE = path.join(__dirname, 'data.js.bak');
const PAGE_SIZE = 100;
const API = 'https://webapi.sporttery.cn/gateway/lottery/getHistoryPageListV1.qry';
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  'Referer': 'https://static.sporttery.cn/',
  'Accept': 'application/json, text/javascript, */*; q=0.01',
  'X-Requested-With': 'XMLHttpRequest'
};

const args = process.argv.slice(2);
const isFull = args.includes('--full');
const isCheck = args.includes('--check');

function pageUrl(pageNo) {
  return API + '?gameNo=85&provinceId=0&pageSize=' + PAGE_SIZE + '&isVerify=1&pageNo=' + pageNo;
}

// 带重试的翻页抓取：单页网络抖动自动重试（最多 3 次，退避递增）
async function fetchPage(pageNo, retries) {
  retries = retries || 0;
  try {
    const res = await fetch(pageUrl(pageNo), { headers: HEADERS, signal: AbortSignal.timeout ? AbortSignal.timeout(20000) : undefined });
    if (!res.ok) throw new Error('接口返回 HTTP ' + res.status);
    const j = await res.json();
    if (!j || !j.success || !j.value || !Array.isArray(j.value.list)) throw new Error('接口返回格式异常');
    return j.value;
  } catch (e) {
    if (retries < 3) {
      console.log('  第 ' + pageNo + ' 页请求失败（' + e.message + '），' + (retries + 1) + '/3 次重试…');
      await new Promise((r) => setTimeout(r, 1000 * (retries + 1)));
      return fetchPage(pageNo, retries + 1);
    }
    throw e;
  }
}

// 全量抓取：从最新一页翻到最早一页
async function fetchAll() {
  const all = [];
  let page = 1, total = null;
  for (;;) {
    const value = await fetchPage(page);
    if (total === null) total = value.total;
    all.push(...value.list);
    console.log('第 ' + page + ' 页：' + all.length + ' / ' + total);
    if (value.list.length < PAGE_SIZE || all.length >= total) break;
    page++;
    await new Promise((r) => setTimeout(r, 150));
  }
  return all;
}

// 增量抓取：列表最新在前，遇到已存在期号即停止（全量约 30 页 → 通常 1 页）
async function fetchNew(existingSet) {
  const all = [];
  let page = 1, total = null, stopped = false;
  for (;;) {
    const value = await fetchPage(page);
    if (total === null) total = value.total;
    for (const it of value.list) {
      if (existingSet.has(String(it.lotteryDrawNum))) { stopped = true; break; }
      all.push(it);
    }
    console.log('第 ' + page + ' 页：发现 ' + all.length + ' 期新数据' + (stopped ? '（遇到已存在的期号，停止翻页）' : ''));
    if (stopped) break;
    if (value.list.length < PAGE_SIZE || all.length >= total) break;
    page++;
    await new Promise((r) => setTimeout(r, 150));
  }
  return { list: all, total, stopped };
}

// 读取 data.js 现有数据（缺失或损坏时返回 null，调用方回退全量抓取）
function readExisting() {
  if (!fs.existsSync(DATA_FILE)) return null;
  try {
    const parsed = Shared.parseDataFileText(fs.readFileSync(DATA_FILE, 'utf8'));
    if (Array.isArray(parsed) && parsed.length >= 100) {
      Shared.assertRows(parsed, { min: 100 });
      return parsed;
    }
  } catch (e) {
    console.warn('现有 data.js 读取失败（' + e.message + '），将改为全量抓取。');
  }
  return null;
}

function writeDataFile(rows) {
  if (fs.existsSync(DATA_FILE)) fs.copyFileSync(DATA_FILE, BACKUP_FILE);
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, Shared.dataFileContent(rows), 'utf8');
  fs.renameSync(tmp, DATA_FILE);
  // 自校验：重读并核对期数，确保写出的文件可被页面解析
  const back = Shared.parseDataFileText(fs.readFileSync(DATA_FILE, 'utf8'));
  if (back.length !== rows.length) throw new Error('自校验失败：期数不一致 ' + back.length + ' vs ' + rows.length);
}

async function main() {
  const existing = isFull ? null : readExisting();
  let rows, added = 0, mode;

  if (!existing) {
    mode = isFull ? '全量重建' : 'data.js 不可用，改为全量抓取';
    console.log(mode + '…');
    rows = (await fetchAll()).map(Shared.toRow);
    Shared.assertRows(rows, { min: 100 });
  } else {
    const existingSet = new Set(existing.map((r) => String(r[0])));
    console.log('现有数据：' + existing.length + ' 期，最新 ' + existing[0][0] + '（' + existing[0][1] + '），增量抓取中…');
    let res = await fetchNew(existingSet);
    let list = res.list;
    // 兜底：官网总期数多于「本地 + 本次新增」说明历史中间有缺期，改为全量重建补全
    if (res.stopped && res.total != null && res.total > existing.length + list.length) {
      console.log('检测到官网总期数（' + res.total + '）多于本地（现有 ' + existing.length + ' + 本次 ' + list.length +
        '），可能存在中间跳期，改为全量重建…');
      list = await fetchAll();
      rows = list.map(Shared.toRow);
      mode = '全量重建';
    } else {
      const newRows = list.map(Shared.toRow);
      added = newRows.length;
      if (!added) {
        console.log('已是最新（最新 ' + existing[0][0] + ' 期），无需更新。');
        return;
      }
      rows = Shared.mergeRows(newRows, existing);
      mode = '增量更新';
    }
    Shared.assertRows(rows, { min: 100 });
  }

  const range = rows[rows.length - 1][0] + ' ～ ' + rows[0][0];
  if (isCheck) {
    console.log('检查完成：' + mode + '，共 ' + rows.length + ' 期（' + range + '），未写入文件（--check）。');
    return;
  }
  writeDataFile(rows);
  console.log('完成：' + mode + '，共 ' + rows.length + ' 期（' + range + '）' +
    (added ? '，本次新增 ' + added + ' 期' : '') + ' → ' + DATA_FILE);
  console.log('已备份原文件 → ' + path.basename(BACKUP_FILE));
}

main().catch((e) => { console.error('失败：' + e.message); process.exit(1); });
