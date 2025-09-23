#!/usr/bin/env node

const https = require('https');
const { URL } = require('url');

class SmokeTestRunner {
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

  async runTest(name, testFn) {
    console.log(`Running smoke test: ${name}`);
    const startTime = Date.now();
    
    try {
      await testFn();
      const duration = Date.now() - startTime;
      this.results.push({ name, status: 'PASS', duration });
      console.log(`✅ ${name} - PASSED (${duration}ms)`);
    } catch (error) {
      const duration = Date.now() - startTime;
      this.results.push({ name, status: 'FAIL', duration, error: error.message });
      console.log(`❌ ${name} - FAILED (${duration}ms): ${error.message}`);
    }
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
          'User-Agent': 'SmokeTest/1.0',
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

  async runAllTests() {
    console.log(`\n🚀 Running smoke tests for ${this.environment} environment`);
    console.log(`Base URL: ${this.baseUrl}\n`);

    // Test 1: Health check endpoint
    await this.runTest('Health Check', async () => {
      const response = await this.httpRequest('/api/health');
      if (response.statusCode !== 200) {
        throw new Error(`Health check failed with status ${response.statusCode}`);
      }
      
      const body = JSON.parse(response.body);
      if (body.status !== 'healthy') {
        throw new Error(`Health check returned unhealthy status: ${body.status}`);
      }
    });

    // Test 2: API Gateway CORS
    await this.runTest('CORS Configuration', async () => {
      const response = await this.httpRequest('/api/health', {
        method: 'OPTIONS',
        headers: {
          'Origin': 'https://automated-blog-poster.github.io',
          'Access-Control-Request-Method': 'POST'
        }
      });
      
      if (response.statusCode !== 200) {
        throw new Error(`CORS preflight failed with status ${response.statusCode}`);
      }
      
      if (!response.headers['access-control-allow-origin']) {
        throw new Error('CORS headers not present');
      }
    });

    // Test 3: Authentication endpoint
    await this.runTest('Authentication Endpoint', async () => {
      const response = await this.httpRequest('/api/auth/validate', {
        method: 'POST',
        body: { token: 'invalid-token' }
      });
      
      // Should return 401 for invalid token
      if (response.statusCode !== 401) {
        throw new Error(`Auth endpoint should return 401 for invalid token, got ${response.statusCode}`);
      }
    });

    // Test 4: Input processing endpoint availability
    await this.runTest('Input Processing Endpoint', async () => {
      const response = await this.httpRequest('/api/process-audio', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer invalid-token'
        },
        body: { audioData: 'test' }
      });
      
      // Should return 401 for invalid auth, not 404
      if (response.statusCode === 404) {
        throw new Error('Input processing endpoint not found');
      }
    });

    // Test 5: Content status endpoint
    await this.runTest('Content Status Endpoint', async () => {
      const response = await this.httpRequest('/api/content-status/test-id', {
        headers: {
          'Authorization': 'Bearer invalid-token'
        }
      });
      
      // Should return 401 for invalid auth, not 404
      if (response.statusCode === 404) {
        throw new Error('Content status endpoint not found');
      }
    });

    // Test 6: Publishing endpoint
    await this.runTest('Publishing Endpoint', async () => {
      const response = await this.httpRequest('/api/publish', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer invalid-token'
        },
        body: { contentId: 'test', platforms: ['medium'] }
      });
      
      // Should return 401 for invalid auth, not 404
      if (response.statusCode === 404) {
        throw new Error('Publishing endpoint not found');
      }
    });

    // Test 7: Database connectivity (indirect test)
    await this.runTest('Database Connectivity', async () => {
      const response = await this.httpRequest('/api/health/database');
      if (response.statusCode !== 200) {
        throw new Error(`Database health check failed with status ${response.statusCode}`);
      }
    });

    // Test 8: S3 connectivity (indirect test)
    await this.runTest('Storage Connectivity', async () => {
      const response = await this.httpRequest('/api/health/storage');
      if (response.statusCode !== 200) {
        throw new Error(`Storage health check failed with status ${response.statusCode}`);
      }
    });

    this.printResults();
    return this.results;
  }

  printResults() {
    console.log('\n📊 Smoke Test Results:');
    console.log('========================');
    
    const passed = this.results.filter(r => r.status === 'PASS').length;
    const failed = this.results.filter(r => r.status === 'FAIL').length;
    const total = this.results.length;
    
    console.log(`Total Tests: ${total}`);
    console.log(`Passed: ${passed}`);
    console.log(`Failed: ${failed}`);
    console.log(`Success Rate: ${((passed / total) * 100).toFixed(1)}%`);
    
    if (failed > 0) {
      console.log('\n❌ Failed Tests:');
      this.results
        .filter(r => r.status === 'FAIL')
        .forEach(r => console.log(`  - ${r.name}: ${r.error}`));
    }
    
    console.log('\n');
  }
}

async function main() {
  const environment = process.argv.find(arg => arg.startsWith('--env='))?.split('=')[1] || 'local';
  const runner = new SmokeTestRunner(environment);
  
  try {
    const results = await runner.runAllTests();
    const failedTests = results.filter(r => r.status === 'FAIL').length;
    
    if (failedTests > 0) {
      console.log(`❌ ${failedTests} smoke tests failed`);
      process.exit(1);
    } else {
      console.log('✅ All smoke tests passed');
      process.exit(0);
    }
  } catch (error) {
    console.error('❌ Smoke test runner failed:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { SmokeTestRunner };