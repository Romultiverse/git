'use strict';
/**
 * tests/parse.test.js —— 数据解析层单元测试
 *
 *   node --test tests/
 *
 * 关键断言使用 2026-09-24 对 90.BK0475（银行Ⅱ）的**真实抓包数据**，
 * 用来锁死「分钟级 klines 只有 6 列」以及「主力净流入 = 大单 + 超大单」的关系。
 */

const test = require('node:test');
const assert = require('node:assert');

const fetcher = require('../data/fetcher');

/** 真实抓包数据（东方财富 fflow/kline/get，klt=1，银行Ⅱ 2026-09-24） */
const REAL_KLINES = [
  '2026-09-24 09:31,-12296247.0,2410586.0,9934735.0,-561947.0,-11734300.0',
  '2026-09-24 09:32,-1839975.0,-3654755.0,5595119.0,58222.0,-1898197.0',
  '2026-09-24 09:33,370371.0,-6543261.0,5901439.0,-13463550.0,13833921.0',
  '2026-09-24 09:34,-3510971.0,-10698284.0,14242644.0,7037902.0,-10548873.0',
  '2026-09-24 09:35,-35104479.0,-5703893.0,40830973.0,20614325.0,-55718804.0',
];

test('BOARD_FS: 行业/概念/地域 的 fs 过滤表达式正确', () => {
  assert.strictEqual(fetcher.BOARD_FS.industry, 'm:90+t:2');
  assert.strictEqual(fetcher.BOARD_FS.concept, 'm:90+t:3');
  assert.strictEqual(fetcher.BOARD_FS.region, 'm:90+t:1');
});

test('toNum: 兼容东财的 "-" / "--" / 空值', () => {
  assert.strictEqual(fetcher.toNum('-'), null);
  assert.strictEqual(fetcher.toNum('--'), null);
  assert.strictEqual(fetcher.toNum(''), null);
  assert.strictEqual(fetcher.toNum(null), null);
  assert.strictEqual(fetcher.toNum(undefined), null);
  assert.strictEqual(fetcher.toNum(0), 0);
  assert.strictEqual(fetcher.toNum('3.14'), 3.14);
  assert.strictEqual(fetcher.toNum(-100), -100);
});

test('diffToArray: 同时兼容数组与对象两种形态', () => {
  assert.deepStrictEqual(fetcher.diffToArray([{ a: 1 }]), [{ a: 1 }]);
  assert.deepStrictEqual(fetcher.diffToArray({ 0: { a: 1 }, 1: { a: 2 } }), [{ a: 1 }, { a: 2 }]);
  assert.deepStrictEqual(fetcher.diffToArray(null), []);
  assert.deepStrictEqual(fetcher.diffToArray(undefined), []);
});

test('parseKlineLines: 按实测的 6 列顺序解析（时间/主力/小单/中单/大单/超大单）', () => {
  const rows = fetcher.parseKlineLines(REAL_KLINES);
  assert.strictEqual(rows.length, 5);

  const k = rows[0];
  assert.strictEqual(k.time, '2026-09-24 09:31');
  assert.strictEqual(k.mainNetIn, -12296247);
  assert.strictEqual(k.smallNetIn, 2410586);
  assert.strictEqual(k.midNetIn, 9934735);
  assert.strictEqual(k.bigNetIn, -561947);
  assert.strictEqual(k.superNetIn, -11734300);

  // 分钟级没有占比/收盘价列 -> 必须是 null，而不是 NaN/0
  assert.strictEqual(k.mainNetPct, null);
  assert.strictEqual(k.price, null);
});

test('parseKlineLines: 对每一行都满足 主力 = 大单 + 超大单', () => {
  const rows = fetcher.parseKlineLines(REAL_KLINES);
  for (const k of rows) {
    assert.strictEqual(
      k.mainNetIn,
      k.bigNetIn + k.superNetIn,
      `${k.time} 主力(${k.mainNetIn}) 应等于 大单(${k.bigNetIn}) + 超大单(${k.superNetIn})`
    );
  }
});

test('parseKlineLines: 空输入安全', () => {
  assert.deepStrictEqual(fetcher.parseKlineLines([]), []);
  assert.deepStrictEqual(fetcher.parseKlineLines(null), []);
  assert.deepStrictEqual(fetcher.parseKlineLines(undefined), []);
});

test('parseBoard: clist 字段映射与 secid 前缀', () => {
  const b = fetcher.parseBoard({
    f12: 'BK0475',
    f13: 90,
    f14: '银行Ⅱ',
    f2: 1234.56,
    f3: 1.23,
    f62: 123456789,
    f184: 2.5,
    f66: 100,
    f69: 1,
    f72: 200,
    f75: 2,
    f78: -50,
    f81: -0.5,
    f84: -250,
    f87: -2.5,
    f124: 1690000000,
  });

  assert.strictEqual(b.code, 'BK0475');
  assert.strictEqual(b.name, '银行Ⅱ');
  assert.strictEqual(b.secid, '90.BK0475');
  assert.strictEqual(b.price, 1234.56);
  assert.strictEqual(b.changePct, 1.23);
  assert.strictEqual(b.mainNetIn, 123456789);
  assert.strictEqual(b.mainNetPct, 2.5);
  assert.strictEqual(b.superNetIn, 100);
  assert.strictEqual(b.superNetPct, 1);
  assert.strictEqual(b.bigNetIn, 200);
  assert.strictEqual(b.bigNetPct, 2);
  assert.strictEqual(b.midNetIn, -50);
  assert.strictEqual(b.midNetPct, -0.5);
  assert.strictEqual(b.smallNetIn, -250);
  assert.strictEqual(b.smallNetPct, -2.5);
});

test('getBoardMinuteFlow: 拒绝非法板块代码（防止拼出额外查询参数）', async () => {
  // 参数校验发生在发起网络请求之前，所以这里不会真的联网
  await assert.rejects(() => fetcher.getBoardMinuteFlow('BK0475&pn=1'), /非法板块代码/);
  await assert.rejects(() => fetcher.getBoardMinuteFlow(''), /非法板块代码/);
  await assert.rejects(() => fetcher.getBoardMinuteFlow(null), /非法板块代码/);
  await assert.rejects(() => fetcher.getBoardMinuteFlow('a'.repeat(17)), /非法板块代码/);
});

test('candidateUrls: 生成主域名 + 备用域名，用于规避限流', () => {
  const urls = fetcher.candidateUrls('/api/qt/clist/get?x=1');
  assert.strictEqual(urls.length, 3);
  assert.match(urls[0], /^https:\/\/push2\.eastmoney\.com\/api\/qt\/clist\/get\?x=1$/);
  assert.match(urls[1], /^https:\/\/1\.push2\.eastmoney\.com\//);
  assert.match(urls[2], /^https:\/\/push2delay\.eastmoney\.com\//);
});
