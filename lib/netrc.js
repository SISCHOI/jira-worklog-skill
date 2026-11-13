'use strict';
// 认证与 HTTP：默认读 _netrc（不打印、不落盘密钥）
// 测试/联调可用环境变量覆盖：
//   WL_API_BASE=http://127.0.0.1:8099   指向 mock 或其它 Jira 实例（含协议）
//   WL_TOKEN=xxx                        直接给 token（配合 WL_API_BASE 使用）
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

function netrcPath() {
  return process.env.NETRC || path.join(process.env.USERPROFILE || process.env.HOME || '.', '_netrc');
}

function creds() {
  const p = netrcPath();
  if (!fs.existsSync(p)) {
    throw new Error(`找不到凭据文件 ${p}（需要 machine/login/password 三段；或设 WL_TOKEN + WL_API_BASE）`);
  }
  const t = fs.readFileSync(p, 'utf8');
  const m = t.match(/machine\s+(\S+)\s+login\s+(\S+)\s+password\s+(\S+)/);
  if (!m) throw new Error(`${p} 格式不对：需要 machine <host> / login <user> / password <PAT>`);
  return { host: m[1], login: m[2], token: m[3] };
}

function target(p) {
  const base = process.env.WL_API_BASE;
  if (base) {
    const u = new URL(base);
    return {
      lib: u.protocol === 'http:' ? http : https,
      hostname: u.hostname,
      port: u.port || (u.protocol === 'http:' ? 80 : 443),
      prefix: u.pathname.replace(/\/$/, ''),
      token: process.env.WL_TOKEN || (() => { try { return creds().token; } catch (_) { return ''; } })(),
    };
  }
  const c = creds();
  return { lib: https, hostname: c.host, port: 443, prefix: '', token: c.token };
}

function api(method, p, body) {
  const t = target(p);
  return new Promise((res, rej) => {
    const d = body ? JSON.stringify(body) : null;
    const r = t.lib.request({
      hostname: t.hostname, port: t.port, path: t.prefix + p, method,
      headers: Object.assign({ Authorization: 'Bearer ' + t.token, Accept: 'application/json' },
        d ? { 'Content-Type': 'application/json' } : {}),
    }, s => {
      let x = '';
      // setEncoding buffers partial multi-byte UTF-8 sequences across TCP chunks;
      // per-chunk Buffer concatenation would corrupt a CJK char that straddles a boundary.
      s.setEncoding('utf8');
      s.on('data', d => x += d);
      s.on('end', () => {
        let j = null;
        try { j = x ? JSON.parse(x) : null; } catch (_) { j = { raw: x }; }
        if (s.statusCode >= 400) {
          const e = (j && j.errorMessages && j.errorMessages.join('; ')) || x.slice(0, 300);
          return rej(new Error(`HTTP ${s.statusCode}: ${e}`));
        }
        res(j);
      });
    });
    r.on('error', rej);
    if (d) r.write(d);
    r.end();
  });
}

module.exports = { creds, api, netrcPath };
