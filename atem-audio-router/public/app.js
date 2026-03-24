// ATEM Audio Router - Web Matrix UI

const socket = io()

// State
let sources = []
let outputs = []
let presets = []
let atemConnected = false

// DOM refs
const statusEl = document.getElementById('connection-status')
const atemIpInput = document.getElementById('atem-ip')
const connectBtn = document.getElementById('connect-btn')
const matrixContainer = document.getElementById('matrix-container')
const presetNameInput = document.getElementById('preset-name')
const savePresetBtn = document.getElementById('save-preset-btn')
const presetList = document.getElementById('preset-list')
const toastEl = document.getElementById('toast')

// Internal port type labels
const INTERNAL_PORT_LABELS = {
	0: 'External',
	1: 'Not Connected',
	2: 'Talkback Mix',
	3: 'TS Jack',
	5: 'Media Player',
	6: 'Program',
	7: 'Return',
	8: 'Monitor',
	9: 'MADI',
	10: 'Aux Out',
}

// External port type labels (bitmask)
const EXTERNAL_PORT_LABELS = {
	1: 'SDI',
	2: 'HDMI',
	4: 'Component',
	8: 'Composite',
	16: 'SVideo',
	32: 'XLR',
	64: 'AES/EBU',
	128: 'RCA',
	256: 'DPort',
	512: 'TS Jack',
	1024: 'MADI',
	2048: 'TRS Jack',
}

// Channel pair labels
const CHANNEL_PAIR_LABELS = {
	0: 'Ch 1/2',
	1: 'Ch 3/4',
	2: 'Ch 5/6',
	3: 'Ch 7/8',
	4: 'Ch 9/10',
	5: 'Ch 11/12',
	6: 'Ch 13/14',
	7: 'Ch 15/16',
}

function getPortTypeLabel(item) {
	if (item.internalPortType && item.internalPortType > 0) {
		return INTERNAL_PORT_LABELS[item.internalPortType] || 'Internal'
	}
	// Check external port type flags
	for (const [flag, label] of Object.entries(EXTERNAL_PORT_LABELS)) {
		if (item.externalPortType & Number(flag)) {
			return label
		}
	}
	return 'Other'
}

function getGroupKey(item) {
	return getPortTypeLabel(item)
}

function groupItems(items) {
	const groups = {}
	for (const item of items) {
		const key = getGroupKey(item)
		if (!groups[key]) groups[key] = []
		groups[key].push(item)
	}
	return groups
}

// Toast notification
let toastTimeout = null
function showToast(message, type = 'success') {
	toastEl.textContent = message
	toastEl.className = 'toast ' + type
	if (toastTimeout) clearTimeout(toastTimeout)
	toastTimeout = setTimeout(() => {
		toastEl.className = 'toast hidden'
	}, 3000)
}

// Update connection status display
function updateStatus() {
	if (atemConnected) {
		statusEl.textContent = 'Connected'
		statusEl.className = 'status connected'
	} else if (atemIpInput.value) {
		statusEl.textContent = 'Disconnected'
		statusEl.className = 'status disconnected'
	} else {
		statusEl.textContent = 'No ATEM'
		statusEl.className = 'status disconnected'
	}
}

// Build the crosspoint matrix
function buildMatrix() {
	if (sources.length === 0 || outputs.length === 0) {
		matrixContainer.innerHTML = '<div id="matrix-placeholder"><p>No audio routing data. Is the ATEM connected?</p></div>'
		return
	}

	const sourceGroups = groupItems(sources)
	const outputGroups = groupItems(outputs)

	// Flatten into ordered arrays
	const orderedSources = []
	const sourceGroupNames = []
	for (const [groupName, items] of Object.entries(sourceGroups)) {
		sourceGroupNames.push({ name: groupName, count: items.length })
		orderedSources.push(...items)
	}

	const orderedOutputs = []
	const outputGroupNames = []
	for (const [groupName, items] of Object.entries(outputGroups)) {
		outputGroupNames.push({ name: groupName, count: items.length })
		orderedOutputs.push(...items)
	}

	const totalCols = orderedOutputs.length + 1 // +1 for row headers
	const grid = document.createElement('div')
	grid.id = 'matrix'
	grid.style.gridTemplateColumns = `auto repeat(${orderedOutputs.length}, 28px)`

	// Corner cell
	const corner = document.createElement('div')
	corner.className = 'matrix-corner'
	corner.textContent = 'Src \\ Out'
	grid.appendChild(corner)

	// Column headers
	for (const output of orderedOutputs) {
		const colHeader = document.createElement('div')
		colHeader.className = 'matrix-col-header'
		colHeader.textContent = output.name
		colHeader.dataset.outputId = output.id
		grid.appendChild(colHeader)
	}

	// Rows (sources) with crosspoints
	for (const source of orderedSources) {
		// Row header
		const rowHeader = document.createElement('div')
		rowHeader.className = 'matrix-row-header'
		rowHeader.textContent = source.name
		rowHeader.dataset.sourceId = source.id
		grid.appendChild(rowHeader)

		// Crosspoint cells
		for (const output of orderedOutputs) {
			const cell = document.createElement('div')
			cell.className = 'matrix-cell'
			cell.dataset.outputId = output.id
			cell.dataset.sourceId = source.id

			if (output.sourceId === source.id) {
				cell.classList.add('active')
			}

			cell.addEventListener('click', () => {
				socket.emit('setRoute', {
					outputId: output.id,
					sourceId: source.id,
				})
			})

			// Hover highlighting
			cell.addEventListener('mouseenter', () => {
				highlightRowCol(source.id, output.id, true)
			})
			cell.addEventListener('mouseleave', () => {
				highlightRowCol(source.id, output.id, false)
			})

			grid.appendChild(cell)
		}
	}

	matrixContainer.innerHTML = ''
	matrixContainer.appendChild(grid)
}

function highlightRowCol(sourceId, outputId, active) {
	// Highlight all cells in the same row
	document.querySelectorAll(`.matrix-cell[data-source-id="${sourceId}"]`).forEach((el) => {
		el.classList.toggle('highlight-row', active)
	})
	// Highlight all cells in the same column
	document.querySelectorAll(`.matrix-cell[data-output-id="${outputId}"]`).forEach((el) => {
		el.classList.toggle('highlight-col', active)
	})
	// Highlight row header
	document.querySelectorAll(`.matrix-row-header[data-source-id="${sourceId}"]`).forEach((el) => {
		el.classList.toggle('highlight', active)
	})
	// Highlight column header
	document.querySelectorAll(`.matrix-col-header[data-output-id="${outputId}"]`).forEach((el) => {
		el.classList.toggle('highlight', active)
	})
}

// Update just the active states without rebuilding the whole matrix
function updateMatrixActiveStates() {
	const cells = document.querySelectorAll('.matrix-cell')
	for (const cell of cells) {
		const outputId = Number(cell.dataset.outputId)
		const sourceId = Number(cell.dataset.sourceId)
		const output = outputs.find((o) => o.id === outputId)
		const isActive = output && output.sourceId === sourceId
		cell.classList.toggle('active', isActive)
	}
}

// Build preset list
function buildPresetList() {
	presetList.innerHTML = ''
	for (const preset of presets) {
		const li = document.createElement('li')
		li.className = 'preset-item'
		li.innerHTML = `
			<span class="preset-item-name" title="${preset.name}">${preset.name}</span>
			<div class="preset-item-actions">
				<button class="btn-recall" data-preset="${preset.name}">Recall</button>
				<button class="btn-delete" data-preset="${preset.name}">Del</button>
			</div>
		`

		li.querySelector('.btn-recall').addEventListener('click', () => {
			socket.emit('recallPreset', { name: preset.name })
			showToast(`Recalling "${preset.name}"...`)
		})

		li.querySelector('.btn-delete').addEventListener('click', () => {
			if (confirm(`Delete preset "${preset.name}"?`)) {
				socket.emit('deletePreset', { name: preset.name })
			}
		})

		presetList.appendChild(li)
	}
}

// Socket.IO event handlers

socket.on('fullState', (state) => {
	atemConnected = state.connected
	sources = state.sources || []
	outputs = state.outputs || []
	presets = state.presets || []

	if (state.atemIp) {
		atemIpInput.value = state.atemIp
	}

	updateStatus()

	// Only rebuild matrix if source/output count changed, otherwise just update active states
	const existingCells = document.querySelectorAll('.matrix-cell')
	const expectedCells = sources.length * outputs.length
	if (existingCells.length !== expectedCells) {
		buildMatrix()
	} else {
		updateMatrixActiveStates()
	}

	buildPresetList()
})

socket.on('atemConnected', () => {
	atemConnected = true
	updateStatus()
	showToast('Connected to ATEM')
})

socket.on('atemDisconnected', () => {
	atemConnected = false
	updateStatus()
	showToast('Disconnected from ATEM', 'error')
})

socket.on('presetsChanged', (data) => {
	presets = data.presets || []
	buildPresetList()
})

socket.on('error', (data) => {
	showToast(data.message || 'An error occurred', 'error')
})

// UI event handlers

connectBtn.addEventListener('click', () => {
	const ip = atemIpInput.value.trim()
	if (!ip) {
		showToast('Enter an ATEM IP address', 'error')
		return
	}
	statusEl.textContent = 'Connecting...'
	statusEl.className = 'status connecting'
	socket.emit('connectAtem', { ip })
})

atemIpInput.addEventListener('keydown', (e) => {
	if (e.key === 'Enter') connectBtn.click()
})

savePresetBtn.addEventListener('click', () => {
	const name = presetNameInput.value.trim()
	if (!name) {
		showToast('Enter a preset name', 'error')
		return
	}
	socket.emit('savePreset', { name })
	presetNameInput.value = ''
	showToast(`Saved preset "${name}"`)
})

presetNameInput.addEventListener('keydown', (e) => {
	if (e.key === 'Enter') savePresetBtn.click()
})
