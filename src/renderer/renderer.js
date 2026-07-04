'use strict';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const rpc = (m, p) => window.fulmen.rpc(m, p);

// Friendly labels for known Sequentia testnet assets; unknown ids fall back to short hex.
const KNOWN_ASSETS = {
  '83053bb23caeb4e76986dbd40887f850ab26dc202b180dcb2521c74a61b7499d': 'GOLD',
};
let CFG = null;      // config snapshot from main
let STATUS = null;   // last node-status snapshot

const onBitcoinNet = () => CFG && /^(bitcoin|testnet|signet|regtest)/.test(CFG.activeNetwork || '');
const assetLabel = (id) => !id ? (onBitcoinNet() ? 'BTC' : 'fee asset') : (KNOWN_ASSETS[id] || (id.slice(0, 8) + '…'));
const fmtAtoms = (msat) => Number((BigInt(msat || 0) / 1000n)).toLocaleString('en-US');
const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };

async function reloadCfg() { CFG = await window.fulmen.getConfig(); return CFG; }

// --- navigation --------------------------------------------------------------
$$('.nav').forEach(b => b.addEventListener('click', () => {
  $$('.nav').forEach(x => x.classList.toggle('active', x === b));
  $$('.view').forEach(v => v.classList.toggle('active', v.dataset.view === b.dataset.view));
  if (b.dataset.view === 'overview') loadOverview();
  if (b.dataset.view === 'channels') loadChannels();
  if (b.dataset.view === 'pay') loadAssets();
  if (b.dataset.view === 'settings') renderManagedNodes();
}));
$('#ov-refresh').addEventListener('click', () => loadOverview());
$('#ch-refresh').addEventListener('click', () => loadChannels());

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

// --- network switcher ---------------------------------------------------------
function renderNetSwitch() {
  const box = $('#netswitch'); box.innerHTML = '';
  if (!CFG || CFG.mode !== 'managed') return;
  const enabled = Object.entries(CFG.nodes || {}).filter(([, e]) => e.enabled).map(([n]) => n);
  if (enabled.length < 2) return;
  for (const n of enabled) {
    const meta = (CFG.networksMeta || {})[n] || { label: n };
    const b = el('button', 'netpill' + (CFG.activeNetwork === n ? ' active' : ''), meta.label);
    const st = (STATUS && STATUS.networks && STATUS.networks[n]) || {};
    b.appendChild(el('span', 'netdot ' + (st.running ? 'on' : 'off')));
    b.addEventListener('click', async () => {
      await window.fulmen.setActiveNetwork(n);
      await reloadCfg();
      renderNetSwitch();
      loadOverview();
    });
    box.appendChild(b);
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
    updateSyncLine(info);

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
      card.appendChild(el('div', 'asset', assetLabel(a)));
      card.appendChild(el('div', 'total', fmtAtoms(total)));
      card.appendChild(el('div', 'split', `${fmtAtoms(b.channel)} in channels · ${fmtAtoms(b.onchain)} on-chain`));
      card.title = a || '';
      grid.appendChild(card);
    }
  } catch (e) { $('#ov-err').textContent = String(e.message || e); }
}

// Sync progress: node height vs backend chain height (managed nodes only).
async function updateSyncLine(info) {
  const line = $('#ov-sync');
  try {
    if (!CFG || CFG.mode !== 'managed') { line.hidden = true; return; }
    const target = await window.fulmen.backendHeight(CFG.activeNetwork);
    const h = info.blockheight || 0;
    if (target > 0 && h < target - 1) {
      line.hidden = false;
      $('#ov-syncfill').style.width = Math.min(100, Math.round(h / target * 100)) + '%';
      $('#ov-synctext').textContent = `syncing ${h.toLocaleString('en-US')} / ${target.toLocaleString('en-US')}`;
    } else line.hidden = true;
  } catch { line.hidden = true; }
}

// --- channels ----------------------------------------------------------------
async function loadChannels() {
  $('#ch-err').textContent = '';
  try {
    await refreshConn();
    const chans = await rpc('listpeerchannels');
    const rows = chans.channels || [];
    const body = $('#ch-body'); body.innerHTML = '';
    for (const c of rows) {
      const tr = el('tr');
      tr.appendChild(el('td', 'mono', (c.peer_id || '').slice(0, 14) + '…'));
      tr.appendChild(el('td', 'mono', c.short_channel_id || '—'));
      const at = el('td'); const aid = c.channel_asset || '';
      const pill = el('span', 'pill asset', assetLabel(aid)); pill.title = aid || '';
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
    sel.innerHTML = '<option value="">Fee/policy asset</option>';
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

// --- settings: managed node cards ---------------------------------------------
function backendFromInputs(root) {
  return {
    host: $('.mn-host', root).value.trim() || '127.0.0.1',
    port: Number($('.mn-port', root).value.trim()) || undefined,
    user: $('.mn-user', root).value.trim(),
    pass: $('.mn-pass', root).value,
  };
}

function renderManagedNodes() {
  const wrap = $('#managed-nodes'); wrap.innerHTML = '';
  if (!CFG) return;
  if (!CFG.bundled) {
    const p = el('div', 'panel');
    p.appendChild(el('div', 'hint', 'This build has no bundled SeqLN runtime. Use the advanced options below to connect to a node you run yourself.'));
    wrap.appendChild(p);
    return;
  }
  for (const [network, meta] of Object.entries(CFG.networksMeta || {})) {
    const entry = (CFG.nodes || {})[network] || {};
    const st = (STATUS && STATUS.networks && STATUS.networks[network]) || {};
    const p = el('div', 'panel mn'); p.dataset.network = network;

    const head = el('div', 'mn-head');
    head.appendChild(el('b', null, meta.label));
    const stat = el('span', 'muted mn-stat');
    stat.textContent = st.starting ? 'starting…' : st.running ? 'running (pid ' + st.pid + ')' : (st.lastError ? 'stopped: ' + st.lastError : 'stopped');
    head.appendChild(stat);
    p.appendChild(head);

    if (network !== 'sequentia-testnet') {
      const optRow = el('label', 'ob-opt');
      const cb = el('input'); cb.type = 'checkbox'; cb.checked = !!entry.enabled; cb.className = 'mn-enable';
      optRow.appendChild(cb);
      optRow.appendChild(document.createTextNode(' Run this node (optional). SeqLN works on Bitcoin too; with both nodes running you are set up for asset↔BTC Lightning swaps.'));
      p.appendChild(optRow);
    }

    p.appendChild(el('label', 'lbl', meta.backendName + ' RPC'));
    const r1 = el('div', 'form-row');
    const host = el('input', 'mn-host'); host.placeholder = 'host (127.0.0.1)'; host.value = (entry.backend || {}).host || '';
    const port = el('input', 'mn-port'); port.placeholder = 'port (' + meta.defaultPort + ')'; port.value = (entry.backend || {}).port || ''; port.style.flex = '0 0 120px';
    r1.appendChild(host); r1.appendChild(port); p.appendChild(r1);
    const r2 = el('div', 'form-row');
    const user = el('input', 'mn-user'); user.placeholder = 'rpcuser (blank = cookie auth)'; user.value = (entry.backend || {}).user || '';
    const pass = el('input', 'mn-pass'); pass.type = 'password'; pass.placeholder = 'rpcpassword'; pass.value = (entry.backend || {}).pass || '';
    r2.appendChild(user); r2.appendChild(pass); p.appendChild(r2);

    const r3 = el('div', 'form-row');
    const bTest = el('button', 'ghost', 'Test connection');
    const bSave = el('button', 'ghost', 'Save');
    const bStart = el('button', 'primary', st.running ? 'Restart' : 'Start');
    const bStop = el('button', 'ghost', 'Stop');
    const bLogs = el('button', 'ghost', 'Logs');
    const bBackup = el('button', 'ghost', 'Back up wallet');
    r3.appendChild(bTest); r3.appendChild(bSave); r3.appendChild(bStart); r3.appendChild(bStop); r3.appendChild(bLogs); r3.appendChild(bBackup);
    p.appendChild(r3);
    const msg = el('div', 'msg'); p.appendChild(msg);

    const save = async () => {
      await window.fulmen.setNodeSettings(network, {
        enabled: network === 'sequentia-testnet' ? true : $('.mn-enable', p).checked,
        backend: backendFromInputs(p),
      });
      await reloadCfg();
    };
    bSave.addEventListener('click', async () => { await save(); msg.className = 'msg ok'; msg.textContent = 'Saved.'; renderNetSwitch(); });
    bTest.addEventListener('click', async () => {
      msg.className = 'msg'; msg.textContent = 'Testing…';
      try {
        const r = await window.fulmen.testBackend(network, backendFromInputs(p));
        msg.className = 'msg ok'; msg.textContent = `Reached ${meta.backendName}: chain ${r.chain}, ${r.blocks.toLocaleString('en-US')} blocks${r.ibd ? ' (still syncing)' : ''}.`;
      } catch (e) { msg.className = 'msg bad'; msg.textContent = 'Cannot reach it: ' + String(e.message || e); }
    });
    bStart.addEventListener('click', async () => {
      msg.className = 'msg'; msg.textContent = 'Starting…';
      try {
        await save();
        await window.fulmen.setMode('managed');
        if (st.running) await window.fulmen.nodeStop(network);
        await window.fulmen.nodeStart(network);
        msg.className = 'msg ok'; msg.textContent = 'Running.';
        await refreshNodeStatus(); renderManagedNodes(); refreshConn();
      } catch (e) { msg.className = 'msg bad'; msg.textContent = String(e.message || e); }
    });
    bStop.addEventListener('click', async () => {
      msg.textContent = 'Stopping…';
      try { await window.fulmen.nodeStop(network); } catch {}
      await refreshNodeStatus(); renderManagedNodes();
    });
    bLogs.addEventListener('click', () => openLogs(network, meta.label));
    bBackup.addEventListener('click', () => openBackup(network));
    wrap.appendChild(p);
  }
}

// --- logs modal -----------------------------------------------------------------
let logsTimer = null;
function openLogs(network, label) {
  $('#logs-title').textContent = label + ' log';
  $('#logs-modal').hidden = false;
  const tick = async () => {
    try {
      const lines = await window.fulmen.nodeLogs(network);
      const pre = $('#logs-pre');
      const stick = pre.scrollTop + pre.clientHeight >= pre.scrollHeight - 8;
      pre.textContent = lines.join('\n') || '(no output yet)';
      if (stick) pre.scrollTop = pre.scrollHeight;
    } catch {}
  };
  tick();
  logsTimer = setInterval(tick, 2000);
}
$('#logs-close').addEventListener('click', () => { $('#logs-modal').hidden = true; clearInterval(logsTimer); });

// --- backup modal -----------------------------------------------------------------
async function openBackup(network) {
  const info = await window.fulmen.hsmInfo(network);
  $('#backup-dir').textContent = info.dir;
  $('#backup-note').textContent = info.wsl
    ? 'Your node runs inside WSL2. Paste the folder path above into the Windows Explorer address bar to reach it.'
    : (info.exists ? '' : 'The wallet file appears after the node has started once.');
  const btn = $('#backup-reveal');
  btn.onclick = () => { if (!info.wsl) window.fulmen.revealPath(info.hsmPath); };
  btn.hidden = !!info.wsl;
  $('#backup-modal').hidden = false;
}
$('#backup-close').addEventListener('click', () => { $('#backup-modal').hidden = true; });

// --- settings: advanced (external node) -------------------------------------------
$('#set-save').addEventListener('click', async () => {
  const msg = $('#set-msg'); msg.className = 'msg';
  try {
    await window.fulmen.setSocket($('#set-sock').value);
    await reloadCfg();
    await refreshConn();
    msg.className = 'msg ok'; msg.textContent = 'Connected.';
    loadOverview();
  } catch (e) { msg.className = 'msg bad'; msg.textContent = 'Saved, but: ' + String(e.message || e); }
});
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
    await reloadCfg();
    await refreshConn(); msg.className = 'msg ok'; msg.textContent = 'Connected.'; loadOverview();
  } catch (e) { msg.className = 'msg bad'; msg.textContent = String(e.message || e); }
});

// --- node status polling -----------------------------------------------------------
async function refreshNodeStatus() {
  try {
    STATUS = await window.fulmen.nodeStatus();
    renderNetSwitch();
    const view = $('.view[data-view="settings"]');
    if (view.classList.contains('active')) {
      for (const p of $$('#managed-nodes .mn')) {
        const st = (STATUS.networks || {})[p.dataset.network] || {};
        const stat = $('.mn-stat', p);
        if (stat) stat.textContent = st.starting ? 'starting…' : st.running ? 'running (pid ' + st.pid + ')' : (st.lastError ? 'stopped: ' + st.lastError : 'stopped');
      }
    }
  } catch {}
}

// --- onboarding ---------------------------------------------------------------------
function obShow(step) {
  $$('#onboard .ob-step').forEach(s => { s.hidden = s.dataset.step !== String(step); });
}
function obBackend(prefix) {
  return {
    host: $(`#ob-${prefix}-host`).value.trim() || '127.0.0.1',
    port: Number($(`#ob-${prefix}-port`).value.trim()) || (prefix === 'seq' ? 18332 : 48332),
    user: $(`#ob-${prefix}-user`).value.trim(),
    pass: $(`#ob-${prefix}-pass`).value,
  };
}
async function obTest(prefix, network) {
  const msg = $(`#ob-${prefix}-msg`); msg.className = 'msg'; msg.textContent = 'Testing…';
  try {
    const r = await window.fulmen.testBackend(network, obBackend(prefix));
    msg.className = 'msg ok'; msg.textContent = `Connected: chain ${r.chain}, ${r.blocks.toLocaleString('en-US')} blocks${r.ibd ? ' (still syncing)' : ''}.`;
    return true;
  } catch (e) { msg.className = 'msg bad'; msg.textContent = 'Cannot reach it: ' + String(e.message || e); return false; }
}

let obPollTimer = null;
async function obStartNodes() {
  obShow(3);
  $('#ob-err').textContent = ''; $('#ob-retry').hidden = true; $('#ob-back2').hidden = true;
  $('#ob-stat').textContent = 'starting…';
  const network = 'sequentia-testnet';
  try {
    await window.fulmen.setNodeSettings(network, { enabled: true, backend: obBackend('seq') });
    const btcOn = $('#ob-btc-enable').checked;
    await window.fulmen.setNodeSettings('testnet4', { enabled: btcOn, backend: obBackend('btc') });
    await window.fulmen.setMode('managed');
    const startBtc = btcOn ? window.fulmen.nodeStart('testnet4').catch(() => {}) : null;
    const poll = setInterval(async () => {
      try {
        const lines = await window.fulmen.nodeLogs(network);
        const pre = $('#ob-log'); pre.textContent = lines.slice(-12).join('\n'); pre.scrollTop = pre.scrollHeight;
      } catch {}
    }, 1200);
    obPollTimer = poll;
    await window.fulmen.nodeStart(network);   // resolves when lightning-rpc is up
    if (startBtc) await startBtc;
    $('#ob-stat').textContent = 'node running, checking sync…';
    // wait for first getinfo + show sync progress until close to backend tip
    for (;;) {
      try {
        const info = await rpc('getinfo');
        let target = 0;
        try { target = await window.fulmen.backendHeight(network); } catch {}
        const h = info.blockheight || 0;
        if (target > 0) {
          $('#ob-syncfill').style.width = Math.min(100, Math.round(h / target * 100)) + '%';
          $('#ob-synctext').textContent = `block ${h.toLocaleString('en-US')} of ${target.toLocaleString('en-US')}`;
          if (h >= target - 1) break;
        } else if (h > 0) break;
      } catch {}
      await new Promise(r => setTimeout(r, 1500));
    }
    clearInterval(poll);
    $('#ob-stat').textContent = 'synced';
    const hsm = await window.fulmen.hsmInfo(network);
    $('#ob-hsm-dir').textContent = hsm.dir;
    $('#ob-reveal').onclick = () => { if (!hsm.wsl) window.fulmen.revealPath(hsm.hsmPath); };
    $('#ob-reveal').hidden = !!hsm.wsl;
    obShow(4);
  } catch (e) {
    if (obPollTimer) clearInterval(obPollTimer);
    $('#ob-err').textContent = String(e.message || e);
    $('#ob-retry').hidden = false; $('#ob-back2').hidden = false;
  }
}

function wireOnboarding() {
  $('#ob-run').addEventListener('click', () => {
    const b = (CFG.nodes['sequentia-testnet'] || {}).backend || {};
    $('#ob-seq-host').value = b.host || '127.0.0.1';
    $('#ob-seq-port').value = b.port || 18332;
    $('#ob-seq-user').value = b.user || '';
    $('#ob-seq-pass').value = b.pass || '';
    obShow(2);
  });
  $('#ob-own').addEventListener('click', async () => {
    await window.fulmen.setMode('external');
    await window.fulmen.setOnboarded(true);
    await reloadCfg();
    $('#onboard').hidden = true;
    $$('.nav').find(x => x.dataset.view === 'settings').click();
  });
  $('#ob-back1').addEventListener('click', () => obShow(1));
  $('#ob-back2').addEventListener('click', () => obShow(2));
  $('#ob-seq-test').addEventListener('click', () => obTest('seq', 'sequentia-testnet'));
  $('#ob-btc-test').addEventListener('click', () => obTest('btc', 'testnet4'));
  $('#ob-btc-enable').addEventListener('change', (e) => { $('#ob-btc-form').hidden = !e.target.checked; });
  $('#ob-start').addEventListener('click', obStartNodes);
  $('#ob-retry').addEventListener('click', obStartNodes);
  $('#ob-done').addEventListener('click', async () => {
    await window.fulmen.setOnboarded(true);
    await reloadCfg();
    $('#onboard').hidden = true;
    renderNetSwitch();
    loadOverview();
  });
}

// --- boot ------------------------------------------------------------------------
(async () => {
  await reloadCfg();
  $('#set-sock').value = CFG.socket || '';
  const t = CFG.transport || {};
  $('#rest-host').value = t.host || '';
  $('#rest-port').value = t.port || '';
  if (t.protocol) $('#rest-proto').value = t.protocol;
  $('#rest-rune').value = t.rune || '';
  $('#about-version').textContent = 'Fulmen ' + (CFG.appVersion || '') + (CFG.bundled ? ', bundled SeqLN runtime' : '');
  wireOnboarding();
  renderManagedNodes();
  await refreshNodeStatus();
  setInterval(refreshNodeStatus, 5000);

  if (!CFG.onboarded && CFG.bundled) {
    $('#onboard').hidden = false;
    obShow(1);
    return;
  }
  try { await refreshConn(); loadOverview(); }
  catch {
    $('#ov-err').textContent = CFG.bundled
      ? 'Not connected yet. Open Settings to start your bundled SeqLN node.'
      : 'Not connected. In Settings, connect to your SeqLN node.';
  }
})();
