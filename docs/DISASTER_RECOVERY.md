# Disaster Recovery Plan

## Overview

This document outlines the disaster recovery procedures for the Automated Blog Poster system in production.

## Recovery Objectives

- **Recovery Point Objective (RPO)**: 1 hour
- **Recovery Time Objective (RTO)**: 2 hours
- **Maximum Tolerable Downtime**: 4 hours

## System Architecture

### Components
- **Frontend**: GitHub Pages (static site)
- **Backend**: AWS Lambda functions
- **Database**: DynamoDB with point-in-time recovery
- **Storage**: S3 with versioning
- **API**: API Gateway
- **Monitoring**: CloudWatch

### Dependencies
- GitHub (for frontend hosting)
- AWS services (for backend infrastructure)
- Third-party APIs (Medium, LinkedIn, OpenAI)

## Backup Strategy

### DynamoDB
- **Point-in-time recovery**: Enabled for all tables
- **Continuous backups**: Automatic backups every 5 minutes
- **Retention**: 35 days
- **Cross-region**: Not enabled (can be enabled for critical scenarios)

### S3
- **Versioning**: Enabled for all buckets
- **Lifecycle policies**: 
  - Audio files: Deleted after 7 days
  - Images: Transitioned to IA after 30 days, Glacier after 90 days
- **Cross-region replication**: Not enabled (can be enabled if needed)

### Configuration
- **Secrets Manager**: All secrets are backed up automatically
- **Infrastructure as Code**: CDK templates in Git repository
- **Environment variables**: Documented and stored in deployment scripts

## Disaster Scenarios

### 1. Complete AWS Region Failure

**Impact**: Total system unavailability
**Probability**: Very Low
**Recovery Time**: 4-6 hours

**Recovery Steps**:
1. Deploy infrastructure to alternate region using CDK
2. Restore DynamoDB data from backups
3. Update DNS/API endpoints
4. Update frontend configuration
5. Verify system functionality

**Prevention**:
- Consider multi-region deployment for critical production
- Maintain infrastructure templates in version control

### 2. DynamoDB Data Loss

**Impact**: Loss of user data and content
**Probability**: Very Low
**Recovery Time**: 1-2 hours

**Recovery Steps**:
1. Identify the point of data loss
2. Use point-in-time recovery to restore tables
3. Verify data integrity
4. Resume normal operations

**Commands**:
```bash
# Restore DynamoDB table to specific point in time
aws dynamodb restore-table-to-point-in-time \
  --source-table-name automated-blog-poster-content-prod \
  --target-table-name automated-blog-poster-content-restored \
  --restore-date-time 2024-01-01T12:00:00.000Z
```

### 3. S3 Data Loss

**Impact**: Loss of audio files and images
**Probability**: Very Low
**Recovery Time**: 30 minutes - 2 hours

**Recovery Steps**:
1. Check S3 versioning for deleted objects
2. Restore from previous versions if available
3. For audio files: Accept loss (temporary files)
4. For images: Regenerate using image generation agent

**Commands**:
```bash
# List object versions
aws s3api list-object-versions --bucket bucket-name --prefix path/

# Restore specific version
aws s3api copy-object \
  --copy-source bucket-name/path/file.jpg?versionId=version-id \
  --bucket bucket-name \
  --key path/file.jpg
```

### 4. Lambda Function Corruption

**Impact**: API functionality unavailable
**Probability**: Low
**Recovery Time**: 15-30 minutes

**Recovery Steps**:
1. Redeploy Lambda functions using CDK
2. Verify function configurations
3. Test API endpoints
4. Monitor for errors

**Commands**:
```bash
cd infrastructure
cdk deploy --context environment=production
```

### 5. API Gateway Issues

**Impact**: Frontend cannot communicate with backend
**Probability**: Low
**Recovery Time**: 15-30 minutes

**Recovery Steps**:
1. Check API Gateway configuration
2. Redeploy API Gateway using CDK
3. Update CORS settings if needed
4. Test API endpoints

### 6. GitHub Pages Outage

**Impact**: Frontend unavailable
**Probability**: Low
**Recovery Time**: 30 minutes - 2 hours

**Recovery Steps**:
1. Check GitHub status page
2. If extended outage, deploy to alternative hosting:
   - AWS S3 + CloudFront
   - Netlify
   - Vercel
3. Update DNS if using custom domain

**Alternative Deployment**:
```bash
# Deploy to S3 + CloudFront
cd frontend
npm run build
aws s3 sync build/ s3://backup-frontend-bucket --delete
```

## Recovery Procedures

### Automated Recovery

1. **Health Checks**: Automated health checks run every 5 minutes
2. **Auto-scaling**: Lambda functions scale automatically
3. **Retry Logic**: Built-in retry mechanisms for transient failures
4. **Circuit Breakers**: Prevent cascade failures

### Manual Recovery

1. **Incident Response Team**: Designated team members with access
2. **Communication Plan**: Slack/email notifications
3. **Escalation Procedures**: Clear escalation path
4. **Documentation**: Step-by-step recovery procedures

## Testing

### Disaster Recovery Drills

**Frequency**: Quarterly
**Scope**: Full system recovery simulation
**Documentation**: Results and improvements documented

**Test Scenarios**:
1. Database restoration from backup
2. Infrastructure redeployment
3. Cross-region failover simulation
4. Data integrity verification

### Backup Verification

**Frequency**: Weekly
**Automated**: Backup verification scripts
**Manual**: Spot checks of critical data

**Script**:
```bash
# Run backup verification
./scripts/verify-backups.sh
```

## Monitoring and Alerting

### Critical Alerts
- System health check failures
- High error rates (>5%)
- Database connection failures
- API Gateway 5xx errors
- Lambda function timeouts

### Alert Channels
- **Email**: alerts@yourdomain.com
- **Slack**: #alerts channel
- **SMS**: For critical alerts only

### Monitoring Dashboard
- CloudWatch Dashboard: Real-time system metrics
- Custom metrics: Business-specific KPIs
- Log aggregation: Centralized logging

## Contact Information

### Primary Contacts
- **System Administrator**: admin@yourdomain.com
- **Development Team**: dev-team@yourdomain.com
- **Business Owner**: owner@yourdomain.com

### Vendor Contacts
- **AWS Support**: Enterprise support plan
- **GitHub Support**: GitHub Enterprise
- **Third-party APIs**: Contact information documented

## Post-Incident Procedures

### Immediate Actions
1. Verify system restoration
2. Communicate status to stakeholders
3. Document incident timeline
4. Assess data loss (if any)

### Follow-up Actions
1. Conduct post-mortem meeting
2. Update disaster recovery plan
3. Implement preventive measures
4. Update monitoring and alerting

### Documentation
1. Incident report with timeline
2. Root cause analysis
3. Lessons learned
4. Action items for improvement

## Compliance and Audit

### Data Retention
- Audit logs: 7 years retention
- Backup data: 35 days retention
- Incident reports: Permanent retention

### Compliance Requirements
- Data protection regulations
- Industry standards
- Internal policies

### Regular Reviews
- **Frequency**: Semi-annually
- **Scope**: Full disaster recovery plan review
- **Updates**: Based on system changes and lessons learned

## Appendix

### Useful Commands

```bash
# Check system health
npm run health-check

# Verify backups
./scripts/verify-backups.sh

# Deploy infrastructure
cd infrastructure && cdk deploy --context environment=production

# Rollback deployment
./scripts/rollback-production.sh

# Check CloudWatch alarms
aws cloudwatch describe-alarms --state-value ALARM

# List recent deployments
aws cloudformation describe-stacks --stack-name AutomatedBlogPoster-Prod
```

### Emergency Contacts

| Role | Name | Email | Phone |
|------|------|-------|-------|
| Primary Admin | [Name] | [email] | [phone] |
| Backup Admin | [Name] | [email] | [phone] |
| Business Owner | [Name] | [email] | [phone] |

### Service Dependencies

| Service | Criticality | Contact | SLA |
|---------|-------------|---------|-----|
| AWS | Critical | Enterprise Support | 99.99% |
| GitHub | High | Support | 99.95% |
| Medium API | Medium | Developer Support | 99.9% |
| LinkedIn API | Medium | Developer Support | 99.9% |
| OpenAI API | Medium | Support | 99.9% |