// Minimal structured logger. Never logs keys or message bodies.
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

export function createLogger(level = 'info') {
  const threshold = LEVELS[level] ?? LEVELS.info;

  const emit = (lvl, msg, fields = {}) => {
    if (LEVELS[lvl] < threshold) return;
    const line = { ts: new Date().toISOString(), level: lvl, msg, ...fields };
    const out = lvl === 'error' || lvl === 'warn' ? console.error : console.log;
    out(JSON.stringify(line));
  };

  return {
    debug: (m, f) => emit('debug', m, f),
    info: (m, f) => emit('info', m, f),
    warn: (m, f) => emit('warn', m, f),
    error: (m, f) => emit('error', m, f),
  };
}
