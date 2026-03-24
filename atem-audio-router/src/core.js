const { Atem } = require('atem-connection')
const EventEmitter = require('events')
const fs = require('fs')
const path = require('path')

class AtemAudioRouterCore extends EventEmitter {
	constructor({ atemIp, presetsDir }) {
		super()

		this.atemIp = atemIp || null
		this.presetsDir = presetsDir || path.join(__dirname, '..', 'presets')
		this.atem = null
		this.connected = false

		// Cached state
		this.sources = {}
		this.outputs = {}

		// Ensure presets directory exists
		if (!fs.existsSync(this.presetsDir)) {
			fs.mkdirSync(this.presetsDir, { recursive: true })
		}

		if (this.atemIp) {
			this.connect(this.atemIp)
		}
	}

	connect(ip) {
		if (this.atem) {
			this.atem.destroy()
		}

		this.atemIp = ip
		this.connected = false
		this.sources = {}
		this.outputs = {}

		this.atem = new Atem()

		this.atem.on('connected', () => {
			console.log(`[Core] Connected to ATEM at ${ip}`)
			this.connected = true

			// Read initial audio routing state
			this._readFullRoutingState()

			this.emit('connected')
			this.emit('stateUpdate', this.getFullState())
		})

		this.atem.on('disconnected', () => {
			console.log(`[Core] Disconnected from ATEM`)
			this.connected = false
			this.emit('disconnected')
		})

		this.atem.on('stateChanged', (state, pathsChanged) => {
			let routingChanged = false

			for (const p of pathsChanged) {
				if (p.startsWith('fairlight.audioRouting')) {
					routingChanged = true
					break
				}
			}

			if (routingChanged) {
				this._readFullRoutingState()
				this.emit('stateUpdate', this.getFullState())
			}
		})

		this.atem.on('error', (err) => {
			console.error(`[Core] ATEM error:`, err.message)
		})

		console.log(`[Core] Connecting to ATEM at ${ip}...`)
		this.atem.connect(ip)
	}

	disconnect() {
		if (this.atem) {
			this.atem.destroy()
			this.atem = null
		}
		this.connected = false
		this.sources = {}
		this.outputs = {}
		this.emit('disconnected')
	}

	_readFullRoutingState() {
		if (!this.atem || !this.atem.state) return

		const fairlight = this.atem.state.fairlight
		if (!fairlight || !fairlight.audioRouting) {
			console.log('[Core] No audio routing data available (firmware 9.4+ required)')
			return
		}

		const routing = fairlight.audioRouting

		// Cache sources
		this.sources = {}
		if (routing.sources) {
			for (const [id, source] of Object.entries(routing.sources)) {
				this.sources[id] = {
					id: Number(id),
					audioSourceId: source.audioSourceId,
					audioChannelPair: source.audioChannelPair,
					externalPortType: source.externalPortType,
					internalPortType: source.internalPortType,
					name: source.name || `Source ${id}`,
				}
			}
		}

		// Cache outputs
		this.outputs = {}
		if (routing.outputs) {
			for (const [id, output] of Object.entries(routing.outputs)) {
				this.outputs[id] = {
					id: Number(id),
					audioOutputId: output.audioOutputId,
					audioChannelPair: output.audioChannelPair,
					externalPortType: output.externalPortType,
					internalPortType: output.internalPortType,
					sourceId: output.sourceId,
					name: output.name || `Output ${id}`,
				}
			}
		}

		const sourceCount = Object.keys(this.sources).length
		const outputCount = Object.keys(this.outputs).length
		console.log(`[Core] Routing state: ${sourceCount} sources, ${outputCount} outputs`)
	}

	getFullState() {
		return {
			connected: this.connected,
			atemIp: this.atemIp,
			sources: Object.values(this.sources),
			outputs: Object.values(this.outputs),
			presets: this.listPresets(),
		}
	}

	async setRoute(outputId, sourceId) {
		if (!this.atem || !this.connected) {
			throw new Error('Not connected to ATEM')
		}

		console.log(`[Core] Setting route: output ${outputId} -> source ${sourceId}`)
		await this.atem.setFairlightAudioRoutingOutputProperties(Number(outputId), {
			sourceId: Number(sourceId),
		})
	}

	// Preset management

	listPresets() {
		try {
			const files = fs.readdirSync(this.presetsDir)
			return files
				.filter((f) => f.endsWith('.json'))
				.map((f) => {
					const data = JSON.parse(fs.readFileSync(path.join(this.presetsDir, f), 'utf-8'))
					return { name: data.name, filename: f, created: data.created }
				})
		} catch {
			return []
		}
	}

	savePreset(name) {
		if (!name || typeof name !== 'string') {
			throw new Error('Preset name is required')
		}

		// Build routes snapshot from current output state
		const routes = {}
		for (const [id, output] of Object.entries(this.outputs)) {
			routes[id] = output.sourceId
		}

		const preset = {
			name,
			created: new Date().toISOString(),
			routes,
		}

		const filename = name.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase() + '.json'
		const filepath = path.join(this.presetsDir, filename)
		fs.writeFileSync(filepath, JSON.stringify(preset, null, 2))

		console.log(`[Core] Saved preset "${name}" (${Object.keys(routes).length} routes)`)
		this.emit('presetsChanged', { presets: this.listPresets() })
		return preset
	}

	async recallPreset(name) {
		if (!this.atem || !this.connected) {
			throw new Error('Not connected to ATEM')
		}

		const presets = this.listPresets()
		const presetInfo = presets.find((p) => p.name === name)
		if (!presetInfo) {
			throw new Error(`Preset "${name}" not found`)
		}

		const filepath = path.join(this.presetsDir, presetInfo.filename)
		const preset = JSON.parse(fs.readFileSync(filepath, 'utf-8'))

		console.log(`[Core] Recalling preset "${name}"...`)

		// Apply only routes that differ from current state
		let changed = 0
		for (const [outputId, sourceId] of Object.entries(preset.routes)) {
			const current = this.outputs[outputId]
			if (!current || current.sourceId !== sourceId) {
				await this.atem.setFairlightAudioRoutingOutputProperties(Number(outputId), {
					sourceId: Number(sourceId),
				})
				changed++
			}
		}

		console.log(`[Core] Preset "${name}" applied (${changed} routes changed)`)
	}

	deletePreset(name) {
		const presets = this.listPresets()
		const presetInfo = presets.find((p) => p.name === name)
		if (!presetInfo) {
			throw new Error(`Preset "${name}" not found`)
		}

		const filepath = path.join(this.presetsDir, presetInfo.filename)
		fs.unlinkSync(filepath)

		console.log(`[Core] Deleted preset "${name}"`)
		this.emit('presetsChanged', { presets: this.listPresets() })
	}

	destroy() {
		if (this.atem) {
			this.atem.destroy()
			this.atem = null
		}
		this.connected = false
		this.removeAllListeners()
	}
}

module.exports = { AtemAudioRouterCore }
