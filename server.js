// 大乐透分析 - 本地静态服务器（零依赖，用系统自带的 Node.js 运行）
// 作用：以 http://127.0.0.1:8123 提供本目录页面。
// 必须用本服务器打开页面，「🔄 在线更新」才能工作
// （浏览器禁止 file:// 页面发起跨域 fetch 请求）。
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PORT = 8123;
const INDEX = '大乐透历史数据分析.html'; // UTF-8 文件名
const SPORTTERY_BASE = 'https://webapi.sporttery.cn/gateway/lottery/getHistoryPageListV1.qry';
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8'
};

// 写入前校验（防止坏数据破坏 HTML）：期号唯一、号码范围合法且升序
function validateRows(rows) {
  if (!Array.isArray(rows) || rows.length < 100) throw new Error('数据异常：期数过少（' + (rows && rows.length) + '）');
  const seen = new Set();
  for (const r of rows) {
    if (!Array.isArray(r) || r.length < 4) throw new Error('行格式异常');
    if (!/^\d{5}$/.test(String(r[0]))) throw new Error('期号格式异常：' + r[0]);
    if (seen.has(r[0])) throw new Error('期号重复：' + r[0]);
    seen.add(r[0]);
    if (!Array.isArray(r[2]) || r[2].length !== 5) throw new Error('前区异常：' + r[0]);
    if (!Array.isArray(r[3]) || r[3].length !== 2) throw new Error('后区异常：' + r[0]);
    for (let i = 0; i < 5; i++) {
      const n = Number(r[2][i]);
      if (!Number.isInteger(n) || n < 1 || n > 35 || (i > 0 && n <= Number(r[2][i - 1]))) throw new Error('前区异常：' + r[0]);
    }
    for (let i = 0; i < 2; i++) {
      const n = Number(r[3][i]);
      if (!Number.isInteger(n) || n < 1 || n > 12 || (i > 0 && n <= Number(r[3][i - 1]))) throw new Error('后区异常：' + r[0]);
    }
    // v2：销量（可选，早期数据为空）与开奖公告（各奖级注数/单注奖金，可选）
    if (r[5] !== undefined && r[5] !== null && (!Number.isFinite(Number(r[5])) || Number(r[5]) < 0)) throw new Error('销量异常：' + r[0]);
    if (r[6] !== undefined && r[6] !== null) {
      if (!Array.isArray(r[6])) throw new Error('公告异常：' + r[0]);
      for (const p of r[6]) {
        if (!Array.isArray(p) || p.length < 3) throw new Error('公告条目异常：' + r[0]);
        if (typeof p[0] !== 'string' || !p[0]) throw new Error('公告奖级异常：' + r[0]);
        if (!Number.isInteger(Number(p[1])) || Number(p[1]) < 0) throw new Error('公告注数异常：' + r[0]);
        if (!Number.isFinite(Number(p[2])) || Number(p[2]) < 0) throw new Error('公告奖金异常：' + r[0]);
      }
    }
  }
}

const server = http.createServer((req, res) => {
  let p;
  try { p = decodeURIComponent(req.url.split('?')[0]); } catch (e) { p = req.url; }

  // /dlt-api 代理：浏览器统一请求本服务器（同源），由 Node 以 HTTP/1.1 代访体彩官网。
  // 原因：浏览器直连官网走 HTTP/2 会被其 CDN 拒绝（Failed to fetch），且受 CORS / Referer 限制；
  // Node fetch(undici) 仅用 HTTP/1.1，官网接口验证通过。
  if (p === '/dlt-api') {
    const qs = req.url.split('?')[1] || '';
    const ac = typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(15000) : undefined;
    fetch(SPORTTERY_BASE + (qs ? '?' + qs : ''), {
      signal: ac,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        'Referer': 'https://static.sporttery.cn/',
        'Accept': 'application/json, text/javascript, */*; q=0.01',
        'Accept-Language': 'zh-CN,zh;q=0.9'
      }
    }).then(function (r) { return r.text(); }).then(function (body) {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
      res.end(body);
    }).catch(function (e) {
      res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
      res.end('代理请求官网失败: ' + e.message);
    });
    return;
  }

  // /save-data 写入接口：把最新数据直接写回 HTML 文件的内嵌 RAW_DATA 块。
  // 浏览器没有本地文件写权限，由本服务器代写（只监听 127.0.0.1，仅本机可访问）。
  if (p === '/save-data' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 4e6) req.destroy(); });
    req.on('end', () => {
      try {
        const rows = JSON.parse(body);
        validateRows(rows);
        const htmlPath = path.join(ROOT, INDEX);
        let html = fs.readFileSync(htmlPath, 'utf8');
        const marker = 'const RAW_DATA = ';
        const start = html.indexOf(marker);
        if (start < 0) throw new Error('页面中未找到数据块');
        const arrStart = start + marker.length;
        let depth = 0, arrEnd = -1;
        for (let i = arrStart; i < html.length; i++) {
          const ch = html[i];
          if (ch === '[') depth++;
          else if (ch === ']') { depth--; if (depth === 0) { arrEnd = i; break; } }
        }
        if (arrEnd < 0) throw new Error('数据块不完整');
        let tail = html.slice(arrEnd + 1);
        if (tail[0] === ';') tail = tail.slice(1);
        html = html.slice(0, start) + marker + JSON.stringify(rows) + ';' + tail;
        fs.writeFileSync(htmlPath, html, 'utf8');
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ ok: true, count: rows.length }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  if (p === '/' || p === '') p = '/' + INDEX;
  const file = path.join(ROOT, p);
  // 防目录穿越
  if (file !== ROOT && !file.startsWith(ROOT + path.sep)) {
    res.writeHead(403); res.end('403'); return;
  }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 未找到: ' + p); return;
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    // 端口已被占用：说明服务器已在运行，本实例直接退出即可
    console.log('服务器已在运行（端口 ' + PORT + '），直接打开浏览器即可。');
    process.exit(0);
  }
  console.error('服务器启动失败:', e.message);
  process.exit(1);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('大乐透分析已启动: http://127.0.0.1:' + PORT + '/');
});
