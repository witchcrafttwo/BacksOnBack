// ランキング(ログインなし)。
// この端末を見分けるランダムな ID と、ランキングに出すなまえをブラウザに保存しておき、
// 本番サーバー(開発中は開発サーバー)の /api/ranking とやりとりする。中身は server/ranking.mjs。
// つながらないときは { ok: false } を返すだけで、ゲームはそのまま遊べる
const ID_KEY = 'backsOnBacks.playerId';
const NAME_KEY = 'backsOnBacks.name';
export const NAME_MAX = 10;
const TIMEOUT = 6000;

/** はじめてのときのなまえ(あとで変えられる)。どの組み合わせも NAME_MAX 文字以内 */
const NAME_A = ['ふわふわ', 'ずっしり', 'ねむい', 'はらぺこ', 'のんびり', 'ぴかぴか', 'こっそり', 'もちもち', 'わくわく', 'さすらいの'];
const NAME_B = ['リュック', 'トート', 'ボストン', 'ポーチ', 'かみぶくろ', 'トランク', 'がまぐち', 'カバン'];

/** localStorage が使えないとき(プライベートモードなど)は、ページを開いている間だけ覚えておく */
const memory = {};
function load(key) {
  try {
    const v = localStorage.getItem(key);
    if (v !== null) return v;
  } catch {
    /* 使えない */
  }
  return memory[key] ?? null;
}
function save(key, value) {
  memory[key] = value;
  try {
    localStorage.setItem(key, value);
  } catch {
    /* 使えない */
  }
}

/** なまえを整える(サーバーと同じ決まり。最後はサーバーが整えたものを使う) */
export function cleanName(raw) {
  if (typeof raw !== 'string') return '';
  const s = raw.normalize('NFC').replace(/\p{C}/gu, '').replace(/\s+/gu, ' ').trim();
  return Array.from(s).slice(0, NAME_MAX).join('').trim();
}

/** この端末の ID(32 桁の 16 進数)。crypto.randomUUID は https でないと使えないので getRandomValues で作る */
export function playerId() {
  let id = load(ID_KEY);
  if (!/^[0-9a-f]{32}$/.test(id ?? '')) {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    id = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    save(ID_KEY, id);
  }
  return id;
}

/** ランキングに出すなまえ。まだ無ければ、かわいいなまえを作っておく */
export function playerName() {
  let name = cleanName(load(NAME_KEY));
  if (!name) {
    const pick = (list) => list[Math.floor(Math.random() * list.length)];
    name = pick(NAME_A) + pick(NAME_B);
    save(NAME_KEY, name);
  }
  return name;
}

/** なまえを変えて保存する。使えないなまえ(空など)なら '' を返して何もしない */
export function setPlayerName(raw) {
  const name = cleanName(raw);
  if (name) save(NAME_KEY, name);
  return name;
}

/** サーバーとやりとりする。body があれば POST */
async function call(path, body) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT);
  try {
    const res = await fetch(`/api/ranking${path}`, {
      method: body ? 'POST' : 'GET',
      headers: body ? { 'Content-Type': 'application/json' } : { 'X-Player-Id': playerId() },
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store',
      signal: ctl.signal,
    });
    const data = await res.json().catch(() => null);
    return data?.ok ? data : { ok: false, error: data?.error ?? `http-${res.status}` };
  } catch {
    return { ok: false, error: 'offline' };
  } finally {
    clearTimeout(timer);
  }
}

/** mode のランキング(上位 10 人と自分の順位) */
export const fetchRanking = (mode) => call(`?mode=${encodeURIComponent(mode)}`);

/** スコアを送る。サーバーは 1 人 1 つ、自己ベストだけ残す */
export const submitScore = ({ mode, score, speed, detail }) =>
  call('', { id: playerId(), name: playerName(), mode, score, speed, detail });

/** サーバーにあるなまえも変える */
export const renamePlayer = (name) => call('/name', { id: playerId(), name });
