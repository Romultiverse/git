'use strict';
/**
 * scripts/diagnose.js —— 定位 push2 接口在本机不可用的原因
 *
 *   node scripts/diagnose.js
 *
 * 依次用不同的「主机 × 请求头组合」请求 clist 端点，打印 HTTP 状态 / 响应长度 / 错误，
 * 用来判断到底是上游风控（限流）、TLS 指纹，还是请求头的问题。
 */

const https = require('https');

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const CLIST_PATH =
  '/api/qt/clist/get?pn=1&pz=3&po=1&np=1&fltt=2&invt=2&fid=f62&fs=m:90+t:2' +
  '&fields=f12,f14,f62&ut=b2884a393a59ad64002292a3e90d46a5';

const HOSTS = ['push2.eastmoney.com', '1.push2.eastmoney.com', '82.push2.eastmoney.com'];

const VARIANTS = [
  { name: '默认(无自定义头)', headers: {} },
  { name: '仅 UA', headers: { 'User-Agent': UA } },
  { name: 'UA + Referer', headers: { 'User-Agent': UA, Referer: 'https://data.eastmoney.com/' } },
  {
    name: 'UA + Referer + Accept',
    headers: {
      'User-Agent': UA,
      Referer: 'https://data.eastmoney.com/',
      Accept: 'application/json, text/javascript, */*; q=0.1',
    },
  },
  {
    name: 'UA + Referer + gzip',
    headers: {
      'User-Agent': UA,
      Referer: 'https://data.eastmoney.com/',
      'Accept-Encoding': 'gzip, deflate',
    },
  },
  {
    name: '完整(含 Connection: close)',
    headers: {
      'User-Agent': UA,
      Referer: 'https://data.eastmoney.com/',
      Accept: 'application/json, text/javascript, */*; q=0.1',
      'Accept-Encoding': 'gzip, deflate',
      Connection: 'close',
    },
  },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function once(host, headers, timeout = 12000) {
  return new Promise((resolve) => {
    const started = Date.now();
    const req = https.request(
      { hostname: host, path: CLIST_PATH, method: 'GET', headers },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () =>
          resolve({
            status: res.statusCode,
            bytes: Buffer.concat(chunks).length,
            ms: Date.now() - started,
            body: Buffer.concat(chunks).toString('utf8').slice(0, 160),
          })
        );
        res.on('error', (e) => resolve({ error: `流错误: ${e.message}` }));
      }
    );
    req.on('error', (e) => resolve({ error: `${e.code || ''} ${e.message}`.trim() }));
    req.setTimeout(timeout, () => req.destroy(new Error('timeout')));
    req.end();
  });
}

async function main() {
  console.log('端点: clist/get (行业板块, f62 降序)');
  console.log('主机数: ' + HOSTS.length + '  变体数: ' + VARIANTS.length + '\n');

  for (const host of HOSTS) {
    console.log(`########## host = ${host} ##########`);
    for (const v of VARIANTS) {
      const r = await once(host, v.headers);
      const desc = r.error
        ? `ERROR   ${r.error}`
        : `HTTP ${r.status}  ${r.bytes}B  ${r.ms}ms  ${r.body ? JSON.stringify(r.body.slice(0, 90)) : ''}`;
      console.log(`  ${v.name.padEnd(26)} -> ${desc}`);
      await sleep(1500);
    }
    console.log('');
  }

  console.log('对照：分时端点（此前实测可成功）');
  const fflow =
    '/api/qt/stock/fflow/kline/get?lmt=0&klt=1&secid=90.BK0475&fields1=f1,f2,f3,f7&fields2=f51,f52,f53,f54,f55,f56&ut=b2884a393a59ad64002292a3e90d46a5';
  const r = await new Promise((resolve) => {
    const req = https.request(
      { hostname: 'push2.eastmoney.com', path: fflow, method: 'GET', headers: { 'User-Agent': UA } },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, bytes: Buffer.concat(chunks).length }));
        res.on('error', (e) => resolve({ error: e.message }));
      }
    );
    req.on('error', (e) => resolve({ error: e.message }));
    req.setTimeout(12000, () => req.destroy(new Error('timeout')));
    req.end();
  });
  console.log('  fflow/kline -> ' + JSON.stringify(r));
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
