'use strict';
/**
 * scripts/probe-api.js —— 接口自检脚本（纯 Node，不需要 Electron）
 *
 *   node scripts/probe-api.js
 *
 * 依次请求东方财富三个端点并打印关键字段，用来确认：
 *   1) 网络是否可达、接口是否被限流
 *   2) 返回字段与 data/fetcher.js 的解析是否一致
 */

const fetcher = require('../data/fetcher');

function ok(v) {
  return v === null || v === undefined ? '—' : v;
}

async function main() {
  console.log('=== 东方财富接口自检 ===\n');

  // 1) 板块资金流排行（行业）
  try {
    const boards = await fetcher.getBoardList('industry', { pz: 5 });
    console.log(`[1] 行业板块排行: 共取回 ${boards.length} 条`);
    boards.slice(0, 5).forEach((b, i) => {
      console.log(
        `    ${i + 1}. ${b.name}(${b.code})  主力净流入=${ok(b.mainNetIn)}  ` +
          `净占比=${ok(b.mainNetPct)}  涨跌幅=${ok(b.changePct)}  超大单=${ok(b.superNetIn)}`
      );
    });
    if (boards.length) {
      const b = boards[0];
      const sum = (b.superNetIn || 0) + (b.bigNetIn || 0);
      console.log(
        `    校验: 超大单+大单 = ${sum.toFixed(0)}  vs  主力净流入 = ${ok(b.mainNetIn)}`
      );
    }
  } catch (e) {
    console.log(`[1] 行业板块排行: 失败 —— ${e.message}`);
  }

  // 2) 概念板块（取 3 条）
  try {
    const concepts = await fetcher.getBoardList('concept', { pz: 3 });
    console.log(`\n[2] 概念板块排行: 共取回 ${concepts.length} 条`);
    concepts.slice(0, 3).forEach((b, i) => {
      console.log(`    ${i + 1}. ${b.name}(${b.code})  主力净流入=${ok(b.mainNetIn)}`);
    });
  } catch (e) {
    console.log(`\n[2] 概念板块排行: 失败 —— ${e.message}`);
  }

  // 3) 大盘指数
  try {
    const idx = await fetcher.getIndexes();
    console.log(`\n[3] 大盘指数: 共取回 ${idx.length} 条`);
    idx.forEach((d) => {
      console.log(`    ${d.name}(${d.code})  ${ok(d.price)}  ${ok(d.changePct)}%`);
    });
  } catch (e) {
    console.log(`\n[3] 大盘指数: 失败 —— ${e.message}`);
  }

  // 4) 板块分时
  try {
    const code = process.env.PROBE_BOARD || 'BK0475'; // 银行Ⅱ
    const klines = await fetcher.getBoardMinuteFlow(code);
    console.log(`\n[4] 板块分时 (${code}): 共 ${klines.length} 个数据点`);
    klines.slice(0, 3).forEach((k) => {
      console.log(
        `    ${k.time}  主力=${ok(k.mainNetIn)}  超大单=${ok(k.superNetIn)}  大单=${ok(k.bigNetIn)}  ` +
          `中单=${ok(k.midNetIn)}  小单=${ok(k.smallNetIn)}`
      );
    });
    if (klines.length) {
      const k = klines.find((x) => x.mainNetIn !== null);
      if (k) {
        const sum = (k.superNetIn || 0) + (k.bigNetIn || 0);
        console.log(`    校验: 超大单+大单 = ${sum.toFixed(0)}  vs  主力 = ${ok(k.mainNetIn)}`);
      }
    }
  } catch (e) {
    console.log(`\n[4] 板块分时: 失败 —— ${e.message}`);
  }

  console.log('\n=== 自检结束 ===');
}

main().catch((e) => {
  console.error('自检异常:', e);
  process.exitCode = 1;
});
