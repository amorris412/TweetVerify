import { getResult } from './lib/storage';

/**
 * API endpoint: GET /api/get-result?requestId=xxx
 */
export default {
  async fetch(request: Request) {
    if (request.method !== 'GET') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const url = new URL(request.url);
    const requestId = url.searchParams.get('requestId');

    if (!requestId) {
      return new Response(JSON.stringify({ error: 'Missing or invalid requestId' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const result = await getResult(requestId);

    if (!result) {
      return new Response(JSON.stringify({ error: 'Result not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 's-maxage=60, stale-while-revalidate',
      },
    });
  },
};
