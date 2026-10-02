// ゲーム全体の調整値。数値はすべて論理ピクセル(480x800)基準。

export const VIEW = { W: 480, H: 800 };

/** 土台(巨大トランク)の上面 y 座標(ワールド座標。下に行くほど大きい) */
export const GROUND_Y = 668;
export const PLATFORM_W = 320;
export const PLATFORM_H = 60;
export const PLATFORM_L = VIEW.W / 2 - PLATFORM_W / 2;
export const PLATFORM_R = VIEW.W / 2 + PLATFORM_W / 2;

/** 高さ表示の換算(1m = 何px か)。リュック1個 ≒ 0.5m になる縮尺 */
export const PX_PER_M = 160;

/** これより下に落ちたら「落下」と判定 */
export const FALL_LIMIT_Y = GROUND_Y + 230;

/** 画面下部の操作パネル */
export const FOOTER_Y = 728;

/** タワーの先端をこの画面 y に置くようカメラを動かす */
export const TOWER_SCREEN_Y = 470;
/** クレーンはタワー先端からこの距離だけ上に浮く */
export const DROP_GAP = 215;
export const CRANE_SCREEN_MIN = 120;
export const CRANE_SCREEN_MAX = 560;
export const ROPE_LEN = 52;

/**
 * クレーンは自動で左右に往復する(止められない)。落とすタイミングが勝負。
 * 中央 ± SWEEP_RANGE を往復し、土台の端より少し外まで行く(雑に落とすと外れる)。
 * 速さ(中央での px/秒)は積むほど上がり、さらに「はやさ」の倍率がかかる。
 */
export const SWEEP_RANGE = 188;
export const SWEEP_SPEED_BASE = 145;
export const SWEEP_SPEED_STEP = 6;
export const SWEEP_SPEED_MAX = 290;

/**
 * 「はやさ」の段階(タイトル・ゲームオーバー画面で選ぶ)。上の速さにかける倍率。
 * 1段目(×1)がいちばん遅い。選んだ段階はブラウザに保存する。
 */
export const SPEED_LEVELS = [1, 1.3, 1.6, 2, 2.5];
export const SPEED_KEY = 'backsOnBacks.speed';

/** 風が吹き始める高さ(m) / 最大になる高さ(m) */
export const WIND_START_M = 3;
export const WIND_FULL_M = 14;

/** 荷重ダメージ: 上の重さが cap の2倍のとき、毎秒この値だけ耐久が減る */
export const LOAD_RATE = 3;

export const START_LIVES = 3;

/** 1個あたりの制限時間(ms) */
export const AIM_TIME_BASE = 9000;
export const AIM_TIME_MIN = 4200;

/** 着地判定 */
export const SETTLE_SPEED = 0.55;
export const SETTLE_ANGULAR = 0.02;
export const SETTLE_HOLD = 380; // ms 静止し続けたら設置完了
export const SETTLE_TIMEOUT = 4200;

/** パーフェクト判定(支えとの中心ズレ px) */
export const PERFECT_DX = 15;
export const GOOD_DX = 34;

/**
 * 破裂ダメージ。衝撃量 = 「ぶつかってきた相手の運動量」で測る。
 * こうすると重いバッグを落としたとき下のバッグが潰れる、という直感どおりになる。
 */
export const IMPACT_FREE = 55; // これ以下の衝撃はノーダメージ
export const IMPACT_SCALE = 0.16;
export const SELF_IMPACT = 0.6; // 地面など静止物にぶつかったときは自分の運動量を控えめに見る

/**
 * 中身が飛び出したとき(破裂・こぼれ)の減点。
 * つみあげ: その場で引く / つめこみ: その箱を出荷するときに、1回につきこの点数を引く
 * (丁寧に詰めても1箱に1〜3回は起きるので、1箱の得点の数%くらいの軽い罰にしてある)
 */
export const BURST_PENALTY = 50;

export const STORAGE_KEY = 'backsOnBacks.highScore';

// ---------------------------------------------------------------- つめこみモード
/**
 * 入れ物の巨大スーツケース(カメラは動かないので、ワールド座標 = 画面座標)。
 * 内側は BIN_L〜BIN_R、底の上面が BIN_FLOOR_Y、左右の壁の上端が BIN_WALL_TOP。
 * BIN_LIMIT_Y がファスナーの線。ここより上にはみ出したまま OVERFLOW_TIME たつとおしまい。
 */
export const BIN_L = 52;
export const BIN_R = 428;
export const BIN_WALL = 16;
export const BIN_WALL_TOP = 292;
export const BIN_LIMIT_Y = 324;
export const BIN_FLOOR_Y = 712;
export const BIN_FLOOR_H = 14;
/** クレーンの高さ。吊ったバッグ(回転しても)の下端が壁の上端より上にくる位置 */
export const PACK_CRANE_Y = 100;
/**
 * クレーンは箱の口のはしより、これだけ外まで往復する(雑に落とすと外にこぼれる)。
 * 口の上だけを往復させると、連打しても壁にそって勝手に詰まってしまう(シミュレーションで確認)。
 */
export const PACK_SWEEP_MARGIN = 48;
export const OVERFLOW_TIME = 2500;
export const OVERFLOW_TOL = 4;

// 出荷ループ: ノルマをこえたら「しめる」で出荷 → 次の空の箱が来る。ライフがなくなるまで続く
/** 1箱の得点 = 入れた個数 × PACK_POINTS × つまり具合の倍率 */
export const PACK_POINTS = 100;
/** つまり具合の倍率 [この割合以上, 倍率]。上から順に当てはめる */
export const FILL_TIERS = [
  [0.9, 3],
  [0.8, 2],
  [0.7, 1.5],
  [0.6, 1.2],
  [0, 1],
];
/** この「つまり具合」以上で出荷すると、ライフが1つ戻る */
export const LIFE_BONUS_FILL = 0.8;
/**
 * ノルマ(しめられる「つまり具合」)。1箱目から箱ごとに上がり、上限で止まる。
 * 丁寧に詰めてもはみ出す前に届くのは 70〜80% くらいなので、上限は 70%(シミュレーションで調整)
 */
export const QUOTA_START = 0.5;
export const QUOTA_STEP = 0.02;
export const QUOTA_MAX = 0.7;
/** 箱ごと・1個ごとのクレーンの速さの上がり方(px/秒) */
export const PACK_SPEED_PER_BOX = 18;
export const PACK_SPEED_PER_BAG = 3;
/** 箱の種類。機内持ち込みは左右の壁が CARRYON_INSET だけ内側に寄る */
export const CARRYON_INSET = 40;
export const BOX_TYPES = {
  normal: { label: '', short: '' },
  carryon: { label: '機内持ち込みサイズ (せまい！)', short: '・機内' },
  fragile: { label: '割れ物注意！ 中身ドバーで得点半分', short: '・割れ物' },
};
/** 出荷のアニメーション(ms): フタが閉まる → 運ばれていく → 次の箱が来る */
export const SHIP_CLOSE = 500;
export const SHIP_OUT = 650;
export const SHIP_IN = 600;

export const STORAGE_KEY_PACK = 'backsOnBacks.highScore.ship';
export const MODE_KEY = 'backsOnBacks.mode';

export const FONT_UI =
  '"Segoe UI", "Yu Gothic UI", "Hiragino Kaku Gothic ProN", "Noto Sans JP", sans-serif';
export const FONT_EMOJI =
  '"Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif';

export const clamp = (v, min, max) => (v < min ? min : v > max ? max : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const rand = (min, max) => min + Math.random() * (max - min);
export const pick = (arr) => arr[(Math.random() * arr.length) | 0];
