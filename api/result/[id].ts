import type { VercelRequest, VercelResponse } from '@vercel/node';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Dynamic route: /result/:id
 * Serves the result.html page
 */
export default async function handler(_req: VercelRequest, res: VercelResponse) {
    try {
      const htmlPath = join(process.cwd(), 'public', 'result.html');
      const html = readFileSync(htmlPath, 'utf-8');

      res.setHeader('Content-Type', 'text/html');
      return res.status(200).send(html);
    } catch {
      // Fallback: try __dirname-relative path (Vercel bundles files here)
      try {
        const altPath = join(__dirname, '..', '..', 'public', 'result.html');
        const html = readFileSync(altPath, 'utf-8');

        res.setHeader('Content-Type', 'text/html');
        return res.status(200).send(html);
      } catch {
        return res.status(500).send('Error loading result page');
      }
    }
}
