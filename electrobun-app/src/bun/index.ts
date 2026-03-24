import { BrowserView, BrowserWindow, type RPCSchema } from "electrobun/bun";
import { AtemAudioRouterCore, getLogBuffer, getLogFilePath } from "./core.ts";
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
				console.log(`[RPC] connectAtem called with ip: ${ip}`);
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

// ── HTTP API for external control (Q-SYS, etc.) ──

const API_PORT = Number(Bun.env.API_PORT) || 4000;

function jsonResponse(data: unknown, status = 200) {
	return new Response(JSON.stringify(data), {
		status,
		headers: {
			"Content-Type": "application/json",
			"Access-Control-Allow-Origin": "*",
			"Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
			"Access-Control-Allow-Headers": "Content-Type",
		},
	});
}

function errorResponse(message: string, status = 400) {
	return jsonResponse({ success: false, error: message }, status);
}

Bun.serve({
	port: API_PORT,
	async fetch(req) {
		const url = new URL(req.url);
		const path = url.pathname;

		// CORS preflight
		if (req.method === "OPTIONS") {
			return jsonResponse(null, 204);
		}

		console.log(`[API] ${req.method} ${path}`);

		// GET /api/state — full routing state
		if (req.method === "GET" && path === "/api/state") {
			return jsonResponse(core.getFullState());
		}

		// POST /api/route — set a route
		if (req.method === "POST" && path === "/api/route") {
			try {
				const body = await req.json() as { outputId?: number; sourceId?: number };
				if (body.outputId == null || body.sourceId == null) {
					return errorResponse("outputId and sourceId are required");
				}
				await core.setRoute(body.outputId, body.sourceId);
				return jsonResponse({ success: true });
			} catch (err: unknown) {
				const msg = err instanceof Error ? err.message : String(err);
				return errorResponse(msg, 500);
			}
		}

		// GET /api/presets — list presets
		if (req.method === "GET" && path === "/api/presets") {
			return jsonResponse(core.listPresets());
		}

		// POST /api/preset/recall — recall a preset
		if (req.method === "POST" && path === "/api/preset/recall") {
			try {
				const body = await req.json() as { name?: string };
				if (!body.name) {
					return errorResponse("name is required");
				}
				await core.recallPreset(body.name);
				return jsonResponse({ success: true });
			} catch (err: unknown) {
				const msg = err instanceof Error ? err.message : String(err);
				return errorResponse(msg, 500);
			}
		}

		// POST /api/preset/save — save a preset
		if (req.method === "POST" && path === "/api/preset/save") {
			try {
				const body = await req.json() as { name?: string };
				if (!body.name) {
					return errorResponse("name is required");
				}
				core.savePreset(body.name);
				return jsonResponse({ success: true });
			} catch (err: unknown) {
				const msg = err instanceof Error ? err.message : String(err);
				return errorResponse(msg, 500);
			}
		}

		// DELETE /api/preset/:name — delete a preset
		if (req.method === "DELETE" && path.startsWith("/api/preset/")) {
			try {
				const name = decodeURIComponent(path.replace("/api/preset/", ""));
				if (!name || name === "recall" || name === "save") {
					return errorResponse("preset name is required");
				}
				core.deletePreset(name);
				return jsonResponse({ success: true });
			} catch (err: unknown) {
				const msg = err instanceof Error ? err.message : String(err);
				return errorResponse(msg, 500);
			}
		}

		// POST /api/connect — connect to ATEM
		if (req.method === "POST" && path === "/api/connect") {
			try {
				const body = await req.json() as { ip?: string };
				if (!body.ip) {
					return errorResponse("ip is required");
				}
				core.connect(body.ip);
				return jsonResponse({ success: true });
			} catch (err: unknown) {
				const msg = err instanceof Error ? err.message : String(err);
				return errorResponse(msg, 500);
			}
		}

		// GET /api/logs — recent log buffer for diagnostics
		if (req.method === "GET" && path === "/api/logs") {
			return jsonResponse({
				logFile: getLogFilePath(),
				lines: getLogBuffer(),
			});
		}

		return errorResponse("Not found", 404);
	},
});

console.log("ATEM Audio Router started!");
console.log(`HTTP API listening on port ${API_PORT}`);
console.log(`Log file: ${getLogFilePath()}`);
