/** Bump when deterministic generation, strategy or witness semantics change. */
export const ENGINE_VERSION = '1.0.0';
export { evaluate } from './evaluate.js';
export { validateInstance, validateStrategy } from './validation.js';
export { search } from './search.js';
export { shrink } from './shrink.js';
export { regress } from './regression.js';
export { defaultStrategy, demoInstance, presets } from './examples.js';
