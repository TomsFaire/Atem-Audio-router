import type { ElectrobunConfig } from "electrobun";

export default {
	app: {
		name: "ATEM Audio Router",
		identifier: "com.faire.atem-audio-router",
		version: "1.0.0",
	},
	build: {
		bun: {
			// Replace native addon not needed for audio routing with a no-op stub
			plugins: [{
				name: "stub-freetype2",
				setup(build: { onResolve: Function; onLoad: Function }) {
					build.onResolve({ filter: /^@julusian\/freetype2$/ }, () => ({
						path: "stub:freetype2",
						namespace: "stub",
					}));
					build.onResolve({ filter: /^pkg-prebuilds/ }, () => ({
						path: "stub:pkg-prebuilds",
						namespace: "stub",
					}));
					build.onLoad({ filter: /.*/, namespace: "stub" }, () => ({
						contents: "module.exports = {};",
						loader: "js",
					}));
				},
			}],
		},
		views: {
			mainview: {
				entrypoint: "src/mainview/index.ts",
			},
		},
		copy: {
			"src/mainview/index.html": "views/mainview/index.html",
			"src/mainview/style.css": "views/mainview/style.css",
		},
		mac: {
			bundleCEF: false,
		},
		linux: {
			bundleCEF: false,
		},
		win: {
			bundleCEF: false,
		},
	},
} satisfies ElectrobunConfig;
