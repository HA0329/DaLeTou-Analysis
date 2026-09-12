# 🎱 大乐透历史开奖数据分析

基于真实历史开奖数据的中国体育彩票「超级大乐透」分析工具：**纯静态网页应用 + 独立数据文件 + 零依赖本地服务器**。

数据来自体彩官网公开接口，由脚本抓取校验后写入同目录 `data.js`（页面通过 `<script>` 加载，不内嵌于 HTML），支持一键增量更新；无需 `npm install`，克隆下来双击即可运行。

> ⚠️ **免责声明**：本项目仅用于数据分析与技术学习。所有统计、走势与「预测」结果**仅供娱乐参考，不构成任何购彩建议**。彩票开奖是独立随机事件，请理性购彩、量力而行。

---

## ✨ 功能特性

### 📊 数据与分析

| 模块 | 说明 |
| --- | --- |
| 📜 玩法规则 | 2026 新规速查（9 奖级 → 7 奖级、奖池 ≥8 亿升级档） |
| 🎯 中奖查询 | 输入号码（支持复式 12+6、追加投注），按新规自动判定奖级、注数与奖金；输入自动保存，最近 8 次查询可一键回填 |
| 🕒 最新一期 | 开奖号码、奖池、销量、完整开奖公告、下次开奖倒计时、数据过期提醒 |
| 💰 奖池与销量 | 奖池走势（8 亿升级线）、奖池档位分布、销量走势 |
| 📋 号码走势图 | 近 N 期走势网格，可选**显示遗漏数**，点击号码查看详情 |
| 📊 出现频率 | 前/后区频率柱状图 + 热号 / 冷号 TOP10 |
| ⏳ 遗漏分析 | 当前 / 平均 / 最大遗漏、**遗漏标准差**、**回补压力**，表头可排序 |
| 📈 前区和值 | 和值走势（MA20 / MA50）、和值档位分布、**实际区间占比 vs 理论概率** |
| 📏 跨度与龙头凤尾 | 跨度分布与走势、龙头（最小号）/ 凤尾（最大号）频率排行 |
| 📐 结构分布 | 奇偶比、大小比、三区分布与最常见形态 |
| 🔁 重号 · 邻号 · 同尾 | 每期重号 / 邻号 / 同尾号个数分布，最近 20 期明细 |
| 🧮 012 路 · AC 值 · 尾数 | 除 3 余数形态、AC 离散度分布、末位数字频次 |
| 🎱 后区专项 | 后区和值 / 跨度分布与走势、后区频率 |
| 🎯 号码热度矩阵 | 按出现频次深浅着色，点击号码查看详情 + **滑动窗口出现次数** |
| 🔥 共现热力图 | 35×35 前区两两同现矩阵，**以理论期望为中心的双向色阶**（偏红=多于期望），并给出倍数排行 |
| 🔗 高频组合 | 前区两码 / 三码组合 TOP15、后区两码组合 TOP15、连号统计 |
| 🏆 奖金与返奖率 | 平均 / 中位返奖率、一等奖单注奖金走势、各奖级累计统计 |
| 🎲 模拟选号 | 随机 / 热号 / 遗漏 / 均衡四种策略，一键复制 |
| 🔮 下一期预测 | 7 种统计方法 + **近 100 期回测**（固定随机种子，结果可复现，并对照纯随机基准） |
| 🗂️ 历史记录 | 最新在前，可搜索 / 翻页 / 展开公告 / 点击期号填入查询，导出 CSV（含和值、跨度、返奖率） |

### 🎛️ 全局体验

- **统计范围一键切换**：全部历史 / 近 2000 / 1000 / 500 / 300 / 100 / 50 期 —— 频率、遗漏、分布、跨度、重号、共现、预测等**全部统计与图表即时重算**
- **深色 / 浅色主题**：跟随系统偏好，也可手动切换并记忆
- **响应式 + 单行滚动导航**：22 个分区不会撑高吸顶栏，当前分区自动滚动到可见位置
- **面板可折叠**（状态记忆）、图表悬停查看数值、快捷键 `/` 聚焦搜索、`Esc` 关闭提示
- **PWA 离线可用**：注册 Service Worker，断网时仍可查看已缓存页面（网络优先策略，联网时永远取最新数据）
- **零依赖**：无 npm 依赖、无构建步骤、无 CDN 外链

### 🔄 数据更新（四条路径，结果一致）

| 方式 | 说明 |
| --- | --- |
| 页面「🔄 在线更新」 | **直连体彩官网**增量抓取实时开奖，结果缓存到 `localStorage`；官网不可用时自动退回同源 `data.js` |
| 页面「💾 写入数据文件」 | 抓取后由本地服务器写回 `data.js`（自动备份 + 原子替换），仅本地服务器模式可用 |
| 命令行 `node update.js` | 增量更新（`--full` 全量重建，`--check` 只检查不写入） |
| GitHub Actions 定时任务 | 每周一/三/六开奖后自动运行 `node update.js` 并提交 `data.js` |

四条路径共用 `js/dlt-shared.js` 的转换与校验逻辑，都会：按期号去重合并 → 全量校验（期号唯一/降序、号码范围与升序、奖池销量与公告结构）→ 才允许写入。

> **关于线上（GitHub Pages）的实时性**
> 体彩官网接口响应带 `Access-Control-Allow-Origin: *`，浏览器可以**直接从 Pages 页面**发起跨域请求，
> 因此页面上的「🔄 在线更新」拿到的就是官网实时数据，不依赖任何第三方代理，也不依赖 GitHub Action 是否跑过。
> GitHub Action 的作用是让仓库里的 `data.js` 也保持最新，作为官网不可用时的兜底数据源。

---

## 🚀 快速开始

### 环境要求

- **Node.js ≥ 18**（使用内置 `fetch`；项目零第三方依赖，无需 `npm install`）
- Node < 18 仍可浏览页面，但「在线更新」「写入数据文件」与 `node update.js` 不可用（启动时会给出明确提示）

### 启动

Windows 用户直接双击 `启动页面.bat`（自动检查 Node、启动服务器、等服务器就绪后打开浏览器），或任意平台手动执行：

```bash
node server.js          # 默认 http://127.0.0.1:8123/
PORT=9000 node server.js # 自定义端口
```

> **为什么要本地服务器？**
> 浏览器禁止 `file://` 页面发起跨域 fetch，所以直接双击 HTML 时「🔄 在线更新」与「💾 写入数据文件」不可用（页面展示与图表不受影响，数据由同目录 `data.js` 提供）。
> `server.js` 同时充当体彩官网接口的代理（本地场景下统一走同源请求）与 `data.js` 的写回接口，只监听 `127.0.0.1`，仅本机可访问；并对代理参数做白名单校验、对静态资源启用 gzip + ETag。
>
> 注意：官网接口本身**允许跨域**（`Access-Control-Allow-Origin: *`），所以部署到 GitHub Pages 等静态站点后，页面无需本地服务器即可直连官网取实时数据；本地服务器存在的意义在于「写回 `data.js`」与 `file://` 兜底。

### 更新数据

```bash
node update.js          # 增量更新（仅拉取缺失的新期次，通常 1 次请求）
node update.js --full   # 强制全量重建
node update.js --check  # 只检查是否有新数据，不写入
```

### 开发与测试

```bash
npm test    # 56 项测试（node:test，零依赖）
npm run lint # 所有 JS 文件语法检查（node --check）
```

测试覆盖：数据校验 / 合并去重 / 文件往返、统计引擎守恒关系（频次之和、矩阵对称性、重号期望值等）、13 个中奖条件逐一判定、复式注数守恒、回测可复现性、**HTML 与 JS 的 id / 锚点契约**，以及一套在最小 DOM 桩里真实执行页面脚本的集成冒烟测试。

---

## 📁 项目结构

```
大乐透历史数据分析.html   页面结构（含全部面板与导航）
css/styles.css            样式（亮色 / 暗色主题变量、响应式）
js/dlt-shared.js          通用工具：格式化、HTML 转义、数据转换与校验、CSV、可复现随机（浏览器 + Node 共用）
js/dlt-core.js            统计引擎：纯计算（computeAll / 预测 / 回测），不触碰 DOM，可被单测直接覆盖
js/dlt-charts.js          轻量 canvas 图表引擎：柱状 / 折线 / 热力图，含 DPR 适配、悬停 tooltip、主题
js/dlt-check.js           中奖查询（2026 新规 7 奖级，纯计算部分可单测）
js/dlt-app.js             页面渲染与交互、数据源管理、全局统计范围、在线更新（直连官网 + 仓库数据兜底）
data.js                   历史开奖数据（自动生成，格式 v2）
server.js                 本地服务器：静态资源 + 官网代理 + data.js 写回 + /health
update.js                 命令行数据更新脚本
sw.js / manifest.webmanifest  PWA（离线缓存与安装）
test/                     node:test 测试套件
启动页面.bat              Windows 一键启动器
screenshots/              界面截图（当前版本）
赞赏码.jpg                赞赏支持二维码
.github/workflows/        update-data.yml（开奖后自动更新 data.js）、pages.yml（Pages 部署）
```

**数据流**：`update.js` / 页面按钮 → 官网接口 → `dlt-shared.js` 转换与校验 → `data.js` → 页面加载 → `dlt-core.js` 统计 → `dlt-charts.js` / `dlt-app.js` 渲染。

---

## 📊 数据来源与格式

- 数据来自**中国体育彩票官网**公开接口（`webapi.sporttery.cn`），由脚本抓取、校验后写入 `data.js`
- 数据格式 v2：每期为 `[期号, 开奖日期, 前区[5], 后区[2], 奖池, 销量, 开奖公告[[奖级,注数,单注奖金],...]]`
  - `奖池` 为当期开奖后滚存金额，下一期开奖前奖池即上一期的该值（决定固定奖是否按 8 亿升级档兑付）
  - 早期期次官网未公布奖池 / 销量 / 公告明细，对应字段为空数组或 0，统计时已剔除

---

## 🔧 开发说明

- **脚本加载顺序**（`defer`，按序执行）：
  `data.js` → `js/dlt-shared.js` → `js/dlt-core.js` → `js/dlt-charts.js` → `js/dlt-check.js` → `js/dlt-app.js`
  调整顺序会破坏依赖，`test/dom-contract.test.js` 会直接报错。
- **不要手动编辑 `data.js`**：它由脚本生成，格式为 `var RAW_DATA = [...];`。更新失败时脚本会保留 `data.js.bak` 备份。
- **新增面板**：在 HTML 里加 `<section class="panel" id="xxx" data-sec="xxx">` 与导航 `<a href="#xxx" data-sec="xxx">`（两者必须一一对应），再在 `dlt-app.js` 的 `renderAll()` 里加一个 `buildXxx()`。契约测试会校验 id / 锚点一致性。
- **新增图表**：在面板里放 `<canvas id="...">` 与同级 `<div class="chart-tip"></div>`，然后
  `Charts.register(canvas, () => Charts.bar(canvas, {...}))`；重绘（窗口缩放、主题切换、展开折叠）由引擎自动处理。
- **改动统计逻辑**：优先改 `js/dlt-core.js` 并补 `test/core.test.js` 断言，不要在渲染函数里算统计。

---

## 📸 界面

以下截图均由本项目实际运行渲染（`data.js` 2922 期，最新一期 26104 期 · 2026-09-12）。

<p align="center">
  <img src="screenshots/01-hero.png" alt="首页概览（亮色）" width="49%">
  <img src="screenshots/02-dark.png" alt="深色主题" width="49%">
</p>
<p align="center">
  <img src="screenshots/03-latest.png" alt="最新一期开奖与公告" width="49%">
  <img src="screenshots/04-pooltrend.png" alt="奖池与销量走势" width="49%">
</p>
<p align="center">
  <img src="screenshots/05-trend.png" alt="号码走势图" width="49%">
  <img src="screenshots/06-freq.png" alt="号码出现频率" width="49%">
</p>
<p align="center">
  <img src="screenshots/07-omit.png" alt="遗漏分析" width="49%">
  <img src="screenshots/08-sum.png" alt="前区和值走势" width="49%">
</p>
<p align="center">
  <img src="screenshots/09-span.png" alt="跨度与龙头凤尾" width="49%">
  <img src="screenshots/10-repeat.png" alt="重号 · 邻号 · 同尾" width="49%">
</p>
<p align="center">
  <img src="screenshots/11-mod3.png" alt="012 路 · AC 值 · 尾数" width="49%">
  <img src="screenshots/12-backzone.png" alt="后区专项分析" width="49%">
</p>
<p align="center">
  <img src="screenshots/13-matrix.png" alt="号码热度矩阵" width="49%">
  <img src="screenshots/14-cooccur.png" alt="号码共现热力图" width="49%">
</p>
<p align="center">
  <img src="screenshots/15-combo.png" alt="高频组合与连号" width="49%">
  <img src="screenshots/16-prize.png" alt="奖金与返奖率" width="49%">
</p>
<p align="center">
  <img src="screenshots/17-pick.png" alt="模拟选号" width="49%">
  <img src="screenshots/18-predict.png" alt="下一期预测" width="49%">
</p>
<p align="center">
  <img src="screenshots/19-records.png" alt="历史开奖记录" width="49%">
  <img src="screenshots/20-check.png" alt="中奖查询" width="49%">
</p>

---

## 🆙 版本升级说明（v1.2 → v1.3）

### 架构与可维护性

- 单文件 2000 行 `app.js` 拆分为 `js/dlt-shared.js`（通用工具）/ `dlt-core.js`（纯统计引擎）/ `dlt-charts.js`（图表引擎）/ `dlt-check.js`（中奖查询）/ `dlt-app.js`（渲染交互）
- `server.js` / `update.js` / 页面三处重复的「官网记录 → 紧凑行」转换与校验逻辑统一为 `js/dlt-shared.js` 一份实现
- 新增 56 项自动化测试（含最小 DOM 桩的页面集成冒烟测试）与 `npm run lint`

### 修复

- **综合加权预测评分退化**：`SCORE_BASED` 误含 `ensemble`，导致「综合加权」评分变成按号码序号排序（01 恒为最高分）。已修复并加回归测试
- **返奖率被低估**：早期无公告的期次曾按 0% 计入平均返奖率，现只统计有公告的期次
- **8 亿升级档统计口径**：升级档是 2026 新规产物，现只统计新规施行后的期次
- **XSS 风险**：搜索框回显、官网奖级名称等外部字符串统一经 `esc()` 转义后再进 `innerHTML`
- **数据过期判断**：原先硬编码「周三←周一」的推算改为通用开奖日推算（周一/三/六 21:25）
- **回测不可复现**：改用固定种子的 `mulberry32` 随机数，同一份数据每次回测结果一致
- **合并写入**：新增期次内部去重与降序校验，避免官网偶发重复记录导致写入失败

### 新增能力

- 全局统计范围（全部 / 近 N 期）驱动所有统计与图表
- 跨度与龙头凤尾、重号 / 邻号 / 同尾、012 路 / AC 值 / 尾数、后区专项、共现热力图、奖金与返奖率 6 个新面板
- 遗漏标准差与回补压力、走势图遗漏列、和值区间实际 vs 理论概率、滑动窗口出现次数、共现倍数
- 深色主题、PWA 离线、单行滚动导航、面板折叠记忆、查询历史、CSV 增加和值/跨度/返奖率列
- 服务器：gzip 压缩（`data.js` 从 1.03 MB 降至约 210 KB）、ETag/304、`/health`、写入备份与原子替换、代理参数白名单、`PORT` 环境变量
- 更新脚本：`--check` 试运行、写入前备份、写出后自校验

---

## ☕ 赞赏支持

如果这个工具对你有帮助，欢迎扫码赞赏支持一下作者（完全自愿，不赞赏也不影响任何功能使用）：

<p align="center"><img src="赞赏码.jpg" alt="赞赏码" width="220"></p>

## 📄 License

[MIT](./LICENSE)
