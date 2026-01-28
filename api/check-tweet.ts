import type { VercelRequest, VercelResponse } from '@vercel/node';
import { waitUntil } from '@vercel/functions';
import {
  extractClaims,
  generateSearchQueries,
  analyzeClaim,
  generateOverallAssessment,
} from './lib/claude';
import { searchMultipleQueries } from './lib/search';
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

    console.log(`[${requestId}] Extracted ${claims.length} claims`);

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
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { tweetText, tweetUrl, ntfyTopic } = req.body;

  if (!tweetText || typeof tweetText !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid tweetText' });
  }

  if (tweetText.length > 1000) {
    return res.status(400).json({ error: 'Tweet text too long (max 1000 characters)' });
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

  const protocol = req.headers['x-forwarded-proto'] || 'http';
  const host = req.headers.host || 'localhost:3000';
  const baseUrl = `${protocol}://${host}`;

  // Use waitUntil to keep function alive during background processing
  waitUntil(processFactCheck(requestId, tweetText, tweetUrl, ntfyTopic, baseUrl));

  return res.status(200).json({
    requestId,
    status: 'processing',
    estimatedTime: '30-60 seconds',
    resultUrl: `${baseUrl}/result/${requestId}`,
  });
}
