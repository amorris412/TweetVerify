import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

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
