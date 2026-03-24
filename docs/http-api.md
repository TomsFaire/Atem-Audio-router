# ATEM Audio Router — HTTP API

The app exposes a REST API on port **4000** (configurable via `API_PORT` env var) for external control from Q-SYS, Crestron, AMX, or any system that can make HTTP requests.

## Endpoints

### Get routing state

```
GET /api/state
```

Returns all sources, outputs, presets, and connection status.

### Get app build / version

```
GET /api/build
```

Returns the same version and build id shown in the app’s bottom-left footer (from `package.json` version and git short hash at build time).

**Response:**
```json
{
  "version": "0.0.2",
  "buildId": "6ca0ff2",
  "builtAt": "2026-03-24T12:00:00.000Z"
}
```

**Example `/api/state` response:**
```json
{
  "connected": true,
  "atemIp": "10.0.0.100",
  "sources": [
    { "id": 65536, "name": "Cam 1", "audioSourceId": 1, ... }
  ],
  "outputs": [
    { "id": 131072, "name": "Aux 1 Ch 1-2", "sourceId": 65536, ... }
  ],
  "presets": [
    { "name": "Show A", "filename": "show_a.json", "created": "2026-03-23T..." }
  ]
}
```

### Set a route

```
POST /api/route
Content-Type: application/json

{ "outputId": 131072, "sourceId": 65536 }
```

Routes the given source to the given output. Use the `id` values from `/api/state`.

**Response:**
```json
{ "success": true }
```

### List presets

```
GET /api/presets
```

**Response:**
```json
[
  { "name": "Show A", "filename": "show_a.json", "created": "2026-03-23T..." }
]
```

### Recall a preset

```
POST /api/preset/recall
Content-Type: application/json

{ "name": "Show A" }
```

### Save a preset

```
POST /api/preset/save
Content-Type: application/json

{ "name": "Show A" }
```

### Delete a preset

```
DELETE /api/preset/Show%20A
```

### Connect to ATEM

```
POST /api/connect
Content-Type: application/json

{ "ip": "10.0.0.100" }
```

## Error responses

All errors return:
```json
{ "success": false, "error": "description of the problem" }
```

---

## Q-SYS Integration

### Prerequisites

- ATEM Audio Router running on the network (e.g. at `10.0.0.50`)
- Q-SYS Designer with a Scripting Component

### Recall a preset from Q-SYS

Add a **Script Component** with the following Lua code. Wire a button control to trigger the `RecallPreset` function.

```lua
ROUTER_IP = "10.0.0.50"
ROUTER_PORT = 4000

function RecallPreset(presetName)
  local url = string.format("http://%s:%d/api/preset/recall", ROUTER_IP, ROUTER_PORT)
  local payload = string.format('{"name":"%s"}', presetName)

  HttpClient.Upload {
    Url = url,
    Method = "POST",
    Headers = { ["Content-Type"] = "application/json" },
    Data = payload,
    EventHandler = function(response)
      if response.StatusCode == 200 then
        print("Preset recalled: " .. presetName)
      else
        print("Error: " .. (response.Data or "unknown"))
      end
    end
  }
end

-- Example: recall "Show A" when a button is pressed
Controls.Inputs[1].EventHandler = function(ctrl)
  if ctrl.Boolean then
    RecallPreset("Show A")
  end
end
```

### Set a route from Q-SYS

```lua
function SetRoute(outputId, sourceId)
  local url = string.format("http://%s:%d/api/route", ROUTER_IP, ROUTER_PORT)
  local payload = string.format('{"outputId":%d,"sourceId":%d}', outputId, sourceId)

  HttpClient.Upload {
    Url = url,
    Method = "POST",
    Headers = { ["Content-Type"] = "application/json" },
    Data = payload,
    EventHandler = function(response)
      if response.StatusCode == 200 then
        print(string.format("Route set: output %d -> source %d", outputId, sourceId))
      else
        print("Error: " .. (response.Data or "unknown"))
      end
    end
  }
end
```

### Poll routing state

To keep Q-SYS in sync with the current ATEM routing state:

```lua
function PollState()
  local url = string.format("http://%s:%d/api/state", ROUTER_IP, ROUTER_PORT)

  HttpClient.Download {
    Url = url,
    Headers = {},
    EventHandler = function(response)
      if response.StatusCode == 200 then
        local state = rapidjson.decode(response.Data)
        -- Update Q-SYS controls based on state
        Controls.Outputs["atem_connected"].Boolean = state.connected
        Controls.Outputs["source_count"].Value = #state.sources
        Controls.Outputs["output_count"].Value = #state.outputs
      end
    end
  }
end

-- Poll every 2 seconds
PollTimer = Timer.New()
PollTimer.EventHandler = PollState
PollTimer:Start(2)
```

### Finding source and output IDs

The easiest way to find the IDs you need for `SetRoute`:

1. Open the ATEM Audio Router app and connect to your ATEM
2. Call `GET /api/state` — this returns all sources and outputs with their IDs and names
3. Use the `id` field from the source/output you want

Example using curl:
```bash
curl http://10.0.0.50:4000/api/state | python3 -m json.tool
```

### Testing with curl

```bash
# Get current state
curl http://localhost:4000/api/state

# Set a route
curl -X POST http://localhost:4000/api/route \
  -H "Content-Type: application/json" \
  -d '{"outputId": 131072, "sourceId": 65536}'

# Recall a preset
curl -X POST http://localhost:4000/api/preset/recall \
  -H "Content-Type: application/json" \
  -d '{"name": "Show A"}'

# Save a preset
curl -X POST http://localhost:4000/api/preset/save \
  -H "Content-Type: application/json" \
  -d '{"name": "Show A"}'

# List presets
curl http://localhost:4000/api/presets

# Delete a preset
curl -X DELETE http://localhost:4000/api/preset/Show%20A

# Connect to ATEM
curl -X POST http://localhost:4000/api/connect \
  -H "Content-Type: application/json" \
  -d '{"ip": "10.0.0.100"}'
```
