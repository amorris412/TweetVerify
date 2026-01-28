export interface SearchResult {
  title: string;
  url: string;
  description: string;
}

/**
 * Search the web using Brave Search API
 */
export async function searchWeb(query: string, limit: number = 5): Promise<SearchResult[]> {
  const apiKey = process.env.BRAVE_SEARCH_API_KEY;

  if (!apiKey) {
    console.error('BRAVE_SEARCH_API_KEY not configured');
    return [];
  }

  try {
    const url = new URL('https://api.search.brave.com/res/v1/web/search');
    url.searchParams.append('q', query);
    url.searchParams.append('count', limit.toString());

    const response = await fetch(url.toString(), {
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'gzip',
        'X-Subscription-Token': apiKey,
      },
    });

    if (!response.ok) {
      console.error(`Brave Search API error: ${response.status} ${response.statusText}`);
      return [];
    }

    const data: any = await response.json();

    if (!data.web?.results) {
      return [];
    }

    return data.web.results.map((result: any) => ({
      title: result.title || '',
      url: result.url || '',
      description: result.description || '',
    }));
  } catch (error) {
    console.error('Error calling Brave Search API:', error);
    return [];
  }
}

/**
 * Format search results for Claude analysis
 */
export function formatSearchResultsForAnalysis(
  searchResults: SearchResult[],
  query: string
): string {
  if (searchResults.length === 0) {
    return `No results found for query: "${query}"`;
  }

  let formatted = `Search query: "${query}"\n\n`;

  searchResults.forEach((result, index) => {
    formatted += `[${index + 1}] ${result.title}\n`;
    formatted += `URL: ${result.url}\n`;
    formatted += `Summary: ${result.description}\n\n`;
  });

  return formatted;
}

/**
 * Perform multiple searches and combine results
 */
export async function searchMultipleQueries(queries: string[]): Promise<string> {
  const allSearches = await Promise.all(
    queries.map(async (query) => {
      const results = await searchWeb(query, 5);
      return formatSearchResultsForAnalysis(results, query);
    })
  );

  return allSearches.join('\n---\n\n');
}
