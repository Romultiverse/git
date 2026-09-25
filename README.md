# A股板块资金流向监测（Electron 桌面看板）

一个长期可用的 A 股**板块资金流向**监测桌面软件：独立窗口、任务栏图标、数据每 60 秒自动刷新，
并附带一张「板块之间资金流动关系」的力导图 / 桑基图。

数据来自**东方财富公开接口**，**不需要任何 API Key**。

---

## 一、功能一览

### 核心视图

| # | 视图 | 说明 |
|---|------|------|
| 1 | **板块资金流向力导图 / 桑基图** | 右侧主区域。资金**流出**板块与资金**流入**板块之间用连线相连，连线粗细表示资金量，红色=流入、绿色=流出；可拖拽、可缩放，点击节点即选中该板块 |
| 2 | **板块资金排行列表** | 左侧。按主力净流入降序，显示排名、板块名/代码、涨跌幅、主力净流入；支持搜索与「仅看关注」 |
| 3 | **板块资金分时折线图** | 底部。选中板块后展示当日**分钟级**主力资金净流入走势（另叠加超大单 / 大单） |

### 辅助功能

- 窗口标题固定为 **A股板块资金流向监测**
- 每 **60 秒**自动刷新（可在设置中改），刷新采用 ECharts `setOption` 增量更新 + 列表 keyed DOM diff，**界面不闪烁**
- 最近一次数据缓存到本地 JSON；**断网时显示缓存数据并提示「离线模式」**
- 用户配置持久化：**关注的板块列表**、**刷新频率**、**是否只看行业/概念**、流动图显示数量、图表模式

### 界面布局

```
┌──────────────────────────────────────────────────────────────┐
│ 顶部：标题 + 上证/深证成指/创业板指 涨跌幅 + 离线提示 + 倒计时 │
├───────────────────┬──────────────────────────────────────────┤
│ 左侧              │ 右侧主区域                               │
│ 板块资金排行榜    │ 板块间资金流动示意图（力导图 / 桑基图）  │
│ （可点击选中）    ├──────────────────────────────────────────┤
│                   │ 底部：选中板块的资金分时折线图           │
└───────────────────┴──────────────────────────────────────────┘
```

---

## 二、技术栈

- **框架**：Electron（主进程 `main.js` + 安全桥接 `preload.js`）
- **前端**：原生 HTML / CSS / JavaScript（无构建步骤）
- **图表**：ECharts 5.5.1（`graph` 力引导布局、`sankey` 桑基图、`line` 折线图）。已放在
  `renderer/vendor/echarts.min.js`，**离线可用**，不依赖 CDN
- **数据存储**：本地 JSON（缓存 + 用户配置）
- **打包**：electron-builder → Windows **NSIS 安装包** 与 **portable 免安装 exe**

---

## 三、目录结构

```
ashare-fund-flow-dashboard/
├── main.js                     # Electron 主进程：窗口、IPC、缓存/配置读写
├── preload.js                  # contextBridge 安全桥接（渲染层唯一的对外出口）
├── package.json                # 依赖、脚本、electron-builder 配置
├── README.md
├── .gitignore
├── build/
│   └── icon.ico                # 应用图标（scripts/make-icon.py 生成，可自行替换）
├── data/
│   ├── fetcher.js              # 【数据层】调用东方财富接口，纯 Node 模块
│   └── cache.json              # 【本地缓存】最近一次成功抓取的数据
├── renderer/
│   ├── index.html              # 页面骨架
│   ├── style.css               # 深色金融看板样式
│   ├── app.js                  # 渲染逻辑 + ECharts 图表
│   └── vendor/
│       └── echarts.min.js      # ECharts 5.5.1（本地化）
├── tests/
│   └── parse.test.js           # 数据解析单元测试（node --test）
└── scripts/
    ├── probe-api.js            # 接口自检：打印三个端点的实际返回
    ├── diagnose.js             # 接口诊断：逐主机 × 逐请求头组合探测
    ├── smoke-test.js           # 端到端冒烟：真实 Electron 里跑窗口/图表并截图
    ├── acceptance-test.js      # 验收测试：离线缓存 / 配置持久化 / 刷新不闪烁
    ├── verify-build.js         # 产物校验：exe、asar 清单、图标是否写入
    └── make-icon.py            # 生成 build/icon.ico（纯标准库）
```

> 运行时还会生成 `data/config.json`（用户配置）。**打包后**这两个 JSON 会写到
> `%APPDATA%\AShareFundFlow\data\`（因为 .exe 内的 asar 是只读的），设置弹窗底部会显示实际路径。

---

## 四、数据源与接口说明（东方财富公开接口，无需 Key）

均来自 `push2.eastmoney.com`，公共 token `ut=b2884a393a59ad64002292a3e90d46a5`（网页端通用，非私密密钥）。

### 1) 板块资金流排行

```
GET https://push2.eastmoney.com/api/qt/clist/get
    ?pn=1&pz=100&po=1&np=1&fltt=2&invt=2
    &fid=f62                       # 按「主力净流入」降序
    &fs=m:90+t:2                   # 行业=m:90+t:2  概念=m:90+t:3  地域=m:90+t:1
    &fields=f12,f13,f14,f2,f3,f62,f184,f66,f69,f72,f75,f78,f81,f84,f87,f124
    &ut=b2884a393a59ad64002292a3e90d46a5
```

字段含义：

| 字段 | 含义 | 字段 | 含义 |
|------|------|------|------|
| `f12` | 板块代码（如 BK0475） | `f14` | 板块名称 |
| `f13` | 市场编号 | `f124` | 更新时间戳 |
| `f2` | 最新价 | `f3` | 涨跌幅(%) |
| **`f62`** | **主力净流入额（元）** | **`f184`** | **主力净占比(%)** |
| `f66` / `f69` | 超大单净额 / 净占比 | `f72` / `f75` | 大单净额 / 净占比 |
| `f78` / `f81` | 中单净额 / 净占比 | `f84` / `f87` | 小单净额 / 净占比 |

> 校验关系：`主力净流入 = 超大单 + 大单`。

### 2) 板块分时资金流（分钟级）

```
GET https://push2.eastmoney.com/api/qt/stock/fflow/kline/get
    ?lmt=0&klt=1                    # klt=1 表示 1 分钟
    &secid=90.BK0475                # 板块 secid：固定前缀 90. + 板块代码
    &fields1=f1,f2,f3,f7
    &fields2=f51,f52,f53,f54,f55,f56
    &ut=b2884a393a59ad64002292a3e90d46a5
```

⚠️ **实测（klt=1）服务端固定只返回 6 列**，即使 `fields2` 里写了更多字段：

```
时间, 主力净流入, 小单净额, 中单净额, 大单净额, 超大单净额
```

真实返回样例（银行Ⅱ 2026-09-24 09:31）：

```
"2026-09-24 09:31,-12296247.0,2410586.0,9934735.0,-561947.0,-11734300.0"
            时间      主力       小单      中单      大单       超大单
校验： -561947 + -11734300 = -12296247 ✓  （主力 = 大单 + 超大单）
```

因此分钟级数据**没有**占比与收盘价列，程序按 6 列解析（`tests/parse.test.js` 已把这条锁死）。
一个交易日会返回 240 个点（9:30–11:30 + 13:00–15:00）。

### 3) 大盘指数

```
GET https://push2.eastmoney.com/api/qt/ulist.np/get
    ?fltt=2&invt=2
    &secids=1.000001,0.399001,0.399006    # 上证指数, 深证成指, 创业板指
    &fields=f2,f3,f4,f12,f13,f14
    &ut=b2884a393a59ad64002292a3e90d46a5
```

`1.` 前缀 = 上交所，`0.` 前缀 = 深交所；`f2`=最新价、`f3`=涨跌幅、`f4`=涨跌额。

> 端点与字段的权威来源：开源库 **akshare**（`akshare/stock/stock_fund_em.py`）与
> **efinance**（`efinance/common/config.py`）。东方财富官方没有公开文档。

### 关于限流（重要）

`clist` / `ulist.np` 属于重接口，短时间高频请求会被**按 IP 拒绝**（服务端直接断开连接，
在 curl 里表现为 `http_code=000`，在 Node 里表现为 `ECONNRESET / socket hang up`）。
这**不是**请求头或 TLS 问题——换 UA / Referer / Accept / HTTP 版本都无效，换分片域名也无效。

`data/fetcher.js` 已内置：

- 超时（12s）+ 指数退避重试（最多 3 次）
- **多主机轮换**：`push2.eastmoney.com` → `1.push2.eastmoney.com` → `push2delay.eastmoney.com`

如果长时间无法取数，程序会自动回落显示本地缓存并标注「离线模式」，倒计时继续走，到点自动重试。
被限流后一般需要等待一段时间才会恢复，可临时用手机热点换出口 IP 验证。

---

## 五、安装 / 运行 / 打包

### 0. 前置条件

需要 **Node.js ≥ 18**（自带 npm）。检查：

```bash
node -v
npm -v
```

未安装的话去 <https://nodejs.org> 下载 LTS 版安装即可。

### 1. 安装依赖

```bash
npm install
```

国内网络较慢时可以换镜像：

```bash
npm install --registry=https://registry.npmmirror.com
```

### 2. 本地运行

```bash
npm start
```

会打开一个 1480×920 的独立窗口（标题：**A股板块资金流向监测**）。

### 3. 打包 Windows .exe

```bash
npm run build
```

等价于 `electron-builder --win`，产物在 **`dist/`**：

| 产物 | 说明 |
|------|------|
| `AShareFundFlow-Setup-1.0.0.exe` | NSIS 安装包：可选安装目录、创建桌面/开始菜单快捷方式 |
| `AShareFundFlow-Portable-1.0.0.exe` | **portable 免安装版**：双击直接运行（推荐先试这个） |

也可以单独打某一种：

```bash
npm run build:nsis       # 只要安装包
npm run build:portable   # 只要免安装 exe
```

打包慢/失败时可先设置镜像：

```bash
set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
set ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/
```

### 4. 完整命令串联

```bash
npm install
npm start
npm run build
```

---

## 六、开发者自检（可选）

项目自带一组自检脚本，全部是真实运行的检查，而不是摆设：

```bash
npm test              # 数据解析单元测试（node --test，9 个用例）
npm run probe         # 直接请求三个东方财富端点，打印真实返回
npm run diagnose      # 逐「主机 × 请求头组合」探测接口，定位限流/网络问题
npm run smoke         # 真实 Electron 里启动应用，检查窗口/图表并截图到 dist/smoke-shot.png
npm run verify:build  # 校验 dist 产物：exe 有效性、asar 清单、图标是否写入
```

验收测试分三步（分别对应验收标准的 2/3/4）：

```bash
npx electron scripts/acceptance-test.js --phase=offline-cache   # 断网 + 缓存回退 + 刷新不闪烁
npx electron scripts/acceptance-test.js --phase=write-config    # 写入用户配置
npx electron scripts/acceptance-test.js --phase=read-config     # 新进程重开并读回配置
```

> `offline-cache` 阶段会写入一份**演示缓存**用于验证离线分支；正式使用前删除 `data/cache.json`
> 即可（应用会重新从接口抓取）。

---

## 七、验收自检清单

| # | 验收项 | 状态 | 怎么验 / 证据 |
|---|--------|------|---------------|
| 1 | `npm start` 打开窗口，能看到板块资金排行和力导图 | ✅ | `npm run smoke`：19/19 通过（窗口、标题、preload、ECharts、12 节点力导图、桑基图、分时折线、canvas 有像素内容、桑基退化态无残留） |
| 2 | 数据 60 秒自动刷新，不闪屏 | ✅ | 倒计时实测递减；`--phase=offline-cache` 触发刷新后，列表 DOM 节点与两个 ECharts 实例均未被重建 |
| 3 | 关掉重开，配置还在 | ✅ | `--phase=write-config` 写入 → 检查磁盘 `data/config.json` → **新进程** `--phase=read-config` 全部读回 |
| 4 | 断网重开，显示缓存数据 + 离线提示 | ✅ | `--phase=offline-cache`：接口不可用时显示橙色「离线模式」，12 行排行/3 个指数/力导图全部来自缓存 |
| 5 | `npm run build` 生成 .exe，双击可运行 | ✅ | `dist/` 下生成 2 个 exe；`npm run verify:build` 全通过；实测双击 portable 版：进程启动、窗口可见、标题为「A股板块资金流向监测」 |

`data/cache.json` 就是缓存文件；首次运行需联网成功抓取一次，之后才具备离线回退能力。

---

## 八、常见问题

**Q：`npm run build` 报 `Cannot create symbolic link ... winCodeSign ... libcrypto.dylib`？**
Windows 普通用户没有创建符号链接的特权，而 electron-builder 解压 `winCodeSign` 时会尝试恢复
`darwin/` 下的符号链接（Windows 打包根本用不到这些文件）。三种解法任选：

1）手动预置缓存（排除 darwin，已验证可行）：

```bat
set CACHE=%LOCALAPPDATA%\electron-builder\Cache\winCodeSign
curl -L -o "%CACHE%\winCodeSign-2.6.0.7z" https://npmmirror.com/mirrors/electron-builder-binaries/winCodeSign-2.6.0/winCodeSign-2.6.0.7z
"%CD%\node_modules\7zip-bin\win\x64\7za.exe" x "%CACHE%\winCodeSign-2.6.0.7z" -o"%CACHE%\winCodeSign-2.6.0" -xr!darwin
```

2）开启 Windows「开发者模式」（设置 → 系统 → 开发者选项），普通用户即获得符号链接权限；

3）用管理员身份运行一次 `npm run build`。

**Q：图表区域一片空白？**
确认 `renderer/vendor/echarts.min.js` 存在（约 1 MB）。若被删掉，重新下载：

```bash
curl -L -o renderer/vendor/echarts.min.js https://cdn.jsdelivr.net/npm/echarts@5.5.1/dist/echarts.min.js
```

**Q：一直显示「离线模式」？**
说明接口请求失败（多为限流或断网）。点「立即刷新」重试；仍不行可运行 `npm run diagnose` 看具体报错。
非交易时段部分数据可能为空，属正常现象。

**Q：想换应用图标？**
替换 `build/icon.ico`（建议 256×256 且包含多个尺寸），或改 `scripts/make-icon.py` 后重新运行
`npm run icon`。

**Q：想改窗口标题？**
`main.js` 里的 `APP_TITLE` 常量，以及 `renderer/index.html` 的 `<title>`。

**Q：想换 exe 文件名 / 应用名？**
改 `package.json` 里 `build.productName` 与各 `artifactName` 模板（当前用 ASCII 名以避开中文路径问题；
产物里的窗口标题仍是中文）。

**Q：打包后数据存哪？**
`%APPDATA%\AShareFundFlow\data\`（`cache.json` / `config.json`）。设置弹窗底部会显示确切路径。

---

## 九、免责声明

数据来自东方财富公开接口，仅用于个人学习与研究，不构成任何投资建议。
接口为第三方非官方接口，可能随时调整；若字段或端点点位变化，请以 `data/fetcher.js` 中的
端点为准自行调整。
