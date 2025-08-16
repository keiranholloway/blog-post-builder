# Development Guide

## Prerequisites

- Node.js 18+ (use `.nvmrc` for version management)
- AWS CLI configured with appropriate permissions
- AWS CDK CLI installed globally: `npm install -g aws-cdk`

## Project Structure

```
├── frontend/          # React PWA frontend
├── infrastructure/    # AWS CDK infrastructure
├── docs/             # Documentation
└── .github/          # GitHub Actions workflows
```

## Getting Started

### 1. Install Dependencies

```bash
# Install all dependencies
npm run install:all

# Or install individually
npm install
cd frontend && npm install
cd ../infrastructure && npm install
```

### 2. Development Workflow

#### Frontend Development
```bash
cd frontend
npm start
```

#### Infrastructure Development
```bash
cd infrastructure

# Build TypeScript
npm run build

# Deploy to AWS
npm run deploy

# View differences
npm run diff

# Destroy stack (careful!)
npm run destroy
```

### 3. Testing

```bash
# Run all tests
npm test

# Frontend tests only
npm run test:frontend

# Infrastructure tests only
npm run test:infrastructure
```

### 4. Deployment

#### Frontend (GitHub Pages)
- Push to `main` branch triggers automatic deployment
- Manual deployment: GitHub Actions workflow runs automatically

#### Infrastructure (AWS)
```bash
cd infrastructure
npm run deploy
```

## Environment Variables

### Frontend
Create `.env.local` in `frontend/` directory:
```
REACT_APP_API_URL=https://your-api-gateway-url
```

### Infrastructure
AWS credentials should be configured via AWS CLI or environment variables:
```
AWS_PROFILE=your-profile
AWS_REGION=us-east-1
```

## Development Tips

1. Use `npm run build` in infrastructure before deploying
2. Frontend hot-reloads during development
3. Infrastructure changes require redeployment
4. Check CloudWatch logs for Lambda debugging
5. Use AWS Console to monitor resources

## Troubleshooting

### Common Issues

1. **CDK Bootstrap Required**
   ```bash
   cdk bootstrap aws://ACCOUNT-NUMBER/REGION
   ```

2. **Permission Errors**
   - Ensure AWS credentials have sufficient permissions
   - Check IAM policies for CDK deployment

3. **Frontend Build Errors**
   - Clear node_modules and reinstall
   - Check Node.js version matches .nvmrc

4. **GitHub Pages Not Updating**
   - Check GitHub Actions workflow status
   - Verify Pages settings in repository

## Architecture Notes

- Frontend: Static React app hosted on GitHub Pages
- Backend: Serverless AWS infrastructure (Lambda, API Gateway, DynamoDB, S3)
- Communication: REST API with CORS enabled for GitHub Pages
- Security: AWS IAM roles and policies, encrypted storage