import test from 'node:test';
import assert from 'node:assert/strict';

process.env.GLM_KEY = 'test-key';
process.env.GLM_HOST = 'https://example.invalid/v4';
process.env.PROXY_API_KEY = 'secret123';

const { app } = await import('../src/app.js');
const { estimateCost } = await import('../src/usage.js');

const server = app.listen(0);
await new Promise((r) => server.once('listening', r));
const base = `http://127.0.0.1:${server.address().port}`;
const auth = { Authorization: 'Bearer secret123' };

test.after(() => server.close());

test('GET /health is the only unauthenticated route', async () => {
  const res = await fetch(`${base}/health`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, 'ok');
  assert.equal(body.auth_required, true);
  assert.equal(body.upstream, 'https://example.invalid/v4');
});

test('every /v1 route requires an API key', async () => {
  const routes = [
    ['GET', '/v1/models'],
    ['GET', '/v1/models/upstream'],
    ['GET', '/v1/usage'],
    ['GET', '/v1/quota'],
    ['POST', '/v1/usage/reset'],
    ['POST', '/v1/chat/completions'],
    ['POST', '/chat/completions'],
    ['POST', '/v1/completions'],
  ];
  for (const [method, path] of routes) {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: method === 'POST' ? JSON.stringify({}) : undefined,
    });
    assert.equal(res.status, 401, `${method} ${path} should be 401 without a key`);
    assert.equal((await res.json()).error.code, 'invalid_api_key');
  }
});

test('wrong API key is rejected', async () => {
  const res = await fetch(`${base}/v1/models`, { headers: { Authorization: 'Bearer wrong' } });
  assert.equal(res.status, 401);
});

test('GET /v1/models lists the GLM catalogue with a key', async () => {
  const res = await fetch(`${base}/v1/models`, { headers: auth });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.object, 'list');
  const ids = body.data.map((m) => m.id);
  assert.ok(ids.includes('glm-5.3'));
  assert.ok(ids.includes('glm-4.6'));
  assert.ok(body.data.every((m) => m.object === 'model' && m.pricing_per_1m_tokens));
});

test('chat completions rejects empty messages', async () => {
  const res = await fetch(`${base}/v1/chat/completions`, {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [] }),
  });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error.message, /messages/);
});

test('chat completions rejects unknown model', async () => {
  const res = await fetch(`${base}/v1/chat/completions`, {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] }),
  });
  assert.equal(res.status, 404);
  assert.equal((await res.json()).error.code, 'model_not_found');
});

test('usage endpoint returns a summary shape', async () => {
  const res = await fetch(`${base}/v1/usage`, { headers: auth });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.object, 'usage.summary');
  assert.ok(body.totals && typeof body.totals.requests === 'number');
  assert.ok(Array.isArray(body.recent));
});

test('cost estimate uses published per-1M pricing', () => {
  // glm-5.3-flash: 0.1 in / 0.4 out => 1M in + 1M out = 0.5 USD
  const cost = estimateCost('glm-5.3-flash', { prompt_tokens: 1e6, completion_tokens: 1e6, cached_tokens: 0 });
  assert.equal(cost, 0.5);
});

test('unknown routes return a JSON 404', async () => {
  const res = await fetch(`${base}/nope`, { headers: auth });
  assert.equal(res.status, 404);
  assert.match((await res.json()).error.message, /No route/);
});
