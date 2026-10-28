// Model catalogue + usage table. Single source of truth for /v1/models.
// pricing: USD per 1M tokens. null = not published.

export const MODELS = [
  {
    id: 'glm-4.5',
    created: 1753632000,
    context: 128_000,
    max_output: 16_000,
    pricing: { input: 0.6, cached_input: 0.11, output: 2.2 },
    capabilities: ['chat', 'tools', 'streaming'],
  },
  {
    id: 'glm-4.5-air',
    created: 1753632000,
    context: 128_000,
    max_output: 16_000,
    pricing: { input: 0.2, cached_input: 0.03, output: 1.1 },
    capabilities: ['chat', 'tools', 'streaming'],
  },
  {
    id: 'glm-4.6',
    created: 1759276800,
    context: 200_000,
    max_output: 32_000,
    pricing: { input: 0.6, cached_input: 0.11, output: 2.2 },
    capabilities: ['chat', 'tools', 'streaming', 'reasoning'],
  },
  {
    id: 'glm-4.7',
    created: 1766332800,
    context: 200_000,
    max_output: 32_000,
    pricing: { input: 0.6, cached_input: 0.11, output: 2.2 },
    capabilities: ['chat', 'tools', 'streaming', 'reasoning'],
  },
  {
    id: 'glm-5',
    created: 1770739200,
    context: 200_000,
    max_output: 32_000,
    pricing: { input: 1.0, cached_input: 0.2, output: 4.0 },
    capabilities: ['chat', 'tools', 'streaming', 'reasoning'],
  },
  {
    id: 'glm-5-turbo',
    created: 1773504000,
    context: 200_000,
    max_output: 32_000,
    pricing: { input: 0.6, cached_input: 0.12, output: 2.4 },
    capabilities: ['chat', 'tools', 'streaming', 'reasoning'],
  },
  {
    id: 'glm-5.1',
    created: 1774620000,
    context: 200_000,
    max_output: 32_000,
    pricing: { input: 1.0, cached_input: 0.2, output: 4.0 },
    capabilities: ['chat', 'tools', 'streaming', 'reasoning'],
  },
  {
    id: 'glm-5.2',
    created: 1781625600,
    context: 200_000,
    max_output: 32_000,
    pricing: { input: 1.0, cached_input: 0.2, output: 4.0 },
    capabilities: ['chat', 'tools', 'streaming', 'reasoning'],
  },
  {
    id: 'glm-5.3',
    created: 1786636800,
    context: 200_000,
    max_output: 32_000,
    pricing: { input: 1.0, cached_input: 0.2, output: 4.0 },
    capabilities: ['chat', 'tools', 'streaming', 'reasoning'],
  },
  {
    id: 'glm-5.3-flash',
    created: 1786636800,
    context: 200_000,
    max_output: 32_000,
    pricing: { input: 0.1, cached_input: 0.02, output: 0.4 },
    capabilities: ['chat', 'tools', 'streaming'],
  },
  {
    id: 'glm-5.3-flashx',
    created: 1786636800,
    context: 200_000,
    max_output: 32_000,
    pricing: { input: 0.1, cached_input: 0.02, output: 0.4 },
    capabilities: ['chat', 'tools', 'streaming'],
  },
];

export const DEFAULT_MODEL = 'glm-5.3';

export function findModel(id) {
  return MODELS.find((m) => m.id === id) ?? null;
}
