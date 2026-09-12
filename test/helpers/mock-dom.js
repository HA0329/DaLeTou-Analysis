/*
 * 最小 DOM 桩 —— 让 dlt-app.js 能在 Node 里跑起来
 *
 * 目的：不引入任何依赖（jsdom 等）的前提下，真实执行页面脚本的初始化与渲染路径，
 * 捕获「引用了不存在的函数 / 读未定义属性 / 拼错字段名」这类只有运行时才暴露的错误。
 * 只实现 dlt-app.js / dlt-charts.js / dlt-check.js 实际用到的那部分 DOM 接口。
 */
'use strict';

function MockClassList(el) {
  this.el = el;
  this.set = new Set();
}
MockClassList.prototype.add = function () { for (const c of arguments) this.set.add(c); };
MockClassList.prototype.remove = function () { for (const c of arguments) this.set.delete(c); };
MockClassList.prototype.contains = function (c) { return this.set.has(c); };
MockClassList.prototype.toggle = function (c, force) {
  const want = force === undefined ? !this.set.has(c) : !!force;
  if (want) this.set.add(c); else this.set.delete(c);
  return want;
};

function MockElement(tag, id) {
  this.tagName = String(tag || 'div').toUpperCase();
  this.id = id || '';
  this._html = '';
  this.style = { setProperty() {} };
  this.dataset = {};
  this.attributes = {};
  this.classList = new MockClassList(this);
  this.parentNode = null;
  this.isConnected = true;
  this.offsetParent = this;
  this.clientWidth = 820;
  this.offsetWidth = 120;
  this.offsetHeight = 30;
  this._listeners = {};
  this._children = new Map();     // 选择器 → 子元素（懒创建，保证 querySelector 稳定返回同一对象）
  this.onload = null;             // <script> 动态注入时用
  this.onerror = null;
  this.src = '';
}
Object.defineProperty(MockElement.prototype, 'innerHTML', {
  get() { return this._html; },
  set(v) { this._html = String(v == null ? '' : v); }
});
// 浏览器语义：textContent 会拼接所有子孙文本节点。
// 这里除自身 _html 外还累加已创建子元素的文本，
// 否则「把内容写进子 span」的代码（如 toast()）在测试里读不到文本。
Object.defineProperty(MockElement.prototype, 'textContent', {
  get() {
    let out = this._html;
    for (const child of this._children.values()) out += child.textContent;
    return out;
  },
  set(v) { this._html = String(v == null ? '' : v); }
});
MockElement.prototype.addEventListener = function (type, fn) {
  (this._listeners[type] = this._listeners[type] || []).push(fn);
};
MockElement.prototype.removeEventListener = function () {};
MockElement.prototype.fire = function (type, ev) {
  (this._listeners[type] || []).forEach((fn) => fn(ev || { target: this }));
  return this;
};
MockElement.prototype.querySelector = function (sel) {
  if (!this._children.has(sel)) {
    const child = new MockElement(sel.indexOf('canvas') >= 0 ? 'canvas' : 'div');
    child.parentNode = this;
    this._children.set(sel, child);
  }
  return this._children.get(sel);
};
MockElement.prototype.querySelectorAll = function () { return []; };
MockElement.prototype.closest = function () { return this; };
MockElement.prototype.getAttribute = function (n) { return this.attributes[n] === undefined ? null : this.attributes[n]; };
MockElement.prototype.setAttribute = function (n, v) { this.attributes[n] = String(v); };
MockElement.prototype.appendChild = function (c) { if (c) c.parentNode = this; return c; };
MockElement.prototype.removeChild = function () {};
MockElement.prototype.remove = function () { this.isConnected = false; };
MockElement.prototype.scrollIntoView = function () {};
MockElement.prototype.focus = function () {};
MockElement.prototype.select = function () {};
MockElement.prototype.getBoundingClientRect = function () { return { left: 0, top: 0, width: this.clientWidth, height: 200 }; };
MockElement.prototype.getContext = function () { return mockContext(); };

// CanvasRenderingContext2D 桩：所有绘制方法都是空操作，只记录调用次数
function mockContext() {
  const noop = () => {};
  return {
    calls: 0,
    setTransform: noop, clearRect: noop, beginPath: noop, moveTo: noop, lineTo: noop,
    stroke: noop, fill: noop, fillRect: noop, strokeRect: noop, arc: noop, rect: noop,
    roundRect: noop, fillText: noop, strokeText: noop, setLineDash: noop, save: noop,
    restore: noop, closePath: noop, translate: noop, scale: noop,
    font: '', textAlign: '', textBaseline: '', fillStyle: '', strokeStyle: '', lineWidth: 1
  };
}

/**
 * 创建一个「像浏览器」的全局沙箱对象
 * @param {object} opts { rawData, fetchImpl, storage }
 */
function createSandbox(opts) {
  opts = opts || {};
  const elements = new Map();
  const docListeners = {};

  function getEl(id) {
    if (!elements.has(id)) {
      const isCanvas = /chart|heat|canvas|Cooccur/i.test(id);
      const el = new MockElement(isCanvas ? 'canvas' : 'div', id);
      elements.set(id, el);
    }
    return elements.get(id);
  }

  const document = {
    readyState: 'complete',
    body: new MockElement('body'),
    documentElement: new MockElement('html'),
    head: new MockElement('head'),
    getElementById: getEl,
    querySelector: () => new MockElement('div'),
    querySelectorAll: () => [],
    createElement: (tag) => new MockElement(tag),
    addEventListener: (type, fn) => { (docListeners[type] = docListeners[type] || []).push(fn); },
    fire: (type, ev) => { (docListeners[type] || []).forEach((fn) => fn(ev)); }
  };

  // 动态注入 <script src="data.js"> 的模拟：浏览器会真正执行脚本，
  // 这里等价地触发 onload，并把 window.RAW_DATA 替换为该脚本携带的数据。
  // loadLatestDataJs() 依赖这一行为（Pages 模式在官网不可用时的降级数据源）。
  const rawDataMap = opts.rawDataMap || {};
  document.head.appendChild = function (el) {
    if (el) el.parentNode = document.head;
    if (el && el.tagName === 'SCRIPT') {
      const key = String(el.src || '').split('?')[0].split('/').pop();
      const payload = Object.prototype.hasOwnProperty.call(rawDataMap, key) ? rawDataMap[key] : undefined;
      Promise.resolve().then(() => {
        if (payload !== undefined) sandbox.RAW_DATA = payload;
        if (typeof el.onload === 'function') el.onload();
      });
    }
    return el;
  };

  const storage = opts.storage || {};
  // 默认模拟本地服务器模式；传 opts.location 可模拟 GitHub Pages 等其它环境
  const location = opts.location || { protocol: 'http:', origin: 'http://127.0.0.1:8123', href: 'http://127.0.0.1:8123/', hostname: '127.0.0.1' };
  // 定时器倍率：测试里加快退避重试，避免为了等 800ms/1600ms 而拖慢用例
  const timerScale = opts.timerScale === undefined ? 1 : opts.timerScale;
  const schedule = (fn, ms) => (opts.realTimers ? setTimeout(fn, (ms || 0) * timerScale) : (sandbox.__pendingTimers.push(fn), sandbox.__pendingTimers.length));
  const cancel = opts.realTimers ? clearTimeout : () => {};
  const sandbox = {
    console,
    document,
    location,
    // 沙箱内的内置类型必须指向本 realm 的构造器：
    // vm 里 new TypeError 得到的是另一个 realm 的实例，`e instanceof TypeError` 恒为 false，
    // 会让页面里的错误分支（如「浏览器禁止 file:// 跨域」提示）永远不生效。
    TypeError,
    Error,
    Array,
    Object,
    String,
    Number,
    JSON,
    Math,
    Date,
    Promise,
    Boolean,
    RegExp,
    Map,
    Set,
    Symbol,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
    encodeURIComponent,
    decodeURIComponent,
    navigator: {},
    devicePixelRatio: 1,
    innerWidth: 1280,
    innerHeight: 900,
    scrollY: 0,
    scrollTo: () => {},
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    requestAnimationFrame: (fn) => { fn(); return 1; },
    cancelAnimationFrame: () => {},
    setInterval: () => 1,
    clearInterval: () => {},
    // 默认收集回调由 runTimers() 手动触发；realTimers 时走真实定时器，
    // 便于测试带 setTimeout 的异步重试链路（在线更新的失败重试）
    setTimeout: schedule,
    clearTimeout: cancel,
    __pendingTimers: [],
    localStorage: {
      getItem: (k) => (k in storage ? storage[k] : null),
      setItem: (k, v) => { storage[k] = String(v); },
      removeItem: (k) => { delete storage[k]; }
    },
    AbortController: function () { this.signal = {}; this.abort = () => {}; },
    fetch: opts.fetchImpl || (() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ success: true, value: { total: 0, list: [] } })
    })),
    IntersectionObserver: function () { this.observe = () => {}; this.disconnect = () => {}; },
    Blob: function (parts) { this.parts = parts; },
    URL: { createObjectURL: () => 'blob:mock', revokeObjectURL: () => {} }
  };
  sandbox.window = sandbox;          // 浏览器语义：window === globalThis
  sandbox.globalThis = sandbox;
  sandbox.RAW_DATA = opts.rawData;
  sandbox.addEventListener = () => {};

  return { sandbox, elements, getEl, document, runTimers: () => { const t = sandbox.__pendingTimers.splice(0); t.forEach((fn) => fn()); } };
}

module.exports = { createSandbox, MockElement };
