// 本番用の起動。「本番起動.bat」をダブルクリック(または npm run lan)で動く。
//  1. 必要な部品(package.json の vite・pg など)が足りなければ、npm install で入れる
//  2. 前回のビルドのあとにソースが変わっていたら、ビルドし直す(変わっていなければ省略)
//  3. 完成版(dist)とランキングの API をポート 4173 で配る(このパソコンの localhost からも、LAN からも開ける)。
//     すでに起動中なら新しくは起動しない。動いているサーバーは dist を毎回読み直すので、
//     そのまま新しい版を配る(遊んでいる人はページを再読み込みすれば新しい版になる)。
//     ただしサーバー側のしくみ(ランキングなど)が変わったときは、起動し直すよう案内する
//  4. ランキングのデータベース(PostgreSQL)につながるか確かめて、結果を出す。
//     設定ファイル(.env)が無ければ、ひな形(.env.example)から作る
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, readFileSync, readdirSync, statSync, utimesSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENV_FILE, checkDatabase, serverRev } from '../server/ranking.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4173;
/** ビルドした時刻の目印(ビルドのたびに書き直される dist/index.html の更新時刻) */
const STAMP = join(ROOT, 'dist', 'index.html');

const say = (s = '') => console.log(s ? `  ${s}` : '');

/** 部品の入っている版(無ければ null)。node_modules は上のフォルダまでさかのぼって探す(Node と同じ) */
function installedVersion(name) {
  for (let dir = ROOT; ; dir = dirname(dir)) {
    const file = join(dir, 'node_modules', name, 'package.json');
    if (existsSync(file)) {
      try {
        return JSON.parse(readFileSync(file, 'utf8')).version ?? null;
      } catch {
        return null;
      }
    }
    if (dirname(dir) === dir) return null;
  }
}

/** package.json に書いてあるのに、入っていない(か版がちがう)部品の名前 */
function missingDeps() {
  let pkg;
  try {
    pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  } catch {
    return [];
  }
  const wanted = { ...pkg.dependencies, ...pkg.devDependencies };
  return Object.entries(wanted)
    .filter(([name, want]) => {
      const v = installedVersion(name);
      return !v || (/^\d+\.\d+\.\d+$/.test(want) && v !== want);
    })
    .map(([name]) => name);
}

/** 部品が足りなければ npm install で入れる(サーバー用PCで git pull したあと など)。入れられなければ false */
function ensureDeps() {
  const missing = missingDeps();
  if (!missing.length) return true;
  say(`必要な部品が足りないので、入れます(npm install): ${missing.join(', ')}`);
  say();
  // 決まったコマンドだけを実行する(外から来た値は入れない)
  const r = spawnSync('npm install --no-audit --no-fund', { cwd: ROOT, stdio: 'inherit', shell: true });
  say();
  if (r.status === 0 && !missingDeps().length) return true;
  say('部品を入れられませんでした。インターネットにつながっているか確かめて、もう一度起動してください');
  say();
  return false;
}

/** ビルドに使うファイルとフォルダ(あるものだけ)。この中身が目印より新しければビルドし直す */
function buildInputs() {
  const names = ['index.html', 'package.json', 'package-lock.json', 'src', 'public'];
  for (const name of readdirSync(ROOT)) {
    if (name.startsWith('vite.config.') || name.startsWith('.env')) names.push(name);
  }
  return names.map((name) => join(ROOT, name)).filter((p) => existsSync(p));
}

/** path の中(フォルダなら中身ぜんぶ)でいちばん新しい更新時刻。ファイルの追加・削除はフォルダの時刻でわかる */
function newestTime(path) {
  const st = statSync(path);
  let t = st.mtimeMs;
  if (st.isDirectory()) {
    for (const name of readdirSync(path)) t = Math.max(t, newestTime(join(path, name)));
  }
  return t;
}

function needsBuild() {
  if (!existsSync(STAMP)) return true;
  const builtAt = statSync(STAMP).mtimeMs;
  return buildInputs().some((p) => newestTime(p) > builtAt);
}

/**
 * ポート 4173 で何が動いているか。
 * 'game' = いまの dist をそのまま配っている(= このゲームの本番サーバー) / 'other' = 別の何か / 'free' = 空き
 */
async function whoIsOnPort() {
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/`, { signal: AbortSignal.timeout(2000) });
    return (await res.text()) === readFileSync(STAMP, 'utf8') ? 'game' : 'other';
  } catch {
    return 'free';
  }
}

/** 動いている本番サーバーの、サーバー側のしくみの版。ランキングの API が無い古いサーバーなら null */
async function runningRev() {
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/api/ranking/ping`, { signal: AbortSignal.timeout(2000) });
    const body = await res.json();
    return typeof body?.rev === 'string' ? body.rev : null;
  } catch {
    return null;
  }
}

/** データベースの設定ファイルが無ければ、ひな形(.env.example)から作る。作ったら true */
function ensureEnvFile() {
  const file = join(ROOT, ENV_FILE);
  const example = join(ROOT, `${ENV_FILE}.example`);
  if (existsSync(file) || !existsSync(example) || process.env.DATABASE_URL || process.env.PGHOST) return false;
  copyFileSync(example, file);
  return true;
}

/** ランキングのデータベースにつながるか確かめて、結果を出す(つながらなくてもゲームは遊べる) */
async function showDatabase() {
  const made = ensureEnvFile();
  const r = await checkDatabase(ROOT);
  if (r.ok) {
    say(`ランキング: データベースにつながりました(${r.target})`);
    say(`  記録: つみあげ ${r.counts.stack}人・つめこみ ${r.counts.pack}人${r.created ? `(テーブル ${r.table} を作りました)` : ''}`);
    if (!/^(UTF8|SQL_ASCII)$/i.test(r.encoding)) {
      say(`  ※ データベースの文字コードが ${r.encoding} なので、日本語のなまえが入らないかもしれません(UTF8 がおすすめ)`);
    }
  } else if (r.reason === 'no-config') {
    say(made ? `ランキング: データベースの設定ファイルを作りました` : 'ランキング: データベースの設定がまだです');
    say(`  ${join(ROOT, ENV_FILE)} をメモ帳で開いて、PostgreSQL の場所とユーザー・パスワードを書いてください`);
    say('  書けば、起動し直さなくてもつながります(もう一度ダブルクリックすると、つながったか確かめられます)');
    say('  ランキング以外は、いまも遊べます');
  } else {
    say('ランキング: データベースにつながりません');
    say(`  ${r.text}`);
    say(`  ${ENV_FILE} を直せば、起動し直さなくてもつながります。ランキング以外は、このまま遊べます`);
  }
  say();
}

/** 終了コードを返す。null = サーバーを動かしたままにする */
async function main() {
  process.title = 'バックおんバックス 本番サーバー';
  say();
  say(process.title);
  say();

  if (!ensureDeps()) return 1;
  // 部品がそろってから読みこむ(足りないまま読みこむと、ここで止まってしまう)
  const { build, preview } = await import('vite');

  const rebuilt = needsBuild();
  if (rebuilt) {
    say('前回のビルドから変更があったので、ビルドします');
    say();
    const startedAt = new Date();
    try {
      await build({ root: ROOT });
    } catch (e) {
      say();
      say('ビルドに失敗しました。エラーを直してから、もう一度起動してください');
      say('(動いている本番サーバーがあれば、前の版のまま動いています)');
      say();
      console.error(e?.message ?? e);
      return 1;
    }
    // ビルド中に保存された変更を次回取りこぼさないよう、目印は「ビルドを始めた時刻」にしておく
    utimesSync(STAMP, startedAt, startedAt);
    say();
  } else {
    say('前回のビルドから変更がないので、ビルドは省略します');
    say();
  }

  const port = await whoIsOnPort();
  if (port === 'game' && (await runningRev()) !== serverRev(ROOT)) {
    // dist は読み直してくれるが、サーバー側のしくみは起動したときのまま。古いままだとランキングがおかしくなる
    say('本番サーバーは起動していますが、サーバー側のしくみ(ランキングなど)が新しくなりました');
    say('いま動いている本番サーバーのウィンドウを閉じてから、もう一度起動してください');
    say();
    return 1;
  }
  if (port === 'game') {
    say('本番サーバーは、もう起動しています');
    say(
      rebuilt
        ? '新しい版に入れ替えました。遊んでいる人は、ページを再読み込みすると反映されます'
        : '変更はないので、このまま遊べます',
    );
    say();
    await showDatabase();
    return 0;
  }
  if (port === 'free') {
    try {
      const server = await preview({
        root: ROOT,
        preview: { host: true, port: PORT, strictPort: true, open: false },
      });
      server.printUrls();
      say();
      say('同じ Wi-Fi の友だちには、Network の行のうち「Wi-Fi」と書いてある URL を送ってください');
      say();
      await showDatabase();
      say('止めるときは、このウィンドウを閉じてください(または Ctrl+C)');
      say();
      return null;
    } catch (e) {
      if (!/already in use/i.test(String(e?.message))) throw e;
    }
  }
  say(`ポート ${PORT} を別のアプリが使っているので、起動できませんでした`);
  say('そのアプリを止めてから、もう一度起動してください');
  say();
  return 1;
}

main().then(
  (code) => {
    if (code !== null) process.exit(code);
  },
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
