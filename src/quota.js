// Coding Plan quota/usage reader.
//
// These monitor endpoints are undocumented and expect the raw token in the
// Authorization header (no "Bearer " prefix), unlike the /v4 API.
//   GET {origin}/api/monitor/usage/quota/limit
//   GET {origin}/api/monitor/usage/model-usage?startTime=..&endTime=..
//   GET {origin}/api/monitor/usage/tool-usage?startTime=..&endTime=..
import { config } from './config.js';

function originOf(baseUrl) {
  try {
    return new URL(baseUrl).origin;
  } catch {
    return 'https://api.z.ai';
  }
}

const MONITOR_ORIGIN = config.monitorBaseUrl || originOf(config.upstreamBaseUrl);

// z.ai expects "YYYY-MM-DD HH:mm:ss" in the account's local time (Asia/Jakarta).
function fmtWib(date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const get = (t) => parts.find((p) => p.type === t)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')}`;
}

// 24h rolling window, hour-aligned, in Asia/Jakarta time.
export function timeWindow(now = new Date(), hours = 24) {
  const start = new Date(now.getTime() - hours * 3600_000);
  start.setMinutes(0, 0, 0);
  return { startTime: fmtWib(start), endTime: fmtWib(now) };
}

async function monitorGet(path, { query, timeoutMs = 15_000 } = {}) {
  const url = new URL(`${MONITOR_ORIGIN}${path}`);
  for (const [k, v] of Object.entries(query ?? {})) url.searchParams.set(k, v);

  const res = await fetch(url, {
    headers: {
      Authorization: config.upstreamApiKey, // raw token, no Bearer
      'Accept-Language': 'en-US,en',
      'Content-Type': 'application/json',
    },
    signal: AbortSignal.timeout(timeoutMs),
  });

  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    throw Object.assign(new Error('Monitor endpoint returned non-JSON'), { status: 502 });
  }
  // These endpoints answer 200 with code:500 on validation/auth problems.
  if (!res.ok || (body && body.success === false)) {
    throw Object.assign(new Error(body?.msg ?? `Monitor HTTP ${res.status}`), {
      status: res.status === 200 ? 502 : res.status,
      code: body?.code ?? null,
    });
  }
  return body?.data ?? body;
}

/* ----------------------------- normalizers ----------------------------- */

function normalizeLimit(item) {
  const pct = typeof item.percentage === 'number' ? item.percentage : null;
  return {
    type: item.type,
    window: { unit: item.unit, number: item.number },
    used_percent: pct,
    remaining_percent: pct === null ? null : Math.max(0, 100 - pct),
    total: item.usage ?? null,
    used: item.currentValue ?? null,
    remaining: item.remaining ?? null,
    resets_at: item.nextResetTime ? new Date(item.nextResetTime).toISOString() : null,
    details: item.usageDetails ?? null,
  };
}

function pickTotal(data, field) {
  const v = data?.totalUsage?.[field];
  return typeof v === 'number' ? v : null;
}

export async function fetchQuota() {
  const { startTime, endTime } = timeWindow();
  const query = { startTime, endTime };

  const [limit, modelUsage, toolUsage] = await Promise.allSettled([
    monitorGet('/api/monitor/usage/quota/limit'),
    monitorGet('/api/monitor/usage/model-usage', { query }),
    monitorGet('/api/monitor/usage/tool-usage', { query }),
  ]);

  const errors = {};
  for (const [name, r] of Object.entries({ quota: limit, model_usage: modelUsage, tool_usage: toolUsage })) {
    if (r.status === 'rejected') errors[name] = String(r.reason?.message ?? r.reason);
  }

  const quota = limit.status === 'fulfilled' ? limit.value : null;
  const models = modelUsage.status === 'fulfilled' ? modelUsage.value : null;
  const tools = toolUsage.status === 'fulfilled' ? toolUsage.value : null;

  if (!quota && !models && !tools) {
    throw Object.assign(new Error('All monitor endpoints failed'), { status: 502, errors });
  }

  const limits = (quota?.limits ?? []).map(normalizeLimit);
  const fiveHour = limits.find((l) => l.type === 'TOKENS_LIMIT') ?? null;
  const mcp = limits.find((l) => l.type === 'TIME_LIMIT') ?? null;

  return {
    object: 'quota',
    plan: quota?.level ?? null,
    window: { start: startTime, end: endTime, timezone: 'Asia/Jakarta', hours: 24 },
    five_hour: fiveHour,
    monthly_mcp: mcp,
    limits,
    last_24h: {
      model_calls: pickTotal(models, 'totalModelCallCount'),
      tokens: pickTotal(models, 'totalTokensUsage'),
      network_search: pickTotal(tools, 'totalNetworkSearchCount'),
      web_reader: pickTotal(tools, 'totalWebReadMcpCount'),
      zread: pickTotal(tools, 'totalZreadMcpCount'),
      by_model: (models?.modelSummaryList ?? []).map((m) => ({
        model: m.modelName,
        tokens: m.totalTokens ?? null,
      })),
      hourly: models?.x_time
        ? models.x_time.map((t, i) => ({
            hour: t,
            tokens: models.tokensUsage?.[i] ?? 0,
            calls: models.modelCallCount?.[i] ?? 0,
          }))
        : null,
    },
    errors: Object.keys(errors).length ? errors : undefined,
    note: 'Undocumented Coding Plan monitor endpoints; token sent raw (no Bearer). Percentages are plan-provided.',
  };
}
