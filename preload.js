'use strict';
/**
 * preload.js —— 安全桥接层
 * 渲染进程运行在 contextIsolation 下，没有 Node 能力；
 * 这里只暴露一组白名单方法，全部走 ipcRenderer.invoke，避免直接暴露 ipcRenderer。
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  /** 应用与运行环境信息（版本、数据目录等） */
  getAppInfo: () => ipcRenderer.invoke('app:info'),

  /** 读取用户配置（关注的板块、刷新频率、板块类型等） */
  getConfig: () => ipcRenderer.invoke('config:get'),

  /** 保存用户配置（传增量对象，主进程负责与已有配置合并） */
  setConfig: (patch) => ipcRenderer.invoke('config:set', patch),

  /** 拉取首页快照：成功返回最新数据，失败返回缓存数据 + offline=true */
  getSnapshot: (opts) => ipcRenderer.invoke('data:snapshot', opts || {}),

  /** 读取本地缓存文件内容 */
  getCache: () => ipcRenderer.invoke('cache:get'),

  /** 拉取某个板块的当日分钟级资金流 */
  getMinute: (code) => ipcRenderer.invoke('data:minute', code),

  /** 在系统浏览器打开链接 */
  openExternal: (url) => ipcRenderer.invoke('app:open-external', url),

  /** 设置窗口标题后缀（null 恢复默认标题） */
  setTitleSuffix: (suffix) => ipcRenderer.invoke('win:set-title-suffix', suffix),
});
