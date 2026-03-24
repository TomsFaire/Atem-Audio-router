import { Atem, Enums } from "atem-connection";
import { EventEmitter } from "events";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, unlinkSync } from "fs";
import { join } from "path";

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

		this.atem = new Atem();

		this.atem.on("connected", async () => {
			console.log(`[Core] Connected to ATEM at ${ip}`);
			this.connected = true;

			if (this.splitStereo) {
				await this._splitAllStereoInputs();
			}

			this._readFullRoutingState();

			this.emit("connected");
			this.emit("stateUpdate", this.getFullState());
		});

		this.atem.on("disconnected", () => {
			console.log(`[Core] Disconnected from ATEM`);
			this.connected = false;
			this.emit("disconnected");
		});

		this.atem.on("stateChanged", (_state: unknown, pathsChanged: string[]) => {
			let shouldUpdate = false;

			for (const p of pathsChanged) {
				if (p.startsWith("fairlight.audioRouting") || p.startsWith("inputs.")) {
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
			console.error(`[Core] ATEM error:`, err.message);
		});

		console.log(`[Core] Connecting to ATEM at ${ip}...`);
		this.atem.connect(ip);
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

	async _splitAllStereoInputs() {
		if (!this.atem || !this.atem.state || !this.atem.state.fairlight) return;

		const inputs = this.atem.state.fairlight.inputs;
		if (!inputs) return;

		const DualMono = Enums.FairlightInputConfiguration.DualMono;
		let splitCount = 0;

		for (const [inputIndex, input] of Object.entries(inputs)) {
			if (!input || !input.properties) continue;

			const props = input.properties;
			const supportsDualMono =
				props.supportedConfigurations &&
				(props.supportedConfigurations as number[]).includes(DualMono);

			if (supportsDualMono && props.activeConfiguration !== DualMono) {
				try {
					await this.atem!.setFairlightAudioMixerInputProps(Number(inputIndex), {
						activeConfiguration: DualMono,
					});
					splitCount++;
				} catch (err: unknown) {
					const msg = err instanceof Error ? err.message : String(err);
					console.error(`[Core] Failed to split input ${inputIndex}:`, msg);
				}
			}
		}

		if (splitCount > 0) {
			console.log(`[Core] Split ${splitCount} stereo input(s) to dual mono`);
		} else {
			console.log(`[Core] No stereo inputs to split (all already dual mono or unsupported)`);
		}
	}

	async setSplitStereo(enabled: boolean) {
		this.splitStereo = enabled;
		if (enabled && this.connected) {
			await this._splitAllStereoInputs();
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
			console.log("[Core] No audio routing data available (firmware 9.4+ required)");
			return;
		}

		const routing = fairlight.audioRouting;

		// Cache sources
		this.sources = {};
		if (routing.sources) {
			for (const [id, source] of Object.entries(routing.sources)) {
				const src = source as Record<string, unknown>;
				const umdName = this._getInputName(src.audioSourceId as number);
				this.sources[id] = {
					id: Number(id),
					audioSourceId: src.audioSourceId as number,
					audioChannelPair: src.audioChannelPair as number,
					externalPortType: src.externalPortType as number,
					internalPortType: src.internalPortType as number,
					name: umdName || (src.name as string) || `Source ${id}`,
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
		console.log(`[Core] Routing state: ${sourceCount} sources, ${outputCount} outputs`);
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

		console.log(`[Core] Setting route: output ${outputId} -> source ${sourceId}`);
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

		console.log(`[Core] Saved preset "${name}" (${Object.keys(routes).length} routes)`);
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

		console.log(`[Core] Recalling preset "${name}"...`);

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

		console.log(`[Core] Preset "${name}" applied (${changed} routes changed)`);
	}

	deletePreset(name: string) {
		const presets = this.listPresets();
		const presetInfo = presets.find((p) => p.name === name);
		if (!presetInfo) {
			throw new Error(`Preset "${name}" not found`);
		}

		const filepath = join(this.presetsDir, presetInfo.filename);
		unlinkSync(filepath);

		console.log(`[Core] Deleted preset "${name}"`);
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
