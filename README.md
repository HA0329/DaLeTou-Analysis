# 🎱 大乐透历史开奖数据分析

基于真实历史开奖数据的中国体育彩票「超级大乐透」分析工具：网页应用 + 独立数据文件 + 零依赖本地服务器，数据存放于同目录 `data.js`（页面通过 `<script>` 加载，不内嵌于 HTML），可一键在线更新，无需安装任何第三方 npm 包。

> ⚠️ **免责声明**：本项目仅用于数据分析与技术学习。所有统计、走势与"预测"结果**仅供娱乐参考，不构成任何购彩建议**。彩票开奖是独立随机事件，请理性购彩、量力而行。

## ✨ 功能特性

- 📜 **玩法规则速查**（2026 新规）
- 🎯 **中奖查询**：输入号码，按 2026 新规自动判定奖级
- 🕒 **最新一期开奖**速览
- 💰 **奖池走势**（每期开奖后滚存）
- 📋 **号码走势图**（近 N 期可调，点击号码查看统计）
- 📊 **号码出现频率**
- 📈 **前区和值走势**（20 期 / 50 期均线）
- 📐 **结构分布**（大小、奇偶等）
- ⏳ **遗漏分析**（表头可排序）
- 🎯 **号码热度矩阵**（点击号码查看详情）
- 🔗 **高频组合与连号**
- 🎲 **模拟选号**（仅供娱乐）
- 🔮 **下一期号码预测**（7 种统计方法，仅供娱乐）
- 🗂️ **历史开奖记录**（最新在前，可搜索翻页）
- 🔄 **在线更新**：一键抓取体彩官网最新开奖数据（**增量更新**，只拉取缺失的新期次，不重复翻全量历史），自动缓存到浏览器 localStorage；「💾 更新并写入数据文件」可把结果直接写回同目录 `data.js`；打开页面时还会静默检查一次新数据并提示一键更新

## 📸 界面截图

以下截图均为实际运行效果（`data.js` 数据 · 2915 期，最新一期 26097 期 · 2026-08-26）：

<p align="center">
  <img src="screenshots/01-hero.png" alt="首页" width="48%">
  <img src="screenshots/02-overview.png" alt="概览数据卡片" width="48%">
</p>

<p align="center">
  <img src="screenshots/03-rules.png" alt="玩法规则（2026 新规）" width="48%">
  <img src="screenshots/04-check.png" alt="中奖查询（含判定结果）" width="48%">
</p>

<p align="center">
  <img src="screenshots/05-latest.png" alt="最新一期开奖" width="48%">
  <img src="screenshots/06-pooltrend.png" alt="奖池走势" width="48%">
</p>

<p align="center">
  <img src="screenshots/07-trend.png" alt="号码走势图" width="48%">
  <img src="screenshots/08-freq.png" alt="号码出现频率" width="48%">
</p>

<p align="center">
  <img src="screenshots/09-sum.png" alt="前区和值走势" width="48%">
  <img src="screenshots/10-dist.png" alt="结构分布" width="48%">
</p>

<p align="center">
  <img src="screenshots/11-omit.png" alt="遗漏分析" width="48%">
  <img src="screenshots/12-matrix.png" alt="号码热度矩阵" width="48%">
</p>

<p align="center">
  <img src="screenshots/13-combo.png" alt="高频组合与连号" width="48%">
  <img src="screenshots/14-pick.png" alt="模拟选号" width="48%">
</p>

<p align="center">
  <img src="screenshots/15-predict.png" alt="下一期号码预测" width="48%">
  <img src="screenshots/16-records.png" alt="历史开奖记录" width="48%">
</p>

## 🚀 快速开始

### 环境要求

- **Node.js ≥ 18**（使用内置 `fetch`；项目零第三方依赖，无需 `npm install`）

### 启动

Windows 用户直接双击 `启动页面.bat`（自动启动服务器并打开浏览器），或任意平台手动执行：

```bash
node server.js
```

然后浏览器访问 **http://127.0.0.1:8123/**

> **为什么要本地服务器？**
> 浏览器禁止 `file://` 页面发起跨域 fetch 请求，所以直接双击 HTML 文件时「🔄 在线更新」与「💾 更新并写入数据文件」不可用（页面展示与图表不受影响，数据由同目录 `data.js` 提供）。
> `server.js` 同时充当体彩官网接口的代理（绕过 CORS / HTTP/2 限制）、以及 `data.js` 的写回接口（浏览器没有本地文件写权限），且只监听 `127.0.0.1`，仅本机可访问。

### 更新数据

- 页面内点击「🔄 在线更新」按钮（**增量更新**：仅拉取缺失的新期次，结果缓存到 localStorage）；点「💾 更新并写入数据文件」可把最新数据直接写回同目录 `data.js`；或
- 命令行执行 `node update.js`（同样的增量更新，自动与 `data.js` 现有数据合并、校验后写回）；如需强制重建全部历史数据，使用 `node update.js --full`

## 📁 项目结构

| 文件 | 说明 |
| --- | --- |
| `大乐透历史数据分析.html` | 网页应用（不再内嵌数据，运行时加载同目录 `data.js`） |
| `data.js` | 历史开奖数据文件（自动生成，含每期奖池、销量与开奖公告，以 `var RAW_DATA = ` 开头） |
| `server.js` | 本地静态服务器 + 体彩官网接口代理 + `data.js` 写回接口 |
| `update.js` | 离线数据更新脚本（增量更新；`--full` 全量重建） |
| `启动页面.bat` | Windows 一键启动器（启动服务器并打开浏览器） |
| `赞赏码.jpg` | 赞赏支持二维码（页面底部「☕ 赞赏支持」面板 / README 展示） |
| `screenshots/` | 项目界面截图（README「📸 界面截图」展示用） |

## 📊 数据来源

- 开奖数据来自**中国体育彩票官网**公开接口（`webapi.sporttery.cn`），由脚本抓取、校验后写入同目录 `data.js`，页面运行时加载
- 数据格式 v2：每期为 `[期号, 开奖日期, 前区[5], 后区[2], 奖池, 销量, 开奖公告]`

## 🔧 开发说明

- 数据与页面分离：页面通过 `<script src="data.js"></script>` 加载数据，`data.js` 以 `var RAW_DATA = ` 开头，编辑页面布局时请勿删除该引入
- `server.js` 的 `/save-data` 写回接口（写 `data.js`）仅监听 `127.0.0.1`，只服务本机

## ☕ 赞赏支持

如果这个工具对你有帮助，欢迎扫码赞赏支持一下作者（完全自愿，不赞赏也不影响任何功能使用）：

<p align="center"><img src="赞赏码.jpg" alt="赞赏码" width="220"></p>

## 📄 License

[MIT](./LICENSE)
