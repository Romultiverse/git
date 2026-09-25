'use strict';
/**
 * scripts/verify-build.js —— 校验打包产物
 *
 *   node scripts/verify-build.js
 *
 * 检查：
 *   1. dist 下的 .exe 是否存在、是否为有效 PE（MZ 头）
 *   2. app.asar 清单里是否包含全部产品文件
 *   3. 自定义图标是否真的被写进了主 exe（在 PE 里搜索 icon.ico 中 PNG 的特征字节）
 *   4. asar 内不包含开发期文件（tests/、scripts/、node_modules）
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

const REQUIRED_IN_ASAR = [
  '/main.js',
  '/preload.js',
  '/package.json',
  '/renderer/index.html',
  '/renderer/style.css',
  '/renderer/app.js',
  '/renderer/vendor/echarts.min.js',
  '/data/fetcher.js',
  '/data/cache.json',
];

function humanSize(n) {
  if (n > 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB';
  if (n > 1024) return (n / 1024).toFixed(1) + ' KB';
  return n + ' B';
}

let failed = 0;
function check(name, ok, extra) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
  if (!ok) failed++;
}

function main() {
  // ---- 1. exe 存在且是 PE ----
  const exes = fs.existsSync(DIST)
    ? fs.readdirSync(DIST).filter((f) => f.toLowerCase().endsWith('.exe'))
    : [];
  check('dist 下存在 .exe 产物', exes.length > 0, exes.join(', '));

  for (const e of exes) {
    const p = path.join(DIST, e);
    const buf = fs.readFileSync(p);
    const isPE = buf.length > 2 && buf[0] === 0x4d && buf[1] === 0x5a; // "MZ"
    check(`${e} 是有效 PE 且体积合理`, isPE && buf.length > 10 * 1024 * 1024, humanSize(buf.length));
  }

  // ---- 2. app.asar 清单 ----
  const asarPath = path.join(DIST, 'win-unpacked', 'resources', 'app.asar');
  if (!fs.existsSync(asarPath)) {
    check('app.asar 存在', false, asarPath);
    return;
  }
  check('app.asar 存在', true, humanSize(fs.statSync(asarPath).size));

  let list = [];
  try {
    const asar = require('@electron/asar');
    list = asar.listPackage(asarPath).map((s) => s.replace(/\\/g, '/'));
  } catch (e) {
    check('可以解析 app.asar 清单', false, e.message);
    return;
  }
  check('可以解析 app.asar 清单', list.length > 0, `${list.length} 个条目`);

  for (const want of REQUIRED_IN_ASAR) {
    const found = list.some((f) => f === want || f.endsWith(want));
    check(`asar 内含 ${want}`, found);
  }

  const leaks = list.filter((f) => /^\/(tests|scripts)\//.test(f) || f.includes('node_modules'));
  check('asar 内不含开发期文件(tests/scripts/node_modules)', leaks.length === 0, leaks.slice(0, 5).join(', '));

  // ---- 3. 图标是否写入主 exe ----
  const mainExe = path.join(DIST, 'win-unpacked', 'AShareFundFlow.exe');
  const iconPath = path.join(ROOT, 'build', 'icon.ico');
  if (fs.existsSync(mainExe) && fs.existsSync(iconPath)) {
    const icon = fs.readFileSync(iconPath);
    const exeBuf = fs.readFileSync(mainExe);

    // icon.ico 内嵌 PNG：取 256x256 那张 PNG 的前 64 字节作为指纹
    const pngSig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const idx = icon.indexOf(pngSig);
    let matched = false;
    if (idx >= 0) {
      const fingerprint = icon.subarray(idx, idx + 64);
      matched = exeBuf.indexOf(fingerprint) >= 0;
    }
    check('自定义图标已写入主 exe（PE 内含 icon.ico 的 PNG 指纹）', matched);

    // 二次校验：统计 icon.ico 里各尺寸 PNG 数据在 exe 中的命中数
    const prints = [];
    for (let p = icon.indexOf(pngSig); p >= 0; p = icon.indexOf(pngSig, p + 1)) {
      prints.push(icon.subarray(p, p + 64));
    }
    const hitCount = prints.filter((fp) => exeBuf.indexOf(fp) >= 0).length;
    check('exe 中命中 icon.ico 各尺寸 PNG 指纹', hitCount >= 1, `${hitCount}/${prints.length} 张`);
  } else {
    check('找到主 exe 与 icon.ico', false, `${mainExe} / ${iconPath}`);
  }

  console.log(`\n结果: ${failed === 0 ? '全部通过' : failed + ' 项失败'}`);
  process.exitCode = failed ? 1 : 0;
}

main();
