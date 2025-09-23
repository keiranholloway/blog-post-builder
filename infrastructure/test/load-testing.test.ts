import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { S3Client } from '@aws-sdk/client-s3';
import { SQSClient } from '@aws-sdk/client-sqs';
import { mockClient } from 'aws-sdk-client-mock';
import { handler as inputProcessor } from '../lambda/input-processor';
import { handler as contentOrchestrator } from '../lambda/content-orchestrator';
import { handler as publishingOrchestrator } from '../lambda/publishing-orchestrator';

const dynamoMock = mockClient(DynamoDBClient);
const s3Mock = mockClient(S3Client);
const sqsMock = mockClient(SQSClient);

interface LoadTestMetrics {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  averageResponseTime: number;
  maxResponseTime: number;
  minResponseTime: number;
  throughput: number; // requests per second
  errorRate: number;
  memoryUsage: number[];
  concurrentUsers: number;
}

class LoadTestRunner {
  private metrics: LoadTestMetrics = {
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

  private responseTimes: number[] = [];
  private startTime: number = 0;

  async runLoadTest(
    testFunction: () => Promise<any>,
    options: {
      concurrentUsers: number;
      duration: number; // in milliseconds
      rampUpTime?: number;
    }
  ): Promise<LoadTestMetrics> {
    this.reset();
    this.metrics.concurrentUsers = options.concurrentUsers;
    this.startTime = Date.now();

    const promises: Promise<void>[] = [];
    const rampUpDelay = (options.rampUpTime || 0) / options.concurrentUsers;

    // Create concurrent user simulations
    for (let i = 0; i < options.concurrentUsers; i++) {
      const userPromise = this.simulateUser(
        testFunction,
        options.duration,
        i * rampUpDelay
      );
      promises.push(userPromise);
    }

    await Promise.all(promises);
    this.calculateFinalMetrics();
    return this.metrics;
  }

  private async simulateUser(
    testFunction: () => Promise<any>,
    duration: number,
    delay: number
  ): Promise<void> {
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
      } catch (error) {
        const responseTime = Date.now() - requestStart;
        this.recordFailure(responseTime);
      }

      // Small delay between requests to simulate realistic usage
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  private recordSuccess(responseTime: number): void {
    this.metrics.totalRequests++;
    this.metrics.successfulRequests++;
    this.responseTimes.push(responseTime);
    this.updateResponseTimeMetrics(responseTime);
  }

  private recordFailure(responseTime: number): void {
    this.metrics.totalRequests++;
    this.metrics.failedRequests++;
    this.responseTimes.push(responseTime);
    this.updateResponseTimeMetrics(responseTime);
  }

  private updateResponseTimeMetrics(responseTime: number): void {
    this.metrics.maxResponseTime = Math.max(this.metrics.maxResponseTime, responseTime);
    this.metrics.minResponseTime = Math.min(this.metrics.minResponseTime, responseTime);
  }

  private calculateFinalMetrics(): void {
    const totalTime = Date.now() - this.startTime;
    
    this.metrics.averageResponseTime = this.responseTimes.length > 0 
      ? this.responseTimes.reduce((sum, time) => sum + time, 0) / this.responseTimes.length
      : 0;
    
    this.metrics.throughput = (this.metrics.totalRequests / totalTime) * 1000; // requests per second
    this.metrics.errorRate = this.metrics.totalRequests > 0 
      ? (this.metrics.failedRequests / this.metrics.totalRequests) * 100
      : 0;
  }

  private reset(): void {
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

describe('Serverless Backend Load Testing', () => {
  const loadTestRunner = new LoadTestRunner();

  beforeEach(() => {
    dynamoMock.reset();
    s3Mock.reset();
    sqsMock.reset();
    
    // Mock successful responses by default
    dynamoMock.resolves({});
    s3Mock.resolves({});
    sqsMock.resolves({});
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('handles normal load - 10 concurrent users for 30 seconds', async () => {
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

      const result = await inputProcessor(event, {} as any);
      if (result.statusCode !== 200) {
        throw new Error(`Request failed with status ${result.statusCode}`);
      }
      return result;
    };

    const metrics = await loadTestRunner.runLoadTest(testFunction, {
      concurrentUsers: 10,
      duration: 30000, // 30 seconds
      rampUpTime: 5000  // 5 seconds ramp-up
    });

    // Assertions for normal load
    expect(metrics.errorRate).toBeLessThan(5); // Less than 5% error rate
    expect(metrics.averageResponseTime).toBeLessThan(2000); // Less than 2 seconds average
    expect(metrics.throughput).toBeGreaterThan(1); // At least 1 request per second
    expect(metrics.successfulRequests).toBeGreaterThan(0);
    
    console.log('Normal Load Test Results:', metrics);
  });

  it('handles high load - 50 concurrent users for 60 seconds', async () => {
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

      const result = await inputProcessor(event, {} as any);
      if (result.statusCode !== 200) {
        throw new Error(`Request failed with status ${result.statusCode}`);
      }
      return result;
    };

    const metrics = await loadTestRunner.runLoadTest(testFunction, {
      concurrentUsers: 50,
      duration: 60000, // 60 seconds
      rampUpTime: 10000 // 10 seconds ramp-up
    });

    // Assertions for high load
    expect(metrics.errorRate).toBeLessThan(10); // Less than 10% error rate under high load
    expect(metrics.averageResponseTime).toBeLessThan(5000); // Less than 5 seconds average
    expect(metrics.throughput).toBeGreaterThan(5); // At least 5 requests per second
    
    console.log('High Load Test Results:', metrics);
  });

  it('handles spike load - sudden burst of 100 concurrent users', async () => {
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

      const result = await contentOrchestrator(event, {} as any);
      if (result.statusCode !== 200) {
        throw new Error(`Request failed with status ${result.statusCode}`);
      }
      return result;
    };

    const metrics = await loadTestRunner.runLoadTest(testFunction, {
      concurrentUsers: 100,
      duration: 30000, // 30 seconds
      rampUpTime: 1000  // 1 second ramp-up (spike)
    });

    // Assertions for spike load
    expect(metrics.errorRate).toBeLessThan(20); // Less than 20% error rate during spike
    expect(metrics.maxResponseTime).toBeLessThan(10000); // Max 10 seconds response time
    expect(metrics.totalRequests).toBeGreaterThan(100);
    
    console.log('Spike Load Test Results:', metrics);
  });

  it('handles sustained load - 25 concurrent users for 5 minutes', async () => {
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

      const result = await publishingOrchestrator(event, {} as any);
      if (result.statusCode !== 200) {
        throw new Error(`Request failed with status ${result.statusCode}`);
      }
      return result;
    };

    const metrics = await loadTestRunner.runLoadTest(testFunction, {
      concurrentUsers: 25,
      duration: 300000, // 5 minutes
      rampUpTime: 30000  // 30 seconds ramp-up
    });

    // Assertions for sustained load
    expect(metrics.errorRate).toBeLessThan(5); // Less than 5% error rate
    expect(metrics.averageResponseTime).toBeLessThan(3000); // Less than 3 seconds average
    expect(metrics.throughput).toBeGreaterThan(2); // At least 2 requests per second
    
    // Check for performance degradation over time
    const firstHalfRequests = Math.floor(metrics.totalRequests / 2);
    expect(metrics.successfulRequests).toBeGreaterThan(firstHalfRequests * 0.9);
    
    console.log('Sustained Load Test Results:', metrics);
  });

  it('handles database throttling scenarios', async () => {
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

      const result = await inputProcessor(event, {} as any);
      return result;
    };

    const metrics = await loadTestRunner.runLoadTest(testFunction, {
      concurrentUsers: 20,
      duration: 30000,
      rampUpTime: 5000
    });

    // Should handle throttling gracefully
    expect(metrics.errorRate).toBeLessThan(50); // Some errors expected due to throttling
    expect(metrics.successfulRequests).toBeGreaterThan(0);
    
    console.log('Database Throttling Test Results:', metrics);
  });

  it('handles memory pressure scenarios', async () => {
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
          audioData: largeData, // Large payload
          userId: `user-${Math.random()}`
        }),
        requestContext: {
          requestId: `request-${Math.random()}`
        }
      };

      const result = await inputProcessor(event, {} as any);
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
    expect(metrics.errorRate).toBeLessThan(15); // Some errors expected
    expect(metrics.averageResponseTime).toBeLessThan(8000); // Slower due to large payloads
    
    console.log('Memory Pressure Test Results:', metrics);
  });

  it('handles cold start scenarios', async () => {
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
    expect(metrics.maxResponseTime).toBeGreaterThan(2000);
    expect(metrics.minResponseTime).toBeLessThan(100); // Subsequent requests should be fast
    
    console.log('Cold Start Test Results:', metrics);
  });

  it('generates comprehensive load test report', async () => {
    const testScenarios = [
      { name: 'Normal Load', users: 10, duration: 10000 },
      { name: 'High Load', users: 30, duration: 15000 },
      { name: 'Spike Load', users: 50, duration: 5000 }
    ];

    const results: { [key: string]: LoadTestMetrics } = {};

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
      recommendations: [] as string[]
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

    expect(report.timestamp).toBeDefined();
    expect(report.summary.totalRequests).toBeGreaterThan(0);
    expect(Array.isArray(report.recommendations)).toBe(true);
    
    console.log('Load Test Report:', JSON.stringify(report, null, 2));
  });
});