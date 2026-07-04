'use strict';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const rpc = (m, p) => window.fulmen.rpc(m, p);

// Friendly labels for known testnet assets; unknown ids fall back to a short hex.
const KNOWN_ASSETS = {
  '83053bb23caeb4e76986dbd40887f850ab26dc202b180dcb2521c74a61b7499d': 'GOLD',
  'ceb851388a62039c49710566bc8b0b229eaa8a92bafbca512d8f7fd363b9e75c': 'L-BTC',
};
const assetLabel = (id) => !id ? 'base' : (KNOWN_ASSETS[id] || (id.slice(0, 8) + '…'));
const fmtAtoms = (msat) => Number((BigInt(msat || 0) / 1000n)).toLocaleString('en-US');
const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };

// --- navigation --------------------------------------------------------------
$$('.nav').forEach(b => b.addEventListener('click', () => {
  $$('.nav').forEach(x => x.classList.toggle('active', x === b));
  $$('.view').forEach(v => v.classList.toggle('active', v.dataset.view === b.dataset.view));
  if (b.dataset.view === 'overview') loadOverview();
  if (b.dataset.view === 'channels') loadChannels();
  if (b.dataset.view === 'pay') loadAssets();
}));

// --- connection status -------------------------------------------------------
async function refreshConn() {
  try {
    const info = await rpc('getinfo');
    $('#conn-dot').className = 'dot on';
    $('#conn-label').textContent = (info.alias || info.id.slice(0, 10)) + ' · ' + info.network;
    return info;
  } catch (e) {
    $('#conn-dot').className = 'dot off';
    $('#conn-label').textContent = 'not connected';
    throw e;
  }
}

// --- overview ----------------------------------------------------------------
async function loadOverview() {
  $('#ov-err').textContent = '';
  try {
    const info = await refreshConn();
    const nc = $('#ov-node'); nc.innerHTML = '';
    const kv = (k, v, mono) => { const d = el('div'); d.appendChild(el('div', 'k', k)); d.appendChild(el('div', 'v' + (mono ? ' mono' : ''), v)); nc.appendChild(d); };
    kv('Node id', info.id, true);
    kv('Alias', info.alias || '—');
    kv('Version', info.version);
    kv('Network', info.network);
    kv('Block height', String(info.blockheight));
    kv('Peers', `${info.num_peers} (${info.num_active_channels} active channels)`);

    const [funds, chans] = await Promise.all([rpc('listfunds'), rpc('listpeerchannels')]);
    const by = {}; // asset -> { onchain, channel }
    const bump = (a, field, msat) => { (by[a] ||= { onchain: 0n, channel: 0n })[field] += BigInt(msat || 0); };
    for (const o of (funds.outputs || [])) if (!o.reserved) bump(o.asset || '', 'onchain', o.amount_msat);
    for (const c of (chans.channels || [])) if (c.state === 'CHANNELD_NORMAL') bump(c.channel_asset || '', 'channel', c.to_us_msat);

    const grid = $('#ov-balances'); grid.innerHTML = '';
    const assets = Object.keys(by).sort();
    if (!assets.length) grid.appendChild(el('div', 'muted', 'No funds yet.'));
    for (const a of assets) {
      const b = by[a]; const total = b.onchain + b.channel;
      const card = el('div', 'bal');
      card.appendChild(el('div', 'asset', assetLabel(a) + (KNOWN_ASSETS[a] ? '' : '')));
      card.appendChild(el('div', 'total', fmtAtoms(total)));
      card.appendChild(el('div', 'split', `${fmtAtoms(b.channel)} in channels · ${fmtAtoms(b.onchain)} on-chain`));
      card.title = a || 'base';
      grid.appendChild(card);
    }
  } catch (e) { $('#ov-err').textContent = String(e.message || e); }
}

// --- channels ----------------------------------------------------------------
async function loadChannels() {
  $('#ch-err').textContent = '';
  try {
    await refreshConn();
    const chans = await rpc('listpeerchannels');
    const rows = (chans.channels || []).filter(c => c.short_channel_id || c.state !== 'CHANNELD_AWAITING_LOCKIN' || true);
    const body = $('#ch-body'); body.innerHTML = '';
    for (const c of rows) {
      const tr = el('tr');
      tr.appendChild(el('td', 'mono', (c.peer_id || '').slice(0, 14) + '…'));
      tr.appendChild(el('td', 'mono', c.short_channel_id || '—'));
      const at = el('td'); const aid = c.channel_asset || '';
      const pill = el('span', 'pill ' + (KNOWN_ASSETS[aid] ? 'asset' : 'asset'), assetLabel(aid)); pill.title = aid || 'base';
      at.appendChild(pill); tr.appendChild(at);
      const st = el('td'); st.appendChild(el('span', 'pill ' + (c.state === 'CHANNELD_NORMAL' ? 'st-normal' : 'st-other'), (c.state || '').replace('CHANNELD_', ''))); tr.appendChild(st);
      tr.appendChild(el('td', 'num', fmtAtoms(c.to_us_msat)));
      tr.appendChild(el('td', 'num', fmtAtoms((BigInt(c.total_msat || 0) - BigInt(c.to_us_msat || 0)).toString())));
      body.appendChild(tr);
    }
    if (!rows.length) { const tr = el('tr'); const td = el('td', 'muted', 'No channels.'); td.colSpan = 6; tr.appendChild(td); body.appendChild(tr); }
  } catch (e) { $('#ch-err').textContent = String(e.message || e); }
}

$('#ch-open').addEventListener('click', async () => {
  const msg = $('#ch-open-msg'); msg.className = 'msg'; msg.textContent = 'Opening…';
  const peer = $('#ch-peer').value.trim(), amount = $('#ch-amount').value.trim(), asset = $('#ch-asset').value.trim();
  try {
    if (peer.includes('@')) {
      const [id, addr] = peer.split('@'); const [host, port] = addr.split(':');
      await rpc('connect', { id, host, port: port ? Number(port) : undefined });
    }
    const id = peer.split('@')[0];
    const params = { id, amount: amount || 'all' };
    if (asset) params.asset = asset;
    const r = await rpc('fundchannel', params);
    msg.className = 'msg ok'; msg.textContent = 'Opened. channel_id ' + (r.channel_id || '').slice(0, 20) + '… txid ' + (r.txid || '').slice(0, 16) + '…';
    loadChannels();
  } catch (e) { msg.className = 'msg bad'; msg.textContent = String(e.message || e); }
});

// --- pay ---------------------------------------------------------------------
async function loadAssets() {
  try {
    const chans = await rpc('listpeerchannels');
    const seen = new Set();
    for (const c of (chans.channels || [])) if (c.channel_asset) seen.add(c.channel_asset);
    const sel = $('#pay-asset'); const cur = sel.value;
    sel.innerHTML = '<option value="">Base asset (policy)</option>';
    for (const a of [...seen].sort()) { const o = el('option'); o.value = a; o.textContent = assetLabel(a) + ' · ' + a.slice(0, 12) + '…'; sel.appendChild(o); }
    sel.value = cur;
  } catch {}
}
$('#pay-go').addEventListener('click', async () => {
  const msg = $('#pay-msg'); msg.className = 'msg'; msg.textContent = 'Paying…';
  const inv = $('#pay-inv').value.trim(), asset = $('#pay-asset').value;
  try {
    const params = { bolt11: inv };
    if (asset) params.asset = asset;
    const r = await rpc('pay', params);
    msg.className = 'msg ok';
    msg.textContent = `Paid: ${r.status}, ${fmtAtoms(r.amount_msat)} sent in ${r.parts || 1} part(s).`;
  } catch (e) { msg.className = 'msg bad'; msg.textContent = String(e.message || e); }
});

// --- receive -----------------------------------------------------------------
$('#rc-go').addEventListener('click', async () => {
  const msg = $('#rc-msg'); msg.className = 'msg'; msg.textContent = '';
  const amount = $('#rc-amount').value.trim(), desc = $('#rc-desc').value.trim() || 'Fulmen invoice';
  try {
    const label = 'fulmen-' + Date.now();
    const r = await rpc('invoice', { amount_msat: amount ? Number(amount) : 'any', label, description: desc });
    const out = $('#rc-out'); out.innerHTML = '';
    const box = el('div', 'b11', r.bolt11); out.appendChild(box);
    const btn = el('button', 'ghost copy', 'Copy'); btn.onclick = () => navigator.clipboard.writeText(r.bolt11);
    out.appendChild(btn);
  } catch (e) { msg.className = 'msg bad'; msg.textContent = String(e.message || e); }
});

// --- settings ----------------------------------------------------------------
$('#set-save').addEventListener('click', async () => {
  const msg = $('#set-msg'); msg.className = 'msg';
  try {
    await window.fulmen.setSocket($('#set-sock').value);
    await refreshConn();
    msg.className = 'msg ok'; msg.textContent = 'Connected.';
    loadOverview();
  } catch (e) { msg.className = 'msg bad'; msg.textContent = 'Saved, but: ' + String(e.message || e); }
});

// --- remote node (clnrest) ---------------------------------------------------
$('#rest-save').addEventListener('click', async () => {
  const msg = $('#rest-msg'); msg.className = 'msg';
  try {
    await window.fulmen.setTransport({
      type: 'rest',
      host: $('#rest-host').value.trim() || '127.0.0.1',
      port: Number($('#rest-port').value.trim()),
      protocol: $('#rest-proto').value,
      rune: $('#rest-rune').value.trim(),
    });
    await refreshConn(); msg.className = 'msg ok'; msg.textContent = 'Connected.'; loadOverview();
  } catch (e) { msg.className = 'msg bad'; msg.textContent = String(e.message || e); }
});

// --- managed node ------------------------------------------------------------
async function refreshNodeStatus() {
  try {
    const s = await window.fulmen.nodeStatus();
    const stat = $('#node-stat');
    if (!s.supported) stat.textContent = 'not available on this OS (Core Lightning is POSIX-only)';
    else if (s.running) stat.textContent = 'running (pid ' + s.pid + ')';
    else stat.textContent = s.lastError ? ('stopped — ' + s.lastError) : 'stopped';
  } catch {}
}
$('#node-startbtn').addEventListener('click', async () => {
  const stat = $('#node-stat'); stat.textContent = 'starting…';
  try {
    await window.fulmen.setNodeConfig({ mode: 'managed', node: {
      lightningdPath: $('#node-path').value.trim(),
      lightningDir: $('#node-dir').value.trim() || undefined,
      network: $('#node-net').value.trim() || undefined,
    }});
    await window.fulmen.nodeStart();
    await refreshNodeStatus();
    await refreshConn(); loadOverview();
  } catch (e) { $('#node-stat').textContent = 'error: ' + String(e.message || e); }
});
$('#node-stopbtn').addEventListener('click', async () => {
  try { await window.fulmen.nodeStop(); } catch {}
  await refreshNodeStatus();
});

// --- boot --------------------------------------------------------------------
(async () => {
  const cfg = await window.fulmen.getConfig();
  $('#set-sock').value = cfg.socket || '';
  const t = cfg.transport || {};
  $('#rest-host').value = t.host || '';
  $('#rest-port').value = t.port || '';
  if (t.protocol) $('#rest-proto').value = t.protocol;
  $('#rest-rune').value = t.rune || '';
  const n = cfg.node || {};
  $('#node-path').value = n.lightningdPath || '';
  $('#node-dir').value = n.lightningDir || '';
  $('#node-net').value = n.network || '';
  refreshNodeStatus();
  setInterval(refreshNodeStatus, 5000);
  try { await refreshConn(); loadOverview(); }
  catch { $('#ov-err').textContent = 'Not connected. In Settings, connect to your SeqLN node — or let Fulmen run a bundled one.'; }
})();
