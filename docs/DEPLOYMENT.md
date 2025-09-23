# Deployment Guide

## Overview

The Automated Blog Poster uses a two-part deployment strategy:
- **Frontend**: GitHub Pages for static site hosting
- **Backend**: AWS CDK for serverless infrastructure

## Prerequisites

1. **GitHub Repository Setup**
   - Repository with GitHub Pages enabled
   - Actions permissions enabled

2. **AWS Account Setup**
   - AWS CLI configured
   - CDK bootstrapped in target region
   - Appropriate IAM permissions

## Frontend Deployment (GitHub Pages)

### Automatic Deployment
1. Push changes to `main` branch
2. GitHub Actions workflow automatically builds and deploys
3. Site available at `https://username.github.io/repository-name`

### Manual Deployment
```bash
cd frontend
npm run build
# Manually upload build/ contents to GitHub Pages
```

### Custom Domain (Optional)
1. Add domain to `frontend/public/CNAME`
2. Configure DNS CNAME record
3. Enable HTTPS in GitHub Pages settings

## Backend Deployment (AWS CDK)

### Development Deployment
```bash
# Bootstrap CDK (one-time setup)
cdk bootstrap aws://ACCOUNT-NUMBER/REGION

# Deploy infrastructure
cd infrastructure
npm install
npm run build
npm run deploy
```

### Production Deployment
For production deployments, use the comprehensive deployment script:

```bash
# Set required environment variables
export AWS_REGION=us-east-1
export MEDIUM_CLIENT_ID=your_client_id
export MEDIUM_CLIENT_SECRET=your_client_secret
export LINKEDIN_CLIENT_ID=your_client_id
export LINKEDIN_CLIENT_SECRET=your_client_secret
export OPENAI_API_KEY=your_api_key
export ALERT_EMAIL=alerts@yourdomain.com

# Run production deployment
npm run deploy:production
```

This script will:
- Validate prerequisites and environment
- Run comprehensive tests
- Deploy infrastructure with security hardening
- Set up monitoring and alerting
- Configure backup and disaster recovery
- Create rollback procedures
- Run post-deployment validation

See [Production Deployment Checklist](./PRODUCTION_DEPLOYMENT_CHECKLIST.md) for detailed steps.

### Environment-Specific Deployments
```bash
# Development
cdk deploy --context environment=development

# Staging
cdk deploy --context environment=staging

# Production
cdk deploy --context environment=production
```

## Configuration

### Frontend Configuration
Update `frontend/src/config.ts` with API endpoints:
```typescript
export const config = {
  apiUrl: 'https://your-api-gateway-url',
  region: 'us-east-1'
};
```

### Backend Configuration
Environment variables are set in CDK stack:
- DynamoDB table names
- S3 bucket names
- SQS queue URLs
- EventBridge bus names

## Monitoring

### Frontend
- GitHub Actions for build status
- GitHub Pages deployment status
- Browser developer tools for client-side errors

### Backend
- CloudWatch Logs for Lambda functions
- CloudWatch Metrics for API Gateway
- X-Ray for distributed tracing (if enabled)

## Security Considerations

### Frontend
- HTTPS enforced via GitHub Pages
- CORS configured for API access
- No sensitive data in client-side code

### Backend
- IAM roles with least privilege
- Encryption at rest for DynamoDB and S3
- API Gateway with proper CORS
- Secrets Manager for platform credentials

## Rollback Procedures

### Production Rollback
Use the automated rollback script for production:

```bash
npm run rollback:production
```

This script will:
- Confirm the rollback action
- Checkout the previous working commit
- Rollback infrastructure to previous state
- Run health checks to verify rollback
- Provide instructions for frontend rollback

### Manual Rollback

#### Frontend
1. Revert commit in GitHub
2. Re-run GitHub Actions workflow
3. Or manually deploy previous build

#### Backend
```bash
# View deployment history
cdk diff

# Rollback to previous version
git checkout previous-commit
cd infrastructure
npm run deploy --context environment=production
```

## Cost Optimization

### AWS Resources
- DynamoDB: Pay-per-request billing
- Lambda: Pay-per-invocation
- S3: Lifecycle policies for audio cleanup
- API Gateway: Pay-per-request

### Monitoring Costs
- Set up billing alerts
- Use AWS Cost Explorer
- Monitor CloudWatch metrics

## Troubleshooting

### Common Deployment Issues

1. **CDK Bootstrap Missing**
   ```bash
   cdk bootstrap aws://ACCOUNT-NUMBER/REGION
   ```

2. **Permission Denied**
   - Check IAM policies
   - Verify AWS credentials

3. **GitHub Pages Not Updating**
   - Check Actions workflow logs
   - Verify Pages configuration

4. **API CORS Errors**
   - Update API Gateway CORS settings
   - Redeploy infrastructure

5. **Lambda Cold Starts**
   - Consider provisioned concurrency
   - Optimize function size