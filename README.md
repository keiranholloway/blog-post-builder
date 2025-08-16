# Automated Blog Poster

A serverless system that transforms voice input into published blog posts with minimal user interaction.

## Architecture

- **Frontend**: GitHub Pages (React/HTML5 PWA)
- **Backend**: AWS Serverless (Lambda, API Gateway, DynamoDB, S3)
- **AI Agents**: Content generation, image generation, and multi-platform publishing

## Project Structure

```
├── frontend/          # GitHub Pages frontend application
├── infrastructure/    # AWS CDK infrastructure code
├── docs/             # Documentation
└── .github/          # GitHub Actions workflows
```

## Getting Started

### Prerequisites

- Node.js 18+
- AWS CLI configured
- AWS CDK CLI installed

### Development Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Deploy infrastructure:
   ```bash
   cd infrastructure
   npm run deploy
   ```

3. Start frontend development:
   ```bash
   cd frontend
   npm start
   ```

## Features

- Voice-to-text input optimized for mobile
- AI-powered content generation with user context
- Automated image generation using MCP servers
- Multi-platform publishing (Medium, LinkedIn, extensible)
- Progressive Web App with offline support
- Responsive design for mobile and desktop

## License

MIT