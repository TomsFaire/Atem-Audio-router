import Electrobun, { Electroview } from "electrobun/view";

// ── Types (mirrored from bun side) ─────────────

interface Source {
	id: number;
	audioSourceId: number;
	audioChannelPair: number;
	externalPortType: number;
	internalPortType: number;
	name: string;
}

interface Output {
	id: number;
	audioOutputId: number;
	audioChannelPair: number;
	externalPortType: number;
	internalPortType: number;
	sourceId: number;
	name: string;
}

interface PresetInfo {
	name: string;
	filename: string;
	created: string;
}

interface FullState {
	connected: boolean;
	atemIp: string | null;
	sources: Source[];
	outputs: Output[];
	presets: PresetInfo[];
}

interface BuildInfo {
	version: string;
	buildId: string;
	builtAt: string;
}

type AtemRPC = {
	bun: {
		requests: {
			connectAtem: { params: { ip: string }; response: { success: boolean } };
			disconnectAtem: { params: Record<string, never>; response: { success: boolean } };
			setRoute: { params: { outputId: number; sourceId: number }; response: { success: boolean } };
			savePreset: { params: { name: string }; response: { success: boolean } };
			recallPreset: { params: { name: string }; response: { success: boolean } };
			deletePreset: { params: { name: string }; response: { success: boolean } };
			getFullState: { params: Record<string, never>; response: FullState };
			setSplitStereo: { params: { enabled: boolean }; response: { success: boolean } };
			getBuildInfo: { params: Record<string, never>; response: BuildInfo };
		};
		messages: Record<string, never>;
	};
	webview: {
		requests: Record<string, never>;
		messages: {
			stateUpdate: FullState;
			atemConnected: Record<string, never>;
			atemDisconnected: Record<string, never>;
			presetsChanged: { presets: PresetInfo[] };
			showError: { message: string };
		};
	};
};

// ── RPC Setup ──────────────────────────────────

const rpc = Electroview.defineRPC<AtemRPC>({
	maxRequestTime: 30000,
	handlers: {
		requests: {},
		messages: {
			stateUpdate: (state: FullState) => {
				handleFullState(state);
			},
			atemConnected: () => {
				atemConnected = true;
				updateStatus();
				showToast("Connected to ATEM");
			},
			atemDisconnected: () => {
				atemConnected = false;
				updateStatus();
				showToast("Disconnected from ATEM", "error");
			},
			presetsChanged: (data: { presets: PresetInfo[] }) => {
				presets = data.presets || [];
				buildPresetList();
			},
			showError: (data: { message: string }) => {
				showToast(data.message || "An error occurred", "error");
			},
		},
	},
});

// Debug banner
declare global { interface Window { __debugLog?: (msg: string) => void; __electrobun?: any; __electrobunWebviewId?: any; __electrobunRpcSocketPort?: any; } }
function debugLog(msg: string) {
	if (window.__debugLog) window.__debugLog(msg);
	console.log(msg);
}

debugLog(`Pre-init: __electrobun=${typeof window.__electrobun}, webviewId=${window.__electrobunWebviewId}, rpcPort=${window.__electrobunRpcSocketPort}`);

let electrobun: any;
try {
	electrobun = new Electrobun.Electroview({ rpc });
	debugLog("Electroview initialized OK");
} catch (err) {
	debugLog(`Electroview init FAILED: ${err}`);
}

// ── State ──────────────────────────────────────

let sources: Source[] = [];
let outputs: Output[] = [];
let presets: PresetInfo[] = [];
let atemConnected = false;

/** When split stereo or routing updates, row/col counts or labels can change without the cell count matching the previous “expected” size in edge cases — track structure explicitly. */
let lastMatrixStructureKey = "";

function matrixStructureKey(sources: Source[], outputs: Output[]): string {
	return JSON.stringify({
		s: sources.map((x) => [x.id, x.name]),
		o: outputs.map((x) => [x.id, x.name]),
	});
}

// ── DOM Refs ───────────────────────────────────

const statusEl = document.getElementById("connection-status")!;
const atemIpInput = document.getElementById("atem-ip") as HTMLInputElement;
const connectBtn = document.getElementById("connect-btn")!;
const splitStereoCb = document.getElementById("split-stereo-cb") as HTMLInputElement;
const matrixContainer = document.getElementById("matrix-container")!;
const presetNameInput = document.getElementById("preset-name") as HTMLInputElement;
const savePresetBtn = document.getElementById("save-preset-btn")!;
const presetList = document.getElementById("preset-list")!;
const toastEl = document.getElementById("toast")!;
const buildFooterEl = document.getElementById("app-build-footer")!;

// ── Toast ──────────────────────────────────────

let toastTimeout: ReturnType<typeof setTimeout> | null = null;

function showToast(message: string, type = "success") {
	toastEl.textContent = message;
	toastEl.className = "toast " + type;
	if (toastTimeout) clearTimeout(toastTimeout);
	toastTimeout = setTimeout(() => {
		toastEl.className = "toast hidden";
	}, 3000);
}

// ── Status ─────────────────────────────────────

function updateStatus() {
	if (atemConnected) {
		statusEl.textContent = "Connected";
		statusEl.className = "status connected";
	} else if (atemIpInput.value) {
		statusEl.textContent = "Disconnected";
		statusEl.className = "status disconnected";
	} else {
		statusEl.textContent = "No ATEM";
		statusEl.className = "status disconnected";
	}
}

// ── Matrix ─────────────────────────────────────

function buildMatrix() {
	if (sources.length === 0 || outputs.length === 0) {
		matrixContainer.innerHTML =
			'<div id="matrix-placeholder"><p>No audio routing data. Is the ATEM connected?</p></div>';
		return;
	}

	const grid = document.createElement("div");
	grid.id = "matrix";
	grid.style.gridTemplateColumns = `auto repeat(${outputs.length}, 28px)`;

	// Corner cell
	const corner = document.createElement("div");
	corner.className = "matrix-corner";
	corner.textContent = "Src \\ Out";
	grid.appendChild(corner);

	// Column headers
	for (const output of outputs) {
		const colHeader = document.createElement("div");
		colHeader.className = "matrix-col-header";
		colHeader.textContent = output.name;
		colHeader.dataset.outputId = String(output.id);
		grid.appendChild(colHeader);
	}

	// Rows
	for (const source of sources) {
		const rowHeader = document.createElement("div");
		rowHeader.className = "matrix-row-header";
		rowHeader.textContent = source.name;
		rowHeader.dataset.sourceId = String(source.id);
		rowHeader.title =
			`Routing source id: ${source.id}\n` +
			`Input index: ${source.audioSourceId} · channel pair: ${source.audioChannelPair}`;
		grid.appendChild(rowHeader);

		for (const output of outputs) {
			const cell = document.createElement("div");
			cell.className = "matrix-cell";
			cell.dataset.outputId = String(output.id);
			cell.dataset.sourceId = String(source.id);

			if (output.sourceId === source.id) {
				cell.classList.add("active");
			}

			cell.addEventListener("click", () => {
				electrobun.rpc!.request.setRoute({
					outputId: output.id,
					sourceId: source.id,
				});
			});

			cell.addEventListener("mouseenter", () => {
				highlightRowCol(source.id, output.id, true);
			});
			cell.addEventListener("mouseleave", () => {
				highlightRowCol(source.id, output.id, false);
			});

			grid.appendChild(cell);
		}
	}

	matrixContainer.innerHTML = "";
	matrixContainer.appendChild(grid);
}

function highlightRowCol(sourceId: number, outputId: number, active: boolean) {
	document.querySelectorAll(`.matrix-cell[data-source-id="${sourceId}"]`).forEach((el) => {
		el.classList.toggle("highlight-row", active);
	});
	document.querySelectorAll(`.matrix-cell[data-output-id="${outputId}"]`).forEach((el) => {
		el.classList.toggle("highlight-col", active);
	});
	document.querySelectorAll(`.matrix-row-header[data-source-id="${sourceId}"]`).forEach((el) => {
		el.classList.toggle("highlight", active);
	});
	document.querySelectorAll(`.matrix-col-header[data-output-id="${outputId}"]`).forEach((el) => {
		el.classList.toggle("highlight", active);
	});
}

function updateMatrixActiveStates() {
	const cells = document.querySelectorAll(".matrix-cell");
	for (const cell of cells) {
		const el = cell as HTMLElement;
		const outputId = Number(el.dataset.outputId);
		const sourceId = Number(el.dataset.sourceId);
		const output = outputs.find((o) => o.id === outputId);
		const isActive = output && output.sourceId === sourceId;
		cell.classList.toggle("active", !!isActive);
	}
}

// ── Presets ────────────────────────────────────

function buildPresetList() {
	presetList.innerHTML = "";
	for (const preset of presets) {
		const li = document.createElement("li");
		li.className = "preset-item";
		li.innerHTML = `
			<span class="preset-item-name" title="${preset.name}">${preset.name}</span>
			<div class="preset-item-actions">
				<button class="btn-recall" data-preset="${preset.name}">Recall</button>
				<button class="btn-delete" data-preset="${preset.name}">Del</button>
			</div>
		`;

		li.querySelector(".btn-recall")!.addEventListener("click", () => {
			electrobun.rpc!.request.recallPreset({ name: preset.name });
			showToast(`Recalling "${preset.name}"...`);
		});

		li.querySelector(".btn-delete")!.addEventListener("click", () => {
			if (confirm(`Delete preset "${preset.name}"?`)) {
				electrobun.rpc!.request.deletePreset({ name: preset.name });
			}
		});

		presetList.appendChild(li);
	}
}

// ── State Handler ──────────────────────────────

function handleFullState(state: FullState) {
	atemConnected = state.connected;
	sources = state.sources || [];
	outputs = state.outputs || [];
	presets = state.presets || [];

	if (state.atemIp) {
		atemIpInput.value = state.atemIp;
	}

	updateStatus();

	const key = matrixStructureKey(sources, outputs);
	if (key !== lastMatrixStructureKey) {
		lastMatrixStructureKey = key;
		buildMatrix();
	} else {
		updateMatrixActiveStates();
	}

	buildPresetList();
}

// ── UI Event Handlers ──────────────────────────

connectBtn.addEventListener("click", async () => {
	const ip = atemIpInput.value.trim();
	if (!ip) {
		showToast("Enter an ATEM IP address", "error");
		return;
	}
	statusEl.textContent = "Connecting...";
	statusEl.className = "status connecting";
	debugLog(`Connect clicked, ip: ${ip}`);
	try {
		const result = await electrobun.rpc!.request.connectAtem({ ip });
		debugLog(`connectAtem result: ${JSON.stringify(result)}`);
	} catch (err) {
		debugLog(`connectAtem RPC error: ${err}`);
		showToast(`RPC error: ${err}`, "error");
	}
});

atemIpInput.addEventListener("keydown", (e) => {
	if (e.key === "Enter") connectBtn.click();
});

savePresetBtn.addEventListener("click", () => {
	const name = presetNameInput.value.trim();
	if (!name) {
		showToast("Enter a preset name", "error");
		return;
	}
	electrobun.rpc!.request.savePreset({ name });
	presetNameInput.value = "";
	showToast(`Saved preset "${name}"`);
});

presetNameInput.addEventListener("keydown", (e) => {
	if (e.key === "Enter") savePresetBtn.click();
});

splitStereoCb.addEventListener("change", () => {
	electrobun.rpc!.request.setSplitStereo({ enabled: splitStereoCb.checked });
});

function formatBuildFooter(b: BuildInfo): string {
	const parts = [`v${b.version}`, `Build ${b.buildId}`];
	if (b.builtAt) {
		try {
			const d = new Date(b.builtAt);
			parts.push(d.toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" }));
		} catch {
			parts.push(b.builtAt);
		}
	}
	return parts.join(" · ");
}

async function loadBuildFooter() {
	try {
		const b = await electrobun.rpc!.request.getBuildInfo({});
		buildFooterEl.textContent = formatBuildFooter(b);
	} catch {
		buildFooterEl.textContent = "Build: unavailable";
	}
}

// ── Initial Load ───────────────────────────────

async function init() {
	await loadBuildFooter();
	const state = await electrobun.rpc!.request.getFullState({});
	handleFullState(state);
}

init();
