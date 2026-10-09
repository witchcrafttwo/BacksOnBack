// ランキングのサーバー側(ログインなし)。記録は PostgreSQL に入れる。
// 本番サーバー(vite preview)と開発サーバー(vite)に /api/ranking を足す Vite プラグイン。
//
//   GET  /api/ranking?mode=stack : 上位 10 人と参加人数。ヘッダー X-Player-Id があれば、その人の順位も返す
//   POST /api/ranking            : スコアを送る { id, name, mode, score, speed, detail }
//   POST /api/ranking/name       : なまえを変える { id, name }
//   GET  /api/ranking/ping       : サーバー側のしくみの版(本番起動.bat が、古いサーバーが動いていないか見るのに使う)
//
// プレイヤーは、ブラウザが最初に作るランダムな ID で見分ける(ログインなし)。1 人 1 モード 1 行で、自己ベストだけ残す。
// ID はハッシュにしてから保存し、一覧にも出さない(ID がわかると、その人のなまえを書きかえられてしまうため)。
// スコアはブラウザから送られてくるので、その気になればズルはできる。友だちどうしで遊ぶ前提の作り。
//
// データベースの設定は .env(PGHOST・PGPORT・PGDATABASE・PGUSER・PGPASSWORD、または DATABASE_URL)。
// テーブルが無ければ自動で作る(本番 = backs_on_backs_ranking / 開発サーバー = backs_on_backs_ranking_dev)。
// .env を書きかえると、動いているサーバーも 2 秒ほどで新しい設定でつなぎ直す(起動し直さなくてよい)。
// データベースにつながらない間も、ゲームはそのまま遊べる(ランキングだけ「つながらない」になる)。
// 記録を消したり直したりするときは、psql や pgAdmin でテーブルを直接さわってよい
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const MODES = ['stack', 'pack'];
/** 一覧で返す人数 */
const SHOW = 10;
export const NAME_MAX = 10;
const DEFAULT_NAME = 'ななし';
const SCORE_MAX = 10_000_000;
const DETAIL_MAX = 100_000;
const SPEED_MAX = 9;
/** 送られてくる JSON の大きさの上限(バイト) */
const BODY_MAX = 2048;
/** 1 つの相手(IP)からの回数の上限(1 分あたり)。write = スコア・なまえ / read = 一覧 */
const LIMIT = { write: 20, read: 120, perMs: 60_000 };
const HEX32 = /^[0-9a-f]{32}$/;
/** サーバー側のしくみのファイル。この中身から版を作る */
const SERVER_FILES = ['vite.config.js', 'server/ranking.mjs'];

/** 記録を入れるテーブル。本番サーバーと開発サーバーで分ける(試しに遊んだ記録が本番に混ざらないように) */
export const TABLES = { prod: 'backs_on_backs_ranking', dev: 'backs_on_backs_ranking_dev' };
/** データベースの設定ファイル(プロジェクトのいちばん上のフォルダ) */
export const ENV_FILE = '.env';
const DB_KEYS = ['DATABASE_URL', 'PGHOST', 'PGPORT', 'PGDATABASE', 'PGUSER', 'PGPASSWORD', 'PGSSLMODE'];
/** .env を読み直す間隔(ms) */
const RELOAD_MS = 2000;
/** つなぐとき・1 回の問い合わせを待つ長さの上限(ms)。ブラウザは 6 秒であきらめるので、それより短くする */
const CONNECT_TIMEOUT = 4000;
const QUERY_TIMEOUT = 4000;

/** なまえを整える。制御文字・見えない文字を消し、空白をまとめて、NAME_MAX 文字までにする */
export function cleanName(raw) {
  if (typeof raw !== 'string') return '';
  const s = raw.normalize('NFC').replace(/\p{C}/gu, '').replace(/\s+/gu, ' ').trim();
  return Array.from(s).slice(0, NAME_MAX).join('').trim();
}

/** ブラウザから来た ID を、保存用のキーにする(ID そのものは保存しない)。おかしな ID なら null */
function playerKey(id) {
  if (typeof id !== 'string' || !HEX32.test(id)) return null;
  return createHash('sha256').update(id).digest('hex').slice(0, 32);
}

/**
 * 回数の上限に使う「相手」。ふつうは接続元の IP。
 * このパソコンの中から来た接続は、トンネル(cloudflared など)が中継したものかもしれないので、
 * トンネルが付けた本当の相手の IP(CF-Connecting-IP か、X-Forwarded-For の最後)を使う。
 * LAN から直接来た接続のヘッダーは信じない(だれでも書けるため)
 */
export function clientKey(req) {
  const remote = req.socket?.remoteAddress ?? '';
  if (remote === '::1' || remote.startsWith('127.') || remote.startsWith('::ffff:127.')) {
    const cf = req.headers['cf-connecting-ip'];
    if (typeof cf === 'string' && cf.trim()) return cf.trim().slice(0, 64);
    const xff = req.headers['x-forwarded-for'];
    if (typeof xff === 'string' && xff.trim()) return xff.split(',').pop().trim().slice(0, 64) || remote;
  }
  return remote;
}

/** サーバー側のしくみの版。ファイルが変わったら、動いているサーバーを起動し直す必要がある */
export function serverRev(root) {
  const hash = createHash('sha256');
  for (const f of SERVER_FILES) {
    hash.update(`${f}\0`);
    try {
      hash.update(readFileSync(join(root, f)));
    } catch {
      hash.update('(none)');
    }
  }
  return hash.digest('hex').slice(0, 16);
}

// ---------------------------------------------------------------- データベースの設定

/** PGSSLMODE の書き方 → pg の ssl の設定(require は「暗号化するが、証明書は確かめない」) */
const SSL_MODES = {
  disable: false,
  allow: false,
  prefer: false,
  require: { rejectUnauthorized: false },
  'no-verify': { rejectUnauthorized: false },
  'verify-ca': true,
  'verify-full': true,
};

const describeTarget = (host, port, database, user) =>
  `サーバー ${host}:${port}・DB ${database || '(未設定)'}・ユーザー ${user || '(未設定)'}`;

/** 書いたとおりに使う値(# も値の一部) */
const LITERAL_KEYS = new Set(['PGPASSWORD', 'DATABASE_URL']);

/**
 * .env を読む。決まりは「# で始まる行はメモ」「KEY=値」だけで、パスワードは書いたとおりに使う
 * (# や記号が入っていてもそのまま書ける。前後の空白は消えるので、残したいときだけ "..." でかこむ)。
 * Node の parseEnv は、値の途中の # を、行の位置しだいでメモ扱いにして消してしまうので使わない
 */
function parseEnvFile(text) {
  const out = {};
  for (const raw of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/.exec(line);
    if (!m) continue;
    let value = m[2].trim();
    const q = value[0];
    if ((q === '"' || q === "'" || q === '`') && value.length >= 2 && value.endsWith(q)) value = value.slice(1, -1);
    // パスワード以外は、うしろに書いたメモ(空白のあとの #)を消す(例: PGHOST=192.168.1.10  # サーバー)
    else if (!LITERAL_KEYS.has(m[1])) value = value.replace(/\s+#.*$/, '');
    out[m[1]] = value;
  }
  return out;
}

/**
 * データベースの設定を読む。本当の環境変数があればそちらを使い、無ければ .env の値を使う。
 * configured: 設定があるか / config: pg に渡すもの / target: 画面に出す説明(パスワードは入れない) /
 * sig: 設定が変わったか見るためのもの(パスワードも入るので、外には出さない)
 */
export function readDbSettings(root) {
  let file = {};
  try {
    file = parseEnvFile(readFileSync(join(root, ENV_FILE), 'utf8'));
  } catch {
    /* .env が無い */
  }
  const v = Object.fromEntries(DB_KEYS.map((k) => [k, String(process.env[k] || file[k] || '')]));
  for (const k of DB_KEYS) if (k !== 'PGPASSWORD') v[k] = v[k].trim();
  const sig = JSON.stringify(v);
  const base = {
    application_name: 'backs-on-backs',
    connectionTimeoutMillis: CONNECT_TIMEOUT,
    statement_timeout: QUERY_TIMEOUT,
    query_timeout: QUERY_TIMEOUT + 1000,
    idle_in_transaction_session_timeout: 10_000,
    keepAlive: true,
  };
  const ssl = v.PGSSLMODE ? (SSL_MODES[v.PGSSLMODE.toLowerCase()] ?? false) : undefined;

  if (v.DATABASE_URL) {
    let target = 'DATABASE_URL';
    try {
      const u = new URL(v.DATABASE_URL);
      target = describeTarget(
        u.hostname,
        u.port || 5432,
        decodeURIComponent(u.pathname.slice(1)),
        decodeURIComponent(u.username),
      );
    } catch {
      /* 形がおかしいときは、つなぐときにエラーになる */
    }
    const config = { ...base, connectionString: v.DATABASE_URL };
    if (ssl !== undefined) config.ssl = ssl;
    return { configured: true, config, target, sig };
  }
  if (!v.PGHOST) return { configured: false, config: null, target: '', sig };
  const port = Number.parseInt(v.PGPORT, 10) || 5432;
  const user = v.PGUSER || undefined;
  const database = v.PGDATABASE || user;
  const config = {
    ...base,
    host: v.PGHOST,
    port,
    user,
    database,
    password: v.PGPASSWORD || undefined,
    ssl: ssl ?? false,
  };
  return { configured: true, config, target: describeTarget(v.PGHOST, port, database, user), sig };
}

/** データベースのエラーを、何を直せばよいかがわかる文にする(エラーの元の文も後ろにつける) */
export function describeDbError(e, settings) {
  const code = String(e?.code ?? e?.errors?.[0]?.code ?? '');
  if (code === 'no-pg') return 'pg(PostgreSQL につなぐ部品)が入っていません。本番起動.bat を起動し直してください(npm install で入ります)';
  if (code === 'no-config') return `データベースの設定がありません。${ENV_FILE} に PGHOST などを書いてください`;
  const raw = String(e?.message || e?.errors?.[0]?.message || e || '').trim();
  const firewall = 'サーバーから返事がありません。IP アドレスと、サーバー用PCのファイアウォール(ポート 5432)を確かめてください';
  const cut = 'データベースとの接続が切れました(PostgreSQL が止まったか、再起動しました)。次に使うときに、つなぎ直します';
  const hints = {
    ECONNRESET: cut,
    '57P01': cut,
    '57P02': cut,
    '57P03': 'PostgreSQL が起動中か、止まるところです。少し待ってください',
    ENOTFOUND: 'サーバーが見つかりません。PGHOST(IP アドレス)を確かめてください',
    EAI_AGAIN: 'サーバーが見つかりません。PGHOST(IP アドレス)を確かめてください',
    ECONNREFUSED: 'サーバーに断られました。PostgreSQL が動いているか、PGPORT と、サーバー側の listen_addresses を確かめてください',
    ETIMEDOUT: firewall,
    EHOSTUNREACH: firewall,
    ENETUNREACH: firewall,
    '28P01': 'ユーザー名かパスワードがちがいます(PGUSER・PGPASSWORD)',
    '28000': 'このユーザーでは接続できません。ユーザー名と、サーバー側の pg_hba.conf を確かめてください',
    '3D000': 'そのデータベースがありません(PGDATABASE)',
    '42501': '権限が足りません。データベースの持ち主のユーザーを使うか、テーブルを作る・使う権限をもらってください',
  };
  let hint = hints[code];
  if (!hint && /timeout/i.test(raw)) hint = firewall;
  else if (!hint && /password must be a string|no password/i.test(raw)) hint = 'パスワードが書かれていません(PGPASSWORD)';
  else if (!hint && /\bSSL\b/i.test(raw)) hint = 'SSL の設定が合っていません(サーバーが SSL を必要とするなら、.env に PGSSLMODE=require)';
  const where = settings?.target ? `(${settings.target})` : '';
  return hint ? `${hint}${where} — ${raw}` : `${raw}${where}`;
}

// ---------------------------------------------------------------- データベース

let pgLoading = null;
/** pg を読みこむ(入っていなければ null)。pg が無くても、ゲームのサーバー自体は動くようにしておく */
function loadPg() {
  pgLoading ??= import('pg').then(
    (m) => m.default ?? m,
    () => null,
  );
  return pgLoading;
}

/** テーブルとインデックスを作る SQL。テーブル名は TABLES の決まった名前だけ(外から来た値は入れない) */
const createSql = (t) => [
  `CREATE TABLE ${t} (
    player_key text NOT NULL CHECK (player_key ~ '^[0-9a-f]{32}$'),
    mode text NOT NULL CHECK (mode IN ('stack', 'pack')),
    name text NOT NULL,
    score integer NOT NULL CHECK (score > 0),
    speed smallint NOT NULL CHECK (speed >= 0),
    detail double precision NOT NULL CHECK (detail >= 0),
    achieved_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (player_key, mode)
  )`,
  `CREATE INDEX ${t}_rank_idx ON ${t} (mode, score DESC, achieved_at, player_key)`,
];

/** 問い合わせの SQL(テーブルごと) */
const sqlFor = (t) => ({
  // 上位 SHOW 人と、自分($2)の行。順位は「点が高い順 → 先に出した順」
  view: `WITH r AS (
      SELECT name, score, speed, detail, player_key,
             round(extract(epoch FROM achieved_at) * 1000)::float8 AS at_ms,
             row_number() OVER (ORDER BY score DESC, achieved_at, player_key)::int AS rank,
             count(*) OVER ()::int AS total
      FROM ${t} WHERE mode = $1
    )
    SELECT name, score, speed, detail, at_ms, rank, total, coalesce(player_key = $2, false) AS me
    FROM r WHERE rank <= $3 OR player_key = $2 ORDER BY rank`,
  // 自己ベストを超えたときだけ書きかえる(返ってくる行が無ければ、更新なし)。
  // 新しく入るときのなまえは: 送られてきたなまえ → 別のモードで使っているなまえ → ななし
  upsert: `INSERT INTO ${t} AS r (player_key, mode, name, score, speed, detail)
    VALUES ($1, $2, coalesce(nullif($3::text, ''), (SELECT name FROM ${t} WHERE player_key = $1 LIMIT 1), $7::text), $4, $5, $6)
    ON CONFLICT (player_key, mode) DO UPDATE
      SET score = excluded.score, speed = excluded.speed, detail = excluded.detail, achieved_at = now()
      WHERE r.score < excluded.score
    RETURNING 1`,
  // なまえは、その人のすべてのモードの行で変える
  rename: `UPDATE ${t} SET name = $2 WHERE player_key = $1 AND name <> $2`,
  // 同じ人の書きこみは 1 つずつ順番に(なまえの変更とスコアが同時に来ても、モードごとになまえがずれないように)
  lock: 'SELECT pg_advisory_xact_lock(2222, hashtext($1))',
  count: `SELECT mode, count(*)::int AS n FROM ${t} GROUP BY mode`,
});

/** テーブルが無ければ作る。作ったら true。何台かが同時に作ろうとしてもぶつからないよう、ロックしてから作る */
async function ensureTable(client, table) {
  const exists = async () => (await client.query('SELECT to_regclass($1) IS NOT NULL AS ok', [table])).rows[0].ok;
  if (await exists()) return false;
  await client.query('BEGIN');
  try {
    await client.query('SELECT pg_advisory_xact_lock(1111, hashtext($1))', [table]);
    let created = false;
    if (!(await exists())) {
      for (const sql of createSql(table)) await client.query(sql);
      created = true;
    }
    await client.query('COMMIT');
    return created;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  }
}

/** 一覧の行 → API の形 */
function toView(rows, mode) {
  const show = (r) => ({
    rank: r.rank,
    name: r.name,
    score: r.score,
    speed: r.speed,
    detail: r.detail,
    at: r.at_ms,
    me: r.me === true,
  });
  const mine = rows.find((r) => r.me === true);
  return { mode, total: rows[0]?.total ?? 0, top: rows.filter((r) => r.rank <= SHOW).map(show), me: mine ? show(mine) : null };
}

/** つなぎ直せば通るかもしれないエラー(切れた接続を使った・データベースの再起動・ロックのぶつかり合い) */
const RETRY_CODES = new Set(['ECONNRESET', 'EPIPE', '57P01', '57P02', '57P03', '08000', '08003', '08006', '40001', '40P01']);
const retryable = (e) =>
  RETRY_CODES.has(e?.code) || /terminated unexpectedly|after calling end on the pool/i.test(String(e?.message ?? ''));

function createDb({ root, table, logger }) {
  const sql = sqlFor(table);
  /** いまの設定とつなぎ先(pool)。設定が変わったら作り直す */
  let state = null;
  let checkedAt = 0;
  let closed = false;
  let failing = false;
  let last = { text: '', at: 0 };

  /** 同じ知らせは 1 分に 1 回まで(つながらない間、同じエラーで画面が埋まらないように) */
  const warn = (text) => {
    const now = Date.now();
    if (text === last.text && now - last.at < 60_000) return;
    last = { text, at: now };
    logger.warn(`ランキング: ${text}`, { timestamp: true });
  };

  async function current() {
    const pg = await loadPg();
    const now = Date.now();
    if (state && now - checkedAt < RELOAD_MS) return { pg, s: state };
    checkedAt = now;
    const settings = readDbSettings(root);
    if (!state || state.sig !== settings.sig) {
      state?.pool?.end().catch(() => {});
      let pool = null;
      if (pg && settings.configured) {
        pool = new pg.Pool({ ...settings.config, max: 5, idleTimeoutMillis: 30_000 });
        // 使っていない接続が切れたとき(データベースの再起動など)。ここで受けないとサーバーごと落ちる
        pool.on('error', (e) => {
          failing = true;
          warn(describeDbError(e, settings));
        });
      }
      state = { sig: settings.sig, settings, pool, ready: null };
    }
    return { pg, s: state };
  }

  /** データベースを使う。つながらないときは 503 にする(エラーはサーバーの画面に出す) */
  async function run(fn) {
    for (let attempt = 0; ; attempt++) {
      if (closed) throw fail(503, 'db');
      const { pg, s } = await current();
      if (!pg || !s.pool) {
        warn(describeDbError({ code: pg ? 'no-config' : 'no-pg' }, s.settings));
        throw fail(503, 'no-db');
      }
      let client = null;
      try {
        client = await s.pool.connect();
        s.ready ??= ensureTable(client, table).then(
          (created) => {
            if (created) logger.info(`ランキング: テーブル ${table} を作りました`, { timestamp: true });
          },
          (e) => {
            s.ready = null;
            throw e;
          },
        );
        await s.ready;
        const out = await fn(client);
        client.release();
        if (failing) {
          failing = false;
          last = { text: '', at: 0 };
          logger.info(`ランキング: データベースにつながりました(${s.settings.target})`, { timestamp: true });
        }
        return out;
      } catch (e) {
        client?.release(true); // エラーのあった接続は使い回さない
        if (attempt === 0 && retryable(e)) continue;
        failing = true;
        warn(describeDbError(e, s.settings));
        throw fail(503, 'db');
      }
    }
  }

  /** key の人の書きこみを 1 つのトランザクションで行う(同じ人の書きこみどうしは順番待ちにする) */
  const inTransaction = (key, fn) =>
    run(async (c) => {
      await c.query('BEGIN');
      try {
        await c.query(sql.lock, [`${table}:${key}`]);
        const out = await fn(c);
        await c.query('COMMIT');
        return out;
      } catch (e) {
        await c.query('ROLLBACK').catch(() => {});
        throw e;
      }
    });

  return {
    async view(mode, key) {
      const { rows } = await run((c) => c.query(sql.view, [mode, key, SHOW]));
      return toView(rows, mode);
    },

    /** スコアを入れる。自己ベストを超えたときだけ書きかえる(なまえはいつも最新にする) */
    submit({ key, mode, score, speed, detail, name }) {
      return inTransaction(key, async (c) => {
        if (name) await c.query(sql.rename, [key, name]);
        const up = await c.query(sql.upsert, [key, mode, name, score, speed, detail, DEFAULT_NAME]);
        const { rows } = await c.query(sql.view, [mode, key, SHOW]);
        return { improved: up.rowCount > 0, ...toView(rows, mode) };
      });
    },

    rename(key, name) {
      return inTransaction(key, (c) => c.query(sql.rename, [key, name]));
    },

    close() {
      closed = true;
      state?.pool?.end().catch(() => {});
      state = null;
    },
  };
}

/**
 * 本番起動.bat から呼ぶ。いまの設定でデータベースにつないで、テーブルを用意し、記録の数を数える。
 * つながらなくても例外にはせず、画面に出す説明を返す
 */
export async function checkDatabase(root, table = TABLES.prod) {
  const settings = readDbSettings(root);
  const base = { target: settings.target, table };
  const pg = await loadPg();
  if (!pg) return { ...base, ok: false, reason: 'no-pg', text: describeDbError({ code: 'no-pg' }) };
  if (!settings.configured) return { ...base, ok: false, reason: 'no-config', text: describeDbError({ code: 'no-config' }) };
  const client = new pg.Client(settings.config);
  client.on('error', () => {}); // 終わったあとに届いたエラーで落ちないように
  try {
    await client.connect();
    const created = await ensureTable(client, table);
    const encoding = (await client.query('SHOW server_encoding')).rows[0].server_encoding;
    const counts = { stack: 0, pack: 0 };
    for (const r of (await client.query(sqlFor(table).count)).rows) counts[r.mode] = r.n;
    return { ...base, ok: true, created, encoding, counts };
  } catch (e) {
    return { ...base, ok: false, reason: 'error', text: describeDbError(e, settings) };
  } finally {
    await client.end().catch(() => {});
  }
}

// ---------------------------------------------------------------- API

class HttpError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}
const fail = (status, code) => new HttpError(status, code);

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(JSON.stringify(body));
}

/**
 * JSON の本文を読む。Content-Type が application/json のものだけ受け付ける
 * (ほかのサイトからこっそり送らせる手口は、ブラウザが先に確認を入れるので、ここで止まる)
 */
function readJson(req) {
  if (!/^application\/json\b/i.test(req.headers['content-type'] ?? '')) return Promise.reject(fail(415, 'content-type'));
  if (Number(req.headers['content-length']) > BODY_MAX) return Promise.reject(fail(413, 'too-large'));
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let done = false;
    req.on('data', (chunk) => {
      if (done) return;
      size += chunk.length;
      if (size > BODY_MAX) {
        done = true;
        reject(fail(413, 'too-large'));
      } else {
        chunks.push(chunk);
      }
    });
    req.on('end', () => {
      if (done) return;
      done = true;
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(fail(400, 'json'));
      }
    });
    req.on('error', (e) => {
      if (done) return;
      done = true;
      reject(e);
    });
  });
}

/** 送られてきたスコアを確かめる。おかしな値は受け付けない */
function parseScore(b) {
  if (b === null || typeof b !== 'object' || Array.isArray(b)) throw fail(400, 'body');
  const key = playerKey(b.id);
  if (!key) throw fail(400, 'id');
  if (!MODES.includes(b.mode)) throw fail(400, 'mode');
  if (!Number.isInteger(b.score) || b.score < 1 || b.score > SCORE_MAX) throw fail(400, 'score');
  if (!Number.isInteger(b.speed) || b.speed < 0 || b.speed > SPEED_MAX) throw fail(400, 'speed');
  if (typeof b.detail !== 'number' || !Number.isFinite(b.detail) || b.detail < 0 || b.detail > DETAIL_MAX) {
    throw fail(400, 'detail');
  }
  return {
    key,
    mode: b.mode,
    score: b.score,
    speed: b.speed,
    detail: Math.round(b.detail * 10) / 10,
    name: cleanName(b.name),
  };
}

function createApi({ root, table, logger }) {
  const db = createDb({ root, table, logger });
  const rev = serverRev(root);
  const hits = new Map();
  /** 回数の上限を超えていなければ true */
  const allow = (who, kind) => {
    const now = Date.now();
    const id = `${kind}:${who}`;
    let h = hits.get(id);
    if (!h || now >= h.reset) {
      if (hits.size > 10_000) for (const [k, v] of hits) if (now >= v.reset) hits.delete(k);
      h = { n: 0, reset: now + LIMIT.perMs };
      hits.set(id, h);
    }
    h.n += 1;
    return h.n <= LIMIT[kind];
  };

  async function handle(req, res) {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const path = url.pathname.replace(/\/+$/, '') || '/';
      if (req.method === 'GET' && path === '/ping') return send(res, 200, { ok: true, rev });

      const who = clientKey(req);
      if (req.method === 'GET' && path === '/') {
        if (!allow(who, 'read')) throw fail(429, 'too-many');
        const mode = url.searchParams.get('mode');
        if (!MODES.includes(mode)) throw fail(400, 'mode');
        return send(res, 200, { ok: true, ...(await db.view(mode, playerKey(req.headers['x-player-id']))) });
      }
      if (req.method === 'POST' && (path === '/' || path === '/name')) {
        if (!allow(who, 'write')) throw fail(429, 'too-many');
        const body = await readJson(req);
        if (path === '/') return send(res, 200, { ok: true, ...(await db.submit(parseScore(body))) });
        const key = playerKey(body?.id);
        if (!key) throw fail(400, 'id');
        const name = cleanName(body?.name);
        if (!name) throw fail(400, 'name');
        await db.rename(key, name);
        return send(res, 200, { ok: true, name });
      }
      if (req.method !== 'GET' && req.method !== 'POST') {
        res.setHeader('Allow', 'GET, POST');
        throw fail(405, 'method');
      }
      throw fail(404, 'not-found');
    } catch (e) {
      const known = e instanceof HttpError;
      if (!known) logger.error(`ランキング: ${e?.stack ?? e}`);
      if (res.headersSent) {
        res.destroy();
        return;
      }
      if (known && e.status === 413) {
        // 大きすぎる本文は最後まで読まずに切る
        res.setHeader('Connection', 'close');
        res.once('finish', () => req.destroy());
      }
      send(res, known ? e.status : 500, { ok: false, error: known ? e.code : 'server' });
    }
  }

  return { handle, close: () => db.close() };
}

/** /api/ranking を足す Vite プラグイン。開発サーバーは、試しに遊んだ記録が本番に混ざらないよう別のテーブル */
export function rankingPlugin() {
  const mount = (server, table) => {
    const { root, logger } = server.config;
    const api = createApi({ root, table, logger });
    server.middlewares.use('/api/ranking', api.handle);
    server.httpServer?.once('close', api.close);
  };
  return {
    name: 'backs-on-backs-ranking',
    configureServer(server) {
      mount(server, TABLES.dev);
    },
    configurePreviewServer(server) {
      mount(server, TABLES.prod);
    },
  };
}
