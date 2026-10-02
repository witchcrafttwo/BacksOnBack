// 本番用の起動。「本番起動.bat」をダブルクリック(または npm run lan)で動く。
//  1. 前回のビルドのあとにソースが変わっていたら、ビルドし直す(変わっていなければ省略)
//  2. 完成版(dist)を LAN に公開する(ポート 4173)。
//     すでに起動中なら新しくは起動しない。動いているサーバーは dist を毎回読み直すので、
//     そのまま新しい版を配る(遊んでいる人はページを再読み込みすれば新しい版になる)
import { build, preview } from 'vite';
import { existsSync, readFileSync, readdirSync, statSync, utimesSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4173;
/** ビルドした時刻の目印(ビルドのたびに書き直される dist/index.html の更新時刻) */
const STAMP = join(ROOT, 'dist', 'index.html');

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

const say = (s = '') => console.log(s ? `  ${s}` : '');

/** 終了コードを返す。null = サーバーを動かしたままにする */
async function main() {
  process.title = 'バックおんバックス 本番サーバー';
  say();
  say('バックおんバックス 本番サーバー');
  say();

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
  if (port === 'game') {
    say('本番サーバーは、もう起動しています');
    say(
      rebuilt
        ? '新しい版に入れ替えました。遊んでいる人は、ページを再読み込みすると反映されます'
        : '変更はないので、このまま遊べます',
    );
    say();
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
      say('友だちには、Network の行のうち「Wi-Fi」と書いてある URL を送ってください');
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
