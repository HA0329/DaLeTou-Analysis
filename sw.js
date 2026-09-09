/*
 * Service Worker —— 离线可用（网络优先，失败时回退缓存）
 *
 * 策略说明：本项目的核心数据 data.js 会随开奖持续更新，因此所有请求都走
 * 「网络优先」：联网时永远拿最新版本，断网 / 官网不可用时用缓存兜底。
 * 不使用 cache-first，避免用户看到过期数据。
 */
const CACHE = 'dlt-cache-v1.3.0';
const ASSETS = [
  './',
  './大乐透历史数据分析.html',
  './css/styles.css',
  './js/dlt-shared.js',
  './js/dlt-core.js',
  './js/dlt-charts.js',
  './js/dlt-check.js',
  './js/dlt-app.js',
  './data.js',
  './manifest.webmanifest'
];

self.addEventListener('install', (ev) => {
  ev.waitUntil(
    caches.open(CACHE)
      .then((c) => Promise.all(ASSETS.map((u) => c.add(new Request(u, { cache: 'reload' })).catch(() => null))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (ev) => {
  ev.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (ev) => {
  const req = ev.request;
  if (req.method !== 'GET') return;                       // /save-data 等写操作不拦截
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;        // 官网代理等跨域请求不拦截
  if (url.pathname.startsWith('/dlt-api') || url.pathname.startsWith('/save-data')) return;

  ev.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || caches.match('./大乐透历史数据分析.html')))
  );
});
