import type { ElectrobunConfig } from "electrobun";

export default {
	app: {
		name: "ATEM Audio Router",
		identifier: "com.faire.atem-audio-router",
		version: "1.0.0",
	},
	build: {
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
