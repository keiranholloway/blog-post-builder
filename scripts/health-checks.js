#!/usr/bin/env node

const https = require('https');
const { URL } = require('url');

class HealthCheckRunner {
  constructor(environment) {
    this.environment = environment;
    this.baseUrl = this.getBaseUrl(environment);
    this.results = [];
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

  async runHealthCheck(name, checkFn, thresholds = {}) {
    console.log(`Running health check: ${name}`);
    const startTime = Date.now();
    
    try {
      const result = await checkFn();
      const duration = Date.now() - startTime;
      
      // Apply thresholds
      const status = this.evaluateThresholds(result, thresholds, duration);
      
      this.results.push({ 
        name, 
        status, 
        duration, 
        metrics: result,
        thresholds 
      });
      
      const statusIcon = status === 'HEALTHY' ? '✅' : status === 'WARNING' ? '⚠️' : '❌';
      console.log(`${statusIcon} ${name} - ${status} (${duration}ms)`);
      
      if (result.details) {
        console.log(`   Details: ${JSON.stringify(result.details)}`);
      }
    } catch (error) {
      const duration = Date.now() - startTime;
      this.results.push({ 
        name, 
        status: 'UNHEALTHY', 
        duration, 
        error: error.message 
      });
      console.log(`❌ ${name} - UNHEALTHY (${duration}ms): ${error.message}`);
    }
  }

  evaluateThresholds(result, thresholds, duration) {
    // Check response time threshold
    if (thresholds.maxResponseTime && duration > thresholds.maxResponseTime) {
      return 'WARNING';
    }

    // Check custom metric thresholds
    if (thresholds.metrics) {
      for (const [metric, threshold] of Object.entries(thresholds.metrics)) {
        const value = result[metric];
        if (value !== undefined) {
          if (threshold.max && value > threshold.max) return 'WARNING';
          if (threshold.min && value < threshold.min) return 'WARNING';
        }
      }
    }

    return 'HEALTHY';
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
          'User-Agent': 'HealthCheck/1.0',
          ...options.headers
        },
        timeout: 15000
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

  async runAllHealthChecks() {
    console.log(`\n🏥 Running health checks for ${this.environment} environment`);
    console.log(`Base URL: ${this.baseUrl}\n`);

    // Health Check 1: API Gateway Response Time
    await this.runHealthCheck('API Gateway Response Time', async () => {
      const response = await this.httpRequest('/api/health');
      if (response.statusCode !== 200) {
        throw new Error(`Health endpoint returned ${response.statusCode}`);
      }
      
      const body = JSON.parse(response.body);
      return {
        responseTime: Date.now(),
        status: body.status,
        details: body
      };
    }, {
      maxResponseTime: 2000 // 2 seconds
    });

    // Health Check 2: Database Performance
    await this.runHealthCheck('Database Performance', async () => {
      const response = await this.httpRequest('/api/health/database');
      if (response.statusCode !== 200) {
        throw new Error(`Database health check failed with ${response.statusCode}`);
      }
      
      const body = JSON.parse(response.body);
      return {
        connectionTime: body.connectionTime,
        queryTime: body.queryTime,
        activeConnections: body.activeConnections,
        details: body
      };
    }, {
      maxResponseTime: 3000,
      metrics: {
        connectionTime: { max: 1000 },
        queryTime: { max: 500 },
        activeConnections: { max: 100 }
      }
    });

    // Health Check 3: Storage System
    await this.runHealthCheck('Storage System', async () => {
      const response = await this.httpRequest('/api/health/storage');
      if (response.statusCode !== 200) {
        throw new Error(`Storage health check failed with ${response.statusCode}`);
      }
      
      const body = JSON.parse(response.body);
      return {
        uploadTime: body.uploadTime,
        downloadTime: body.downloadTime,
        storageUsage: body.storageUsage,
        details: body
      };
    }, {
      maxResponseTime: 5000,
      metrics: {
        uploadTime: { max: 2000 },
        downloadTime: { max: 1000 },
        storageUsage: { max: 80 } // 80% max usage
      }
    });

    // Health Check 4: Message Queue System
    await this.runHealthCheck('Message Queue System', async () => {
      const response = await this.httpRequest('/api/health/queue');
      if (response.statusCode !== 200) {
        throw new Error(`Queue health check failed with ${response.statusCode}`);
      }
      
      const body = JSON.parse(response.body);
      return {
        queueDepth: body.queueDepth,
        processingRate: body.processingRate,
        deadLetterQueue: body.deadLetterQueue,
        details: body
      };
    }, {
      maxResponseTime: 2000,
      metrics: {
        queueDepth: { max: 1000 },
        processingRate: { min: 10 }, // At least 10 messages per second
        deadLetterQueue: { max: 10 } // Max 10 messages in DLQ
      }
    });

    // Health Check 5: External Dependencies
    await this.runHealthCheck('External Dependencies', async () => {
      const response = await this.httpRequest('/api/health/dependencies');
      if (response.statusCode !== 200) {
        throw new Error(`Dependencies health check failed with ${response.statusCode}`);
      }
      
      const body = JSON.parse(response.body);
      return {
        transcriptionService: body.transcriptionService,
        contentGenerationService: body.contentGenerationService,
        imageGenerationService: body.imageGenerationService,
        publishingServices: body.publishingServices,
        details: body
      };
    }, {
      maxResponseTime: 10000 // External services may be slower
    });

    // Health Check 6: Memory and CPU Usage
    await this.runHealthCheck('System Resources', async () => {
      const response = await this.httpRequest('/api/health/resources');
      if (response.statusCode !== 200) {
        throw new Error(`Resources health check failed with ${response.statusCode}`);
      }
      
      const body = JSON.parse(response.body);
      return {
        memoryUsage: body.memoryUsage,
        cpuUsage: body.cpuUsage,
        diskUsage: body.diskUsage,
        details: body
      };
    }, {
      maxResponseTime: 1000,
      metrics: {
        memoryUsage: { max: 80 }, // 80% max memory usage
        cpuUsage: { max: 70 },    // 70% max CPU usage
        diskUsage: { max: 85 }    // 85% max disk usage
      }
    });

    // Health Check 7: Security and Authentication
    await this.runHealthCheck('Security Systems', async () => {
      const response = await this.httpRequest('/api/health/security');
      if (response.statusCode !== 200) {
        throw new Error(`Security health check failed with ${response.statusCode}`);
      }
      
      const body = JSON.parse(response.body);
      return {
        authenticationService: body.authenticationService,
        encryptionService: body.encryptionService,
        certificateExpiry: body.certificateExpiry,
        details: body
      };
    }, {
      maxResponseTime: 2000,
      metrics: {
        certificateExpiry: { min: 30 } // At least 30 days until expiry
      }
    });

    // Health Check 8: End-to-End Workflow
    await this.runHealthCheck('End-to-End Workflow', async () => {
      const response = await this.httpRequest('/api/health/workflow');
      if (response.statusCode !== 200) {
        throw new Error(`Workflow health check failed with ${response.statusCode}`);
      }
      
      const body = JSON.parse(response.body);
      return {
        inputProcessing: body.inputProcessing,
        contentGeneration: body.contentGeneration,
        imageGeneration: body.imageGeneration,
        publishing: body.publishing,
        overallLatency: body.overallLatency,
        details: body
      };
    }, {
      maxResponseTime: 30000, // 30 seconds for full workflow
      metrics: {
        overallLatency: { max: 25000 } // Max 25 seconds end-to-end
      }
    });

    this.printResults();
    return this.results;
  }

  printResults() {
    console.log('\n📊 Health Check Results:');
    console.log('==========================');
    
    const healthy = this.results.filter(r => r.status === 'HEALTHY').length;
    const warning = this.results.filter(r => r.status === 'WARNING').length;
    const unhealthy = this.results.filter(r => r.status === 'UNHEALTHY').length;
    const total = this.results.length;
    
    console.log(`Total Checks: ${total}`);
    console.log(`Healthy: ${healthy}`);
    console.log(`Warning: ${warning}`);
    console.log(`Unhealthy: ${unhealthy}`);
    
    const healthScore = ((healthy + (warning * 0.5)) / total * 100).toFixed(1);
    console.log(`Health Score: ${healthScore}%`);
    
    if (warning > 0) {
      console.log('\n⚠️ Warning Conditions:');
      this.results
        .filter(r => r.status === 'WARNING')
        .forEach(r => {
          console.log(`  - ${r.name}: Performance degraded`);
          if (r.metrics) {
            console.log(`    Metrics: ${JSON.stringify(r.metrics)}`);
          }
        });
    }
    
    if (unhealthy > 0) {
      console.log('\n❌ Unhealthy Systems:');
      this.results
        .filter(r => r.status === 'UNHEALTHY')
        .forEach(r => console.log(`  - ${r.name}: ${r.error || 'System failure'}`));
    }
    
    // Generate recommendations
    console.log('\n💡 Recommendations:');
    if (healthScore < 80) {
      console.log('  - System health is below optimal. Investigate failing components.');
    }
    if (warning > 0) {
      console.log('  - Monitor warning conditions closely to prevent degradation.');
    }
    if (unhealthy === 0 && warning === 0) {
      console.log('  - All systems operating normally. Continue monitoring.');
    }
    
    console.log('\n');
  }
}

async function main() {
  const environment = process.argv.find(arg => arg.startsWith('--env='))?.split('=')[1] || 'local';
  const runner = new HealthCheckRunner(environment);
  
  try {
    const results = await runner.runAllHealthChecks();
    const unhealthyChecks = results.filter(r => r.status === 'UNHEALTHY').length;
    const warningChecks = results.filter(r => r.status === 'WARNING').length;
    
    if (unhealthyChecks > 0) {
      console.log(`❌ ${unhealthyChecks} health checks failed`);
      process.exit(1);
    } else if (warningChecks > 2) { // Allow up to 2 warnings
      console.log(`⚠️ Too many warnings (${warningChecks}), system may be degraded`);
      process.exit(1);
    } else {
      console.log('✅ All health checks passed');
      process.exit(0);
    }
  } catch (error) {
    console.error('❌ Health check runner failed:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { HealthCheckRunner };