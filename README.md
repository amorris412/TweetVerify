# TweetVerify

AI-powered tweet fact-checker using Claude API and iOS Shortcuts. Share tweets from X (Twitter) on your iPhone, get instant fact-checks with web research, and receive push notifications with results.

## Features

- Share tweets directly from X app using iOS Share Sheet
- AI-powered claim extraction and analysis using Claude
- Web research using Brave Search API for evidence gathering
- Detailed fact-check reports with verdicts (True/False/Partially True/Unverifiable)
- Push notifications via ntfy.sh when analysis is complete
- Mobile-friendly results page with sources

## Architecture

```
iOS Shortcut → Vercel API → Claude (claim extraction)
                          → Brave Search (evidence gathering)
                          → Claude (verdict synthesis)
                          → Storage & ntfy.sh notification
```

## Setup

### 1. Prerequisites

- Node.js 18+ installed
- Vercel account (free tier works)
- Claude API key from [Anthropic](https://console.anthropic.com/)
- Brave Search API key from [Brave](https://brave.com/search/api/)
- iOS device with Shortcuts app

### 2. Clone and Install

```bash
git clone https://github.com/amorris412/TweetVerify.git
cd TweetVerify
npm install
```

### 3. Environment Variables

Create a `.env` file in the root directory:

```bash
cp .env.example .env
```

Edit `.env` and add your API keys:

```
ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxxxxxxxxxxxxxxxxxxx
BRAVE_SEARCH_API_KEY=BSAxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

### 4. Local Development

```bash
npm run dev
```

This starts a local Vercel dev server at `http://localhost:3000`.

### 5. Deploy to Vercel

#### Option A: Using Vercel CLI

```bash
npm i -g vercel
vercel login
vercel --prod
```

#### Option B: Using Vercel Dashboard

1. Push your code to GitHub
2. Go to [vercel.com](https://vercel.com)
3. Click "New Project"
4. Import your GitHub repository
5. Add environment variables in project settings:
   - `ANTHROPIC_API_KEY`
   - `BRAVE_SEARCH_API_KEY`
6. Deploy

### 6. iOS Shortcut Setup

1. Open the Shortcuts app on your iPhone
2. Tap the "+" button to create a new shortcut
3. Add the following actions:

   **Actions to add:**

   a. **Receive** → "Anything" from "Share Sheet"

   b. **Get text from** → "Shortcut Input"

   c. **Get contents of URL**
      - URL: `https://your-app.vercel.app/api/check-tweet`
      - Method: `POST`
      - Headers: `Content-Type: application/json`
      - Request Body: JSON
      ```json
      {
        "tweetText": "[Shortcut Input]",
        "ntfyTopic": "tweet-verify-YOUR-UNIQUE-ID"
      }
      ```
      (Replace `YOUR-UNIQUE-ID` with a random string, e.g., `tweet-verify-john-abc123`)

   d. **Show notification** → "Fact-check request submitted!"

4. Tap "Share Sheet" at the bottom and enable "Show in Share Sheet"
5. Choose "Text" as the input type
6. Name your shortcut "Fact Check Tweet"

### 7. ntfy.sh Notification Setup

1. Choose a unique topic name (e.g., `tweet-verify-john-abc123`)
2. Open Safari on your iPhone
3. Go to `https://ntfy.sh/your-topic-name`
4. Tap the share button and "Add to Home Screen"
5. Use this same topic name in your iOS Shortcut

## Usage

1. Open X (Twitter) app on your iPhone
2. Find a tweet you want to fact-check
3. Tap the share button on the tweet
4. Select "Fact Check Tweet" shortcut
5. Wait 30-60 seconds for processing
6. Receive push notification via ntfy.sh
7. Tap notification to view detailed results

## API Endpoints

### POST /api/check-tweet

Submit a tweet for fact-checking.

**Request Body:**
```json
{
  "tweetText": "Creatine boosts productivity by 10%",
  "tweetUrl": "https://twitter.com/user/status/123",
  "ntfyTopic": "your-ntfy-topic"
}
```

**Response:**
```json
{
  "requestId": "abc123",
  "status": "processing",
  "estimatedTime": "30-60 seconds",
  "resultUrl": "https://your-app.vercel.app/result/abc123"
}
```

### GET /api/get-result?requestId=xxx

Retrieve fact-check results.

**Response:**
```json
{
  "requestId": "abc123",
  "status": "complete",
  "tweet": "Creatine boosts productivity by 10%",
  "claims": [
    {
      "claim": "Creatine boosts productivity by 10%",
      "verdict": {
        "verdict": "Partially True",
        "confidence": "Medium",
        "explanation": "Creatine shows cognitive benefits...",
        "evidence": ["evidence 1", "evidence 2"],
        "context": "Important context..."
      },
      "sources": ["https://...", "https://..."]
    }
  ],
  "overallAssessment": "The tweet makes claims that are...",
  "checkedAt": "2026-01-08T10:30:00Z"
}
```

## Cost Estimates

**Monthly costs for 50 tweets (avg 2 claims each):**

- Claude API: ~$1.00
- Brave Search: Free (2,000 queries/month)
- Vercel: Free tier
- ntfy.sh: Free

**Total: ~$1/month**

## Project Structure

```
TweetVerify/
├── api/
│   ├── check-tweet.ts       # Main fact-checking endpoint
│   ├── get-result.ts        # Result retrieval endpoint
│   ├── result/
│   │   └── [id].ts         # Dynamic route for result pages
│   └── lib/
│       ├── claude.ts        # Claude API integration
│       ├── search.ts        # Brave Search integration
│       └── storage.ts       # Result storage (in-memory/Vercel KV)
├── public/
│   └── result.html          # Results display page
├── package.json
├── tsconfig.json
├── vercel.json
└── README.md
```

## Development

### Testing the API locally

```bash
# Start dev server
npm run dev

# Test check-tweet endpoint
curl -X POST http://localhost:3000/api/check-tweet \
  -H "Content-Type: application/json" \
  -d '{"tweetText": "Water boils at 100°C at sea level", "ntfyTopic": "test-topic"}'

# Get result
curl http://localhost:3000/api/get-result?requestId=YOUR_REQUEST_ID
```

## Troubleshooting

### iOS Shortcut not working

- Verify your Vercel app URL is correct
- Check that API keys are set in Vercel environment variables
- Make sure the ntfy topic name matches in both the shortcut and ntfy.sh subscription

### Notifications not arriving

- Open `https://ntfy.sh/your-topic` in Safari to verify subscription
- Make sure you added ntfy.sh to your home screen
- Check that the topic name is exactly the same in the shortcut

### API errors

- Check Vercel function logs in the Vercel dashboard
- Verify API keys are valid and not expired
- Ensure you haven't exceeded Brave Search API limits (2,000/month free)

## Future Enhancements

- Rate limiting per user
- User authentication
- History of checked tweets
- Browser extension for desktop
- Automatic daily digest
- Support for tweet threads
- Citation quality scoring

## License

MIT

## Contributing

Pull requests welcome! Please open an issue first to discuss major changes.

## Credits

Built with:
- [Claude API](https://www.anthropic.com/api) - AI fact-checking
- [Brave Search API](https://brave.com/search/api/) - Web research
- [Vercel](https://vercel.com) - Hosting
- [ntfy.sh](https://ntfy.sh) - Push notifications
