import { defineConfig } from 'vite';

/**
 * 本番サーバー(vite preview)が受け付けるホスト名。
 * Vite は、知らないホスト名で来たアクセスを「Blocked request」(403) で断る(DNS リバインディング対策)。
 * IP アドレスと localhost はもともと通るので、LAN の URL はこのままで使える。
 *  - '.trycloudflare.com' : Cloudflare のクイックトンネル(ネット公開.bat)。URL が毎回変わるので、サブドメインごと許可する
 *  - 自分のドメインで Cloudflare Tunnel を作ったときは、そのホスト名を足す(例: 'game.example.com')。
 *    足したあとは、動いている本番サーバーを一度閉じてから起動し直す(設定は起動したときに読むため)
 */
const PUBLIC_HOSTS = ['.trycloudflare.com'];

export default defineConfig({
  preview: {
    allowedHosts: PUBLIC_HOSTS,
  },
});
