# TweetVerify

AI-powered tweet fact-checker using Claude Vision API and iOS Shortcuts. Take a screenshot of any tweet and get instant fact-checking with sources.

![TweetVerify Example](docs/images/example-result.png)

## Features

-  **Screenshot-based** - No manual text entry required
-  **Claude Vision** - Automatically extracts tweet text from screenshots
-  **Brave Search** - Finds authoritative sources for fact-checking
-  **iOS Integration** - One-tap sharing from X app

## How It Works

1. **Take a screenshot** of any tweet on X/Twitter
2. **Share the screenshot** using the iOS Shortcut
3. **Get results** - Safari opens with detailed fact-check including:
   - Verdict (True, Partially True, False, Unverifiable)
   - Confidence level (High, Medium, Low)
   - Detailed explanation with context
   - Authoritative sources

## Quick Start

### Prerequisites

- Anthropic API key ([get one here](https://console.anthropic.com))
- Brave Search API key ([get one here](https://brave.com/search/api/))
- Vercel account

### Deployment

1. Clone the repository
2. Install dependencies: `npm install`
3. Copy `.env.example` to `.env` and add your API keys
4. Deploy to Vercel: `vercel --prod`
5. Add environment variables to Vercel

### iOS Shortcut Setup

Create a shortcut with 4 actions:
1. **Base64 Encode** (Shortcut Input, Line Breaks: None)
2. **Get Contents of URL** (POST to `/api/check-tweet` with image data)
3. **Get Dictionary Value** (Extract `requestId`)
4. **Open URLs** (Open `/result/{requestId}`)

See full setup instructions in the deployment section above.

## Tech Stack

- **Frontend**: Vanilla HTML/CSS/JavaScript
- **Backend**: TypeScript + Vercel Serverless Functions
- **AI**: Claude 3 Haiku (Vision), Claude Sonnet 4 (Fact-checking)
- **Search**: Brave Search API
- **Storage**: Vercel KV (Redis)

## Cost Estimates

- ~$0.01-0.02 per fact-check (Claude API)
- Free tier for Brave Search (2000 queries/month)
- Free tier for Vercel hosting

**Estimated:** ~$1/month for 50 fact-checks

## License

MIT License

---

**Built with Claude Code** 🤖
