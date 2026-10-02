// バッグの形(シルエット)。
// 物理の当たり判定と絵の両方でこの頂点列を使うので、見た目と当たり判定がずれない。

const cache = new WeakMap();
const centroidCache = new WeakMap();

/** 形の寸法。どのバッグも、全部の角を d.r で丸めた長方形 */
export function shapeOf(d) {
  const r0 = d.r ?? 0;
  return { top: d.w, bottom: d.w, h: d.h, r: [r0, r0, r0, r0] };
}

/**
 * 角を丸めた長方形の頂点列。箱の中心が原点で、画面座標で時計回り(Matter.js と同じ向き)。
 * 角は両隣の辺に接する円弧で丸める。
 */
export function bagOutline(d) {
  const hit = cache.get(d);
  if (hit) return hit;

  const { top, bottom, h, r } = shapeOf(d);
  const corners = [
    { x: -top / 2, y: -h / 2 },
    { x: top / 2, y: -h / 2 },
    { x: bottom / 2, y: h / 2 },
    { x: -bottom / 2, y: h / 2 },
  ];
  const pts = [];
  for (let i = 0; i < 4; i++) {
    const V = corners[i];
    const P = corners[(i + 3) % 4];
    const N = corners[(i + 1) % 4];
    const lp = Math.hypot(P.x - V.x, P.y - V.y);
    const ln = Math.hypot(N.x - V.x, N.y - V.y);
    const u1 = { x: (P.x - V.x) / lp, y: (P.y - V.y) / lp };
    const u2 = { x: (N.x - V.x) / ln, y: (N.y - V.y) / ln };
    const phi = Math.acos(Math.max(-1, Math.min(1, u1.x * u2.x + u1.y * u2.y)));
    const tanHalf = Math.tan(phi / 2);
    // 丸みは隣の辺の半分まで(隣の角と取り合わない)
    const t = Math.min(r[i] / tanHalf, lp / 2, ln / 2);
    const rad = t * tanHalf;
    if (rad < 0.5) {
      pts.push({ x: V.x, y: V.y });
      continue;
    }
    const t1 = { x: V.x + u1.x * t, y: V.y + u1.y * t };
    const t2 = { x: V.x + u2.x * t, y: V.y + u2.y * t };
    const bx = u1.x + u2.x;
    const by = u1.y + u2.y;
    const bl = Math.hypot(bx, by);
    const dist = rad / Math.sin(phi / 2);
    const O = { x: V.x + (bx / bl) * dist, y: V.y + (by / bl) * dist };
    const a1 = Math.atan2(t1.y - O.y, t1.x - O.x);
    let da = Math.atan2(t2.y - O.y, t2.x - O.x) - a1;
    while (da > Math.PI) da -= Math.PI * 2;
    while (da < -Math.PI) da += Math.PI * 2;
    // 15度ごとに分割(当たり判定の辺を増やしすぎない)
    const n = Math.max(2, Math.min(8, Math.ceil(Math.abs(da) / (Math.PI / 12))));
    for (let k = 0; k <= n; k++) {
      const a = a1 + (da * k) / n;
      pts.push({ x: O.x + Math.cos(a) * rad, y: O.y + Math.sin(a) * rad });
    }
  }

  // 隣の角とつながって重なった点を取り除く(長さ0の辺は当たり判定を壊す)
  const out = [];
  for (const p of pts) {
    const q = out[out.length - 1];
    if (!q || Math.hypot(p.x - q.x, p.y - q.y) > 0.5) out.push(p);
  }
  const first = out[0];
  const last = out[out.length - 1];
  if (out.length > 3 && Math.hypot(first.x - last.x, first.y - last.y) <= 0.5) out.pop();

  cache.set(d, out);
  return out;
}

/** シルエットの重心(箱の中心からのずれ)。物理ボディの位置は重心になる */
export function outlineCentroid(d) {
  const hit = centroidCache.get(d);
  if (hit) return hit;
  const pts = bagOutline(d);
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    const cr = p.x * q.y - q.x * p.y;
    a += cr;
    cx += (p.x + q.x) * cr;
    cy += (p.y + q.y) * cr;
  }
  const c = { x: cx / (3 * a), y: cy / (3 * a) };
  centroidCache.set(d, c);
  return c;
}

/** シルエットのパスを作る(塗り・線・クリップに使う) */
export function tracePath(ctx, pts) {
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.closePath();
}
