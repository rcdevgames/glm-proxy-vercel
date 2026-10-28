// Config loader: env vars + optional local .env (dev only).
import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const schema = z.object({
  GLM_HOST: z.string().url().default('https://api.z.ai/api/coding/paas/v4'),
  GLM_KEY: z.string().min(1, 'GLM_KEY is required'),
  PROXY_API_KEY: z.string().optional(),
  PORT: z.coerce.number().int().positive().default(3000),
  UPSTREAM_TIMEOUT_MS: z.coerce.number().int().positive().default(600_000),
  MAX_BODY_BYTES: z.coerce.number().int().positive().default(10 * 1024 * 1024),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

const parsed = schema.parse({
  GLM_HOST: process.env.GLM_HOST,
  GLM_KEY: process.env.GLM_KEY,
  PROXY_API_KEY: process.env.PROXY_API_KEY,
  PORT: process.env.PORT,
  UPSTREAM_TIMEOUT_MS: process.env.UPSTREAM_TIMEOUT_MS,
  MAX_BODY_BYTES: process.env.MAX_BODY_BYTES,
  LOG_LEVEL: process.env.LOG_LEVEL,
});

export const config = {
  upstreamBaseUrl: parsed.GLM_HOST.replace(/\/+$/, ''),
  upstreamApiKey: parsed.GLM_KEY,
  proxyApiKey: parsed.PROXY_API_KEY?.trim() || null,
  port: parsed.PORT,
  upstreamTimeoutMs: parsed.UPSTREAM_TIMEOUT_MS,
  maxBodyBytes: parsed.MAX_BODY_BYTES,
  logLevel: parsed.LOG_LEVEL,
};
