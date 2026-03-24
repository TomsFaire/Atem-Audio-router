const express = require('express')
const http = require('http')
const { Server } = require('socket.io')
const path = require('path')
const { AtemAudioRouterCore } = require('./core')

// Parse CLI args
const args = process.argv.slice(2)
const atemIp = args.find((a) => !a.startsWith('--')) || process.env.ATEM_IP || null
const port = parseInt(process.env.PORT || '4000', 10)
const splitStereo = args.includes('--split-stereo') || process.env.SPLIT_STEREO === 'true'

// Create core
const core = new AtemAudioRouterCore({
	atemIp,
	presetsDir: path.join(__dirname, '..', 'presets'),
	splitStereo,
})

// Create Express + Socket.IO server
const app = express()
const server = http.createServer(app)
const io = new Server(server, {
	cors: { origin: '*' },
})

// Serve static web UI
app.use(express.static(path.join(__dirname, '..', 'public')))

// Socket.IO connection handling
io.on('connection', (socket) => {
	console.log(`[Server] Client connected: ${socket.id}`)

	// Send current full state on connect
	socket.emit('fullState', core.getFullState())

	// Handle route changes
	socket.on('setRoute', async ({ outputId, sourceId }) => {
		try {
			await core.setRoute(outputId, sourceId)
		} catch (err) {
			socket.emit('error', { message: err.message })
		}
	})

	// Handle preset operations
	socket.on('savePreset', ({ name }) => {
		try {
			core.savePreset(name)
		} catch (err) {
			socket.emit('error', { message: err.message })
		}
	})

	socket.on('recallPreset', async ({ name }) => {
		try {
			await core.recallPreset(name)
		} catch (err) {
			socket.emit('error', { message: err.message })
		}
	})

	socket.on('deletePreset', ({ name }) => {
		try {
			core.deletePreset(name)
		} catch (err) {
			socket.emit('error', { message: err.message })
		}
	})

	// Handle ATEM connection changes from web UI
	socket.on('connectAtem', ({ ip }) => {
		console.log(`[Server] Client requested ATEM connection to ${ip}`)
		core.connect(ip)
	})

	socket.on('disconnect', () => {
		console.log(`[Server] Client disconnected: ${socket.id}`)
	})
})

// Bridge core events to all Socket.IO clients
core.on('connected', () => {
	io.emit('atemConnected', {})
	io.emit('fullState', core.getFullState())
})

core.on('disconnected', () => {
	io.emit('atemDisconnected', {})
})

core.on('stateUpdate', (state) => {
	io.emit('fullState', state)
})

core.on('presetsChanged', (data) => {
	io.emit('presetsChanged', data)
})

// Start server
server.listen(port, () => {
	console.log(`[Server] ATEM Audio Router running on http://localhost:${port}`)
	if (splitStereo) {
		console.log(`[Server] Split stereo mode enabled — all stereo inputs will be set to dual mono on connect`)
	}
	if (atemIp) {
		console.log(`[Server] Connecting to ATEM at ${atemIp}`)
	} else {
		console.log(`[Server] No ATEM IP specified. Use the web UI to connect, or restart with: node src/server.js <ATEM_IP>`)
	}
})
