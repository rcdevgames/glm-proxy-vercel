// Upstream HTTP client for Z.ai Coding Plan endpoint.
//
// GLM_HOST (eg https://api.z.ai/api/coding/paas/v4) already includes the
// API version prefix, so paths are appended directly:
//   GET  {GLM_HOST}/models
//   POST {GLM_HOST}/chat/completions
import { config } from './config.js';

function upstreamHeaders(extra = {}) {
  return {
    Authorization: `Bearer ${config.upstreamApiKey}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

async function readUpstreamError(res) {
  const text = await res.text().catch(() => '');
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text.slice(0, 2000) };
  }
  return { status: res.status, body };
}

export async function upstreamFetchModels(signal) {
  const res = await fetch(`${config.upstreamBaseUrl}/models`, {
    method: 'GET',
    headers: upstreamHeaders(),
    signal,
  });
  if (!res.ok) throw Object.assign(await readUpstreamError(res), { upstream: true });
  return res.json();
}

export async function upstreamChatCompletion(body, { signal, stream }) {
  const res = await fetch(`${config.upstreamBaseUrl}/chat/completions`, {
    method: 'POST',
    headers: upstreamHeaders({ Accept: stream ? 'text/event-stream' : 'application/json' }),
    body: JSON.stringify(body),
    signal,
    duplex: 'half',
  });
  if (!res.ok) throw Object.assign(await readUpstreamError(res), { upstream: true });
  return res;
}
