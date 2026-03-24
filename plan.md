# ATEM Audio Router — Implementation Plan

## Context

ATEM Constellation switchers support split audio routing (mapping any audio source to any output channel), but managing this is painful: audioatem.com requires manual XML uploads, and the existing Companion ATEM module requires a separate button for every single route. We need a real-time visual matrix UI for monitoring/routing + Companion buttons for preset recall and quick route changes during live events.

## Architecture

Standalone Node.js server + thin Companion module (same pattern as the existing Spotify controller).

```
[ATEM Constellation] <--UDP 9910--> [atem-audio-router server]
                                         |
                                    Core class (atem-connection)
                                    Express (static web UI)
                                    Socket.IO server
                                         |
                              +----------+----------+
                              |                     |
                         [Browser]           [Companion module]
                         Crosspoint          Socket.IO client
                         matrix UI           (presets + routes)
```

**Single ATEM connection** lives in the server's Core class. Both the web UI (browser) and Companion module are Socket.IO clients receiving the same state updates.

## Key API Reference

From `atem-connection` (installed at `~/Library/Application Support/Bitfocus Buttons/modules/bmd-atem_3.16.1/node_modules/atem-connection/`):

- **State path:** `state.fairlight.audioRouting.sources` / `.outputs`
- **Source interface:** `{ audioSourceId, audioChannelPair, externalPortType, internalPortType, name }`
- **Output interface:** `{ audioOutputId, audioChannelPair, externalPortType, internalPortType, sourceId, name }`
- **Route command:** `atem.setFairlightAudioRoutingOutputProperties(outputId, { sourceId })`
- **State events:** `stateChanged` with path strings like `fairlight.audioRouting.outputs.327680`
- **ID encoding:** 32-bit composite `(audioSourceId << 16) | audioChannelPair`
- **Requires:** Firmware 9.4+

## Project Structure

```
atemrouting/
├── plan.md               # This file
├── atem-audio-router/    # Server + Web UI
│   ├── package.json
│   ├── src/
│   │   ├── core.js       # AtemAudioRouterCore (EventEmitter)
│   │   └── server.js     # Express + Socket.IO, creates Core instance
│   ├── public/
│   │   ├── index.html    # Matrix UI shell
│   │   ├── style.css     # CSS Grid crosspoint layout
│   │   └── app.js        # Socket.IO client + matrix rendering
│   └── presets/          # JSON preset files (created at runtime)
│
└── companion-module-atem-audiorouter/
    ├── companion/
    │   └── manifest.json
    ├── package.json
    ├── index.js           # InstanceBase subclass
    └── src/
        ├── config.js      # Server host + port
        ├── actions.js     # setRoute, recallPreset, savePreset
        ├── feedbacks.js   # routeActive, presetActive
        ├── variables.js   # output_<id>_source variables
        ├── presets.js     # Pre-built button definitions
        └── upgrades.js    # Empty upgrade array
```

## Phase 1: Core + Server

### 1.1 — Core class (`src/core.js`)

`AtemAudioRouterCore` extends `EventEmitter`:
- Constructor takes `{ atemIp, presetsDir }`, creates `Atem` instance
- On connect: reads `state.fairlight.audioRouting`, caches `sources` and `outputs` maps
- Listens for `stateChanged`, filters `fairlight.audioRouting.*` paths, updates cache, emits `routeChanged` events
- Methods:
  - `connect(ip)` / `disconnect()`
  - `getFullState()` → `{ sources, outputs, presets }` (sources/outputs as arrays with human-readable names)
  - `setRoute(outputId, sourceId)` → calls `atem.setFairlightAudioRoutingOutputProperties()`
  - `savePreset(name)` → snapshots all `{ [outputId]: sourceId }` to JSON file
  - `recallPreset(name)` → reads preset, applies each route that differs from current state
  - `deletePreset(name)`
  - `listPresets()` → returns preset names
- Events emitted: `connected`, `disconnected`, `stateUpdate` (full state), `routeChanged` (delta), `presetsChanged`

### 1.2 — Server (`src/server.js`)

- Creates `AtemAudioRouterCore` instance
- Express serves `public/` as static files
- Socket.IO namespace `/`:
  - On client connect: sends `fullState` event with `core.getFullState()`
  - Bridges core events → Socket.IO broadcasts (`routeChanged`, `presetsChanged`, `connected`, `disconnected`)
  - Listens for client commands: `setRoute`, `savePreset`, `recallPreset`, `deletePreset`
- CLI args or env vars for ATEM IP and server port (default 4000)
- Also accepts ATEM IP changes at runtime via Socket.IO `connectAtem` command (so the web UI can have a connection field)

### 1.3 — `package.json`

Dependencies: `atem-connection`, `express`, `socket.io`

## Phase 2: Web Matrix UI

### 2.1 — Matrix layout (`public/index.html` + `style.css`)

- Top bar: ATEM IP input + connect button, connection status indicator
- Main area: CSS Grid crosspoint matrix
  - Column headers = output names (grouped by type: SDI, MADI, Aux, etc.)
  - Row headers = source names (grouped by type)
  - Each cell = clickable crosspoint button
  - Active route = highlighted (green/bright)
  - Hovering a cell highlights its row + column headers
- Right panel or bottom: preset management (save name input, list of saved presets with recall/delete buttons)

### 2.2 — Client logic (`public/app.js`)

- Socket.IO client connects to server
- On `fullState`: builds the matrix grid dynamically from sources/outputs arrays
- On `routeChanged`: updates just the affected crosspoint cells
- Click handler: emits `setRoute` with `{ outputId, sourceId }`
- Preset panel: emits `savePreset`/`recallPreset`/`deletePreset`
- Auto-reconnect on disconnect with status indicator

## Phase 3: Companion Module

### 3.1 — Module structure

Follow the Spotify controller pattern exactly (reference: `/Users/tom/Documents/Claude/companion-module-techministry-spotifycontroller/companion-module/`):

**`config.js`:** Host IP (default `127.0.0.1`) + port (default `4000`)

**`actions.js`:**
- `setRoute` — dropdowns for output and source (populated from cached state)
- `recallPreset` — dropdown of preset names (refreshed from server)
- `savePreset` — text input for name
- `clearRoute` — set an output to "No Source"

**`feedbacks.js`:**
- `routeActive` (boolean) — is output X routed to source Y? For button highlighting.
- `presetActive` (boolean) — does current routing match saved preset X?

**`variables.js`:**
- Dynamic variables: `output_<name>_source` showing current source name for each output

**`presets.js`:**
- Pre-built button definitions for preset recall slots 1–8

### 3.2 — Connection lifecycle

- `init()`: connect Socket.IO to server, register event handlers
- On `fullState`: cache sources/outputs/presets, rebuild action/feedback dropdowns via `initActions()`/`initFeedbacks()`
- On `routeChanged`: update cache, call `checkFeedbacks()` + `setVariableValues()`
- On `presetsChanged`: update preset list in action dropdowns
- `destroy()`: disconnect Socket.IO
- `configUpdated()`: reconnect to new host/port

## Socket.IO Protocol

### Server → Clients
| Event | Payload | When |
|-------|---------|------|
| `fullState` | `{ sources: [...], outputs: [...], presets: [...], connected: bool }` | On client connect |
| `routeChanged` | `{ outputId, sourceId, outputName, sourceName }` | Route changes |
| `presetsChanged` | `{ presets: [...] }` | Preset saved/deleted |
| `atemConnected` | `{}` | ATEM connection established |
| `atemDisconnected` | `{}` | ATEM connection lost |

### Clients → Server
| Event | Payload | Action |
|-------|---------|--------|
| `setRoute` | `{ outputId, sourceId }` | Change a route |
| `savePreset` | `{ name }` | Save current state |
| `recallPreset` | `{ name }` | Apply preset |
| `deletePreset` | `{ name }` | Delete preset |
| `connectAtem` | `{ ip }` | Connect to ATEM IP |

## Preset Format

```json
{
  "name": "All Hands Default",
  "created": "2026-03-23T10:00:00Z",
  "routes": {
    "327680": 196608,
    "327681": 131073
  }
}
```

Keys = output IDs (32-bit composite), values = source IDs. On recall, only changed routes are sent to minimize commands.

## Verification

1. **Core + Server:** Start server with ATEM IP, verify it connects and logs sources/outputs. Open browser to `http://localhost:4000`, confirm matrix populates.
2. **Web UI routing:** Click a crosspoint in the matrix, verify the route changes on the ATEM (check with ATEM Software Control or audioatem.com).
3. **Presets:** Save a preset from the web UI, change routes, recall the preset, verify all routes restore.
4. **Companion module:** Install module in Companion, configure server IP/port, verify actions appear with correct dropdowns. Press a preset recall button, verify routes change. Configure a `routeActive` feedback, verify button highlights when route matches.
5. **Real-time sync:** Change a route from the ATEM Software Control — verify both the web matrix and companion feedbacks update within ~1 second.

## Reference Files

- Existing companion module pattern: `/Users/tom/Documents/Claude/companion-module-techministry-spotifycontroller/companion-module/`
- atem-connection types: `~/Library/Application Support/Bitfocus Buttons/modules/bmd-atem_3.16.1/node_modules/atem-connection/dist/state/fairlight.d.ts`
- atem-connection Atem class API: `~/Library/Application Support/Bitfocus Buttons/modules/bmd-atem_3.16.1/node_modules/atem-connection/dist/atem.d.ts`
- Existing ATEM module audio routing actions: from `companion-module-bmd-atem` repo `src/actions/fairlightAudio.ts` (lines 1060-1145)
