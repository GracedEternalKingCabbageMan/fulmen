'use strict';
// clnrest transport: talk to a SeqLN node over its clnrest plugin (HTTP/HTTPS +
// rune auth) instead of the local unix socket. This is the transport for a
// REMOTE node and for Windows (where SeqLN runs inside WSL2 and is reached over
// localhost TCP, since cross-boundary unix sockets are unreliable).
//
// clnrest exposes each RPC method at POST /v1/<method> with a `Rune` header and
// the params as a JSON body. Its default protocol is https with a self-signed
// cert; on localhost we don't verify it (rejectUnauthorized:false).
const http = require('http');
const https = require('https');

// restCall(conn, method, params, timeoutMs) -> Promise<result>
// conn = { host, port, protocol: 'http'|'https', rune }
function restCall(conn, method, params = {}, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const proto = conn.protocol === 'http' ? 'http' : 'https';
    const lib = proto === 'http' ? http : https;
    const body = JSON.stringify(params || {});
    const req = lib.request({
      host: conn.host || '127.0.0.1',
      port: conn.port,
      method: 'POST',
      path: '/v1/' + method,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'Rune': conn.rune || '',
      },
      rejectUnauthorized: false, // clnrest's localhost cert is self-signed
      timeout: timeoutMs,
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        let j;
        try { j = data ? JSON.parse(data) : {}; }
        catch { return reject(new Error(`${method}: non-JSON reply (HTTP ${res.statusCode}): ${data.slice(0, 200)}`)); }
        // clnrest returns the method result directly on success; errors carry a
        // {code, message} (JSON-RPC-ish) and/or a >=400 status.
        if (res.statusCode >= 400 || (j && (j.error || (j.code && j.message)))) {
          const msg = (j && (j.message || (j.error && j.error.message) || j.error)) || `HTTP ${res.statusCode}`;
          return reject(new Error(`${method}: ${msg}`));
        }
        resolve(j);
      });
    });
    req.on('error', (e) => reject(new Error(`${method}: ${e.message}`)));
    req.on('timeout', () => { req.destroy(new Error(`${method}: timeout after ${timeoutMs}ms`)); });
    req.write(body);
    req.end();
  });
}

class RestCLN {
  constructor(conn) { this.conn = conn; }
  call(method, params, timeoutMs) { return restCall(this.conn, method, params, timeoutMs); }
}

module.exports = { RestCLN, restCall };

// Smoke test: node cln-rest.js <host> <port> <protocol> <rune>
if (require.main === module) {
  const [, , host, port, protocol, rune] = process.argv;
  if (!port) { console.error('usage: node cln-rest.js <host> <port> <http|https> <rune>'); process.exit(2); }
  restCall({ host, port: Number(port), protocol, rune }, 'getinfo', {})
    .then((info) => { console.log('clnrest getinfo OK:', { id: info.id, alias: info.alias, version: info.version, blockheight: info.blockheight }); process.exit(0); })
    .catch((e) => { console.error('clnrest SMOKE FAIL:', e.message); process.exit(1); });
}
