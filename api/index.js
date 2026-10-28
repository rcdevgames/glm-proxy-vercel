// Vercel serverless entry. vercel.json rewrites every path here, and the
// Express app's routes (/v1/models, /v1/chat/completions, ...) match
// req.url as-is, so no path rewriting is needed.
import { app } from '../src/app.js';

export default function handler(req, res) {
  return app(req, res);
}
