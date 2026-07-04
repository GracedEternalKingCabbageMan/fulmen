'use strict';
// Minimal Core Lightning (SeqLN) JSON-RPC client over the lightning-rpc unix
// socket. No auth, no deps — for a desktop app driving a LOCAL SeqLN node.
// Mirrors the transport seqdex's clnLNLeg uses (unix socket, one object per
// request, HTML escaping OFF so params like "->" aren't mangled).
const net = require('net');

// Pull complete top-level JSON objects out of a stream buffer, tracking string
// state + escapes + brace depth. Returns { objects: [...], rest: '<remainder>' }.
function extractJSONObjects(buf) {
  const objects = [];
  let depth = 0, start = -1, inStr = false, esc = false;
  for (let i = 0; i < buf.length; i++) {
    const c = buf[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; continue; }
    if (c === '{') { if (depth === 0) start = i; depth++; }
    else if (c === '}') {
      depth--;
      if (depth === 0 && start >= 0) {
        objects.push(buf.slice(start, i + 1));
        start = -1;
      }
    }
  }
  const rest = start >= 0 ? buf.slice(start) : (depth === 0 ? '' : buf);
  return { objects, rest: depth === 0 ? '' : rest };
}

let idCounter = 0;

// call(socketPath, method, params, timeoutMs) -> Promise<result>
function call(socketPath, method, params = {}, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const id = `fulmen-${++idCounter}`;
    let settled = false;
    const conn = net.createConnection(socketPath);
    let buf = '';
    const done = (fn, arg) => { if (!settled) { settled = true; clearTimeout(timer); conn.destroy(); fn(arg); } };
    const timer = setTimeout(() => done(reject, new Error(`${method}: timeout after ${timeoutMs}ms`)), timeoutMs);

    conn.on('error', (e) => done(reject, new Error(`${method}: ${e.message}`)));
    conn.on('connect', () => {
      // SetEscapeHTML(false) equivalent: JSON.stringify does not escape <>&.
      conn.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n\n');
    });
    conn.on('data', (d) => {
      buf += d.toString('utf8');
      const { objects, rest } = extractJSONObjects(buf);
      buf = rest;
      for (const raw of objects) {
        let msg;
        try { msg = JSON.parse(raw); } catch { continue; }
        if (msg.id === undefined || msg.id === null) continue; // notification
        if (String(msg.id) !== id) continue;
        if (msg.error) return done(reject, new Error(`${method}: ${msg.error.message || JSON.stringify(msg.error)}`));
        return done(resolve, msg.result);
      }
    });
    conn.on('close', () => { if (!settled) done(reject, new Error(`${method}: connection closed before reply`)); });
  });
}

// A tiny handle bound to one socket path.
class CLN {
  constructor(socketPath) { this.socketPath = socketPath; }
  call(method, params, timeoutMs) { return call(this.socketPath, method, params, timeoutMs); }
}

module.exports = { CLN, call, extractJSONObjects };

// Standalone smoke test: node src/main/cln.js <socketPath>
if (require.main === module) {
  const sock = process.argv[2] || process.env.FULMEN_SOCK;
  if (!sock) { console.error('usage: node cln.js <lightning-rpc socket path>'); process.exit(2); }
  (async () => {
    try {
      const info = await call(sock, 'getinfo', {});
      console.log('getinfo OK:', { id: info.id, alias: info.alias, version: info.version, blockheight: info.blockheight, peers: info.num_peers });
      const funds = await call(sock, 'listfunds', {});
      console.log('listfunds OK:', { outputs: (funds.outputs || []).length, channels: (funds.channels || []).length });
      process.exit(0);
    } catch (e) { console.error('SMOKE FAIL:', e.message); process.exit(1); }
  })();
}
