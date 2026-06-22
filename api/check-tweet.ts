import type { VercelRequest, VercelResponse } from '@vercel/node';
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
import { storeResult, getResult, generateRequestId, FactCheckResult } from './lib/storage';

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

    // Limit to 3 claims to stay within waitUntil time limit
    const limitedClaims = claims.slice(0, 3);

    if (limitedClaims.length === 0) {
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
        await sendNotification(ntfyTopic, 'Fact-Check Complete', 'No factual claims found', `${baseUrl}/result/${requestId}`, 'Unverifiable');
      }

      console.log(`[${requestId}] Complete: No claims found`);
      return;
    }

    const claimResults = [];

    for (const claim of limitedClaims) {
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

      claimResults.push({ claim: claim.claim, verdict, sources });

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
      const summary = claimResults.length === 1
        ? `${primaryVerdict}: ${claimResults[0].claim.substring(0, 60)}...`
        : `${claimResults.length} claims analyzed`;
      await sendNotification(ntfyTopic, 'Fact-Check Complete', summary, `${baseUrl}/result/${requestId}`, primaryVerdict);
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
      await sendNotification(ntfyTopic, 'Fact-Check Error', 'An error occurred during fact-checking', `${baseUrl}/result/${requestId}`, 'Error');
    }
  }
}

/**
 * API endpoint: POST /api/check-tweet
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
    // GET: poll for result (same function = same container = same /tmp)
    if (req.method === 'GET') {
      const requestId = req.query.requestId as string | undefined;
      if (!requestId) {
        return res.status(400).json({ error: 'Missing requestId' });
      }
      const result = await getResult(requestId);
      if (!result) {
        return res.status(404).json({ error: 'Result not found' });
      }
      res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate');
      return res.status(200).json(result);
    }

    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const protocol = (req.headers['x-forwarded-proto'] as string) || 'https';
    const host = req.headers.host || 'localhost';
    const baseUrl = `${protocol}://${host}`;

    // The iOS Shortcut opens `${baseUrl}/result/${requestId}` after POSTing.
    // If we ever return an error WITHOUT a requestId, the Shortcut opens
    // `/result/` (empty id), which has no route and renders Vercel's branded
    // 404 page. So on every failure we still mint a requestId and store an
    // error result — the Shortcut then lands on a real page that explains what
    // went wrong instead of a cryptic 404.
    async function failWithResult(message: string) {
      const requestId = generateRequestId();
      try {
        await storeResult({
          requestId,
          status: 'error',
          tweet: '',
          claims: [],
          overallAssessment: '',
          checkedAt: new Date().toISOString(),
          error: message,
        });
      } catch (e) {
        console.error('Failed to store error result:', e);
      }
      return res.status(200).json({
        requestId,
        status: 'error',
        error: message,
        resultUrl: `${baseUrl}/result/${requestId}`,
      });
    }

    const body = req.body;

    if (!body || typeof body !== 'object') {
      return failWithResult('Invalid request. Please try sharing the screenshot again.');
    }

    let { tweetText, tweetUrl, ntfyTopic, image, imageType } = body as {
      tweetText?: string;
      tweetUrl?: string;
      ntfyTopic?: string;
      image?: string;
      imageType?: string;
    };

    // Validate tweetUrl is an actual Twitter/X URL to prevent SSRF
    if (tweetUrl !== undefined) {
      try {
        const parsed = new URL(tweetUrl);
        const allowed = ['twitter.com', 'www.twitter.com', 'x.com', 'www.x.com'];
        if (!allowed.includes(parsed.hostname)) {
          return res.status(400).json({ error: 'Invalid tweetUrl: must be a twitter.com or x.com URL' });
        }
      } catch {
        return res.status(400).json({ error: 'Invalid tweetUrl' });
      }
    }

    // Validate ntfyTopic is a safe alphanumeric identifier to prevent SSRF
    if (ntfyTopic !== undefined && !/^[A-Za-z0-9_-]{1,64}$/.test(ntfyTopic)) {
      return res.status(400).json({ error: 'Invalid ntfyTopic: must be alphanumeric (max 64 chars)' });
    }

    // Validate imageType against the allowed set
    const allowedImageTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const;
    if (imageType !== undefined && !allowedImageTypes.includes(imageType as any)) {
      return res.status(400).json({ error: 'Invalid imageType' });
    }

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
        return failWithResult(
          "We couldn't read that screenshot. Please try sharing it again."
        );
      }

      try {
        const extracted = await extractTweetFromImage(image, mediaType);
        if (extracted) {
          tweetText = extracted;
          console.log(`✓ Successfully extracted tweet text from image: "${extracted.substring(0, 100)}..."`);
        } else {
          console.error('❌ Claude Vision returned null - could not extract tweet text');

          return failWithResult(
            "Couldn't find readable tweet text in that screenshot. Make sure the tweet is clearly visible and try again."
          );
        }
      } catch (error) {
        console.error('Error extracting tweet from image:', error);
        return failWithResult(
          'Something went wrong reading the screenshot. Please try again in a moment.'
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
        return failWithResult(
          'Unable to read the tweet content. Please try sharing the screenshot again, or copy and paste the tweet text instead.'
        );
      }
    }

    if (!tweetText || typeof tweetText !== 'string') {
      return failWithResult(
        'No tweet text or screenshot was received. Please try sharing the tweet again.'
      );
    }

    if (tweetText.length > 1000) {
      return failWithResult('That tweet is too long to fact-check (over 1000 characters).');
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

    // Use waitUntil to keep function alive during background processing
    waitUntil(processFactCheck(requestId, tweetText, tweetUrl, ntfyTopic, baseUrl));

    return res.status(200).json({
      requestId,
      status: 'processing',
      estimatedTime: '30-60 seconds',
      resultUrl: `${baseUrl}/result/${requestId}`,
    });
}
