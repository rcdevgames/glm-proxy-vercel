// Usage accounting: in-memory rolling store (per process) + cost estimation.
// Vercel serverless has no durable disk, so this is deliberately ephemeral.
import { findModel } from './models.js';

const MAX_RECORDS = 2000;

const state = {
  startedAt: new Date().toISOString(),
  totals: {
    requests: 0,
    ok: 0,
    failed: 0,
    prompt_tokens: 0,
    completion_tokens: 0,
    reasoning_tokens: 0,
    cached_tokens: 0,
    total_tokens: 0,
    estimated_cost_usd: 0,
  },
  by_model: {},
  recent: [],
};

function emptyModelStat() {
  return {
    requests: 0,
    prompt_tokens: 0,
    completion_tokens: 0,
    reasoning_tokens: 0,
    cached_tokens: 0,
    total_tokens: 0,
    estimated_cost_usd: 0,
    avg_latency_ms: 0,
    last_used: null,
  };
}

export function estimateCost(modelId, usage) {
  const model = findModel(modelId);
  if (!model?.pricing) return 0;
  const p = model.pricing;
  const cached = usage.cached_tokens ?? 0;
  const prompt = Math.max((usage.prompt_tokens ?? 0) - cached, 0);
  const completion = usage.completion_tokens ?? 0;
  const cost =
    (prompt / 1e6) * p.input +
    (cached / 1e6) * (p.cached_input ?? p.input) +
    (completion / 1e6) * p.output;
  return Math.round(cost * 1e8) / 1e8;
}

export function recordUsage({ model, usage, latencyMs, ok = true, status = 200 }) {
  state.totals.requests += 1;
  if (ok) state.totals.ok += 1;
  else state.totals.failed += 1;

  const u = usage ?? {};
  const prompt = u.prompt_tokens ?? 0;
  const completion = u.completion_tokens ?? 0;
  const reasoning = u.completion_tokens_details?.reasoning_tokens ?? u.reasoning_tokens ?? 0;
  const cached = u.prompt_tokens_details?.cached_tokens ?? u.cached_tokens ?? 0;
  const total = u.total_tokens ?? prompt + completion;
  const cost = ok ? estimateCost(model, { prompt_tokens: prompt, completion_tokens: completion, cached_tokens: cached }) : 0;

  state.totals.prompt_tokens += prompt;
  state.totals.completion_tokens += completion;
  state.totals.reasoning_tokens += reasoning;
  state.totals.cached_tokens += cached;
  state.totals.total_tokens += total;
  state.totals.estimated_cost_usd = Math.round((state.totals.estimated_cost_usd + cost) * 1e8) / 1e8;

  if (model) {
    const stat = (state.by_model[model] ??= emptyModelStat());
    stat.requests += 1;
    stat.prompt_tokens += prompt;
    stat.completion_tokens += completion;
    stat.reasoning_tokens += reasoning;
    stat.cached_tokens += cached;
    stat.total_tokens += total;
    stat.estimated_cost_usd = Math.round((stat.estimated_cost_usd + cost) * 1e8) / 1e8;
    stat.avg_latency_ms = Math.round(
      (stat.avg_latency_ms * (stat.requests - 1) + (latencyMs ?? 0)) / stat.requests,
    );
    stat.last_used = new Date().toISOString();
  }

  state.recent.unshift({
    at: new Date().toISOString(),
    model: model ?? null,
    status,
    ok,
    latency_ms: latencyMs ?? null,
    prompt_tokens: prompt,
    completion_tokens: completion,
    reasoning_tokens: reasoning,
    cached_tokens: cached,
    total_tokens: total,
    estimated_cost_usd: cost,
  });
  if (state.recent.length > MAX_RECORDS) state.recent.length = MAX_RECORDS;
}

export function getUsage() {
  return {
    object: 'usage.summary',
    started_at: state.startedAt,
    uptime_seconds: Math.round(process.uptime()),
    totals: { ...state.totals },
    by_model: Object.fromEntries(
      Object.entries(state.by_model).map(([k, v]) => [k, { ...v }]),
    ),
    recent: state.recent.slice(0, 100),
    note: 'In-memory counters, reset on restart/redeploy. Cost is an estimate from published list prices.',
  };
}

export function resetUsage() {
  state.startedAt = new Date().toISOString();
  for (const k of Object.keys(state.totals)) {
    state.totals[k] = typeof state.totals[k] === 'number' ? 0 : state.totals[k];
  }
  state.by_model = {};
  state.recent = [];
}
