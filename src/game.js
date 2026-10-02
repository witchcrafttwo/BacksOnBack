import * as C from './config.js';
import { GameWorld, makeBin, speedOf, spinOf } from './world.js';
import { rollBag, BAG_BY_KEY } from './bags.js';
import { render } from './render.js';
import * as A from './audio.js';

const STEP = 1000 / 60;
/** ミス直後、連鎖で落ちたバッグを同じミスとして扱う時間(ms) */
const LOSS_GRACE = 2200;
/** 往復運動の端の丸め具合(1 に近いほど三角波に近い) */
const SWEEP_K = 0.985;
const SWEEP_NORM = Math.asin(SWEEP_K);
/** 「はやさ」選択の行の上端(画面ごと) */
const SPEED_ROW_Y = { title: 592, over: 492 };
/** タイトル画面のモード選択カード */
const MODE_CARD = { y: 328, h: 112 };
/** ゲームオーバー画面の「タイトルへ」ボタン */
const TITLE_BTN = { x: C.VIEW.W / 2 - 90, y: 602, w: 180, h: 44 };

/** モードの名前(画面表示用) */
export const MODE_LABEL = { stack: 'つみあげ', pack: 'つめこみ' };

function loadNumber(key) {
  try {
    return Number(localStorage.getItem(key) || 0) || 0;
  } catch {
    return 0;
  }
}

/** 前回遊んだモード */
function loadMode() {
  try {
    return localStorage.getItem(C.MODE_KEY) === 'pack' ? 'pack' : 'stack';
  } catch {
    return 'stack';
  }
}

/** つまり具合に応じた得点の倍率 */
export function fillMultiplier(fill) {
  for (const [min, mult] of C.FILL_TIERS) if (fill >= min) return mult;
  return 1;
}

/** 何箱目にどの種類の箱を出すか。最初の4箱は決まった順で、そのあとはランダム */
function pickBoxType(no) {
  if (no <= 2) return 'normal';
  if (no === 3) return 'carryon';
  if (no === 4) return 'fragile';
  const r = Math.random();
  return r < 0.5 ? 'normal' : r < 0.75 ? 'carryon' : 'fragile';
}

const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

/** 保存してある「はやさ」の段階。無い・壊れているときは一番遅い段階 */
function loadSpeedLevel() {
  try {
    const raw = localStorage.getItem(C.SPEED_KEY);
    const v = raw === null ? 0 : Number(raw);
    if (Number.isInteger(v) && v >= 0 && v < C.SPEED_LEVELS.length) return v;
  } catch {
    /* localStorage が使えない環境は無視 */
  }
  return 0;
}

export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.dpr = 1;

    this.world = new GameWorld({
      onThud: (p, imp) => this.onThud(p, imp),
      onBurst: (body, mouth, items, reason) => this.onBurst(body, mouth, items, reason),
      onCreak: (body, lv) => A.sfxCreak(lv),
    });
    this.lossGrace = 0;

    this.state = 'title';
    this.time = 0;
    this.acc = 0;
    this.last = 0;
    this.inputLock = 0;

    /** 'stack' = つみあげ / 'pack' = つめこみ(スーツケースに何個入るか) */
    this.mode = loadMode();
    this.world.reset(this.mode);
    /** つみあげ: 得点 / つめこみ: 入れた個数 */
    this.score = 0;
    this.displayScore = 0;
    this.bests = { stack: loadNumber(C.STORAGE_KEY), pack: loadNumber(C.STORAGE_KEY_PACK) };
    this.best = this.bests[this.mode];
    /** つめこみモード: いまの箱の集計とはみ出し時間 */
    this.packStats = { count: 0, fill: 0 };
    this.overflowTime = 0;
    this.dropFromTop = 0;
    /** 出荷ループ: 何箱目か、箱の種類、ノルマ、この箱に入れた数と破裂数、出荷の記録 */
    this.boxNo = 1;
    this.boxType = 'normal';
    this.quota = C.QUOTA_START;
    this.boxBags = 0;
    this.boxBursts = 0;
    this.shippedBoxes = 0;
    this.shippedBags = 0;
    /** 出荷中のアニメーション(null = していない) */
    this.ship = null;
    /** 箱が来たときに出す案内 */
    this.banner = null;
    /** クレーンの「はやさ」の段階(C.SPEED_LEVELS の添字) */
    this.speedLevel = loadSpeedLevel();
    this.lives = C.START_LIVES;
    this.combo = 0;
    this.comboPop = 1;
    this.placedCount = 0;
    this.burstCount = 0;
    this.newBest = false;
    this.overReason = '';
    this.recordPx = 0;

    this.camY = 0;
    this.shake = { x: 0, y: 0, mag: 0 };

    this.crane = {
      x: C.VIEW.W / 2,
      prevX: C.VIEW.W / 2,
      vx: 0,
      /** 往復運動の位相 */
      phase: 0,
      screenY: C.GROUND_Y - C.DROP_GAP,
      swing: 0,
      swingV: 0,
      rot: 0,
    };

    this.held = null;
    this.next = rollBag(0);
    this.aimTime = C.AIM_TIME_BASE;
    this.aimTimer = C.AIM_TIME_BASE;
    this.dropTimer = 0;
    this.settleHold = 0;
    this.settleDelay = 0;

    this.fx = [];
    this.titleStack = [BAG_BY_KEY.duffel, BAG_BY_KEY.backpack, BAG_BY_KEY.paper];

    this.pressedBtn = null;

    const fy = C.FOOTER_Y + 14;
    this.buttons = {
      rotL: { id: 'rotL', x: 296, y: fy, w: 56, h: 46 },
      rotR: { id: 'rotR', x: 358, y: fy, w: 56, h: 46 },
      mute: { id: 'mute', x: 424, y: fy + 4, w: 40, h: 38 },
      // つめこみモードだけ: 箱をしめて出荷する
      close: { id: 'close', x: 192, y: fy, w: 98, h: 46, packOnly: true },
    };

    this.bindEvents();
    this.resize();
  }

  get aimLeft() {
    return this.aimTimer / this.aimTime;
  }

  get isPack() {
    return this.mode === 'pack';
  }

  // ---------------------------------------------------------------- 入出力

  bindEvents() {
    const cv = this.canvas;
    cv.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    cv.addEventListener('pointerup', (e) => this.onPointerUp(e));
    cv.addEventListener('pointercancel', () => {
      this.pressedBtn = null;
    });
    cv.addEventListener('contextmenu', (e) => e.preventDefault());

    window.addEventListener('keydown', (e) => this.onKeyDown(e));
    window.addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => {
      this.last = 0;
    });
  }

  resize() {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(C.VIEW.W * this.dpr);
    this.canvas.height = Math.round(C.VIEW.H * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.ctx.imageSmoothingQuality = 'high';
  }

  toLocal(e) {
    const r = this.canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / r.width) * C.VIEW.W,
      y: ((e.clientY - r.top) / r.height) * C.VIEW.H,
    };
  }

  hitButton(p) {
    for (const b of Object.values(this.buttons)) {
      if (b.packOnly && !this.isPack) continue;
      if (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) return b;
    }
    return null;
  }

  onPointerDown(e) {
    A.unlockAudio();
    const p = this.toLocal(e);
    const inside = (r) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;

    if (this.state === 'title' || this.state === 'over') {
      // 「はやさ」の選択。ここを押したときはゲームを始めない
      const level = this.hitSpeed(p);
      if (level !== null) {
        this.pressedBtn = 'speed';
        this.setSpeed(level);
        return;
      }
      if (this.state === 'title') {
        // モードのカード。指を離したときに始める
        const ui = this.modeUi();
        if (inside(ui.stack)) this.pressedBtn = 'mode:stack';
        else if (inside(ui.pack)) this.pressedBtn = 'mode:pack';
        else this.pressedBtn = 'none'; // カード以外を押しても始めない
      } else if (inside(TITLE_BTN)) {
        this.pressedBtn = 'toTitle';
      }
      return;
    }

    const btn = this.hitButton(p);
    if (btn) {
      this.pressedBtn = btn.id;
      if (btn.id === 'close') {
        this.closeBox(); // 音は closeBox の中で鳴らす
        return;
      }
      if (btn.id === 'mute') A.toggleMute();
      else this.rotate(btn.id === 'rotL' ? -1 : 1);
      A.sfxClick();
      return;
    }
    // 操作パネルの空いている所をタップしても落とさない
    if (p.y >= C.FOOTER_Y) {
      this.pressedBtn = 'footer';
      return;
    }
    // タイミング勝負なので、指が触れた瞬間に落とす
    this.pressedBtn = 'drop';
    if (this.inputLock <= 0) this.drop();
  }

  /** タイトル画面のモード選択カードの位置(描画と当たり判定で共有) */
  modeUi() {
    const gap = 12;
    const w = (C.VIEW.W - 80 - gap) / 2;
    return {
      stack: { x: 40, y: MODE_CARD.y, w, h: MODE_CARD.h },
      pack: { x: 40 + w + gap, y: MODE_CARD.y, w, h: MODE_CARD.h },
    };
  }

  /** ゲームオーバー画面の「タイトルへ」ボタン */
  get titleButton() {
    return TITLE_BTN;
  }

  /** タイトル画面で選んでいるモードを変える(背景もそのモードの入れ物にする) */
  selectMode(mode) {
    if (mode === this.mode) return;
    this.mode = mode;
    this.best = this.bests[mode];
    this.world.reset(mode);
    try {
      localStorage.setItem(C.MODE_KEY, mode);
    } catch {
      /* 保存できなくても遊べる */
    }
    A.sfxClick();
  }

  toTitle() {
    this.state = 'title';
    this.held = null;
    this.ship = null;
    this.banner = null;
    this.world.reset(this.mode);
    if (this.isPack) this.world.setBin(makeBin('normal'));
    this.camY = 0;
    this.fx.length = 0;
    this.overflowTime = 0;
    this.inputLock = 250;
  }

  /** タイトル・ゲームオーバー画面の「はやさ」選択の位置(描画と当たり判定で共有) */
  speedUi() {
    const y = this.state === 'over' ? SPEED_ROW_Y.over : SPEED_ROW_Y.title;
    const n = C.SPEED_LEVELS.length;
    const segW = 36;
    const gap = 4;
    const rowW = n * segW + (n - 1) * gap;
    const x0 = C.VIEW.W / 2 - rowW / 2;
    return {
      y,
      minus: { x: x0 - 62, y, w: 52, h: 44 },
      plus: { x: x0 + rowW + 10, y, w: 52, h: 44 },
      segs: Array.from({ length: n }, (_, i) => ({ x: x0 + i * (segW + gap), y, w: segW, h: 44 })),
    };
  }

  /** 「はやさ」選択のどこを押したか。押した先の段階を返す(外なら null) */
  hitSpeed(p) {
    const ui = this.speedUi();
    const inside = (r) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
    if (inside(ui.minus)) return this.speedLevel - 1;
    if (inside(ui.plus)) return this.speedLevel + 1;
    const i = ui.segs.findIndex(inside);
    return i >= 0 ? i : null;
  }

  /** 「はやさ」の段階を変えて保存する */
  setSpeed(level) {
    const next = C.clamp(level, 0, C.SPEED_LEVELS.length - 1);
    if (next === this.speedLevel) return;
    this.speedLevel = next;
    try {
      localStorage.setItem(C.SPEED_KEY, String(next));
    } catch {
      /* 保存できなくても遊べる */
    }
    A.sfxClick();
  }

  onPointerUp() {
    // スマホは指を離したとき(pointerup)にしか音の再生を許可しないので、ここでも解放する
    A.unlockAudio();
    const wasBtn = this.pressedBtn;
    this.pressedBtn = null;
    if (wasBtn?.startsWith('mode:') && this.state === 'title' && this.inputLock <= 0) {
      this.mode = wasBtn.slice(5);
      this.start(this.mode);
      return;
    }
    if (wasBtn === 'toTitle' && this.state === 'over' && this.inputLock <= 0) {
      this.toTitle();
      return;
    }
    if (wasBtn) return;
    // ゲームオーバー画面は指を離したときにもう一度
    if (this.state === 'over') this.confirm();
  }

  onKeyDown(e) {
    const menu = this.state === 'title' || this.state === 'over';
    if (e.code === 'Space' || e.code === 'Enter') {
      e.preventDefault();
      A.unlockAudio();
      if (!e.repeat) this.confirm();
    } else if (menu && (e.code === 'ArrowLeft' || e.code === 'ArrowRight')) {
      // タイトル・ゲームオーバー画面では ← → で「はやさ」を変える
      e.preventDefault();
      this.setSpeed(this.speedLevel + (e.code === 'ArrowLeft' ? -1 : 1));
    } else if (this.state === 'title' && (e.code === 'ArrowUp' || e.code === 'ArrowDown' || e.code === 'Tab')) {
      // タイトル画面では ↑ ↓ / Tab でモードを切り替える
      e.preventDefault();
      this.selectMode(this.isPack ? 'stack' : 'pack');
    } else if (this.state === 'over' && (e.code === 'Escape' || e.code === 'Backspace')) {
      e.preventDefault();
      if (this.inputLock <= 0) this.toTitle();
    } else if (this.isPack && !menu && (e.code === 'ArrowDown' || e.code === 'KeyC')) {
      // つめこみモード: ↓ / C で箱をしめて出荷
      e.preventDefault();
      this.closeBox();
    } else if (menu && /^(Digit|Numpad)[1-9]$/.test(e.code)) {
      const i = Number(e.code.slice(-1)) - 1;
      if (i < C.SPEED_LEVELS.length) this.setSpeed(i);
    } else if (e.code === 'ArrowLeft' || e.code === 'KeyZ' || e.code === 'Comma') {
      e.preventDefault();
      this.rotate(-1);
    } else if (e.code === 'ArrowRight' || e.code === 'KeyX' || e.code === 'Period') {
      e.preventDefault();
      this.rotate(1);
    } else if (e.code === 'KeyM') {
      A.unlockAudio();
      A.toggleMute();
    }
  }

  /** タップ/スペースの共通処理 */
  confirm() {
    if (this.inputLock > 0) return;
    if (this.state === 'title' || this.state === 'over') this.start();
    else if (this.state === 'aim') this.drop();
  }

  rotate(dir) {
    if (this.state !== 'aim') return;
    // 22.5° ずつ。4回で横倒し(90°)にできる
    this.crane.rot = C.clamp(this.crane.rot + (dir * Math.PI) / 8, -Math.PI / 2, Math.PI / 2);
    A.sfxClick();
  }

  // ---------------------------------------------------------------- 進行

  start(mode = this.mode) {
    this.mode = mode;
    try {
      localStorage.setItem(C.MODE_KEY, mode);
    } catch {
      /* 保存できなくても遊べる */
    }
    this.best = this.bests[mode];
    this.world.reset(mode);
    this.packStats = { count: 0, fill: 0 };
    this.overflowTime = 0;
    this.state = 'aim';
    this.score = 0;
    this.displayScore = 0;
    this.lives = C.START_LIVES;
    this.combo = 0;
    this.placedCount = 0;
    this.burstCount = 0;
    this.newBest = false;
    this.recordPx = 0;
    this.lossGrace = 0;
    this.camY = 0;
    this.fx.length = 0;
    this.ship = null;
    this.banner = null;
    this.shippedBoxes = 0;
    this.shippedBags = 0;
    if (this.isPack) {
      this.setupBox(1);
      this.showBoxBanner();
    }
    // 往復の途中から始める(毎回同じ位置・向きにならないように)
    this.crane.range = this.sweepRangeTarget;
    this.crane.phase = Math.random() * Math.PI * 2;
    this.crane.x = this.sweepX(this.crane.phase);
    this.crane.prevX = this.crane.x;
    this.crane.vx = 0;
    this.crane.screenY = this.isPack ? C.PACK_CRANE_Y : C.GROUND_Y - C.DROP_GAP;
    this.crane.swing = 0;
    this.crane.swingV = 0;
    this.next = rollBag(0);
    this.inputLock = 250;
    this.spawnNext();
  }

  spawnNext() {
    this.held = this.next;
    this.next = rollBag(this.placedCount + 1);
    this.crane.rot = 0;
    this.aimTime = Math.max(C.AIM_TIME_MIN, C.AIM_TIME_BASE - this.placedCount * 160);
    this.aimTimer = this.aimTime;
    this.state = 'aim';
  }

  /** クレーンにぶら下がっているバッグの現在位置(スクリーン座標) */
  heldTransform() {
    const d = this.held;
    const cr = this.crane;
    const hookY = cr.screenY - 4;
    const ex = cr.x + Math.sin(cr.swing) * C.ROPE_LEN;
    const ey = hookY + Math.cos(cr.swing) * C.ROPE_LEN;
    return { x: ex, y: ey + 6 + d.h / 2, angle: cr.rot + cr.swing * 0.5 };
  }

  drop() {
    if (this.state !== 'aim' || !this.held) return;
    const d = this.held;
    const t = this.heldTransform();
    // フックから真下に外れる(ガイド線の位置にそのまま落ちる)
    const body = this.world.addBag(d, t.x, t.y - this.camY, t.angle, 0, 0.8);
    this.world.activeBag = body;
    // つめこみモード: 落とした時点のいちばん上。これより下に収まれば「すきまに入った」
    this.dropFromTop = this.world.towerTopY;
    this.held = null;
    this.state = 'drop';
    this.dropTimer = 0;
    this.settleHold = 0;
    A.sfxWhoosh();
  }

  updateDrop(dt) {
    const b = this.world.activeBag;
    if (!b) {
      // 落下中に場外へ消えた(ミス処理は handleLosses 済み)。少し間をおいて次へ
      this.state = 'settle';
      this.settleDelay = 520;
      return;
    }
    this.dropTimer += dt;
    const g = b.plugin.g;
    const calm = b.isSleeping || (speedOf(b) < C.SETTLE_SPEED && spinOf(b) < C.SETTLE_ANGULAR);
    if (calm && g.landedOn) this.settleHold += dt;
    else this.settleHold = 0;

    if ((this.settleHold >= C.SETTLE_HOLD && this.dropTimer > 300) || this.dropTimer > C.SETTLE_TIMEOUT) {
      this.settleBag(b);
    }
  }

  settleBag(body) {
    const g = body.plugin.g;
    g.placed = true;
    this.placedCount++;
    this.world.activeBag = null;
    this.world.computeTowerTop();

    if (this.isPack) {
      this.settlePacked(body);
      return;
    }

    const support = g.landedOn;
    const refX =
      !support || support.plugin.g?.kind === 'platform' ? C.VIEW.W / 2 : support.position.x;
    const dx = Math.abs(body.position.x - refX);
    const mult = 1 + Math.min(this.combo, 10) * 0.08;

    let gain = g.def.score;
    if (dx < C.PERFECT_DX && !g.burst) {
      this.combo++;
      this.comboPop = 0;
      gain += 150 + this.combo * 20;
      A.sfxPerfect(this.combo);
      this.addText('パーフェクト！', body.position.x, body.position.y - g.def.h / 2 - 14, '#8ef0c9', 21);
      this.ring(body.position.x, body.position.y, '#8ef0c9');
    } else if (dx < C.GOOD_DX) {
      this.combo++;
      this.comboPop = 0;
      gain += 50;
      A.sfxPlace();
      this.addText('ナイス！', body.position.x, body.position.y - g.def.h / 2 - 12, '#ffe08a', 17);
    } else {
      this.combo = 0;
      A.sfxPlace();
    }

    gain = Math.round(gain * mult);
    this.score += gain;
    this.addText(`+${gain}`, body.position.x, body.position.y - g.def.h / 2 - 44, '#ffffff', 16);

    // 高さ記録ボーナス
    const px = this.world.heightPx;
    if (px > this.recordPx + 1) {
      const bonus = Math.round((px - this.recordPx) * 2);
      this.recordPx = px;
      this.score += bonus;
    }

    this.state = 'settle';
    this.settleDelay = 240;
  }

  /** つめこみモードで1個収まったとき */
  settlePacked(body) {
    const bin = this.world.bin;
    const c = this.world.boxCenter(body);
    this.boxBags++;
    // 落とす前のいちばん上より低い所に収まった = すき間にうまく入った
    const inBin = c.x > bin.L && c.x < bin.R && c.y > bin.wallTop;
    if (inBin && body.bounds.min.y > this.dropFromTop + 4) {
      A.sfxPerfect(0);
      this.addText('すきまにピッタリ！', C.clamp(c.x, 90, C.VIEW.W - 90), body.bounds.min.y - 14, '#8ef0c9', 19);
      this.ring(c.x, c.y, '#8ef0c9');
    } else {
      A.sfxPlace();
    }
    this.updatePackStats();
    this.state = 'settle';
    this.settleDelay = 240;
  }

  /** いまの箱の個数と「つまり具合」を数え直す */
  updatePackStats() {
    this.packStats = this.world.binStats();
  }

  /** ファスナーの線より上にはみ出したまま一定時間たったら、その箱は失敗 */
  updateOverflow(dt) {
    const over = this.world.towerTopY < this.world.bin.limit - C.OVERFLOW_TOL;
    this.overflowTime = over ? this.overflowTime + dt : 0;
    if (this.overflowTime >= C.OVERFLOW_TIME) this.failBox();
  }

  // ---------------------------------------------------------------- 出荷ループ

  /** no 箱目の空の箱を用意する(種類・ノルマ・形)。やり直しのときは同じ種類のまま */
  setupBox(no, type = pickBoxType(no)) {
    this.boxNo = no;
    this.boxType = type;
    this.quota = Math.min(C.QUOTA_MAX, C.QUOTA_START + C.QUOTA_STEP * (no - 1));
    this.boxBags = 0;
    this.boxBursts = 0;
    this.overflowTime = 0;
    this.world.setBin(makeBin(this.boxType));
    this.packStats = { count: 0, fill: 0 };
  }

  /** 箱が来たときの案内(何箱目・種類・ノルマ) */
  showBoxBanner(retry = false) {
    const lines = [
      retry ? `${this.boxNo}箱目 やりなおし` : `${this.boxNo}箱目`,
      C.BOX_TYPES[this.boxType].label,
      `ノルマ ${Math.round(this.quota * 100)}%`,
    ];
    if (this.boxNo === 1 && !retry) lines.push('ノルマをこえたら「しめる」で出荷！');
    this.banner = { lines, life: 2600, maxLife: 2600, type: this.boxType };
  }

  /** いまの箱を出荷したときの倍率 */
  get packMultiplier() {
    return fillMultiplier(this.packStats.fill);
  }

  /** いまの箱で中身が飛び出した分の減点(出荷するときに引く) */
  get boxPenalty() {
    return this.boxBursts * C.BURST_PENALTY;
  }

  /** いま箱をしめられるか(ノルマ以上・はみ出しなし・次のバッグを持っている間だけ) */
  get canClose() {
    return this.isPack && this.state === 'aim' && this.overflowTime === 0 && this.packStats.fill >= this.quota;
  }

  /** 「しめる」: 得点を数えて出荷する */
  closeBox() {
    if (!this.isPack || this.state !== 'aim') return;
    const bin = this.world.bin;
    if (!this.canClose) {
      const left = Math.ceil((this.quota - this.packStats.fill) * 100);
      const msg = this.overflowTime > 0 ? 'はみ出してて しまらない！' : `ノルマまで あと ${Math.max(1, left)}%`;
      this.addText(msg, C.VIEW.W / 2, bin.wallTop - 34, '#ffb0a4', 17);
      A.sfxBuzz();
      return;
    }
    const { count, fill } = this.packStats;
    const mult = fillMultiplier(fill);
    const broken = this.boxType === 'fragile' && this.boxBursts > 0;
    // 割れ物の半分を先に当ててから、飛び出した回数ぶんを引く(マイナスにはしない)
    const base = Math.round(count * C.PACK_POINTS * mult * (broken ? 0.5 : 1));
    const penalty = this.boxPenalty;
    const points = Math.max(0, base - penalty);
    this.score += points;
    this.shippedBoxes++;
    this.shippedBags += count;
    const lifeUp = fill >= C.LIFE_BONUS_FILL && this.lives < C.START_LIVES;
    if (lifeUp) this.lives++;

    A.sfxZip();
    A.sfxPerfect(Math.min(8, Math.round(mult * 2)));
    const lines = [
      ['出荷！', '#8ef0c9', 30],
      [`${count}個 × ${C.PACK_POINTS} × ${mult}倍${broken ? ' × ½(割れ物)' : ''}`, '#ffffff', 15],
    ];
    if (penalty > 0) lines.push([`中身ドバー ${this.boxBursts}回  -${penalty}`, '#ff9d9d', 15]);
    lines.push([`+${points}`, '#ffe08a', 28]);
    if (lifeUp) lines.push(['ぎっしり！ ライフ +1', '#ff9db0', 16]);
    this.beginShip(true, lines);
  }

  /** はみ出してしまらない: ライフを1つ減らして、その箱はあきらめる */
  failBox() {
    this.lives--;
    this.combo = 0;
    A.sfxFail();
    this.addShake(9);
    if (this.lives <= 0) {
      this.gameOver('ファスナーが しまらない…');
      return;
    }
    this.beginShip(false, [
      ['しまらない…', '#ff8f86', 28],
      ['ライフ -1 ・ この箱はやりなおし', '#ffd0c8', 15],
    ]);
  }

  /**
   * 箱を中身ごと運び出すアニメーションを始める。持っているバッグは次の箱で使う。
   * lines: 結果の表示 [文字, 色, 大きさ]
   */
  beginShip(ok, lines) {
    this.ship = { t: 0, ok, lines, bin: this.world.bin, bodies: this.world.takeAll() };
    this.state = 'ship';
    this.overflowTime = 0;
    this.banner = null;
  }

  updateShip(dt) {
    const s = this.ship;
    const before = s.t;
    s.t += dt;
    const inAt = C.SHIP_CLOSE + C.SHIP_OUT;
    // 古い箱が出ていったら、次の空の箱を用意して入ってこさせる(失敗したときは同じ箱をやり直し)
    if (before < inAt && s.t >= inAt) {
      if (s.ok) this.setupBox(this.boxNo + 1);
      else this.setupBox(this.boxNo, this.boxType);
    }
    if (s.t < inAt + C.SHIP_IN) return;
    this.ship = null;
    this.showBoxBanner(!s.ok);
    if (this.held) {
      this.state = 'aim';
      this.aimTimer = this.aimTime;
    } else {
      this.spawnNext();
    }
  }

  /** 出荷アニメーションの進み具合(描画用)。close: フタ 0→1 / out: 出ていく 0→1 / in: 入ってくる 0→1 */
  get shipProgress() {
    const t = this.ship?.t ?? 0;
    return {
      close: easeOutCubic(C.clamp(t / C.SHIP_CLOSE, 0, 1)),
      out: C.clamp((t - C.SHIP_CLOSE) / C.SHIP_OUT, 0, 1),
      in: easeOutCubic(C.clamp((t - C.SHIP_CLOSE - C.SHIP_OUT) / C.SHIP_IN, 0, 1)),
    };
  }

  afterSettle() {
    if (this.state === 'over') return;
    this.spawnNext();
  }

  gameOver(reason) {
    if (this.state === 'over') return;
    this.state = 'over';
    this.held = null;
    this.overReason = reason;
    this.inputLock = 900;
    this.overflowTime = 0;
    this.newBest = this.score > this.best;
    if (this.newBest) {
      this.best = this.score;
      this.bests[this.mode] = this.score;
      try {
        localStorage.setItem(this.isPack ? C.STORAGE_KEY_PACK : C.STORAGE_KEY, String(this.best));
      } catch {
        /* localStorage が使えない環境は無視 */
      }
    }
    A.sfxGameOver();
  }

  // ---------------------------------------------------------------- 演出

  onThud(p, impulse) {
    A.sfxThud(impulse / 150);
    const n = Math.min(10, 2 + (impulse / 30) | 0);
    for (let i = 0; i < n; i++) {
      this.fx.push({
        kind: 'dust',
        x: p.x + C.rand(-6, 6),
        y: p.y + C.rand(-4, 4),
        vx: C.rand(-1.8, 1.8),
        vy: C.rand(-1.6, -0.2),
        gravity: 0.045,
        r: C.rand(1.5, 4),
        color: 'rgba(255,255,255,0.55)',
        life: 420,
        maxLife: 420,
      });
    }
    if (impulse > 90) this.addShake(Math.min(7, impulse / 40));
  }

  onBurst(body, mouth, items, reason) {
    // ゲームオーバー後に崩れたぶんは数えない(結果画面の点数が動かないように)
    const live = this.state !== 'over';
    if (live) {
      this.burstCount++;
      this.combo = 0;
      // つみあげ: その場で減点 / つめこみ: この箱を出荷するときにまとめて減点。
      // 「割れ物注意」の箱は、さらに出荷したときの得点が半分になる
      if (this.isPack) {
        this.boxBursts++;
        if (this.boxType === 'fragile' && this.boxBursts === 1) {
          this.addText('割れ物が…！ この箱は得点半分', C.VIEW.W / 2, this.world.bin.wallTop - 34, '#ff9d6b', 17);
        }
      } else {
        this.score = Math.max(0, this.score - C.BURST_PENALTY);
      }
    }
    A.sfxBurst();
    this.addShake(reason === 'spill' ? 4 : 9);
    this.ring(mouth.x, mouth.y, '#ffd98a');
    for (let i = 0; i < 18; i++) {
      this.fx.push({
        kind: 'dust',
        x: mouth.x,
        y: mouth.y,
        vx: C.rand(-4, 4),
        vy: C.rand(-5, 0.5),
        gravity: 0.07,
        r: C.rand(1.5, 4.5),
        color: C.pick(['#ffe08a', '#fff', '#ffb36b']),
        life: 620,
        maxLife: 620,
      });
    }
    const label = reason === 'spill' ? 'こぼれた！' : '中身ドバー！';
    this.addText(label, C.clamp(mouth.x, 70, C.VIEW.W - 70), mouth.y - 26, '#ff9d6b', 22);
    if (live) this.addText(`-${C.BURST_PENALTY}`, C.clamp(mouth.x, 70, C.VIEW.W - 70), mouth.y - 4, '#ff7f7f', 15);
  }

  addText(str, x, y, color, size = 16) {
    this.fx.push({
      kind: 'text',
      text: str,
      x,
      y,
      vx: 0,
      vy: -0.55,
      gravity: 0.006,
      color,
      size,
      life: 1100,
      maxLife: 1100,
    });
  }

  ring(x, y, color) {
    this.fx.push({ kind: 'ring', x, y, vx: 0, vy: 0, gravity: 0, r: 34, color, life: 420, maxLife: 420 });
  }

  addShake(mag) {
    this.shake.mag = Math.max(this.shake.mag, mag);
  }

  updateFx(dt) {
    const k = dt / STEP;
    for (let i = this.fx.length - 1; i >= 0; i--) {
      const p = this.fx[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.fx.splice(i, 1);
        continue;
      }
      p.x += p.vx * k;
      p.y += p.vy * k;
      p.vy += (p.gravity || 0) * k;
    }
    this.shake.mag *= 0.86;
    if (this.shake.mag < 0.15) this.shake.mag = 0;
    this.shake.x = C.rand(-this.shake.mag, this.shake.mag);
    this.shake.y = C.rand(-this.shake.mag, this.shake.mag);
  }

  // ---------------------------------------------------------------- 更新

  /** 往復の幅(中央から片側)。つめこみモードは箱の口の幅に合わせる */
  get sweepRangeTarget() {
    if (!this.isPack) return C.SWEEP_RANGE;
    const bin = this.world.bin;
    return (bin.R - bin.L) / 2 + C.PACK_SWEEP_MARGIN;
  }

  /** いまの往復の幅(箱が変わったときは、急に跳ばないよう少しずつ追いかける) */
  get sweepRange() {
    return this.crane.range ?? this.sweepRangeTarget;
  }

  /** 往復運動の位置。端で少しだけ減速する三角波 */
  sweepX(phase) {
    return C.VIEW.W / 2 + (this.sweepRange * Math.asin(SWEEP_K * Math.sin(phase))) / SWEEP_NORM;
  }

  /**
   * いまの往復の速さ(中央での px/秒)。「はやさ」の倍率がかかる。
   * つみあげ: 積んだ数で上がる / つめこみ: 箱が進むほど上がり、1つの箱の中でも少しずつ上がる
   */
  get sweepSpeed() {
    const grow = this.isPack
      ? (this.boxNo - 1) * C.PACK_SPEED_PER_BOX + this.boxBags * C.PACK_SPEED_PER_BAG
      : this.placedCount * C.SWEEP_SPEED_STEP;
    const base = Math.min(C.SWEEP_SPEED_MAX, C.SWEEP_SPEED_BASE + grow);
    return base * C.SPEED_LEVELS[this.speedLevel];
  }

  updateCrane(dt) {
    const cr = this.crane;
    cr.prevX = cr.x;
    cr.range = C.lerp(this.sweepRange, this.sweepRangeTarget, 0.06);
    // 中央での速さが sweepSpeed になるように位相を進める
    const omega = (this.sweepSpeed * SWEEP_NORM) / (this.sweepRange * SWEEP_K);
    cr.phase += omega * (dt / 1000);
    cr.x = this.sweepX(cr.phase);
    cr.vx = ((cr.x - cr.prevX) / dt) * 1000;

    // 振り子(移動と風で揺れる)
    const targetSwing = C.clamp(-cr.vx * 0.00042 + this.world.wind.x * 0.14, -0.34, 0.34);
    cr.swingV += (targetSwing - cr.swing) * 0.055;
    cr.swingV *= 0.9;
    cr.swing += cr.swingV;

    // つみあげ: タワーの少し上についていく / つめこみ: スーツケースの上で固定
    const towerScreen = this.world.towerTopY + this.camY;
    const want = this.isPack
      ? C.PACK_CRANE_Y
      : C.clamp(towerScreen - C.DROP_GAP, C.CRANE_SCREEN_MIN, C.CRANE_SCREEN_MAX);
    cr.screenY = C.lerp(cr.screenY, want, 0.07);
  }

  updateCamera() {
    // つめこみモードはスーツケース全体が画面に入っているので動かさない
    const want = this.isPack ? 0 : Math.max(0, C.TOWER_SCREEN_Y - this.world.towerTopY);
    this.camY = C.lerp(this.camY, want, 0.07);
  }

  handleLosses() {
    const lost = this.world.sweep();
    if (!lost.length) return;
    let bagLost = false;
    const msgY = this.isPack ? this.world.bin.wallTop - 40 : this.world.towerTopY - 40;
    for (const l of lost) {
      if (l.g.kind === 'bag') {
        if (l.reason === 'sky') {
          this.addText('飛んでいった…', C.VIEW.W / 2, msgY, '#9fd8ff', 18);
        } else {
          bagLost = true;
        }
      } else if (l.reason === 'sky') {
        this.addText('🎈', l.body.position.x, msgY + 20, '#fff', 14);
      }
    }
    // タワー崩壊で何個も落ちたときに一瞬でライフが無くならないよう、
    // 落下が続いている間(最後の落下から LOSS_GRACE 以内)は同じ1ミスとして扱う
    if (bagLost && this.lossGrace > 0) {
      this.lossGrace = LOSS_GRACE;
    } else if (bagLost) {
      this.lives--;
      this.lossGrace = LOSS_GRACE;
      this.combo = 0;
      A.sfxFail();
      this.addShake(11);
      this.addText(this.isPack ? '外に落ちた！' : '落ちた！', C.VIEW.W / 2, msgY, '#ff7f7f', 24);
      if (this.lives <= 0) {
        this.gameOver(this.placedCount === 0 ? 'いきなり落としてしまった…' : 'バッグを落としすぎた…');
      }
    }
  }

  fixedUpdate(dt) {
    this.time += dt;
    if (this.inputLock > 0) this.inputLock -= dt;
    if (this.lossGrace > 0) this.lossGrace -= dt;
    if (this.comboPop < 1) this.comboPop = Math.min(1, this.comboPop + dt / 220);
    this.displayScore = C.lerp(this.displayScore, this.score, 0.18);
    if (Math.abs(this.displayScore - this.score) < 0.6) this.displayScore = this.score;

    if (this.state !== 'title') {
      this.world.step(dt);
      this.handleLosses();
      if (this.isPack && this.state !== 'over' && this.state !== 'ship') {
        this.updatePackStats();
        this.updateOverflow(dt);
      }
    }
    if (this.banner) {
      this.banner.life -= dt;
      if (this.banner.life <= 0) this.banner = null;
    }

    switch (this.state) {
      case 'aim':
        this.aimTimer -= dt;
        if (this.aimTimer <= 0) this.drop();
        break;
      case 'drop':
        this.updateDrop(dt);
        break;
      case 'settle':
        this.settleDelay -= dt;
        if (this.settleDelay <= 0) this.afterSettle();
        break;
      case 'ship':
        this.updateShip(dt);
        break;
    }

    this.updateCrane(dt);
    this.updateCamera();
    this.updateFx(dt);
  }

  frame(ts) {
    if (!this.last) this.last = ts;
    let dt = ts - this.last;
    this.last = ts;
    if (dt > 120) dt = 120; // タブ復帰などで一気に進めない
    this.acc += dt;
    let guard = 0;
    while (this.acc >= STEP && guard++ < 6) {
      this.fixedUpdate(STEP);
      this.acc -= STEP;
    }
    render(this.ctx, this);
    requestAnimationFrame((t) => this.frame(t));
  }

  run() {
    requestAnimationFrame((t) => this.frame(t));
  }
}
