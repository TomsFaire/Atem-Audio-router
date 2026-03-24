import { BrowserView, BrowserWindow, type RPCSchema } from "electrobun/bun";
import { AtemAudioRouterCore } from "./core.ts";
import type { FullState, PresetInfo } from "./core.ts";

// ── RPC Type Definition ────────────────────────

type AtemRPC = {
	bun: RPCSchema<{
		requests: {
			connectAtem: {
				params: { ip: string };
				response: { success: boolean };
			};
			disconnectAtem: {
				params: Record<string, never>;
				response: { success: boolean };
			};
			setRoute: {
				params: { outputId: number; sourceId: number };
				response: { success: boolean };
			};
			savePreset: {
				params: { name: string };
				response: { success: boolean };
			};
			recallPreset: {
				params: { name: string };
				response: { success: boolean };
			};
			deletePreset: {
				params: { name: string };
				response: { success: boolean };
			};
			getFullState: {
				params: Record<string, never>;
				response: FullState;
			};
			setSplitStereo: {
				params: { enabled: boolean };
				response: { success: boolean };
			};
		};
		messages: Record<string, never>;
	}>;
	webview: RPCSchema<{
		requests: Record<string, never>;
		messages: {
			stateUpdate: FullState;
			atemConnected: Record<string, never>;
			atemDisconnected: Record<string, never>;
			presetsChanged: { presets: PresetInfo[] };
			showError: { message: string };
		};
	}>;
};

// ── Core Instance ──────────────────────────────

const core = new AtemAudioRouterCore({});

// ── RPC Handlers ───────────────────────────────

const atemRPC = BrowserView.defineRPC<AtemRPC>({
	maxRequestTime: 30000,
	handlers: {
		requests: {
			connectAtem: ({ ip }) => {
				core.connect(ip);
				return { success: true };
			},
			disconnectAtem: () => {
				core.disconnect();
				return { success: true };
			},
			setRoute: async ({ outputId, sourceId }) => {
				try {
					await core.setRoute(outputId, sourceId);
					return { success: true };
				} catch (err: unknown) {
					const msg = err instanceof Error ? err.message : String(err);
					atemRPC.message.showError({ message: msg });
					return { success: false };
				}
			},
			savePreset: ({ name }) => {
				try {
					core.savePreset(name);
					return { success: true };
				} catch (err: unknown) {
					const msg = err instanceof Error ? err.message : String(err);
					atemRPC.message.showError({ message: msg });
					return { success: false };
				}
			},
			recallPreset: async ({ name }) => {
				try {
					await core.recallPreset(name);
					return { success: true };
				} catch (err: unknown) {
					const msg = err instanceof Error ? err.message : String(err);
					atemRPC.message.showError({ message: msg });
					return { success: false };
				}
			},
			deletePreset: ({ name }) => {
				try {
					core.deletePreset(name);
					return { success: true };
				} catch (err: unknown) {
					const msg = err instanceof Error ? err.message : String(err);
					atemRPC.message.showError({ message: msg });
					return { success: false };
				}
			},
			getFullState: () => {
				return core.getFullState();
			},
			setSplitStereo: async ({ enabled }) => {
				try {
					await core.setSplitStereo(enabled);
					return { success: true };
				} catch (err: unknown) {
					const msg = err instanceof Error ? err.message : String(err);
					atemRPC.message.showError({ message: msg });
					return { success: false };
				}
			},
		},
		messages: {},
	},
});

// ── Bridge Core Events to Webview ──────────────

core.on("connected", () => {
	atemRPC.message.atemConnected({});
	atemRPC.message.stateUpdate(core.getFullState());
});

core.on("disconnected", () => {
	atemRPC.message.atemDisconnected({});
});

core.on("stateUpdate", (state: FullState) => {
	atemRPC.message.stateUpdate(state);
});

core.on("presetsChanged", (data: { presets: PresetInfo[] }) => {
	atemRPC.message.presetsChanged(data);
});

// ── Create Window ──────────────────────────────

const mainWindow = new BrowserWindow({
	title: "ATEM Audio Router",
	url: "views://mainview/index.html",
	rpc: atemRPC,
	frame: {
		width: 1200,
		height: 800,
		x: 100,
		y: 100,
	},
});

console.log("ATEM Audio Router started!");
