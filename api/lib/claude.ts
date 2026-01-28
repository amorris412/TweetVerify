import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

/**
 * Use Claude to extract tweet content from search results
 */
export async function extractTweetFromSearchResults(searchResultsText: string): Promise<string | null> {
  const prompt = `I have search results about a tweet but cannot access the tweet directly. Extract the actual tweet text from these search results.

Search Results:
${searchResultsText}

Return ONLY the tweet text itself, nothing else. If you cannot find the tweet text in the results, return "NOT_FOUND".`;

  try {
    const response = await client.messages.create({
      model: 'claude-3-haiku-20240307',
      max_tokens: 500,
      messages: [{ role: 'user', content: prompt }],
    });

    const content = response.content[0];
    if (content.type === 'text') {
      const extracted = content.text.trim();
      if (extracted === 'NOT_FOUND' || extracted.length < 10) {
        return null;
      }
      return extracted;
    }
  } catch (error) {
    console.error('Error using Claude to extract tweet:', error);
  }

  return null;
}

/**
 * Use Claude's vision API to extract tweet text from a screenshot
 */
export async function extractTweetFromImage(
  imageBase64: string,
  mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' = 'image/jpeg'
): Promise<string | null> {
  console.log(`Calling Claude Vision API with image (${imageBase64.length} bytes, ${mediaType})`);

  try {
    const response = await client.messages.create({
      model: 'claude-3-haiku-20240307',
      max_tokens: 2048,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: mediaType,
                data: imageBase64,
              },
            },
            {
              type: 'text',
              text: `Describe what you see in this image, then extract any tweet or social media post text.`,
            },
          ],
        },
      ],
    });

    console.log(`Claude Vision API response - stop_reason: ${response.stop_reason}, content blocks: ${response.content.length}`);

    const content = response.content[0];
    console.log(`Claude response content type: ${content.type}`);

    if (content.type === 'text') {
      const fullResponse = content.text.trim();
      console.log(`Claude vision full response (${fullResponse.length} chars): "${fullResponse}"`);

      // For now, just return whatever Claude says (we'll parse it on the client side if needed)
      if (fullResponse.length < 5) {
        console.log(`Response too short (${fullResponse.length} chars)`);
        return null;
      }

      // Try to extract just the tweet text if Claude gave us a description + tweet
      // Look for patterns like "The tweet says:" or quoted text
      const tweetMatch = fullResponse.match(/"([^"]+)"/);
      if (tweetMatch) {
        console.log(`✓ Extracted quoted text: "${tweetMatch[1]}"`);
        return tweetMatch[1];
      }

      // Otherwise return the full response
      console.log(`✓ Returning full Claude response`);
      return fullResponse;
    } else {
      console.log(`Unexpected content type from Claude: ${JSON.stringify(content)}`);
    }
  } catch (error) {
    console.error('❌ Error calling Claude Vision API:', error);
    if (error instanceof Error) {
      console.error('Error name:', error.name);
      console.error('Error message:', error.message);
      console.error('Error stack:', error.stack);
    }
    // Log the full error object
    console.error('Full error object:', JSON.stringify(error, null, 2));

    // Re-throw the error so we can see it in the API response
    throw new Error(`Claude Vision API failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }

  console.log('Returning null - extraction failed');
  return null;
}

export interface Claim {
  claim: string;
  type: string;
  specificity: string;
}

export interface SearchQuery {
  query: string;
  rationale: string;
}

export interface ClaimVerdict {
  verdict: 'True' | 'Partially True' | 'False' | 'Unverifiable';
  confidence: 'High' | 'Medium' | 'Low';
  explanation: string;
  evidence: string[];
  context: string;
}

/**
 * Extract factual claims from a tweet using Claude
 */
export async function extractClaims(tweetText: string): Promise<Claim[]> {
  const prompt = `Analyze this tweet and extract all factual claims that can be verified:

Tweet: "${tweetText}"

For each claim, provide:
1. The specific claim text
2. What type of claim it is (statistical, scientific, historical, medical, etc.)
3. How specific/verifiable it is (very specific, somewhat specific, vague)

Return ONLY a valid JSON array with this structure:
[
  {
    "claim": "the exact claim text",
    "type": "claim type",
    "specificity": "specificity level"
  }
]

If there are no verifiable factual claims, return an empty array: []

Do not include opinions, subjective statements, or future predictions. Only extract claims that can be fact-checked against evidence.`;

  console.log('[extractClaims] Calling Claude with tweet:', tweetText);

  const message = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: prompt,
      },
    ],
  });

  console.log('[extractClaims] Claude response:', JSON.stringify(message, null, 2));

  const responseText = message.content[0].type === 'text' ? message.content[0].text : '';

  console.log('[extractClaims] Response text:', responseText);

  try {
    // Strip markdown code fences if present
    const jsonText = responseText.replace(/```json\n?|\n?```/g, '').trim();
    console.log('[extractClaims] Cleaned JSON:', jsonText);

    const claims = JSON.parse(jsonText);
    console.log('[extractClaims] Parsed claims:', claims);
    return Array.isArray(claims) ? claims : [];
  } catch (error) {
    console.error('[extractClaims] Failed to parse claims JSON:', error);
    console.error('[extractClaims] Raw response was:', responseText);
    return [];
  }
}

/**
 * Generate search queries for a claim using Claude
 */
export async function generateSearchQueries(
  claim: string,
  tweetContext: string
): Promise<SearchQuery[]> {
  const prompt = `Generate 2-3 effective search queries to fact-check this claim:

Claim: "${claim}"
Original tweet context: "${tweetContext}"

For each search query, provide:
1. The search query text (optimized for search engines)
2. A brief rationale for why this query is useful

Return ONLY a valid JSON array with this structure:
[
  {
    "query": "search query text",
    "rationale": "why this query helps verify the claim"
  }
]

Make queries specific and likely to find authoritative sources.`;

  const message = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 512,
    messages: [
      {
        role: 'user',
        content: prompt,
      },
    ],
  });

  const responseText = message.content[0].type === 'text' ? message.content[0].text : '';

  try {
    // Strip markdown code fences if present
    const jsonText = responseText.replace(/```json\n?|\n?```/g, '').trim();
    const queries = JSON.parse(jsonText);
    return Array.isArray(queries) ? queries : [];
  } catch (error) {
    console.error('Failed to parse search queries JSON:', error);
    return [];
  }
}

/**
 * Analyze a claim against search results to produce a verdict
 */
export async function analyzeClaim(
  claim: string,
  tweetText: string,
  searchResults: string
): Promise<ClaimVerdict> {
  const prompt = `You are a fact-checker. Analyze this claim from a tweet against the search results below.

Claim: "${claim}"
Original tweet: "${tweetText}"

Search results:
${searchResults}

Provide a thorough fact-check analysis. Return ONLY a valid JSON object with this structure:
{
  "verdict": "True" | "Partially True" | "False" | "Unverifiable",
  "confidence": "High" | "Medium" | "Low",
  "explanation": "2-3 sentence explanation of your verdict",
  "evidence": ["key piece of evidence 1", "key piece of evidence 2"],
  "context": "important context or nuances that affect the verdict"
}

Guidelines:
- "True": The claim is accurate and well-supported by evidence
- "Partially True": The claim has some truth but is misleading, lacks context, or is imprecise
- "False": The claim is contradicted by evidence
- "Unverifiable": Insufficient or conflicting evidence to make a determination

Be precise, cite specific evidence, and note important context.`;

  const message = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2048,
    messages: [
      {
        role: 'user',
        content: prompt,
      },
    ],
  });

  const responseText = message.content[0].type === 'text' ? message.content[0].text : '';

  try {
    // Strip markdown code fences if present
    const jsonText = responseText.replace(/```json\n?|\n?```/g, '').trim();
    const verdict = JSON.parse(jsonText);
    return verdict as ClaimVerdict;
  } catch (error) {
    console.error('Failed to parse verdict JSON:', error);
    return {
      verdict: 'Unverifiable',
      confidence: 'Low',
      explanation: 'Error analyzing claim',
      evidence: [],
      context: 'Analysis failed due to parsing error',
    };
  }
}

/**
 * Generate an overall assessment of multiple claims
 */
export async function generateOverallAssessment(
  tweetText: string,
  claimVerdicts: Array<{ claim: string; verdict: ClaimVerdict }>
): Promise<string> {
  const verdictSummary = claimVerdicts
    .map((cv) => `- "${cv.claim}": ${cv.verdict.verdict} (${cv.verdict.confidence} confidence)`)
    .join('\n');

  const prompt = `Summarize the fact-check results for this tweet in 2-3 sentences:

Original tweet: "${tweetText}"

Fact-check results:
${verdictSummary}

Provide a clear, concise overall assessment that captures the main takeaway.`;

  const message = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 256,
    messages: [
      {
        role: 'user',
        content: prompt,
      },
    ],
  });

  return message.content[0].type === 'text' ? message.content[0].text : '';
}
