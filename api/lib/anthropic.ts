import Anthropic from '@anthropic-ai/sdk';
import { FALLBACKS, DEFAULT_FALLBACK } from './models';

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

/**
 * A 404 on the messages endpoint means the model ID is unknown — almost always
 * because the model has been retired. (The endpoint itself always exists.)
 */
function isModelNotFound(error: unknown): boolean {
  const status = (error as { status?: number })?.status;
  return status === 404;
}

/**
 * Wrapper around client.messages.create that self-heals when a configured model
 * has been retired: on a 404, it retries once with a current fallback model and
 * logs loudly so the configuration can be updated deliberately.
 */
export async function createMessage(
  params: Anthropic.MessageCreateParamsNonStreaming
): Promise<Anthropic.Message> {
  try {
    return await client.messages.create(params);
  } catch (error) {
    if (isModelNotFound(error)) {
      const requested = params.model;
      const replacement = FALLBACKS[requested] ?? DEFAULT_FALLBACK;
      if (replacement !== requested) {
        console.error(
          `[anthropic] Model "${requested}" is unavailable (likely retired). ` +
            `Falling back to "${replacement}". Update FAST_MODEL/ANALYSIS_MODEL ` +
            `(or api/lib/models.ts) to a current model.`
        );
        return await client.messages.create({ ...params, model: replacement });
      }
    }
    throw error;
  }
}

export { client };
