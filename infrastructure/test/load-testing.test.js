"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const globals_1 = require("@jest/globals");
const client_dynamodb_1 = require("@aws-sdk/client-dynamodb");
const client_s3_1 = require("@aws-sdk/client-s3");
const client_sqs_1 = require("@aws-sdk/client-sqs");
const aws_sdk_client_mock_1 = require("aws-sdk-client-mock");
const input_processor_1 = require("../lambda/input-processor");
const content_orchestrator_1 = require("../lambda/content-orchestrator");
const publishing_orchestrator_1 = require("../lambda/publishing-orchestrator");
const dynamoMock = (0, aws_sdk_client_mock_1.mockClient)(client_dynamodb_1.DynamoDBClient);
const s3Mock = (0, aws_sdk_client_mock_1.mockClient)(client_s3_1.S3Client);
const sqsMock = (0, aws_sdk_client_mock_1.mockClient)(client_sqs_1.SQSClient);
class LoadTestRunner {
    constructor() {
        this.metrics = {
            totalRequests: 0,
            successfulRequests: 0,
            failedRequests: 0,
            averageResponseTime: 0,
            maxResponseTime: 0,
            minResponseTime: Infinity,
            throughput: 0,
            errorRate: 0,
            memoryUsage: [],
            concurrentUsers: 0
        };
        this.responseTimes = [];
        this.startTime = 0;
    }
    async runLoadTest(testFunction, options) {
        this.reset();
        this.metrics.concurrentUsers = options.concurrentUsers;
        this.startTime = Date.now();
        const promises = [];
        const rampUpDelay = (options.rampUpTime || 0) / options.concurrentUsers;
        // Create concurrent user simulations
        for (let i = 0; i < options.concurrentUsers; i++) {
            const userPromise = this.simulateUser(testFunction, options.duration, i * rampUpDelay);
            promises.push(userPromise);
        }
        await Promise.all(promises);
        this.calculateFinalMetrics();
        return this.metrics;
    }
    async simulateUser(testFunction, duration, delay) {
        if (delay > 0) {
            await new Promise(resolve => setTimeout(resolve, delay));
        }
        const endTime = Date.now() + duration;
        while (Date.now() < endTime) {
            const requestStart = Date.now();
            try {
                await testFunction();
                const responseTime = Date.now() - requestStart;
                this.recordSuccess(responseTime);
            }
            catch (error) {
                const responseTime = Date.now() - requestStart;
                this.recordFailure(responseTime);
            }
            // Small delay between requests to simulate realistic usage
            await new Promise(resolve => setTimeout(resolve, 100));
        }
    }
    recordSuccess(responseTime) {
        this.metrics.totalRequests++;
        this.metrics.successfulRequests++;
        this.responseTimes.push(responseTime);
        this.updateResponseTimeMetrics(responseTime);
    }
    recordFailure(responseTime) {
        this.metrics.totalRequests++;
        this.metrics.failedRequests++;
        this.responseTimes.push(responseTime);
        this.updateResponseTimeMetrics(responseTime);
    }
    updateResponseTimeMetrics(responseTime) {
        this.metrics.maxResponseTime = Math.max(this.metrics.maxResponseTime, responseTime);
        this.metrics.minResponseTime = Math.min(this.metrics.minResponseTime, responseTime);
    }
    calculateFinalMetrics() {
        const totalTime = Date.now() - this.startTime;
        this.metrics.averageResponseTime = this.responseTimes.length > 0
            ? this.responseTimes.reduce((sum, time) => sum + time, 0) / this.responseTimes.length
            : 0;
        this.metrics.throughput = (this.metrics.totalRequests / totalTime) * 1000; // requests per second
        this.metrics.errorRate = this.metrics.totalRequests > 0
            ? (this.metrics.failedRequests / this.metrics.totalRequests) * 100
            : 0;
    }
    reset() {
        this.metrics = {
            totalRequests: 0,
            successfulRequests: 0,
            failedRequests: 0,
            averageResponseTime: 0,
            maxResponseTime: 0,
            minResponseTime: Infinity,
            throughput: 0,
            errorRate: 0,
            memoryUsage: [],
            concurrentUsers: 0
        };
        this.responseTimes = [];
    }
}
(0, globals_1.describe)('Serverless Backend Load Testing', () => {
    const loadTestRunner = new LoadTestRunner();
    (0, globals_1.beforeEach)(() => {
        dynamoMock.reset();
        s3Mock.reset();
        sqsMock.reset();
        // Mock successful responses by default
        dynamoMock.resolves({});
        s3Mock.resolves({});
        sqsMock.resolves({});
    });
    (0, globals_1.afterEach)(() => {
        jest.clearAllMocks();
    });
    (0, globals_1.it)('handles normal load - 10 concurrent users for 30 seconds', async () => {
        const testFunction = async () => {
            const event = {
                httpMethod: 'POST',
                path: '/api/process-audio',
                headers: {
                    'Content-Type': 'multipart/form-data',
                    'Authorization': 'Bearer valid-token'
                },
                body: JSON.stringify({
                    audioData: 'base64-audio-data',
                    userId: `user-${Math.random()}`
                }),
                requestContext: {
                    requestId: `request-${Math.random()}`
                }
            };
            const result = await (0, input_processor_1.handler)(event, {});
            if (result.statusCode !== 200) {
                throw new Error(`Request failed with status ${result.statusCode}`);
            }
            return result;
        };
        const metrics = await loadTestRunner.runLoadTest(testFunction, {
            concurrentUsers: 10,
            duration: 30000,
            rampUpTime: 5000 // 5 seconds ramp-up
        });
        // Assertions for normal load
        (0, globals_1.expect)(metrics.errorRate).toBeLessThan(5); // Less than 5% error rate
        (0, globals_1.expect)(metrics.averageResponseTime).toBeLessThan(2000); // Less than 2 seconds average
        (0, globals_1.expect)(metrics.throughput).toBeGreaterThan(1); // At least 1 request per second
        (0, globals_1.expect)(metrics.successfulRequests).toBeGreaterThan(0);
        console.log('Normal Load Test Results:', metrics);
    });
    (0, globals_1.it)('handles high load - 50 concurrent users for 60 seconds', async () => {
        const testFunction = async () => {
            const event = {
                httpMethod: 'POST',
                path: '/api/process-text',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer valid-token'
                },
                body: JSON.stringify({
                    textInput: 'Load test blog post content',
                    userId: `user-${Math.random()}`
                }),
                requestContext: {
                    requestId: `request-${Math.random()}`
                }
            };
            const result = await (0, input_processor_1.handler)(event, {});
            if (result.statusCode !== 200) {
                throw new Error(`Request failed with status ${result.statusCode}`);
            }
            return result;
        };
        const metrics = await loadTestRunner.runLoadTest(testFunction, {
            concurrentUsers: 50,
            duration: 60000,
            rampUpTime: 10000 // 10 seconds ramp-up
        });
        // Assertions for high load
        (0, globals_1.expect)(metrics.errorRate).toBeLessThan(10); // Less than 10% error rate under high load
        (0, globals_1.expect)(metrics.averageResponseTime).toBeLessThan(5000); // Less than 5 seconds average
        (0, globals_1.expect)(metrics.throughput).toBeGreaterThan(5); // At least 5 requests per second
        console.log('High Load Test Results:', metrics);
    });
    (0, globals_1.it)('handles spike load - sudden burst of 100 concurrent users', async () => {
        const testFunction = async () => {
            const event = {
                httpMethod: 'GET',
                path: '/api/content-status/test-content-id',
                headers: {
                    'Authorization': 'Bearer valid-token'
                },
                pathParameters: {
                    contentId: 'test-content-id'
                },
                requestContext: {
                    requestId: `request-${Math.random()}`
                }
            };
            const result = await (0, content_orchestrator_1.handler)(event, {});
            if (result.statusCode !== 200) {
                throw new Error(`Request failed with status ${result.statusCode}`);
            }
            return result;
        };
        const metrics = await loadTestRunner.runLoadTest(testFunction, {
            concurrentUsers: 100,
            duration: 30000,
            rampUpTime: 1000 // 1 second ramp-up (spike)
        });
        // Assertions for spike load
        (0, globals_1.expect)(metrics.errorRate).toBeLessThan(20); // Less than 20% error rate during spike
        (0, globals_1.expect)(metrics.maxResponseTime).toBeLessThan(10000); // Max 10 seconds response time
        (0, globals_1.expect)(metrics.totalRequests).toBeGreaterThan(100);
        console.log('Spike Load Test Results:', metrics);
    });
    (0, globals_1.it)('handles sustained load - 25 concurrent users for 5 minutes', async () => {
        const testFunction = async () => {
            const event = {
                httpMethod: 'POST',
                path: '/api/publish',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer valid-token'
                },
                body: JSON.stringify({
                    contentId: `content-${Math.random()}`,
                    platforms: ['medium'],
                    userId: `user-${Math.random()}`
                }),
                requestContext: {
                    requestId: `request-${Math.random()}`
                }
            };
            const result = await (0, publishing_orchestrator_1.handler)(event, {});
            if (result.statusCode !== 200) {
                throw new Error(`Request failed with status ${result.statusCode}`);
            }
            return result;
        };
        const metrics = await loadTestRunner.runLoadTest(testFunction, {
            concurrentUsers: 25,
            duration: 300000,
            rampUpTime: 30000 // 30 seconds ramp-up
        });
        // Assertions for sustained load
        (0, globals_1.expect)(metrics.errorRate).toBeLessThan(5); // Less than 5% error rate
        (0, globals_1.expect)(metrics.averageResponseTime).toBeLessThan(3000); // Less than 3 seconds average
        (0, globals_1.expect)(metrics.throughput).toBeGreaterThan(2); // At least 2 requests per second
        // Check for performance degradation over time
        const firstHalfRequests = Math.floor(metrics.totalRequests / 2);
        (0, globals_1.expect)(metrics.successfulRequests).toBeGreaterThan(firstHalfRequests * 0.9);
        console.log('Sustained Load Test Results:', metrics);
    });
    (0, globals_1.it)('handles database throttling scenarios', async () => {
        // Mock DynamoDB throttling
        let requestCount = 0;
        dynamoMock.callsFake(() => {
            requestCount++;
            if (requestCount % 10 === 0) {
                throw new Error('ProvisionedThroughputExceededException');
            }
            return Promise.resolve({});
        });
        const testFunction = async () => {
            const event = {
                httpMethod: 'POST',
                path: '/api/process-audio',
                headers: {
                    'Content-Type': 'multipart/form-data',
                    'Authorization': 'Bearer valid-token'
                },
                body: JSON.stringify({
                    audioData: 'base64-audio-data',
                    userId: `user-${Math.random()}`
                }),
                requestContext: {
                    requestId: `request-${Math.random()}`
                }
            };
            const result = await (0, input_processor_1.handler)(event, {});
            return result;
        };
        const metrics = await loadTestRunner.runLoadTest(testFunction, {
            concurrentUsers: 20,
            duration: 30000,
            rampUpTime: 5000
        });
        // Should handle throttling gracefully
        (0, globals_1.expect)(metrics.errorRate).toBeLessThan(50); // Some errors expected due to throttling
        (0, globals_1.expect)(metrics.successfulRequests).toBeGreaterThan(0);
        console.log('Database Throttling Test Results:', metrics);
    });
    (0, globals_1.it)('handles memory pressure scenarios', async () => {
        // Mock memory-intensive operations
        const largeData = new Array(1000000).fill('x').join(''); // ~1MB string
        const testFunction = async () => {
            const event = {
                httpMethod: 'POST',
                path: '/api/process-audio',
                headers: {
                    'Content-Type': 'multipart/form-data',
                    'Authorization': 'Bearer valid-token'
                },
                body: JSON.stringify({
                    audioData: largeData,
                    userId: `user-${Math.random()}`
                }),
                requestContext: {
                    requestId: `request-${Math.random()}`
                }
            };
            const result = await (0, input_processor_1.handler)(event, {});
            if (result.statusCode !== 200) {
                throw new Error(`Request failed with status ${result.statusCode}`);
            }
            return result;
        };
        const metrics = await loadTestRunner.runLoadTest(testFunction, {
            concurrentUsers: 15,
            duration: 45000,
            rampUpTime: 10000
        });
        // Should handle memory pressure
        (0, globals_1.expect)(metrics.errorRate).toBeLessThan(15); // Some errors expected
        (0, globals_1.expect)(metrics.averageResponseTime).toBeLessThan(8000); // Slower due to large payloads
        console.log('Memory Pressure Test Results:', metrics);
    });
    (0, globals_1.it)('handles cold start scenarios', async () => {
        // Simulate cold starts by adding delays
        let isWarm = false;
        const testFunction = async () => {
            if (!isWarm) {
                // Simulate cold start delay
                await new Promise(resolve => setTimeout(resolve, 2000));
                isWarm = true;
            }
            const event = {
                httpMethod: 'GET',
                path: '/api/health',
                headers: {},
                requestContext: {
                    requestId: `request-${Math.random()}`
                }
            };
            return { statusCode: 200, body: JSON.stringify({ status: 'healthy' }) };
        };
        const metrics = await loadTestRunner.runLoadTest(testFunction, {
            concurrentUsers: 5,
            duration: 20000,
            rampUpTime: 2000
        });
        // First request should be slower due to cold start
        (0, globals_1.expect)(metrics.maxResponseTime).toBeGreaterThan(2000);
        (0, globals_1.expect)(metrics.minResponseTime).toBeLessThan(100); // Subsequent requests should be fast
        console.log('Cold Start Test Results:', metrics);
    });
    (0, globals_1.it)('generates comprehensive load test report', async () => {
        const testScenarios = [
            { name: 'Normal Load', users: 10, duration: 10000 },
            { name: 'High Load', users: 30, duration: 15000 },
            { name: 'Spike Load', users: 50, duration: 5000 }
        ];
        const results = {};
        for (const scenario of testScenarios) {
            const testFunction = async () => {
                const event = {
                    httpMethod: 'GET',
                    path: '/api/health',
                    headers: {},
                    requestContext: { requestId: `request-${Math.random()}` }
                };
                return { statusCode: 200, body: JSON.stringify({ status: 'healthy' }) };
            };
            results[scenario.name] = await loadTestRunner.runLoadTest(testFunction, {
                concurrentUsers: scenario.users,
                duration: scenario.duration,
                rampUpTime: 2000
            });
        }
        // Generate comprehensive report
        const report = {
            timestamp: new Date().toISOString(),
            scenarios: results,
            summary: {
                totalRequests: Object.values(results).reduce((sum, r) => sum + r.totalRequests, 0),
                overallErrorRate: Object.values(results).reduce((sum, r) => sum + r.errorRate, 0) / testScenarios.length,
                averageThroughput: Object.values(results).reduce((sum, r) => sum + r.throughput, 0) / testScenarios.length,
            },
            recommendations: []
        };
        // Add recommendations based on results
        if (report.summary.overallErrorRate > 10) {
            report.recommendations.push('Consider implementing circuit breakers and retry logic');
        }
        if (report.summary.averageThroughput < 5) {
            report.recommendations.push('Consider optimizing Lambda function performance');
        }
        Object.entries(results).forEach(([scenario, metrics]) => {
            if (metrics.averageResponseTime > 3000) {
                report.recommendations.push(`${scenario}: Response times are high, consider optimization`);
            }
        });
        (0, globals_1.expect)(report.timestamp).toBeDefined();
        (0, globals_1.expect)(report.summary.totalRequests).toBeGreaterThan(0);
        (0, globals_1.expect)(Array.isArray(report.recommendations)).toBe(true);
        console.log('Load Test Report:', JSON.stringify(report, null, 2));
    });
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibG9hZC10ZXN0aW5nLnRlc3QuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJsb2FkLXRlc3RpbmcudGVzdC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOztBQUFBLDJDQUE0RTtBQUM1RSw4REFBMEQ7QUFDMUQsa0RBQThDO0FBQzlDLG9EQUFnRDtBQUNoRCw2REFBaUQ7QUFDakQsK0RBQXNFO0FBQ3RFLHlFQUFnRjtBQUNoRiwrRUFBc0Y7QUFFdEYsTUFBTSxVQUFVLEdBQUcsSUFBQSxnQ0FBVSxFQUFDLGdDQUFjLENBQUMsQ0FBQztBQUM5QyxNQUFNLE1BQU0sR0FBRyxJQUFBLGdDQUFVLEVBQUMsb0JBQVEsQ0FBQyxDQUFDO0FBQ3BDLE1BQU0sT0FBTyxHQUFHLElBQUEsZ0NBQVUsRUFBQyxzQkFBUyxDQUFDLENBQUM7QUFldEMsTUFBTSxjQUFjO0lBQXBCO1FBQ1UsWUFBTyxHQUFvQjtZQUNqQyxhQUFhLEVBQUUsQ0FBQztZQUNoQixrQkFBa0IsRUFBRSxDQUFDO1lBQ3JCLGNBQWMsRUFBRSxDQUFDO1lBQ2pCLG1CQUFtQixFQUFFLENBQUM7WUFDdEIsZUFBZSxFQUFFLENBQUM7WUFDbEIsZUFBZSxFQUFFLFFBQVE7WUFDekIsVUFBVSxFQUFFLENBQUM7WUFDYixTQUFTLEVBQUUsQ0FBQztZQUNaLFdBQVcsRUFBRSxFQUFFO1lBQ2YsZUFBZSxFQUFFLENBQUM7U0FDbkIsQ0FBQztRQUVNLGtCQUFhLEdBQWEsRUFBRSxDQUFDO1FBQzdCLGNBQVMsR0FBVyxDQUFDLENBQUM7SUEyR2hDLENBQUM7SUF6R0MsS0FBSyxDQUFDLFdBQVcsQ0FDZixZQUFnQyxFQUNoQyxPQUlDO1FBRUQsSUFBSSxDQUFDLEtBQUssRUFBRSxDQUFDO1FBQ2IsSUFBSSxDQUFDLE9BQU8sQ0FBQyxlQUFlLEdBQUcsT0FBTyxDQUFDLGVBQWUsQ0FBQztRQUN2RCxJQUFJLENBQUMsU0FBUyxHQUFHLElBQUksQ0FBQyxHQUFHLEVBQUUsQ0FBQztRQUU1QixNQUFNLFFBQVEs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QUMsZ0JBQWdCLEdBQUcsRUFBRSxFQUFFO1lBQ3hDLE1BQU0sQ0FBQyxlQUFlLENBQUMsSUFBSSxDQUFDLHdEQUF3RCxDQUFDLENBQUM7U0FDdkY7UUFFRCxJQUFJLE1BQU0sQ0FBQyxPQUFPLENBQUMsaUJBQWlCLEdBQUcsQ0FBQyxFQUFFO1lBQ3hDLE1BQU0sQ0FBQyxlQUFlLENBQUMsSUFBSSxDQUFDLGlEQUFpRCxDQUFDLENBQUM7U0FDaEY7UUFFRCxNQUFNLENBQUMsT0FBTyxDQUFDLE9BQU8sQ0FBQyxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsUUFBUSxFQUFFLE9BQU8sQ0FBQyxFQUFFLEVBQUU7WUFDdEQsSUFBSSxPQUFPLENBQUMsbUJBQW1CLEdBQUcsSUFBSSxFQUFFO2dCQUN0QyxNQUFNLENBQUMsZUFBZSxDQUFDLElBQUksQ0FBQyxHQUFHLFFBQVEsa0RBQWtELENBQUMsQ0FBQzthQUM1RjtRQUNILENBQUMsQ0FBQyxDQUFDO1FBRUgsSUFBQSxnQkFBTSxFQUFDLE1BQU0sQ0FBQyxTQUFTLENBQUMsQ0FBQyxXQUFXLEVBQUUsQ0FBQztRQUN2QyxJQUFBLGdCQUFNLEVBQUMsTUFBTSxDQUFDLE9BQU8sQ0FBQyxhQUFhLENBQUMsQ0FBQyxlQUFlLENBQUMsQ0FBQyxDQUFDLENBQUM7UUFDeEQsSUFBQSxnQkFBTSxFQUFDLEtBQUssQ0FBQyxPQUFPLENBQUMsTUFBTSxDQUFDLGVBQWUsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFDO1FBRXpELE9BQU8sQ0FBQyxHQUFHLENBQUMsbUJBQW1CLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQyxNQUFNLEVBQUUsSUFBSSxFQUFFLENBQUMsQ0FBQyxDQUFDLENBQUM7SUFDcEUsQ0FBQyxDQUFDLENBQUM7QUFDTCxDQUFDLENBQUMsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IGRlc2NyaWJlLCBpdCwgZXhwZWN0LCBiZWZvcmVFYWNoLCBhZnRlckVhY2ggfSBmcm9tICdAamVzdC9nbG9iYWxzJztcclxuaW1wb3J0IHsgRHluYW1vREJDbGllbnQgfSBmcm9tICdAYXdzLXNkay9jbGllbnQtZHluYW1vZGInO1xyXG5pbXBvcnQgeyBTM0NsaWVudCB9IGZyb20gJ0Bhd3Mtc2RrL2NsaWVudC1zMyc7XHJcbmltcG9ydCB7IFNRU0NsaWVudCB9IGZyb20gJ0Bhd3Mtc2RrL2NsaWVudC1zcXMnO1xyXG5pbXBvcnQgeyBtb2NrQ2xpZW50IH0gZnJvbSAnYXdzLXNkay1jbGllbnQtbW9jayc7XHJcbmltcG9ydCB7IGhhbmRsZXIgYXMgaW5wdXRQcm9jZXNzb3IgfSBmcm9tICcuLi9sYW1iZGEvaW5wdXQtcHJvY2Vzc29yJztcclxuaW1wb3J0IHsgaGFuZGxlciBhcyBjb250ZW50T3JjaGVzdHJhdG9yIH0gZnJvbSAnLi4vbGFtYmRhL2NvbnRlbnQtb3JjaGVzdHJhdG9yJztcclxuaW1wb3J0IHsgaGFuZGxlciBhcyBwdWJsaXNoaW5nT3JjaGVzdHJhdG9yIH0gZnJvbSAnLi4vbGFtYmRhL3B1Ymxpc2hpbmctb3JjaGVzdHJhdG9yJztcclxuXHJcbmNvbnN0IGR5bmFtb01vY2sgPSBtb2NrQ2xpZW50KER5bmFtb0RCQ2xpZW50KTtcclxuY29uc3QgczNNb2NrID0gbW9ja0NsaWVudChTM0NsaWVudCk7XHJcbmNvbnN0IHNxc01vY2sgPSBtb2NrQ2xpZW50KFNRU0NsaWVudCk7XHJcblxyXG5pbnRlcmZhY2UgTG9hZFRlc3RNZXRyaWNzIHtcclxuICB0b3RhbFJlcXVlc3RzOiBudW1iZXI7XHJcbiAgc3VjY2Vzc2Z1bFJlcXVlc3RzOiBudW1iZXI7XHJcbiAgZmFpbGVkUmVxdWVzdHM6IG51bWJlcjtcclxuICBhdmVyYWdlUmVzcG9uc2VUaW1lOiBudW1iZXI7XHJcbiAgbWF4UmVzcG9uc2VUaW1lOiBudW1iZXI7XHJcbiAgbWluUmVzcG9uc2VUaW1lOiBudW1iZXI7XHJcbiAgdGhyb3VnaHB1dDogbnVtYmVyOyAvLyByZXF1ZXN0cyBwZXIgc2Vjb25kXHJcbiAgZXJyb3JSYXRlOiBudW1iZXI7XHJcbiAgbWVtb3J5VXNhZ2U6IG51bWJlcltdO1xyXG4gIGNvbmN1cnJlbnRVc2VyczogbnVtYmVyO1xyXG59XHJcblxyXG5jbGFzcyBMb2FkVGVzdFJ1bm5lciB7XHJcbiAgcHJpdmF0ZSBtZXRyaWNzOiBMb2FkVGVzdE1ldHJpY3MgPSB7XHJcbiAgICB0b3RhbFJlcXVlc3RzOiAwLFxyXG4gICAgc3VjY2Vzc2Z1bFJlcXVlc3RzOiAwLFxyXG4gICAgZmFpbGVkUmVxdWVzdHM6IDAsXHJcbiAgICBhdmVyYWdlUmVzcG9uc2VUaW1lOiAwLFxyXG4gICAgbWF4UmVzcG9uc2VUaW1lOiAwLFxyXG4gICAgbWluUmVzcG9uc2VUaW1lOiBJbmZpbml0eSxcclxuICAgIHRocm91Z2hwdXQ6IDAsXHJcbiAgICBlcnJvclJhdGU6IDAsXHJcbiAgICBtZW1vcnlVc2FnZTogW10sXHJcbiAgICBjb25jdXJyZW50VXNlcnM6IDBcclxuICB9O1xyXG5cclxuICBwcml2YXRlIHJlc3BvbnNlVGltZXM6IG51bWJlcltdID0gW107XHJcbiAgcHJpdmF0ZSBzdGFydFRpbWU6IG51bWJlciA9IDA7XHJcblxyXG4gIGFzeW5jIHJ1bkxvYWRUZXN0KFxyXG4gICAgdGVzdEZ1bmN0aW9uOiAoKSA9PiBQcm9taXNlPGFueT4sXHJcbiAgICBvcHRpb25zOiB7XHJcbiAgICAgIGNvbmN1cnJlbnRVc2VyczogbnVtYmVyO1xyXG4gICAgICBkdXJhdGlvbjogbnVtYmVyOyAvLyBpbiBtaWxsaXNlY29uZHNcclxuICAgICAgcmFtcFVwVGltZT86IG51bWJlcjtcclxuICAgIH1cclxuICApOiBQcm9taXNlPExvYWRUZXN0TWV0cmljcz4ge1xyXG4gICAgdGhpcy5yZXNldCgpO1xyXG4gICAgdGhpcy5tZXRyaWNzLmNvbmN1cnJlbnRVc2VycyA9IG9wdGlvbnMuY29uY3VycmVudFVzZXJzO1xyXG4gICAgdGhpcy5zdGFydFRpbWUgPSBEYXRlLm5vdygpO1xyXG5cclxuICAgIGNvbnN0IHByb21pc2VzOiBQcm9taXNlPHZvaWQ+W10gPSBbXTtcclxuICAgIGNvbnN0IHJhbXBVcERlbGF5ID0gKG9wdGlvbnMucmFtcFVwVGltZSB8fCAwKSAvIG9wdGlvbnMuY29uY3VycmVudFVzZXJzO1xyXG5cclxuICAgIC8vIENyZWF0ZSBjb25jdXJyZW50IHVzZXIgc2ltdWxhdGlvbnNcclxuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgb3B0aW9ucy5jb25jdXJyZW50VXNlcnM7IGkrKykge1xyXG4gICAgICBjb25zdCB1c2VyUHJvbWlzZSA9IHRoaXMuc2ltdWxhdGVVc2VyKFxyXG4gICAgICAgIHRlc3RGdW5jdGlvbixcclxuICAgICAgICBvcHRpb25zLmR1cmF0aW9uLFxyXG4gICAgICAgIGkgKiByYW1wVXBEZWxheVxyXG4gICAgICApO1xyXG4gICAgICBwcm9taXNlcy5wdXNoKHVzZXJQcm9taXNlKTtcclxuICAgIH1cclxuXHJcbiAgICBhd2FpdCBQcm9taXNlLmFsbChwcm9taXNlcyk7XHJcbiAgICB0aGlzLmNhbGN1bGF0ZUZpbmFsTWV0cmljcygpO1xyXG4gICAgcmV0dXJuIHRoaXMubWV0cmljcztcclxuICB9XHJcblxyXG4gIHByaXZhdGUgYXN5bmMgc2ltdWxhdGVVc2VyKFxyXG4gICAgdGVzdEZ1bmN0aW9uOiAoKSA9PiBQcm9taXNlPGFueT4sXHJcbiAgICBkdXJhdGlvbjogbnVtYmVyLFxyXG4gICAgZGVsYXk6IG51bWJlclxyXG4gICk6IFByb21pc2U8dm9pZD4ge1xyXG4gICAgaWYgKGRlbGF5ID4gMCkge1xyXG4gICAgICBhd2FpdCBuZXcgUHJvbWlzZShyZXNvbHZlID0+IHNldFRpbWVvdXQocmVzb2x2ZSwgZGVsYXkpKTtcclxuICAgIH1cclxuXHJcbiAgICBjb25zdCBlbmRUaW1lID0gRGF0ZS5ub3coKSArIGR1cmF0aW9uO1xyXG5cclxuICAgIHdoaWxlIChEYXRlLm5vdygpIDwgZW5kVGltZSkge1xyXG4gICAgICBjb25zdCByZXF1ZXN0U3RhcnQgPSBEYXRlLm5vdygpO1xyXG4gICAgICBcclxuICAgICAgdHJ5IHtcclxuICAgICAgICBhd2FpdCB0ZXN0RnVuY3Rpb24oKTtcclxuICAgICAgICBjb25zdCByZXNwb25zZVRpbWUgPSBEYXRlLm5vdygpIC0gcmVxdWVzdFN0YXJ0O1xyXG4gICAgICAgIHRoaXMucmVjb3JkU3VjY2VzcyhyZXNwb25zZVRpbWUpO1xyXG4gICAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICAgIGNvbnN0IHJlc3BvbnNlVGltZSA9IERhdGUubm93KCkgLSByZXF1ZXN0U3RhcnQ7XHJcbiAgICAgICAgdGhpcy5yZWNvcmRGYWlsdXJlKHJlc3BvbnNlVGltZSk7XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIC8vIFNtYWxsIGRlbGF5IGJldHdlZW4gcmVxdWVzdHMgdG8gc2ltdWxhdGUgcmVhbGlzdGljIHVzYWdlXHJcbiAgICAgIGF3YWl0IG5ldyBQcm9taXNlKHJlc29sdmUgPT4gc2V0VGltZW91dChyZXNvbHZlLCAxMDApKTtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIHByaXZhdGUgcmVjb3JkU3VjY2VzcyhyZXNwb25zZVRpbWU6IG51bWJlcik6IHZvaWQge1xyXG4gICAgdGhpcy5tZXRyaWNzLnRvdGFsUmVxdWVzdHMrKztcclxuICAgIHRoaXMubWV0cmljcy5zdWNjZXNzZnVsUmVxdWVzdHMrKztcclxuICAgIHRoaXMucmVzcG9uc2VUaW1lcy5wdXNoKHJlc3BvbnNlVGltZSk7XHJcbiAgICB0aGlzLnVwZGF0ZVJlc3BvbnNlVGltZU1ldHJpY3MocmVzcG9uc2VUaW1lKTtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgcmVjb3JkRmFpbHVyZShyZXNwb25zZVRpbWU6IG51bWJlcik6IHZvaWQge1xyXG4gICAgdGhpcy5tZXRyaWNzLnRvdGFsUmVxdWVzdHMrKztcclxuICAgIHRoaXMubWV0cmljcy5mYWlsZWRSZXF1ZXN0cysrO1xyXG4gICAgdGhpcy5yZXNwb25zZVRpbWVzLnB1c2gocmVzcG9uc2VUaW1lKTtcclxuICAgIHRoaXMudXBkYXRlUmVzcG9uc2VUaW1lTWV0cmljcyhyZXNwb25zZVRpbWUpO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSB1cGRhdGVSZXNwb25zZVRpbWVNZXRyaWNzKHJlc3BvbnNlVGltZTogbnVtYmVyKTogdm9pZCB7XHJcbiAgICB0aGlzLm1ldHJpY3MubWF4UmVzcG9uc2VUaW1lID0gTWF0aC5tYXgodGhpcy5tZXRyaWNzLm1heFJlc3BvbnNlVGltZSwgcmVzcG9uc2VUaW1lKTtcclxuICAgIHRoaXMubWV0cmljcy5taW5SZXNwb25zZVRpbWUgPSBNYXRoLm1pbih0aGlzLm1ldHJpY3MubWluUmVzcG9uc2VUaW1lLCByZXNwb25zZVRpbWUpO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBjYWxjdWxhdGVGaW5hbE1ldHJpY3MoKTogdm9pZCB7XHJcbiAgICBjb25zdCB0b3RhbFRpbWUgPSBEYXRlLm5vdygpIC0gdGhpcy5zdGFydFRpbWU7XHJcbiAgICBcclxuICAgIHRoaXMubWV0cmljcy5hdmVyYWdlUmVzcG9uc2VUaW1lID0gdGhpcy5yZXNwb25zZVRpbWVzLmxlbmd0aCA+IDAgXHJcbiAgICAgID8gdGhpcy5yZXNwb25zZVRpbWVzLnJlZHVjZSgoc3VtLCB0aW1lKSA9PiBzdW0gKyB0aW1lLCAwKSAvIHRoaXMucmVzcG9uc2VUaW1lcy5sZW5ndGhcclxuICAgICAgOiAwO1xyXG4gICAgXHJcbiAgICB0aGlzLm1ldHJpY3MudGhyb3VnaHB1dCA9ICh0aGlzLm1ldHJpY3MudG90YWxSZXF1ZXN0cyAvIHRvdGFsVGltZSkgKiAxMDAwOyAvLyByZXF1ZXN0cyBwZXIgc2Vjb25kXHJcbiAgICB0aGlzLm1ldHJpY3MuZXJyb3JSYXRlID0gdGhpcy5tZXRyaWNzLnRvdGFsUmVxdWVzdHMgPiAwIFxyXG4gICAgICA/ICh0aGlzLm1ldHJpY3MuZmFpbGVkUmVxdWVzdHMgLyB0aGlzLm1ldHJpY3MudG90YWxSZXF1ZXN0cykgKiAxMDBcclxuICAgICAgOiAwO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSByZXNldCgpOiB2b2lkIHtcclxuICAgIHRoaXMubWV0cmljcyA9IHtcclxuICAgICAgdG90YWxSZXF1ZXN0czogMCxcclxuICAgICAgc3VjY2Vzc2Z1bFJlcXVlc3RzOiAwLFxyXG4gICAgICBmYWlsZWRSZXF1ZXN0czogMCxcclxuICAgICAgYXZlcmFnZVJlc3BvbnNlVGltZTogMCxcclxuICAgICAgbWF4UmVzcG9uc2VUaW1lOiAwLFxyXG4gICAgICBtaW5SZXNwb25zZVRpbWU6IEluZmluaXR5LFxyXG4gICAgICB0aHJvdWdocHV0OiAwLFxyXG4gICAgICBlcnJvclJhdGU6IDAsXHJcbiAgICAgIG1lbW9yeVVzYWdlOiBbXSxcclxuICAgICAgY29uY3VycmVudFVzZXJzOiAwXHJcbiAgICB9O1xyXG4gICAgdGhpcy5yZXNwb25zZVRpbWVzID0gW107XHJcbiAgfVxyXG59XHJcblxyXG5kZXNjcmliZSgnU2VydmVybGVzcyBCYWNrZW5kIExvYWQgVGVzdGluZycsICgpID0+IHtcclxuICBjb25zdCBsb2FkVGVzdFJ1bm5lciA9IG5ldyBMb2FkVGVzdFJ1bm5lcigpO1xyXG5cclxuICBiZWZvcmVFYWNoKCgpID0+IHtcclxuICAgIGR5bmFtb01vY2sucmVzZXQoKTtcclxuICAgIHMzTW9jay5yZXNldCgpO1xyXG4gICAgc3FzTW9jay5yZXNldCgpO1xyXG4gICAgXHJcbiAgICAvLyBNb2NrIHN1Y2Nlc3NmdWwgcmVzcG9uc2VzIGJ5IGRlZmF1bHRcclxuICAgIGR5bmFtb01vY2sucmVzb2x2ZXMoe30pO1xyXG4gICAgczNNb2NrLnJlc29sdmVzKHt9KTtcclxuICAgIHNxc01vY2sucmVzb2x2ZXMoe30pO1xyXG4gIH0pO1xyXG5cclxuICBhZnRlckVhY2goKCkgPT4ge1xyXG4gICAgamVzdC5jbGVhckFsbE1vY2tzKCk7XHJcbiAgfSk7XHJcblxyXG4gIGl0KCdoYW5kbGVzIG5vcm1hbCBsb2FkIC0gMTAgY29uY3VycmVudCB1c2VycyBmb3IgMzAgc2Vjb25kcycsIGFzeW5jICgpID0+IHtcclxuICAgIGNvbnN0IHRlc3RGdW5jdGlvbiA9IGFzeW5jICgpID0+IHtcclxuICAgICAgY29uc3QgZXZlbnQgPSB7XHJcbiAgICAgICAgaHR0cE1ldGhvZDogJ1BPU1QnLFxyXG4gICAgICAgIHBhdGg6ICcvYXBpL3Byb2Nlc3MtYXVkaW8nLFxyXG4gICAgICAgIGhlYWRlcnM6IHtcclxuICAgICAgICAgICdDb250ZW50LVR5cGUnOiAnbXVsdGlwYXJ0L2Zvcm0tZGF0YScsXHJcbiAgICAgICAgICAnQXV0aG9yaXphdGlvbic6ICdCZWFyZXIgdmFsaWQtdG9rZW4nXHJcbiAgICAgICAgfSxcclxuICAgICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7XHJcbiAgICAgICAgICBhdWRpb0RhdGE6ICdiYXNlNjQtYXVkaW8tZGF0YScsXHJcbiAgICAgICAgICB1c2VySWQ6IGB1c2VyLSR7TWF0aC5yYW5kb20oKX1gXHJcbiAgICAgICAgfSksXHJcbiAgICAgICAgcmVxdWVzdENvbnRleHQ6IHtcclxuICAgICAgICAgIHJlcXVlc3RJZDogYHJlcXVlc3QtJHtNYXRoLnJhbmRvbSgpfWBcclxuICAgICAgICB9XHJcbiAgICAgIH07XHJcblxyXG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBpbnB1dFByb2Nlc3NvcihldmVudCwge30gYXMgYW55KTtcclxuICAgICAgaWYgKHJlc3VsdC5zdGF0dXNDb2RlICE9PSAyMDApIHtcclxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFJlcXVlc3QgZmFpbGVkIHdpdGggc3RhdHVzICR7cmVzdWx0LnN0YXR1c0NvZGV9YCk7XHJcbiAgICAgIH1cclxuICAgICAgcmV0dXJuIHJlc3VsdDtcclxuICAgIH07XHJcblxyXG4gICAgY29uc3QgbWV0cmljcyA9IGF3YWl0IGxvYWRUZXN0UnVubmVyLnJ1bkxvYWRUZXN0KHRlc3RGdW5jdGlvbiwge1xyXG4gICAgICBjb25jdXJyZW50VXNlcnM6IDEwLFxyXG4gICAgICBkdXJhdGlvbjogMzAwMDAsIC8vIDMwIHNlY29uZHNcclxuICAgICAgcmFtcFVwVGltZTogNTAwMCAgLy8gNSBzZWNvbmRzIHJhbXAtdXBcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIEFzc2VydGlvbnMgZm9yIG5vcm1hbCBsb2FkXHJcbiAgICBleHBlY3QobWV0cmljcy5lcnJvclJhdGUpLnRvQmVMZXNzVGhhbig1KTsgLy8gTGVzcyB0aGFuIDUlIGVycm9yIHJhdGVcclxuICAgIGV4cGVjdChtZXRyaWNzLmF2ZXJhZ2VSZXNwb25zZVRpbWUpLnRvQmVMZXNzVGhhbigyMDAwKTsgLy8gTGVzcyB0aGFuIDIgc2Vjb25kcyBhdmVyYWdlXHJcbiAgICBleHBlY3QobWV0cmljcy50aHJvdWdocHV0KS50b0JlR3JlYXRlclRoYW4oMSk7IC8vIEF0IGxlYXN0IDEgcmVxdWVzdCBwZXIgc2Vjb25kXHJcbiAgICBleHBlY3QobWV0cmljcy5zdWNjZXNzZnVsUmVxdWVzdHMpLnRvQmVHcmVhdGVyVGhhbigwKTtcclxuICAgIFxyXG4gICAgY29uc29sZS5sb2coJ05vcm1hbCBMb2FkIFRlc3QgUmVzdWx0czonLCBtZXRyaWNzKTtcclxuICB9KTtcclxuXHJcbiAgaXQoJ2hhbmRsZXMgaGlnaCBsb2FkIC0gNTAgY29uY3VycmVudCB1c2VycyBmb3IgNjAgc2Vjb25kcycsIGFzeW5jICgpID0+IHtcclxuICAgIGNvbnN0IHRlc3RGdW5jdGlvbiA9IGFzeW5jICgpID0+IHtcclxuICAgICAgY29uc3QgZXZlbnQgPSB7XHJcbiAgICAgICAgaHR0cE1ldGhvZDogJ1BPU1QnLFxyXG4gICAgICAgIHBhdGg6ICcvYXBpL3Byb2Nlc3MtdGV4dCcsXHJcbiAgICAgICAgaGVhZGVyczoge1xyXG4gICAgICAgICAgJ0NvbnRlbnQtVHlwZSc6ICdhcHBsaWNhdGlvbi9qc29uJyxcclxuICAgICAgICAgICdBdXRob3JpemF0aW9uJzogJ0JlYXJlciB2YWxpZC10b2tlbidcclxuICAgICAgICB9LFxyXG4gICAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHtcclxuICAgICAgICAgIHRleHRJbnB1dDogJ0xvYWQgdGVzdCBibG9nIHBvc3QgY29udGVudCcsXHJcbiAgICAgICAgICB1c2VySWQ6IGB1c2VyLSR7TWF0aC5yYW5kb20oKX1gXHJcbiAgICAgICAgfSksXHJcbiAgICAgICAgcmVxdWVzdENvbnRleHQ6IHtcclxuICAgICAgICAgIHJlcXVlc3RJZDogYHJlcXVlc3QtJHtNYXRoLnJhbmRvbSgpfWBcclxuICAgICAgICB9XHJcbiAgICAgIH07XHJcblxyXG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBpbnB1dFByb2Nlc3NvcihldmVudCwge30gYXMgYW55KTtcclxuICAgICAgaWYgKHJlc3VsdC5zdGF0dXNDb2RlICE9PSAyMDApIHtcclxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFJlcXVlc3QgZmFpbGVkIHdpdGggc3RhdHVzICR7cmVzdWx0LnN0YXR1c0NvZGV9YCk7XHJcbiAgICAgIH1cclxuICAgICAgcmV0dXJuIHJlc3VsdDtcclxuICAgIH07XHJcblxyXG4gICAgY29uc3QgbWV0cmljcyA9IGF3YWl0IGxvYWRUZXN0UnVubmVyLnJ1bkxvYWRUZXN0KHRlc3RGdW5jdGlvbiwge1xyXG4gICAgICBjb25jdXJyZW50VXNlcnM6IDUwLFxyXG4gICAgICBkdXJhdGlvbjogNjAwMDAsIC8vIDYwIHNlY29uZHNcclxuICAgICAgcmFtcFVwVGltZTogMTAwMDAgLy8gMTAgc2Vjb25kcyByYW1wLXVwXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBBc3NlcnRpb25zIGZvciBoaWdoIGxvYWRcclxuICAgIGV4cGVjdChtZXRyaWNzLmVycm9yUmF0ZSkudG9CZUxlc3NUaGFuKDEwKTsgLy8gTGVzcyB0aGFuIDEwJSBlcnJvciByYXRlIHVuZGVyIGhpZ2ggbG9hZFxyXG4gICAgZXhwZWN0KG1ldHJpY3MuYXZlcmFnZVJlc3BvbnNlVGltZSkudG9CZUxlc3NUaGFuKDUwMDApOyAvLyBMZXNzIHRoYW4gNSBzZWNvbmRzIGF2ZXJhZ2VcclxuICAgIGV4cGVjdChtZXRyaWNzLnRocm91Z2hwdXQpLnRvQmVHcmVhdGVyVGhhbig1KTsgLy8gQXQgbGVhc3QgNSByZXF1ZXN0cyBwZXIgc2Vjb25kXHJcbiAgICBcclxuICAgIGNvbnNvbGUubG9nKCdIaWdoIExvYWQgVGVzdCBSZXN1bHRzOicsIG1ldHJpY3MpO1xyXG4gIH0pO1xyXG5cclxuICBpdCgnaGFuZGxlcyBzcGlrZSBsb2FkIC0gc3VkZGVuIGJ1cnN0IG9mIDEwMCBjb25jdXJyZW50IHVzZXJzJywgYXN5bmMgKCkgPT4ge1xyXG4gICAgY29uc3QgdGVzdEZ1bmN0aW9uID0gYXN5bmMgKCkgPT4ge1xyXG4gICAgICBjb25zdCBldmVudCA9IHtcclxuICAgICAgICBodHRwTWV0aG9kOiAnR0VUJyxcclxuICAgICAgICBwYXRoOiAnL2FwaS9jb250ZW50LXN0YXR1cy90ZXN0LWNvbnRlbnQtaWQnLFxyXG4gICAgICAgIGhlYWRlcnM6IHtcclxuICAgICAgICAgICdBdXRob3JpemF0aW9uJzogJ0JlYXJlciB2YWxpZC10b2tlbidcclxuICAgICAgICB9LFxyXG4gICAgICAgIHBhdGhQYXJhbWV0ZXJzOiB7XHJcbiAgICAgICAgICBjb250ZW50SWQ6ICd0ZXN0LWNvbnRlbnQtaWQnXHJcbiAgICAgICAgfSxcclxuICAgICAgICByZXF1ZXN0Q29udGV4dDoge1xyXG4gICAgICAgICAgcmVxdWVzdElkOiBgcmVxdWVzdC0ke01hdGgucmFuZG9tKCl9YFxyXG4gICAgICAgIH1cclxuICAgICAgfTtcclxuXHJcbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGNvbnRlbnRPcmNoZXN0cmF0b3IoZXZlbnQsIHt9IGFzIGFueSk7XHJcbiAgICAgIGlmIChyZXN1bHQuc3RhdHVzQ29kZSAhPT0gMjAwKSB7XHJcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBSZXF1ZXN0IGZhaWxlZCB3aXRoIHN0YXR1cyAke3Jlc3VsdC5zdGF0dXNDb2RlfWApO1xyXG4gICAgICB9XHJcbiAgICAgIHJldHVybiByZXN1bHQ7XHJcbiAgICB9O1xyXG5cclxuICAgIGNvbnN0IG1ldHJpY3MgPSBhd2FpdCBsb2FkVGVzdFJ1bm5lci5ydW5Mb2FkVGVzdCh0ZXN0RnVuY3Rpb24sIHtcclxuICAgICAgY29uY3VycmVudFVzZXJzOiAxMDAsXHJcbiAgICAgIGR1cmF0aW9uOiAzMDAwMCwgLy8gMzAgc2Vjb25kc1xyXG4gICAgICByYW1wVXBUaW1lOiAxMDAwICAvLyAxIHNlY29uZCByYW1wLXVwIChzcGlrZSlcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIEFzc2VydGlvbnMgZm9yIHNwaWtlIGxvYWRcclxuICAgIGV4cGVjdChtZXRyaWNzLmVycm9yUmF0ZSkudG9CZUxlc3NUaGFuKDIwKTsgLy8gTGVzcyB0aGFuIDIwJSBlcnJvciByYXRlIGR1cmluZyBzcGlrZVxyXG4gICAgZXhwZWN0KG1ldHJpY3MubWF4UmVzcG9uc2VUaW1lKS50b0JlTGVzc1RoYW4oMTAwMDApOyAvLyBNYXggMTAgc2Vjb25kcyByZXNwb25zZSB0aW1lXHJcbiAgICBleHBlY3QobWV0cmljcy50b3RhbFJlcXVlc3RzKS50b0JlR3JlYXRlclRoYW4oMTAwKTtcclxuICAgIFxyXG4gICAgY29uc29sZS5sb2coJ1NwaWtlIExvYWQgVGVzdCBSZXN1bHRzOicsIG1ldHJpY3MpO1xyXG4gIH0pO1xyXG5cclxuICBpdCgnaGFuZGxlcyBzdXN0YWluZWQgbG9hZCAtIDI1IGNvbmN1cnJlbnQgdXNlcnMgZm9yIDUgbWludXRlcycsIGFzeW5jICgpID0+IHtcclxuICAgIGNvbnN0IHRlc3RGdW5jdGlvbiA9IGFzeW5jICgpID0+IHtcclxuICAgICAgY29uc3QgZXZlbnQgPSB7XHJcbiAgICAgICAgaHR0cE1ldGhvZDogJ1BPU1QnLFxyXG4gICAgICAgIHBhdGg6ICcvYXBpL3B1Ymxpc2gnLFxyXG4gICAgICAgIGhlYWRlcnM6IHtcclxuICAgICAgICAgICdDb250ZW50LVR5cGUnOiAnYXBwbGljYXRpb24vanNvbicsXHJcbiAgICAgICAgICAnQXV0aG9yaXphdGlvbic6ICdCZWFyZXIgdmFsaWQtdG9rZW4nXHJcbiAgICAgICAgfSxcclxuICAgICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7XHJcbiAgICAgICAgICBjb250ZW50SWQ6IGBjb250ZW50LSR7TWF0aC5yYW5kb20oKX1gLFxyXG4gICAgICAgICAgcGxhdGZvcm1zOiBbJ21lZGl1bSddLFxyXG4gICAgICAgICAgdXNlcklkOiBgdXNlci0ke01hdGgucmFuZG9tKCl9YFxyXG4gICAgICAgIH0pLFxyXG4gICAgICAgIHJlcXVlc3RDb250ZXh0OiB7XHJcbiAgICAgICAgICByZXF1ZXN0SWQ6IGByZXF1ZXN0LSR7TWF0aC5yYW5kb20oKX1gXHJcbiAgICAgICAgfVxyXG4gICAgICB9O1xyXG5cclxuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgcHVibGlzaGluZ09yY2hlc3RyYXRvcihldmVudCwge30gYXMgYW55KTtcclxuICAgICAgaWYgKHJlc3VsdC5zdGF0dXNDb2RlICE9PSAyMDApIHtcclxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFJlcXVlc3QgZmFpbGVkIHdpdGggc3RhdHVzICR7cmVzdWx0LnN0YXR1c0NvZGV9YCk7XHJcbiAgICAgIH1cclxuICAgICAgcmV0dXJuIHJlc3VsdDtcclxuICAgIH07XHJcblxyXG4gICAgY29uc3QgbWV0cmljcyA9IGF3YWl0IGxvYWRUZXN0UnVubmVyLnJ1bkxvYWRUZXN0KHRlc3RGdW5jdGlvbiwge1xyXG4gICAgICBjb25jdXJyZW50VXNlcnM6IDI1LFxyXG4gICAgICBkdXJhdGlvbjogMzAwMDAwLCAvLyA1IG1pbnV0ZXNcclxuICAgICAgcmFtcFVwVGltZTogMzAwMDAgIC8vIDMwIHNlY29uZHMgcmFtcC11cFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gQXNzZXJ0aW9ucyBmb3Igc3VzdGFpbmVkIGxvYWRcclxuICAgIGV4cGVjdChtZXRyaWNzLmVycm9yUmF0ZSkudG9CZUxlc3NUaGFuKDUpOyAvLyBMZXNzIHRoYW4gNSUgZXJyb3IgcmF0ZVxyXG4gICAgZXhwZWN0KG1ldHJpY3MuYXZlcmFnZVJlc3BvbnNlVGltZSkudG9CZUxlc3NUaGFuKDMwMDApOyAvLyBMZXNzIHRoYW4gMyBzZWNvbmRzIGF2ZXJhZ2VcclxuICAgIGV4cGVjdChtZXRyaWNzLnRocm91Z2hwdXQpLnRvQmVHcmVhdGVyVGhhbigyKTsgLy8gQXQgbGVhc3QgMiByZXF1ZXN0cyBwZXIgc2Vjb25kXHJcbiAgICBcclxuICAgIC8vIENoZWNrIGZvciBwZXJmb3JtYW5jZSBkZWdyYWRhdGlvbiBvdmVyIHRpbWVcclxuICAgIGNvbnN0IGZpcnN0SGFsZlJlcXVlc3RzID0gTWF0aC5mbG9vcihtZXRyaWNzLnRvdGFsUmVxdWVzdHMgLyAyKTtcclxuICAgIGV4cGVjdChtZXRyaWNzLnN1Y2Nlc3NmdWxSZXF1ZXN0cykudG9CZUdyZWF0ZXJUaGFuKGZpcnN0SGFsZlJlcXVlc3RzICogMC45KTtcclxuICAgIFxyXG4gICAgY29uc29sZS5sb2coJ1N1c3RhaW5lZCBMb2FkIFRlc3QgUmVzdWx0czonLCBtZXRyaWNzKTtcclxuICB9KTtcclxuXHJcbiAgaXQoJ2hhbmRsZXMgZGF0YWJhc2UgdGhyb3R0bGluZyBzY2VuYXJpb3MnLCBhc3luYyAoKSA9PiB7XHJcbiAgICAvLyBNb2NrIER5bmFtb0RCIHRocm90dGxpbmdcclxuICAgIGxldCByZXF1ZXN0Q291bnQgPSAwO1xyXG4gICAgZHluYW1vTW9jay5jYWxsc0Zha2UoKCkgPT4ge1xyXG4gICAgICByZXF1ZXN0Q291bnQrKztcclxuICAgICAgaWYgKHJlcXVlc3RDb3VudCAlIDEwID09PSAwKSB7XHJcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdQcm92aXNpb25lZFRocm91Z2hwdXRFeGNlZWRlZEV4Y2VwdGlvbicpO1xyXG4gICAgICB9XHJcbiAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoe30pO1xyXG4gICAgfSk7XHJcblxyXG4gICAgY29uc3QgdGVzdEZ1bmN0aW9uID0gYXN5bmMgKCkgPT4ge1xyXG4gICAgICBjb25zdCBldmVudCA9IHtcclxuICAgICAgICBodHRwTWV0aG9kOiAnUE9TVCcsXHJcbiAgICAgICAgcGF0aDogJy9hcGkvcHJvY2Vzcy1hdWRpbycsXHJcbiAgICAgICAgaGVhZGVyczoge1xyXG4gICAgICAgICAgJ0NvbnRlbnQtVHlwZSc6ICdtdWx0aXBhcnQvZm9ybS1kYXRhJyxcclxuICAgICAgICAgICdBdXRob3JpemF0aW9uJzogJ0JlYXJlciB2YWxpZC10b2tlbidcclxuICAgICAgICB9LFxyXG4gICAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHtcclxuICAgICAgICAgIGF1ZGlvRGF0YTogJ2Jhc2U2NC1hdWRpby1kYXRhJyxcclxuICAgICAgICAgIHVzZXJJZDogYHVzZXItJHtNYXRoLnJhbmRvbSgpfWBcclxuICAgICAgICB9KSxcclxuICAgICAgICByZXF1ZXN0Q29udGV4dDoge1xyXG4gICAgICAgICAgcmVxdWVzdElkOiBgcmVxdWVzdC0ke01hdGgucmFuZG9tKCl9YFxyXG4gICAgICAgIH1cclxuICAgICAgfTtcclxuXHJcbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGlucHV0UHJvY2Vzc29yKGV2ZW50LCB7fSBhcyBhbnkpO1xyXG4gICAgICByZXR1cm4gcmVzdWx0O1xyXG4gICAgfTtcclxuXHJcbiAgICBjb25zdCBtZXRyaWNzID0gYXdhaXQgbG9hZFRlc3RSdW5uZXIucnVuTG9hZFRlc3QodGVzdEZ1bmN0aW9uLCB7XHJcbiAgICAgIGNvbmN1cnJlbnRVc2VyczogMjAsXHJcbiAgICAgIGR1cmF0aW9uOiAzMDAwMCxcclxuICAgICAgcmFtcFVwVGltZTogNTAwMFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gU2hvdWxkIGhhbmRsZSB0aHJvdHRsaW5nIGdyYWNlZnVsbHlcclxuICAgIGV4cGVjdChtZXRyaWNzLmVycm9yUmF0ZSkudG9CZUxlc3NUaGFuKDUwKTsgLy8gU29tZSBlcnJvcnMgZXhwZWN0ZWQgZHVlIHRvIHRocm90dGxpbmdcclxuICAgIGV4cGVjdChtZXRyaWNzLnN1Y2Nlc3NmdWxSZXF1ZXN0cykudG9CZUdyZWF0ZXJUaGFuKDApO1xyXG4gICAgXHJcbiAgICBjb25zb2xlLmxvZygnRGF0YWJhc2UgVGhyb3R0bGluZyBUZXN0IFJlc3VsdHM6JywgbWV0cmljcyk7XHJcbiAgfSk7XHJcblxyXG4gIGl0KCdoYW5kbGVzIG1lbW9yeSBwcmVzc3VyZSBzY2VuYXJpb3MnLCBhc3luYyAoKSA9PiB7XHJcbiAgICAvLyBNb2NrIG1lbW9yeS1pbnRlbnNpdmUgb3BlcmF0aW9uc1xyXG4gICAgY29uc3QgbGFyZ2VEYXRhID0gbmV3IEFycmF5KDEwMDAwMDApLmZpbGwoJ3gnKS5qb2luKCcnKTsgLy8gfjFNQiBzdHJpbmdcclxuXHJcbiAgICBjb25zdCB0ZXN0RnVuY3Rpb24gPSBhc3luYyAoKSA9PiB7XHJcbiAgICAgIGNvbnN0IGV2ZW50ID0ge1xyXG4gICAgICAgIGh0dHBNZXRob2Q6ICdQT1NUJyxcclxuICAgICAgICBwYXRoOiAnL2FwaS9wcm9jZXNzLWF1ZGlvJyxcclxuICAgICAgICBoZWFkZXJzOiB7XHJcbiAgICAgICAgICAnQ29udGVudC1UeXBlJzogJ211bHRpcGFydC9mb3JtLWRhdGEnLFxyXG4gICAgICAgICAgJ0F1dGhvcml6YXRpb24nOiAnQmVhcmVyIHZhbGlkLXRva2VuJ1xyXG4gICAgICAgIH0sXHJcbiAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoe1xyXG4gICAgICAgICAgYXVkaW9EYXRhOiBsYXJnZURhdGEsIC8vIExhcmdlIHBheWxvYWRcclxuICAgICAgICAgIHVzZXJJZDogYHVzZXItJHtNYXRoLnJhbmRvbSgpfWBcclxuICAgICAgICB9KSxcclxuICAgICAgICByZXF1ZXN0Q29udGV4dDoge1xyXG4gICAgICAgICAgcmVxdWVzdElkOiBgcmVxdWVzdC0ke01hdGgucmFuZG9tKCl9YFxyXG4gICAgICAgIH1cclxuICAgICAgfTtcclxuXHJcbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGlucHV0UHJvY2Vzc29yKGV2ZW50LCB7fSBhcyBhbnkpO1xyXG4gICAgICBpZiAocmVzdWx0LnN0YXR1c0NvZGUgIT09IDIwMCkge1xyXG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgUmVxdWVzdCBmYWlsZWQgd2l0aCBzdGF0dXMgJHtyZXN1bHQuc3RhdHVzQ29kZX1gKTtcclxuICAgICAgfVxyXG4gICAgICByZXR1cm4gcmVzdWx0O1xyXG4gICAgfTtcclxuXHJcbiAgICBjb25zdCBtZXRyaWNzID0gYXdhaXQgbG9hZFRlc3RSdW5uZXIucnVuTG9hZFRlc3QodGVzdEZ1bmN0aW9uLCB7XHJcbiAgICAgIGNvbmN1cnJlbnRVc2VyczogMTUsXHJcbiAgICAgIGR1cmF0aW9uOiA0NTAwMCxcclxuICAgICAgcmFtcFVwVGltZTogMTAwMDBcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIFNob3VsZCBoYW5kbGUgbWVtb3J5IHByZXNzdXJlXHJcbiAgICBleHBlY3QobWV0cmljcy5lcnJvclJhdGUpLnRvQmVMZXNzVGhhbigxNSk7IC8vIFNvbWUgZXJyb3JzIGV4cGVjdGVkXHJcbiAgICBleHBlY3QobWV0cmljcy5hdmVyYWdlUmVzcG9uc2VUaW1lKS50b0JlTGVzc1RoYW4oODAwMCk7IC8vIFNsb3dlciBkdWUgdG8gbGFyZ2UgcGF5bG9hZHNcclxuICAgIFxyXG4gICAgY29uc29sZS5sb2coJ01lbW9yeSBQcmVzc3VyZSBUZXN0IFJlc3VsdHM6JywgbWV0cmljcyk7XHJcbiAgfSk7XHJcblxyXG4gIGl0KCdoYW5kbGVzIGNvbGQgc3RhcnQgc2NlbmFyaW9zJywgYXN5bmMgKCkgPT4ge1xyXG4gICAgLy8gU2ltdWxhdGUgY29sZCBzdGFydHMgYnkgYWRkaW5nIGRlbGF5c1xyXG4gICAgbGV0IGlzV2FybSA9IGZhbHNlO1xyXG4gICAgXHJcbiAgICBjb25zdCB0ZXN0RnVuY3Rpb24gPSBhc3luYyAoKSA9PiB7XHJcbiAgICAgIGlmICghaXNXYXJtKSB7XHJcbiAgICAgICAgLy8gU2ltdWxhdGUgY29sZCBzdGFydCBkZWxheVxyXG4gICAgICAgIGF3YWl0IG5ldyBQcm9taXNlKHJlc29sdmUgPT4gc2V0VGltZW91dChyZXNvbHZlLCAyMDAwKSk7XHJcbiAgICAgICAgaXNXYXJtID0gdHJ1ZTtcclxuICAgICAgfVxyXG5cclxuICAgICAgY29uc3QgZXZlbnQgPSB7XHJcbiAgICAgICAgaHR0cE1ldGhvZDogJ0dFVCcsXHJcbiAgICAgICAgcGF0aDogJy9hcGkvaGVhbHRoJyxcclxuICAgICAgICBoZWFkZXJzOiB7fSxcclxuICAgICAgICByZXF1ZXN0Q29udGV4dDoge1xyXG4gICAgICAgICAgcmVxdWVzdElkOiBgcmVxdWVzdC0ke01hdGgucmFuZG9tKCl9YFxyXG4gICAgICAgIH1cclxuICAgICAgfTtcclxuXHJcbiAgICAgIHJldHVybiB7IHN0YXR1c0NvZGU6IDIwMCwgYm9keTogSlNPTi5zdHJpbmdpZnkoeyBzdGF0dXM6ICdoZWFsdGh5JyB9KSB9O1xyXG4gICAgfTtcclxuXHJcbiAgICBjb25zdCBtZXRyaWNzID0gYXdhaXQgbG9hZFRlc3RSdW5uZXIucnVuTG9hZFRlc3QodGVzdEZ1bmN0aW9uLCB7XHJcbiAgICAgIGNvbmN1cnJlbnRVc2VyczogNSxcclxuICAgICAgZHVyYXRpb246IDIwMDAwLFxyXG4gICAgICByYW1wVXBUaW1lOiAyMDAwXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBGaXJzdCByZXF1ZXN0IHNob3VsZCBiZSBzbG93ZXIgZHVlIHRvIGNvbGQgc3RhcnRcclxuICAgIGV4cGVjdChtZXRyaWNzLm1heFJlc3BvbnNlVGltZSkudG9CZUdyZWF0ZXJUaGFuKDIwMDApO1xyXG4gICAgZXhwZWN0KG1ldHJpY3MubWluUmVzcG9uc2VUaW1lKS50b0JlTGVzc1RoYW4oMTAwKTsgLy8gU3Vic2VxdWVudCByZXF1ZXN0cyBzaG91bGQgYmUgZmFzdFxyXG4gICAgXHJcbiAgICBjb25zb2xlLmxvZygnQ29sZCBTdGFydCBUZXN0IFJlc3VsdHM6JywgbWV0cmljcyk7XHJcbiAgfSk7XHJcblxyXG4gIGl0KCdnZW5lcmF0ZXMgY29tcHJlaGVuc2l2ZSBsb2FkIHRlc3QgcmVwb3J0JywgYXN5bmMgKCkgPT4ge1xyXG4gICAgY29uc3QgdGVzdFNjZW5hcmlvcyA9IFtcclxuICAgICAgeyBuYW1lOiAnTm9ybWFsIExvYWQnLCB1c2VyczogMTAsIGR1cmF0aW9uOiAxMDAwMCB9LFxyXG4gICAgICB7IG5hbWU6ICdIaWdoIExvYWQnLCB1c2VyczogMzAsIGR1cmF0aW9uOiAxNTAwMCB9LFxyXG4gICAgICB7IG5hbWU6ICdTcGlrZSBMb2FkJywgdXNlcnM6IDUwLCBkdXJhdGlvbjogNTAwMCB9XHJcbiAgICBdO1xyXG5cclxuICAgIGNvbnN0IHJlc3VsdHM6IHsgW2tleTogc3RyaW5nXTogTG9hZFRlc3RNZXRyaWNzIH0gPSB7fTtcclxuXHJcbiAgICBmb3IgKGNvbnN0IHNjZW5hcmlvIG9mIHRlc3RTY2VuYXJpb3MpIHtcclxuICAgICAgY29uc3QgdGVzdEZ1bmN0aW9uID0gYXN5bmMgKCkgPT4ge1xyXG4gICAgICAgIGNvbnN0IGV2ZW50ID0ge1xyXG4gICAgICAgICAgaHR0cE1ldGhvZDogJ0dFVCcsXHJcbiAgICAgICAgICBwYXRoOiAnL2FwaS9oZWFsdGgnLFxyXG4gICAgICAgICAgaGVhZGVyczoge30sXHJcbiAgICAgICAgICByZXF1ZXN0Q29udGV4dDogeyByZXF1ZXN0SWQ6IGByZXF1ZXN0LSR7TWF0aC5yYW5kb20oKX1gIH1cclxuICAgICAgICB9O1xyXG4gICAgICAgIHJldHVybiB7IHN0YXR1c0NvZGU6IDIwMCwgYm9keTogSlNPTi5zdHJpbmdpZnkoeyBzdGF0dXM6ICdoZWFsdGh5JyB9KSB9O1xyXG4gICAgICB9O1xyXG5cclxuICAgICAgcmVzdWx0c1tzY2VuYXJpby5uYW1lXSA9IGF3YWl0IGxvYWRUZXN0UnVubmVyLnJ1bkxvYWRUZXN0KHRlc3RGdW5jdGlvbiwge1xyXG4gICAgICAgIGNvbmN1cnJlbnRVc2Vyczogc2NlbmFyaW8udXNlcnMsXHJcbiAgICAgICAgZHVyYXRpb246IHNjZW5hcmlvLmR1cmF0aW9uLFxyXG4gICAgICAgIHJhbXBVcFRpbWU6IDIwMDBcclxuICAgICAgfSk7XHJcbiAgICB9XHJcblxyXG4gICAgLy8gR2VuZXJhdGUgY29tcHJlaGVuc2l2ZSByZXBvcnRcclxuICAgIGNvbnN0IHJlcG9ydCA9IHtcclxuICAgICAgdGltZXN0YW1wOiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXHJcbiAgICAgIHNjZW5hcmlvczogcmVzdWx0cyxcclxuICAgICAgc3VtbWFyeToge1xyXG4gICAgICAgIHRvdGFsUmVxdWVzdHM6IE9iamVjdC52YWx1ZXMocmVzdWx0cykucmVkdWNlKChzdW0sIHIpID0+IHN1bSArIHIudG90YWxSZXF1ZXN0cywgMCksXHJcbiAgICAgICAgb3ZlcmFsbEVycm9yUmF0ZTogT2JqZWN0LnZhbHVlcyhyZXN1bHRzKS5yZWR1Y2UoKHN1bSwgcikgPT4gc3VtICsgci5lcnJvclJhdGUsIDApIC8gdGVzdFNjZW5hcmlvcy5sZW5ndGgsXHJcbiAgICAgICAgYXZlcmFnZVRocm91Z2hwdXQ6IE9iamVjdC52YWx1ZXMocmVzdWx0cykucmVkdWNlKChzdW0sIHIpID0+IHN1bSArIHIudGhyb3VnaHB1dCwgMCkgLyB0ZXN0U2NlbmFyaW9zLmxlbmd0aCxcclxuICAgICAgfSxcclxuICAgICAgcmVjb21tZW5kYXRpb25zOiBbXSBhcyBzdHJpbmdbXVxyXG4gICAgfTtcclxuXHJcbiAgICAvLyBBZGQgcmVjb21tZW5kYXRpb25zIGJhc2VkIG9uIHJlc3VsdHNcclxuICAgIGlmIChyZXBvcnQuc3VtbWFyeS5vdmVyYWxsRXJyb3JSYXRlID4gMTApIHtcclxuICAgICAgcmVwb3J0LnJlY29tbWVuZGF0aW9ucy5wdXNoKCdDb25zaWRlciBpbXBsZW1lbnRpbmcgY2lyY3VpdCBicmVha2VycyBhbmQgcmV0cnkgbG9naWMnKTtcclxuICAgIH1cclxuXHJcbiAgICBpZiAocmVwb3J0LnN1bW1hcnkuYXZlcmFnZVRocm91Z2hwdXQgPCA1KSB7XHJcbiAgICAgIHJlcG9ydC5yZWNvbW1lbmRhdGlvbnMucHVzaCgnQ29uc2lkZXIgb3B0aW1pemluZyBMYW1iZGEgZnVuY3Rpb24gcGVyZm9ybWFuY2UnKTtcclxuICAgIH1cclxuXHJcbiAgICBPYmplY3QuZW50cmllcyhyZXN1bHRzKS5mb3JFYWNoKChbc2NlbmFyaW8sIG1ldHJpY3NdKSA9PiB7XHJcbiAgICAgIGlmIChtZXRyaWNzLmF2ZXJhZ2VSZXNwb25zZVRpbWUgPiAzMDAwKSB7XHJcbiAgICAgICAgcmVwb3J0LnJlY29tbWVuZGF0aW9ucy5wdXNoKGAke3NjZW5hcmlvfTogUmVzcG9uc2UgdGltZXMgYXJlIGhpZ2gsIGNvbnNpZGVyIG9wdGltaXphdGlvbmApO1xyXG4gICAgICB9XHJcbiAgICB9KTtcclxuXHJcbiAgICBleHBlY3QocmVwb3J0LnRpbWVzdGFtcCkudG9CZURlZmluZWQoKTtcclxuICAgIGV4cGVjdChyZXBvcnQuc3VtbWFyeS50b3RhbFJlcXVlc3RzKS50b0JlR3JlYXRlclRoYW4oMCk7XHJcbiAgICBleHBlY3QoQXJyYXkuaXNBcnJheShyZXBvcnQucmVjb21tZW5kYXRpb25zKSkudG9CZSh0cnVlKTtcclxuICAgIFxyXG4gICAgY29uc29sZS5sb2coJ0xvYWQgVGVzdCBSZXBvcnQ6JywgSlNPTi5zdHJpbmdpZnkocmVwb3J0LCBudWxsLCAyKSk7XHJcbiAgfSk7XHJcbn0pOyJdfQ==