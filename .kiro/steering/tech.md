# Technology Stack

## Frontend
- **Framework**: React 18 with TypeScript
- **Build Tool**: Vite
- **Testing**: Vitest with React Testing Library
- **Hosting**: GitHub Pages (static site)
- **PWA**: Progressive Web App capabilities for offline support

## Backend
- **Cloud Provider**: AWS
- **Infrastructure**: AWS CDK (TypeScript)
- **Compute**: AWS Lambda (serverless functions)
- **API**: API Gateway with CORS
- **Database**: DynamoDB (pay-per-request)
- **Storage**: S3 (audio files, generated content)
- **Messaging**: SQS, EventBridge

## Development Tools
- **Node.js**: Version 18+ (see `.nvmrc`)
- **Package Manager**: npm
- **TypeScript**: Version 5.x across all projects
- **Testing**: Jest (infrastructure), Vitest (frontend)

## Common Commands

### Project Setup
```bash
# Install all dependencies
npm run install:all

# Individual installs
npm install                    # Root dependencies
cd frontend && npm install     # Frontend dependencies  
cd infrastructure && npm install # Infrastructure dependencies
```

### Development
```bash
# Frontend development server
npm run dev:frontend
# or
cd frontend && npm start

# Infrastructure development
cd infrastructure
npm run build    # Compile TypeScript
npm run watch    # Watch mode compilation
```

### Pre-Deployment Validation
**ALWAYS run these checks before deploying to avoid iteration cycles:**

```bash
# 1. Verify frontend builds locally first
cd frontend
npm run build
# Should complete without errors and create build/ directory

# 2. Test the built frontend locally
npm run preview
# Verify the app loads and functions correctly

# 3. Validate infrastructure before deploy
cd infrastructure
npm run build
npm run synth
# Should generate CloudFormation without errors

# 4. Check for common issues
# - Ensure index.html exists in frontend root (not public/)
# - Verify all imports resolve correctly
# - Check TypeScript compilation passes
# - Confirm environment variables are set
```

### Testing
```bash
npm test                    # Run all tests
npm run test:frontend      # Frontend tests only
npm run test:infrastructure # Infrastructure tests only
```

### Deployment
```bash
# Frontend (automatic via GitHub Actions on main branch push)
npm run build:frontend

# Infrastructure
npm run deploy:infrastructure
# or
cd infrastructure && npm run deploy
```

### Infrastructure Management
```bash
cd infrastructure
npm run diff     # View changes before deploy
npm run synth    # Generate CloudFormation
npm run destroy  # Destroy stack (use carefully)
```

## Development Practices

### Documentation Standards
- **Always use Context7 MCP**: For all library and framework documentation lookups, use Context7 to ensure access to the latest, most accurate documentation
- **Stay current**: Context7 provides up-to-date docs for React, AWS CDK, TypeScript, and other dependencies
- **Verify patterns**: When implementing features, reference Context7 docs for current best practices and API changes

## Architecture Patterns
- **Serverless-first**: All backend services use AWS serverless offerings
- **Event-driven**: Loose coupling via SQS and EventBridge
- **Static frontend**: React SPA hosted on GitHub Pages
- **Infrastructure as Code**: AWS CDK with TypeScript
- **Monorepo structure**: Frontend and infrastructure in same repository