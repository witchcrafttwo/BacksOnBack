// バッグと「中身」の定義。
// Matter.js の摩擦はペアで min(frictionA, frictionB) が使われるので、
// つるつるした中身/バッグが一つ混じるとタワー全体が不安定になる。

/** 中身アイテム */
export const ITEMS = {
  book: { emoji: '📕', shape: 'box', w: 36, h: 11, density: 0.0013, friction: 0.9, frictionStatic: 1.2, restitution: 0.0, color: '#3e6ed6', label: '本' },
  pencase: { emoji: '✏️', shape: 'box', w: 30, h: 11, density: 0.0009, friction: 0.7, frictionStatic: 0.9, restitution: 0.05, color: '#e8a33d', label: 'ペンケース' },
  bottle: { emoji: '🧴', shape: 'box', w: 15, h: 34, density: 0.0012, friction: 0.5, frictionStatic: 0.7, restitution: 0.08, color: '#4fc3c0', label: '水筒' },
  onigiri: { emoji: '🍙', shape: 'box', w: 19, h: 17, density: 0.0008, friction: 0.95, frictionStatic: 1.2, restitution: 0.02, color: '#f4f0e2', label: 'おにぎり' },
  shoe: { emoji: '👟', shape: 'box', w: 32, h: 15, density: 0.0011, friction: 0.88, frictionStatic: 1.1, restitution: 0.03, color: '#dcdcdc', label: 'スニーカー' },
  towel: { emoji: '🧣', shape: 'box', w: 32, h: 10, density: 0.0007, friction: 0.98, frictionStatic: 1.3, restitution: 0.0, color: '#e4738f', label: 'タオル' },
  ball: { emoji: '⚽', shape: 'circle', r: 14, density: 0.0008, friction: 0.1, frictionStatic: 0.12, restitution: 0.58, color: '#f6f6f6', label: 'ボール' },
  shirt: { emoji: '👕', shape: 'box', w: 30, h: 12, density: 0.0006, friction: 0.96, frictionStatic: 1.3, restitution: 0.0, color: '#8fd4f0', label: '服' },
  camera: { emoji: '📷', shape: 'box', w: 24, h: 17, density: 0.0016, friction: 0.6, frictionStatic: 0.8, restitution: 0.05, color: '#4a4f5c', label: 'カメラ' },
  plush: { emoji: '🧸', shape: 'circle', r: 16, density: 0.0005, friction: 0.95, frictionStatic: 1.3, restitution: 0.05, color: '#c98f5a', label: 'ぬいぐるみ' },
  doughnut: { emoji: '🍩', shape: 'circle', r: 12, density: 0.0007, friction: 0.28, frictionStatic: 0.3, restitution: 0.32, color: '#e0a86b', label: 'ドーナツ' },
  can: { emoji: '🥫', shape: 'box', w: 17, h: 23, density: 0.0015, friction: 0.45, frictionStatic: 0.6, restitution: 0.12, color: '#c2553f', label: '缶詰' },
  apple: { emoji: '🍎', shape: 'circle', r: 12, density: 0.0009, friction: 0.16, frictionStatic: 0.2, restitution: 0.4, color: '#e04b45', label: 'りんご' },
  carrot: { emoji: '🥕', shape: 'box', w: 28, h: 10, density: 0.0008, friction: 0.55, frictionStatic: 0.7, restitution: 0.05, color: '#ef8b3c', label: 'にんじん' },
  milk: { emoji: '🥛', shape: 'box', w: 17, h: 27, density: 0.0014, friction: 0.5, frictionStatic: 0.7, restitution: 0.05, color: '#f3f6fb', label: '牛乳' },
  lipstick: { emoji: '💄', shape: 'box', w: 9, h: 19, density: 0.001, friction: 0.4, frictionStatic: 0.5, restitution: 0.1, color: '#e0457b', label: 'リップ' },
  key: { emoji: '🔑', shape: 'box', w: 18, h: 9, density: 0.0018, friction: 0.5, frictionStatic: 0.7, restitution: 0.1, color: '#e6c258', label: 'カギ' },
  phone: { emoji: '📱', shape: 'box', w: 15, h: 26, density: 0.0013, friction: 0.55, frictionStatic: 0.7, restitution: 0.05, color: '#2f3545', label: 'スマホ' },
  cash: { emoji: '💵', shape: 'box', w: 27, h: 13, density: 0.0011, friction: 0.35, frictionStatic: 0.45, restitution: 0.02, color: '#6fbf73', label: '札束' },
  balloon: { emoji: '🎈', shape: 'circle', r: 13, density: 0.0002, friction: 0.3, frictionStatic: 0.4, restitution: 0.45, color: '#ef5a74', label: '風船', buoyant: 1.35 },
};

/**
 * バッグ定義
 * hp        : 耐久。衝撃と上に乗る重さで減り、0 で中身が飛び出す
 * density   : 重さ。0.001 が標準
 * friction  : 小さいほどすべる
 * weight    : 抽選の重み
 * minLevel  : 何個目から出てくるか
 * cap       : 上に乗せても平気な重さ。超えるとじわじわ耐久が減る(リュック1個 ≒ 7)
 * deflate   : 中身が出たあとの縦の縮み(1 = 硬くて形が崩れない)
 * spill     : 口が開いているので、傾くと中身がこぼれる
 * sail      : 風の受けやすさ
 * r         : 角の丸み(形は角を丸めた長方形)
 */
export const BAGS = [
  {
    key: 'backpack',
    name: 'リュック',
    style: 'backpack',
    tip: 'ばんのう型',
    w: 88, h: 80, r: 16,
    density: 0.001, friction: 0.76, frictionStatic: 1.0, restitution: 0.03,
    hp: 36, score: 100, weight: 22, minLevel: 0, cap: 42, deflate: 0.72,
    body: '#e2584d', shade: '#b8433a', trim: '#ffd79a', zip: '#ffe9c4',
    contents: ['book', 'pencase', 'bottle', 'onigiri'],
  },
  {
    key: 'tote',
    name: 'トートバッグ',
    style: 'tote',
    tip: '傾けるとこぼれる',
    w: 102, h: 72, r: 10,
    density: 0.0008, friction: 0.93, frictionStatic: 1.25, restitution: 0.01,
    hp: 20, score: 110, weight: 16, minLevel: 0, cap: 30, deflate: 0.8, spill: true,
    body: '#e8ddc2', shade: '#cbbd9b', trim: '#8a6f4a', zip: '#8a6f4a',
    contents: ['carrot', 'milk', 'apple'],
  },
  {
    key: 'duffel',
    name: 'ボストンバッグ',
    style: 'duffel',
    tip: '土台に強い',
    w: 126, h: 60, r: 26,
    density: 0.0011, friction: 0.72, frictionStatic: 0.95, restitution: 0.03,
    hp: 30, score: 120, weight: 18, minLevel: 1, cap: 48, deflate: 0.6,
    body: '#3f7fd0', shade: '#2f63a8', trim: '#d8e6f7', zip: '#e8f1fb',
    contents: ['shoe', 'towel', 'ball'],
  },
  {
    key: 'paper',
    name: '紙袋',
    style: 'paper',
    tip: 'やわい！',
    w: 84, h: 88, r: 5,
    density: 0.0006, friction: 0.88, frictionStatic: 1.15, restitution: 0.01,
    hp: 11, score: 140, weight: 13, minLevel: 2, cap: 18, sail: 1.7, deflate: 0.72,
    body: '#d9a567', shade: '#b8854b', trim: '#f0cf9e', zip: '#b8854b',
    contents: ['doughnut', 'can', 'apple'],
  },
  {
    key: 'pouch',
    name: 'ポーチ',
    style: 'pouch',
    tip: 'すきま埋め',
    w: 58, h: 42, r: 13,
    density: 0.0009, friction: 0.82, frictionStatic: 1.05, restitution: 0.05,
    hp: 16, score: 80, weight: 13, minLevel: 1, cap: 20, deflate: 0.75,
    body: '#9a6fd6', shade: '#7a53b0', trim: '#f2e6ff', zip: '#f2e6ff',
    contents: ['lipstick', 'key', 'phone'],
  },
  {
    key: 'suitcase',
    name: 'スーツケース',
    style: 'suitcase',
    tip: 'おもい・すべる',
    w: 96, h: 112, r: 12,
    density: 0.0017, friction: 0.36, frictionStatic: 0.5, restitution: 0.06,
    hp: 64, score: 170, weight: 14, minLevel: 3, cap: 130, deflate: 1,
    body: '#4cc0a8', shade: '#369385', trim: '#eafaf5', zip: '#eafaf5',
    contents: ['shirt', 'camera', 'plush'],
  },
  {
    key: 'balloonbag',
    name: '風船バッグ',
    style: 'balloon',
    tip: 'ふわふわ',
    w: 78, h: 78, r: 22,
    density: 0.00035, friction: 0.52, frictionStatic: 0.7, restitution: 0.18,
    hp: 9, score: 190, weight: 8, minLevel: 5, cap: 11, sail: 2.8, deflate: 0.6,
    body: '#f2879f', shade: '#d8657f', trim: '#fff0f4', zip: '#fff0f4',
    contents: ['balloon', 'balloon', 'balloon'],
  },
  {
    key: 'attache',
    name: 'アタッシュケース',
    style: 'attache',
    tip: 'ずっしり頑丈',
    w: 88, h: 56, r: 5,
    density: 0.0021, friction: 0.33, frictionStatic: 0.45, restitution: 0.04,
    hp: 88, score: 230, weight: 7, minLevel: 7, cap: 160, deflate: 1,
    body: '#8d6b4f', shade: '#6b4f39', trim: '#f0d9a8', zip: '#f0d9a8',
    contents: ['cash', 'cash'],
  },
];

export const BAG_BY_KEY = Object.fromEntries(BAGS.map((b) => [b.key, b]));

/** レベル(設置済み個数)に応じて次のバッグを抽選する */
export function rollBag(level) {
  const pool = BAGS.filter((b) => b.minLevel <= level);
  const total = pool.reduce((s, b) => s + b.weight, 0);
  let t = Math.random() * total;
  for (const b of pool) {
    t -= b.weight;
    if (t <= 0) return b;
  }
  return pool[0];
}
