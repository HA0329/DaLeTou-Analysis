// 大乐透分析 - 本地服务器（零依赖，Node.js 内置模块）
//
// 职责：
//   1) 以 http://127.0.0.1:8123 提供本目录的静态页面与数据文件
//   2) /dlt-api    代理体彩官网接口（绕过浏览器 CORS / HTTP/2 限制）
//   3) /save-data  把页面抓取的最新数据写回同目录 data.js（浏览器无本地写权限）
//   4) /health     健康检查（便于脚本或前端判断服务器是否就绪）
//
// 仅监听 127.0.0.1，仅本机可访问；端口可用环境变量 PORT 覆盖。
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const Shared = require('./js/dlt-shared.js');

const NODE_MAJOR = parseInt(process.versions.node.split('.')[0], 10);
if (NODE_MAJOR < 18) {
  console.warn('⚠️ 当前 Node.js 版本为 ' + process.versions.node + '（需要 ≥ 18）：全局 fetch 不可用，' +
    '「在线更新」与「写入数据文件」将无法工作。请升级 Node.js（仅浏览静态页面不受影响）。');
}

const ROOT = __dirname;
const PORT = parseInt(process.env.PORT, 10) || 8123;
const HOST = process.env.HOST || '127.0.0.1';
const INDEX = '大乐透历史数据分析.html';   // 首页（UTF-8 文件名）
const DATA_FILE = 'data.js';
const BACKUP_FILE = 'data.js.bak';
const SPORTTERY_BASE = 'https://webapi.sporttery.cn/gateway/lottery/getHistoryPageListV1.qry';
const MAX_BODY = 8e6;                       // /save-data 请求体上限
const MAX_COMPRESS = 8e6;                   // 超过此大小不做压缩
const ALLOWED_API_PARAMS = ['gameNo', 'provinceId', 'pageSize', 'isVerify', 'pageNo'];

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8', '.csv': 'text/csv; charset=utf-8'
};
const COMPRESSIBLE = /^(text\/|application\/(json|manifest\+json|javascript))/;

function log(...args) { console.log('[' + new Date().toLocaleTimeString('zh-CN') + ']', ...args); }
function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
  res.end(body);
}

// ---------- 体彩官网代理 ----------
// 浏览器直连官网会因 HTTP/2 被其 CDN 拒绝且受 CORS / Referer 限制；
// Node 端 fetch(undici) 走 HTTP/1.1 可正常访问。
// 只允许白名单参数，避免该接口被当成任意 URL 代理。
function proxyApi(req, res) {
  const qs = (req.url.split('?')[1] || '');
  const params = new URLSearchParams(qs);
  const safe = new URLSearchParams();
  for (const key of ALLOWED_API_PARAMS) {
    if (!params.has(key)) continue;
    const v = String(params.get(key));
    if (!/^\d{1,6}$/.test(v)) { json(res, 400, { ok: false, error: '参数 ' + key + ' 非法' }); return; }
    safe.set(key, v);
  }
  if (!safe.has('gameNo')) safe.set('gameNo', '85');
  const ac = typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(15000) : undefined;
  fetch(SPORTTERY_BASE + '?' + safe.toString(), {
    signal: ac,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      'Referer': 'https://static.sporttery.cn/',
      'Accept': 'application/json, text/javascript, */*; q=0.01',
      'Accept-Language': 'zh-CN,zh;q=0.9'
    }
  }).then((r) => r.text()).then((body) => {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
    res.end(body);
  }).catch((e) => {
    json(res, 502, { ok: false, error: '代理请求官网失败: ' + e.message });
  });
}

// ---------- 写回 data.js ----------
// 先校验（坏数据宁可不写），再写临时文件 + rename 原子替换，并保留一份 .bak 备份。
function saveData(req, res) {
  const chunks = [];
  let total = 0;
  let aborted = false;
  req.on('data', (c) => {
    if (aborted) return;
    total += c.length;
    if (total > MAX_BODY) { aborted = true; json(res, 413, { ok: false, error: '请求体过大（>' + MAX_BODY + ' 字节）' }); req.destroy(); return; }
    chunks.push(c);
  });
  req.on('end', () => {
    if (aborted) return;
    try {
      // 必须累积 Buffer 后一次性按 UTF-8 解码：逐块拼接会把跨块的中文字符解成乱码
      const rows = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      Shared.assertRows(rows, { min: 100 });
      const dataPath = path.join(ROOT, DATA_FILE);
      if (fs.existsSync(dataPath)) fs.copyFileSync(dataPath, path.join(ROOT, BACKUP_FILE));
      const tmpPath = dataPath + '.tmp';
      fs.writeFileSync(tmpPath, Shared.dataFileContent(rows), 'utf8');
      fs.renameSync(tmpPath, dataPath);
      log('已写入 ' + DATA_FILE + '：' + rows.length + ' 期，最新 ' + rows[0][0] + '（备份 → ' + BACKUP_FILE + '）');
      json(res, 200, { ok: true, count: rows.length, file: DATA_FILE, backup: BACKUP_FILE });
    } catch (e) {
      json(res, 400, { ok: false, error: e.message });
    }
  });
}

// ---------- 静态文件 ----------
function sendFile(req, res, file, stats) {
  const ext = path.extname(file).toLowerCase();
  const type = TYPES[ext] || 'application/octet-stream';
  const etag = '"' + stats.size.toString(16) + '-' + stats.mtimeMs.toString(16) + '"';
  const headers = { 'Content-Type': type, 'Cache-Control': 'no-cache', 'ETag': etag };
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, { 'ETag': etag, 'Cache-Control': 'no-cache' });
    res.end();
    return;
  }
  const accept = String(req.headers['accept-encoding'] || '');
  const useGzip = COMPRESSIBLE.test(type) && stats.size > 1024 && stats.size < MAX_COMPRESS && /\bgzip\b/.test(accept);
  if (useGzip) {
    headers['Content-Encoding'] = 'gzip';
    headers['Vary'] = 'Accept-Encoding';
  }
  res.writeHead(200, headers);
  if (req.method === 'HEAD') { res.end(); return; }
  const stream = fs.createReadStream(file);
  stream.on('error', () => { res.destroy(); });
  if (useGzip) stream.pipe(zlib.createGzip({ level: 6 })).pipe(res);
  else stream.pipe(res);
}

const server = http.createServer((req, res) => {
  let pathname;
  try { pathname = decodeURIComponent(req.url.split('?')[0]); } catch (e) { pathname = req.url.split('?')[0]; }

  if (pathname === '/dlt-api') { proxyApi(req, res); return; }
  if (pathname === '/save-data') {
    if (req.method !== 'POST') { json(res, 405, { ok: false, error: '请使用 POST' }); return; }
    saveData(req, res);
    return;
  }
  if (pathname === '/health') {
    let dataInfo = null;
    try {
      const st = fs.statSync(path.join(ROOT, DATA_FILE));
      dataInfo = { size: st.size, mtime: st.mtime.toISOString() };
    } catch (e) { dataInfo = null; }
    json(res, 200, { ok: true, node: process.versions.node, port: PORT, data: dataInfo });
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') { json(res, 405, { ok: false, error: '方法不允许' }); return; }

  if (pathname === '/' || pathname === '') pathname = '/' + INDEX;
  const file = path.join(ROOT, pathname);
  // 防目录穿越
  if (file !== ROOT && !file.startsWith(ROOT + path.sep)) { res.writeHead(403); res.end('403'); return; }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 未找到: ' + pathname);
      return;
    }
    sendFile(req, res, file, st);
  });
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.log('服务器已在运行（端口 ' + PORT + '），直接打开浏览器即可：http://' + HOST + ':' + PORT + '/');
    process.exit(0);
  }
  console.error('服务器启动失败:', e.message);
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  console.log('大乐透分析已启动: http://' + HOST + ':' + PORT + '/');
  console.log('数据文件: ' + path.join(ROOT, DATA_FILE) + '（在线更新 / 写入数据文件均需通过本服务器打开页面）');
});
