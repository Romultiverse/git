'use strict';
/**
 * scripts/acceptance-test.js —— 验收测试（真实 Electron 环境，分阶段执行）
 *
 *   electron scripts/acceptance-test.js --phase=offline-cache
 *   electron scripts/acceptance-test.js --phase=write-config
 *   electron scripts/acceptance-test.js --phase=read-config
 *
 * 覆盖验收标准：
 *   #3 关掉重开，配置还在    -> write-config + read-config 两个独立进程
 *   #4 断网重开，显示缓存数据 + 离线提示 -> offline-cache
 *   #2 刷新不闪屏            -> offline-cache 中触发一次 refresh，检查 DOM 与图表实例未被重建
 *
 * 注意：offline-cache 阶段会写入一份**演示缓存**到 data/cache.json，
 *      调用方（或手工）应在测试后恢复该文件。这里在测试开始时会先把原文件备份到 .bak。
 */

const path = require('path');
const fs = require('fs');
const { app, BrowserWindow } = require('electron');

const PHASE = (process.argv.find((a) => a.startsWith('--phase=')) || '=none').split('=')[1];
const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const CACHE_FILE = path.join(DATA_DIR, 'cache.json');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const CONFIG_META = CONFIG_FILE + '.testmeta';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* --------------------------- 演示数据（仅用于测试） --------------------------- */

function demoBoards() {
  const mk = (code, name, amount, chg) => ({
    code,
    name,
    market: 90,
    secid: '90.' + code,
    price: Number((1000 + Math.abs(amount) / 1e7).toFixed(2)),
    changePct: chg,
    mainNetIn: amount,
    mainNetPct: chg * 2,
    superNetIn: amount * 0.62,
    superNetPct: chg * 1.3,
    bigNetIn: amount * 0.38,
    bigNetPct: chg * 0.7,
    midNetIn: -amount * 0.4,
    midNetPct: -chg * 0.8,
    smallNetIn: -amount * 0.6,
    smallNetPct: -chg * 1.2,
    ts: Date.now(),
  });
  const inflow = ['银行Ⅱ', '证券Ⅱ', '保险Ⅱ', '半导体', '电力行业', '酿酒行业'].map((n, i) =>
    mk('BK10' + (10 + i), n, (6 - i) * 2.8e8, 0.6 + i * 0.35)
  );
  const outflow = ['光伏设备', '房地产', '煤炭行业', '医疗器械', '通信设备', '汽车整车'].map((n, i) =>
    mk('BK20' + (10 + i), n, -(6 - i) * 2.4e8, -(0.5 + i * 0.3))
  );
  return inflow.concat(outflow).sort((a, b) => b.mainNetIn - a.mainNetIn);
}

/** 测试开始前 cache.json 是否已存在；用于决定收尾是「还原备份」还是「直接删除」。 */
let cacheExistedBefore = false;
/** 本次是否写过演示缓存；没写过就不该在收尾阶段动用户的文件。 */
let demoCacheWritten = false;

function writeDemoCache() {
  healStaleBackup(CACHE_FILE); // 先消化上次异常退出的残留，再记录/备份
  cacheExistedBefore = fs.existsSync(CACHE_FILE);
  if (cacheExistedBefore) {
    fs.copyFileSync(CACHE_FILE, CACHE_FILE + '.bak');
  }
  demoCacheWritten = true;
  const payload = {
    version: 1,
    updated: Date.now(),
    byType: {
      industry: {
        indexes: [
          { code: '000001', name: '上证指数', price: 3210.45, changePct: 0.86, change: 27.31 },
          { code: '399001', name: '深证成指', price: 10120.3, changePct: -0.42, change: -42.9 },
          { code: '399006', name: '创业板指', price: 2015.6, changePct: 1.24, change: 24.7 },
        ],
        boards: demoBoards(),
        updated: Date.now() - 60000,
      },
    },
  };
  fs.writeFileSync(CACHE_FILE, JSON.stringify(payload, null, 2), 'utf8');
}

/**
 * 收尾：把 cache.json 恢复到测试前的状态。
 *  - 测试前有缓存 -> 用 .bak 还原并删掉 .bak
 *  - 测试前没有缓存 -> 删掉我们写入的演示缓存，不能把假行情留成「真实缓存」
 */
function restoreCache() {
  if (!demoCacheWritten) return;
  const bak = CACHE_FILE + '.bak';
  try {
    if (fs.existsSync(bak)) {
      fs.copyFileSync(bak, CACHE_FILE);
      fs.unlinkSync(bak);
    } else if (!cacheExistedBefore && fs.existsSync(CACHE_FILE)) {
      fs.unlinkSync(CACHE_FILE);
    }
  } catch (_) {
    /* ignore */
  }
  demoCacheWritten = false;
}

/**
 * 自愈：上一次运行若异常退出，会留下 .bak。先把备份还原回原文件再继续，
 * 否则本次收尾会拿陈旧备份覆盖当前内容，或把测试值当成真实备份。
 */
function healStaleBackup(file) {
  const bak = file + '.bak';
  if (!fs.existsSync(bak)) return;
  try {
    fs.copyFileSync(bak, file);
    fs.unlinkSync(bak);
  } catch (_) {
    /* ignore */
  }
}

/* ---- 用户配置 config.json 的备份与还原（write-config / read-config 两个进程协作） ---- */

/** write-config 阶段：记录原配置是否存在并备份，供 read-config 阶段收尾还原。 */
function backupConfig() {
  healStaleBackup(CONFIG_FILE); // 先消化上次异常退出的残留，再记录/备份
  const existed = fs.existsSync(CONFIG_FILE);
  fs.writeFileSync(CONFIG_META, JSON.stringify({ existed }), 'utf8');
  if (existed) fs.copyFileSync(CONFIG_FILE, CONFIG_FILE + '.bak');
}

/** read-config 阶段收尾：把 config.json 恢复到测试前状态。 */
function restoreConfig() {
  if (!fs.existsSync(CONFIG_META)) return;
  let meta = null;
  try {
    meta = JSON.parse(fs.readFileSync(CONFIG_META, 'utf8'));
  } catch (_) {
    return; // 元数据读不出来：宁可不收尾，也绝不误删用户的配置
  }
  if (!meta || typeof meta.existed !== 'boolean') return; // 字段缺失同样不动文件

  try {
    if (meta.existed === true && fs.existsSync(CONFIG_FILE + '.bak')) {
      fs.copyFileSync(CONFIG_FILE + '.bak', CONFIG_FILE);
      fs.unlinkSync(CONFIG_FILE + '.bak');
    } else if (meta.existed === false && fs.existsSync(CONFIG_FILE)) {
      fs.unlinkSync(CONFIG_FILE); // 测试前没有配置：删掉测试写入的那份
    }
  } catch (_) {
    /* ignore */
  }
  try {
    fs.unlinkSync(CONFIG_META);
  } catch (_) {
    /* ignore */
  }
}

// 必须在加载 main.js 之前把缓存放好，渲染进程一启动就会读它
if (PHASE === 'offline-cache') {
  writeDemoCache();
  app.on('will-quit', restoreCache); // 非 app.exit 的退出路径兜底
}

require('../main.js'); // 真实产品主进程

let failed = 0;
function check(name, ok, extra) {
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${name}${extra !== undefined ? '   ' + JSON.stringify(extra) : ''}`
  );
  if (!ok) failed++;
}

app.whenReady().then(async () => {
  await sleep(9000);

  const wins = BrowserWindow.getAllWindows();
  if (!wins.length) {
    console.log('FAIL 没有创建窗口');
    app.exit(1);
    return;
  }
  const win = wins[0];

  /* ============ 阶段 1：断网 + 缓存回退 + 刷新不闪烁 ============ */
  if (PHASE === 'offline-cache') {
    const before = await win.webContents.executeJavaScript(`(() => {
      const flow = echarts.getInstanceByDom(document.querySelector('#flow-chart'));
      const min  = echarts.getInstanceByDom(document.querySelector('#minute-chart'));
      const row = document.querySelector('.rank-row');
      if (row) row.dataset.probe = 'keep-me';
      window.__ids = { flow: flow.id, min: min.id };
      return {
        rankRows: document.querySelectorAll('.rank-row').length,
        offlineHidden: document.querySelector('#offline-badge').hidden,
        offlineText: document.querySelector('#offline-badge').textContent.trim(),
        dataTime: document.querySelector('#data-time').textContent.trim(),
        indexCards: document.querySelectorAll('.index-card').length,
        indexTexts: Array.from(document.querySelectorAll('.index-card')).map((e) =>
          e.textContent.replace(/\\s+/g, ' ').trim()),
        flowNodes: flow.getOption().series[0].data.length,
        flowLinks: flow.getOption().series[0].links.length,
        flowTypes: flow.getOption().series[0].type,
        flowInstId: flow.id,
      };
    })()`);

    console.log('阶段1 初始状态: ' + JSON.stringify(before, null, 2));

    check('接口不可用时进入离线模式并给出提示', before.offlineHidden === false, before.offlineText);
    check('离线时用本地缓存渲染排行榜', before.rankRows === 12, before.rankRows);
    check('离线时指数卡片来自缓存', before.indexCards === 3, before.indexTexts);
    check('离线时力导图仍能出图', before.flowTypes === 'graph' && before.flowNodes === 12 && before.flowLinks > 0, {
      nodes: before.flowNodes,
      links: before.flowLinks,
    });

    // 触发一次真实刷新（会再次尝试联网失败 -> 回落缓存），检查界面是否被重建
    await win.webContents.executeJavaScript('refresh({})');
    await sleep(800);

    const after = await win.webContents.executeJavaScript(`(() => {
      const flow = echarts.getInstanceByDom(document.querySelector('#flow-chart'));
      const min  = echarts.getInstanceByDom(document.querySelector('#minute-chart'));
      const row = document.querySelector('.rank-row');
      return {
        probeStillThere: !!(row && row.dataset.probe === 'keep-me'),
        rowCount: document.querySelectorAll('.rank-row').length,
        flowSameInstance: flow.id === window.__ids.flow,
        minSameInstance: min.id === window.__ids.min,
      };
    })()`);

    console.log('阶段1 刷新后: ' + JSON.stringify(after));
    check('刷新后列表 DOM 节点未被重建（不闪烁）', after.probeStillThere === true);
    check('刷新后行数保持不变', after.rowCount === 12, after.rowCount);
    check(
      '刷新后两个图表实例未被重建（不闪烁）',
      after.flowSameInstance === true && after.minSameInstance === true
    );

    restoreCache(); // 还原真实缓存（app.exit 不会触发 will-quit）
    app.exit(failed ? 1 : 0);
    return;
  }

  /* ============ 阶段 2：写入配置 ============ */
  if (PHASE === 'write-config') {
    backupConfig();
    const saved = await win.webContents.executeJavaScript(
      "window.api.setConfig({ refreshSeconds: 77, favorites: ['BK1010','BK2010'], boardType: 'concept', chartMode: 'sankey', topN: 9 })"
    );
    console.log('setConfig -> ' + JSON.stringify(saved));
    check('配置写入成功', !!saved && saved.refreshSeconds === 77 && saved.favorites.length === 2);
    app.exit(failed ? 1 : 0);
    return;
  }

  /* ============ 阶段 3：新进程读回配置（模拟关掉重开） ============ */
  if (PHASE === 'read-config') {
    app.on('will-quit', restoreConfig); // 非 app.exit 的退出路径也尽量还原
    const cfg = await win.webContents.executeJavaScript('window.api.getConfig()');
    console.log('getConfig -> ' + JSON.stringify(cfg));
    check('重开后「刷新频率」仍是 77', cfg.refreshSeconds === 77, cfg.refreshSeconds);
    check('重开后「关注的板块」仍在', cfg.favorites.length === 2 && cfg.favorites.includes('BK1010'), cfg.favorites);
    check('重开后「板块类型」仍是 concept', cfg.boardType === 'concept', cfg.boardType);
    check('重开后「图表模式」仍是 sankey', cfg.chartMode === 'sankey', cfg.chartMode);
    check('重开后「显示数量」仍是 9', cfg.topN === 9, cfg.topN);
    restoreConfig(); // 收尾：把用户的 config.json 还原回去
    app.exit(failed ? 1 : 0);
    return;
  }

  console.log('未知 phase: ' + PHASE);
  app.exit(1);
});
