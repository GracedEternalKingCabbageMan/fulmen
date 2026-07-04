'use strict';
// Generate build/icon.png (512x512): gold lightning bolt on a dark rounded
// square, matching the app theme. Pure Node (zlib PNG encoder), no imagemagick.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT = path.join(__dirname, 'icon.png');
const S = 512, SS = 2, W = S * SS; // 2x supersample for clean edges

// theme
const BG = [0x12, 0x16, 0x1c], BORDER = [0x26, 0x2b, 0x33], GOLD = [0xf5, 0xb3, 0x01];

// bolt polygon in 0..512 space (stylized ⚡, slightly left-leaning)
const BOLT = [[300, 58], [148, 296], [238, 296], [196, 454], [372, 210], [274, 210], [340, 58]].map(([x, y]) => [x * SS, y * SS]);

function inPoly(px, py, poly) {
  let odd = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) odd = !odd;
  }
  return odd;
}

// 1. masks at supersample resolution
const R = 100 * SS, RIM = 6 * SS;
const rr = (x, y) => { // signed distance-ish inside rounded rect [0..W]
  const cx = Math.max(R, Math.min(W - R, x)), cy = Math.max(R, Math.min(W - R, y));
  return Math.hypot(x - cx, y - cy) <= R;
};
const boltMask = new Float32Array(W * W);
const rectMask = new Uint8Array(W * W);
for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
  const i = y * W + x;
  rectMask[i] = rr(x, y) ? 1 : 0;
  boltMask[i] = inPoly(x + 0.5, y + 0.5, BOLT) ? 1 : 0;
}
// 2. glow = blurred bolt mask (3 box-blur passes, radius 10*SS)
function boxBlur(src, r) {
  const dst = new Float32Array(W * W);
  for (let y = 0; y < W; y++) { // horizontal
    let acc = 0;
    for (let x = -r; x <= r; x++) acc += src[y * W + Math.max(0, Math.min(W - 1, x))];
    for (let x = 0; x < W; x++) {
      dst[y * W + x] = acc / (2 * r + 1);
      const add = Math.min(W - 1, x + r + 1), sub = Math.max(0, x - r);
      acc += src[y * W + add] - src[y * W + sub];
    }
  }
  const out = new Float32Array(W * W);
  for (let x = 0; x < W; x++) { // vertical
    let acc = 0;
    for (let y = -r; y <= r; y++) acc += dst[Math.max(0, Math.min(W - 1, y)) * W + x];
    for (let y = 0; y < W; y++) {
      out[y * W + x] = acc / (2 * r + 1);
      const add = Math.min(W - 1, y + r + 1), sub = Math.max(0, y - r);
      acc += dst[add * W + x] - dst[sub * W + x];
    }
  }
  return out;
}
let glow = boltMask;
for (let k = 0; k < 3; k++) glow = boxBlur(glow, 10 * SS);

// 3. composite at full res, then downsample to 512
const img = Buffer.alloc(S * S * 4);
for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
  let r = 0, g = 0, b = 0, a = 0;
  for (let dy = 0; dy < SS; dy++) for (let dx = 0; dx < SS; dx++) {
    const X = x * SS + dx, Y = y * SS + dy, i = Y * W + X;
    if (!rectMask[i]) continue;
    // border ring
    const nearEdge = !(rr(X - RIM, Y) && rr(X + RIM, Y) && rr(X, Y - RIM) && rr(X, Y + RIM));
    let cr = nearEdge ? BORDER[0] : BG[0], cg = nearEdge ? BORDER[1] : BG[1], cb = nearEdge ? BORDER[2] : BG[2];
    const gl = Math.min(1, glow[i] * 1.15);
    cr = cr + (GOLD[0] - cr) * gl * 0.55; cg = cg + (GOLD[1] - cg) * gl * 0.55; cb = cb + (GOLD[2] - cb) * gl * 0.55;
    if (boltMask[i]) { cr = GOLD[0]; cg = GOLD[1]; cb = GOLD[2]; }
    r += cr; g += cg; b += cb; a += 255;
  }
  const n = SS * SS, o = (y * S + x) * 4;
  img[o] = r / n; img[o + 1] = g / n; img[o + 2] = b / n; img[o + 3] = a / n;
}

// 4. PNG encode
const crcTable = [];
for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcTable[n] = c >>> 0; }
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(S, 0); ihdr.writeUInt32BE(S, 4); ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
const raw = Buffer.alloc(S * (S * 4 + 1));
for (let y = 0; y < S; y++) { raw[y * (S * 4 + 1)] = 0; img.copy(raw, y * (S * 4 + 1) + 1, y * S * 4, (y + 1) * S * 4); }
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);
fs.writeFileSync(OUT, png);
console.log(`wrote ${OUT} (${png.length} bytes)`);
