# Input Processing Pipeline - Test Suite

This directory contains comprehensive tests for the input processing service, covering unit tests, integration tests, and AWS integration tests.

## Test Types

### 1. Unit Tests (`input-processor-integration.test.ts`)
Basic unit tests that verify individual functions and components work correctly without external dependencies.

**Run with:**
```bash
npm test -- --testPathPattern=input-processor-integration.test.ts
```

### 2. End-to-End Integration Tests (`input-processing-e2e.test.ts`)
Comprehensive integration tests that verify the complete input processing pipeline from API requests to responses. These tests run without requiring actual AWS services and are designed to test:

- Complete text processing workflow
- Complete audio processing workflow  
- Status checking and polling
- Error handling and recovery
- CORS and security headers
- Performance and load testing scenarios

**Run with:**
```bash
npm test -- --testPathPattern=input-processing-e2e.test.ts
```

**Features tested:**
- ✅ Text input validation and preprocessing
- ✅ Audio file validation and quality checks
- ✅ API endpoint routing and responses
- ✅ Error handling for malformed requests
- ✅ CORS header configuration
- ✅ Concurrent request handling
- ✅ Large input processing
- ✅ Status polling mechanisms

### 3. AWS Integration Tests (`input-processing-aws-integration.test.ts`)
Real AWS service integration tests that require actual AWS resources. These tests are **skipped by default** and should only be run against a test/staging environment.

**Prerequisites:**
- Deployed AWS infrastructure (test environment)
- Valid AWS credentials configured
- Environment variables set for test resources

**Environment Variables Required:**
```bash
export RUN_AWS_INTEGRATION_TESTS=true
export AUDIO_BUCKET_NAME=your-test-audio-bucket
export CONTENT_TABLE_NAME=your-test-content-table
export EVENT_BUS_NAME=your-test-event-bus
export AWS_REGION=your-aws-region
```

**Run with:**
```bash
RUN_AWS_INTEGRATION_TESTS=true npm test -- --testPathPattern=input-processing-aws-integration.test.ts
```

**Features tested:**
- ✅ Real DynamoDB record creation and retrieval
- ✅ Actual S3 file uploads and downloads
- ✅ AWS Transcribe job creation and status polling
- ✅ EventBridge event publishing
- ✅ End-to-end audio processing with real transcription
- ✅ AWS service error handling
- ✅ Resource cleanup after tests

## Test Coverage

The test suite covers all major aspects of the input processing pipeline:

### Input Validation
- ✅ Text input validation (length, content, user ID)
- ✅ Audio file validation (format, size, quality)
- ✅ Base64 encoding validation
- ✅ Content type validation

### Processing Workflows
- ✅ Text preprocessing and normalization
- ✅ Audio upload to S3
- ✅ Transcription job creation
- ✅ Status tracking and updates
- ✅ Event publishing

### API Endpoints
- ✅ `POST /api/input/text` - Text input processing
- ✅ `POST /api/input/audio` - Audio file upload and processing
- ✅ `GET /api/input/status/{id}` - Status checking
- ✅ `OPTIONS` - CORS preflight handling

### Error Scenarios
- ✅ Invalid input validation
- ✅ Malformed JSON requests
- ✅ Missing request bodies
- ✅ Unsupported HTTP methods
- ✅ AWS service failures
- ✅ Network timeouts and retries

### Performance
- ✅ Concurrent request handling
- ✅ Large input processing
- ✅ Response time validation
- ✅ Memory usage optimization

## Running All Tests

To run the complete test suite (excluding AWS integration tests):

```bash
npm test
```

To run only input processing related tests:

```bash
npm test -- --testPathPattern=input-processing
```

To run with coverage reporting:

```bash
npm test -- --coverage --testPathPattern=input-processing
```

## Test Results Interpretation

### Expected Behavior in Test Environment

When running tests without actual AWS services, you will see error messages like:
```
ValidationException: 1 validation error detected: Value null at 'tableName' failed to satisfy constraint: Member must not be null
```

**This is expected and correct behavior.** The tests are designed to:
1. Verify that the Lambda function handles AWS service failures gracefully
2. Return appropriate HTTP status codes (400, 500) for different error scenarios
3. Include proper error messages and request IDs in responses
4. Maintain CORS headers even during error conditions

### Success Criteria

Tests pass when:
- ✅ All validation logic works correctly
- ✅ API routing functions properly
- ✅ Error handling returns appropriate status codes
- ✅ CORS headers are included in all responses
- ✅ Request/response formats are correct
- ✅ Performance requirements are met

## Continuous Integration

The unit and integration tests (excluding AWS tests) are designed to run in CI/CD pipelines without requiring AWS resources. They provide comprehensive coverage of the business logic, validation, and error handling.

For deployment validation, AWS integration tests should be run against a staging environment before production deployment.

## Troubleshooting

### Common Issues

1. **TypeScript compilation errors**: Run `npm run build` to check for type issues
2. **Test timeouts**: Increase Jest timeout for long-running tests
3. **AWS credential issues**: Ensure AWS credentials are properly configured for integration tests
4. **Environment variables**: Verify all required environment variables are set

### Debug Mode

To run tests with detailed logging:

```bash
DEBUG=* npm test -- --testPathPattern=input-processing-e2e.test.ts
```

## Contributing

When adding new features to the input processing pipeline:

1. Add unit tests for new validation logic
2. Update integration tests for new API endpoints
3. Add AWS integration tests for new AWS service interactions
4. Update this documentation with new test scenarios
5. Ensure all tests pass before submitting changes

## Test Maintenance

- Review and update tests when API contracts change
- Add new test scenarios for edge cases discovered in production
- Keep AWS integration tests in sync with infrastructure changes
- Regularly review test coverage and add missing scenarios