// 本番用の起動。
//  「本番起動.bat」(npm run lan)     : LAN に公開する
//  「ネット公開.bat」(npm run tunnel) : LAN に加えて、Cloudflare のクイックトンネルでインターネットにも公開する
//
//  1. 前回のビルドのあとにソースが変わっていたら、ビルドし直す(変わっていなければ省略)
//  2. 完成版(dist)を LAN に公開する(ポート 4173)。
//     すでに起動中なら新しくは起動しない。動いているサーバーは dist を毎回読み直すので、
//     そのまま新しい版を配る(遊んでいる人はページを再読み込みすれば新しい版になる)
//  3. ネット公開のときは、cloudflared で https://〜.trycloudflare.com の URL を作る。
//     もう別のウィンドウでネット公開していれば、その URL を表示するだけ(URL は変わらない)
import { build, preview } from 'vite';
import { spawn } from 'node:child_process';
import { Resolver, resolve4, resolveNs } from 'node:dns/promises';
import { existsSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4173;
/** ビルドした時刻の目印(ビルドのたびに書き直される dist/index.html の更新時刻) */
const STAMP = join(ROOT, 'dist', 'index.html');
/** ネット公開もするか(ネット公開.bat / npm run tunnel) */
const TUNNEL = process.argv.includes('--tunnel');
/** ネット公開中の URL と cloudflared の PID。別のウィンドウから「もう公開中か」を見るために置いておく */
const TUNNEL_STATE = join(tmpdir(), `backs-on-backs-tunnel-${PORT}.json`);
/** クイックトンネルの URL(ランダムな英単語をハイフンでつないだ名前。api.trycloudflare.com などは含めない) */
const TUNNEL_URL_RE = /https:\/\/[a-z0-9]+(?:-[a-z0-9]+)+\.trycloudflare\.com/i;

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

/** このウィンドウで本番サーバーを起動する。ポートがもう使われていたら false */
async function startServer() {
  try {
    const server = await preview({
      root: ROOT,
      preview: { host: true, port: PORT, strictPort: true, open: false },
    });
    server.printUrls();
    say();
    say('同じ Wi-Fi の友だちには、Network の行のうち「Wi-Fi」と書いてある URL を送ってください');
    say();
    return true;
  } catch (e) {
    if (/already in use/i.test(String(e?.message))) return false;
    throw e;
  }
}

// ---------------------------------------------------------------- ネット公開(Cloudflare Tunnel)

/** cloudflared の場所。PATH と、よくあるインストール先を探す(見つからなければ null) */
function findCloudflared() {
  const win = process.platform === 'win32';
  const exe = win ? 'cloudflared.exe' : 'cloudflared';
  const env = process.env;
  const dirs = (env.PATH ?? '').split(win ? ';' : ':');
  if (win) {
    const local = env.LOCALAPPDATA;
    dirs.push(
      env['ProgramFiles(x86)'] && join(env['ProgramFiles(x86)'], 'cloudflared'), // winget / MSI のインストール先
      env.ProgramFiles && join(env.ProgramFiles, 'cloudflared'),
      local && join(local, 'Microsoft', 'WinGet', 'Links'),
      local && join(local, 'Programs', 'cloudflared'), // 自分のユーザーだけに入れたとき
    );
  }
  for (const dir of dirs) {
    if (!dir) continue;
    const p = join(dir.replace(/^"|"$/g, ''), exe);
    if (existsSync(p)) return p;
  }
  return null;
}

/** 別のウィンドウでネット公開しているなら、その URL(していなければ null) */
function runningTunnelUrl() {
  try {
    const { url, pid } = JSON.parse(readFileSync(TUNNEL_STATE, 'utf8'));
    process.kill(pid, 0); // cloudflared が動いているか確かめるだけ(止まっていれば例外になる)
    return url;
  } catch {
    return null;
  }
}

/** pid のトンネルの記録を消す(別のトンネルの記録なら残す) */
function clearTunnelState(pid) {
  try {
    if (JSON.parse(readFileSync(TUNNEL_STATE, 'utf8')).pid === pid) rmSync(TUNNEL_STATE);
  } catch {
    /* もう無い */
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * トンネルの URL の DNS が用意できるまで待つ(1 分くらいであきらめる)。
 * DNS はトンネルがつながってから 15 秒くらいたって用意される。その前にパソコンの DNS で引くと
 * 「その名前は無い」と 60 秒覚えられてしまい、その間はこのパソコンのブラウザでも開けなくなる。
 * なので trycloudflare.com の権威 DNS サーバーに直接きく。node:dns の Resolver も「無い」を 60 秒覚えるので、
 * 1 回ごとに作り直す。直接きけないネットワークのときや、用意されないまま時間切れのときは false
 */
async function waitDns(hostname, alive) {
  let servers;
  try {
    const ns = await resolveNs('trycloudflare.com');
    servers = (await Promise.all(ns.map((n) => resolve4(n).catch(() => [])))).flat();
  } catch {
    return false;
  }
  if (!servers.length) return false;
  for (let i = 0; i < 60 && alive(); i++) {
    const resolver = new Resolver({ timeout: 2000, tries: 1 });
    resolver.setServers(servers);
    try {
      if ((await resolver.resolve4(hostname)).length) return true;
    } catch {
      /* まだ用意されていない */
    }
    await sleep(1000);
  }
  return false;
}

/**
 * URL が外から開けるようになるまで待つ(Cloudflare を通って、このサーバーまで届くか)。
 * DNS が用意できたと確かめられたときだけ実際に開いてみる(先に開くと上のとおり 60 秒開けなくなるため)
 */
async function waitReachable(url, alive) {
  if (!(await waitDns(new URL(url).hostname, alive))) return false;
  for (let i = 0; i < 10 && alive(); i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
      const ok = res.ok;
      await res.text();
      if (ok) return true;
    } catch {
      /* まだつながらない */
    }
    await sleep(2000);
  }
  return false;
}

/**
 * Cloudflare のクイックトンネルを開いて、URL を表示する(https://〜.trycloudflare.com)。
 * cloudflared はこのウィンドウにつないだまま動かす。windowsHide を使うと見えない別のコンソールで動いてしまい、
 * ウィンドウを閉じてもネット公開が止まらなくなるので使わない。このプロセスが終わるときは一緒に止める。
 * serverHere: 本番サーバーもこのウィンドウで動いているか(閉じたときに何が止まるかの案内に使う)
 */
function startTunnel(exe, serverHere) {
  say('Cloudflare Tunnel をつないでいます…');
  say();
  const child = spawn(exe, ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${PORT}`], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const alive = () => child.exitCode === null && child.signalCode === null;
  process.on('exit', () => {
    if (alive()) child.kill();
    clearTunnelState(child.pid);
  });
  // Ctrl+C・Ctrl+Break・ウィンドウを閉じたとき(Windows では SIGHUP になる)も、exit を通って一緒に止める
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) process.on(sig, () => process.exit(0));

  const recent = [];
  let url = null;
  let registered = false;
  let checking = false;
  let announced = false;
  let reported = false;
  const slow = setTimeout(() => {
    say('なかなかつながりません…インターネットの接続を確かめてください(このまま待つと、つながることもあります)');
    say();
  }, 45000);

  const announce = (reachable) => {
    if (!alive()) return;
    announced = true;
    writeFileSync(TUNNEL_STATE, JSON.stringify({ url, pid: child.pid }));
    say(
      reachable
        ? 'ネット公開できました。この URL を送ってください(URL を知っている人なら、だれでも開けます)'
        : 'トンネルはつながりました。開けないときは、1 分ほど待ってから開き直してください',
    );
    say();
    say(`    ${url}`);
    say();
    say('URL は、ネット公開を起動するたびに変わります');
    say(
      serverHere
        ? '止めるときは、このウィンドウを閉じてください(LAN もネット公開も止まります)'
        : 'このウィンドウを閉じると、ネット公開だけが止まります(LAN のサーバーは動いたまま)',
    );
    say();
  };
  const onLine = (line) => {
    recent.push(line);
    if (recent.length > 12) recent.shift();
    url ??= line.match(TUNNEL_URL_RE)?.[0] ?? null;
    if (/Registered tunnel connection/i.test(line)) registered = true;
    if (url && registered && !checking) {
      checking = true;
      clearTimeout(slow);
      waitReachable(url, alive).then(announce);
    }
  };
  for (const stream of [child.stdout, child.stderr]) createInterface({ input: stream }).on('line', onLine);

  const fail = (why) => {
    if (reported) return;
    reported = true;
    clearTimeout(slow);
    say(why);
    say();
    for (const l of recent) console.log(`    ${l}`);
    if (recent.length) say();
    process.exitCode = 1;
  };
  child.on('error', (e) => fail(`cloudflared を起動できませんでした: ${e.message}`));
  child.on('exit', () => {
    clearTunnelState(child.pid);
    if (!announced) {
      fail('ネット公開に失敗しました(cloudflared が止まりました)。インターネットの接続を確かめて、もう一度起動してください');
      return;
    }
    say(`ネット公開が止まりました${serverHere ? '(LAN では、このまま遊べます)' : ''}`);
    say();
  });
}

// ---------------------------------------------------------------- 起動

/** 終了コードを返す。null = サーバー(やトンネル)を動かしたままにする */
async function main() {
  process.title = TUNNEL ? 'バックおんバックス ネット公開' : 'バックおんバックス 本番サーバー';
  say();
  say(process.title);
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
  let serverHere = false;
  if (port === 'game') {
    say('本番サーバーは、もう起動しています');
    say(
      rebuilt
        ? '新しい版に入れ替えました。遊んでいる人は、ページを再読み込みすると反映されます'
        : '変更はないので、このまま遊べます',
    );
    say();
  } else {
    serverHere = port === 'free' && (await startServer());
    if (!serverHere) {
      say(`ポート ${PORT} を別のアプリが使っているので、起動できませんでした`);
      say('そのアプリを止めてから、もう一度起動してください');
      say();
      return 1;
    }
  }

  const running = runningTunnelUrl();
  if (running) {
    say(`ネット公開中です(URL はそのまま): ${running}`);
    say();
  } else if (TUNNEL) {
    const exe = findCloudflared();
    if (exe) {
      startTunnel(exe, serverHere);
      return null;
    }
    say('cloudflared が見つからないので、ネット公開はできませんでした');
    say('インストールしてから、もう一度起動してください(例: winget install --id Cloudflare.cloudflared)');
    say();
    if (!serverHere) return 1;
    say('LAN の URL では、このまま遊べます');
  }
  if (!serverHere) return 0;
  say('止めるときは、このウィンドウを閉じてください(または Ctrl+C)');
  say();
  return null;
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
