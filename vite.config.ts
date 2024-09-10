import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	plugins: [sveltekit()],
	server: {
		host: true, // ネットワーク上のすべてのアドレスでリッスン
		port: 5173 // デフォルトのポート番号（必要に応じて変更可能）
	},
	test: {
		include: ['src/**/*.{test,spec}.{js,ts}']
	}
});
