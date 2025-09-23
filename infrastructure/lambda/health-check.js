"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = void 0;
const client_dynamodb_1 = require("@aws-sdk/client-dynamodb");
const client_s3_1 = require("@aws-sdk/client-s3");
const client_sqs_1 = require("@aws-sdk/client-sqs");
const client_cloudwatch_1 = require("@aws-sdk/client-cloudwatch");
const client_sns_1 = require("@aws-sdk/client-sns");
const handler = async (event, context) => {
    console.log('Starting system health check...');
    const healthChecks = [
        checkDynamoDBHealth(),
        checkS3Health(),
        checkSQSHealth(),
        checkAPIGatewayHealth(),
        checkLambdaHealth(),
        checkEventBridgeHealth(),
    ];
    try {
        const results = await Promise.allSettled(healthChecks);
        const healthResults = results.map((result, index) => {
            if (result.status === 'fulfilled') {
                return result.value;
            }
            else {
                return {
                    service: ['DynamoDB', 'S3', 'SQS', 'APIGateway'][index],
                    status: 'unhealthy',
                    responseTime: 0,
                    error: result.reason?.message || 'Unknown error',
                };
            }
        });
        const report = generateHealthReport(healthResults);
        await sendHealthMetrics(report);
        if (report.overallStatus === 'unhealthy') {
            await sendHealthAlert(report);
        }
        console.log('Health check completed:', JSON.stringify(report, null, 2));
    }
    catch (error) {
        console.error('Health check failed:', error);
        await sendCriticalAlert(error);
    }
};
exports.handler = handler;
async function checkDynamoDBHealth() {
    const client = new client_dynamodb_1.DynamoDBClient({ region: process.env.AWS_REGION });
    const startTime = Date.now();
    try {
        // Check if we can describe tables (basic connectivity test)
        const tables = [
            process.env.CONTENT_TABLE_NAME,
            process.env.USER_TABLE_NAME,
            process.env.AGENT_MESSAGES_TABLE_NAME,
        ].filter(Boolean);
        const tableChecks = tables.map(async (tableName) => {
            const command = new client_dynamodb_1.DescribeTableCommand({ TableName: tableName });
            const response = await client.send(command);
            return {
                tableName,
                status: response.Table?.TableStatus,
                itemCount: response.Table?.ItemCount,
            };
        });
        const tableResults = await Promise.all(tableChecks);
        const responseTime = Date.now() - startTime;
        const unhealthyTables = tableResults.filter(table => table.status !== 'ACTIVE');
        return {
            service: 'DynamoDB',
            status: unhealthyTables.length > 0 ? 'degraded' : 'healthy',
            responseTime,
            details: {
                tables: tableResults,
                unhealthyTables: unhealthyTables.length,
            },
        };
    }
    catch (error) {
        return {
            service: 'DynamoDB',
            status: 'unhealthy',
            responseTime: Date.now() - startTime,
            error: error.message,
        };
    }
}
async function checkS3Health() {
    const client = new client_s3_1.S3Client({ region: process.env.AWS_REGION });
    const startTime = Date.now();
    try {
        const buckets = [
            process.env.AUDIO_BUCKET_NAME,
            process.env.IMAGE_BUCKET_NAME,
        ].filter(Boolean);
        const bucketChecks = buckets.map(async (bucketName) => {
            const command = new client_s3_1.HeadBucketCommand({ Bucket: bucketName });
            await client.send(command);
            return { bucketName, accessible: true };
        });
        const bucketResults = await Promise.all(bucketChecks);
        const responseTime = Date.now() - startTime;
        return {
            service: 'S3',
            status: 'healthy',
            responseTime,
            details: {
                buckets: bucketResults,
            },
        };
    }
    catch (error) {
        return {
            service: 'S3',
            status: 'unhealthy',
            responseTime: Date.now() - startTime,
            error: error.message,
        };
    }
}
async function checkSQSHealth() {
    const client = new client_sqs_1.SQSClient({ region: process.env.AWS_REGION });
    const startTime = Date.now();
    try {
        const queues = [
            process.env.AGENT_QUEUE_URL,
            process.env.CONTENT_GENERATION_QUEUE_URL,
            process.env.IMAGE_GENERATION_QUEUE_URL,
            process.env.PUBLISHING_QUEUE_URL,
        ].filter(Boolean);
        const queueChecks = queues.map(async (queueUrl) => {
            const command = new client_sqs_1.GetQueueAttributesCommand({
                QueueUrl: queueUrl,
                AttributeNames: ['ApproximateNumberOfMessages', 'ApproximateNumberOfMessagesNotVisible'],
            });
            const response = await client.send(command);
            const visibleMessages = parseInt(response.Attributes?.ApproximateNumberOfMessages || '0');
            const invisibleMessages = parseInt(response.Attributes?.ApproximateNumberOfMessagesNotVisible || '0');
            return {
                queueUrl,
                visibleMessages,
                invisibleMessages,
                totalMessages: visibleMessages + invisibleMessages,
            };
        });
        const queueResults = await Promise.all(queueChecks);
        const responseTime = Date.now() - startTime;
        // Check for queues with too many messages (potential backlog)
        const backloggedQueues = queueResults.filter(queue => queue.totalMessages > 100);
        return {
            service: 'SQS',
            status: backloggedQueues.length > 0 ? 'degraded' : 'healthy',
            responseTime,
            details: {
                queues: queueResults,
                backloggedQueues: backloggedQueues.length,
            },
        };
    }
    catch (error) {
        return {
            service: 'SQS',
            status: 'unhealthy',
            responseTime: Date.now() - startTime,
            error: error.message,
        };
    }
}
async function checkAPIGatewayHealth() {
    const startTime = Date.now();
    try {
        // Simple connectivity test - we can't easily test API Gateway from Lambda
        // without making HTTP requests, so we'll just check if we can resolve DNS
        const apiUrl = process.env.API_GATEWAY_URL;
        if (!apiUrl) {
            return {
                service: 'APIGateway',
                status: 'degraded',
                responseTime: Date.now() - startTime,
                error: 'API Gateway URL not configured',
            };
        }
        return {
            service: 'APIGateway',
            status: 'healthy',
            responseTime: Date.now() - startTime,
            details: {
                url: apiUrl,
                note: 'Basic configuration check only',
            },
        };
    }
    catch (error) {
        return {
            service: 'APIGateway',
            status: 'unhealthy',
            responseTime: Date.now() - startTime,
            error: error.message,
        };
    }
}
function generateHealthReport(results) {
    const summary = {
        totalServices: results.length,
        healthyServices: results.filter(r => r.status === 'healthy').length,
        unhealthyServices: results.filter(r => r.status === 'unhealthy').length,
        degradedServices: results.filter(r => r.status === 'degraded').length,
    };
    let overallStatus = 'healthy';
    if (summary.unhealthyServices > 0) {
        overallStatus = 'unhealthy';
    }
    else if (summary.degradedServices > 0) {
        overallStatus = 'degraded';
    }
    return {
        timestamp: new Date().toISOString(),
        overallStatus,
        services: results,
        summary,
    };
}
async function sendHealthMetrics(report) {
    const client = new client_cloudwatch_1.CloudWatchClient({ region: process.env.AWS_REGION });
    try {
        const metricData = [
            {
                MetricName: 'HealthCheckSuccess',
                Value: report.overallStatus === 'healthy' ? 1 : 0,
                Unit: client_cloudwatch_1.StandardUnit.Count,
                Timestamp: new Date(),
            },
            {
                MetricName: 'HealthCheckFailure',
                Value: report.overallStatus === 'unhealthy' ? 1 : 0,
                Unit: client_cloudwatch_1.StandardUnit.Count,
                Timestamp: new Date(),
            },
            {
                MetricName: 'HealthyServices',
                Value: report.summary.healthyServices,
                Unit: client_cloudwatch_1.StandardUnit.Count,
                Timestamp: new Date(),
            },
            {
                MetricName: 'UnhealthyServices',
                Value: report.summary.unhealthyServices,
                Unit: client_cloudwatch_1.StandardUnit.Count,
                Timestamp: new Date(),
            },
        ];
        // Add individual service metrics
        report.services.forEach(service => {
            metricData.push({
                MetricName: 'ServiceResponseTime',
                Value: service.responseTime,
                Unit: client_cloudwatch_1.StandardUnit.Milliseconds,
                Dimensions: [{ Name: 'Service', Value: service.service }],
                Timestamp: new Date(),
            });
            metricData.push({
                MetricName: 'ServiceHealth',
                Value: service.status === 'healthy' ? 1 : 0,
                Unit: client_cloudwatch_1.StandardUnit.Count,
                Dimensions: [{ Name: 'Service', Value: service.service }],
                Timestamp: new Date(),
            });
        });
        await client.send(new client_cloudwatch_1.PutMetricDataCommand({
            Namespace: 'AutomatedBlogPoster/HealthCheck',
            MetricData: metricData,
        }));
    }
    catch (error) {
        console.error('Failed to send health metrics:', error);
    }
}
async function sendHealthAlert(report) {
    const alertTopicArn = process.env.ALERT_TOPIC_ARN;
    if (!alertTopicArn) {
        console.warn('Alert topic ARN not configured, skipping health alert');
        return;
    }
    const client = new client_sns_1.SNSClient({ region: process.env.AWS_REGION });
    try {
        const alertMessage = {
            timestamp: report.timestamp,
            severity: report.overallStatus === 'unhealthy' ? 'CRITICAL' : 'WARNING',
            service: 'AutomatedBlogPoster',
            type: 'HealthCheck',
            summary: `System health is ${report.overallStatus.toUpperCase()}`,
            details: report,
        };
        await client.send(new client_sns_1.PublishCommand({
            TopicArn: alertTopicArn,
            Subject: `${report.overallStatus.toUpperCase()}: System Health Alert`,
            Message: JSON.stringify(alertMessage, null, 2),
        }));
    }
    catch (error) {
        console.error('Failed to send health alert:', error);
    }
}
async function checkLambdaHealth() {
    const startTime = Date.now();
    try {
        // Check Lambda function health by testing basic functionality
        const testData = { test: 'health-check', timestamp: new Date().toISOString() };
        const testResult = JSON.stringify(testData);
        if (!testResult.includes('health-check')) {
            throw new Error('Lambda function basic operations failed');
        }
        const responseTime = Date.now() - startTime;
        return {
            service: 'Lambda',
            status: 'healthy',
            responseTime,
            details: {
                memoryUsed: process.memoryUsage(),
                uptime: process.uptime(),
                nodeVersion: process.version,
            },
        };
    }
    catch (error) {
        return {
            service: 'Lambda',
            status: 'unhealthy',
            responseTime: Date.now() - startTime,
            error: error.message,
        };
    }
}
async function checkEventBridgeHealth() {
    const startTime = Date.now();
    try {
        // Test EventBridge connectivity by attempting to put a test event
        const eventBusName = process.env.EVENT_BUS_NAME;
        if (!eventBusName) {
            return {
                service: 'EventBridge',
                status: 'degraded',
                responseTime: Date.now() - startTime,
                error: 'EventBridge bus name not configured',
            };
        }
        // We can't easily test EventBridge without actually sending events
        // So we'll just verify the configuration is present
        return {
            service: 'EventBridge',
            status: 'healthy',
            responseTime: Date.now() - startTime,
            details: {
                eventBusName,
                note: 'Configuration check only',
            },
        };
    }
    catch (error) {
        return {
            service: 'EventBridge',
            status: 'unhealthy',
            responseTime: Date.now() - startTime,
            error: error.message,
        };
    }
}
async function sendCriticalAlert(error) {
    const alertTopicArn = process.env.ALERT_TOPIC_ARN;
    if (!alertTopicArn) {
        console.warn('Alert topic ARN not configured, skipping critical alert');
        return;
    }
    const client = new client_sns_1.SNSClient({ region: process.env.AWS_REGION });
    try {
        const alertMessage = {
            timestamp: new Date().toISOString(),
            severity: 'CRITICAL',
            service: 'AutomatedBlogPoster',
            type: 'HealthCheckFailure',
            summary: 'Health check system failure',
            error: {
                name: error.name,
                message: error.message,
                stack: error.stack,
            },
        };
        await client.send(new client_sns_1.PublishCommand({
            TopicArn: alertTopicArn,
            Subject: 'CRITICAL: Health Check System Failure',
            Message: JSON.stringify(alertMessage, null, 2),
        }));
    }
    catch (alertError) {
        console.error('Failed to send critical alert:', alertError);
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaGVhbHRoLWNoZWNrLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiaGVhbHRoLWNoZWNrLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUNBLDhEQUFnRjtBQUNoRixrREFBaUU7QUFDakUsb0RBQTJFO0FBQzNFLGtFQUFrRztBQUNsRyxvREFBZ0U7QUFzQnpELE1BQU0sT0FBTyxHQUFHLEtBQUssRUFBRSxLQUFxQixFQUFFLE9BQWdCLEVBQWlCLEVBQUU7SUFDdEYsT0FBTyxDQUFDLEdBQUcsQ0FBQyxpQ0FBaUMsQ0FBQyxDQUFDO0lBRS9DLE1BQU0sWUFBWSxHQUFpQztRQUNqRCxtQkFBbUIsRUFBRTtRQUNyQixhQUFhLEVBQUU7UUFDZixjQUFjLEVBQUU7UUFDaEIscUJBQXFCLEVBQUU7UUFDdkIsaUJBQWlCLEVBQUU7UUFDbkIsc0JBQXNCLEVBQUU7S0FDekIsQ0FBQztJQUVGLElBQUk7UUFDRixNQUFNLE9BQU8sR0FBRyxNQUFNLE9BQU8sQ0FBQyxVQUFVLENBQUMsWUFBWSxDQUFDLENBQUM7UUFDdkQsTUFBTSxhQUFhLEdBQXdCLE9BQU8sQ0FBQyxHQUFHLENBQUMsQ0FBQyxNQUFNLEVBQUUsS0FBSyxFQUFFLEVBQUU7WUFDdkUsSUFBSSxNQUFNLENBQUMsTUFBTSxLQUFLLFdBQVcsRUFBRTtnQkFDakMsT0FBTyxNQUFNLENBQUMsS0FBSyxDQUFDO2FBQ3JCO2lCQUFNO2dCQUNMLE9BQU87b0JBQ0wsT0FBTyxFQUFFLENBQUMsVUFBVSxFQUFFLElBQUksRUFBRSxLQUFLLEVBQUUsWUFBWSxDQUFDLENBQUMsS0FBSyxDQUFDO29CQUN2RCxNQUFNLEVBQUUsV0FBb0I7b0JBQzVCLFlBQVksRUFBRSxDQUFDO29CQUNmLEtBQUssRUFBRSxNQUFNLENBQUMsTUFBTSxFQUFFLE9BQU8sSUFBSSxlQUFlO2lCQUNqRCxDQUFDO2FBQ0g7UUFDSCxDQUFDLENBQUMsQ0FBQztRQUVILE1BQU0sTUFBTSxHQUFHLG9CQUFvQixDQUFDLGFBQWEsQ0FB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QUUsS0FBSyxDQUFDLEtBQUs7YUFDbkI7U0FDRixDQUFDO1FBRUYsTUFBTSxNQUFNLENBQUMsSUFBSSxDQUFDLElBQUksMkJBQWMsQ0FBQztZQUNuQyxRQUFRLEVBQUUsYUFBYTtZQUN2QixPQUFPLEVBQUUsdUNBQXVDO1lBQ2hELE9BQU8sRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFDLFlBQVksRUFBRSxJQUFJLEVBQUUsQ0FBQyxDQUFDO1NBQy9DLENBQUMsQ0FBQyxDQUFDO0tBQ0w7SUFBQyxPQUFPLFVBQVUsRUFBRTtRQUNuQixPQUFPLENBQUMsS0FBSyxDQUFDLGdDQUFnQyxFQUFFLFVBQVUsQ0FBQyxDQUFDO0tBQzdEO0FBQ0gsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IFNjaGVkdWxlZEV2ZW50LCBDb250ZXh0IH0gZnJvbSAnYXdzLWxhbWJkYSc7XHJcbmltcG9ydCB7IER5bmFtb0RCQ2xpZW50LCBEZXNjcmliZVRhYmxlQ29tbWFuZCB9IGZyb20gJ0Bhd3Mtc2RrL2NsaWVudC1keW5hbW9kYic7XHJcbmltcG9ydCB7IFMzQ2xpZW50LCBIZWFkQnVja2V0Q29tbWFuZCB9IGZyb20gJ0Bhd3Mtc2RrL2NsaWVudC1zMyc7XHJcbmltcG9ydCB7IFNRU0NsaWVudCwgR2V0UXVldWVBdHRyaWJ1dGVzQ29tbWFuZCB9IGZyb20gJ0Bhd3Mtc2RrL2NsaWVudC1zcXMnO1xyXG5pbXBvcnQgeyBDbG91ZFdhdGNoQ2xpZW50LCBQdXRNZXRyaWNEYXRhQ29tbWFuZCwgU3RhbmRhcmRVbml0IH0gZnJvbSAnQGF3cy1zZGsvY2xpZW50LWNsb3Vkd2F0Y2gnO1xyXG5pbXBvcnQgeyBTTlNDbGllbnQsIFB1Ymxpc2hDb21tYW5kIH0gZnJvbSAnQGF3cy1zZGsvY2xpZW50LXNucyc7XHJcblxyXG5pbnRlcmZhY2UgSGVhbHRoQ2hlY2tSZXN1bHQge1xyXG4gIHNlcnZpY2U6IHN0cmluZztcclxuICBzdGF0dXM6ICdoZWFsdGh5JyB8ICd1bmhlYWx0aHknIHwgJ2RlZ3JhZGVkJztcclxuICByZXNwb25zZVRpbWU6IG51bWJlcjtcclxuICBlcnJvcj86IHN0cmluZztcclxuICBkZXRhaWxzPzogUmVjb3JkPHN0cmluZywgYW55PjtcclxufVxyXG5cclxuaW50ZXJmYWNlIFN5c3RlbUhlYWx0aFJlcG9ydCB7XHJcbiAgdGltZXN0YW1wOiBzdHJpbmc7XHJcbiAgb3ZlcmFsbFN0YXR1czogJ2hlYWx0aHknIHwgJ3VuaGVhbHRoeScgfCAnZGVncmFkZWQnO1xyXG4gIHNlcnZpY2VzOiBIZWFsdGhDaGVja1Jlc3VsdFtdO1xyXG4gIHN1bW1hcnk6IHtcclxuICAgIHRvdGFsU2VydmljZXM6IG51bWJlcjtcclxuICAgIGhlYWx0aHlTZXJ2aWNlczogbnVtYmVyO1xyXG4gICAgdW5oZWFsdGh5U2VydmljZXM6IG51bWJlcjtcclxuICAgIGRlZ3JhZGVkU2VydmljZXM6IG51bWJlcjtcclxuICB9O1xyXG59XHJcblxyXG5leHBvcnQgY29uc3QgaGFuZGxlciA9IGFzeW5jIChldmVudDogU2NoZWR1bGVkRXZlbnQsIGNvbnRleHQ6IENvbnRleHQpOiBQcm9taXNlPHZvaWQ+ID0+IHtcclxuICBjb25zb2xlLmxvZygnU3RhcnRpbmcgc3lzdGVtIGhlYWx0aCBjaGVjay4uLicpO1xyXG4gIFxyXG4gIGNvbnN0IGhlYWx0aENoZWNrczogUHJvbWlzZTxIZWFsdGhDaGVja1Jlc3VsdD5bXSA9IFtcclxuICAgIGNoZWNrRHluYW1vREJIZWFsdGgoKSxcclxuICAgIGNoZWNrUzNIZWFsdGgoKSxcclxuICAgIGNoZWNrU1FTSGVhbHRoKCksXHJcbiAgICBjaGVja0FQSUdhdGV3YXlIZWFsdGgoKSxcclxuICAgIGNoZWNrTGFtYmRhSGVhbHRoKCksXHJcbiAgICBjaGVja0V2ZW50QnJpZGdlSGVhbHRoKCksXHJcbiAgXTtcclxuXHJcbiAgdHJ5IHtcclxuICAgIGNvbnN0IHJlc3VsdHMgPSBhd2FpdCBQcm9taXNlLmFsbFNldHRsZWQoaGVhbHRoQ2hlY2tzKTtcclxuICAgIGNvbnN0IGhlYWx0aFJlc3VsdHM6IEhlYWx0aENoZWNrUmVzdWx0W10gPSByZXN1bHRzLm1hcCgocmVzdWx0LCBpbmRleCkgPT4ge1xyXG4gICAgICBpZiAocmVzdWx0LnN0YXR1cyA9PT0gJ2Z1bGZpbGxlZCcpIHtcclxuICAgICAgICByZXR1cm4gcmVzdWx0LnZhbHVlO1xyXG4gICAgICB9IGVsc2Uge1xyXG4gICAgICAgIHJldHVybiB7XHJcbiAgICAgICAgICBzZXJ2aWNlOiBbJ0R5bmFtb0RCJywgJ1MzJywgJ1NRUycsICdBUElHYXRld2F5J11baW5kZXhdLFxyXG4gICAgICAgICAgc3RhdHVzOiAndW5oZWFsdGh5JyBhcyBjb25zdCxcclxuICAgICAgICAgIHJlc3BvbnNlVGltZTogMCxcclxuICAgICAgICAgIGVycm9yOiByZXN1bHQucmVhc29uPy5tZXNzYWdlIHx8ICdVbmtub3duIGVycm9yJyxcclxuICAgICAgICB9O1xyXG4gICAgICB9XHJcbiAgICB9KTtcclxuXHJcbiAgICBjb25zdCByZXBvcnQgPSBnZW5lcmF0ZUhlYWx0aFJlcG9ydChoZWFsdGhSZXN1bHRzKTtcclxuICAgIGF3YWl0IHNlbmRIZWFsdGhNZXRyaWNzKHJlcG9ydCk7XHJcbiAgICBcclxuICAgIGlmIChyZXBvcnQub3ZlcmFsbFN0YXR1cyA9PT0gJ3VuaGVhbHRoeScpIHtcclxuICAgICAgYXdhaXQgc2VuZEhlYWx0aEFsZXJ0KHJlcG9ydCk7XHJcbiAgICB9XHJcblxyXG4gICAgY29uc29sZS5sb2coJ0hlYWx0aCBjaGVjayBjb21wbGV0ZWQ6JywgSlNPTi5zdHJpbmdpZnkocmVwb3J0LCBudWxsLCAyKSk7XHJcbiAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgIGNvbnNvbGUuZXJyb3IoJ0hlYWx0aCBjaGVjayBmYWlsZWQ6JywgZXJyb3IpO1xyXG4gICAgYXdhaXQgc2VuZENyaXRpY2FsQWxlcnQoZXJyb3IgYXMgRXJyb3IpO1xyXG4gIH1cclxufTtcclxuXHJcbmFzeW5jIGZ1bmN0aW9uIGNoZWNrRHluYW1vREJIZWFsdGgoKTogUHJvbWlzZTxIZWFsdGhDaGVja1Jlc3VsdD4ge1xyXG4gIGNvbnN0IGNsaWVudCA9IG5ldyBEeW5hbW9EQkNsaWVudCh7IHJlZ2lvbjogcHJvY2Vzcy5lbnYuQVdTX1JFR0lPTiB9KTtcclxuICBjb25zdCBzdGFydFRpbWUgPSBEYXRlLm5vdygpO1xyXG4gIFxyXG4gIHRyeSB7XHJcbiAgICAvLyBDaGVjayBpZiB3ZSBjYW4gZGVzY3JpYmUgdGFibGVzIChiYXNpYyBjb25uZWN0aXZpdHkgdGVzdClcclxuICAgIGNvbnN0IHRhYmxlcyA9IFtcclxuICAgICAgcHJvY2Vzcy5lbnYuQ09OVEVOVF9UQUJMRV9OQU1FLFxyXG4gICAgICBwcm9jZXNzLmVudi5VU0VSX1RBQkxFX05BTUUsXHJcbiAgICAgIHByb2Nlc3MuZW52LkFHRU5UX01FU1NBR0VTX1RBQkxFX05BTUUsXHJcbiAgICBdLmZpbHRlcihCb29sZWFuKTtcclxuXHJcbiAgICBjb25zdCB0YWJsZUNoZWNrcyA9IHRhYmxlcy5tYXAoYXN5bmMgKHRhYmxlTmFtZSkgPT4ge1xyXG4gICAgICBjb25zdCBjb21tYW5kID0gbmV3IERlc2NyaWJlVGFibGVDb21tYW5kKHsgVGFibGVOYW1lOiB0YWJsZU5hbWUgfSk7XHJcbiAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgY2xpZW50LnNlbmQoY29tbWFuZCk7XHJcbiAgICAgIHJldHVybiB7XHJcbiAgICAgICAgdGFibGVOYW1lLFxyXG4gICAgICAgIHN0YXR1czogcmVzcG9uc2UuVGFibGU/LlRhYmxlU3RhdHVzLFxyXG4gICAgICAgIGl0ZW1Db3VudDogcmVzcG9uc2UuVGFibGU/Lkl0ZW1Db3VudCxcclxuICAgICAgfTtcclxuICAgIH0pO1xyXG5cclxuICAgIGNvbnN0IHRhYmxlUmVzdWx0cyA9IGF3YWl0IFByb21pc2UuYWxsKHRhYmxlQ2hlY2tzKTtcclxuICAgIGNvbnN0IHJlc3BvbnNlVGltZSA9IERhdGUubm93KCkgLSBzdGFydFRpbWU7XHJcbiAgICBcclxuICAgIGNvbnN0IHVuaGVhbHRoeVRhYmxlcyA9IHRhYmxlUmVzdWx0cy5maWx0ZXIodGFibGUgPT4gXHJcbiAgICAgIHRhYmxlLnN0YXR1cyAhPT0gJ0FDVElWRSdcclxuICAgICk7XHJcblxyXG4gICAgcmV0dXJuIHtcclxuICAgICAgc2VydmljZTogJ0R5bmFtb0RCJyxcclxuICAgICAgc3RhdHVzOiB1bmhlYWx0aHlUYWJsZXMubGVuZ3RoID4gMCA/ICdkZWdyYWRlZCcgOiAnaGVhbHRoeScsXHJcbiAgICAgIHJlc3BvbnNlVGltZSxcclxuICAgICAgZGV0YWlsczoge1xyXG4gICAgICAgIHRhYmxlczogdGFibGVSZXN1bHRzLFxyXG4gICAgICAgIHVuaGVhbHRoeVRhYmxlczogdW5oZWFsdGh5VGFibGVzLmxlbmd0aCxcclxuICAgICAgfSxcclxuICAgIH07XHJcbiAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgIHJldHVybiB7XHJcbiAgICAgIHNlcnZpY2U6ICdEeW5hbW9EQicsXHJcbiAgICAgIHN0YXR1czogJ3VuaGVhbHRoeScsXHJcbiAgICAgIHJlc3BvbnNlVGltZTogRGF0ZS5ub3coKSAtIHN0YXJ0VGltZSxcclxuICAgICAgZXJyb3I6IChlcnJvciBhcyBFcnJvcikubWVzc2FnZSxcclxuICAgIH07XHJcbiAgfVxyXG59XHJcblxyXG5hc3luYyBmdW5jdGlvbiBjaGVja1MzSGVhbHRoKCk6IFByb21pc2U8SGVhbHRoQ2hlY2tSZXN1bHQ+IHtcclxuICBjb25zdCBjbGllbnQgPSBuZXcgUzNDbGllbnQoeyByZWdpb246IHByb2Nlc3MuZW52LkFXU19SRUdJT04gfSk7XHJcbiAgY29uc3Qgc3RhcnRUaW1lID0gRGF0ZS5ub3coKTtcclxuICBcclxuICB0cnkge1xyXG4gICAgY29uc3QgYnVja2V0cyA9IFtcclxuICAgICAgcHJvY2Vzcy5lbnYuQVVESU9fQlVDS0VUX05BTUUsXHJcbiAgICAgIHByb2Nlc3MuZW52LklNQUdFX0JVQ0tFVF9OQU1FLFxyXG4gICAgXS5maWx0ZXIoQm9vbGVhbik7XHJcblxyXG4gICAgY29uc3QgYnVja2V0Q2hlY2tzID0gYnVja2V0cy5tYXAoYXN5bmMgKGJ1Y2tldE5hbWUpID0+IHtcclxuICAgICAgY29uc3QgY29tbWFuZCA9IG5ldyBIZWFkQnVja2V0Q29tbWFuZCh7IEJ1Y2tldDogYnVja2V0TmFtZSB9KTtcclxuICAgICAgYXdhaXQgY2xpZW50LnNlbmQoY29tbWFuZCk7XHJcbiAgICAgIHJldHVybiB7IGJ1Y2tldE5hbWUsIGFjY2Vzc2libGU6IHRydWUgfTtcclxuICAgIH0pO1xyXG5cclxuICAgIGNvbnN0IGJ1Y2tldFJlc3VsdHMgPSBhd2FpdCBQcm9taXNlLmFsbChidWNrZXRDaGVja3MpO1xyXG4gICAgY29uc3QgcmVzcG9uc2VUaW1lID0gRGF0ZS5ub3coKSAtIHN0YXJ0VGltZTtcclxuXHJcbiAgICByZXR1cm4ge1xyXG4gICAgICBzZXJ2aWNlOiAnUzMnLFxyXG4gICAgICBzdGF0dXM6ICdoZWFsdGh5JyxcclxuICAgICAgcmVzcG9uc2VUaW1lLFxyXG4gICAgICBkZXRhaWxzOiB7XHJcbiAgICAgICAgYnVja2V0czogYnVja2V0UmVzdWx0cyxcclxuICAgICAgfSxcclxuICAgIH07XHJcbiAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgIHJldHVybiB7XHJcbiAgICAgIHNlcnZpY2U6ICdTMycsXHJcbiAgICAgIHN0YXR1czogJ3VuaGVhbHRoeScsXHJcbiAgICAgIHJlc3BvbnNlVGltZTogRGF0ZS5ub3coKSAtIHN0YXJ0VGltZSxcclxuICAgICAgZXJyb3I6IChlcnJvciBhcyBFcnJvcikubWVzc2FnZSxcclxuICAgIH07XHJcbiAgfVxyXG59XHJcblxyXG5hc3luYyBmdW5jdGlvbiBjaGVja1NRU0hlYWx0aCgpOiBQcm9taXNlPEhlYWx0aENoZWNrUmVzdWx0PiB7XHJcbiAgY29uc3QgY2xpZW50ID0gbmV3IFNRU0NsaWVudCh7IHJlZ2lvbjogcHJvY2Vzcy5lbnYuQVdTX1JFR0lPTiB9KTtcclxuICBjb25zdCBzdGFydFRpbWUgPSBEYXRlLm5vdygpO1xyXG4gIFxyXG4gIHRyeSB7XHJcbiAgICBjb25zdCBxdWV1ZXMgPSBbXHJcbiAgICAgIHByb2Nlc3MuZW52LkFHRU5UX1FVRVVFX1VSTCxcclxuICAgICAgcHJvY2Vzcy5lbnYuQ09OVEVOVF9HRU5FUkFUSU9OX1FVRVVFX1VSTCxcclxuICAgICAgcHJvY2Vzcy5lbnYuSU1BR0VfR0VORVJBVElPTl9RVUVVRV9VUkwsXHJcbiAgICAgIHByb2Nlc3MuZW52LlBVQkxJU0hJTkdfUVVFVUVfVVJMLFxyXG4gICAgXS5maWx0ZXIoQm9vbGVhbik7XHJcblxyXG4gICAgY29uc3QgcXVldWVDaGVja3MgPSBxdWV1ZXMubWFwKGFzeW5jIChxdWV1ZVVybCkgPT4ge1xyXG4gICAgICBjb25zdCBjb21tYW5kID0gbmV3IEdldFF1ZXVlQXR0cmlidXRlc0NvbW1hbmQoe1xyXG4gICAgICAgIFF1ZXVlVXJsOiBxdWV1ZVVybCxcclxuICAgICAgICBBdHRyaWJ1dGVOYW1lczogWydBcHByb3hpbWF0ZU51bWJlck9mTWVzc2FnZXMnLCAnQXBwcm94aW1hdGVOdW1iZXJPZk1lc3NhZ2VzTm90VmlzaWJsZSddLFxyXG4gICAgICB9KTtcclxuICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBjbGllbnQuc2VuZChjb21tYW5kKTtcclxuICAgICAgXHJcbiAgICAgIGNvbnN0IHZpc2libGVNZXNzYWdlcyA9IHBhcnNlSW50KHJlc3BvbnNlLkF0dHJpYnV0ZXM/LkFwcHJveGltYXRlTnVtYmVyT2ZNZXNzYWdlcyB8fCAnMCcpO1xyXG4gICAgICBjb25zdCBpbnZpc2libGVNZXNzYWdlcyA9IHBhcnNlSW50KHJlc3BvbnNlLkF0dHJpYnV0ZXM/LkFwcHJveGltYXRlTnVtYmVyT2ZNZXNzYWdlc05vdFZpc2libGUgfHwgJzAnKTtcclxuICAgICAgXHJcbiAgICAgIHJldHVybiB7XHJcbiAgICAgICAgcXVldWVVcmwsXHJcbiAgICAgICAgdmlzaWJsZU1lc3NhZ2VzLFxyXG4gICAgICAgIGludmlzaWJsZU1lc3NhZ2VzLFxyXG4gICAgICAgIHRvdGFsTWVzc2FnZXM6IHZpc2libGVNZXNzYWdlcyArIGludmlzaWJsZU1lc3NhZ2VzLFxyXG4gICAgICB9O1xyXG4gICAgfSk7XHJcblxyXG4gICAgY29uc3QgcXVldWVSZXN1bHRzID0gYXdhaXQgUHJvbWlzZS5hbGwocXVldWVDaGVja3MpO1xyXG4gICAgY29uc3QgcmVzcG9uc2VUaW1lID0gRGF0ZS5ub3coKSAtIHN0YXJ0VGltZTtcclxuICAgIFxyXG4gICAgLy8gQ2hlY2sgZm9yIHF1ZXVlcyB3aXRoIHRvbyBtYW55IG1lc3NhZ2VzIChwb3RlbnRpYWwgYmFja2xvZylcclxuICAgIGNvbnN0IGJhY2tsb2dnZWRRdWV1ZXMgPSBxdWV1ZVJlc3VsdHMuZmlsdGVyKHF1ZXVlID0+IHF1ZXVlLnRvdGFsTWVzc2FnZXMgPiAxMDApO1xyXG4gICAgXHJcbiAgICByZXR1cm4ge1xyXG4gICAgICBzZXJ2aWNlOiAnU1FTJyxcclxuICAgICAgc3RhdHVzOiBiYWNrbG9nZ2VkUXVldWVzLmxlbmd0aCA+IDAgPyAnZGVncmFkZWQnIDogJ2hlYWx0aHknLFxyXG4gICAgICByZXNwb25zZVRpbWUsXHJcbiAgICAgIGRldGFpbHM6IHtcclxuICAgICAgICBxdWV1ZXM6IHF1ZXVlUmVzdWx0cyxcclxuICAgICAgICBiYWNrbG9nZ2VkUXVldWVzOiBiYWNrbG9nZ2VkUXVldWVzLmxlbmd0aCxcclxuICAgICAgfSxcclxuICAgIH07XHJcbiAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgIHJldHVybiB7XHJcbiAgICAgIHNlcnZpY2U6ICdTUVMnLFxyXG4gICAgICBzdGF0dXM6ICd1bmhlYWx0aHknLFxyXG4gICAgICByZXNwb25zZVRpbWU6IERhdGUubm93KCkgLSBzdGFydFRpbWUsXHJcbiAgICAgIGVycm9yOiAoZXJyb3IgYXMgRXJyb3IpLm1lc3NhZ2UsXHJcbiAgICB9O1xyXG4gIH1cclxufVxyXG5cclxuYXN5bmMgZnVuY3Rpb24gY2hlY2tBUElHYXRld2F5SGVhbHRoKCk6IFByb21pc2U8SGVhbHRoQ2hlY2tSZXN1bHQ+IHtcclxuICBjb25zdCBzdGFydFRpbWUgPSBEYXRlLm5vdygpO1xyXG4gIFxyXG4gIHRyeSB7XHJcbiAgICAvLyBTaW1wbGUgY29ubmVjdGl2aXR5IHRlc3QgLSB3ZSBjYW4ndCBlYXNpbHkgdGVzdCBBUEkgR2F0ZXdheSBmcm9tIExhbWJkYVxyXG4gICAgLy8gd2l0aG91dCBtYWtpbmcgSFRUUCByZXF1ZXN0cywgc28gd2UnbGwganVzdCBjaGVjayBpZiB3ZSBjYW4gcmVzb2x2ZSBETlNcclxuICAgIGNvbnN0IGFwaVVybCA9IHByb2Nlc3MuZW52LkFQSV9HQVRFV0FZX1VSTDtcclxuICAgIGlmICghYXBpVXJsKSB7XHJcbiAgICAgIHJldHVybiB7XHJcbiAgICAgICAgc2VydmljZTogJ0FQSUdhdGV3YXknLFxyXG4gICAgICAgIHN0YXR1czogJ2RlZ3JhZGVkJyxcclxuICAgICAgICByZXNwb25zZVRpbWU6IERhdGUubm93KCkgLSBzdGFydFRpbWUsXHJcbiAgICAgICAgZXJyb3I6ICdBUEkgR2F0ZXdheSBVUkwgbm90IGNvbmZpZ3VyZWQnLFxyXG4gICAgICB9O1xyXG4gICAgfVxyXG5cclxuICAgIHJldHVybiB7XHJcbiAgICAgIHNlcnZpY2U6ICdBUElHYXRld2F5JyxcclxuICAgICAgc3RhdHVzOiAnaGVhbHRoeScsXHJcbiAgICAgIHJlc3BvbnNlVGltZTogRGF0ZS5ub3coKSAtIHN0YXJ0VGltZSxcclxuICAgICAgZGV0YWlsczoge1xyXG4gICAgICAgIHVybDogYXBpVXJsLFxyXG4gICAgICAgIG5vdGU6ICdCYXNpYyBjb25maWd1cmF0aW9uIGNoZWNrIG9ubHknLFxyXG4gICAgICB9LFxyXG4gICAgfTtcclxuICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgcmV0dXJuIHtcclxuICAgICAgc2VydmljZTogJ0FQSUdhdGV3YXknLFxyXG4gICAgICBzdGF0dXM6ICd1bmhlYWx0aHknLFxyXG4gICAgICByZXNwb25zZVRpbWU6IERhdGUubm93KCkgLSBzdGFydFRpbWUsXHJcbiAgICAgIGVycm9yOiAoZXJyb3IgYXMgRXJyb3IpLm1lc3NhZ2UsXHJcbiAgICB9O1xyXG4gIH1cclxufVxyXG5cclxuZnVuY3Rpb24gZ2VuZXJhdGVIZWFsdGhSZXBvcnQocmVzdWx0czogSGVhbHRoQ2hlY2tSZXN1bHRbXSk6IFN5c3RlbUhlYWx0aFJlcG9ydCB7XHJcbiAgY29uc3Qgc3VtbWFyeSA9IHtcclxuICAgIHRvdGFsU2VydmljZXM6IHJlc3VsdHMubGVuZ3RoLFxyXG4gICAgaGVhbHRoeVNlcnZpY2VzOiByZXN1bHRzLmZpbHRlcihyID0+IHIuc3RhdHVzID09PSAnaGVhbHRoeScpLmxlbmd0aCxcclxuICAgIHVuaGVhbHRoeVNlcnZpY2VzOiByZXN1bHRzLmZpbHRlcihyID0+IHIuc3RhdHVzID09PSAndW5oZWFsdGh5JykubGVuZ3RoLFxyXG4gICAgZGVncmFkZWRTZXJ2aWNlczogcmVzdWx0cy5maWx0ZXIociA9PiByLnN0YXR1cyA9PT0gJ2RlZ3JhZGVkJykubGVuZ3RoLFxyXG4gIH07XHJcblxyXG4gIGxldCBvdmVyYWxsU3RhdHVzOiAnaGVhbHRoeScgfCAndW5oZWFsdGh5JyB8ICdkZWdyYWRlZCcgPSAnaGVhbHRoeSc7XHJcbiAgXHJcbiAgaWYgKHN1bW1hcnkudW5oZWFsdGh5U2VydmljZXMgPiAwKSB7XHJcbiAgICBvdmVyYWxsU3RhdHVzID0gJ3VuaGVhbHRoeSc7XHJcbiAgfSBlbHNlIGlmIChzdW1tYXJ5LmRlZ3JhZGVkU2VydmljZXMgPiAwKSB7XHJcbiAgICBvdmVyYWxsU3RhdHVzID0gJ2RlZ3JhZGVkJztcclxuICB9XHJcblxyXG4gIHJldHVybiB7XHJcbiAgICB0aW1lc3RhbXA6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcclxuICAgIG92ZXJhbGxTdGF0dXMsXHJcbiAgICBzZXJ2aWNlczogcmVzdWx0cyxcclxuICAgIHN1bW1hcnksXHJcbiAgfTtcclxufVxyXG5cclxuYXN5bmMgZnVuY3Rpb24gc2VuZEhlYWx0aE1ldHJpY3MocmVwb3J0OiBTeXN0ZW1IZWFsdGhSZXBvcnQpOiBQcm9taXNlPHZvaWQ+IHtcclxuICBjb25zdCBjbGllbnQgPSBuZXcgQ2xvdWRXYXRjaENsaWVudCh7IHJlZ2lvbjogcHJvY2Vzcy5lbnYuQVdTX1JFR0lPTiB9KTtcclxuICBcclxuICB0cnkge1xyXG4gICAgY29uc3QgbWV0cmljRGF0YSA9IFtcclxuICAgICAge1xyXG4gICAgICAgIE1ldHJpY05hbWU6ICdIZWFsdGhDaGVja1N1Y2Nlc3MnLFxyXG4gICAgICAgIFZhbHVlOiByZXBvcnQub3ZlcmFsbFN0YXR1cyA9PT0gJ2hlYWx0aHknID8gMSA6IDAsXHJcbiAgICAgICAgVW5pdDogU3RhbmRhcmRVbml0LkNvdW50LFxyXG4gICAgICAgIFRpbWVzdGFtcDogbmV3IERhdGUoKSxcclxuICAgICAgfSxcclxuICAgICAge1xyXG4gICAgICAgIE1ldHJpY05hbWU6ICdIZWFsdGhDaGVja0ZhaWx1cmUnLFxyXG4gICAgICAgIFZhbHVlOiByZXBvcnQub3ZlcmFsbFN0YXR1cyA9PT0gJ3VuaGVhbHRoeScgPyAxIDogMCxcclxuICAgICAgICBVbml0OiBTdGFuZGFyZFVuaXQuQ291bnQsXHJcbiAgICAgICAgVGltZXN0YW1wOiBuZXcgRGF0ZSgpLFxyXG4gICAgICB9LFxyXG4gICAgICB7XHJcbiAgICAgICAgTWV0cmljTmFtZTogJ0hlYWx0aHlTZXJ2aWNlcycsXHJcbiAgICAgICAgVmFsdWU6IHJlcG9ydC5zdW1tYXJ5LmhlYWx0aHlTZXJ2aWNlcyxcclxuICAgICAgICBVbml0OiBTdGFuZGFyZFVuaXQuQ291bnQsXHJcbiAgICAgICAgVGltZXN0YW1wOiBuZXcgRGF0ZSgpLFxyXG4gICAgICB9LFxyXG4gICAgICB7XHJcbiAgICAgICAgTWV0cmljTmFtZTogJ1VuaGVhbHRoeVNlcnZpY2VzJyxcclxuICAgICAgICBWYWx1ZTogcmVwb3J0LnN1bW1hcnkudW5oZWFsdGh5U2VydmljZXMsXHJcbiAgICAgICAgVW5pdDogU3RhbmRhcmRVbml0LkNvdW50LFxyXG4gICAgICAgIFRpbWVzdGFtcDogbmV3IERhdGUoKSxcclxuICAgICAgfSxcclxuICAgIF07XHJcblxyXG4gICAgLy8gQWRkIGluZGl2aWR1YWwgc2VydmljZSBtZXRyaWNzXHJcbiAgICByZXBvcnQuc2VydmljZXMuZm9yRWFjaChzZXJ2aWNlID0+IHtcclxuICAgICAgbWV0cmljRGF0YS5wdXNoKHtcclxuICAgICAgICBNZXRyaWNOYW1lOiAnU2VydmljZVJlc3BvbnNlVGltZScsXHJcbiAgICAgICAgVmFsdWU6IHNlcnZpY2UucmVzcG9uc2VUaW1lLFxyXG4gICAgICAgIFVuaXQ6IFN0YW5kYXJkVW5pdC5NaWxsaXNlY29uZHMsXHJcbiAgICAgICAgRGltZW5zaW9uczogW3sgTmFtZTogJ1NlcnZpY2UnLCBWYWx1ZTogc2VydmljZS5zZXJ2aWNlIH1dLFxyXG4gICAgICAgIFRpbWVzdGFtcDogbmV3IERhdGUoKSxcclxuICAgICAgfSk7XHJcbiAgICAgIFxyXG4gICAgICBtZXRyaWNEYXRhLnB1c2goe1xyXG4gICAgICAgIE1ldHJpY05hbWU6ICdTZXJ2aWNlSGVhbHRoJyxcclxuICAgICAgICBWYWx1ZTogc2VydmljZS5zdGF0dXMgPT09ICdoZWFsdGh5JyA/IDEgOiAwLFxyXG4gICAgICAgIFVuaXQ6IFN0YW5kYXJkVW5pdC5Db3VudCxcclxuICAgICAgICBEaW1lbnNpb25zOiBbeyBOYW1lOiAnU2VydmljZScsIFZhbHVlOiBzZXJ2aWNlLnNlcnZpY2UgfV0sXHJcbiAgICAgICAgVGltZXN0YW1wOiBuZXcgRGF0ZSgpLFxyXG4gICAgICB9KTtcclxuICAgIH0pO1xyXG5cclxuICAgIGF3YWl0IGNsaWVudC5zZW5kKG5ldyBQdXRNZXRyaWNEYXRhQ29tbWFuZCh7XHJcbiAgICAgIE5hbWVzcGFjZTogJ0F1dG9tYXRlZEJsb2dQb3N0ZXIvSGVhbHRoQ2hlY2snLFxyXG4gICAgICBNZXRyaWNEYXRhOiBtZXRyaWNEYXRhLFxyXG4gICAgfSkpO1xyXG4gIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICBjb25zb2xlLmVycm9yKCdGYWlsZWQgdG8gc2VuZCBoZWFsdGggbWV0cmljczonLCBlcnJvcik7XHJcbiAgfVxyXG59XHJcblxyXG5hc3luYyBmdW5jdGlvbiBzZW5kSGVhbHRoQWxlcnQocmVwb3J0OiBTeXN0ZW1IZWFsdGhSZXBvcnQpOiBQcm9taXNlPHZvaWQ+IHtcclxuICBjb25zdCBhbGVydFRvcGljQXJuID0gcHJvY2Vzcy5lbnYuQUxFUlRfVE9QSUNfQVJOO1xyXG4gIGlmICghYWxlcnRUb3BpY0Fybikge1xyXG4gICAgY29uc29sZS53YXJuKCdBbGVydCB0b3BpYyBBUk4gbm90IGNvbmZpZ3VyZWQsIHNraXBwaW5nIGhlYWx0aCBhbGVydCcpO1xyXG4gICAgcmV0dXJuO1xyXG4gIH1cclxuXHJcbiAgY29uc3QgY2xpZW50ID0gbmV3IFNOU0NsaWVudCh7IHJlZ2lvbjogcHJvY2Vzcy5lbnYuQVdTX1JFR0lPTiB9KTtcclxuICBcclxuICB0cnkge1xyXG4gICAgY29uc3QgYWxlcnRNZXNzYWdlID0ge1xyXG4gICAgICB0aW1lc3RhbXA6IHJlcG9ydC50aW1lc3RhbXAsXHJcbiAgICAgIHNldmVyaXR5OiByZXBvcnQub3ZlcmFsbFN0YXR1cyA9PT0gJ3VuaGVhbHRoeScgPyAnQ1JJVElDQUwnIDogJ1dBUk5JTkcnLFxyXG4gICAgICBzZXJ2aWNlOiAnQXV0b21hdGVkQmxvZ1Bvc3RlcicsXHJcbiAgICAgIHR5cGU6ICdIZWFsdGhDaGVjaycsXHJcbiAgICAgIHN1bW1hcnk6IGBTeXN0ZW0gaGVhbHRoIGlzICR7cmVwb3J0Lm92ZXJhbGxTdGF0dXMudG9VcHBlckNhc2UoKX1gLFxyXG4gICAgICBkZXRhaWxzOiByZXBvcnQsXHJcbiAgICB9O1xyXG5cclxuICAgIGF3YWl0IGNsaWVudC5zZW5kKG5ldyBQdWJsaXNoQ29tbWFuZCh7XHJcbiAgICAgIFRvcGljQXJuOiBhbGVydFRvcGljQXJuLFxyXG4gICAgICBTdWJqZWN0OiBgJHtyZXBvcnQub3ZlcmFsbFN0YXR1cy50b1VwcGVyQ2FzZSgpfTogU3lzdGVtIEhlYWx0aCBBbGVydGAsXHJcbiAgICAgIE1lc3NhZ2U6IEpTT04uc3RyaW5naWZ5KGFsZXJ0TWVzc2FnZSwgbnVsbCwgMiksXHJcbiAgICB9KSk7XHJcbiAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgIGNvbnNvbGUuZXJyb3IoJ0ZhaWxlZCB0byBzZW5kIGhlYWx0aCBhbGVydDonLCBlcnJvcik7XHJcbiAgfVxyXG59XHJcblxyXG5hc3luYyBmdW5jdGlvbiBjaGVja0xhbWJkYUhlYWx0aCgpOiBQcm9taXNlPEhlYWx0aENoZWNrUmVzdWx0PiB7XHJcbiAgY29uc3Qgc3RhcnRUaW1lID0gRGF0ZS5ub3coKTtcclxuICBcclxuICB0cnkge1xyXG4gICAgLy8gQ2hlY2sgTGFtYmRhIGZ1bmN0aW9uIGhlYWx0aCBieSB0ZXN0aW5nIGJhc2ljIGZ1bmN0aW9uYWxpdHlcclxuICAgIGNvbnN0IHRlc3REYXRhID0geyB0ZXN0OiAnaGVhbHRoLWNoZWNrJywgdGltZXN0YW1wOiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCkgfTtcclxuICAgIGNvbnN0IHRlc3RSZXN1bHQgPSBKU09OLnN0cmluZ2lmeSh0ZXN0RGF0YSk7XHJcbiAgICBcclxuICAgIGlmICghdGVzdFJlc3VsdC5pbmNsdWRlcygnaGVhbHRoLWNoZWNrJykpIHtcclxuICAgICAgdGhyb3cgbmV3IEVycm9yKCdMYW1iZGEgZnVuY3Rpb24gYmFzaWMgb3BlcmF0aW9ucyBmYWlsZWQnKTtcclxuICAgIH1cclxuXHJcbiAgICBjb25zdCByZXNwb25zZVRpbWUgPSBEYXRlLm5vdygpIC0gc3RhcnRUaW1lO1xyXG4gICAgXHJcbiAgICByZXR1cm4ge1xyXG4gICAgICBzZXJ2aWNlOiAnTGFtYmRhJyxcclxuICAgICAgc3RhdHVzOiAnaGVhbHRoeScsXHJcbiAgICAgIHJlc3BvbnNlVGltZSxcclxuICAgICAgZGV0YWlsczoge1xyXG4gICAgICAgIG1lbW9yeVVzZWQ6IHByb2Nlc3MubWVtb3J5VXNhZ2UoKSxcclxuICAgICAgICB1cHRpbWU6IHByb2Nlc3MudXB0aW1lKCksXHJcbiAgICAgICAgbm9kZVZlcnNpb246IHByb2Nlc3MudmVyc2lvbixcclxuICAgICAgfSxcclxuICAgIH07XHJcbiAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgIHJldHVybiB7XHJcbiAgICAgIHNlcnZpY2U6ICdMYW1iZGEnLFxyXG4gICAgICBzdGF0dXM6ICd1bmhlYWx0aHknLFxyXG4gICAgICByZXNwb25zZVRpbWU6IERhdGUubm93KCkgLSBzdGFydFRpbWUsXHJcbiAgICAgIGVycm9yOiAoZXJyb3IgYXMgRXJyb3IpLm1lc3NhZ2UsXHJcbiAgICB9O1xyXG4gIH1cclxufVxyXG5cclxuYXN5bmMgZnVuY3Rpb24gY2hlY2tFdmVudEJyaWRnZUhlYWx0aCgpOiBQcm9taXNlPEhlYWx0aENoZWNrUmVzdWx0PiB7XHJcbiAgY29uc3Qgc3RhcnRUaW1lID0gRGF0ZS5ub3coKTtcclxuICBcclxuICB0cnkge1xyXG4gICAgLy8gVGVzdCBFdmVudEJyaWRnZSBjb25uZWN0aXZpdHkgYnkgYXR0ZW1wdGluZyB0byBwdXQgYSB0ZXN0IGV2ZW50XHJcbiAgICBjb25zdCBldmVudEJ1c05hbWUgPSBwcm9jZXNzLmVudi5FVkVOVF9CVVNfTkFNRTtcclxuICAgIGlmICghZXZlbnRCdXNOYW1lKSB7XHJcbiAgICAgIHJldHVybiB7XHJcbiAgICAgICAgc2VydmljZTogJ0V2ZW50QnJpZGdlJyxcclxuICAgICAgICBzdGF0dXM6ICdkZWdyYWRlZCcsXHJcbiAgICAgICAgcmVzcG9uc2VUaW1lOiBEYXRlLm5vdygpIC0gc3RhcnRUaW1lLFxyXG4gICAgICAgIGVycm9yOiAnRXZlbnRCcmlkZ2UgYnVzIG5hbWUgbm90IGNvbmZpZ3VyZWQnLFxyXG4gICAgICB9O1xyXG4gICAgfVxyXG5cclxuICAgIC8vIFdlIGNhbid0IGVhc2lseSB0ZXN0IEV2ZW50QnJpZGdlIHdpdGhvdXQgYWN0dWFsbHkgc2VuZGluZyBldmVudHNcclxuICAgIC8vIFNvIHdlJ2xsIGp1c3QgdmVyaWZ5IHRoZSBjb25maWd1cmF0aW9uIGlzIHByZXNlbnRcclxuICAgIHJldHVybiB7XHJcbiAgICAgIHNlcnZpY2U6ICdFdmVudEJyaWRnZScsXHJcbiAgICAgIHN0YXR1czogJ2hlYWx0aHknLFxyXG4gICAgICByZXNwb25zZVRpbWU6IERhdGUubm93KCkgLSBzdGFydFRpbWUsXHJcbiAgICAgIGRldGFpbHM6IHtcclxuICAgICAgICBldmVudEJ1c05hbWUsXHJcbiAgICAgICAgbm90ZTogJ0NvbmZpZ3VyYXRpb24gY2hlY2sgb25seScsXHJcbiAgICAgIH0sXHJcbiAgICB9O1xyXG4gIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICByZXR1cm4ge1xyXG4gICAgICBzZXJ2aWNlOiAnRXZlbnRCcmlkZ2UnLFxyXG4gICAgICBzdGF0dXM6ICd1bmhlYWx0aHknLFxyXG4gICAgICByZXNwb25zZVRpbWU6IERhdGUubm93KCkgLSBzdGFydFRpbWUsXHJcbiAgICAgIGVycm9yOiAoZXJyb3IgYXMgRXJyb3IpLm1lc3NhZ2UsXHJcbiAgICB9O1xyXG4gIH1cclxufVxyXG5cclxuYXN5bmMgZnVuY3Rpb24gc2VuZENyaXRpY2FsQWxlcnQoZXJyb3I6IEVycm9yKTogUHJvbWlzZTx2b2lkPiB7XHJcbiAgY29uc3QgYWxlcnRUb3BpY0FybiA9IHByb2Nlc3MuZW52LkFMRVJUX1RPUElDX0FSTjtcclxuICBpZiAoIWFsZXJ0VG9waWNBcm4pIHtcclxuICAgIGNvbnNvbGUud2FybignQWxlcnQgdG9waWMgQVJOIG5vdCBjb25maWd1cmVkLCBza2lwcGluZyBjcml0aWNhbCBhbGVydCcpO1xyXG4gICAgcmV0dXJuO1xyXG4gIH1cclxuXHJcbiAgY29uc3QgY2xpZW50ID0gbmV3IFNOU0NsaWVudCh7IHJlZ2lvbjogcHJvY2Vzcy5lbnYuQVdTX1JFR0lPTiB9KTtcclxuICBcclxuICB0cnkge1xyXG4gICAgY29uc3QgYWxlcnRNZXNzYWdlID0ge1xyXG4gICAgICB0aW1lc3RhbXA6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcclxuICAgICAgc2V2ZXJpdHk6ICdDUklUSUNBTCcsXHJcbiAgICAgIHNlcnZpY2U6ICdBdXRvbWF0ZWRCbG9nUG9zdGVyJyxcclxuICAgICAgdHlwZTogJ0hlYWx0aENoZWNrRmFpbHVyZScsXHJcbiAgICAgIHN1bW1hcnk6ICdIZWFsdGggY2hlY2sgc3lzdGVtIGZhaWx1cmUnLFxyXG4gICAgICBlcnJvcjoge1xyXG4gICAgICAgIG5hbWU6IGVycm9yLm5hbWUsXHJcbiAgICAgICAgbWVzc2FnZTogZXJyb3IubWVzc2FnZSxcclxuICAgICAgICBzdGFjazogZXJyb3Iuc3RhY2ssXHJcbiAgICAgIH0sXHJcbiAgICB9O1xyXG5cclxuICAgIGF3YWl0IGNsaWVudC5zZW5kKG5ldyBQdWJsaXNoQ29tbWFuZCh7XHJcbiAgICAgIFRvcGljQXJuOiBhbGVydFRvcGljQXJuLFxyXG4gICAgICBTdWJqZWN0OiAnQ1JJVElDQUw6IEhlYWx0aCBDaGVjayBTeXN0ZW0gRmFpbHVyZScsXHJcbiAgICAgIE1lc3NhZ2U6IEpTT04uc3RyaW5naWZ5KGFsZXJ0TWVzc2FnZSwgbnVsbCwgMiksXHJcbiAgICB9KSk7XHJcbiAgfSBjYXRjaCAoYWxlcnRFcnJvcikge1xyXG4gICAgY29uc29sZS5lcnJvcignRmFpbGVkIHRvIHNlbmQgY3JpdGljYWwgYWxlcnQ6JywgYWxlcnRFcnJvcik7XHJcbiAgfVxyXG59Il19