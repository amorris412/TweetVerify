import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Dynamic route: /result/:id
 * Serves the result.html page
 */
export default {
  async fetch(_request: Request) {
    try {
      const htmlPath = join(process.cwd(), 'public', 'result.html');
      const html = readFileSync(htmlPath, 'utf-8');

      return new Response(html, {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      });
    } catch (error) {
      return new Response('Error loading result page', {
        status: 500,
        headers: { 'Content-Type': 'text/plain' },
      });
    }
  },
};
