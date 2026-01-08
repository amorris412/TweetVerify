import { ClaimVerdict } from './claude';

export interface FactCheckResult {
  requestId: string;
  status: 'processing' | 'complete' | 'error';
  tweet: string;
  tweetUrl?: string;
  claims: Array<{
    claim: string;
    verdict: ClaimVerdict;
    sources: string[];
  }>;
  overallAssessment: string;
  checkedAt: string;
  error?: string;
}

let kv: any = null;

/**
 * Initialize Vercel KV if available
 */
function getKV() {
  if (kv !== null) {
    return kv;
  }

  try {
    const { kv: vercelKV } = require('@vercel/kv');
    kv = vercelKV;
    return kv;
  } catch (error) {
    console.log('Vercel KV not available, using in-memory storage');
    kv = false;
    return null;
  }
}

const inMemoryStore = new Map<string, FactCheckResult>();

/**
 * Store a fact-check result
 */
export async function storeResult(result: FactCheckResult): Promise<void> {
  const kvStore = getKV();

  if (kvStore) {
    try {
      await kvStore.set(`result:${result.requestId}`, JSON.stringify(result), {
        ex: 60 * 60 * 24 * 30,
      });
      return;
    } catch (error) {
      console.error('Error storing result in Vercel KV:', error);
    }
  }

  inMemoryStore.set(result.requestId, result);
}

/**
 * Retrieve a fact-check result
 */
export async function getResult(requestId: string): Promise<FactCheckResult | null> {
  const kvStore = getKV();

  if (kvStore) {
    try {
      const data = await kvStore.get(`result:${requestId}`);
      if (data) {
        return typeof data === 'string' ? JSON.parse(data) : data;
      }
    } catch (error) {
      console.error('Error retrieving result from Vercel KV:', error);
    }
  }

  return inMemoryStore.get(requestId) || null;
}

/**
 * Generate a unique request ID
 */
export function generateRequestId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}
