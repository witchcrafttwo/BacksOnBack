import * as C from './config.js';
import { isMuted } from './audio.js';
import { BAG_BY_KEY } from './bags.js';
import { bagOutline, tracePath } from './shapes.js';

// ------------------------------------------------------------------ 小道具

function rr(ctx, x, y, w, h, r) {
  const rad = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.lineTo(x + w - rad, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rad);
  ctx.lineTo(x + w, y + h - rad);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
  ctx.lineTo(x + rad, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rad);
  ctx.lineTo(x, y + rad);
  ctx.quadraticCurveTo(x, y, x + rad, y);
  ctx.closePath();
}

function panel(ctx, x, y, w, h, r, fill, stroke) {
  rr(ctx, x, y, w, h, r);
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

function text(ctx, str, x, y, opts = {}) {
  const {
    size = 16,
    weight = '600',
    color = '#fff',
    align = 'left',
    baseline = 'alphabetic',
    font = C.FONT_UI,
    shadow = 0,
    letter = 0,
  } = opts;
  ctx.save();
  ctx.font = `${weight} ${size}px ${font}`;
  ctx.textAlign = align;
  ctx.textBaseline = baseline;
  if (letter && 'letterSpacing' in ctx) ctx.letterSpacing = `${letter}px`;
  if (shadow) {
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillText(str, x + shadow, y + shadow);
  }
  ctx.fillStyle = color;
  ctx.fillText(str, x, y);
  ctx.restore();
}

const hex = (h) => [
  parseInt(h.slice(1, 3), 16),
  parseInt(h.slice(3, 5), 16),
  parseInt(h.slice(5, 7), 16),
];
function mix(a, b, t) {
  const A = hex(a);
  const B = hex(b);
  return `rgb(${Math.round(C.lerp(A[0], B[0], t))},${Math.round(C.lerp(A[1], B[1], t))},${Math.round(
    C.lerp(A[2], B[2], t),
  )})`;
}

// ------------------------------------------------------------------ 背景

const CLOUDS = Array.from({ length: 16 }, (_, i) => ({
  x: C.rand(-40, C.VIEW.W + 40),
  y: C.GROUND_Y - 260 - i * 190 - C.rand(0, 90),
  s: C.rand(0.55, 1.5),
  a: C.rand(0.1, 0.3),
  drift: C.rand(-6, 6),
}));

const STARS = Array.from({ length: 90 }, () => ({
  x: C.rand(0, C.VIEW.W),
  y: C.rand(-2600, C.GROUND_Y - 300),
  r: C.rand(0.6, 1.8),
  tw: C.rand(0, Math.PI * 2),
}));

function drawSky(ctx, game) {
  const t = C.clamp(game.world.heightPx / 2200, 0, 1);
  const top = mix('#3f5fa0', '#070b20', t);
  const mid = mix('#93b0de', '#182a58', t);
  const bot = mix('#f8cd9a', '#3c5490', t);
  const grd = ctx.createLinearGradient(0, 0, 0, C.VIEW.H);
  grd.addColorStop(0, top);
  grd.addColorStop(0.55, mid);
  grd.addColorStop(1, bot);
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, C.VIEW.W, C.VIEW.H);

  // 星(高いところで見えてくる)
  if (t > 0.12) {
    ctx.save();
    const now = game.time / 600;
    for (const s of STARS) {
      const sy = s.y + game.camY * 0.55;
      if (sy < -10 || sy > C.VIEW.H) continue;
      ctx.globalAlpha = C.clamp((t - 0.12) * 1.4, 0, 1) * (0.5 + 0.5 * Math.sin(now + s.tw));
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(s.x, sy, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // 雲(視差つき)
  ctx.save();
  for (const c of CLOUDS) {
    const cy = c.y + game.camY * 0.6;
    if (cy < -80 || cy > C.VIEW.H + 80) continue;
    const cx = c.x + Math.sin(game.time / 9000 + c.y) * c.drift;
    ctx.globalAlpha = c.a * (1 - t * 0.55);
    ctx.fillStyle = '#ffffff';
    const w = 70 * c.s;
    const h = 22 * c.s;
    ctx.beginPath();
    ctx.ellipse(cx, cy, w, h, 0, 0, Math.PI * 2);
    ctx.ellipse(cx - w * 0.5, cy + h * 0.3, w * 0.5, h * 0.7, 0, 0, Math.PI * 2);
    ctx.ellipse(cx + w * 0.45, cy + h * 0.25, w * 0.55, h * 0.75, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawHeightLines(ctx, game) {
  ctx.save();
  ctx.lineWidth = 1;
  ctx.strokeStyle = '#ffffff';
  // 0.5m ごとに点線、1m ごとにラベル
  const half = C.PX_PER_M / 2;
  const first = Math.max(1, Math.floor(game.camY / half));
  const last = Math.ceil((game.camY + C.GROUND_Y) / half) + 1;
  for (let i = first; i <= last; i++) {
    const sy = C.GROUND_Y - i * half + game.camY;
    if (sy < 80 || sy > C.FOOTER_Y) continue;
    const whole = i % 2 === 0;
    ctx.globalAlpha = whole ? 0.22 : 0.1;
    ctx.setLineDash(whole ? [10, 6] : [3, 9]);
    ctx.beginPath();
    ctx.moveTo(0, sy);
    ctx.lineTo(C.VIEW.W, sy);
    ctx.stroke();
    if (whole) {
      ctx.globalAlpha = 0.5;
      text(ctx, `${i / 2}m`, C.VIEW.W - 8, sy - 5, { size: 12, color: '#fff', align: 'right' });
    }
  }
  ctx.setLineDash([]);

  // このプレイの最高到達点
  const rec = game.world.maxHeightPx;
  if (game.state !== 'title' && rec > 40) {
    const sy = C.GROUND_Y - rec + game.camY;
    if (sy > 80 && sy < C.FOOTER_Y) {
      ctx.globalAlpha = 0.7;
      ctx.strokeStyle = '#ffd35c';
      ctx.setLineDash([8, 6]);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, sy);
      ctx.lineTo(62, sy);
      ctx.stroke();
      ctx.setLineDash([]);
      text(ctx, `最高 ${(rec / C.PX_PER_M).toFixed(1)}m`, 6, sy - 5, { size: 11, color: '#ffd35c', weight: '700' });
    }
  }
  ctx.restore();
}

function drawWindStreaks(ctx, game) {
  const w = game.world.wind;
  if (Math.abs(w.x) < 0.08) return;
  ctx.save();
  ctx.globalAlpha = C.clamp(Math.abs(w.x) * 0.5, 0, 0.4);
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2;
  const dir = Math.sign(w.x);
  for (let i = 0; i < 12; i++) {
    const seed = i * 97.13;
    const y = ((game.time * (0.02 + (i % 3) * 0.01) + seed * 7) % (C.FOOTER_Y + 80)) - 40;
    const len = 24 + ((seed * 13) % 40);
    const x = (((game.time * (0.28 + (i % 4) * 0.07) * dir + seed * 31) % (C.VIEW.W + 200)) + C.VIEW.W + 200) %
      (C.VIEW.W + 200) - 100;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + len * dir, y + 3);
    ctx.stroke();
  }
  ctx.restore();
}

// ------------------------------------------------------------------ 土台

/** 土台の巨大トランク(物理の台と同じ大きさ) */
const BASE_TRUNK = {
  style: 'trunk',
  w: C.PLATFORM_W,
  h: C.PLATFORM_H,
  r: 8,
  body: '#9b6540',
  shade: '#6e4329',
  trim: '#e2b75a', // 真鍮
  zip: '#5b3620', // 革ベルト
};

/** トランクの下に積まれた巨大バッグ(飾り。当たり判定なし)。下から順に描く */
const PILE_DUFFEL_H = 86;
const BASE_PILE = [
  {
    def: { ...BAG_BY_KEY.suitcase, w: 200, h: 210, r: 20 },
    x: C.VIEW.W / 2 + 8,
    y: C.GROUND_Y + C.PLATFORM_H + PILE_DUFFEL_H - 6 - 14 + 105,
    a: 0.015,
  },
  {
    def: { ...BAG_BY_KEY.duffel, w: 272, h: PILE_DUFFEL_H, r: 38 },
    x: C.VIEW.W / 2 - 4,
    y: C.GROUND_Y + C.PLATFORM_H + PILE_DUFFEL_H / 2 - 6,
    a: -0.025,
  },
];

function drawBase(ctx, game) {
  for (const p of BASE_PILE) {
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.a);
    drawBagArt(ctx, p.def, null);
    ctx.restore();
  }
  // 強く着地されると少しだけ弾む(上面の位置は変えない)
  const sq = game.world.platform.plugin.g.squash;
  ctx.save();
  ctx.translate(C.VIEW.W / 2, C.GROUND_Y);
  ctx.scale(1 + sq * 0.03, 1 - sq * 0.06);
  ctx.translate(0, C.PLATFORM_H / 2);
  drawBagArt(ctx, BASE_TRUNK, null);
  ctx.restore();
}

// ------------------------------------------------------------------ つめこみモードのスーツケース

/** 箱の種類ごとの色(外殻・内張り・案内の文字) */
const BIN_LOOK = {
  normal: { body: '#f08a4b', light: '#ffb27a', shade: '#b9572a', lining: ['#41466f', '#262a47'], accent: '#ffb27a' },
  carryon: { body: '#4f8fe0', light: '#8cbcf3', shade: '#2f5fa8', lining: ['#3c566c', '#213345'], accent: '#8cbcf3' },
  fragile: { body: '#e2584d', light: '#ff8f86', shade: '#a8362e', lining: ['#553f5c', '#33233a'], accent: '#ff8f86' },
};
const BIN_SHELL = BIN_LOOK.normal;

/** 後ろ側: 内張り(バッグより先に描く) */
function drawBinBack(ctx, bin) {
  const look = BIN_LOOK[bin.type] ?? BIN_LOOK.normal;
  const x = bin.L;
  const y = bin.wallTop;
  const w = bin.R - bin.L;
  const h = bin.floor - bin.wallTop;
  const grd = ctx.createLinearGradient(0, y, 0, y + h);
  grd.addColorStop(0, look.lining[0]);
  grd.addColorStop(1, look.lining[1]);
  ctx.fillStyle = grd;
  ctx.fillRect(x, y, w, h);
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  // 布の織り目
  ctx.strokeStyle = 'rgba(255,255,255,0.045)';
  ctx.lineWidth = 1;
  for (let i = -h; i < w; i += 14) {
    ctx.beginPath();
    ctx.moveTo(x + i, y + h);
    ctx.lineTo(x + i + h, y);
    ctx.stroke();
  }
  // 荷物おさえのクロスベルト(飾り)
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 12;
  ctx.beginPath();
  ctx.moveTo(x + 14, y + 70);
  ctx.lineTo(x + w - 14, y + h - 24);
  ctx.moveTo(x + w - 14, y + 70);
  ctx.lineTo(x + 14, y + h - 24);
  ctx.stroke();
  // 割れ物注意のスタンプ
  if (bin.type === 'fragile') {
    ctx.translate(x + w / 2, y + h * 0.62);
    ctx.rotate(-0.12);
    ctx.globalAlpha = 0.2;
    ctx.strokeStyle = '#ff8f86';
    ctx.lineWidth = 4;
    rr(ctx, -120, -36, 240, 72, 10);
    ctx.stroke();
    text(ctx, '割れ物注意', 0, -2, { size: 30, weight: '800', color: '#ff8f86', align: 'center' });
    text(ctx, 'FRAGILE', 0, 26, { size: 18, weight: '800', color: '#ff8f86', align: 'center', letter: 4 });
  }
  ctx.restore();
}

/** 箱の外にぶら下げる荷札 */
function drawBinTag(ctx, x, y, angle, label, color) {
  ctx.strokeStyle = 'rgba(255,246,230,0.8)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + Math.sin(-angle) * 10, y + 12);
  ctx.stroke();
  ctx.save();
  ctx.translate(x + Math.sin(-angle) * 14, y + 26);
  ctx.rotate(angle);
  ctx.fillStyle = '#f4ead2';
  rr(ctx, -22, -12, 44, 24, 4);
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.stroke();
  text(ctx, label, 0, 1, { size: 11, weight: '800', color, align: 'center', baseline: 'middle' });
  ctx.restore();
}

/**
 * 前側: 外殻とファスナーの線(バッグのあとに描く)。
 * shellOnly: 外殻だけ(出荷中の箱や、タイトル・ゲームオーバー画面の背景)
 */
function drawBinFront(ctx, game, bin, { shellOnly = false } = {}) {
  const look = BIN_LOOK[bin.type] ?? BIN_LOOK.normal;
  const L = bin.L;
  const R = bin.R;
  const T = bin.wallTop;
  const F = bin.floor;
  const W = bin.wall;
  const B = F + bin.floorH; // 外側の底
  const rt = 7; // 壁の上の丸み
  const rb = 16; // 外側の底の角
  ctx.save();
  // U字の外殻
  ctx.beginPath();
  ctx.moveTo(L - W, T + rt);
  ctx.arcTo(L - W, T, L - W + rt, T, rt);
  ctx.arcTo(L, T, L, T + rt, rt);
  ctx.lineTo(L, F);
  ctx.lineTo(R, F);
  ctx.lineTo(R, T + rt);
  ctx.arcTo(R, T, R + rt, T, rt);
  ctx.arcTo(R + W, T, R + W, T + rt, rt);
  ctx.lineTo(R + W, B - rb);
  ctx.arcTo(R + W, B, R + W - rb, B, rb);
  ctx.lineTo(L - W + rb, B);
  ctx.arcTo(L - W, B, L - W, B - rb, rb);
  ctx.closePath();
  const grd = ctx.createLinearGradient(0, T, 0, B);
  grd.addColorStop(0, look.light);
  grd.addColorStop(0.35, look.body);
  grd.addColorStop(1, look.shade);
  ctx.fillStyle = grd;
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.28)';
  ctx.lineWidth = 2;
  ctx.stroke();
  // 内側のふちの光
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(L - 2, T + 10);
  ctx.lineTo(L - 2, F - 2);
  ctx.lineTo(R + 2, F - 2);
  ctx.lineTo(R + 2, T + 10);
  ctx.stroke();
  // 底の角の金具
  ctx.fillStyle = '#dfe6ef';
  for (const [cx, sx] of [
    [L - W, 1],
    [R + W, -1],
  ]) {
    ctx.beginPath();
    ctx.moveTo(cx, B - 26);
    ctx.lineTo(cx, B - rb);
    ctx.arcTo(cx, B, cx + sx * rb, B, rb);
    ctx.lineTo(cx + sx * 26, B);
    ctx.lineTo(cx + sx * 26, B - 5);
    ctx.lineTo(cx + sx * 9, B - 5);
    ctx.arcTo(cx + sx * 5, B - 5, cx + sx * 5, B - 9, 4);
    ctx.lineTo(cx + sx * 5, B - 26);
    ctx.closePath();
    ctx.fill();
  }

  // 箱の種類の荷札
  if (bin.type === 'carryon') drawBinTag(ctx, R + W - 2, T + 30, -0.18, '機内OK', '#2f5fa8');
  else if (bin.type === 'fragile') drawBinTag(ctx, L - W + 2, T + 30, 0.18, '割れ物', '#a8362e');

  // タイトル・ゲームオーバー画面や出荷中は、外殻だけ
  if (shellOnly || game.state === 'title' || game.state === 'over') {
    ctx.restore();
    return;
  }

  // ファスナーの線(ここより上にはみ出したらフタが閉まらない)
  const warn = game.overflowTime > 0 && game.state !== 'over';
  const blink = warn ? 0.55 + 0.45 * Math.sin(game.time / 70) : 1;
  const y = bin.limit;
  ctx.globalAlpha = warn ? blink : 0.7;
  ctx.strokeStyle = warn ? '#ff5a4a' : '#ffe9c4';
  ctx.lineWidth = 2;
  ctx.setLineDash([10, 6]);
  ctx.beginPath();
  ctx.moveTo(L + 2, y);
  ctx.lineTo(R - 2, y);
  ctx.stroke();
  ctx.setLineDash([]);
  // ファスナーのつまみ
  ctx.fillStyle = warn ? '#ff5a4a' : '#ffe9c4';
  rr(ctx, L + 4, y - 5, 12, 10, 3);
  ctx.fill();
  rr(ctx, L + 8, y + 3, 5, 12, 2);
  ctx.fill();
  ctx.globalAlpha = 1;
  text(ctx, 'ファスナー ここまで', R - 6, y - 7, {
    size: 11,
    weight: '700',
    color: warn ? '#ff8a7a' : 'rgba(255,233,196,0.8)',
    align: 'right',
  });

  // はみ出し警告
  if (warn) {
    const left = Math.max(0, (C.OVERFLOW_TIME - game.overflowTime) / 1000);
    ctx.globalAlpha = blink;
    panel(ctx, C.VIEW.W / 2 - 110, T - 52, 220, 34, 17, 'rgba(40,10,14,0.85)', '#ff6b5a');
    text(ctx, `はみ出してる！ あと ${left.toFixed(1)}秒`, C.VIEW.W / 2, T - 29, {
      size: 15,
      weight: '800',
      color: '#ffb0a4',
      align: 'center',
    });
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

/** 出荷するときに上から閉まるフタ。p = 0(上の方) → 1(閉まった) */
function drawLid(ctx, bin, p, ok) {
  const look = BIN_LOOK[bin.type] ?? BIN_LOOK.normal;
  const x = bin.L - bin.wall;
  const w = bin.R - bin.L + bin.wall * 2;
  const h = 30;
  // 失敗したときは中身がつかえて、フタが少し浮いたまま斜めになる
  const closedY = bin.wallTop - h + (ok ? 4 : -14);
  const y = closedY - (1 - p) * 360;
  ctx.save();
  ctx.translate(x + w / 2, y + h / 2);
  if (!ok) ctx.rotate(-0.06 * p);
  // 持ち手
  ctx.strokeStyle = look.shade;
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.arc(0, -h / 2 + 2, 26, Math.PI * 1.08, Math.PI * 1.92);
  ctx.stroke();
  // フタ
  const grd = ctx.createLinearGradient(0, -h / 2, 0, h / 2);
  grd.addColorStop(0, look.light);
  grd.addColorStop(1, look.body);
  ctx.fillStyle = grd;
  rr(ctx, -w / 2, -h / 2, w, h, 12);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.28)';
  ctx.lineWidth = 2;
  ctx.stroke();
  // ファスナー(閉まるにつれて左から右へ)
  const zp = C.clamp((p - 0.55) / 0.45, 0, 1);
  if (zp > 0) {
    ctx.strokeStyle = '#ffe9c4';
    ctx.lineWidth = 2.5;
    const zx0 = -w / 2 + 10;
    const zx1 = zx0 + (w - 20) * zp;
    ctx.beginPath();
    ctx.moveTo(zx0, h / 2 - 3);
    ctx.lineTo(zx1, h / 2 - 3);
    ctx.stroke();
    ctx.fillStyle = '#ffe9c4';
    rr(ctx, zx1 - 5, h / 2 - 8, 10, 10, 3);
    ctx.fill();
  }
  ctx.restore();
  // 失敗の判子
  if (!ok && p > 0.6) {
    ctx.save();
    ctx.translate(C.VIEW.W / 2, (bin.wallTop + bin.floor) / 2);
    ctx.rotate(-0.18);
    ctx.globalAlpha = Math.min(1, (p - 0.6) / 0.3) * 0.85;
    ctx.strokeStyle = '#ff5a4a';
    ctx.lineWidth = 6;
    rr(ctx, -110, -38, 220, 76, 12);
    ctx.stroke();
    text(ctx, 'やりなおし', 0, 12, { size: 34, weight: '800', color: '#ff5a4a', align: 'center' });
    ctx.restore();
  }
}

/** 出荷アニメーション: 古い箱が中身ごと右へ運ばれ、次の空の箱が左から来る */
function drawShip(ctx, game) {
  const s = game.ship;
  const p = game.shipProgress;
  const off = C.VIEW.W + 80;
  ctx.save();
  ctx.translate(p.out * p.out * off, 0);
  drawBinBack(ctx, s.bin);
  for (const b of s.bodies) {
    if (b.plugin.g.kind === 'bag') drawBag(ctx, b);
    else drawItem(ctx, b);
  }
  drawBinFront(ctx, game, s.bin, { shellOnly: true });
  drawLid(ctx, s.bin, p.close, s.ok);
  ctx.restore();
  if (p.in > 0) {
    ctx.save();
    ctx.translate(-(1 - p.in) * off, 0);
    drawBinBack(ctx, game.world.bin);
    drawBinFront(ctx, game, game.world.bin, { shellOnly: true });
    ctx.restore();
  }
}

/** 出荷の結果(得点 or 失敗)。運ばれていく箱の上に、出荷のあいだずっと出す */
function drawShipResult(ctx, game) {
  const s = game.ship;
  if (!s?.lines) return;
  const total = C.SHIP_CLOSE + C.SHIP_OUT + C.SHIP_IN;
  const a = Math.min(1, s.t / 150, (total - s.t) / 250);
  const h = 22 + s.lines.reduce((sum, [, , size]) => sum + size + 10, 0);
  const top = 150;
  ctx.save();
  ctx.globalAlpha = C.clamp(a, 0, 1);
  panel(ctx, C.VIEW.W / 2 - 150, top, 300, h, 18, 'rgba(14,18,38,0.9)', s.ok ? '#8ef0c9' : '#ff6b5a');
  let y = top + 14;
  for (const [str, color, size] of s.lines) {
    y += size + 6;
    text(ctx, str, C.VIEW.W / 2, y, { size, weight: '800', color, align: 'center' });
    y += 4;
  }
  ctx.restore();
}

/** 次の箱が来たときの案内(何箱目・種類・ノルマ) */
function drawBanner(ctx, game) {
  const bn = game.banner;
  if (!bn || !game.isPack || game.state === 'over' || game.state === 'ranking') return;
  const look = BIN_LOOK[bn.type] ?? BIN_LOOK.normal;
  const lines = bn.lines.filter(Boolean);
  const t = bn.maxLife - bn.life;
  const a = Math.min(1, t / 200, bn.life / 500);
  const bin = game.world.bin;
  const h = 26 + lines.length * 27;
  const top = (bin.wallTop + bin.floor) / 2 - h / 2 - 30;
  ctx.save();
  ctx.globalAlpha = a;
  panel(ctx, C.VIEW.W / 2 - 160, top, 320, h, 18, 'rgba(14,18,38,0.85)', look.accent);
  lines.forEach((s, i) => {
    const isQuota = s.startsWith('ノルマ ');
    text(ctx, s, C.VIEW.W / 2, top + 36 + i * 27, {
      size: i === 0 ? 24 : isQuota ? 17 : 13,
      weight: i === 0 || isQuota ? '800' : '700',
      color: i === 0 ? '#ffffff' : isQuota ? '#ffe08a' : look.accent,
      align: 'center',
    });
  });
  ctx.restore();
}

/** タイトル画面のカードに描く小さな絵(つみあげ / つめこみ) */
function drawModeIcon(ctx, mode, cx, cy) {
  ctx.save();
  ctx.translate(cx, cy);
  if (mode === 'stack') {
    ctx.scale(0.3, 0.3);
    ctx.save();
    ctx.translate(0, 34);
    drawBagArt(ctx, BAG_BY_KEY.duffel, null);
    ctx.restore();
    ctx.save();
    ctx.translate(4, -30);
    ctx.rotate(0.06);
    drawBagArt(ctx, BAG_BY_KEY.backpack, null);
    ctx.restore();
  } else {
    // 小さなスーツケースにバッグが入っている絵
    ctx.fillStyle = '#2d3254';
    ctx.fillRect(-30, -16, 60, 34);
    ctx.save();
    ctx.scale(0.26, 0.26);
    ctx.save();
    ctx.translate(-52, 30);
    drawBagArt(ctx, BAG_BY_KEY.backpack, null);
    ctx.restore();
    ctx.save();
    ctx.translate(56, 34);
    drawBagArt(ctx, BAG_BY_KEY.tote, null);
    ctx.restore();
    ctx.save();
    ctx.translate(2, -30);
    ctx.rotate(-0.1);
    drawBagArt(ctx, BAG_BY_KEY.pouch, null);
    ctx.restore();
    ctx.restore();
    ctx.fillStyle = BIN_SHELL.body;
    ctx.fillRect(-34, -18, 4, 40);
    ctx.fillRect(30, -18, 4, 40);
    ctx.fillRect(-34, 18, 68, 4);
    ctx.strokeStyle = '#ffe9c4';
    ctx.setLineDash([4, 3]);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(-28, -10);
    ctx.lineTo(28, -10);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.restore();
}

/** 丸い旅行ステッカー */
function stickerRound(ctx, x, y, r, color, label) {
  ctx.fillStyle = '#fff6e6';
  ctx.beginPath();
  ctx.arc(x, y, r + 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  text(ctx, label, x, y + 1, { size: r * 1.15, color: '#fff', align: 'center', baseline: 'middle', weight: '800' });
}

/** 四角い旅行ステッカー */
function stickerRect(ctx, x, y, w, h, angle, color, label) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.fillStyle = '#fff6e6';
  rr(ctx, -w / 2 - 2, -h / 2 - 2, w + 4, h + 4, 4);
  ctx.fill();
  ctx.fillStyle = color;
  rr(ctx, -w / 2, -h / 2, w, h, 3);
  ctx.fill();
  text(ctx, label, 0, 1, { size: h * 0.62, color: '#fff', align: 'center', baseline: 'middle', weight: '800' });
  ctx.restore();
}

// ------------------------------------------------------------------ バッグの絵

/** 持ち手・風船・荷札など、シルエットの外にはみ出す飾り。本体より先(後ろ)に描く */
function drawBagBack(ctx, d, x, y, w, h) {
  switch (d.style) {
    case 'backpack': {
      ctx.strokeStyle = d.trim;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(0, y + 6, w * 0.13, Math.PI, Math.PI * 2);
      ctx.stroke();
      break;
    }
    case 'tote': {
      ctx.strokeStyle = d.trim;
      ctx.lineWidth = 5;
      for (const hx of [x + w * 0.3, x + w * 0.7]) {
        ctx.beginPath();
        ctx.arc(hx, y + 6, w * 0.15, Math.PI * 1.05, Math.PI * 1.95);
        ctx.stroke();
      }
      break;
    }
    case 'duffel': {
      ctx.strokeStyle = d.trim;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(0, y + 12, w * 0.19, Math.PI * 1.12, Math.PI * 1.88);
      ctx.stroke();
      break;
    }
    case 'paper': {
      ctx.strokeStyle = d.shade;
      ctx.lineWidth = 3;
      for (const hx of [x + w * 0.34, x + w * 0.66]) {
        ctx.beginPath();
        ctx.arc(hx, y + 3, w * 0.12, Math.PI * 1.1, Math.PI * 1.9);
        ctx.stroke();
      }
      break;
    }
    case 'pouch': {
      // 手首ストラップ
      ctx.strokeStyle = d.trim;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(x + w - 4, y + h * 0.45, 9, -Math.PI * 0.45, Math.PI * 0.45);
      ctx.stroke();
      break;
    }
    case 'balloon': {
      // 口からのぞく風船
      const cols = ['#ef5a74', '#f2c14e', '#6fb7ef'];
      cols.forEach((col, i) => {
        const bx = x + w * (0.32 + i * 0.18);
        const top = y - 6 - (i === 1 ? 5 : 0);
        ctx.strokeStyle = 'rgba(255,255,255,0.75)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(bx, y + 14);
        ctx.lineTo(bx + (i - 1) * 3, top + 6);
        ctx.stroke();
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.arc(bx + (i - 1) * 3, top, 7, 0, Math.PI * 2);
        ctx.fill();
      });
      break;
    }
    case 'attache': {
      ctx.strokeStyle = d.trim;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(0, y + 5, w * 0.17, Math.PI * 1.08, Math.PI * 1.92);
      ctx.stroke();
      break;
    }
    case 'trunk': {
      const seam = y + h * 0.36;
      // 両端の持ち手
      ctx.strokeStyle = d.zip;
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(x + w - 1, seam - 6);
      ctx.quadraticCurveTo(x + w + 10, seam, x + w - 1, seam + 6);
      ctx.moveTo(x + 1, seam - 6);
      ctx.quadraticCurveTo(x - 10, seam, x + 1, seam + 6);
      ctx.stroke();
      // 荷札
      ctx.strokeStyle = 'rgba(255,246,230,0.8)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x + w + 6, seam + 2);
      ctx.lineTo(x + w + 13, seam + 12);
      ctx.stroke();
      ctx.save();
      ctx.translate(x + w + 22, seam + 20);
      ctx.rotate(0.32);
      ctx.fillStyle = '#f4ead2';
      rr(ctx, -15, -9, 30, 18, 3);
      ctx.fill();
      ctx.strokeStyle = 'rgba(107,74,43,0.6)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = '#6b4a2b';
      ctx.beginPath();
      ctx.arc(-10, -4, 1.6, 0, Math.PI * 2);
      ctx.fill();
      text(ctx, '土台', 2, 1, { size: 10, color: '#6b4a2b', align: 'center', baseline: 'middle', weight: '800' });
      ctx.restore();
      break;
    }
  }
}

/** 原点中心・回転なしでバッグを描く。形は当たり判定と同じシルエット */
export function drawBagArt(ctx, d, g) {
  const w = d.w;
  const h = d.h;
  const x = -w / 2;
  const y = -h / 2;
  const burst = g?.burst;
  const hpR = g ? C.clamp(g.hp / g.maxHp, 0, 1) : 1;
  const outline = bagOutline(d);

  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  // 影
  ctx.save();
  ctx.translate(3, 5);
  tracePath(ctx, outline);
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.fill();
  ctx.restore();

  drawBagBack(ctx, d, x, y, w, h);

  // 本体
  const grd = ctx.createLinearGradient(x, y, x, y + h);
  grd.addColorStop(0, mix(d.body, '#ffffff', 0.18));
  grd.addColorStop(0.55, d.body);
  grd.addColorStop(1, d.shade);
  ctx.fillStyle = grd;
  tracePath(ctx, outline);
  ctx.fill();

  // 内側のふち
  ctx.save();
  ctx.scale((w - 2) / w, (h - 2) / h);
  tracePath(ctx, outline);
  ctx.restore();
  ctx.strokeStyle = 'rgba(0,0,0,0.25)';
  ctx.lineWidth = 2;
  ctx.stroke();

  // ここから先の模様はシルエットの内側だけに描く
  ctx.save();
  tracePath(ctx, outline);
  ctx.clip();

  switch (d.style) {
    case 'backpack': {
      // ドームのつや
      ctx.fillStyle = 'rgba(255,255,255,0.16)';
      ctx.beginPath();
      ctx.ellipse(x + w * 0.33, y + h * 0.17, w * 0.16, h * 0.07, -0.55, 0, Math.PI * 2);
      ctx.fill();
      // 肩ベルト
      ctx.strokeStyle = d.shade;
      ctx.lineWidth = 7;
      ctx.beginPath();
      ctx.moveTo(x + w * 0.26, y + 10);
      ctx.quadraticCurveTo(x + w * 0.06, y + h * 0.52, x + w * 0.2, y + h - 3);
      ctx.moveTo(x + w * 0.74, y + 10);
      ctx.quadraticCurveTo(x + w * 0.94, y + h * 0.52, x + w * 0.8, y + h - 3);
      ctx.stroke();
      // 前ポケット
      ctx.fillStyle = mix(d.body, '#000', 0.12);
      rr(ctx, x + w * 0.2, y + h * 0.46, w * 0.6, h * 0.42, 8);
      ctx.fill();
      ctx.strokeStyle = d.trim;
      ctx.lineWidth = 2;
      ctx.stroke();
      zipper(ctx, x + w * 0.22, y + h * 0.44, w * 0.56, d.zip, hpR, burst);
      break;
    }
    case 'tote': {
      ctx.fillStyle = 'rgba(0,0,0,0.1)';
      ctx.fillRect(x, y + h * 0.3, w, 3);
      ctx.fillStyle = d.trim;
      rr(ctx, -14, y + h * 0.52, 28, 16, 3);
      ctx.fill();
      text(ctx, 'ECO', 0, y + h * 0.52 + 12, {
        size: 10,
        color: d.body,
        align: 'center',
        weight: '700',
      });
      break;
    }
    case 'duffel': {
      // 丸いはしの縫い目
      const er = Math.min(h / 2, w / 2) - 7;
      ctx.strokeStyle = 'rgba(0,0,0,0.18)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x + h / 2, 0, er, Math.PI * 0.5, Math.PI * 1.5);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x + w - h / 2, 0, er, -Math.PI * 0.5, Math.PI * 0.5);
      ctx.stroke();
      zipper(ctx, x + h * 0.45, y + h * 0.3, w - h * 0.9, d.zip, hpR, burst);
      ctx.strokeStyle = d.shade;
      ctx.lineWidth = 8;
      ctx.beginPath();
      ctx.moveTo(x + w * 0.3, y);
      ctx.lineTo(x + w * 0.3, y + h);
      ctx.moveTo(x + w * 0.7, y);
      ctx.lineTo(x + w * 0.7, y + h);
      ctx.stroke();
      break;
    }
    case 'suitcase': {
      ctx.strokeStyle = mix(d.shade, '#000', 0.12);
      ctx.lineWidth = 4;
      for (let i = 1; i <= 3; i++) {
        const gx = x + (w * i) / 4;
        ctx.beginPath();
        ctx.moveTo(gx, y + 8);
        ctx.lineTo(gx, y + h - 8);
        ctx.stroke();
      }
      // 伸縮ハンドル
      ctx.strokeStyle = '#c9d2e0';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(x + w * 0.3, y + 6);
      ctx.lineTo(x + w * 0.3, y + 22);
      ctx.moveTo(x + w * 0.7, y + 6);
      ctx.lineTo(x + w * 0.7, y + 22);
      ctx.moveTo(x + w * 0.3, y + 8);
      ctx.lineTo(x + w * 0.7, y + 8);
      ctx.stroke();
      // 車輪
      ctx.fillStyle = '#20242f';
      for (const wx of [x + w * 0.22, x + w * 0.78]) {
        ctx.beginPath();
        ctx.arc(wx, y + h - 6, 6, 0, Math.PI * 2);
        ctx.fill();
      }
      // ラッチ
      ctx.fillStyle = d.trim;
      rr(ctx, -11, y + h * 0.42, 22, 10, 3);
      ctx.fill();
      break;
    }
    case 'paper': {
      ctx.strokeStyle = 'rgba(0,0,0,0.16)';
      ctx.lineWidth = 2;
      for (const fx of [x + w * 0.28, x + w * 0.72]) {
        ctx.beginPath();
        ctx.moveTo(fx, y + 12);
        ctx.lineTo(fx, y + h - 3);
        ctx.stroke();
      }
      ctx.fillStyle = mix(d.body, '#fff', 0.25);
      ctx.fillRect(x, y, w, 14);
      ctx.strokeStyle = 'rgba(255,255,255,0.3)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x + 8, y + h * 0.55);
      ctx.lineTo(x + w * 0.4, y + h * 0.62);
      ctx.moveTo(x + w * 0.6, y + h * 0.48);
      ctx.lineTo(x + w - 8, y + h * 0.56);
      ctx.stroke();
      break;
    }
    case 'pouch': {
      zipper(ctx, x + 7, y + h * 0.3, w - 14, d.zip, hpR, burst);
      ctx.fillStyle = d.trim;
      rr(ctx, x + w - 12, y + h * 0.28, 8, 12, 2);
      ctx.fill();
      break;
    }
    case 'balloon': {
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.beginPath();
      ctx.ellipse(x + w * 0.32, y + h * 0.26, w * 0.15, h * 0.09, -0.6, 0, Math.PI * 2);
      ctx.fill();
      zipper(ctx, x + 10, y + h * 0.56, w - 20, d.zip, hpR, burst);
      break;
    }
    case 'attache': {
      ctx.strokeStyle = 'rgba(0,0,0,0.18)';
      ctx.lineWidth = 1.5;
      for (let i = 1; i < 6; i++) {
        ctx.beginPath();
        ctx.moveTo(x + (w * i) / 6, y + 3);
        ctx.lineTo(x + (w * i) / 6, y + h - 3);
        ctx.stroke();
      }
      ctx.fillStyle = d.trim;
      for (const lx of [x + w * 0.26, x + w * 0.74]) {
        rr(ctx, lx - 8, y + h * 0.34, 16, 9, 2);
        ctx.fill();
      }
      // 角金具
      ctx.fillStyle = 'rgba(240,217,168,0.8)';
      for (const [cx, cy] of [
        [x + 2, y + 2],
        [x + w - 10, y + 2],
        [x + 2, y + h - 10],
        [x + w - 10, y + h - 10],
      ]) {
        ctx.fillRect(cx, cy, 8, 8);
      }
      break;
    }
    case 'trunk': {
      // 巨大トランク(土台): ふた・木の帯・旅行ステッカー・革ベルト・真鍮金具
      const seam = y + h * 0.36;
      ctx.fillStyle = 'rgba(0,0,0,0.13)';
      ctx.fillRect(x, y + h * 0.74, w, 4);
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.fillRect(x, y + h * 0.74 + 4, w, 1.5);
      ctx.fillStyle = 'rgba(0,0,0,0.28)';
      ctx.fillRect(x, seam - 1.5, w, 3);
      ctx.fillStyle = 'rgba(255,255,255,0.16)';
      ctx.fillRect(x, seam + 1.5, w, 1.5);
      ctx.fillStyle = 'rgba(255,255,255,0.28)';
      ctx.fillRect(x + 4, y + 2, w - 8, 2);

      stickerRound(ctx, x + w * 0.36, y + h * 0.66, 12, '#e8555a', '✈');
      stickerRect(ctx, x + w * 0.66, y + h * 0.65, 40, 17, -0.12, '#4f8fe0', 'PARIS');
      stickerRect(ctx, x + w * 0.1, y + h * 0.68, 24, 13, 0.18, '#f2c14e', 'NY');

      for (const sx of [x + w * 0.2, x + w * 0.8]) {
        ctx.fillStyle = d.zip;
        ctx.fillRect(sx - 8, y, 16, h);
        ctx.strokeStyle = 'rgba(255,226,180,0.45)';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(sx - 5, y + 2);
        ctx.lineTo(sx - 5, y + h - 2);
        ctx.moveTo(sx + 5, y + 2);
        ctx.lineTo(sx + 5, y + h - 2);
        ctx.stroke();
        ctx.setLineDash([]);
        // バックル
        ctx.strokeStyle = d.trim;
        ctx.lineWidth = 2.5;
        rr(ctx, sx - 10, seam - 7, 20, 14, 3);
        ctx.stroke();
        ctx.fillStyle = d.trim;
        ctx.fillRect(sx - 1, seam - 7, 2, 14);
      }

      // L字の角金具とリベット
      const k = 15;
      for (const [cx, cy, sx, sy] of [
        [x, y, 1, 1],
        [x + w, y, -1, 1],
        [x, y + h, 1, -1],
        [x + w, y + h, -1, -1],
      ]) {
        ctx.fillStyle = d.trim;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + sx * k, cy);
        ctx.lineTo(cx + sx * k, cy + sy * 5);
        ctx.lineTo(cx + sx * 5, cy + sy * 5);
        ctx.lineTo(cx + sx * 5, cy + sy * k);
        ctx.lineTo(cx, cy + sy * k);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = 'rgba(70,45,10,0.6)';
        for (const [rx, ry] of [
          [cx + sx * 2.5, cy + sy * 10],
          [cx + sx * 10, cy + sy * 2.5],
        ]) {
          ctx.beginPath();
          ctx.arc(rx, ry, 1.3, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // 錠前
      ctx.fillStyle = d.trim;
      rr(ctx, -13, seam - 9, 26, 18, 4);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.3)';
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.fillStyle = '#3a2516';
      ctx.beginPath();
      ctx.arc(0, seam - 2, 2.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(-1.2, seam - 1, 2.4, 6);
      break;
    }
  }

  // 傷み表現
  if (!burst && hpR < 0.66) {
    const s = 1 - hpR;
    ctx.save();
    ctx.globalAlpha = C.clamp(s * 1.1, 0, 0.85);
    ctx.strokeStyle = hpR < 0.34 ? '#ff6b57' : 'rgba(0,0,0,0.4)';
    ctx.lineWidth = hpR < 0.34 ? 2.4 : 1.8;
    const n = hpR < 0.34 ? 4 : 2;
    for (let i = 0; i < n; i++) {
      const bx = x + w * (0.2 + 0.18 * i);
      const by = y + h * (0.24 + ((i * 37) % 40) / 100);
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.lineTo(bx + 6, by + 5);
      ctx.lineTo(bx + 2, by + 9);
      ctx.lineTo(bx + 8, by + 15);
      ctx.stroke();
    }
    ctx.restore();
  }

  if (burst) {
    // 空っぽでしぼんだ感じ
    ctx.fillStyle = 'rgba(70,72,90,0.3)';
    ctx.fillRect(x, y, w, h);
    // ぱっくり開いた口
    ctx.fillStyle = 'rgba(24,20,30,0.88)';
    ctx.beginPath();
    ctx.moveTo(x + 5, y + 12);
    const teeth = 7;
    for (let i = 0; i <= teeth; i++) {
      const tx = x + 5 + ((w - 10) * i) / teeth;
      const ty = y + (i % 2 === 0 ? 2 : 13);
      ctx.lineTo(tx, ty);
    }
    ctx.lineTo(x + w - 5, y + 14);
    ctx.quadraticCurveTo(0, y + h * 0.36, x + 5, y + 14);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.28)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(x + 8, y + h * 0.6);
    ctx.quadraticCurveTo(0, y + h * 0.5, x + w - 8, y + h * 0.62);
    ctx.stroke();
  }

  // ダメージフラッシュ
  if (g && g.flash > 0.02) {
    ctx.globalAlpha = C.clamp(g.flash, 0, 0.7);
    ctx.fillStyle = '#fff2c9';
    ctx.fillRect(x, y, w, h);
    ctx.globalAlpha = 1;
  }

  ctx.restore(); // クリップ解除
  ctx.restore();
}

function zipper(ctx, x, y, w, color, hpR, burst) {
  ctx.save();
  ctx.strokeStyle = burst ? 'rgba(255,255,255,0.35)' : color;
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + w, y);
  ctx.stroke();
  if (!burst) {
    ctx.lineWidth = 1;
    const step = 5;
    const gap = hpR < 0.4 ? 2.6 : 1.4;
    for (let i = 0; i <= w; i += step) {
      ctx.beginPath();
      ctx.moveTo(x + i, y - gap);
      ctx.lineTo(x + i, y + gap);
      ctx.stroke();
    }
    // 引き手
    ctx.fillStyle = color;
    rr(ctx, x + w * (hpR < 0.4 ? 0.55 : 0.9) - 3, y - 3, 7, 7, 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawBag(ctx, body) {
  const g = body.plugin.g;
  const d = g.def;
  ctx.save();
  ctx.translate(body.position.x, body.position.y);
  ctx.rotate(body.angle);
  // ボディの位置は形の重心なので、箱の中心まで戻してから描く
  ctx.translate(-g.cx, -g.cy * g.sy);
  // 見た目だけの潰れ(着地・荷重)。物理形状は g.sy(しぼみ)で実際に縮んでいる
  const hpR = C.clamp(g.hp / g.maxHp, 0, 1);
  const load = g.burst ? 0 : Math.min(0.07, g.load * 0.035);
  const sq = g.squash * 0.15 + load;
  const bulge = g.burst ? 0 : (1 - hpR) * 0.05;
  // 破裂寸前はぷるぷる震える
  if (!g.burst && hpR < 0.3) ctx.translate(C.rand(-1, 1) * (1 - hpR * 3), 0);
  ctx.scale(1 + sq * 0.55 + bulge, g.sy * (1 - sq));
  drawBagArt(ctx, d, g);
  ctx.restore();
}

function drawItem(ctx, body) {
  const g = body.plugin.g;
  const d = g.def;
  ctx.save();
  ctx.translate(body.position.x, body.position.y);
  ctx.rotate(body.angle);
  ctx.fillStyle = 'rgba(0,0,0,0.2)';
  if (d.shape === 'circle') {
    ctx.beginPath();
    ctx.arc(1.5, 2.5, d.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = d.color;
    ctx.beginPath();
    ctx.arc(0, 0, d.r, 0, Math.PI * 2);
    ctx.fill();
  } else {
    rr(ctx, -d.w / 2 + 1.5, -d.h / 2 + 2.5, d.w, d.h, 3);
    ctx.fill();
    ctx.fillStyle = d.color;
    rr(ctx, -d.w / 2, -d.h / 2, d.w, d.h, 3);
    ctx.fill();
  }
  ctx.strokeStyle = 'rgba(0,0,0,0.3)';
  ctx.lineWidth = 1.2;
  ctx.stroke();
  const size = d.shape === 'circle' ? d.r * 2.05 : Math.min(d.w, d.h) * 1.55;
  ctx.font = `${size}px ${C.FONT_EMOJI}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(d.emoji, 0, 1);
  ctx.restore();
}

// ------------------------------------------------------------------ クレーン

function drawCrane(ctx, game) {
  const cy = game.crane.screenY;
  const cx = game.crane.x;

  // レール
  ctx.fillStyle = '#2b3350';
  ctx.fillRect(0, cy - 26, C.VIEW.W, 14);
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  ctx.fillRect(0, cy - 26, C.VIEW.W, 3);
  ctx.fillStyle = '#f2c14e';
  for (let x = 0; x < C.VIEW.W; x += 30) ctx.fillRect(x, cy - 14, 15, 4);

  // トロリー
  ctx.fillStyle = '#48527a';
  rr(ctx, cx - 20, cy - 24, 40, 20, 5);
  ctx.fill();
  ctx.fillStyle = '#f2c14e';
  rr(ctx, cx - 12, cy - 20, 24, 6, 3);
  ctx.fill();

  if (!game.held) return;

  const sw = game.crane.swing;
  const hookY = cy - 4;
  const ex = cx + Math.sin(sw) * C.ROPE_LEN;
  const ey = hookY + Math.cos(sw) * C.ROPE_LEN;

  // ロープ
  ctx.strokeStyle = '#d9dee9';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx, hookY);
  ctx.lineTo(ex, ey);
  ctx.stroke();
  // フック
  ctx.strokeStyle = '#b9c1d1';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(ex, ey + 3, 4, Math.PI * 0.15, Math.PI * 0.95, true);
  ctx.stroke();

  const d = game.held;
  const bagY = ey + 6 + d.h / 2;
  ctx.save();
  ctx.translate(ex, bagY);
  ctx.rotate(game.crane.rot + sw * 0.5);
  drawBagArt(ctx, d, null);
  ctx.restore();

  // 口の開いたバッグを傾けすぎていたら警告(バッグの下に表示)
  if (d.spill && Math.abs(game.crane.rot) > 1.1) {
    const a = game.crane.rot + sw * 0.5;
    const ext = (Math.abs(d.w * Math.sin(a)) + Math.abs(d.h * Math.cos(a))) / 2;
    const px = C.clamp(ex, 72, C.VIEW.W - 72);
    const py = bagY + ext + 22;
    ctx.save();
    ctx.globalAlpha = 0.8 + 0.2 * Math.sin(game.time / 90);
    panel(ctx, px - 64, py - 16, 128, 28, 14, 'rgba(24,18,34,0.88)', 'rgba(255,179,107,0.95)');
    text(ctx, '⚠ こぼれるよ！', px, py + 4, {
      size: 14,
      weight: '800',
      color: '#ffb36b',
      align: 'center',
    });
    ctx.restore();
  }

  // 落下ガイド: いま落とすと真下のどこに当たるか。土台の外なら赤い×
  const surf = game.world.surfaceY(ex);
  const miss = !Number.isFinite(surf);
  const endY = miss ? C.FOOTER_Y - 24 : surf + game.camY;
  const col = miss ? '#ff6b5a' : '#ffffff';
  ctx.save();
  ctx.globalAlpha = miss ? 0.75 : 0.34;
  ctx.strokeStyle = col;
  ctx.setLineDash([5, 7]);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(ex, bagY + d.h / 2 + 4);
  ctx.lineTo(ex, endY - 6);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.globalAlpha = 0.9;
  ctx.lineWidth = miss ? 4 : 3;
  ctx.beginPath();
  if (miss) {
    ctx.moveTo(ex - 10, endY - 10);
    ctx.lineTo(ex + 10, endY + 10);
    ctx.moveTo(ex + 10, endY - 10);
    ctx.lineTo(ex - 10, endY + 10);
  } else {
    ctx.moveTo(ex - 14, endY - 10);
    ctx.lineTo(ex - 14, endY - 2);
    ctx.lineTo(ex - 6, endY - 2);
    ctx.moveTo(ex + 14, endY - 10);
    ctx.lineTo(ex + 14, endY - 2);
    ctx.lineTo(ex + 6, endY - 2);
  }
  ctx.stroke();
  ctx.restore();
}

// ------------------------------------------------------------------ エフェクト

function drawFx(ctx, game) {
  for (const p of game.fx) {
    const life = p.life / p.maxLife;
    ctx.save();
    ctx.globalAlpha = C.clamp(life, 0, 1);
    if (p.kind === 'text') {
      text(ctx, p.text, p.x, p.y, {
        size: p.size ?? 18,
        color: p.color,
        align: 'center',
        weight: '800',
        shadow: 2,
      });
    } else if (p.kind === 'ring') {
      ctx.strokeStyle = p.color;
      ctx.lineWidth = 3 * life;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * (1.6 - life), 0, Math.PI * 2);
      ctx.stroke();
    } else {
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * (0.4 + life * 0.6), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}

// ------------------------------------------------------------------ HUD

function heart(ctx, x, y, s, filled) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  ctx.beginPath();
  ctx.moveTo(0, 3);
  ctx.bezierCurveTo(-5, -3, -10, 1, -5, 6);
  ctx.lineTo(0, 11);
  ctx.lineTo(5, 6);
  ctx.bezierCurveTo(10, 1, 5, -3, 0, 3);
  ctx.closePath();
  ctx.fillStyle = filled ? '#ff5f6d' : 'rgba(255,255,255,0.18)';
  ctx.fill();
  if (filled) {
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.beginPath();
    ctx.ellipse(-3, 3, 1.6, 1.1, -0.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawHud(ctx, game) {
  // 上部パネル(左: 得点 / 右: 高さ or いまの箱のつまり具合)
  panel(ctx, 0, 0, C.VIEW.W, 74, 0, 'rgba(12,16,34,0.55)');
  const unit = '';
  const value = `${Math.floor(game.displayScore)}${unit}`;
  text(ctx, 'SCORE', 16, 22, { size: 11, color: 'rgba(255,255,255,0.6)', letter: 1 });
  text(ctx, value, 16, 54, {
    size: 30,
    weight: '800',
    color: '#fff',
    shadow: 2,
  });
  ctx.save();
  ctx.font = `800 30px ${C.FONT_UI}`;
  const sw = ctx.measureText(value).width;
  ctx.restore();
  text(ctx, `BEST ${game.best}${unit}`, 24 + Math.max(58, sw), 54, {
    size: 12,
    color: 'rgba(255,255,255,0.5)',
  });

  if (game.isPack) {
    // いまの箱: 何箱目か・つまり具合・ノルマの目印
    const fill = C.clamp(game.packStats.fill, 0, 1);
    const pct = Math.round(fill * 100);
    const col = packFillColor(game);
    text(
      ctx,
      `${game.boxNo}箱目${C.BOX_TYPES[game.boxType].short}  ノルマ${Math.round(game.quota * 100)}%`,
      C.VIEW.W - 16,
      22,
      { size: 11, color: 'rgba(255,255,255,0.7)', align: 'right' },
    );
    text(ctx, `${pct}%`, C.VIEW.W - 16, 50, { size: 26, weight: '800', color: col, align: 'right', shadow: 2 });
    // この箱で中身が飛び出した分の減点(出荷するときに引かれる)。出荷中は結果の表示に任せる
    if (game.boxPenalty > 0 && game.state !== 'ship') {
      ctx.save();
      ctx.font = `800 26px ${C.FONT_UI}`;
      const pw = ctx.measureText(`${pct}%`).width;
      ctx.restore();
      text(ctx, `ドバー -${game.boxPenalty}`, C.VIEW.W - 26 - pw, 48, {
        size: 12,
        weight: '800',
        color: '#ff9d9d',
        align: 'right',
      });
    }
    const bx = C.VIEW.W - 146;
    const bw = 130;
    panel(ctx, bx, 58, bw, 8, 4, 'rgba(0,0,0,0.38)');
    ctx.fillStyle = col;
    rr(ctx, bx, 58, bw * fill, 8, 4);
    ctx.fill();
    // ノルマの目印(白い縦線)
    const qx = bx + bw * game.quota;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(qx - 1, 55, 2, 14);
  } else {
    // 高さ
    text(ctx, '高さ', C.VIEW.W - 16, 22, { size: 11, color: 'rgba(255,255,255,0.6)', align: 'right' });
    text(ctx, `${game.world.heightM.toFixed(1)}m`, C.VIEW.W - 16, 50, {
      size: 26,
      weight: '800',
      color: '#ffe08a',
      align: 'right',
      shadow: 2,
    });
  }

  // ライフ
  for (let i = 0; i < C.START_LIVES; i++) heart(ctx, 128 + i * 24, 12, 1.15, i < game.lives);

  // コンボ
  if (game.combo >= 2) {
    const pop = 1 + Math.max(0, 1 - game.comboPop) * 0.35;
    ctx.save();
    ctx.translate(C.VIEW.W / 2, 58);
    ctx.scale(pop, pop);
    text(ctx, `${game.combo} コンボ`, 0, 0, {
      size: 17,
      weight: '800',
      color: '#8ef0c9',
      align: 'center',
      shadow: 2,
    });
    ctx.restore();
  }

  // 風メーター
  const w = game.world.wind;
  if (w.max > 0) {
    const cx = C.VIEW.W / 2;
    const y = 92;
    text(ctx, '風', cx - 62, y + 5, { size: 12, color: 'rgba(255,255,255,0.7)', align: 'right' });
    panel(ctx, cx - 54, y - 5, 108, 10, 5, 'rgba(0,0,0,0.35)');
    const v = C.clamp(w.x, -1, 1);
    ctx.fillStyle = Math.abs(v) > 0.55 ? '#ff8a6b' : '#9fd8ff';
    const bw = Math.abs(v) * 52;
    rr(ctx, cx + (v > 0 ? 1 : -1 - bw), y - 4, bw, 8, 4);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.fillRect(cx - 0.5, y - 7, 1, 14);
    if (Math.abs(v) > 0.05) {
      text(ctx, v > 0 ? '→' : '←', cx + (v > 0 ? 62 : -62), y + 6, {
        size: 14,
        color: '#fff',
        align: 'center',
      });
    }
  }

  drawFooter(ctx, game);
  if (game.isPack && game.state === 'ship') drawShipResult(ctx, game);

  // 制限時間バー(土台のトランクに重ならないよう、操作パネルの上端に置く)
  if (game.state === 'aim') {
    const t = C.clamp(game.aimLeft, 0, 1);
    const bw = C.VIEW.W - 28;
    panel(ctx, 14, C.FOOTER_Y + 5, bw, 5, 3, 'rgba(255,255,255,0.12)');
    ctx.fillStyle = t < 0.25 ? '#ff6b57' : t < 0.55 ? '#ffc861' : '#7de0a8';
    rr(ctx, 14, C.FOOTER_Y + 5, bw * t, 5, 3);
    ctx.fill();
  }
}

/** 回転アイコン(dir: -1 = 左回り ↺ / 1 = 右回り ↻) */
function rotIcon(ctx, cx, cy, dir) {
  const r = 11;
  const end = -Math.PI / 2 + 0.25; // 真上の少し右で終わる
  const start = end - Math.PI * 1.55;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(dir, 1); // ↻ を基準に描いて、左回りは左右反転
  ctx.strokeStyle = '#fff';
  ctx.fillStyle = '#fff';
  ctx.lineWidth = 2.6;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(0, 0, r, start, end, false);
  ctx.stroke();
  // 矢じり(円の接線方向を向く)
  const ex = Math.cos(end) * r;
  const ey = Math.sin(end) * r;
  const tx = -Math.sin(end);
  const ty = Math.cos(end);
  const nx = Math.cos(end);
  const ny = Math.sin(end);
  ctx.beginPath();
  ctx.moveTo(ex + tx * 6, ey + ty * 6);
  ctx.lineTo(ex + nx * 5 - tx * 2, ey + ny * 5 - ty * 2);
  ctx.lineTo(ex - nx * 5 - tx * 2, ey - ny * 5 - ty * 2);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawFooter(ctx, game) {
  const y = C.FOOTER_Y;
  panel(ctx, 0, y, C.VIEW.W, C.VIEW.H - y, 0, '#0f1428');
  ctx.fillStyle = 'rgba(255,255,255,0.1)';
  ctx.fillRect(0, y, C.VIEW.W, 1);

  // 次のバッグ
  const nd = game.next;
  if (nd) {
    text(ctx, 'NEXT', 14, y + 20, { size: 10, color: 'rgba(255,255,255,0.55)', letter: 1 });
    ctx.save();
    ctx.translate(44, y + 44);
    const s = Math.min(46 / nd.w, 40 / nd.h);
    ctx.scale(s, s);
    drawBagArt(ctx, nd, null);
    ctx.restore();
    text(ctx, nd.name, 76, y + 34, { size: 14, weight: '700', color: '#fff' });
    text(ctx, nd.tip, 76, y + 52, { size: 11, color: '#ffd98a' });
  }

  // つめこみモード: 「しめる」ボタン(はやさの表示の代わり)
  if (game.isPack) {
    drawCloseButton(ctx, game);
    drawFooterButtons(ctx, game);
    return;
  }

  // いまの「はやさ」(変えるのはタイトル・ゲームオーバー画面)
  const sx = 206;
  text(ctx, 'はやさ', sx, y + 20, { size: 10, color: 'rgba(255,255,255,0.55)', letter: 1 });
  for (let i = 0; i < C.SPEED_LEVELS.length; i++) {
    const bh = 7 + i * 3.5;
    ctx.fillStyle = i <= game.speedLevel ? SPEED_COLORS[i] : 'rgba(255,255,255,0.14)';
    rr(ctx, sx + i * 13, y + 46 - bh, 10, bh, 2.5);
    ctx.fill();
  }
  text(ctx, `×${C.SPEED_LEVELS[game.speedLevel].toFixed(1)}`, sx, y + 62, {
    size: 11,
    weight: '700',
    color: SPEED_COLORS[game.speedLevel],
  });

  drawFooterButtons(ctx, game);
}

/** つまり具合の色: ノルマ未満 = 水色 / ノルマ以上 = 緑 / ぎっしり(ライフ回復) = 金 */
function packFillColor(game) {
  const f = game.packStats.fill;
  if (f >= C.LIFE_BONUS_FILL) return '#ffd35c';
  if (f >= game.quota) return '#7de0a8';
  return '#9fd8ff';
}

/** つめこみモードの「しめる」ボタン。ノルマをこえると光って押せるようになる */
function drawCloseButton(ctx, game) {
  const b = game.buttons.close;
  const can = game.canClose;
  const pressed = game.pressedBtn === 'close';
  const cx = b.x + b.w / 2;
  if (can) {
    ctx.save();
    ctx.globalAlpha = 0.45 + 0.35 * Math.sin(game.time / 150);
    ctx.strokeStyle = '#8ef0c9';
    ctx.lineWidth = 5;
    rr(ctx, b.x - 3, b.y - 3, b.w + 6, b.h + 6, 15);
    ctx.stroke();
    ctx.restore();
  }
  panel(
    ctx,
    b.x,
    b.y,
    b.w,
    b.h,
    12,
    can ? (pressed ? '#5fd8a8' : '#36b383') : 'rgba(255,255,255,0.07)',
    can ? '#d9fff0' : 'rgba(255,255,255,0.2)',
  );
  text(ctx, can ? 'しめる！' : 'しめる', cx, b.y + 18, {
    size: 16,
    weight: '800',
    color: can ? '#ffffff' : 'rgba(255,255,255,0.45)',
    align: 'center',
    baseline: 'middle',
  });
  let sub;
  if (game.state === 'ship') sub = '出荷中…';
  else if (game.overflowTime > 0) sub = 'はみ出し中！';
  else if (can) sub = `×${game.packMultiplier} で出荷`;
  else sub = `ノルマ ${Math.round(game.quota * 100)}%`;
  text(ctx, sub, cx, b.y + 36, {
    size: 10,
    weight: '700',
    color: can ? '#eafff6' : game.overflowTime > 0 ? '#ffb0a4' : 'rgba(255,255,255,0.55)',
    align: 'center',
    baseline: 'middle',
  });
}

/** 回転ボタンとミュートボタン */
function drawFooterButtons(ctx, game) {
  // 回転ボタン
  for (const b of [game.buttons.rotL, game.buttons.rotR]) {
    const pressed = game.pressedBtn === b.id;
    panel(
      ctx,
      b.x,
      b.y,
      b.w,
      b.h,
      12,
      pressed ? 'rgba(255,255,255,0.28)' : 'rgba(255,255,255,0.12)',
      'rgba(255,255,255,0.25)',
    );
    rotIcon(ctx, b.x + b.w / 2, b.y + b.h / 2 + 1, b.id === 'rotL' ? -1 : 1);
  }

  // ミュート
  const m = game.buttons.mute;
  panel(ctx, m.x, m.y, m.w, m.h, 10, 'rgba(255,255,255,0.1)', 'rgba(255,255,255,0.2)');
  text(ctx, isMuted() ? '🔇' : '🔊', m.x + m.w / 2, m.y + m.h / 2 + 1, {
    size: 17,
    align: 'center',
    baseline: 'middle',
    font: C.FONT_EMOJI,
  });
}

// ------------------------------------------------------------------ 画面

function dim(ctx, a = 0.62) {
  ctx.fillStyle = `rgba(8,10,24,${a})`;
  ctx.fillRect(0, 0, C.VIEW.W, C.VIEW.H);
}

/** 「はやさ」の段階ごとの色(遅い=緑 → 速い=赤) */
const SPEED_COLORS = ['#7de0a8', '#c3e27a', '#ffd36b', '#ffa45c', '#ff6b57'];

/** タイトル・ゲームオーバー画面の「はやさ」選択(◀ 1 2 3 4 5 ▶) */
function drawSpeedPicker(ctx, game) {
  const ui = game.speedUi();
  const lv = game.speedLevel;
  const n = ui.segs.length;
  text(ctx, `クレーンのはやさ  ×${C.SPEED_LEVELS[lv].toFixed(1)}`, C.VIEW.W / 2, ui.y - 10, {
    size: 13,
    weight: '700',
    color: 'rgba(255,255,255,0.8)',
    align: 'center',
  });
  for (const [r, dir, enabled] of [
    [ui.minus, -1, lv > 0],
    [ui.plus, 1, lv < n - 1],
  ]) {
    panel(
      ctx,
      r.x,
      r.y,
      r.w,
      r.h,
      12,
      enabled ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.04)',
      enabled ? 'rgba(255,255,255,0.32)' : 'rgba(255,255,255,0.1)',
    );
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    ctx.fillStyle = enabled ? '#ffffff' : 'rgba(255,255,255,0.22)';
    ctx.beginPath();
    ctx.moveTo(cx + dir * 8, cy);
    ctx.lineTo(cx - dir * 6, cy - 9);
    ctx.lineTo(cx - dir * 6, cy + 9);
    ctx.closePath();
    ctx.fill();
  }
  ui.segs.forEach((r, i) => {
    const on = i <= lv;
    panel(
      ctx,
      r.x,
      r.y,
      r.w,
      r.h,
      9,
      on ? SPEED_COLORS[i] : 'rgba(255,255,255,0.07)',
      i === lv ? '#ffffff' : 'rgba(255,255,255,0.18)',
    );
    text(ctx, String(i + 1), r.x + r.w / 2, r.y + r.h / 2 + 1, {
      size: 17,
      weight: '800',
      color: on ? '#1b2340' : 'rgba(255,255,255,0.5)',
      align: 'center',
      baseline: 'middle',
    });
  });
}

function drawTitle(ctx, game) {
  dim(ctx, 0.66);
  const bob = Math.sin(game.time / 520) * 5;

  ctx.save();
  ctx.translate(C.VIEW.W / 2, 208 + bob);
  ctx.rotate(-0.05);
  drawBagArt(ctx, game.titleStack[0], null);
  ctx.restore();
  ctx.save();
  ctx.translate(C.VIEW.W / 2 + 10, 148 + bob * 1.4);
  ctx.rotate(0.09);
  drawBagArt(ctx, game.titleStack[1], null);
  ctx.restore();
  ctx.save();
  ctx.translate(C.VIEW.W / 2 - 14, 96 + bob * 1.8);
  ctx.rotate(-0.16);
  drawBagArt(ctx, game.titleStack[2], null);
  ctx.restore();

  text(ctx, 'バック', C.VIEW.W / 2 - 92, 292, { size: 44, weight: '800', color: '#fff', align: 'center', shadow: 3 });
  text(ctx, 'おん', C.VIEW.W / 2, 284, { size: 28, weight: '800', color: '#ffd98a', align: 'center', shadow: 3 });
  text(ctx, 'バックス', C.VIEW.W / 2 + 96, 292, { size: 40, weight: '800', color: '#fff', align: 'center', shadow: 3 });
  text(ctx, 'B A C K S   O N   B A C K S', C.VIEW.W / 2, 314, {
    size: 12,
    color: 'rgba(255,255,255,0.45)',
    align: 'center',
  });

  // モード選択(カードを押すとそのモードで始まる)
  const ui = game.modeUi();
  const cards = [
    ['stack', 'つみあげ', '高く 積みあげる', '#8ef0c9', `BEST ${game.bests.stack}`],
    ['pack', 'つめこみ', '詰めて しめて 出荷！', '#ffb27a', `BEST ${game.bests.pack}`],
  ];
  for (const [mode, name, desc, accent, best] of cards) {
    const r = ui[mode];
    const sel = game.mode === mode;
    const pressed = game.pressedBtn === `mode:${mode}`;
    panel(
      ctx,
      r.x,
      r.y,
      r.w,
      r.h,
      16,
      pressed ? 'rgba(255,255,255,0.24)' : sel ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.06)',
      sel ? accent : 'rgba(255,255,255,0.18)',
    );
    if (sel) {
      ctx.save();
      ctx.globalAlpha = 0.35 + 0.25 * Math.sin(game.time / 300);
      ctx.strokeStyle = accent;
      ctx.lineWidth = 5;
      rr(ctx, r.x - 3, r.y - 3, r.w + 6, r.h + 6, 19);
      ctx.stroke();
      ctx.restore();
    }
    const cx = r.x + r.w / 2;
    drawModeIcon(ctx, mode, cx, r.y + 38);
    text(ctx, name, cx, r.y + 82, { size: 19, weight: '800', color: sel ? accent : '#fff', align: 'center' });
    text(ctx, desc, cx, r.y + 100, { size: 11, color: 'rgba(255,255,255,0.75)', align: 'center' });
    text(ctx, best, r.x + r.w - 10, r.y + 16, {
      size: 10,
      weight: '700',
      color: 'rgba(255,255,255,0.55)',
      align: 'right',
    });
  }

  panel(ctx, 44, 450, C.VIEW.W - 88, 112, 16, 'rgba(255,255,255,0.08)', 'rgba(255,255,255,0.16)');
  const lines = [
    ['↔️', 'クレーンは 左右に 動きつづける'],
    ['👆', 'タップ / スペース で 落とす'],
    ['🔄', '← → / Z X / ボタン で 回す'],
    ['💥', `ぶつけすぎると 中身がドバー！ -${C.BURST_PENALTY}点`],
  ];
  lines.forEach(([ic, s], i) => {
    const y = 468 + i * 25;
    text(ctx, ic, 70, y + 6, { size: 17, align: 'center', font: C.FONT_EMOJI });
    text(ctx, s, 92, y + 6, { size: 14, color: 'rgba(255,255,255,0.9)' });
  });

  drawSpeedPicker(ctx, game);

  const a = 0.55 + 0.45 * Math.sin(game.time / 300);
  ctx.globalAlpha = a;
  text(ctx, 'モードを タップして スタート', C.VIEW.W / 2, 660, {
    size: 15,
    weight: '800',
    color: '#8ef0c9',
    align: 'center',
    shadow: 2,
  });
  ctx.globalAlpha = 1;

  drawRankButton(ctx, game);
}

function drawGameOver(ctx, game) {
  // つめこみモードは後ろにバッグがぎっしりなので、文字が読めるよう濃いめに暗くする
  dim(ctx, game.isPack ? 0.84 : 0.7);
  const y0 = 150;
  const accent = game.isPack ? '#ffb27a' : '#8ef0c9';
  panel(ctx, C.VIEW.W / 2 - 58, y0 - 62, 116, 24, 12, 'rgba(255,255,255,0.08)', accent);
  text(ctx, `${game.isPack ? 'つめこみ' : 'つみあげ'}モード`, C.VIEW.W / 2, y0 - 45, {
    size: 12,
    weight: '700',
    color: accent,
    align: 'center',
  });
  text(ctx, 'ゲームオーバー', C.VIEW.W / 2, y0, {
    size: 34,
    weight: '800',
    color: '#fff',
    align: 'center',
    shadow: 3,
  });
  text(ctx, game.overReason, C.VIEW.W / 2, y0 + 30, {
    size: 14,
    color: 'rgba(255,255,255,0.7)',
    align: 'center',
  });

  panel(ctx, 56, y0 + 52, C.VIEW.W - 112, 210, 16, 'rgba(255,255,255,0.08)', 'rgba(255,255,255,0.16)');
  /** 行: [見出し, 値, 色(なければ決まった色)] */
  const rows = game.isPack
    ? [
        ['スコア', String(game.score)],
        ['最高記録', String(game.best)],
        ['出荷した箱', `${game.shippedBoxes} 箱`],
        ['出荷したバッグ', `${game.shippedBags} 個`],
        ['中身ドバー', `${game.burstCount} 回`],
      ]
    : [
        ['スコア', String(game.score)],
        ['最高記録', String(game.best)],
        ['高さ', `${(game.world.maxHeightPx / C.PX_PER_M).toFixed(1)} m`],
        ['積んだバッグ', `${game.placedCount} 個`],
        ['中身ドバー', `${game.burstCount} 回`],
      ];
  const rank = rankRow(game);
  rows.push(['ランキング', rank.text, rank.color]);
  rows.forEach(([k, v, color], i) => {
    const y = y0 + 80 + i * 33;
    text(ctx, k, 80, y, { size: 14, color: 'rgba(255,255,255,0.65)' });
    text(ctx, v, C.VIEW.W - 80, y, {
      size: i === 0 ? 24 : 18,
      weight: '800',
      color: color ?? (i === 0 ? '#ffe08a' : '#fff'),
      align: 'right',
    });
  });

  const r = game.rankResult;
  const top1 = r?.status === 'ok' && r.improved && r.rank === 1;
  if (top1 || game.newBest) {
    const s = 1 + Math.sin(game.time / 200) * 0.06;
    ctx.save();
    ctx.translate(C.VIEW.W / 2, y0 + 292);
    ctx.scale(s, s);
    text(ctx, top1 ? '👑 ランキング 1位！' : '🎉 ハイスコア更新！', 0, 0, {
      size: 21,
      weight: '800',
      color: '#ffe08a',
      align: 'center',
      shadow: 2,
    });
    ctx.restore();
  }

  drawSpeedPicker(ctx, game);

  const a = 0.55 + 0.45 * Math.sin(game.time / 300);
  ctx.globalAlpha = a;
  text(ctx, 'タップ / スペース で もう一度', C.VIEW.W / 2, y0 + 426, {
    size: 18,
    weight: '800',
    color: '#8ef0c9',
    align: 'center',
    shadow: 2,
  });
  ctx.globalAlpha = 1;

  // タイトル(モード選択)へ戻る
  const b = game.titleButton;
  const pressed = game.pressedBtn === 'toTitle';
  panel(ctx, b.x, b.y, b.w, b.h, 14, pressed ? 'rgba(255,255,255,0.26)' : 'rgba(255,255,255,0.1)', 'rgba(255,255,255,0.32)');
  text(ctx, '◀ モードをえらぶ', b.x + b.w / 2, b.y + b.h / 2 + 1, {
    size: 15,
    weight: '800',
    color: '#fff',
    align: 'center',
    baseline: 'middle',
  });
  drawRankButton(ctx, game);
}

// ------------------------------------------------------------------ ランキング

const MODE_NAME = { stack: 'つみあげ', pack: 'つめこみ' };
const MODE_ACCENT = { stack: '#8ef0c9', pack: '#ffb27a' };
/** 1〜3 位のメダルの色 */
const MEDAL = ['#ffd35c', '#d6dde8', '#e0a46b'];
/** ランキングの一覧(10 人ぶん)の位置 */
const RANK_LIST = { x: 24, y: 128, w: 432, rowH: 40 };

/** 「🏆 ランキング」ボタン(タイトル画面・ゲームオーバー画面) */
function drawRankButton(ctx, game) {
  const b = game.rankButton;
  const pressed = game.pressedBtn === 'ranking';
  // タイトル画面では土台のトランクに重なるので、透けない色にする
  panel(
    ctx,
    b.x,
    b.y,
    b.w,
    b.h,
    14,
    pressed ? 'rgba(96,80,36,0.96)' : 'rgba(32,30,50,0.94)',
    'rgba(255,224,138,0.8)',
  );
  text(ctx, '🏆 ランキング', b.x + b.w / 2, b.y + b.h / 2 + 1, {
    size: 15,
    weight: '800',
    color: '#ffe08a',
    align: 'center',
    baseline: 'middle',
  });
}

/** ゲームオーバー画面の「ランキング」の行に出す文字と色 */
function rankRow(game) {
  const r = game.rankResult;
  if (!r) return { text: '—', color: 'rgba(255,255,255,0.4)' };
  if (r.status === 'sending') return { text: '送信中…', color: 'rgba(255,255,255,0.55)' };
  if (r.status === 'error') return { text: 'つながらない…', color: '#ffb0a4' };
  if (r.rank === null) return { text: `ランク外 / ${r.total}人`, color: '#fff' };
  // 自己ベストに届かなかったときは、自己ベストの順位を出す
  if (!r.improved) return { text: `ベストで ${r.rank}位`, color: '#fff' };
  return { text: `${r.rank}位 / ${r.total}人`, color: r.rank <= 3 ? '#ffe08a' : '#8ef0c9' };
}

/** ランキングの 1 行(順位・なまえ・くわしい記録・クレーンのはやさ・スコア)。自分の行は枠で囲む */
function drawRankRow(ctx, e, x, y, w, h, mode, accent) {
  if (e.me) panel(ctx, x, y + 2, w, h - 4, 10, 'rgba(255,255,255,0.12)', accent);
  const cy = y + h / 2 + 1;
  if (e.rank <= 3) {
    ctx.fillStyle = MEDAL[e.rank - 1];
    ctx.beginPath();
    ctx.arc(x + 22, cy - 1, 13, 0, Math.PI * 2);
    ctx.fill();
  }
  text(ctx, String(e.rank), x + 22, cy, {
    size: e.rank >= 100 ? 11 : 14,
    weight: '800',
    color: e.rank <= 3 ? '#1b2340' : 'rgba(255,255,255,0.75)',
    align: 'center',
    baseline: 'middle',
  });
  text(ctx, e.name, x + 46, cy, { size: 15, weight: '800', color: e.me ? accent : '#fff', baseline: 'middle' });
  const detail = mode === 'pack' ? `${e.detail}箱` : `${Number(e.detail).toFixed(1)}m`;
  text(ctx, detail, x + w - 140, cy, { size: 11, color: 'rgba(255,255,255,0.6)', align: 'right', baseline: 'middle' });
  text(ctx, `×${(C.SPEED_LEVELS[e.speed] ?? 1).toFixed(1)}`, x + w - 132, cy, {
    size: 11,
    weight: '800',
    color: SPEED_COLORS[e.speed] ?? '#fff',
    baseline: 'middle',
  });
  text(ctx, e.score.toLocaleString('ja-JP'), x + w - 10, cy, {
    size: 17,
    weight: '800',
    color: e.rank === 1 ? '#ffe08a' : '#fff',
    align: 'right',
    baseline: 'middle',
  });
}

function drawRanking(ctx, game) {
  // うしろの土台やスーツケースが透けて読みにくくならないよう、濃いめに暗くする
  dim(ctx, 0.93);
  const rk = game.ranking;
  const ui = game.rankingUi();
  const accent = MODE_ACCENT[rk.mode];
  text(ctx, '🏆 ランキング', C.VIEW.W / 2, 54, {
    size: 28,
    weight: '800',
    color: '#ffe08a',
    align: 'center',
    shadow: 2,
  });

  // モードのタブ
  for (const mode of ['stack', 'pack']) {
    const r = ui.tabs[mode];
    const sel = rk.mode === mode;
    const pressed = game.pressedBtn === `rank:${mode}`;
    panel(
      ctx,
      r.x,
      r.y,
      r.w,
      r.h,
      12,
      pressed ? 'rgba(255,255,255,0.26)' : sel ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.05)',
      sel ? MODE_ACCENT[mode] : 'rgba(255,255,255,0.18)',
    );
    text(ctx, MODE_NAME[mode], r.x + r.w / 2, r.y + r.h / 2 + 1, {
      size: 16,
      weight: '800',
      color: sel ? MODE_ACCENT[mode] : 'rgba(255,255,255,0.6)',
      align: 'center',
      baseline: 'middle',
    });
  }

  // 一覧
  const L = RANK_LIST;
  const listH = L.rowH * 10 + 12;
  panel(ctx, L.x, L.y, L.w, listH, 16, 'rgba(24,30,58,0.92)', 'rgba(255,255,255,0.14)');
  const data = rk.data;
  const midY = L.y + listH / 2;
  const center = (s, y, size, color, weight = '800') =>
    text(ctx, s, C.VIEW.W / 2, y, { size, weight, color, align: 'center', baseline: 'middle' });
  if (!data) {
    if (rk.status === 'error') {
      center('ランキングに つながりません', midY - 10, 17, '#ffb0a4');
      center('すこし待ってから もう一度 開いてください', midY + 18, 12, 'rgba(255,255,255,0.6)', '600');
    } else {
      center('よみこみ中…', midY, 17, 'rgba(255,255,255,0.7)');
    }
  } else if (!data.top.length) {
    center('まだ だれも いません', midY - 10, 17, '#fff');
    center('いま遊べば 1位！', midY + 18, 13, accent);
  } else {
    data.top.forEach((e, i) => drawRankRow(ctx, e, L.x + 8, L.y + 6 + i * L.rowH, L.w - 16, L.rowH, rk.mode, accent));
    // 10 位より下のときは、自分の順位を一覧の下に出す
    if (data.me && data.me.rank > data.top.length) {
      drawRankRow(ctx, data.me, L.x + 8, L.y + listH + 6, L.w - 16, L.rowH, rk.mode, accent);
    }
  }
  if (data) {
    const note = rk.status === 'error' ? 'つながらないので、前に読んだ一覧です' : '1人1つ(自己ベスト) ・ ×はクレーンのはやさ';
    text(ctx, `${data.total}人 ・ ${note}`, C.VIEW.W / 2, 618, {
      size: 11,
      color: rk.status === 'error' ? '#ffb0a4' : 'rgba(255,255,255,0.6)',
      align: 'center',
    });
  }

  // なまえ(押すと変えられる)
  const nb = ui.name;
  panel(
    ctx,
    nb.x,
    nb.y,
    nb.w,
    nb.h,
    14,
    game.pressedBtn === 'rank:name' ? 'rgba(255,255,255,0.26)' : 'rgba(255,255,255,0.1)',
    'rgba(255,255,255,0.32)',
  );
  text(ctx, `✎ なまえ: ${game.myName}`, nb.x + nb.w / 2, nb.y + nb.h / 2 + 1, {
    size: 15,
    weight: '800',
    color: '#fff',
    align: 'center',
    baseline: 'middle',
  });

  // もどる
  const bb = ui.back;
  panel(
    ctx,
    bb.x,
    bb.y,
    bb.w,
    bb.h,
    14,
    game.pressedBtn === 'rank:back' ? 'rgba(255,255,255,0.26)' : 'rgba(255,255,255,0.1)',
    'rgba(255,255,255,0.32)',
  );
  text(ctx, '◀ もどる', bb.x + bb.w / 2, bb.y + bb.h / 2 + 1, {
    size: 15,
    weight: '800',
    color: '#fff',
    align: 'center',
    baseline: 'middle',
  });

  text(ctx, '← → で切りかえ ・ N で なまえ ・ Esc で もどる', C.VIEW.W / 2, 772, {
    size: 11,
    color: 'rgba(255,255,255,0.45)',
    align: 'center',
  });
}

// ------------------------------------------------------------------ 本体

export function render(ctx, game) {
  ctx.save();
  ctx.clearRect(0, 0, C.VIEW.W, C.VIEW.H);
  drawSky(ctx, game);
  drawWindStreaks(ctx, game);

  ctx.save();
  ctx.translate(game.shake.x, game.shake.y);
  if (game.state !== 'title' && game.state !== 'ranking' && !game.isPack) drawHeightLines(ctx, game);

  ctx.save();
  ctx.translate(0, game.camY);
  if (game.isPack && game.state === 'ship') {
    drawShip(ctx, game);
  } else {
    if (game.isPack) drawBinBack(ctx, game.world.bin);
    else drawBase(ctx, game);
    for (const b of game.world.bodies) {
      if (b.plugin.g.kind === 'bag') drawBag(ctx, b);
      else drawItem(ctx, b);
    }
    if (game.isPack) drawBinFront(ctx, game, game.world.bin);
  }
  drawBanner(ctx, game);
  ctx.restore();

  // エフェクトと HUD はスクリーン座標
  ctx.save();
  ctx.translate(0, game.camY);
  drawFx(ctx, game);
  ctx.restore();

  if (game.state !== 'title' && game.state !== 'over' && game.state !== 'ranking') drawCrane(ctx, game);
  ctx.restore();

  if (game.state === 'title') drawTitle(ctx, game);
  else if (game.state === 'over') drawGameOver(ctx, game);
  else if (game.state === 'ranking') drawRanking(ctx, game);
  else drawHud(ctx, game);

  ctx.restore();
}
