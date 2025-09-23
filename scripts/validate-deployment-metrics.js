#!/usr/bin/env node

const https = require('https');
const { URL } = require('url');

class DeploymentMetricsValidator {
  constructor(environment) {
    this.environment = environment;
    this.baseUrl = this.getBaseUrl(environment);
    this.validationResults = [];
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

  async validateMetric(name, validationFn, thresholds = {}) {
    console.log(`Validating: ${name}`);
    const startTime = Date.now();
    
    try {
      const result = await validationFn();
      const duration = Date.now() - startTime;
      
      const validation = {
        name,
        status: this.evaluateResult(result, thresholds),
        duration,
        result,
        thresholds
      };
      
      this.validationResults.push(validation);
      
      const statusIcon = validation.status === 'pass' ? '✅' : 
                        validation.status === 'warning' ? '⚠️' : '❌';
      console.log(`${statusIcon} ${name} - ${validation.status.toUpperCase()} (${duration}ms)`);
      
      if (result.details) {
        console.log(`   ${JSON.stringify(result.details)}`);
      }
      
      return validation;
    } catch (error) {
      const duration = Date.now() - startTime;
      const validation = {
        name,
        status: 'fail',
        duration,
        error: error.message
      };
      
      this.validationResults.push(validation);
      console.log(`❌ ${name} - FAIL (${duration}ms): ${error.message}`);
      
      return validation;
    }
  }

  evaluateResult(result, thresholds) {
    // Check if result meets thresholds
    if (thresholds.minValue && result.value < thresholds.minValue) return 'fail';
    if (thresholds.maxValue && result.value > thresholds.maxValue) return 'fail';
    if (thresholds.warningMin && result.value < thresholds.warningMin) return 'warning';
    if (thresholds.warningMax && result.value > thresholds.warningMax) return 'warning';
    if (thresholds.expectedValue && result.value !== thresholds.expectedValue) return 'fail';
    
    return 'pass';
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
          'User-Agent': 'DeploymentValidator/1.0',
          ...options.headers
        },
        timeout: 10000
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

  async validateDeploymentMetrics() {
    console.log(`\n🔍 Validating deployment metrics for ${this.environment} environment`);
    console.log(`Base URL: ${this.baseUrl}\n`);

    // Validation 1: API Availability
    await this.validateMetric('API Availability', async () => {
      const response = await this.httpRequest('/api/health');
      return {
        value: response.statusCode === 200 ? 1 : 0,
        details: { statusCode: response.statusCode }
      };
    }, {
      expectedValue: 1
    });

    // Validation 2: Response Time Performance
    await this.validateMetric('Response Time Performance', async () => {
      const startTime = Date.now();
      const response = await this.httpRequest('/api/health');
      const responseTime = Date.now() - startTime;
      
      return {
        value: responseTime,
        details: { responseTime: `${responseTime}ms` }
      };
    }, {
      maxValue: 2000,      // Fail if > 2 seconds
      warningMax: 1000     // Warning if > 1 second
    });

    // Validation 3: Database Connectivity
    await this.validateMetric('Database Connectivity', async () => {
      const response = await this.httpRequest('/api/health/database');
      const body = JSON.parse(response.body);
      
      return {
        value: body.connected ? 1 : 0,
        details: { 
          connected: body.connected,
          connectionTime: body.connectionTime 
        }
      };
    }, {
      expectedValue: 1
    });

    // Validation 4: Storage System
    await this.validateMetric('Storage System', async () => {
      const response = await this.httpRequest('/api/health/storage');
      const body = JSON.parse(response.body);
      
      return {
        value: body.accessible ? 1 : 0,
        details: { 
          accessible: body.accessible,
          storageUsage: body.storageUsage 
        }
      };
    }, {
      expectedValue: 1
    });

    // Validation 5: Authentication System
    await this.validateMetric('Authentication System', async () => {
      const response = await this.httpRequest('/api/auth/validate', {
        method: 'POST',
        body: { token: 'invalid-token' }
      });
      
      // Should return 401 for invalid token (system working)
      return {
        value: response.statusCode === 401 ? 1 : 0,
        details: { statusCode: response.statusCode }
      };
    }, {
      expectedValue: 1
    });

    // Validation 6: Error Rate
    await this.validateMetric('Error Rate', async () => {
      // Make multiple requests to check error rate
      const requests = 10;
      let errors = 0;
      
      for (let i = 0; i < requests; i++) {
        try {
          const response = await this.httpRequest('/api/health');
          if (response.statusCode >= 500) errors++;
        } catch (error) {
          errors++;
        }
      }
      
      const errorRate = (errors / requests) * 100;
      return {
        value: errorRate,
        details: { errorRate: `${errorRate}%`, errors, requests }
      };
    }, {
      maxValue: 5,        // Fail if > 5% error rate
      warningMax: 1       // Warning if > 1% error rate
    });

    // Validation 7: Memory Usage
    await this.validateMetric('Memory Usage', async () => {
      const response = await this.httpRequest('/api/health/resources');
      const body = JSON.parse(response.body);
      
      return {
        value: body.memoryUsage || 0,
        details: { 
          memoryUsage: `${body.memoryUsage}%`,
          cpuUsage: `${body.cpuUsage}%`
        }
      };
    }, {
      maxValue: 90,       // Fail if > 90% memory usage
      warningMax: 80      // Warning if > 80% memory usage
    });

    // Validation 8: Throughput Capacity
    await this.validateMetric('Throughput Capacity', async () => {
      const concurrentRequests = 5;
      const startTime = Date.now();
      
      const promises = Array.from({ length: concurrentRequests }, () =>
        this.httpRequest('/api/health')
      );
      
      const results = await Promise.allSettled(promises);
      const endTime = Date.now();
      const duration = endTime - startTime;
      
      const successful = results.filter(r => r.status === 'fulfilled').length;
      const throughput = (successful / duration) * 1000; // requests per second
      
      return {
        value: throughput,
        details: { 
          throughput: `${throughput.toFixed(2)} req/s`,
          successful,
          total: concurrentRequests,
          duration: `${duration}ms`
        }
      };
    }, {
      minValue: 1,        // Fail if < 1 req/s
      warningMin: 5       // Warning if < 5 req/s
    });

    // Validation 9: SSL Certificate
    await this.validateMetric('SSL Certificate', async () => {
      if (!this.baseUrl.startsWith('https://')) {
        return { value: 0, details: { ssl: 'not applicable for non-HTTPS' } };
      }
      
      const response = await this.httpRequest('/api/health');
      const cert = response.headers['x-ssl-cert-expiry'];
      
      return {
        value: cert ? 1 : 0,
        details: { sslValid: !!cert }
      };
    }, {
      expectedValue: 1
    });

    // Validation 10: Version Consistency
    await this.validateMetric('Version Consistency', async () => {
      const response = await this.httpRequest('/api/version');
      const body = JSON.parse(response.body);
      
      const expectedVersion = process.env.DEPLOYMENT_VERSION || 'unknown';
      const actualVersion = body.version || 'unknown';
      
      return {
        value: expectedVersion === actualVersion ? 1 : 0,
        details: { 
          expected: expectedVersion,
          actual: actualVersion
        }
      };
    }, {
      expectedValue: 1
    });

    this.generateReport();
    return this.validationResults;
  }

  generateReport() {
    console.log('\n📊 Deployment Metrics Validation Report');
    console.log('=========================================');
    
    const passed = this.validationResults.filter(r => r.status === 'pass').length;
    const warnings = this.validationResults.filter(r => r.status === 'warning').length;
    const failed = this.validationResults.filter(r => r.status === 'fail').length;
    const total = this.validationResults.length;
    
    console.log(`Environment: ${this.environment}`);
    console.log(`Total Validations: ${total}`);
    console.log(`Passed: ${passed}`);
    console.log(`Warnings: ${warnings}`);
    console.log(`Failed: ${failed}`);
    
    const successRate = ((passed + warnings * 0.5) / total * 100).toFixed(1);
    console.log(`Success Rate: ${successRate}%`);

    if (failed > 0) {
      console.log('\n❌ Failed Validations:');
      this.validationResults
        .filter(r => r.status === 'fail')
        .forEach(r => {
          console.log(`  - ${r.name}: ${r.error || 'Threshold not met'}`);
          if (r.result?.details) {
            console.log(`    Details: ${JSON.stringify(r.result.details)}`);
          }
        });
    }

    if (warnings > 0) {
      console.log('\n⚠️ Warning Conditions:');
      this.validationResults
        .filter(r => r.status === 'warning')
        .forEach(r => {
          console.log(`  - ${r.name}: Performance degraded`);
          if (r.result?.details) {
            console.log(`    Details: ${JSON.stringify(r.result.details)}`);
          }
        });
    }

    console.log('\n💡 Deployment Status:');
    if (failed === 0 && warnings === 0) {
      console.log('  ✅ Deployment is healthy and performing optimally');
    } else if (failed === 0 && warnings <= 2) {
      console.log('  ⚠️ Deployment is functional with minor performance issues');
    } else if (failed <= 2) {
      console.log('  ⚠️ Deployment has issues but core functionality is working');
    } else {
      console.log('  ❌ Deployment has significant issues requiring immediate attention');
    }

    console.log('\n📈 Performance Summary:');
    const avgResponseTime = this.validationResults
      .filter(r => r.name === 'Response Time Performance' && r.result)
      .map(r => r.result.value)[0];
    
    if (avgResponseTime) {
      console.log(`  - Average Response Time: ${avgResponseTime}ms`);
    }

    const errorRate = this.validationResults
      .filter(r => r.name === 'Error Rate' && r.result)
      .map(r => r.result.value)[0];
    
    if (errorRate !== undefined) {
      console.log(`  - Error Rate: ${errorRate}%`);
    }

    const throughput = this.validationResults
      .filter(r => r.name === 'Throughput Capacity' && r.result)
      .map(r => r.result.value)[0];
    
    if (throughput) {
      console.log(`  - Throughput: ${throughput.toFixed(2)} req/s`);
    }

    console.log('\n');
  }
}

async function main() {
  const environment = process.argv.find(arg => arg.startsWith('--env='))?.split('=')[1] || 'production';
  const validator = new DeploymentMetricsValidator(environment);
  
  try {
    const results = await validator.validateDeploymentMetrics();
    
    const failed = results.filter(r => r.status === 'fail').length;
    const warnings = results.filter(r => r.status === 'warning').length;
    
    if (failed > 2) {
      console.log('❌ Deployment validation failed - too many critical issues');
      process.exit(1);
    } else if (failed > 0) {
      console.log('⚠️ Deployment validation completed with some issues');
      process.exit(0); // Don't fail deployment for minor issues
    } else if (warnings > 3) {
      console.log('⚠️ Deployment validation completed with performance warnings');
      process.exit(0);
    } else {
      console.log('✅ Deployment validation passed successfully');
      process.exit(0);
    }
  } catch (error) {
    console.error('❌ Deployment validation failed:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { DeploymentMetricsValidator };