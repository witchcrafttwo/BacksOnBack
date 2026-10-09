import { defineConfig } from 'vite';
import { rankingPlugin } from './server/ranking.mjs';

export default defineConfig({
  // ランキング(/api/ranking)。記録は PostgreSQL に入れる。中身は server/ranking.mjs、つなぎ先の設定は .env
  plugins: [rankingPlugin()],
  preview: {
    // 本番サーバー(本番起動.bat / npm run lan)は、どのホスト名で来たアクセスも受け付ける。
    // Cloudflare Tunnel などで localhost:4173 に転送すると、Host ヘッダーは公開したドメイン名のまま届く。
    // Vite は知らないホスト名を「Blocked request」(403) で断るので、本番サーバーだけそのチェックを外している。
    // 本番サーバーが配るのは完成版(dist)のファイルとランキングの API だけで、ソースや .env は配らない。
    // 開発サーバー(npm run dev)はチェックしたまま。
    // ドメインを決め打ちにしたいときは true の代わりに ['game.example.com'] のように書く
    // (変えたあとは、動いている本番サーバーのウィンドウを一度閉じてから起動し直す)
    allowedHosts: true,
  },
});
