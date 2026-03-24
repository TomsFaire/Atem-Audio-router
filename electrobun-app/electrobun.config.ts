import type { ElectrobunConfig } from "electrobun";

export default {
	app: {
		name: "ATEM Audio Router",
		identifier: "com.faire.atem-audio-router",
		version: "1.0.0",
	},
	build: {
		bun: {
			plugins: [
				{
					// Stub out native addon not needed for audio routing
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
				},
				{
					// Replace threadedclass with a shim that directly instantiates
					// AtemSocketChild in-process. threadedclass uses dynamic require()
					// which breaks when Bun bundles everything into a single file.
					name: "shim-threadedclass",
					setup(build: { onResolve: Function; onLoad: Function }) {
						build.onResolve({ filter: /^threadedclass$/ }, () => ({
							path: "shim:threadedclass",
							namespace: "shim-tc",
						}));
						build.onLoad({ filter: /.*/, namespace: "shim-tc" }, () => ({
							contents: `
								const { AtemSocketChild } = require("atem-connection/dist/lib/atemSocketChild");
								exports.threadedClass = async function(_path, _className, args, _options) {
									return new AtemSocketChild(...args);
								};
								exports.ThreadedClassManager = {
									destroy: async (instance) => { if (instance && instance.destroy) await instance.destroy(); },
									onEvent: () => {},
								};
							`,
							loader: "js",
						}));
					},
				},
			],
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
	scripts: {
		postBuild: "scripts/patch-plist.ts",
		postWrap: "scripts/patch-plist.ts",
	},
} satisfies ElectrobunConfig;
