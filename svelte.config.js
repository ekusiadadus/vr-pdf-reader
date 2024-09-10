import adapter from "@sveltejs/adapter-auto";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

/** @type {import('@sveltejs/kit').Config} */
const config = {
    preprocess: vitePreprocess(),

    kit: {
        adapter: adapter()
    },

    vite: {
        ssr: {
            noExternal: ["three"]
        },
        optimizeDeps: {
            exclude: ["babylonjs", "babylonjs-loaders", "pdfjs-dist"]
        }
    }
};

export default config;
