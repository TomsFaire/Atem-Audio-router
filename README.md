# ATEM Audio Router

Real-time audio routing matrix for Blackmagic ATEM Constellation switchers. Monitor and change Fairlight audio routes through a web-based crosspoint UI, and trigger route changes or preset recalls from Bitfocus Companion buttons.

## Requirements

- **ATEM Constellation** series switcher (HD, 4K, or 8K) with **firmware 9.4+**
- **Node.js** 18+
- **Bitfocus Companion** (optional, for button control)

## Architecture

```
[ATEM Switcher] <--UDP 9910--> [atem-audio-router server]
                                     |
                              Express + Socket.IO
                                     |
                          +----------+----------+
                          |                     |
                     [Browser]           [Companion module]
                     Matrix UI           Preset recall +
                                         route buttons
```

A standalone Node.js server connects to your ATEM and exposes a Socket.IO API. The web UI and Companion module are both thin clients that connect to this server.

## Quick Start

### 1. Install and run the server

```bash
cd atem-audio-router
npm install
npm start                    # start without connecting to an ATEM
npm start 10.0.0.100        # connect to an ATEM at startup
npm start 10.0.0.100 --split-stereo   # connect and split all stereo inputs to dual mono
```

The server runs on **port 4000** by default. Set the `PORT` environment variable to change it, or pass the ATEM IP via `ATEM_IP`:

```bash
PORT=8080 ATEM_IP=10.0.0.100 SPLIT_STEREO=true npm start
```

### Split Stereo Mode

Use the `--split-stereo` flag (or `SPLIT_STEREO=true` env var) to automatically split all stereo audio inputs into dual mono channels on connect. This sets every Fairlight input that supports it to `DualMono` configuration, giving you individual control over each channel in the routing matrix. Inputs that don't support dual mono are left unchanged.

### 2. Open the web UI

Navigate to `http://localhost:4000` in your browser.

- Enter your ATEM's IP address in the top-right field and click **Connect**
- The crosspoint matrix will populate with all available audio sources (rows) and outputs (columns)
- Click any crosspoint cell to route that source to that output
- Active routes are shown as green dots

### 3. Save and recall presets

Use the **Presets** panel on the right side of the web UI:

- Type a name and click **Save** to snapshot the current routing state
- Click **Recall** on any saved preset to restore that routing configuration
- Only routes that differ from the current state are changed on recall

## Companion Module Setup

The Companion module lets you trigger route changes and preset recalls from physical buttons.

### Install

1. Open Bitfocus Companion
2. Go to **Connections** and click **Add**
3. Search for a way to add a local/dev module, or copy the `companion-module-atem-audiorouter/` folder into your Companion modules directory:
   - macOS: `~/Library/Application Support/Bitfocus Buttons/modules/`
4. Run `npm install` inside the module directory
5. Add a new connection for **ATEM Audio Router** and configure the server IP and port (default `127.0.0.1:4000`)

### Available Actions

| Action | Description |
|--------|-------------|
| **Set Audio Route** | Route a specific source to a specific output |
| **Recall Preset** | Recall a saved routing preset by name |
| **Save Preset** | Save the current routing state as a named preset |

### Available Feedbacks

| Feedback | Description |
|----------|-------------|
| **Route Active** | Boolean — lights up when a specific output is routed to a specific source |
| **Preset Active** | Boolean — lights up when current routing matches a saved preset |

### Available Variables

| Variable | Description |
|----------|-------------|
| `connection_status` | Connected / Disconnected |
| `atem_connected` | True / False |
| `source_count` | Number of audio sources |
| `output_count` | Number of audio outputs |
| `output_<id>_source` | Current source name routed to each output |

## How It Works

The server uses the [`atem-connection`](https://www.npmjs.com/package/atem-connection) library to communicate with ATEM switchers over UDP port 9910. It reads the Fairlight audio routing state (`state.fairlight.audioRouting`) and listens for `stateChanged` events to keep all clients in sync.

Audio routing on ATEM Constellation uses 32-bit composite IDs that encode both the source/output ID and channel pair. The server handles all of this internally — you just see human-readable names in the UI.

Presets are stored as JSON files in the `atem-audio-router/presets/` directory.

## Supported Source Types

- SDI video inputs (embedded audio)
- XLR, RCA, TRS, TS microphone inputs
- MADI inputs
- Media players
- Talkback sources
- Mix minus
- Program / Monitor / Return feeds

## Supported Output Types

- SDI outputs (up to 16 channels / 8 stereo pairs each)
- MADI outputs
- Aux outputs
- Multiviewer
- Program output

## License

MIT
