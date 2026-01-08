import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getResult } from './lib/storage';

/**
 * API endpoint: GET /api/get-result?requestId=xxx
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { requestId } = req.query;

  if (!requestId || typeof requestId !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid requestId' });
  }

  const result = await getResult(requestId);

  if (!result) {
    return res.status(404).json({ error: 'Result not found' });
  }

  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate');

  return res.status(200).json(result);
}
