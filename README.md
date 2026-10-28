# glm-proxy

OpenAI-compatible proxy for Z.ai GLM Coding Plan. Deploy to Vercel, access via HTTP.

## Features

- **OpenAI-compatible API**: Point your client to `/v1` and use like `gpt-4o`
- **11 GLM models**: glm-4.5, glm-4.6, glm-5.3, glm-5.3-flash, and more
- **Stream support**: Full SSE streaming for `/v1/chat/completions`
- **Live quota tracking**: `GET /v1/quota` → 5-hour window usage, MCP balance, 24h breakdown
- **Pricing visibility**: Per-model costs estimated from official list prices
- **Usage accounting**: In-memory request/token counter (per-process)
- **API key auth**: Optional; set `PROXY_API_KEY` to lock all routes except `/health`

## Local Development

```bash
git clone https://github.com/rcdevgames/glm-proxy-vercel.git
cd glm-proxy-vercel
npm install
```

Create `.env`:

```env
GLM_HOST=https://api.z.ai/api/coding/paas/v4
GLM_KEY=<your-z-ai-key>
PROXY_API_KEY=sk-waw-<your-proxy-key>
PORT=3000
LOG_LEVEL=info
```

Start the server:

```bash
npm run dev
```

Run tests:

```bash
npm test
```

## API Reference

All endpoints except `/health` require `Authorization: Bearer <PROXY_API_KEY>` (if key is set).

### Public (no auth needed)

**`GET /health`**

Server status and upstream connectivity.

```bash
curl http://localhost:3000/health
```

Response:

```json
{
  "status": "ok",
  "service": "glm-proxy",
  "upstream": "https://api.z.ai/api/coding/paas/v4",
  "auth_required": true,
  "default_model": "glm-5.3",
  "models": 11,
  "uptime_seconds": 42
}
```

### Chat Completions (auth required)

**`POST /v1/chat/completions`** or **`POST /chat/completions`**

OpenAI-compatible endpoint. Supports streaming.

```bash
curl http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer $PROXY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "glm-5.3-flash",
    "messages": [{"role": "user", "content": "Hello"}],
    "stream": false,
    "max_tokens": 500
  }'
```

Response:

```json
{
  "id": "20261028...",
  "object": "chat.completion",
  "created": 1793155847,
  "model": "glm-5.3-flash",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "Hello! How can I help you?"
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 18,
    "completion_tokens": 12,
    "total_tokens": 30,
    "prompt_tokens_details": {"cached_tokens": 0},
    "completion_tokens_details": {"reasoning_tokens": 0}
  }
}
```

**Streaming:**

```bash
curl http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer $PROXY_API_KEY" \
  -H "Content-Type: application/json" \
  -N \
  -d '{
    "model": "glm-5.3-flash",
    "messages": [{"role": "user", "content": "Count to 3"}],
    "stream": true
  }'
```

Output (server-sent events):

```
data: {"id":"...","choices":[{"delta":{"content":"1"}}]}

data: {"id":"...","choices":[{"delta":{"content":", "}}]}

data: [DONE]
```

### Models (auth required)

**`GET /v1/models`**

List all available GLM models with pricing and capabilities.

```bash
curl http://localhost:3000/v1/models \
  -H "Authorization: Bearer $PROXY_API_KEY"
```

Response:

```json
{
  "object": "list",
  "data": [
    {
      "id": "glm-5.3-flash",
      "object": "model",
      "created": 1786636800,
      "owned_by": "z-ai",
      "context_window": 200000,
      "max_output_tokens": 32000,
      "capabilities": ["chat", "tools", "streaming"],
      "pricing_per_1m_tokens": {
        "input": 0.1,
        "cached_input": 0.02,
        "output": 0.4
      }
    },
    ...
  ]
}
```

**`GET /v1/models/upstream`**

Live model list directly from Z.ai (includes any newly added models).

```bash
curl http://localhost:3000/v1/models/upstream \
  -H "Authorization: Bearer $PROXY_API_KEY"
```

### Quota (auth required)

**`GET /v1/quota`**

Current Coding Plan limits, 5-hour rolling window usage, and 24-hour token breakdown.

```bash
curl http://localhost:3000/v1/quota \
  -H "Authorization: Bearer $PROXY_API_KEY"
```

Response:

```json
{
  "object": "quota",
  "plan": "lite",
  "window": {
    "start": "2026-10-27 10:00:00",
    "end": "2026-10-28 10:50:46",
    "timezone": "Asia/Jakarta",
    "hours": 24
  },
  "five_hour": {
    "type": "TOKENS_LIMIT",
    "window": {"unit": 3, "number": 5},
    "used_percent": 1,
    "remaining_percent": 99,
    "resets_at": "2026-10-28T07:39:59.717Z"
  },
  "monthly_mcp": {
    "type": "TIME_LIMIT",
    "window": {"unit": 5, "number": 1},
    "used_percent": 0,
    "remaining_percent": 100,
    "total": 100,
    "used": 0,
    "remaining": 100,
    "resets_at": "2026-11-24T23:58:23.999Z"
  },
  "last_24h": {
    "model_calls": 39,
    "tokens": 1625551,
    "network_search": 0,
    "web_reader": 0,
    "zread": 0,
    "by_model": [{"model": "GLM-5.3-Flash", "tokens": 1625551}],
    "hourly": [
      {"hour": "2026-10-27 10:00", "tokens": 0, "calls": 0},
      {"hour": "2026-10-27 15:00", "tokens": 996339, "calls": 18}
    ]
  }
}
```

### Usage (auth required)

**`GET /v1/usage`**

In-memory proxy request/token counter. Reset on restart or redeploy.

```bash
curl http://localhost:3000/v1/usage \
  -H "Authorization: Bearer $PROXY_API_KEY"
```

**`POST /v1/usage/reset`**

Clear usage counters (requires auth).

```bash
curl -X POST http://localhost:3000/v1/usage/reset \
  -H "Authorization: Bearer $PROXY_API_KEY"
```

### Legacy Compatibility

**`POST /v1/completions`** (auth required)

Legacy text completion endpoint (converted to chat internally).

```bash
curl http://localhost:3000/v1/completions \
  -H "Authorization: Bearer $PROXY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"prompt": "Hello", "max_tokens": 50}'
```

## Configuration

Environment variables (`.env` or Vercel):

| Var                  | Default                                      | Notes                      |
| -------------------- | -------------------------------------------- | -------------------------- |
| `GLM_HOST`           | `https://api.z.ai/api/coding/paas/v4`       | Upstream base URL          |
| `GLM_KEY`            | (required)                                   | Z.ai Coding Plan token     |
| `PROXY_API_KEY`      | (empty = no auth)                            | API key to protect routes  |
| `PORT`               | `3000` (localhost), auto (Vercel)            | Listen port                |
| `LOG_LEVEL`          | `info`                                       | `debug` / `info` / `warn`  |
| `UPSTREAM_TIMEOUT_MS` | `600000` (10 min)                            | Timeout for Z.ai requests  |
| `MAX_BODY_BYTES`     | `10485760` (10 MB)                           | Request body size limit    |

## Deployment to Vercel

1. **Create a new Vercel project** from this repo (or link existing):

   ```bash
   npm i -g vercel
   vercel link
   ```

2. **Add environment variables** in Vercel dashboard or CLI:

   ```bash
   vercel env add GLM_KEY
   vercel env add GLM_HOST
   vercel env add PROXY_API_KEY
   ```

3. **Deploy:**

   ```bash
   vercel --prod
   ```

   Or push to main branch if auto-deploy is on.

   `vercel.json` caps `maxDuration` at 300s (Hobby plan limit). If you raise it,
   set `UPSTREAM_TIMEOUT_MS` below that value so the proxy aborts before Vercel does.

4. **Use the public URL:**

   ```bash
   PROXY_URL=https://<your-project>.vercel.app
   
   curl $PROXY_URL/v1/chat/completions \
     -H "Authorization: Bearer $PROXY_API_KEY" \
     -H "Content-Type: application/json" \
     -d '{"model":"glm-5.3-flash","messages":[{"role":"user","content":"Hi"}]}'
   ```

## Notes

- **Usage counters** are in-memory and reset on restart/redeploy. For persistent tracking, call `/v1/quota` instead (reads from Z.ai).
- **Streaming** includes usage telemetry thanks to `stream_options: { include_usage: true }`.
- **Caching**: GLM Coding Plan supports prompt caching; details appear in `cached_tokens` fields.
- **Auth is optional** if `PROXY_API_KEY` is not set (open proxy, use only locally or behind a trusted firewall).

## License

ISC
