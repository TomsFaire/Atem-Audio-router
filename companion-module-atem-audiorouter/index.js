// atem-audiorouter - Companion module for ATEM Audio Router

const { InstanceBase, InstanceStatus, runEntrypoint } = require('@companion-module/base')
const UpgradeScripts = require('./src/upgrades')

const config = require('./src/config')
const actions = require('./src/actions')
const feedbacks = require('./src/feedbacks')
const variables = require('./src/variables')
const presets = require('./src/presets')

const io = require('socket.io-client')

class AtemAudioRouterModule extends InstanceBase {
	constructor(internal) {
		super(internal)

		Object.assign(this, {
			...config,
			...actions,
			...feedbacks,
			...variables,
			...presets,
		})

		this.socket = null

		this.STATE = {
			connected: false,
			sources: [],
			outputs: [],
			presets: [],
		}
	}

	async destroy() {
		if (this.socket) {
			this.socket.disconnect()
			this.socket = null
		}
	}

	async init(config) {
		this.updateStatus(InstanceStatus.Connecting)
		this.configUpdated(config)
	}

	async configUpdated(config) {
		this.config = config

		if (this.config.verbose) {
			this.log('info', 'Verbose mode enabled.')
		}

		this.updateStatus(InstanceStatus.Connecting)

		this.initConnection()
		this.initActions()
		this.initFeedbacks()
		this.initVariables()
		this.initPresets()
		this.checkVariables()
	}

	initConnection() {
		let self = this

		// Disconnect existing socket
		if (this.socket) {
			this.socket.disconnect()
			this.socket = null
		}

		if (!this.config.host) {
			this.updateStatus(InstanceStatus.BadConfig, 'No server IP configured')
			return
		}

		const url = `http://${this.config.host}:${this.config.port || 4000}`
		this.log('info', `Connecting to ATEM Audio Router server at ${url}`)

		this.socket = io.connect(url, { reconnection: true })

		this.socket.on('connect', function () {
			self.log('info', 'Connected to ATEM Audio Router server')
			self.updateStatus(InstanceStatus.Ok)
		})

		this.socket.on('disconnect', function () {
			self.updateStatus(InstanceStatus.ConnectionFailure)
			self.log('error', 'Disconnected from ATEM Audio Router server')
		})

		this.socket.on('fullState', function (state) {
			if (self.config.verbose) {
				self.log('info', `Received full state: ${state.sources.length} sources, ${state.outputs.length} outputs`)
			}

			self.STATE.connected = state.connected
			self.STATE.sources = state.sources || []
			self.STATE.outputs = state.outputs || []
			self.STATE.presets = state.presets || []

			// Rebuild definitions when sources/outputs change
			self.initActions()
			self.initFeedbacks()
			self.initVariables()
			self.initPresets()
			self.checkVariables()
			self.checkFeedbacks()
		})

		this.socket.on('atemConnected', function () {
			self.STATE.connected = true
			self.checkVariables()
			if (self.config.verbose) {
				self.log('info', 'ATEM connected')
			}
		})

		this.socket.on('atemDisconnected', function () {
			self.STATE.connected = false
			self.checkVariables()
			if (self.config.verbose) {
				self.log('info', 'ATEM disconnected')
			}
		})

		this.socket.on('presetsChanged', function (data) {
			self.STATE.presets = data.presets || []
			self.initActions()
			self.initPresets()
		})

		this.socket.on('error', function (error) {
			self.log('error', 'Error: ' + (error.message || JSON.stringify(error)))
		})
	}

	sendCommand(cmd, data) {
		if (this.socket) {
			if (this.config.verbose) {
				this.log('info', `Sending: ${cmd} ${JSON.stringify(data)}`)
			}
			this.socket.emit(cmd, data)
		} else {
			this.log('warn', 'Cannot send: not connected to server')
		}
	}
}

runEntrypoint(AtemAudioRouterModule, UpgradeScripts)
