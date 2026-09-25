'use strict';
/**
 * scripts/smoke-test.js —— 端到端冒烟测试（真实 Electron 环境）
 *
 *   npx electron scripts/smoke-test.js
 *
 * 两个阶段：
 *   PHASE 1 真实路径：加载真实 main.js（窗口 + IPC + 缓存全走产品代码），
 *           读回渲染进程状态，确认窗口/ECharts/preload/标题/定时器。
 *   PHASE 2 渲染路径：向渲染进程注入数据（分时为**真实抓包数据**，
 *           板块为合成数据），驱动真实的渲染函数，确认排行列表、
 *           力导图、桑基图、分时折线图都能正确出图。
 *
 * 退出码：0 = 关键项通过；1 = 有硬性失败项。
 */

const path = require('path');
const fs = require('fs');
const { app, BrowserWindow } = require('electron');

require('../main.js'); // 真实主进程

const DELAY = Number(process.env.SMOKE_DELAY || 9000);

/* ------------------------- PHASE 1：真实状态读取 ------------------------- */

const PROBE = `(() => {
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));
  const chartInfo = (sel) => {
    const el = $(sel);
    const inst = el && window.echarts ? window.echarts.getInstanceByDom(el) : null;
    const opt = inst ? inst.getOption() : null;
    return {
      hasCanvas: !!(el && el.querySelector('canvas')),
      hasInstance: !!inst,
      seriesTypes: opt ? (opt.series || []).map((s) => s.type) : [],
    };
  };
  return {
    documentTitle: document.title,
    echartsLoaded: typeof window.echarts !== 'undefined',
    apiBridge: typeof window.api !== 'undefined',
    apiMethods: window.api ? Object.keys(window.api).sort() : [],
    indexCards: $$('.index-card').length,
    rankRows: $$('.rank-row').length,
    rankEmpty: $('.rank-empty') ? $('.rank-empty').textContent.trim() : null,
    offlineBadgeHidden: $('#offline-badge') ? $('#offline-badge').hidden : null,
    offlineText: $('#offline-badge') ? $('#offline-badge').textContent.trim() : null,
    countdown: $('#countdown') ? $('#countdown').textContent.trim() : null,
    dataTime: $('#data-time') ? $('#data-time').textContent.trim() : null,
    flow: chartInfo('#flow-chart'),
    minute: chartInfo('#minute-chart'),
  };
})()`;

/* ---------------- PHASE 2：注入数据驱动真实渲染函数 ---------------- */

// 真实抓包数据：东方财富 fflow/kline/get，klt=1，90.BK0475（银行Ⅱ），2026-09-24
const REAL_KLINES = [
  '2026-09-24 09:31,-12296247.0,2410586.0,9934735.0,-561947.0,-11734300.0',
  '2026-09-24 09:32,-1839975.0,-3654755.0,5595119.0,58222.0,-1898197.0',
  '2026-09-24 09:33,370371.0,-6543261.0,5901439.0,-13463550.0,13833921.0',
  '2026-09-24 09:34,-3510971.0,-10698284.0,14242644.0,7037902.0,-10548873.0',
  '2026-09-24 09:35,-35104479.0,-5703893.0,40830973.0,20614325.0,-55718804.0',
  '2026-09-24 09:36,-26351730.0,-10491723.0,36701434.0,27001985.0,-53353715.0',
  '2026-09-24 09:37,-57499855.0,972264.0,56546387.0,17470462.0,-74970317.0',
  '2026-09-24 09:38,-63598297.0,5405365.0,58115009.0,13993828.0,-77592125.0',
  '2026-09-24 09:39,-71569435.0,5001444.0,66779598.0,-2262634.0,-69306801.0',
  '2026-09-24 09:40,-95124083.0,10819299.0,84153035.0,-13136044.0,-81988039.0',
  '2026-09-24 09:41,-90224364.0,-962583.0,91274546.0,-20472336.0,-69752028.0',
  '2026-09-24 09:42,-59776139.0,-22176140.0,81989926.0,-3801783.0,-55974356.0',
].join('\n');

// 合成板块数据（仅用于验证渲染路径，非真实行情）：6 个流入 + 6 个流出
const DEMO_SCRIPT = `(() => {
  const klineRows = ${JSON.stringify(REAL_KLINES)};

  const mk = (code, name, amount, chg) => ({
    code, name, market: 90, secid: '90.' + code,
    price: Number((1000 + Math.abs(amount) / 1e7).toFixed(2)),
    changePct: chg,
    mainNetIn: amount,
    mainNetPct: chg * 2,
    superNetIn: amount * 0.62, superNetPct: chg * 1.3,
    bigNetIn: amount * 0.38, bigNetPct: chg * 0.7,
    midNetIn: -amount * 0.4, midNetPct: -chg * 0.8,
    smallNetIn: -amount * 0.6, smallNetPct: -chg * 1.2,
    ts: Date.now(),
  });

  const inflow = ['银行Ⅱ','证券Ⅱ','保险Ⅱ','半导体','电力行业','酿酒行业']
    .map((n, i) => mk('BK10' + (10 + i), n, (6 - i) * 2.8e8, 0.6 + i * 0.35));
  const outflow = ['光伏设备','房地产','煤炭行业','医疗器械','通信设备','汽车整车']
    .map((n, i) => mk('BK20' + (10 + i), n, -(6 - i) * 2.4e8, -(0.5 + i * 0.3)));

  state.boards = inflow.concat(outflow).sort((a, b) => b.mainNetIn - a.mainNetIn);
  state.indexes = [
    { code: '000001', name: '上证指数', price: 3210.45, changePct: 0.86, change: 27.31 },
    { code: '399001', name: '深证成指', price: 10120.3, changePct: -0.42, change: -42.9 },
    { code: '399006', name: '创业板指', price: 2015.6, changePct: 1.24, change: 24.7 },
  ];

  renderIndexes();
  applyFilter();
  renderFlow();

  // 分时图用真实抓包数据驱动
  const klines = klineRows.split('\\n').map((line) => {
    const p = line.split(',');
    const n = (v) => (v === undefined || v === '' || v === '-' ? null : Number(v));
    return {
      time: p[0], mainNetIn: n(p[1]), smallNetIn: n(p[2]), midNetIn: n(p[3]),
      bigNetIn: n(p[4]), superNetIn: n(p[5]),
      mainNetPct: n(p[6]), smallNetPct: n(p[7]), midNetPct: n(p[8]),
      bigNetPct: n(p[9]), superNetPct: n(p[10]), price: n(p[11]), changePct: n(p[12]),
    };
  });
  renderMinuteChart(klines);

  const flowInst = echarts.getInstanceByDom(document.querySelector('#flow-chart'));
  const minInst = echarts.getInstanceByDom(document.querySelector('#minute-chart'));
  const flowOpt = flowInst.getOption();
  const minOpt = minInst.getOption();

  // 回归验证：切到「桑基退化态」（只有流入、没有流出 -> 无连线）时必须清空旧图元，
  // 否则上一张图会残留在提示文字下面（第二轮复审指出的缺陷）。
  const savedBoards = state.boards;
  const savedMode = state.config.chartMode;
  state.boards = inflow; // 全为净流入 -> links 为空
  state.config.chartMode = 'sankey';
  renderFlow();
  const degradedOpt = echarts.getInstanceByDom(document.querySelector('#flow-chart')).getOption();
  const degradedSeries = degradedOpt.series ? degradedOpt.series.length : 0;
  const degradedTitle =
    degradedOpt.title && degradedOpt.title[0] ? degradedOpt.title[0].text : '';
  state.boards = savedBoards;
  state.config.chartMode = savedMode;
  renderFlow();
  const restoredOpt = echarts.getInstanceByDom(document.querySelector('#flow-chart')).getOption();

  return {
    rankRows: document.querySelectorAll('.rank-row').length,
    firstRowText: document.querySelector('.rank-row') ? document.querySelector('.rank-row').textContent.replace(/\\s+/g, ' ').trim() : null,
    lastRowText: (() => { const r = document.querySelectorAll('.rank-row'); return r.length ? r[r.length - 1].textContent.replace(/\\s+/g, ' ').trim() : null; })(),
    indexCards: document.querySelectorAll('.index-card').length,
    indexTexts: Array.from(document.querySelectorAll('.index-card')).map((e) => e.textContent.replace(/\\s+/g, ' ').trim()),
    flowSeriesType: flowOpt.series[0].type,
    flowNodes: flowOpt.series[0].data.length,
    flowLinks: flowOpt.series[0].links.length,
    flowLinkWidthSample: (flowOpt.series[0].links[0] && flowOpt.series[0].links[0].lineStyle) ? flowOpt.series[0].links[0].lineStyle.width : null,
    sankeyNodes: (() => {
      const opt = buildSankeyOption(buildFlowData());
      return opt && opt.series && opt.series[0] ? opt.series[0].data.length : 0;
    })(),
    sankeyLinks: (() => {
      const opt = buildSankeyOption(buildFlowData());
      return opt && opt.series && opt.series[0] ? opt.series[0].links.length : 0;
    })(),
    minutePoints: minOpt.series[0].data.length,
    minuteSeriesNames: minOpt.series.map((s) => s.name),
    flowCanvasBytes: (() => {
      const c = document.querySelector('#flow-chart canvas');
      return c ? c.toDataURL('image/png').length : 0;
    })(),
    minCanvasBytes: (() => {
      const c = document.querySelector('#minute-chart canvas');
      return c ? c.toDataURL('image/png').length : 0;
    })(),
    degradedSeries,
    degradedTitle,
    restoredSeriesType: restoredOpt.series && restoredOpt.series[0] ? restoredOpt.series[0].type : '',
  };
})()`;

app.whenReady().then(async () => {
  await new Promise((r) => setTimeout(r, DELAY));

  const wins = BrowserWindow.getAllWindows();
  if (!wins.length) {
    console.log('SMOKE_FAIL 没有创建任何窗口');
    app.exit(1);
    return;
  }
  const win = wins[0];

  /* ---------- PHASE 1 ---------- */
  let r1;
  try {
    r1 = await win.webContents.executeJavaScript(PROBE);
  } catch (e) {
    console.log('SMOKE_FAIL 读取渲染进程失败: ' + e.message);
    app.exit(1);
    return;
  }

  const cd1 = r1.countdown;
  await new Promise((r) => setTimeout(r, 2600));
  let cd2 = null;
  try {
    cd2 = await win.webContents.executeJavaScript(
      "document.querySelector('#countdown') ? document.querySelector('#countdown').textContent.trim() : null"
    );
  } catch (_) {
    /* ignore */
  }

  /* ---------- PHASE 2 ---------- */
  let r2 = null;
  let phase2Error = null;
  try {
    r2 = await win.webContents.executeJavaScript(DEMO_SCRIPT);
  } catch (e) {
    phase2Error = e.message;
  }

  /* ---------- 截图 ---------- */
  let shot = null;
  try {
    const img = await win.capturePage();
    fs.mkdirSync(path.join(__dirname, '..', 'dist'), { recursive: true });
    shot = path.join(__dirname, '..', 'dist', 'smoke-shot.png');
    fs.writeFileSync(shot, img.toPNG());
  } catch (e) {
    shot = 'capture失败: ' + e.message;
  }

  console.log('===== PHASE 1: 真实启动状态 =====');
  console.log(JSON.stringify(Object.assign({}, r1, {
    countdownBefore: cd1,
    countdownAfter: cd2,
    countdownTicking: cd1 !== cd2,
  }), null, 2));

  console.log('\n===== PHASE 2: 注入数据后的渲染结果 =====');
  console.log(phase2Error ? 'ERROR ' + phase2Error : JSON.stringify(r2, null, 2));
  console.log('\n截图: ' + shot);

  /* ---------- 检查 ---------- */
  const checks = [
    ['PHASE1 窗口已创建', true],
    ['PHASE1 窗口标题为「A股板块资金流向监测」', r1.documentTitle === 'A股板块资金流向监测'],
    ['PHASE1 preload 桥接可用(8 个方法)', r1.apiBridge === true && r1.apiMethods.length === 8],
    ['PHASE1 ECharts 已本地加载', r1.echartsLoaded === true],
    ['PHASE1 流动图已初始化(canvas+实例)', r1.flow.hasCanvas && r1.flow.hasInstance],
    ['PHASE1 分时图已初始化(canvas+实例)', r1.minute.hasCanvas && r1.minute.hasInstance],
    ['PHASE1 自动刷新倒计时在递减', cd1 !== cd2],
    ['PHASE2 排行列表渲染 12 行', !!r2 && r2.rankRows === 12],
    ['PHASE2 三大指数卡片渲染', !!r2 && r2.indexCards === 3],
    ['PHASE2 力导图为 graph 且含 12 节点', !!r2 && r2.flowSeriesType === 'graph' && r2.flowNodes === 12],
    ['PHASE2 力导图生成连线(流出→流入)', !!r2 && r2.flowLinks > 0],
    ['PHASE2 连线粗细随资金量变化', !!r2 && typeof r2.flowLinkWidthSample === 'number' && r2.flowLinkWidthSample > 0],
    ['PHASE2 桑基图可生成节点与连线', !!r2 && r2.sankeyNodes === 12 && r2.sankeyLinks > 0],
    ['PHASE2 分时折线渲染 12 个真实数据点', !!r2 && r2.minutePoints === 12],
    ['PHASE2 力导图 canvas 确有像素内容(非空白)', !!r2 && r2.flowCanvasBytes > 5000],
    ['PHASE2 分时图 canvas 确有像素内容(非空白)', !!r2 && r2.minCanvasBytes > 5000],
    ['PHASE2 桑基退化态已清空旧图元(无残留 series)', !!r2 && r2.degradedSeries === 0],
    ['PHASE2 桑基退化态显示提示文字', !!r2 && /无法构成桑基图/.test(r2.degradedTitle || '')],
    ['PHASE2 从退化态恢复后力导图仍正常', !!r2 && r2.restoredSeriesType === 'graph'],
  ];

  let failed = 0;
  console.log('\n--- 冒烟检查 ---');
  for (const [name, ok] of checks) {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
    if (!ok) failed++;
  }
  console.log(`\n结果: ${checks.length - failed}/${checks.length} 通过`);
  app.exit(failed ? 1 : 0);
});
