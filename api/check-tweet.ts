import { waitUntil } from '@vercel/functions';
import {
  extractClaims,
  generateSearchQueries,
  analyzeClaim,
  generateOverallAssessment,
  extractTweetFromSearchResults,
  extractTweetFromImage,
} from './lib/claude';
import { searchMultipleQueries, searchWeb, formatSearchResultsForAnalysis } from './lib/search';
import { storeResult, generateRequestId, FactCheckResult } from './lib/storage';

/**
 * Send notification via ntfy.sh
 */
async function sendNotification(
  ntfyTopic: string,
  title: string,
  message: string,
  clickUrl: string,
  verdict: string
) {
  if (!ntfyTopic) {
    return;
  }

  try {
    const tags = verdict === 'True' ? 'white_check_mark' : verdict === 'False' ? 'x' : 'warning';

    await fetch(`https://ntfy.sh/${ntfyTopic}`, {
      method: 'POST',
      headers: {
        Title: title,
        Priority: 'default',
        Tags: tags,
        Click: clickUrl,
      },
      body: message,
    });
  } catch (error) {
    console.error('Error sending notification:', error);
  }
}

/**
 * Process tweet fact-checking (async background job)
 */
async function processFactCheck(
  requestId: string,
  tweetText: string,
  tweetUrl: string | undefined,
  ntfyTopic: string | undefined,
  baseUrl: string
) {
  try {
    console.log(`[${requestId}] Starting fact-check for tweet: "${tweetText}"`);

    const claims = await extractClaims(tweetText);

    console.log(`[${requestId}] Extracted ${claims.length} claims:`, JSON.stringify(claims));

    if (claims.length === 0) {
      const result: FactCheckResult = {
        requestId,
        status: 'complete',
        tweet: tweetText,
        tweetUrl,
        claims: [],
        overallAssessment: 'No verifiable factual claims found in this tweet.',
        checkedAt: new Date().toISOString(),
      };

      await storeResult(result);

      if (ntfyTopic) {
        await sendNotification(
          ntfyTopic,
          'Fact-Check Complete',
          'No factual claims found',
          `${baseUrl}/result/${requestId}`,
          'Unverifiable'
        );
      }

      console.log(`[${requestId}] Complete: No claims found`);
      return;
    }

    const claimResults = [];

    for (const claim of claims) {
      console.log(`[${requestId}] Analyzing claim: "${claim.claim}"`);

      const searchQueries = await generateSearchQueries(claim.claim, tweetText);
      const queries = searchQueries.map((sq) => sq.query);

      console.log(`[${requestId}] Generated ${queries.length} search queries`);

      const searchResults = await searchMultipleQueries(queries);

      const verdict = await analyzeClaim(claim.claim, tweetText, searchResults);

      const sources = searchResults
        .match(/URL: (https?:\/\/[^\s]+)/g)
        ?.map((match) => match.replace('URL: ', ''))
        .slice(0, 5) || [];

      claimResults.push({
        claim: claim.claim,
        verdict,
        sources,
      });

      console.log(`[${requestId}] Verdict for "${claim.claim}": ${verdict.verdict}`);
    }

    const overallAssessment = await generateOverallAssessment(
      tweetText,
      claimResults.map((cr) => ({ claim: cr.claim, verdict: cr.verdict }))
    );

    const result: FactCheckResult = {
      requestId,
      status: 'complete',
      tweet: tweetText,
      tweetUrl,
      claims: claimResults,
      overallAssessment,
      checkedAt: new Date().toISOString(),
    };

    await storeResult(result);

    const primaryVerdict = claimResults[0]?.verdict.verdict || 'Complete';

    if (ntfyTopic) {
      const summary =
        claimResults.length === 1
          ? `${primaryVerdict}: ${claimResults[0].claim.substring(0, 60)}...`
          : `${claimResults.length} claims analyzed`;

      await sendNotification(
        ntfyTopic,
        'Fact-Check Complete',
        summary,
        `${baseUrl}/result/${requestId}`,
        primaryVerdict
      );
    }

    console.log(`[${requestId}] Fact-check complete`);
  } catch (error) {
    console.error(`[${requestId}] Error during fact-check:`, error);

    const errorResult: FactCheckResult = {
      requestId,
      status: 'error',
      tweet: tweetText,
      tweetUrl,
      claims: [],
      overallAssessment: '',
      checkedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : 'Unknown error',
    };

    await storeResult(errorResult);

    if (ntfyTopic) {
      await sendNotification(
        ntfyTopic,
        'Fact-Check Error',
        'An error occurred during fact-checking',
        `${baseUrl}/result/${requestId}`,
        'Error'
      );
    }
  }
}

/**
 * API endpoint: POST /api/check-tweet
 */
export default {
  async fetch(request: Request) {
    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    let body: any;
    try {
      body = await request.json();
    } catch (error) {
      return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    let { tweetText, tweetUrl, ntfyTopic, image, imageType } = body as {
      tweetText?: string;
      tweetUrl?: string;
      ntfyTopic?: string;
      image?: string;
      imageType?: string;
    };

    // Priority 1: If image provided, extract tweet text from screenshot using Claude Vision
    if (!tweetText && image) {
      console.log('Image provided, using Claude Vision to extract tweet text...');

      // Strip data URI prefix if present (e.g., "data:image/png;base64,")
      if (image.includes(',')) {
        const parts = image.split(',');
        if (parts.length > 1 && parts[0].includes('base64')) {
          console.log('Stripping data URI prefix from image');
          image = parts[1];
        }
      }

      // Detect image format from base64 prefix if not provided
      let mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' = 'image/jpeg';
      if (imageType) {
        mediaType = imageType as any;
      } else if (image.startsWith('/9j/')) {
        mediaType = 'image/jpeg';
      } else if (image.startsWith('iVBORw')) {
        mediaType = 'image/png';
      } else if (image.startsWith('R0lGOD')) {
        mediaType = 'image/gif';
      } else if (image.startsWith('UklGR')) {
        mediaType = 'image/webp';
      }

      console.log(`Detected image type: ${mediaType}, base64 length: ${image.length}`);

      // Validate base64 string
      if (!image || image.length < 100) {
        return new Response(
          JSON.stringify({
            error: 'Invalid image data',
            details: `Image data is too short or missing. Received ${image?.length || 0} bytes. Make sure the shortcut is encoding the image correctly.`,
          }),
          {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      }

      try {
        const extracted = await extractTweetFromImage(image, mediaType);
        if (extracted) {
          tweetText = extracted;
          console.log(`✓ Successfully extracted tweet text from image: "${extracted.substring(0, 100)}..."`);
        } else {
          console.error('❌ Claude Vision returned null - could not extract tweet text');

          // Check Vercel logs for detailed error: vercel logs https://tweet-verify.vercel.app
          return new Response(
            JSON.stringify({
              error: 'Could not extract tweet text from image',
              details: `Claude Vision API returned null/NOT_FOUND. Image received: ${mediaType}, ${image.length} bytes. Check Vercel logs for Claude's actual response.`,
              debugInfo: {
                imageFormat: mediaType,
                base64Length: image.length,
                base64Preview: image.substring(0, 50),
                suggestion: 'Try a different screenshot or check if image is corrupted'
              }
            }),
            {
              status: 400,
              headers: { 'Content-Type': 'application/json' },
            }
          );
        }
      } catch (error) {
        console.error('Error extracting tweet from image:', error);
        return new Response(
          JSON.stringify({
            error: 'Failed to process image',
            details: error instanceof Error ? error.message : 'Unknown error',
            stack: error instanceof Error ? error.stack : undefined,
          }),
          {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      }
    }

    // Priority 2: If tweetText not provided, try to extract from tweetUrl
    if (!tweetText && tweetUrl) {
      // First try: Use vxtwitter.com or fxtwitter.com for better extraction
      // These services are designed to provide tweet content for embedding/bots
      const vxUrl = tweetUrl.replace('x.com', 'vxtwitter.com').replace('twitter.com', 'vxtwitter.com');

      try {
        console.log('Trying vxtwitter.com for extraction...');
        const response = await fetch(vxUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; TweetVerify/1.0; +https://tweet-verify.vercel.app)',
          }
        });
        const html = await response.text();

        // Try multiple meta tag formats
        let ogDescMatch = html.match(/<meta property="og:description" content="([^"]+)"/);
        if (!ogDescMatch) {
          ogDescMatch = html.match(/<meta name="description" content="([^"]+)"/);
        }
        if (!ogDescMatch) {
          ogDescMatch = html.match(/<meta property="twitter:description" content="([^"]+)"/);
        }

        if (ogDescMatch && ogDescMatch[1]) {
          const extracted = ogDescMatch[1]
            .replace(/&quot;/g, '"')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>');

          // Filter out error messages and promotional content
          const isInvalidContent =
            extracted.includes('JavaScript is not available') ||
            extracted.includes('JavaScript is disabled') ||
            extracted.includes('Sign up now') ||
            extracted.includes('personalized timeline') ||
            extracted.includes('Failed to scan') ||
            extracted.includes('private/suspended account') ||
            extracted.length < 20;

          if (!isInvalidContent) {
            tweetText = extracted;
            console.log('Extracted tweet text from vxtwitter.com');
          }
        }
      } catch (error) {
        console.error('Failed to extract tweet text from vxtwitter:', error);
      }

      // Second try: fxtwitter as backup
      if (!tweetText) {
        const fxUrl = tweetUrl.replace('x.com', 'fxtwitter.com').replace('twitter.com', 'fxtwitter.com');

        try {
          console.log('Trying fxtwitter.com for extraction...');
          const response = await fetch(fxUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (compatible; TweetVerify/1.0; +https://tweet-verify.vercel.app)',
            }
          });
          const html = await response.text();

          let ogDescMatch = html.match(/<meta property="og:description" content="([^"]+)"/);
          if (!ogDescMatch) {
            ogDescMatch = html.match(/<meta name="description" content="([^"]+)"/);
          }

          if (ogDescMatch && ogDescMatch[1]) {
            const extracted = ogDescMatch[1]
              .replace(/&quot;/g, '"')
              .replace(/&amp;/g, '&')
              .replace(/&lt;/g, '<')
              .replace(/&gt;/g, '>');

            const isInvalidContent =
              extracted.includes('JavaScript is not available') ||
              extracted.includes('JavaScript is disabled') ||
              extracted.includes('Sign up now') ||
              extracted.includes('personalized timeline') ||
              extracted.includes('Failed to scan') ||
              extracted.includes('private/suspended account') ||
              extracted.length < 20;

            if (!isInvalidContent) {
              tweetText = extracted;
              console.log('Extracted tweet text from fxtwitter.com');
            }
          }
        } catch (error) {
          console.error('Failed to extract tweet text from fxtwitter:', error);
        }
      }

      // If HTML extraction failed, use Brave Search to fetch tweet content
      if (!tweetText) {
        console.log('HTML extraction failed, trying Brave Search...');
        try {
          const searchResults = await searchWeb(tweetUrl, 5);

          // Look for the tweet content in search results
          // Twitter/X results often have the tweet text in the description
          if (searchResults && searchResults.length > 0) {
            for (const result of searchResults) {
              const desc = result.description || '';

              // Filter out error messages and invalid content
              const isErrorMessage =
                desc.includes('JavaScript is not available') ||
                desc.includes('JavaScript is disabled') ||
                desc.includes('enable JavaScript') ||
                desc.includes('Sign up now') ||
                desc.includes('personalized timeline') ||
                desc.includes('Page not found') ||
                desc.includes('404') ||
                desc.includes('Failed to scan') ||
                desc.includes('private/suspended account') ||
                desc.length < 20;

              if (isErrorMessage) {
                continue;
              }

              // Prefer results from twitter/x domain
              if (result.url.includes('twitter.com') || result.url.includes('x.com')) {
                tweetText = desc;
                console.log('Successfully extracted tweet text from Brave Search (X.com result)');
                break;
              }

              // Also accept results that quote or reference the tweet
              if (!tweetText && desc.length > 30) {
                tweetText = desc;
                console.log('Using search result description as tweet text');
                break;
              }
            }

            // If still no good tweet text, use Claude to intelligently extract from all search results
            if (!tweetText && searchResults.length > 0) {
              console.log('Trying Claude-powered extraction from search results...');
              const formattedResults = formatSearchResultsForAnalysis(searchResults, tweetUrl);
              const claudeExtracted = await extractTweetFromSearchResults(formattedResults);

              if (claudeExtracted) {
                tweetText = claudeExtracted;
                console.log('Successfully extracted tweet text using Claude');
              }
            }
          }
        } catch (error) {
          console.error('Failed to fetch tweet content via Brave Search:', error);
        }
      }

      // Last resort fallback - return a helpful error
      if (!tweetText) {
        console.log('All extraction methods failed');
        return new Response(
          JSON.stringify({
            error: 'Unable to extract tweet content. Please try copying and pasting the tweet text manually or try again later.',
            details: 'Tweet content could not be extracted from the URL. X/Twitter may be blocking automated access.'
          }),
          {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      }
    }

    if (!tweetText || typeof tweetText !== 'string') {
      return new Response(JSON.stringify({ error: 'Missing or invalid tweetText' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (tweetText.length > 1000) {
      return new Response(
        JSON.stringify({ error: 'Tweet text too long (max 1000 characters)' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const requestId = generateRequestId();

    const initialResult: FactCheckResult = {
      requestId,
      status: 'processing',
      tweet: tweetText,
      tweetUrl,
      claims: [],
      overallAssessment: '',
      checkedAt: new Date().toISOString(),
    };

    await storeResult(initialResult);

    const url = new URL(request.url);
    const protocol = request.headers.get('x-forwarded-proto') || url.protocol.replace(':', '');
    const host = request.headers.get('host') || url.host;
    const baseUrl = `${protocol}://${host}`;

    // Use waitUntil to keep function alive during background processing
    waitUntil(processFactCheck(requestId, tweetText, tweetUrl, ntfyTopic, baseUrl));

    return new Response(
      JSON.stringify({
        requestId,
        status: 'processing',
        estimatedTime: '30-60 seconds',
        resultUrl: `${baseUrl}/result/${requestId}`,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  },
};
