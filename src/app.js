// HTTP surface: OpenAI-compatible routes, quota and usage endpoints.
import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import { createLogger } from './logger.js';
import { MODELS, DEFAULT_MODEL, findModel } from './models.js';
import { recordUsage, getUsage, resetUsage } from './usage.js';
import { upstreamFetchModels, upstreamChatCompletion } from './upstream.js';
import { fetchQuota } from './quota.js';

const log = createLogger(config.logLevel);

export const app = express();
app.disable('x-powered-by');
app.use(cors({ origin: '*', methods: ['GET', 'POST', 'OPTIONS'] }));
app.use(express.json({ limit: config.maxBodyBytes }));

/* ------------------------------- auth ---------------------------------- */

function extractKey(req) {
  const header = req.get('authorization') ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (match) return match[1].trim();
  const xApiKey = req.get('x-api-key');
  return xApiKey ? xApiKey.trim() : null;
}

function requireAuth(req, res, next) {
  if (!config.proxyApiKey) return next();
  if (extractKey(req) === config.proxyApiKey) return next();
  return res.status(401).json({
    error: {
      message: 'Invalid or missing API key. Send Authorization: Bearer <PROXY_API_KEY>.',
      type: 'invalid_request_error',
      code: 'invalid_api_key',
    },
  });
}

/* ------------------------------ helpers -------------------------------- */

function fail(res, status, message, type = 'invalid_request_error', code = null) {
  return res.status(status).json({ error: { message, type, code } });
}

function validateChatBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'Request body must be a JSON object.' };
  }
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return { error: "'messages' must be a non-empty array." };
  }
  for (const [i, m] of body.messages.entries()) {
    if (!m || typeof m !== 'object' || typeof m.role !== 'string') {
      return { error: `messages[${i}] must be an object with a string 'role'.` };
    }
  }
  const model = body.model ?? DEFAULT_MODEL;
  if (typeof model !== 'string' || !findModel(model)) {
    return { error: `Unknown model '${model}'. See GET /v1/models.`, code: 'model_not_found' };
  }
  return { model };
}

// Upstream SSE -> client, while sniffing the usage block for accounting.
async function pipeStream(upstream, res, { model, startedAt }) {
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  const decoder = new TextDecoder();
  let buffer = '';
  let usage = null;
  let contentChars = 0;
  let closedByClient = false;

  res.on('close', () => {
    if (!res.writableEnded) closedByClient = true;
  });

  try {
    for await (const chunk of upstream.body) {
      if (closedByClient) break;
      const text = typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true });
      res.write(text);

      buffer += text;
      const events = buffer.split('\n\n');
      buffer = events.pop() ?? '';
      for (const event of events) {
        for (const line of event.split('\n')) {
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (!payload || payload === '[DONE]') continue;
          try {
            const parsed = JSON.parse(payload);
            if (parsed.usage) usage = parsed.usage;
            for (const choice of parsed.choices ?? []) {
              const piece = choice.delta?.content;
              if (typeof piece === 'string') contentChars += piece.length;
            }
          } catch {
            /* keepalive or non-JSON line */
          }
        }
      }
    }
    if (!closedByClient) res.end();
  } catch (err) {
    if (!closedByClient) {
      log.error('stream failed', { model, error: String(err?.message ?? err) });
      res.write(`data: ${JSON.stringify({ error: { message: 'Upstream stream failed.', type: 'upstream_error' } })}\n\n`);
      res.end();
    }
  } finally {
    const latencyMs = Date.now() - startedAt;
    recordUsage({
      model,
      usage: usage ?? { completion_tokens: Math.ceil(contentChars / 4) },
      latencyMs,
      ok: true,
      status: 200,
    });
    log.info('chat completion', {
      model,
      stream: true,
      latency_ms: latencyMs,
      total_tokens: usage?.total_tokens ?? null,
      client_aborted: closedByClient,
    });
  }
}

/* ------------------------------- routes -------------------------------- */

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'glm-proxy',
    upstream: config.upstreamBaseUrl,
    auth_required: Boolean(config.proxyApiKey),
    default_model: DEFAULT_MODEL,
    models: MODELS.length,
    uptime_seconds: Math.round(process.uptime()),
  });
});

app.get('/v1/models', requireAuth, (_req, res) => {
  res.json({
    object: 'list',
    data: MODELS.map((m) => ({
      id: m.id,
      object: 'model',
      created: m.created,
      owned_by: 'z-ai',
      context_window: m.context,
      max_output_tokens: m.max_output,
      capabilities: m.capabilities,
      pricing_per_1m_tokens: m.pricing,
    })),
  });
});

// Live catalogue straight from upstream.
app.get('/v1/models/upstream', requireAuth, async (_req, res) => {
  try {
    const data = await upstreamFetchModels(AbortSignal.timeout(15_000));
    res.json(data);
  } catch (err) {
    log.warn('upstream model list failed', { status: err?.status, error: String(err?.message ?? err) });
    res.status(502).json({
      error: { message: 'Could not reach the upstream model catalogue.', type: 'upstream_error' },
      upstream_status: err?.status ?? null,
    });
  }
});

async function handleChat(req, res) {
  const check = validateChatBody(req.body);
  if (check.error) {
    recordUsage({ model: req.body?.model ?? null, ok: false, status: 400 });
    return fail(res, check.code === 'model_not_found' ? 404 : 400, check.error, 'invalid_request_error', check.code);
  }

  const model = check.model;
  const wantsStream = req.body.stream === true;
  const payload = { ...req.body, model };

  // Ask upstream to emit a usage block so the dashboard has real numbers.
  if (wantsStream) {
    payload.stream_options = { include_usage: true, ...(req.body.stream_options ?? {}) };
  }

  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('upstream timeout')), config.upstreamTimeoutMs);
  res.on('close', () => {
    if (!res.writableEnded) controller.abort(new Error('client closed'));
  });

  let upstream;
  try {
    upstream = await upstreamChatCompletion(payload, { signal: controller.signal, stream: wantsStream });
  } catch (err) {
    clearTimeout(timer);
    const aborted = err?.name === 'AbortError';
    const status = err?.status ?? (aborted ? 504 : 502);
    recordUsage({ model, ok: false, status });
    log.error('upstream chat failed', { model, status, error: String(err?.message ?? err) });
    const upstreamMessage = err?.body?.error?.message ?? err?.body?.message;
    return fail(
      res,
      status,
      upstreamMessage ?? (aborted ? 'Upstream timed out.' : 'Upstream request failed.'),
      'upstream_error',
      err?.body?.error?.code ?? null,
    );
  }

  if (wantsStream) {
    await pipeStream(upstream, res, { model, startedAt });
    clearTimeout(timer);
    return;
  }

  let data;
  try {
    data = await upstream.json();
  } catch (err) {
    clearTimeout(timer);
    recordUsage({ model, ok: false, status: 502 });
    return fail(res, 502, 'Upstream returned invalid JSON.', 'upstream_error');
  }
  clearTimeout(timer);

  recordUsage({
    model: data?.model ?? model,
    usage: data?.usage,
    latencyMs: Date.now() - startedAt,
    ok: true,
    status: 200,
  });
  log.info('chat completion', {
    model,
    stream: false,
    latency_ms: Date.now() - startedAt,
    total_tokens: data?.usage?.total_tokens ?? null,
  });
  res.json(data);
}

app.post('/v1/chat/completions', requireAuth, handleChat);
app.post('/chat/completions', requireAuth, handleChat);

/* --------------------------- legacy completions ------------------------ */

// Legacy text completions -> chat completions.
app.post('/v1/completions', requireAuth, async (req, res) => {
  const body = req.body ?? {};
  const prompt = Array.isArray(body.prompt) ? body.prompt.join('\n') : body.prompt;
  if (typeof prompt !== 'string' || !prompt) {
    return fail(res, 400, "'prompt' must be a non-empty string.");
  }
  req.body = {
    model: body.model,
    messages: [{ role: 'user', content: prompt }],
    max_tokens: body.max_tokens,
    temperature: body.temperature,
    top_p: body.top_p,
    stop: body.stop,
    stream: false,
  };

  let result = null;
  await handleChat(req, {
    status(code) {
      this.statusCode = code;
      return this;
    },
    setHeader() {
      return this;
    },
    flushHeaders() {},
    on() {},
    write() {
      return true;
    },
    end() {},
    json(payload) {
      result = { statusCode: this.statusCode ?? 200, payload };
      return this;
    },
    get writableEnded() {
      return true;
    },
  });

  const data = result?.payload;
  if (!data || data.error) {
    const status = result?.statusCode ?? 500;
    return fail(res, status, data?.error?.message ?? 'Upstream request failed.', 'upstream_error');
  }
  res.status(result.statusCode ?? 200).json({
    id: data.id,
    object: 'text_completion',
    created: data.created,
    model: data.model,
    choices: (data.choices ?? []).map((c) => ({
      index: c.index,
      text: c.message?.content ?? '',
      logprobs: null,
      finish_reason: c.finish_reason,
    })),
    usage: data.usage,
  });
});

app.get('/v1/usage', requireAuth, (_req, res) => res.json(getUsage()));

// Live Coding Plan quota straight from Z.ai (plan limits + 24h usage).
app.get('/v1/quota', requireAuth, async (_req, res) => {
  try {
    res.json(await fetchQuota());
  } catch (err) {
    log.warn('quota fetch failed', { error: String(err?.message ?? err) });
    res.status(err?.status ?? 502).json({
      error: { message: 'Could not read Coding Plan quota.', type: 'upstream_error' },
      details: err?.errors ?? null,
    });
  }
});

app.post('/v1/usage/reset', requireAuth, (_req, res) => {
  resetUsage();
  res.json({ ok: true, ...getUsage() });
});

app.use((req, res) => fail(res, 404, `No route for ${req.method} ${req.path}.`, 'invalid_request_error', 'not_found'));

app.use((err, _req, res, _next) => {
  const status = err?.status ?? (err?.type === 'entity.too.large' ? 413 : 500);
  log.error('unhandled error', { status, error: String(err?.message ?? err) });
  fail(res, status, status === 413 ? 'Request body too large.' : 'Internal proxy error.', 'proxy_error');
});

export { log };
