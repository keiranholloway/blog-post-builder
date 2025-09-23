#!/usr/bin/env node

const https = require('https');
const { URL } = require('url');

class PerformanceMonitor {
  constructor(environment) {
    this.environment = environment;
    this.baseUrl = this.getBaseUrl(environment);
    this.metrics = [];
  }

  getBaseUrl(env) {
    switch (env) {
      case 'staging':
        return process.env.STAGING_API_URL || 'https://staging-api.automated-blog-poster.com';
      case 'production':
        return process.env.PRODUCTION_API_URL || 'https://api.automated-blog-poster.com';
      default:
        return 'http://localhost:3000';
    }
  }

  async measureEndpoint(name, path, options = {}) {
    console.log(`Measuring performance: ${name}`);
    const measurements = [];
    const iterations = options.iterations || 10;

    for (let i = 0; i < iterations; i++) {
      const startTime = Date.now();
      
      try {
        const response = await this.httpRequest(path, options.requestOptions);
        const endTime = Date.now();
        const responseTime = endTime - startTime;
        
        measurements.push({
          iteration: i + 1,
          responseTime,
          statusCode: response.statusCode,
          success: response.statusCode >= 200 && response.statusCode < 300
        });

        // Small delay between requests
        if (i < iterations - 1) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      } catch (error) {
        const endTime = Date.now();
        const responseTime = endTime - startTime;
        
        measurements.push({
          iteration: i + 1,
          responseTime,
          statusCode: 0,
          success: false,
          error: error.message
        });
      }
    }

    const metric = this.calculateMetrics(name, measurements);
    this.metrics.push(metric);
    this.printMetric(metric);
    
    return metric;
  }

  calculateMetrics(name, measurements) {
    const successfulMeasurements = measurements.filter(m => m.success);
    const responseTimes = successfulMeasurements.map(m => m.responseTime);
    
    if (responseTimes.length === 0) {
      return {
        name,
        totalRequests: measurements.length,
        successfulRequests: 0,
        failedRequests: measurements.length,
        successRate: 0,
        averageResponseTime: 0,
        minResponseTime: 0,
        maxResponseTime: 0,
        p50: 0,
        p95: 0,
        p99: 0
      };
    }

    responseTimes.sort((a, b) => a - b);
    
    return {
      name,
      totalRequests: measurements.length,
      successfulRequests: successfulMeasurements.length,
      failedRequests: measurements.length - successfulMeasurements.length,
      successRate: (successfulMeasurements.length / measurements.length) * 100,
      averageResponseTime: responseTimes.reduce((sum, time) => sum + time, 0) / responseTimes.length,
      minResponseTime: Math.min(...responseTimes),
      maxResponseTime: Math.max(...responseTimes),
      p50: this.percentile(responseTimes, 50),
      p95: this.percentile(responseTimes, 95),
      p99: this.percentile(responseTimes, 99)
    };
  }

  percentile(sortedArray, percentile) {
    if (sortedArray.length === 0) return 0;
    const index = Math.ceil((percentile / 100) * sortedArray.length) - 1;
    return sortedArray[Math.max(0, Math.min(index, sortedArray.length - 1))];
  }

  printMetric(metric) {
    console.log(`\n📊 ${metric.name} Performance Metrics:`);
    console.log(`   Success Rate: ${metric.successRate.toFixed(1)}%`);
    console.log(`   Average Response Time: ${metric.averageResponseTime.toFixed(0)}ms`);
    console.log(`   Min/Max: ${metric.minResponseTime}ms / ${metric.maxResponseTime}ms`);
    console.log(`   Percentiles: P50=${metric.p50}ms, P95=${metric.p95}ms, P99=${metric.p99}ms`);
  }

  async httpRequest(path, options = {}) {
    return new Promise((resolve, reject) => {
      const url = new URL(path, this.baseUrl);
      const requestOptions = {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname + url.search,
        method: options.method || 'GET',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'PerformanceMonitor/1.0',
          ...options.headers
        },
        timeout: 30000
      };

      const req = https.request(requestOptions, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: data
          });
        });
      });

      req.on('error', reject);
      req.on('timeout', () => reject(new Error('Request timeout')));

      if (options.body) {
        req.write(JSON.stringify(options.body));
      }

      req.end();
    });
  }

  async runPerformanceMonitoring() {
    console.log(`\n🚀 Running performance monitoring for ${this.environment} environment`);
    console.log(`Base URL: ${this.baseUrl}\n`);

    // Monitor critical endpoints
    await this.measureEndpoint('Health Check', '/api/health', {
      iterations: 20,
      requestOptions: { method: 'GET' }
    });

    await this.measureEndpoint('Audio Processing', '/api/process-audio', {
      iterations: 10,
      requestOptions: {
        method: 'POST',
        headers: { 'Authorization': 'Bearer test-token' },
        body: { audioData: 'test-data', userId: 'test-user' }
      }
    });

    await this.measureEndpoint('Content Status', '/api/content-status/test-id', {
      iterations: 15,
      requestOptions: {
        method: 'GET',
        headers: { 'Authorization': 'Bearer test-token' }
      }
    });

    await this.measureEndpoint('Publishing', '/api/publish', {
      iterations: 5,
      requestOptions: {
        method: 'POST',
        headers: { 'Authorization': 'Bearer test-token' },
        body: { contentId: 'test-id', platforms: ['medium'] }
      }
    });

    this.generateReport();
    return this.metrics;
  }

  generateReport() {
    console.log('\n📈 Performance Monitoring Report');
    console.log('==================================');
    
    const overallMetrics = {
      totalEndpoints: this.metrics.length,
      averageSuccessRate: this.metrics.reduce((sum, m) => sum + m.successRate, 0) / this.metrics.length,
      averageResponseTime: this.metrics.reduce((sum, m) => sum + m.averageResponseTime, 0) / this.metrics.length,
      slowestEndpoint: this.metrics.reduce((slowest, current) => 
        current.averageResponseTime > slowest.averageResponseTime ? current : slowest
      ),
      fastestEndpoint: this.metrics.reduce((fastest, current) => 
        current.averageResponseTime < fastest.averageResponseTime ? current : fastest
      )
    };

    console.log(`Overall Success Rate: ${overallMetrics.averageSuccessRate.toFixed(1)}%`);
    console.log(`Overall Average Response Time: ${overallMetrics.averageResponseTime.toFixed(0)}ms`);
    console.log(`Slowest Endpoint: ${overallMetrics.slowestEndpoint.name} (${overallMetrics.slowestEndpoint.averageResponseTime.toFixed(0)}ms)`);
    console.log(`Fastest Endpoint: ${overallMetrics.fastestEndpoint.name} (${overallMetrics.fastestEndpoint.averageResponseTime.toFixed(0)}ms)`);

    // Performance alerts
    console.log('\n⚠️ Performance Alerts:');
    let alertCount = 0;

    this.metrics.forEach(metric => {
      if (metric.successRate < 95) {
        console.log(`  - ${metric.name}: Low success rate (${metric.successRate.toFixed(1)}%)`);
        alertCount++;
      }
      if (metric.averageResponseTime > 3000) {
        console.log(`  - ${metric.name}: High response time (${metric.averageResponseTime.toFixed(0)}ms)`);
        alertCount++;
      }
      if (metric.p95 > 5000) {
        console.log(`  - ${metric.name}: High P95 response time (${metric.p95}ms)`);
        alertCount++;
      }
    });

    if (alertCount === 0) {
      console.log('  No performance alerts - all systems performing well');
    }

    // Recommendations
    console.log('\n💡 Recommendations:');
    if (overallMetrics.averageResponseTime > 2000) {
      console.log('  - Consider optimizing slow endpoints or scaling resources');
    }
    if (overallMetrics.averageSuccessRate < 99) {
      console.log('  - Investigate and fix reliability issues');
    }
    if (alertCount > 2) {
      console.log('  - Multiple performance issues detected - prioritize optimization');
    }
    if (alertCount === 0 && overallMetrics.averageSuccessRate > 99) {
      console.log('  - System performance is excellent - maintain current optimization');
    }

    console.log('\n');
  }
}

async function main() {
  const environment = process.argv.find(arg => arg.startsWith('--env='))?.split('=')[1] || 'production';
  const monitor = new PerformanceMonitor(environment);
  
  try {
    const metrics = await monitor.runPerformanceMonitoring();
    
    // Check if performance is acceptable
    const averageSuccessRate = metrics.reduce((sum, m) => sum + m.successRate, 0) / metrics.length;
    const averageResponseTime = metrics.reduce((sum, m) => sum + m.averageResponseTime, 0) / metrics.length;
    
    if (averageSuccessRate < 95 || averageResponseTime > 5000) {
      console.log('❌ Performance monitoring detected issues');
      process.exit(1);
    } else {
      console.log('✅ Performance monitoring completed successfully');
      process.exit(0);
    }
  } catch (error) {
    console.error('❌ Performance monitoring failed:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { PerformanceMonitor };