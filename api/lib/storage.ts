import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
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
 * Initialize Vercel KV if available and configured
 */
function getKV() {
  if (kv !== null) {
    return kv;
  }

  // Only try KV if env vars are configured
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
    kv = false;
    return null;
  }

  try {
    const { kv: vercelKV } = require('@vercel/kv');
    kv = vercelKV;
    return kv;
  } catch (error) {
    console.log('Vercel KV not available, using filesystem storage');
    kv = false;
    return null;
  }
}

const TMP_DIR = '/tmp/tweetverify';

/**
 * Ensure tmp directory exists
 */
function ensureTmpDir() {
  try {
    if (!existsSync(TMP_DIR)) {
      mkdirSync(TMP_DIR, { recursive: true });
    }
  } catch {
    // ignore
  }
}

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

  // Fallback: write to /tmp filesystem (persists within same Vercel container)
  try {
    ensureTmpDir();
    writeFileSync(
      join(TMP_DIR, `${result.requestId}.json`),
      JSON.stringify(result)
    );
  } catch (error) {
    console.error('Error writing to /tmp:', error);
  }
}

const VALID_REQUEST_ID = /^[0-9a-z_-]{5,30}$/;

/**
 * Retrieve a fact-check result
 */
export async function getResult(requestId: string): Promise<FactCheckResult | null> {
  if (!VALID_REQUEST_ID.test(requestId)) {
    return null;
  }

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

  // Fallback: read from /tmp filesystem
  try {
    const filePath = join(TMP_DIR, `${requestId}.json`);
    if (existsSync(filePath)) {
      return JSON.parse(readFileSync(filePath, 'utf-8'));
    }
  } catch (error) {
    console.error('Error reading from /tmp:', error);
  }

  return null;
}

/**
 * Generate a unique request ID
 */
export function generateRequestId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}
