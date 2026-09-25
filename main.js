'use strict';
/**
 * main.js —— Electron 主进程
 * 职责：创建窗口、提供 IPC 数据桥、读写本地 JSON（缓存 / 用户配置）。
 *
 * 数据目录策略：
 *   - 开发运行（npm start）：<项目>/data/        —— 方便直接查看 cache.json
 *   - 打包运行（.exe）：%APPDATA%/AShareFundFlow/data/ —— 因为 asar 内的文件只读
 */

const { app, BrowserWindow, ipcMain, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');

const fetcher = require('./data/fetcher');

const APP_TITLE = 'A股板块资金流向监测';
const isDev = process.argv.includes('--dev');

/** @type {BrowserWindow|null} */
let mainWindow = null;

/* ------------------------------------------------------------------ *
 * 数据目录与 JSON 读写
 * ------------------------------------------------------------------ */

function dataDir() {
  const dir = app.isPackaged
    ? path.join(app.getPath('userData'), 'data')
    : path.join(__dirname, 'data');
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (_) {
    /* ignore */
  }
  return dir;
}

const cacheFile = () => path.join(dataDir(), 'cache.json');
const configFile = () => path.join(dataDir(), 'config.json');
/**
 * 随包分发的初始缓存文件（打包后在 asar 内，只读）。
 * 注意：仓库里这份是**空骨架**（byType 为空），因此首次运行若就断网，
 * 界面会显示「暂无数据 + 离线模式」——必须先成功联网抓取过一次，之后才有可回退的缓存。
 */
const seedCacheFile = () => path.join(__dirname, 'data', 'cache.json');

function readJson(file, fallback) {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    return JSON.parse(raw);
  } catch (_) {
    return fallback;
  }
}

/** 原子写：先写临时文件再 rename，避免进程被杀时留下半截 JSON。 */
function writeJsonAtomic(file, obj) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), 'utf8');
    fs.renameSync(tmp, file);
    return true;
  } catch (e) {
    console.error('[writeJsonAtomic] 失败:', file, e.message);
    return false;
  }
}

/* ---------------------------- 用户配置 ---------------------------- */

const DEFAULT_CONFIG = {
  boardType: 'industry', // 'industry' | 'concept'
  refreshSeconds: 60, // 自动刷新间隔（秒）
  favorites: [], // 关注的板块 code 列表
  chartMode: 'graph', // 'graph'(力导图) | 'sankey'(桑基图)
  topN: 12, // 力导图/桑基图 中每侧最多显示的板块数
};

function getConfig() {
  const saved = readJson(configFile(), null);
  return Object.assign({}, DEFAULT_CONFIG, saved && typeof saved === 'object' ? saved : {});
}

function saveConfig(patch) {
  // 只保留白名单字段：避免 patch 里的 __proto__ / constructor 之类的键污染配置对象
  const merged = Object.assign({}, getConfig(), patch || {});
  const next = {
    boardType: merged.boardType,
    refreshSeconds: merged.refreshSeconds,
    favorites: merged.favorites,
    chartMode: merged.chartMode,
    topN: merged.topN,
  };
  // 规范化
  next.refreshSeconds = Math.min(3600, Math.max(10, Number(next.refreshSeconds) || 60));
  next.topN = Math.min(40, Math.max(4, Number(next.topN) || 12));
  if (!Array.isArray(next.favorites)) next.favorites = [];
  if (next.boardType !== 'industry' && next.boardType !== 'concept') next.boardType = 'industry';
  if (next.chartMode !== 'graph' && next.chartMode !== 'sankey') next.chartMode = 'graph';
  writeJsonAtomic(configFile(), next);
  return next;
}

/* ----------------------------- 数据缓存 ---------------------------- */

function emptyCache() {
  return { version: 1, updated: 0, byType: {} };
}

function loadCache() {
  let c = readJson(cacheFile(), null);
  if (!c || typeof c !== 'object' || !c.byType) {
    // 首次运行：尝试用随包的种子缓存兜底
    c = readJson(seedCacheFile(), null);
  }
  if (!c || typeof c !== 'object' || !c.byType) c = emptyCache();
  if (!c.byType) c.byType = {};
  return c;
}

/** 把一次成功的抓取写入缓存（按板块类型分别保存）。 */
function persistSnapshot(type, snapshot) {
  const cache = loadCache();
  cache.byType[type] = {
    indexes: snapshot.indexes || [],
    boards: snapshot.boards || [],
    updated: snapshot.updated || Date.now(),
  };
  cache.updated = Date.now();
  writeJsonAtomic(cacheFile(), cache);
}

/** 读取某类型的缓存，返回与实时快照同构的对象；没有则返回 null。 */
function loadCachedSnapshot(type) {
  const entry = loadCache().byType[type];
  if (!entry || !Array.isArray(entry.boards) || entry.boards.length === 0) return null;
  return {
    ok: true,
    boardType: type,
    indexes: entry.indexes || [],
    boards: entry.boards,
    updated: entry.updated || 0,
    errors: [],
  };
}

/* ----------------------------- IPC ------------------------------- */

function registerIpc() {
  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    dataDir: dataDir(),
    packaged: app.isPackaged,
    title: APP_TITLE,
  }));

  ipcMain.handle('config:get', () => getConfig());
  ipcMain.handle('config:set', (_e, patch) => saveConfig(patch));

  ipcMain.handle('cache:get', () => loadCache());

  /**
   * 拉取首页快照。成功 -> 写缓存；失败 -> 回退到缓存并标记 offline。
   */
  ipcMain.handle('data:snapshot', async (_e, opts) => {
    const cfg = getConfig();
    const type = (opts && opts.boardType) || cfg.boardType;

    try {
      const snap = await fetcher.getSnapshot({ boardType: type, pz: 100 });
      if (Array.isArray(snap.boards) && snap.boards.length > 0) {
        persistSnapshot(type, snap);
        return Object.assign({}, snap, { offline: false, fromCache: false, cachedAt: snap.updated });
      }
      // 接口通了但没数据（例如非交易时段 + 上游异常）：仍然走缓存
      const cached = loadCachedSnapshot(type);
      if (cached) {
        return Object.assign({}, cached, {
          offline: true,
          fromCache: true,
          cachedAt: cached.updated,
          errors: snap.errors,
        });
      }
      return Object.assign({}, snap, { offline: true, fromCache: false, cachedAt: null });
    } catch (err) {
      const msg = (err && err.message) || String(err);
      const cached = loadCachedSnapshot(type);
      if (cached) {
        return Object.assign({}, cached, {
          offline: true,
          fromCache: true,
          cachedAt: cached.updated,
          errors: [msg],
        });
      }
      return {
        ok: false,
        boardType: type,
        indexes: [],
        boards: [],
        updated: Date.now(),
        cachedAt: null,
        errors: [msg],
        offline: true,
        fromCache: false,
      };
    }
  });

  /** 单个板块的分钟级资金流（不缓存，失败返回空数组 + error）。 */
  ipcMain.handle('data:minute', async (_e, code) => {
    try {
      const klines = await fetcher.getBoardMinuteFlow(code);
      return { ok: true, code, klines };
    } catch (err) {
      return { ok: false, code, klines: [], error: (err && err.message) || String(err) };
    }
  });

  ipcMain.handle('app:open-external', (_e, url) => {
    if (typeof url === 'string' && /^https?:\/\//i.test(url)) shell.openExternal(url);
  });

  ipcMain.handle('win:set-title-suffix', (_e, suffix) => {
    if (mainWindow) mainWindow.setTitle(suffix ? `${APP_TITLE} — ${suffix}` : APP_TITLE);
  });
}

/* ----------------------------- 窗口 ------------------------------ */

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1100,
    minHeight: 680,
    title: APP_TITLE,
    backgroundColor: '#0d1117',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
      backgroundThrottling: false,
    },
  });

  // 不让页面里的 <title> 覆盖我们的窗口标题
  mainWindow.on('page-title-updated', (e) => {
    e.preventDefault();
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  if (isDev) mainWindow.webContents.openDevTools({ mode: 'detach' });

  // 站内链接一律在系统浏览器打开，禁止在应用内导航
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file://')) {
      e.preventDefault();
      if (/^https?:/i.test(url)) shell.openExternal(url);
    }
  });
}

/* ---------------------------- 生命周期 ---------------------------- */

// 单实例：第二次启动时聚焦已有窗口
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    app.setAppUserModelId('com.ashare.fundflow.dashboard');
    Menu.setApplicationMenu(null); // 隐藏默认菜单栏
    registerIpc();
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    app.quit();
  });
}
