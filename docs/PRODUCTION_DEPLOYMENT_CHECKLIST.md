# Production Deployment Checklist

## Pre-Deployment Requirements

### Environment Setup
- [ ] AWS CLI installed and configured with production credentials
- [ ] AWS CDK installed (version 2.x)
- [ ] Node.js 18+ installed
- [ ] Git repository with all changes committed
- [ ] Environment variables configured

### Required Environment Variables
```bash
export AWS_REGION=us-east-1
export MEDIUM_CLIENT_ID=your_medium_client_id
export MEDIUM_CLIENT_SECRET=your_medium_client_secret
export MEDIUM_REDIRECT_URI=https://keiranholloway.github.io/automated-blog-poster/auth/medium/callback
export LINKEDIN_CLIENT_ID=your_linkedin_client_id
export LINKEDIN_CLIENT_SECRET=your_linkedin_client_secret
export LINKEDIN_REDIRECT_URI=https://keiranholloway.github.io/automated-blog-poster/auth/linkedin/callback
export OPENAI_API_KEY=your_openai_api_key
export ALERT_EMAIL=alerts@yourdomain.com
```

### AWS Prerequisites
- [ ] AWS account with appropriate permissions
- [ ] CDK bootstrapped in target region: `cdk bootstrap aws://ACCOUNT/REGION`
- [ ] IAM permissions for CloudFormation, Lambda, DynamoDB, S3, API Gateway, etc.

### GitHub Prerequisites
- [ ] Repository with GitHub Pages enabled
- [ ] GitHub Actions enabled
- [ ] Repository secrets configured:
  - `VITE_API_URL`
  - `VITE_AWS_REGION`
  - `AWS_ACCESS_KEY_ID` (for deployment pipeline)
  - `AWS_SECRET_ACCESS_KEY` (for deployment pipeline)

## Deployment Steps

### 1. Pre-Deployment Validation
- [ ] Run `npm run install:all` to install all dependencies
- [ ] Run `npm run lint` to check code quality
- [ ] Run `npm run test:frontend` to run frontend tests
- [ ] Run `npm run test:infrastructure` to run infrastructure tests
- [ ] Run `cd frontend && npm run build` to verify frontend builds
- [ ] Run `cd infrastructure && npm run synth` to verify CDK synthesis

### 2. Infrastructure Deployment
- [ ] Run `npm run deploy:production` or `./scripts/deploy-production.sh`
- [ ] Verify stack deployment in AWS CloudFormation console
- [ ] Check all resources are created successfully
- [ ] Verify API Gateway endpoint is accessible

### 3. Frontend Deployment
- [ ] Push changes to `main` branch to trigger GitHub Actions
- [ ] Verify GitHub Actions workflow completes successfully
- [ ] Check GitHub Pages deployment status
- [ ] Verify frontend is accessible at GitHub Pages URL

### 4. Monitoring Setup
- [ ] Run `npm run setup:monitoring` or `./scripts/setup-production-monitoring.sh`
- [ ] Verify CloudWatch dashboard is created
- [ ] Check CloudWatch alarms are configured
- [ ] Confirm SNS email subscription (check email and confirm)
- [ ] Test alert notifications

### 5. Security Configuration
- [ ] Verify WAF is enabled and configured
- [ ] Check Secrets Manager secrets are created
- [ ] Verify encryption at rest for DynamoDB and S3
- [ ] Confirm HTTPS is enforced
- [ ] Review IAM roles and policies

### 6. Backup and Recovery
- [ ] Verify DynamoDB point-in-time recovery is enabled
- [ ] Check S3 versioning is enabled
- [ ] Run `npm run verify:backups` to verify backup configuration
- [ ] Test disaster recovery procedures (optional)

### 7. Post-Deployment Validation
- [ ] Run `npm run validate:production` or `./scripts/validate-production-deployment.sh`
- [ ] Run `npm run health:production` to check system health
- [ ] Test API endpoints manually
- [ ] Verify end-to-end functionality
- [ ] Check CloudWatch logs for errors

### 8. Performance Testing
- [ ] Run `npm run test:performance-monitoring` to check performance
- [ ] Monitor API Gateway latency
- [ ] Check Lambda function cold start times
- [ ] Verify DynamoDB performance metrics

## Post-Deployment Tasks

### Documentation
- [ ] Update deployment documentation with any changes
- [ ] Document any manual configuration steps
- [ ] Update runbooks and operational procedures
- [ ] Create/update architecture diagrams

### Team Communication
- [ ] Notify team of successful deployment
- [ ] Share important URLs and credentials (securely)
- [ ] Schedule post-deployment review meeting
- [ ] Update project status and milestones

### Ongoing Monitoring
- [ ] Set up regular health checks
- [ ] Schedule backup verification
- [ ] Plan capacity monitoring and scaling
- [ ] Set up cost monitoring and alerts

## Rollback Procedures

### If Deployment Fails
- [ ] Check CloudFormation events for error details
- [ ] Review CloudWatch logs for specific errors
- [ ] Run `npm run rollback:production` if needed
- [ ] Restore from previous working state

### Emergency Rollback
- [ ] Run `./scripts/rollback-production.sh`
- [ ] Verify rollback completed successfully
- [ ] Test system functionality
- [ ] Notify stakeholders of rollback

## Validation Checklist

### Infrastructure
- [ ] All CloudFormation stacks deployed successfully
- [ ] All Lambda functions are active and healthy
- [ ] All DynamoDB tables are active with backups enabled
- [ ] All S3 buckets are created with proper policies
- [ ] API Gateway is accessible and responding
- [ ] EventBridge and SQS queues are configured

### Security
- [ ] WAF rules are active and blocking malicious requests
- [ ] All secrets are stored in Secrets Manager
- [ ] Encryption is enabled for all data at rest
- [ ] HTTPS is enforced for all endpoints
- [ ] IAM roles follow least privilege principle

### Monitoring
- [ ] CloudWatch dashboard shows all metrics
- [ ] All alarms are configured and in OK state
- [ ] SNS notifications are working
- [ ] Log aggregation is functioning
- [ ] X-Ray tracing is enabled

### Functionality
- [ ] Frontend loads without errors
- [ ] API endpoints respond correctly
- [ ] Authentication flows work
- [ ] Content generation pipeline functions
- [ ] Publishing to platforms works
- [ ] Error handling is working properly

## Important URLs

After successful deployment, document these URLs:

- **Frontend**: https://keiranholloway.github.io/automated-blog-poster
- **API Gateway**: [From CloudFormation outputs]
- **CloudWatch Dashboard**: [From AWS Console]
- **X-Ray Service Map**: [From AWS Console]

## Emergency Contacts

- **Primary Admin**: [Name and contact]
- **AWS Support**: [Support plan details]
- **GitHub Support**: [If using GitHub Enterprise]

## Troubleshooting

### Common Issues

1. **CDK Bootstrap Missing**
   ```bash
   cdk bootstrap aws://ACCOUNT/REGION
   ```

2. **Environment Variables Not Set**
   - Check all required environment variables are exported
   - Verify values are correct and not empty

3. **GitHub Pages Not Updating**
   - Check GitHub Actions workflow logs
   - Verify Pages is configured to use GitHub Actions (not branch)

4. **API CORS Errors**
   - Verify CORS origin is set correctly in CDK
   - Check API Gateway CORS configuration

5. **Lambda Function Errors**
   - Check CloudWatch logs for specific errors
   - Verify environment variables are set correctly
   - Check IAM permissions

### Support Resources

- [AWS CDK Documentation](https://docs.aws.amazon.com/cdk/)
- [GitHub Pages Documentation](https://docs.github.com/en/pages)
- [Project README](../README.md)
- [Development Guide](./DEVELOPMENT.md)
- [Disaster Recovery Plan](./DISASTER_RECOVERY.md)

## Sign-off

- [ ] Deployment completed successfully
- [ ] All validation checks passed
- [ ] Monitoring and alerting configured
- [ ] Team notified of deployment
- [ ] Documentation updated

**Deployed by**: ________________  
**Date**: ________________  
**Version**: ________________  
**Notes**: ________________