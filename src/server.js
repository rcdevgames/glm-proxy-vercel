import { app, log } from './app.js';
import { config } from './config.js';

const server = app.listen(config.port, () => {
  log.info('server started', {
    port: config.port,
    upstream: config.upstreamBaseUrl,
    auth_required: Boolean(config.proxyApiKey),
  });
  if (!config.proxyApiKey) {
    log.warn('PROXY_API_KEY is not set; proxy endpoints are publicly accessible');
  }
});

const shutdown = (signal) => {
  log.info('shutdown requested', { signal });
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
