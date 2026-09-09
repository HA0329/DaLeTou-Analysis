/*
 * 页面契约测试：HTML 与 JS 的 id / 锚点 / 资源引用必须一致。
 *
 * 这类测试专门防「重构后 JS 里引用了不存在的元素」这种静默失败
 * （页面不报错，但某个面板永远空白）。
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const HTML_FILE = '大乐透历史数据分析.html';
const html = fs.readFileSync(path.join(ROOT, HTML_FILE), 'utf8');

const JS_FILES = ['js/dlt-app.js', 'js/dlt-check.js', 'js/dlt-charts.js', 'js/dlt-core.js', 'js/dlt-shared.js'];
const jsSources = JS_FILES.map((f) => ({ file: f, code: fs.readFileSync(path.join(ROOT, f), 'utf8') }));

function matchAll(code, re) {
  const out = [];
  let m;
  while ((m = re.exec(code)) !== null) out.push(m[1]);
  return out;
}

test('HTML 中所有 id 唯一', () => {
  const ids = matchAll(html, /\sid="([^"]+)"/g);
  const dup = ids.filter((id, i) => ids.indexOf(id) !== i);
  assert.deepEqual([...new Set(dup)], [], '存在重复 id：' + [...new Set(dup)].join(', '));
});

test('JS 引用的元素 id 都存在于 HTML（含动态生成的 id）', () => {
  const htmlIds = new Set(matchAll(html, /\sid="([^"]+)"/g));
  // JS 里拼接的 HTML 片段中动态生成的 id 也算合法
  jsSources.forEach(({ code }) => matchAll(code, /id="([A-Za-z0-9_-]+)"/g).forEach((id) => htmlIds.add(id)));

  const missing = [];
  jsSources.forEach(({ file, code }) => {
    const refs = []
      .concat(matchAll(code, /\$\('([A-Za-z0-9_-]+)'\)/g))
      .concat(matchAll(code, /getElementById\('([A-Za-z0-9_-]+)'\)/g))
      .concat(matchAll(code, /querySelector\('#([A-Za-z0-9_-]+)'\)/g));
    refs.forEach((id) => { if (!htmlIds.has(id)) missing.push(file + ' → #' + id); });
  });
  assert.deepEqual([...new Set(missing)], [], 'JS 引用了 HTML 中不存在的 id');
});

test('导航链接与分区一一对应', () => {
  const navBlock = html.slice(html.indexOf('<nav'), html.indexOf('</nav>'));
  const navSecs = matchAll(navBlock, /data-sec="([^"]+)"/g);
  const sectionIds = matchAll(html, /<section[^>]*id="([^"]+)"/g);
  assert.equal(new Set(navSecs).size, navSecs.length, '导航不应有重复项');
  assert.deepEqual(navSecs.slice().sort(), sectionIds.slice().sort(),
    '导航项与 section 必须完全对应（顺序可不同）');
  // 每个导航链接的 href 都指向存在的 id
  matchAll(navBlock, /<a href="#([^"]+)" data-sec=/g).forEach((id) => {
    assert.ok(sectionIds.includes(id), '导航指向不存在的分区 #' + id);
  });
});

test('HTML 引用的本地资源都存在', () => {
  const refs = []
    .concat(matchAll(html, /<script[^>]+src="([^"]+)"/g))
    .concat(matchAll(html, /<link[^>]+href="([^"]+)"/g))
    .concat(matchAll(html, /<img[^>]+src="([^"]+)"/g));
  refs.filter((r) => !/^(https?:|data:)/.test(r)).forEach((r) => {
    assert.ok(fs.existsSync(path.join(ROOT, r)), '缺少资源文件：' + r);
  });
});

test('脚本加载顺序满足依赖（data.js → shared → core → charts → check → app）', () => {
  const order = matchAll(html, /<script defer src="([^"]+)"/g);
  assert.deepEqual(order, ['data.js', 'js/dlt-shared.js', 'js/dlt-core.js', 'js/dlt-charts.js', 'js/dlt-check.js', 'js/dlt-app.js']);
  const dataIdx = html.indexOf('src="data.js"');
  const appIdx = html.indexOf('src="js/dlt-app.js"');
  assert.ok(dataIdx > 0 && appIdx > dataIdx);
});

test('所有 canvas 都带 chart-tip 提示容器', () => {
  // 图表引擎通过 canvas.parentNode.querySelector('.chart-tip') 显示数值提示
  const canvases = matchAll(html, /<canvas[^>]*id="([^"]+)"[^>]*>/g);
  assert.ok(canvases.length >= 20, '应至少注册 20 个图表画布（实际 ' + canvases.length + '）');
  const blocks = html.split(/<canvas/).slice(1);
  blocks.forEach((b, i) => {
    const head = b.slice(0, b.indexOf('</div>') + 6);
    assert.ok(head.includes('chart-tip'), '第 ' + (i + 1) + ' 个 canvas 缺少 .chart-tip 容器');
  });
});

test('服务端脚本不依赖浏览器 API', () => {
  ['server.js', 'update.js'].forEach((f) => {
    const code = fs.readFileSync(path.join(ROOT, f), 'utf8');
    assert.ok(!/\bdocument\./.test(code), f + ' 不应访问 document');
    assert.ok(!/window\./.test(code), f + ' 不应访问 window');
    assert.ok(/require\('\.\/js\/dlt-shared\.js'\)/.test(code), f + ' 应复用 js/dlt-shared.js');
  });
});

test('README 引用的本地图片都存在', () => {
  const md = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  const refs = matchAll(md, /(?:src|href)="([^"]+)"/g).concat(matchAll(md, /\]\(([^)]+)\)/g));
  refs.filter((r) => !/^(https?:|mailto:|#)/.test(r)).forEach((r) => {
    assert.ok(fs.existsSync(path.join(ROOT, r)), 'README 引用了不存在的文件：' + r);
  });
});

test('data.js 存在且能被 parseDataFileText 解析', () => {
  const Shared = require('../js/dlt-shared.js');
  const file = path.join(ROOT, 'data.js');
  assert.ok(fs.existsSync(file), 'data.js 不存在');
  const rows = Shared.parseDataFileText(fs.readFileSync(file, 'utf8'));
  assert.ok(rows.length > 1000);
  assert.equal(Shared.assertRows(rows), true);
});
