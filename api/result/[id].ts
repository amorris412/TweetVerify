import type { VercelRequest, VercelResponse } from '@vercel/node';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Dynamic route: /result/:id
 * Serves the result.html page
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const htmlPath = join(process.cwd(), 'public', 'result.html');
    const html = readFileSync(htmlPath, 'utf-8');

    res.setHeader('Content-Type', 'text/html');
    return res.status(200).send(html);
  } catch (error) {
    return res.status(500).send('Error loading result page');
  }
}
