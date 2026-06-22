/**
 * Central model configuration.
 *
 * Model IDs live here (overridable via env vars) so a model change is a single
 * edit — or a Vercel env-var update with no code deploy — instead of a hunt
 * through the codebase. See FALLBACKS below for the retired-model safety net.
 */
export const MODELS = {
  // Fast/cheap model: vision extraction, claim extraction, query generation, summaries.
  fast: process.env.FAST_MODEL || 'claude-haiku-4-5',
  // Higher-intelligence model: claim fact-check analysis.
  analysis: process.env.ANALYSIS_MODEL || 'claude-sonnet-4-6',
};

/**
 * Known-good current models to fall back to if a configured model has been
 * retired (the Anthropic API returns 404 not_found_error for retired models).
 *
 * Keyed by the configured model ID so the fallback is role-appropriate
 * (a retired analysis model falls back to a current analysis model, not the
 * cheaper fast one). Keep the *values* pointed at current models.
 */
export const FALLBACKS: Record<string, string> = {
  [MODELS.fast]: 'claude-haiku-4-5',
  [MODELS.analysis]: 'claude-sonnet-4-6',
};

// Last-resort fallback for any model ID not present in FALLBACKS.
export const DEFAULT_FALLBACK = 'claude-haiku-4-5';
