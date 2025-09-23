#!/bin/bash

# Production Monitoring Setup Script
# This script configures comprehensive monitoring and alerting for production

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Configuration
ENVIRONMENT="production"
AWS_REGION="${AWS_REGION:-us-east-1}"
STACK_NAME="AutomatedBlogPoster-Prod"
MONITORING_STACK_NAME="AutomatedBlogPoster-Monitoring-Prod"
ALERT_EMAIL="${ALERT_EMAIL:-alerts@yourdomain.com}"

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

setup_cloudwatch_dashboard() {
    log_info "Setting up CloudWatch Dashboard..."
    
    # Get stack outputs
    API_URL=$(aws cloudformation describe-stacks --stack-name $STACK_NAME --region $AWS_REGION --query 'Stacks[0].Outputs[?OutputKey==`ApiUrl`].OutputValue' --output text)
    
    # Create custom dashboard
    cat > /tmp/dashboard-body.json << EOF
{
    "widgets": [
        {
            "type": "metric",
            "x": 0,
            "y": 0,
            "width": 12,
            "height": 6,
            "properties": {
                "metrics": [
                    [ "AWS/ApiGateway", "Count", "ApiName", "Automated Blog Poster API" ],
                    [ ".", "4XXError", ".", "." ],
                    [ ".", "5XXError", ".", "." ]
                ],
                "view": "timeSeries",
                "stacked": false,
                "region": "$AWS_REGION",
                "title": "API Gateway Requests",
                "period": 300
            }
        },
        {
            "type": "metric",
            "x": 12,
            "y": 0,
            "width": 12,
            "height": 6,
            "properties": {
                "metrics": [
                    [ "AWS/ApiGateway", "Latency", "ApiName", "Automated Blog Poster API" ]
                ],
                "view": "timeSeries",
                "stacked": false,
                "region": "$AWS_REGION",
                "title": "API Gateway Latency",
                "period": 300
            }
        },
        {
            "type": "metric",
            "x": 0,
            "y": 6,
            "width": 24,
            "height": 6,
            "properties": {
                "metrics": [
                    [ "AWS/Lambda", "Invocations", "FunctionName", "AutomatedBlogPoster-Prod-ApiHandler" ],
                    [ ".", "Errors", ".", "." ],
                    [ ".", "Duration", ".", "." ],
                    [ ".", "Throttles", ".", "." ]
                ],
                "view": "timeSeries",
                "stacked": false,
                "region": "$AWS_REGION",
                "title": "Lambda Functions",
                "period": 300
            }
        },
        {
            "type": "log",
            "x": 0,
            "y": 12,
            "width": 24,
            "height": 6,
            "properties": {
                "query": "SOURCE '/aws/lambda/AutomatedBlogPoster-Prod-ApiHandler'\n| fields @timestamp, @message\n| filter @message like /ERROR/\n| sort @timestamp desc\n| limit 100",
                "region": "$AWS_REGION",
                "title": "Recent Errors",
                "view": "table"
            }
        }
    ]
}
EOF

    aws cloudwatch put-dashboard \
        --dashboard-name "AutomatedBlogPoster-Production" \
        --dashboard-body file:///tmp/dashboard-body.json \
        --region $AWS_REGION

    rm /tmp/dashboard-body.json
    
    log_success "CloudWatch Dashboard created"
}

setup_cloudwatch_alarms() {
    log_info "Setting up CloudWatch Alarms..."
    
    # Get SNS topic ARN
    TOPIC_ARN=$(aws cloudformation describe-stacks --stack-name $MONITORING_STACK_NAME --region $AWS_REGION --query 'Stacks[0].Outputs[?OutputKey==`AlertTopicArn`].OutputValue' --output text)
    
    # API Gateway Error Rate Alarm
    aws cloudwatch put-metric-alarm \
        --alarm-name "AutomatedBlogPoster-API-ErrorRate" \
        --alarm-description "High error rate for API Gateway" \
        --metric-name "4XXError" \
        --namespace "AWS/ApiGateway" \
        --statistic "Sum" \
        --period 300 \
        --threshold 10 \
        --comparison-operator "GreaterThanThreshold" \
        --evaluation-periods 2 \
        --alarm-actions "$TOPIC_ARN" \
        --dimensions Name=ApiName,Value="Automated Blog Poster API" \
        --region $AWS_REGION

    # API Gateway Latency Alarm
    aws cloudwatch put-metric-alarm \
        --alarm-name "AutomatedBlogPoster-API-Latency" \
        --alarm-description "High latency for API Gateway" \
        --metric-name "Latency" \
        --namespace "AWS/ApiGateway" \
        --statistic "Average" \
        --period 300 \
        --threshold 5000 \
        --comparison-operator "GreaterThanThreshold" \
        --evaluation-periods 3 \
        --alarm-actions "$TOPIC_ARN" \
        --dimensions Name=ApiName,Value="Automated Blog Poster API" \
        --region $AWS_REGION

    # Lambda Error Rate Alarm
    aws cloudwatch put-metric-alarm \
        --alarm-name "AutomatedBlogPoster-Lambda-ErrorRate" \
        --alarm-description "High error rate for Lambda functions" \
        --metric-name "Errors" \
        --namespace "AWS/Lambda" \
        --statistic "Sum" \
        --period 300 \
        --threshold 5 \
        --comparison-operator "GreaterThanThreshold" \
        --evaluation-periods 2 \
        --alarm-actions "$TOPIC_ARN" \
        --region $AWS_REGION

    # DynamoDB Throttle Alarm
    aws cloudwatch put-metric-alarm \
        --alarm-name "AutomatedBlogPoster-DynamoDB-Throttles" \
        --alarm-description "DynamoDB throttling detected" \
        --metric-name "ThrottledRequests" \
        --namespace "AWS/DynamoDB" \
        --statistic "Sum" \
        --period 300 \
        --threshold 1 \
        --comparison-operator "GreaterThanThreshold" \
        --evaluation-periods 1 \
        --alarm-actions "$TOPIC_ARN" \
        --region $AWS_REGION

    log_success "CloudWatch Alarms configured"
}

setup_log_insights_queries() {
    log_info "Setting up CloudWatch Logs Insights queries..."
    
    # Create saved queries for common investigations
    aws logs put-query-definition \
        --name "AutomatedBlogPoster-ErrorAnalysis" \
        --query-string 'fields @timestamp, @message, @requestId
| filter @message like /ERROR/
| sort @timestamp desc
| limit 100' \
        --log-group-names "/aws/lambda/AutomatedBlogPoster-Prod-ApiHandler" \
        --region $AWS_REGION

    aws logs put-query-definition \
        --name "AutomatedBlogPoster-PerformanceAnalysis" \
        --query-string 'fields @timestamp, @duration, @billedDuration, @memorySize, @maxMemoryUsed
| filter @type = "REPORT"
| sort @timestamp desc
| limit 100' \
        --log-group-names "/aws/lambda/AutomatedBlogPoster-Prod-ApiHandler" \
        --region $AWS_REGION

    aws logs put-query-definition \
        --name "AutomatedBlogPoster-UserActivity" \
        --query-string 'fields @timestamp, @message
| filter @message like /user/
| sort @timestamp desc
| limit 100' \
        --log-group-names "/aws/lambda/AutomatedBlogPoster-Prod-ApiHandler" \
        --region $AWS_REGION

    log_success "Log Insights queries created"
}

setup_custom_metrics() {
    log_info "Setting up custom metrics..."
    
    # Create custom metric filters for application-specific metrics
    aws logs put-metric-filter \
        --log-group-name "/aws/lambda/AutomatedBlogPoster-Prod-ApiHandler" \
        --filter-name "ContentGenerationSuccess" \
        --filter-pattern "[timestamp, requestId, level=\"INFO\", message=\"Content generation completed\"]" \
        --metric-transformations \
            metricName=ContentGenerationSuccess,metricNamespace=AutomatedBlogPoster/Business,metricValue=1 \
        --region $AWS_REGION

    aws logs put-metric-filter \
        --log-group-name "/aws/lambda/AutomatedBlogPoster-Prod-ApiHandler" \
        --filter-name "ContentGenerationFailure" \
        --filter-pattern "[timestamp, requestId, level=\"ERROR\", message=\"Content generation failed\"]" \
        --metric-transformations \
            metricName=ContentGenerationFailure,metricNamespace=AutomatedBlogPoster/Business,metricValue=1 \
        --region $AWS_REGION

    aws logs put-metric-filter \
        --log-group-name "/aws/lambda/AutomatedBlogPoster-Prod-ApiHandler" \
        --filter-name "PublishingSuccess" \
        --filter-pattern "[timestamp, requestId, level=\"INFO\", message=\"Publishing completed\"]" \
        --metric-transformations \
            metricName=PublishingSuccess,metricNamespace=AutomatedBlogPoster/Business,metricValue=1 \
        --region $AWS_REGION

    log_success "Custom metrics configured"
}

setup_x_ray_tracing() {
    log_info "Setting up X-Ray tracing..."
    
    # X-Ray is enabled in the CDK stack, but we can create service maps and insights
    log_info "X-Ray tracing is enabled in the infrastructure"
    log_info "Access X-Ray console to view service maps and traces"
    
    log_success "X-Ray tracing configured"
}

create_monitoring_scripts() {
    log_info "Creating monitoring scripts..."
    
    # Create health check script
    cat > scripts/health-check-production.sh << 'EOF'
#!/bin/bash
# Production Health Check Script

set -e

API_URL="${1:-$(aws cloudformation describe-stacks --stack-name AutomatedBlogPoster-Prod --query 'Stacks[0].Outputs[?OutputKey==`ApiUrl`].OutputValue' --output text)}"
REGION="${AWS_REGION:-us-east-1}"

echo "Running production health checks..."

# Check API Gateway health
echo "Checking API Gateway..."
HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$API_URL/health")
if [ "$HTTP_STATUS" -eq 200 ]; then
    echo "✅ API Gateway is healthy"
else
    echo "❌ API Gateway health check failed (HTTP $HTTP_STATUS)"
    exit 1
fi

# Check DynamoDB tables
echo "Checking DynamoDB tables..."
TABLES=$(aws cloudformation describe-stack-resources --stack-name AutomatedBlogPoster-Prod --region $REGION --query 'StackResources[?ResourceType==`AWS::DynamoDB::Table`].PhysicalResourceId' --output text)

for table in $TABLES; do
    STATUS=$(aws dynamodb describe-table --table-name $table --region $REGION --query 'Table.TableStatus' --output text)
    if [ "$STATUS" = "ACTIVE" ]; then
        echo "✅ Table $table is active"
    else
        echo "❌ Table $table is not active (Status: $STATUS)"
        exit 1
    fi
done

# Check Lambda functions
echo "Checking Lambda functions..."
FUNCTIONS=$(aws cloudformation describe-stack-resources --stack-name AutomatedBlogPoster-Prod --region $REGION --query 'StackResources[?ResourceType==`AWS::Lambda::Function`].PhysicalResourceId' --output text)

for func in $FUNCTIONS; do
    STATE=$(aws lambda get-function --function-name $func --region $REGION --query 'Configuration.State' --output text)
    if [ "$STATE" = "Active" ]; then
        echo "✅ Function $func is active"
    else
        echo "❌ Function $func is not active (State: $STATE)"
        exit 1
    fi
done

echo "🎉 All health checks passed!"
EOF

    chmod +x scripts/health-check-production.sh

    # Create alarm check script
    cat > scripts/check-alarms.sh << 'EOF'
#!/bin/bash
# Check CloudWatch Alarms Script

REGION="${AWS_REGION:-us-east-1}"

echo "Checking CloudWatch alarms..."

ALARM_STATES=$(aws cloudwatch describe-alarms --region $REGION --query 'MetricAlarms[?starts_with(AlarmName, `AutomatedBlogPoster`)].{Name:AlarmName,State:StateValue}' --output table)

echo "$ALARM_STATES"

ALARM_COUNT=$(aws cloudwatch describe-alarms --region $REGION --state-value ALARM --query 'MetricAlarms[?starts_with(AlarmName, `AutomatedBlogPoster`)]' --output text | wc -l)

if [ "$ALARM_COUNT" -gt 0 ]; then
    echo "❌ $ALARM_COUNT alarms are in ALARM state"
    exit 1
else
    echo "✅ All alarms are OK"
fi
EOF

    chmod +x scripts/check-alarms.sh

    log_success "Monitoring scripts created"
}

setup_notification_channels() {
    log_info "Setting up notification channels..."
    
    # The SNS topic is created by the monitoring stack
    # Add email subscription if not already exists
    TOPIC_ARN=$(aws cloudformation describe-stacks --stack-name $MONITORING_STACK_NAME --region $AWS_REGION --query 'Stacks[0].Outputs[?OutputKey==`AlertTopicArn`].OutputValue' --output text)
    
    # Check if email subscription exists
    EXISTING_SUBSCRIPTION=$(aws sns list-subscriptions-by-topic --topic-arn $TOPIC_ARN --region $AWS_REGION --query "Subscriptions[?Endpoint=='$ALERT_EMAIL'].SubscriptionArn" --output text)
    
    if [ -z "$EXISTING_SUBSCRIPTION" ]; then
        aws sns subscribe \
            --topic-arn $TOPIC_ARN \
            --protocol email \
            --notification-endpoint $ALERT_EMAIL \
            --region $AWS_REGION
        
        log_info "Email subscription created. Please confirm the subscription in your email."
    else
        log_info "Email subscription already exists"
    fi
    
    log_success "Notification channels configured"
}

main() {
    log_info "Setting up production monitoring for Automated Blog Poster"
    
    setup_cloudwatch_dashboard
    setup_cloudwatch_alarms
    setup_log_insights_queries
    setup_custom_metrics
    setup_x_ray_tracing
    create_monitoring_scripts
    setup_notification_channels
    
    log_success "Production monitoring setup completed!"
    
    # Display important information
    DASHBOARD_URL="https://$AWS_REGION.console.aws.amazon.com/cloudwatch/home?region=$AWS_REGION#dashboards:name=AutomatedBlogPoster-Production"
    XRAY_URL="https://$AWS_REGION.console.aws.amazon.com/xray/home?region=$AWS_REGION#/service-map"
    
    echo ""
    log_info "Important URLs:"
    log_info "CloudWatch Dashboard: $DASHBOARD_URL"
    log_info "X-Ray Service Map: $XRAY_URL"
    echo ""
    log_info "Monitoring Commands:"
    log_info "Health Check: ./scripts/health-check-production.sh"
    log_info "Alarm Check: ./scripts/check-alarms.sh"
}

main "$@"