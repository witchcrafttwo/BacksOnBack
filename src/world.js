import Matter from 'matter-js';
import { ITEMS } from './bags.js';
import * as C from './config.js';
import { bagOutline, outlineCentroid } from './shapes.js';

const { Engine, Composite, Bodies, Body, Events, Sleeping, Query } = Matter;

/** 速度の上限。めり込み解消で吹き飛ぶ事故を防ぐ安全弁 */
const MAX_SPEED = 20;
const MAX_SPIN = 0.9;

/** これ以上の風だと、眠っている(静止した)ボディも起こして揺らす */
const GUST_WAKE = 0.22;

/** トートなどが「こぼれる」傾き(rad)と継続時間(ms) */
const SPILL_ANGLE = 1.15;
const SPILL_TIME = 260;

/**
 * しぼむ速さ(縦倍率/秒)。一瞬で縮めると上のタワーが自由落下して崩れやすいので、
 * 空気が抜けるように少しずつ縮める。
 */
const DEFLATE_SPEED = 0.7;

let nextId = 1;

/** -PI..PI に正規化 */
const normAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const ZERO = { x: 0, y: 0 };

/** 基準フレーム(1/60秒)換算の速さ。サブステップ数に左右されない */
export const speedOf = (b) => Body.getSpeed(b);
export const spinOf = (b) => Body.getAngularSpeed(b);

/** 凸形ボディを縦線 x = X で切ったときの上の面の y。当たらなければ Infinity */
function topAt(body, X) {
  const v = body.vertices;
  let best = Infinity;
  for (let i = 0; i < v.length; i++) {
    const p = v[i];
    const q = v[(i + 1) % v.length];
    const lo = Math.min(p.x, q.x);
    const hi = Math.max(p.x, q.x);
    if (X < lo || X > hi) continue;
    const y = hi - lo < 1e-6 ? Math.min(p.y, q.y) : p.y + ((q.y - p.y) * (X - p.x)) / (q.x - p.x);
    if (y < best) best = y;
  }
  return best;
}

/** 動かない地形を1つ作る */
function makeStatic(x, y, w, h, opts) {
  const b = Bodies.rectangle(x, y, w, h, { isStatic: true, restitution: 0, ...opts });
  b.plugin.g = { kind: 'platform', squash: 0 };
  return b;
}

/**
 * つめこみモードの箱の形。L〜R が内側、floor が底の上面、wallTop が壁の上端、limit がファスナーの線。
 * type: 'normal' | 'carryon'(左右がせまい) | 'fragile'(大きさはふつう)
 */
export function makeBin(type = 'normal') {
  const inset = type === 'carryon' ? C.CARRYON_INSET : 0;
  return {
    type,
    L: C.BIN_L + inset,
    R: C.BIN_R - inset,
    wall: C.BIN_WALL,
    wallTop: C.BIN_WALL_TOP,
    limit: C.BIN_LIMIT_Y,
    floor: C.BIN_FLOOR_Y,
    floorH: C.BIN_FLOOR_H,
  };
}

/** 物理世界のラッパー。バッグ・中身・破裂・風をここで面倒みる。 */
export class GameWorld {
  constructor(hooks = {}) {
    this.hooks = hooks;

    this.engine = Engine.create({
      enableSleeping: true,
      positionIterations: 12,
      velocityIterations: 10,
      constraintIterations: 4,
    });
    this.engine.gravity.scale = 0.0011;
    this.world = this.engine.world;

    /**
     * 1フレームを何回に分けて解くか。1 だと着地のたびにめり込み補正で層が横滑りし、
     * まっすぐ積んでも 10 個前後で崩れる。3 でほぼ安定する。
     */
    this.substeps = 3;

    /** 管理下の動的ボディ(バッグと中身) */
    this.bodies = [];
    /** いま落下中のバッグ */
    this.activeBag = null;
    /** 動かない地形(つみあげ: 土台のトランク / つめこみ: スーツケースの底と壁) */
    this.statics = [];
    /** つめこみモードの箱の形 */
    this.bin = makeBin('normal');
    this.setMode('stack');

    this.reset();
    Events.on(this.engine, 'collisionStart', (e) => this.onCollisions(e));
  }

  /** モードに合わせて地形を作り直す */
  setMode(mode) {
    this.mode = mode;
    if (mode === 'pack') {
      this.setBin(makeBin('normal'));
      return;
    }
    this.clearStatics();
    // 土台の巨大トランク。角だけ少し丸い
    this.statics = [
      makeStatic(C.VIEW.W / 2, C.GROUND_Y + C.PLATFORM_H / 2, C.PLATFORM_W, C.PLATFORM_H, {
        chamfer: { radius: 8 },
        friction: 0.95,
        frictionStatic: 1.4,
      }),
    ];
    Composite.add(this.world, this.statics);
  }

  clearStatics() {
    for (const s of this.statics) Composite.remove(this.world, s);
    this.statics = [];
  }

  /** つめこみモードの箱(底と左右の壁)を作り直す */
  setBin(bin) {
    this.clearStatics();
    this.bin = bin;
    const wallH = bin.floor + bin.floorH - bin.wallTop;
    const wallY = bin.wallTop + wallH / 2;
    // 壁はすべりやすく(すき間に落ちていくように)、上の角は丸く(乗っても内か外に転がる)
    const wall = { friction: 0.25, frictionStatic: 0.4, chamfer: { radius: [7, 7, 0, 0] } };
    this.statics = [
      makeStatic((bin.L + bin.R) / 2, bin.floor + bin.floorH / 2, bin.R - bin.L + bin.wall * 2, bin.floorH, {
        friction: 0.8,
        frictionStatic: 1.0,
      }),
      makeStatic(bin.L - bin.wall / 2, wallY, bin.wall, wallH, wall),
      makeStatic(bin.R + bin.wall / 2, wallY, bin.wall, wallH, wall),
    ];
    Composite.add(this.world, this.statics);
    this.towerTopY = bin.floor;
  }

  /**
   * 箱を中身ごと運び出す。全部のボディを物理世界から外して返す。
   * 返したボディは位置や角度をそのまま持っているので、運ばれていく絵にそのまま使える。
   */
  takeAll() {
    const all = this.bodies;
    for (const b of all) Composite.remove(this.world, b);
    this.bodies = [];
    this.activeBag = null;
    this.towerTopY = this.bin.floor;
    return all;
  }

  /** 土台(つみあげ)/ スーツケースの底(つめこみ)。着地の弾みの演出に使う */
  get platform() {
    return this.statics[0];
  }

  reset(mode = this.mode) {
    if (mode !== this.mode) this.setMode(mode);
    for (const b of this.bodies ?? []) Composite.remove(this.world, b);
    this.bodies = [];
    this.activeBag = null;
    this.wind = { x: 0, target: 0, timer: 1600, max: 0 };
    this.loadTimer = 0;
    this.towerTopY = this.mode === 'pack' ? this.bin.floor : C.GROUND_Y;
    this.maxHeightPx = 0;
  }

  // ---------------------------------------------------------------- 生成

  /**
   * バッグを出す。(x, y) は箱の中心(クレーンで吊っていた絵の中心)。
   * 物理ボディの位置は形の重心なので、そのぶんずらして置く。
   */
  addBag(def, x, y, angle, vx = 0, vy = 0) {
    const c = outlineCentroid(def);
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const body = Body.create({
      label: 'Bag',
      position: { x: x + c.x * cos - c.y * sin, y: y + c.x * sin + c.y * cos },
      vertices: bagOutline(def).map((p) => ({ x: p.x, y: p.y })),
      angle,
      density: def.density,
      friction: def.friction,
      frictionStatic: def.frictionStatic,
      restitution: def.restitution,
      frictionAir: def.key === 'balloonbag' ? 0.05 : 0.014,
      slop: 0.05,
    });
    body.plugin.g = {
      kind: 'bag',
      id: nextId++,
      def,
      hp: def.hp,
      maxHp: def.hp,
      burst: false,
      placed: false,
      contents: [...def.contents],
      squash: 0,
      flash: 0,
      load: 0,
      /** しぼみ具合(縦方向の倍率)と、その目標値 */
      sy: 1,
      deflateTo: 1,
      tiltTime: 0,
      landedOn: null,
      /** 形の重心(箱の中心からのずれ)。絵を描くときに使う */
      cx: c.x,
      cy: c.y,
    };
    Body.setVelocity(body, { x: vx, y: vy });
    Composite.add(this.world, body);
    this.bodies.push(body);
    return body;
  }

  addItem(key, x, y, vx = 0, vy = 0, angle = 0) {
    const def = ITEMS[key];
    const opts = {
      angle,
      density: def.density,
      friction: def.friction,
      frictionStatic: def.frictionStatic,
      restitution: def.restitution,
      frictionAir: def.buoyant ? 0.045 : 0.012,
      slop: 0.02,
    };
    const body =
      def.shape === 'circle'
        ? Bodies.circle(x, y, def.r, opts, 14)
        : Bodies.rectangle(x, y, def.w, def.h, {
            ...opts,
            chamfer: { radius: Math.min(3, Math.min(def.w, def.h) / 2 - 1) },
          });
    body.plugin.g = { kind: 'item', id: nextId++, key, def, squash: 0, flash: 0 };
    Body.setVelocity(body, { x: vx, y: vy });
    Body.setAngularVelocity(body, C.rand(-0.16, 0.16));
    Composite.add(this.world, body);
    this.bodies.push(body);
    return body;
  }

  remove(body) {
    const i = this.bodies.indexOf(body);
    if (i >= 0) this.bodies.splice(i, 1);
    Composite.remove(this.world, body);
    if (this.activeBag === body) this.activeBag = null;
  }

  // ---------------------------------------------------------------- 衝突

  onCollisions(event) {
    for (const pair of event.pairs) {
      const { bodyA, bodyB, collision } = pair;
      const ga = bodyA.plugin.g;
      const gb = bodyB.plugin.g;
      if (!ga || !gb) continue;

      // サブステップ中は body.velocity が小さく出るので、基準フレーム換算の速度を使う
      const va = bodyA.isStatic ? ZERO : Body.getVelocity(bodyA);
      const vb = bodyB.isStatic ? ZERO : Body.getVelocity(bodyB);
      const n = collision.normal;
      const vn = Math.abs((vb.x - va.x) * n.x + (vb.y - va.y) * n.y);

      // 衝撃 = ぶつかってきた側(速い方)の運動量。
      // 重いバッグを落とすと下のバッグが痛む、という直感どおりになる。
      let hit;
      if (bodyA.isStatic) hit = vn * bodyB.mass * C.SELF_IMPACT;
      else if (bodyB.isStatic) hit = vn * bodyA.mass * C.SELF_IMPACT;
      else hit = vn * (Math.hypot(va.x, va.y) >= Math.hypot(vb.x, vb.y) ? bodyA.mass : bodyB.mass);

      // 落下中のバッグの「最初の着地相手」を記録(パーフェクト判定に使う)
      if (bodyA === this.activeBag && !ga.landedOn) ga.landedOn = bodyB;
      if (bodyB === this.activeBag && !gb.landedOn) gb.landedOn = bodyA;

      if (hit > 14) {
        const p = collision.supportCount > 0 && collision.supports[0]
          ? collision.supports[0]
          : {
              x: (bodyA.position.x + bodyB.position.x) / 2,
              y: (bodyA.position.y + bodyB.position.y) / 2,
            };
        this.hooks.onThud?.({ x: p.x, y: p.y }, hit);
      }

      // 見た目の潰れ(土台のトランクも少し弾む)
      const squash = Math.min(1, hit / 150);
      ga.squash = Math.max(ga.squash, squash);
      gb.squash = Math.max(gb.squash, squash);

      const dmg = (hit - C.IMPACT_FREE) * C.IMPACT_SCALE;
      if (dmg > 0) {
        if (ga.kind === 'bag') this.damage(bodyA, dmg);
        if (gb.kind === 'bag') this.damage(bodyB, dmg);
      }
    }
  }

  damage(body, amount) {
    const g = body.plugin.g;
    if (g.burst || amount <= 0) return;
    const before = g.hp / g.maxHp;
    g.hp -= amount;
    g.flash = Math.max(g.flash, Math.min(1, amount / 14));
    const after = g.hp / g.maxHp;
    if (before > 0.5 && after <= 0.5) this.hooks.onCreak?.(body, 0);
    else if (before > 0.22 && after <= 0.22) this.hooks.onCreak?.(body, 1);
    if (g.hp <= 0) this.burst(body, 'burst');
  }

  /**
   * バッグの縦方向だけを縮める(中身が抜けてぺしゃんこ)。
   * Body.scale はワールド軸で拡縮し、速度補正もしないので
   * 「角度0に戻す → 拡縮 → 角度を戻す → 底面が動かないよう位置をずらす」の順で行う。
   */
  deflate(body, sy) {
    if (sy >= 0.999) return;
    const g = body.plugin.g;
    const a = body.angle;
    const H = g.def.h;
    Body.setAngle(body, 0);
    Body.scale(body, 1, sy); // 重心を中心に縦だけ縮む
    Body.setAngle(body, a);
    // 地面側を向いている面を固定し、反対側がしぼむように中心をずらす。
    // 面の位置は重心からの距離(重心は箱の中心から cy ずれている)
    const bottom = (H / 2 - g.cy) * g.sy;
    const top = (-H / 2 - g.cy) * g.sy;
    const shift = (Math.cos(a) >= 0 ? bottom : top) * (1 - sy);
    Body.setPosition(body, {
      x: body.position.x - Math.sin(a) * shift,
      y: body.position.y + Math.cos(a) * shift,
    });
    g.sy *= sy;
  }

  /**
   * x の真下にある一番高い面の y(落下ガイド用)。何もなければ Infinity。
   * 落下中のバッグと、まだ飛んでいる中身は数えない。
   */
  surfaceY(x) {
    let best = Infinity;
    for (const s of this.statics) best = Math.min(best, topAt(s, x));
    for (const b of this.bodies) {
      if (b === this.activeBag) continue;
      if (b.plugin.g.kind === 'item' && speedOf(b) > 1.6) continue;
      if (x < b.bounds.min.x || x > b.bounds.max.x) continue;
      const y = topAt(b, x);
      if (y < best) best = y;
    }
    return best;
  }

  /** 箱の中心(絵の中心)のワールド座標 */
  boxCenter(body) {
    const g = body.plugin.g;
    const lx = -g.cx;
    const ly = -g.cy * g.sy;
    const cos = Math.cos(body.angle);
    const sin = Math.sin(body.angle);
    return { x: body.position.x + lx * cos - ly * sin, y: body.position.y + lx * sin + ly * cos };
  }

  /**
   * 中身を出すための空きスペースを探す。
   * 他のボディに重なった位置で生成すると、めり込み解消でタワーが吹き飛ぶため必須。
   */
  findFreeSpot(cx, cy, baseAngle, r) {
    const dists = [16, 26, 38, 52, 68, 86];
    const offs = [0, 0.3, -0.3, 0.6, -0.6, 1.0, -1.0, 1.5, -1.5, 2.3, -2.3, Math.PI];
    for (const d of dists) {
      for (const o of offs) {
        const a = baseAngle + o;
        const x = cx + Math.cos(a) * d;
        const y = cy + Math.sin(a) * d;
        if (this.mode === 'stack' && y > C.GROUND_Y - r - 2) continue; // 土台より下には出さない
        if (x < r || x > C.VIEW.W - r) continue;
        const pad = r + 2;
        const bounds = { min: { x: x - pad, y: y - pad }, max: { x: x + pad, y: y + pad } };
        // 地形(土台・スーツケースの壁)にも、他のボディにも重ならない所だけ
        if (Query.region(this.statics, bounds).length) continue;
        if (Query.region(this.bodies, bounds).length === 0) return { x, y, angle: a };
      }
    }
    return null;
  }

  /**
   * 中身が飛び出す。
   * reason: 'burst' = 耐久切れでジッパー決壊 / 'spill' = 傾いてこぼれた
   */
  burst(body, reason = 'burst') {
    const g = body.plugin.g;
    if (g.burst) return;
    g.burst = true;
    g.hp = 0;

    // 中身が無くなるので軽くなり、布がへたって摩擦は少し上がる。
    // やわらかいバッグはしぼんで(step で少しずつ)、上のタワーが沈む。
    Body.setDensity(body, g.def.density * 0.4);
    body.friction = Math.min(0.96, g.def.friction + 0.16);
    body.frictionStatic = g.def.frictionStatic + 0.2;
    const flat = g.def.deflate ?? 1;
    g.deflateTo = reason === 'spill' ? Math.max(0.85, flat) : flat;

    // 口の向き(バッグのローカル上方向)から吐き出す
    const a = body.angle;
    const up = { x: Math.sin(a), y: -Math.cos(a) };
    const half = (g.def.h * g.sy) / 2;
    const center = this.boxCenter(body);
    const mouth = {
      x: center.x + up.x * (half - 3),
      y: center.y + up.y * (half - 3),
    };
    const baseAngle = Math.atan2(up.y, up.x);

    const spawned = [];
    const n = g.contents.length;
    g.contents.forEach((key, i) => {
      const idef = ITEMS[key];
      const r = idef.shape === 'circle' ? idef.r : Math.max(idef.w, idef.h) / 2;
      const spread = ((i - (n - 1) / 2) / Math.max(1, n)) * 1.5 + C.rand(-0.18, 0.18);
      const spot = this.findFreeSpot(mouth.x, mouth.y, baseAngle + spread, r) ?? {
        // タワーがぎっしりで隙間が無いときは、上から降らせる
        x: body.position.x + C.rand(-22, 22),
        y: Math.min(this.towerTopY, body.bounds.min.y) - 36 - i * 26,
        angle: -Math.PI / 2,
      };
      const speed = C.rand(3.2, 5.6);
      spawned.push(
        this.addItem(
          key,
          spot.x,
          spot.y,
          Math.cos(spot.angle) * speed,
          Math.sin(spot.angle) * speed,
          C.rand(-Math.PI, Math.PI),
        ),
      );
    });
    g.contents = [];

    // まわりを起こす
    for (const b of this.bodies) if (b.isSleeping) Sleeping.set(b, false);

    this.hooks.onBurst?.(body, mouth, spawned, reason);
  }

  // ---------------------------------------------------------------- 毎フレーム

  /** 上に乗っている重さでじわじわ潰れる。耐えられる重さ(cap)はバッグごとに違う */
  updateLoad(dtMs) {
    this.loadTimer -= dtMs;
    if (this.loadTimer > 0) return;
    const tick = 320;
    this.loadTimer = tick;

    for (const bag of this.bodies) {
      const g = bag.plugin.g;
      if (g.kind !== 'bag') continue;
      let massAbove = 0;
      const top = bag.bounds.min.y;
      for (const o of this.bodies) {
        if (o === bag || o === this.activeBag) continue;
        if (o.position.y > top) continue;
        if (o.bounds.max.x < bag.bounds.min.x - 6) continue;
        if (o.bounds.min.x > bag.bounds.max.x + 6) continue;
        massAbove += o.mass;
      }
      g.load = massAbove / g.def.cap; // 1 を超えると重量オーバー
      if (g.burst || !g.placed) continue;
      if (g.load > 1) this.damage(bag, (g.load - 1) * C.LOAD_RATE * (tick / 1000));
    }
  }

  /** トートなど口の開いたバッグは、傾くと中身がこぼれる */
  updateSpill(dtMs) {
    for (const b of this.bodies) {
      const g = b.plugin.g;
      if (g.kind !== 'bag' || g.burst || !g.def.spill) continue;
      if (!g.placed && b !== this.activeBag) continue;
      if (Math.abs(normAngle(b.angle)) > SPILL_ANGLE) {
        g.tiltTime += dtMs;
        if (g.tiltTime > SPILL_TIME) this.burst(b, 'spill');
      } else {
        g.tiltTime = 0;
      }
    }
  }

  updateWind(dtMs, heightM) {
    const w = this.wind;
    w.max = C.clamp((heightM - C.WIND_START_M) / (C.WIND_FULL_M - C.WIND_START_M), 0, 1);
    w.timer -= dtMs;
    if (w.timer <= 0) {
      w.timer = C.rand(2000, 4600);
      if (w.max <= 0) w.target = 0;
      else {
        w.target = C.rand(-1, 1) * w.max;
        if (Math.abs(w.target) < 0.25 * w.max) w.target = 0; // 凪も混ぜる
      }
    }
    if (w.max <= 0) w.target = 0;
    const k = 1 - Math.pow(0.02, dtMs / 1000);
    w.x = C.lerp(w.x, w.target, k);
  }

  applyForces() {
    const wx = this.wind.x;
    const windy = Math.abs(wx) > 0.03;
    // 弱い風は動いているもの(落下中のバッグなど)だけを押す。
    // Matter.js は力のかかったボディを自動で起こすので、眠っているボディには触らない。
    // (静止中のタワーを毎フレーム起こすと、じわじわ崩れていく)
    const gust = Math.abs(wx) > GUST_WAKE;
    for (const b of this.bodies) {
      const g = b.plugin.g;
      if (windy && (gust || !b.isSleeping)) {
        const area = g.kind === 'bag' ? (g.def.w * g.def.h * g.sy) / 7040 : 0.4;
        const sail = g.def.sail ?? 1;
        Body.applyForce(b, b.position, { x: wx * b.mass * 0.00013 * area * sail, y: 0 });
      }
      if (g.kind === 'item' && g.def.buoyant) {
        if (b.isSleeping) Sleeping.set(b, false);
        Body.applyForce(b, b.position, { x: 0, y: -b.mass * 0.0011 * g.def.buoyant });
      }
    }
  }

  /** 画面外に消えたものを掃除。戻り値は失われたボディの一覧。 */
  sweep() {
    const lost = [];
    const escapeY = this.towerTopY - 1100;
    for (let i = this.bodies.length - 1; i >= 0; i--) {
      const b = this.bodies[i];
      const g = b.plugin.g;
      const fell = b.position.y > C.FALL_LIMIT_Y;
      const sideways = b.position.x < -200 || b.position.x > C.VIEW.W + 200;
      const flewAway = b.position.y < escapeY;
      if (fell || sideways || flewAway) {
        lost.push({ body: b, g, reason: flewAway ? 'sky' : 'fall' });
        this.remove(b);
      }
    }
    return lost;
  }

  /**
   * 積み上がったいちばん上(ワールド y)。落下中のバッグと、飛んでいる中身は数えない。
   * つめこみモードでは、スーツケースの内側にある物だけで測る(はみ出し判定に使う)。
   */
  computeTowerTop() {
    if (this.mode === 'pack') {
      const bin = this.bin;
      let top = bin.floor;
      for (const b of this.bodies) {
        const g = b.plugin.g;
        if (g.kind === 'bag' && !g.placed) continue;
        if (g.kind === 'item' && (g.def.buoyant || speedOf(b) > 1.6)) continue;
        if (b.position.x < bin.L || b.position.x > bin.R) continue;
        if (b.bounds.min.y < top) top = b.bounds.min.y;
      }
      this.towerTopY = top;
      return top;
    }
    let top = C.GROUND_Y;
    for (const b of this.bodies) {
      const g = b.plugin.g;
      if (g.kind === 'bag' && !g.placed) continue;
      if (g.kind === 'item' && (g.def.buoyant || speedOf(b) > 1.6)) continue;
      if (b.position.x < C.PLATFORM_L - 90 || b.position.x > C.PLATFORM_R + 90) continue;
      if (b.position.y > C.GROUND_Y + 10) continue;
      if (b.bounds.min.y < top) top = b.bounds.min.y;
    }
    this.towerTopY = top;
    this.maxHeightPx = Math.max(this.maxHeightPx, C.GROUND_Y - top);
    return top;
  }

  /** 積んだ高さ(つみあげモードだけ。つめこみモードでは 0) */
  get heightPx() {
    if (this.mode === 'pack') return 0;
    return Math.max(0, C.GROUND_Y - this.towerTopY);
  }

  /**
   * つめこみモードの集計。
   * count: スーツケースの中で落ち着いたバッグの数
   * fill : 中にある物の面積 ÷ ファスナーの線から下の広さ
   */
  binStats() {
    const bin = this.bin;
    let count = 0;
    let area = 0;
    for (const b of this.bodies) {
      const g = b.plugin.g;
      if (g.kind === 'bag' && !g.placed) continue;
      const { x, y } = b.position;
      if (x < bin.L || x > bin.R || y < bin.wallTop || y > bin.floor) continue;
      if (g.kind === 'bag') count++;
      area += b.area;
    }
    const capacity = (bin.R - bin.L) * (bin.floor - bin.limit);
    return { count, fill: area / capacity };
  }

  get heightM() {
    return this.heightPx / C.PX_PER_M;
  }

  /** 固定ステップで1フレーム進める */
  step(dtMs) {
    // 風は高く積んだときだけ(つめこみモードは室内なので吹かない)
    if (this.mode === 'stack') this.updateWind(dtMs, this.heightM);
    this.updateLoad(dtMs);
    // 力は Engine.update ごとにリセットされるので、サブステップ毎にかけ直す
    const sub = this.substeps;
    for (let i = 0; i < sub; i++) {
      this.applyForces();
      Engine.update(this.engine, dtMs / sub);
    }
    this.updateSpill(dtMs);

    for (const s of this.statics) s.plugin.g.squash *= 0.86;
    for (const b of this.bodies) {
      const g = b.plugin.g;
      g.squash *= 0.86;
      g.flash *= 0.88;
      // 破裂したバッグを少しずつしぼませる
      if (g.kind === 'bag' && g.deflateTo < g.sy - 0.001) {
        const next = Math.max(g.deflateTo, g.sy - (DEFLATE_SPEED * dtMs) / 1000);
        this.deflate(b, next / g.sy);
        if (b.isSleeping) Sleeping.set(b, false);
      }
      // 安全弁: 異常な速度が出たら丸める
      if (b.isSleeping) continue;
      const v = Body.getVelocity(b);
      const sp = Math.hypot(v.x, v.y);
      if (sp > MAX_SPEED) {
        const k = MAX_SPEED / sp;
        Body.setVelocity(b, { x: v.x * k, y: v.y * k });
      }
      const av = Body.getAngularVelocity(b);
      if (Math.abs(av) > MAX_SPIN) Body.setAngularVelocity(b, Math.sign(av) * MAX_SPIN);
    }
    this.computeTowerTop();
  }
}
