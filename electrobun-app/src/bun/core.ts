import { Atem, Enums } from "atem-connection";
import { EventEmitter } from "events";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, unlinkSync, appendFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

// ── Logger ─────────────────────────────────────

const LOG_DIR = join(homedir(), "Library", "Logs", "ATEM Audio Router");
if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });
const LOG_FILE = join(LOG_DIR, "app.log");

const logBuffer: string[] = [];
const MAX_LOG_LINES = 500;

function log(level: string, ...args: unknown[]) {
	const ts = new Date().toISOString();
	const msg = `${ts} [${level}] ${args.map(a => typeof a === "string" ? a : JSON.stringify(a)).join(" ")}`;
	logBuffer.push(msg);
	if (logBuffer.length > MAX_LOG_LINES) logBuffer.shift();
	try { appendFileSync(LOG_FILE, msg + "\n"); } catch {}
	if (level === "ERROR") {
		console.error(msg);
	} else {
		console.log(msg);
	}
}

export function getLogBuffer(): string[] {
	return logBuffer;
}

export function getLogFilePath(): string {
	return LOG_FILE;
}

// ── Types ──────────────────────────────────────

export interface Source {
	id: number;
	audioSourceId: number;
	audioChannelPair: number;
	externalPortType: number;
	internalPortType: number;
	name: string;
}

export interface Output {
	id: number;
	audioOutputId: number;
	audioChannelPair: number;
	externalPortType: number;
	internalPortType: number;
	sourceId: number;
	name: string;
}

export interface PresetInfo {
	name: string;
	filename: string;
	created: string;
}

export interface Preset {
	name: string;
	created: string;
	routes: Record<string, number>;
}

export interface FullState {
	connected: boolean;
	atemIp: string | null;
	sources: Source[];
	outputs: Output[];
	presets: PresetInfo[];
}

// ── Core ───────────────────────────────────────

export class AtemAudioRouterCore extends EventEmitter {
	atemIp: string | null;
	presetsDir: string;
	splitStereo: boolean;
	atem: Atem | null;
	connected: boolean;
	sources: Record<string, Source>;
	outputs: Record<string, Output>;

	constructor({ atemIp, presetsDir, splitStereo = false }: {
		atemIp?: string | null;
		presetsDir?: string;
		splitStereo?: boolean;
	}) {
		super();

		this.atemIp = atemIp || null;
		this.presetsDir = presetsDir || join(import.meta.dir, "..", "..", "presets");
		this.splitStereo = splitStereo;
		this.atem = null;
		this.connected = false;
		this.sources = {};
		this.outputs = {};

		if (!existsSync(this.presetsDir)) {
			mkdirSync(this.presetsDir, { recursive: true });
		}

		if (this.atemIp) {
			this.connect(this.atemIp);
		}
	}

	connect(ip: string) {
		if (this.atem) {
			this.atem.destroy();
		}

		this.atemIp = ip;
		this.connected = false;
		this.sources = {};
		this.outputs = {};

		this.atem = new Atem({ disableMultithreaded: true });

		this.atem.on("connected", async () => {
			log("INFO", `Connected to ATEM at ${ip}`);
			this.connected = true;

			if (this.splitStereo) {
				await this._applySplitStereoDualMono();
				// Routing table can arrive a moment after connect; retry so output embedders are included
				setTimeout(() => {
					if (!this.splitStereo || !this.connected || !this.atem) return;
					void this._applySplitStereoDualMono().then(() => {
						this._readFullRoutingState();
						this.emit("stateUpdate", this.getFullState());
					});
				}, 500);
			}

			this._readFullRoutingState();

			this.emit("connected");
			this.emit("stateUpdate", this.getFullState());
		});

		this.atem.on("disconnected", () => {
			log("INFO", "Disconnected from ATEM");
			this.connected = false;
			this.emit("disconnected");
		});

		this.atem.on("stateChanged", (_state: unknown, pathsChanged: string[]) => {
			let shouldUpdate = false;

			for (const p of pathsChanged) {
				if (
					p.startsWith("fairlight.audioRouting") ||
					p.startsWith("fairlight.inputs") ||
					p.startsWith("inputs.")
				) {
					shouldUpdate = true;
					break;
				}
			}

			if (shouldUpdate) {
				this._readFullRoutingState();
				this.emit("stateUpdate", this.getFullState());
			}
		});

		this.atem.on("error", (err: Error) => {
			log("ERROR", "ATEM error:", err.message);
		});

		this.atem.on("info", (...args: unknown[]) => {
			log("INFO", "ATEM info:", ...args);
		});

		log("INFO", `Connecting to ATEM at ${ip}...`);
		log("INFO", `Bun version: ${Bun.version}, platform: ${process.platform}, arch: ${process.arch}`);
		log("INFO", `disableMultithreaded: true`);

		const diagAtem = this.atem;

		// Await the connect() promise — it's async
		this.atem.connect(ip).then(() => {
			log("INFO", "connect() promise resolved — UDP handshake initiated");
		}).catch((err: unknown) => {
			const msg = err instanceof Error ? err.message : String(err);
			log("ERROR", "connect() promise rejected:", msg);
		});

		// Diagnostic: deep inspection of socket internals
		const checkSocket = () => {
			if (!diagAtem) return;
			try {
				const atemAny = diagAtem as any;
				const socket = atemAny.socket;
				const socketProcess = socket?._socketProcess;
				const innerSocket = socketProcess?._socket;
				log("INFO", "Socket diagnostic:", JSON.stringify({
					hasSocket: !!socket,
					socketType: socket?.constructor?.name,
					hasSocketProcess: !!socketProcess,
					socketProcessType: socketProcess?.constructor?.name,
					hasInnerDgramSocket: !!innerSocket,
					innerType: innerSocket?.constructor?.name,
					connectionState: socketProcess?._connectionState,
					creatingSocket: !!socket?._creatingSocket,
					disableMultithreaded: socket?._disableMultithreaded,
					address: atemAny._address ?? socket?._address,
					port: atemAny._port ?? socket?._port,
				}));
				// Also dump all own property names for discovery
				if (socket) {
					log("INFO", "AtemSocket keys:", Object.getOwnPropertyNames(socket).join(", "));
				}
				if (socketProcess) {
					log("INFO", "SocketProcess keys:", Object.getOwnPropertyNames(socketProcess).join(", "));
				}
			} catch (e: unknown) {
				const msg = e instanceof Error ? e.message : String(e);
				log("ERROR", "Socket diagnostic error:", msg);
			}
		};
		setTimeout(checkSocket, 1000);
		setTimeout(checkSocket, 5000);
	}

	disconnect() {
		if (this.atem) {
			this.atem.destroy();
			this.atem = null;
		}
		this.connected = false;
		this.sources = {};
		this.outputs = {};
		this.emit("disconnected");
	}

	/**
	 * Set Fairlight strips to DualMono so the routing matrix exposes separate rows/columns
	 * per mono channel. Covers mixer inputs (mics, SDI in, etc.) and output embedders:
	 * those are keyed by `audioOutputId` in `fairlight.audioRouting.outputs` and must be
	 * configured via the same CFIP (Fairlight mixer input) command as input strips.
	 */
	async _applySplitStereoDualMono() {
		if (!this.atem || !this.atem.state || !this.atem.state.fairlight) return;

		const inputs = this.atem.state.fairlight.inputs;
		if (!inputs) return;

		const DualMono = Enums.FairlightInputConfiguration.DualMono;
		let splitCount = 0;

		const trySplitIndex = async (
			inputIndex: number,
			props: { supportedConfigurations?: number[]; activeConfiguration?: number } | undefined,
		) => {
			if (props?.activeConfiguration === DualMono) return false;
			if (props?.supportedConfigurations?.length) {
				const supportsDualMono = (props.supportedConfigurations as number[]).includes(DualMono);
				if (!supportsDualMono) return false;
			}
			try {
				await this.atem!.setFairlightAudioMixerInputProps(inputIndex, {
					activeConfiguration: DualMono,
				});
				return true;
			} catch (err: unknown) {
				const msg = err instanceof Error ? err.message : String(err);
				log("ERROR", `Failed to set DualMono on Fairlight strip ${inputIndex}:`, msg);
				return false;
			}
		};

		const stripIndices = new Set<number>();
		for (const k of Object.keys(inputs)) stripIndices.add(Number(k));

		const routing = this.atem.state.fairlight.audioRouting;
		if (routing?.outputs) {
			for (const out of Object.values(routing.outputs)) {
				const o = out as { audioOutputId?: number };
				if (typeof o.audioOutputId === "number") stripIndices.add(o.audioOutputId);
			}
		}

		for (const inputIndex of stripIndices) {
			const props = inputs[inputIndex]?.properties;
			if (await trySplitIndex(inputIndex, props)) splitCount++;
		}

		if (splitCount > 0) {
			log("INFO", `Split ${splitCount} Fairlight strip(s) to dual mono (inputs and/or outputs)`);
		} else {
			log("INFO", "No strips to split (all dual mono or unsupported)");
		}
	}

	async setSplitStereo(enabled: boolean) {
		this.splitStereo = enabled;
		if (enabled && this.connected) {
			await this._applySplitStereoDualMono();
			this._readFullRoutingState();
			this.emit("stateUpdate", this.getFullState());
			// Routing rows/columns can lag behind DualMono — same as on connect
			setTimeout(() => {
				if (!this.splitStereo || !this.connected || !this.atem) return;
				void this._applySplitStereoDualMono().then(() => {
					this._readFullRoutingState();
					this.emit("stateUpdate", this.getFullState());
				});
			}, 600);
		}
	}

	_getOutputTypeName(internalPortType: number, externalPortType: number): string {
		const internalNames: Record<number, string> = {
			6: "Program",
			7: "Return",
			8: "Monitor",
			9: "MADI Out",
			10: "Aux",
			11: "Audio Aux",
		};
		if (internalPortType && internalNames[internalPortType]) {
			return internalNames[internalPortType];
		}
		const externalFlags: Record<number, string> = {
			1: "SDI Out",
			2: "HDMI Out",
			32: "XLR Out",
			128: "RCA Out",
			1024: "MADI Out",
			2048: "TRS Out",
		};
		if (externalPortType) {
			for (const [flag, label] of Object.entries(externalFlags)) {
				if (externalPortType & Number(flag)) return label;
			}
		}
		return "Output";
	}

	_getChannelPairLabel(audioChannelPair: number): string | null {
		const labels: Record<number, string> = {
			0: "Ch 1-2",
			1: "Ch 3-4",
			2: "Ch 5-6",
			3: "Ch 7-8",
			4: "Ch 9-10",
			5: "Ch 11-12",
			6: "Ch 13-14",
			7: "Ch 15-16",
		};
		return labels[audioChannelPair] || null;
	}

	/** Always-on channel range for routing sources, appended after the input name. */
	_formatInputChannelSuffix(audioChannelPair: number): string {
		if (typeof audioChannelPair === "number" && audioChannelPair >= 0) {
			const known = this._getChannelPairLabel(audioChannelPair);
			if (known) return known;
			const start = audioChannelPair * 2 + 1;
			const end = audioChannelPair * 2 + 2;
			return `Ch ${start}-${end}`;
		}
		return "Ch ?";
	}

	_getInputName(audioSourceId: number): string | null {
		if (!this.atem || !this.atem.state || !this.atem.state.inputs) return null;

		const input = this.atem.state.inputs[audioSourceId];
		if (input) {
			return input.longName || input.shortName || null;
		}
		return null;
	}

	_readFullRoutingState() {
		if (!this.atem || !this.atem.state) return;

		const fairlight = this.atem.state.fairlight;
		if (!fairlight || !fairlight.audioRouting) {
			log("WARN", "No audio routing data available (firmware 9.4+ required)");
			return;
		}

		const routing = fairlight.audioRouting;

		// Cache sources
		this.sources = {};
		if (routing.sources) {
			for (const [id, source] of Object.entries(routing.sources)) {
				const src = source as Record<string, unknown>;
				const umdName = this._getInputName(src.audioSourceId as number);
				const pair = src.audioChannelPair as number;
				const base = umdName || (src.name as string) || `Source ${id}`;
				const ch = this._formatInputChannelSuffix(pair);
				const displayName = `${base} ${ch}`;

				this.sources[id] = {
					id: Number(id),
					audioSourceId: src.audioSourceId as number,
					audioChannelPair: pair,
					externalPortType: src.externalPortType as number,
					internalPortType: src.internalPortType as number,
					name: displayName,
				};
			}
		}

		// Cache outputs
		this.outputs = {};
		if (routing.outputs) {
			// First pass: count outputs per base name
			const nameGroups: Record<string, string[]> = {};
			for (const [id, output] of Object.entries(routing.outputs)) {
				const out = output as Record<string, unknown>;
				const baseName =
					(out.name as string) ||
					this._getOutputTypeName(out.internalPortType as number, out.externalPortType as number);
				if (!nameGroups[baseName]) nameGroups[baseName] = [];
				nameGroups[baseName].push(id);
			}

			// Second pass: build entries with sequential numbering
			const nameCounters: Record<string, number> = {};
			for (const [id, output] of Object.entries(routing.outputs)) {
				const out = output as Record<string, unknown>;
				const baseName =
					(out.name as string) ||
					this._getOutputTypeName(out.internalPortType as number, out.externalPortType as number);
				const needsNumber = nameGroups[baseName].length > 1;

				let displayName = baseName;
				if (needsNumber) {
					if (!nameCounters[baseName]) nameCounters[baseName] = 0;
					nameCounters[baseName]++;
					displayName = `${baseName} ${nameCounters[baseName]}`;
				}

				const pairLabel = this._getChannelPairLabel(out.audioChannelPair as number);
				if (pairLabel) {
					displayName += ` ${pairLabel}`;
				}

				this.outputs[id] = {
					id: Number(id),
					audioOutputId: out.audioOutputId as number,
					audioChannelPair: out.audioChannelPair as number,
					externalPortType: out.externalPortType as number,
					internalPortType: out.internalPortType as number,
					sourceId: out.sourceId as number,
					name: displayName,
				};
			}
		}

		const sourceCount = Object.keys(this.sources).length;
		const outputCount = Object.keys(this.outputs).length;
		log("INFO", `Routing state: ${sourceCount} sources, ${outputCount} outputs`);
	}

	getFullState(): FullState {
		return {
			connected: this.connected,
			atemIp: this.atemIp,
			sources: Object.values(this.sources),
			outputs: Object.values(this.outputs),
			presets: this.listPresets(),
		};
	}

	async setRoute(outputId: number, sourceId: number) {
		if (!this.atem || !this.connected) {
			throw new Error("Not connected to ATEM");
		}

		log("INFO", `Setting route: output ${outputId} -> source ${sourceId}`);
		await this.atem.setFairlightAudioRoutingOutputProperties(Number(outputId), {
			sourceId: Number(sourceId),
		});
	}

	// Preset management

	listPresets(): PresetInfo[] {
		try {
			const files = readdirSync(this.presetsDir);
			return files
				.filter((f) => f.endsWith(".json"))
				.map((f) => {
					const data = JSON.parse(readFileSync(join(this.presetsDir, f), "utf-8")) as Preset;
					return { name: data.name, filename: f, created: data.created };
				});
		} catch {
			return [];
		}
	}

	savePreset(name: string) {
		if (!name || typeof name !== "string") {
			throw new Error("Preset name is required");
		}

		const routes: Record<string, number> = {};
		for (const [id, output] of Object.entries(this.outputs)) {
			routes[id] = output.sourceId;
		}

		const preset: Preset = {
			name,
			created: new Date().toISOString(),
			routes,
		};

		const filename = name.replace(/[^a-zA-Z0-9_-]/g, "_").toLowerCase() + ".json";
		const filepath = join(this.presetsDir, filename);
		writeFileSync(filepath, JSON.stringify(preset, null, 2));

		log("INFO", `Saved preset "${name}" (${Object.keys(routes).length} routes)`);
		this.emit("presetsChanged", { presets: this.listPresets() });
		return preset;
	}

	async recallPreset(name: string) {
		if (!this.atem || !this.connected) {
			throw new Error("Not connected to ATEM");
		}

		const presets = this.listPresets();
		const presetInfo = presets.find((p) => p.name === name);
		if (!presetInfo) {
			throw new Error(`Preset "${name}" not found`);
		}

		const filepath = join(this.presetsDir, presetInfo.filename);
		const preset = JSON.parse(readFileSync(filepath, "utf-8")) as Preset;

		log("INFO", `Recalling preset "${name}"...`);

		let changed = 0;
		for (const [outputId, sourceId] of Object.entries(preset.routes)) {
			const current = this.outputs[outputId];
			if (!current || current.sourceId !== sourceId) {
				await this.atem.setFairlightAudioRoutingOutputProperties(Number(outputId), {
					sourceId: Number(sourceId),
				});
				changed++;
			}
		}

		log("INFO", `Preset "${name}" applied (${changed} routes changed)`);
	}

	deletePreset(name: string) {
		const presets = this.listPresets();
		const presetInfo = presets.find((p) => p.name === name);
		if (!presetInfo) {
			throw new Error(`Preset "${name}" not found`);
		}

		const filepath = join(this.presetsDir, presetInfo.filename);
		unlinkSync(filepath);

		log("INFO", `Deleted preset "${name}"`);
		this.emit("presetsChanged", { presets: this.listPresets() });
	}

	destroy() {
		if (this.atem) {
			this.atem.destroy();
			this.atem = null;
		}
		this.connected = false;
		this.removeAllListeners();
	}
}
