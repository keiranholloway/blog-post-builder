#!/bin/bash

# Production Deployment Script for Automated Blog Poster
# This script handles the complete production deployment process

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
ENVIRONMENT="production"
AWS_REGION="${AWS_REGION:-us-east-1}"
STACK_NAME="AutomatedBlogPoster-Prod"
MONITORING_STACK_NAME="AutomatedBlogPoster-Monitoring-Prod"

# Functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

check_prerequisites() {
    log_info "Checking prerequisites..."
    
    # Check if AWS CLI is installed and configured
    if ! command -v aws &> /dev/null; then
        log_error "AWS CLI is not installed"
        exit 1
    fi
    
    # Check if CDK is installed
    if ! command -v cdk &> /dev/null; then
        log_error "AWS CDK is not installed"
        exit 1
    fi
    
    # Check if Node.js is installed
    if ! command -v node &> /dev/null; then
        log_error "Node.js is not installed"
        exit 1
    fi
    
    # Check Node.js version
    NODE_VERSION=$(node --version | cut -d'v' -f2 | cut -d'.' -f1)
    if [ "$NODE_VERSION" -lt 18 ]; then
        log_error "Node.js version 18 or higher is required"
        exit 1
    fi
    
    # Check AWS credentials
    if ! aws sts get-caller-identity &> /dev/null; then
        log_error "AWS credentials are not configured or invalid"
        exit 1
    fi
    
    # Check if CDK is bootstrapped
    ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
    if ! aws cloudformation describe-stacks --stack-name CDKToolkit --region $AWS_REGION &> /dev/null; then
        log_warning "CDK is not bootstrapped in region $AWS_REGION"
        log_info "Bootstrapping CDK..."
        cdk bootstrap aws://$ACCOUNT/$AWS_REGION
    fi
    
    log_success "Prerequisites check completed"
}

validate_environment() {
    log_info "Validating environment variables..."
    
    # Check required environment variables
    REQUIRED_VARS=(
        "MEDIUM_CLIENT_ID"
        "MEDIUM_CLIENT_SECRET" 
        "MEDIUM_REDIRECT_URI"
        "LINKEDIN_CLIENT_ID"
        "LINKEDIN_CLIENT_SECRET"
        "LINKEDIN_REDIRECT_URI"
        "OPENAI_API_KEY"
        "ALERT_EMAIL"
    )
    
    for var in "${REQUIRED_VARS[@]}"; do
        if [ -z "${!var}" ]; then
            log_error "Environment variable $var is not set"
            exit 1
        fi
    done
    
    log_success "Environment validation completed"
}

run_tests() {
    log_info "Running pre-deployment tests..."
    
    # Frontend tests
    log_info "Running frontend tests..."
    cd frontend
    npm ci
    npm run test:unit --run
    npm run test:components --run
    npm run build
    cd ..
    
    # Infrastructure tests
    log_info "Running infrastructure tests..."
    cd infrastructure
    npm ci
    npm run build
    npm run test:unit --run
    npm run synth -- --context environment=$ENVIRONMENT
    cd ..
    
    log_success "All tests passed"
}

deploy_infrastructure() {
    log_info "Deploying infrastructure to production..."
    
    cd infrastructure
    
    # Show diff before deployment
    log_info "Showing infrastructure changes..."
    cdk diff --context environment=$ENVIRONMENT || true
    
    # Deploy main stack
    log_info "Deploying main application stack..."
    cdk deploy $STACK_NAME --context environment=$ENVIRONMENT --require-approval never
    
    # Deploy monitoring stack
    log_info "Deploying monitoring stack..."
    cdk deploy $MONITORING_STACK_NAME --context environment=$ENVIRONMENT --require-approval never
    
    cd ..
    
    log_success "Infrastructure deployment completed"
}

configure_github_pages() {
    log_info "Configuring GitHub Pages deployment..."
    
    # Check if GitHub Pages is properly configured
    if [ ! -f ".github/workflows/deploy.yml" ]; then
        log_warning "GitHub Pages deployment workflow not found"
        log_info "Creating GitHub Pages deployment workflow..."
        
        mkdir -p .github/workflows
        cat > .github/workflows/deploy.yml << 'EOF'
name: Deploy to GitHub Pages

on:
  push:
    branches: [ main ]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: "pages"
  cancel-in-progress: false

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4
        
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '18'
          cache: 'npm'
          cache-dependency-path: frontend/package-lock.json
          
      - name: Install dependencies
        run: cd frontend && npm ci
        
      - name: Build
        run: cd frontend && npm run build
        
      - name: Setup Pages
        uses: actions/configure-pages@v4
        
      - name: Upload artifact
        uses: actions/upload-pages-artifact@v3
        with:
          path: frontend/build

  deploy:
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    runs-on: ubuntu-latest
    needs: build
    steps:
      - name: Deploy to GitHub Pages
        id: deployment
        uses: actions/deploy-pages@v4
EOF
    fi
    
    log_success "GitHub Pages configuration completed"
}

setup_monitoring() {
    log_info "Setting up production monitoring and alerting..."
    
    # Get stack outputs
    API_URL=$(aws cloudformation describe-stacks --stack-name $STACK_NAME --region $AWS_REGION --query 'Stacks[0].Outputs[?OutputKey==`ApiUrl`].OutputValue' --output text)
    DASHBOARD_URL=$(aws cloudformation describe-stacks --stack-name $MONITORING_STACK_NAME --region $AWS_REGION --query 'Stacks[0].Outputs[?OutputKey==`DashboardUrl`].OutputValue' --output text)
    
    log_info "API URL: $API_URL"
    log_info "CloudWatch Dashboard: $DASHBOARD_URL"
    
    # Run initial health checks
    log_info "Running initial health checks..."
    node scripts/health-checks.js --env=production --api-url=$API_URL
    
    log_success "Monitoring setup completed"
}

setup_backup_and_recovery() {
    log_info "Configuring backup and disaster recovery..."
    
    # Enable point-in-time recovery for DynamoDB tables (already enabled in CDK)
    # Configure S3 versioning and lifecycle policies (already configured in CDK)
    
    # Create backup verification script
    cat > scripts/verify-backups.sh << 'EOF'
#!/bin/bash
# Backup verification script
set -e

STACK_NAME="AutomatedBlogPoster-Prod"
AWS_REGION="${AWS_REGION:-us-east-1}"

echo "Verifying DynamoDB point-in-time recovery..."
TABLES=$(aws cloudformation describe-stack-resources --stack-name $STACK_NAME --region $AWS_REGION --query 'StackResources[?ResourceType==`AWS::DynamoDB::Table`].PhysicalResourceId' --output text)

for table in $TABLES; do
    PITR_STATUS=$(aws dynamodb describe-continuous-backups --table-name $table --region $AWS_REGION --query 'ContinuousBackupsDescription.PointInTimeRecoveryDescription.PointInTimeRecoveryStatus' --output text)
    echo "Table $table PITR status: $PITR_STATUS"
done

echo "Verifying S3 versioning..."
BUCKETS=$(aws cloudformation describe-stack-resources --stack-name $STACK_NAME --region $AWS_REGION --query 'StackResources[?ResourceType==`AWS::S3::Bucket`].PhysicalResourceId' --output text)

for bucket in $BUCKETS; do
    VERSIONING=$(aws s3api get-bucket-versioning --bucket $bucket --query 'Status' --output text)
    echo "Bucket $bucket versioning: ${VERSIONING:-Disabled}"
done

echo "Backup verification completed"
EOF
    
    chmod +x scripts/verify-backups.sh
    
    log_success "Backup and recovery configuration completed"
}

create_rollback_script() {
    log_info "Creating rollback procedures..."
    
    cat > scripts/rollback-production.sh << 'EOF'
#!/bin/bash
# Production Rollback Script

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

STACK_NAME="AutomatedBlogPoster-Prod"
MONITORING_STACK_NAME="AutomatedBlogPoster-Monitoring-Prod"
AWS_REGION="${AWS_REGION:-us-east-1}"

echo -e "${YELLOW}[WARNING]${NC} This will rollback the production deployment"
echo -e "${YELLOW}[WARNING]${NC} This action cannot be undone"
read -p "Are you sure you want to continue? (yes/no): " confirm

if [ "$confirm" != "yes" ]; then
    echo "Rollback cancelled"
    exit 0
fi

echo -e "${RED}[ROLLBACK]${NC} Starting production rollback..."

# Get previous deployment from git
CURRENT_COMMIT=$(git rev-parse HEAD)
PREVIOUS_COMMIT=$(git rev-parse HEAD~1)

echo "Current commit: $CURRENT_COMMIT"
echo "Rolling back to: $PREVIOUS_COMMIT"

# Checkout previous commit
git checkout $PREVIOUS_COMMIT

# Rollback infrastructure
echo -e "${RED}[ROLLBACK]${NC} Rolling back infrastructure..."
cd infrastructure
npm ci
npm run build
cdk deploy $STACK_NAME --context environment=production --require-approval never
cdk deploy $MONITORING_STACK_NAME --context environment=production --require-approval never
cd ..

# Rollback frontend (GitHub Pages will be handled by workflow)
echo -e "${RED}[ROLLBACK]${NC} Frontend rollback will be handled by GitHub Pages workflow"

# Run health checks
echo -e "${RED}[ROLLBACK]${NC} Running post-rollback health checks..."
node scripts/health-checks.js --env=production

echo -e "${GREEN}[SUCCESS]${NC} Rollback completed successfully"
echo -e "${YELLOW}[INFO]${NC} Remember to push the rollback commit to trigger frontend deployment"
EOF
    
    chmod +x scripts/rollback-production.sh
    
    log_success "Rollback procedures created"
}

run_post_deployment_tests() {
    log_info "Running post-deployment tests..."
    
    # Get API URL from stack outputs
    API_URL=$(aws cloudformation describe-stacks --stack-name $STACK_NAME --region $AWS_REGION --query 'Stacks[0].Outputs[?OutputKey==`ApiUrl`].OutputValue' --output text)
    
    # Run smoke tests
    log_info "Running smoke tests..."
    node scripts/smoke-tests.js --env=production --api-url=$API_URL
    
    # Run performance tests
    log_info "Running performance tests..."
    node scripts/performance-monitoring.js --env=production --api-url=$API_URL
    
    # Validate deployment metrics
    log_info "Validating deployment metrics..."
    node scripts/validate-deployment-metrics.js --env=production
    
    log_success "Post-deployment tests completed"
}

# Main deployment process
main() {
    log_info "Starting production deployment for Automated Blog Poster"
    log_info "Environment: $ENVIRONMENT"
    log_info "AWS Region: $AWS_REGION"
    log_info "Stack Name: $STACK_NAME"
    
    check_prerequisites
    validate_environment
    run_tests
    deploy_infrastructure
    configure_github_pages
    setup_monitoring
    setup_backup_and_recovery
    create_rollback_script
    run_post_deployment_tests
    
    log_success "Production deployment completed successfully!"
    log_info "Next steps:"
    log_info "1. Push changes to main branch to trigger GitHub Pages deployment"
    log_info "2. Monitor CloudWatch dashboard for system health"
    log_info "3. Run periodic health checks using scripts/health-checks.js"
    
    # Display important URLs
    API_URL=$(aws cloudformation describe-stacks --stack-name $STACK_NAME --region $AWS_REGION --query 'Stacks[0].Outputs[?OutputKey==`ApiUrl`].OutputValue' --output text)
    DASHBOARD_URL=$(aws cloudformation describe-stacks --stack-name $MONITORING_STACK_NAME --region $AWS_REGION --query 'Stacks[0].Outputs[?OutputKey==`DashboardUrl`].OutputValue' --output text)
    
    echo ""
    log_info "Production URLs:"
    log_info "API: $API_URL"
    log_info "Frontend: https://keiranholloway.github.io/automated-blog-poster"
    log_info "Monitoring: $DASHBOARD_URL"
}

# Run main function
main "$@"