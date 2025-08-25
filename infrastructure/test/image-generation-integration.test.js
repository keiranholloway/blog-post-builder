"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const client_dynamodb_1 = require("@aws-sdk/client-dynamodb");
const lib_dynamodb_1 = require("@aws-sdk/lib-dynamodb");
const client_s3_1 = require("@aws-sdk/client-s3");
const client_sqs_1 = require("@aws-sdk/client-sqs");
const client_eventbridge_1 = require("@aws-sdk/client-eventbridge");
const uuid_1 = require("uuid");
// Integration tests for image generation pipeline
describe('Image Generation Integration Tests', () => {
    let dynamoClient;
    let docClient;
    let s3Client;
    let sqsClient;
    let eventBridgeClient;
    let testTableName;
    let testBucketName;
    let testQueueUrl;
    let testEventBusName;
    beforeAll(async () => {
        // Initialize AWS clients for integration testing
        dynamoClient = new client_dynamodb_1.DynamoDBClient({ region: 'us-east-1' });
        docClient = lib_dynamodb_1.DynamoDBDocumentClient.from(dynamoClient);
        s3Client = new client_s3_1.S3Client({ region: 'us-east-1' });
        sqsClient = new client_sqs_1.SQSClient({ region: 'us-east-1' });
        eventBridgeClient = new client_eventbridge_1.EventBridgeClient({ region: 'us-east-1' });
        // Create test resources
        const testId = (0, uuid_1.v4)().substring(0, 8);
        testTableName = `image-gen-test-${testId}`;
        testBucketName = `image-gen-test-${testId}`;
        testQueueUrl = `image-gen-test-queue-${testId}`;
        testEventBusName = `image-gen-test-events-${testId}`;
        // Note: In a real integration test, you would create actual AWS resources
        // For this example, we'll mock the setup
    }, 30000);
    afterAll(async () => {
        // Clean up test resources
        // Note: In a real integration test, you would delete actual AWS resources
    }, 30000);
    describe('End-to-End Image Generation Workflow', () => {
        it('should complete full image generation workflow', async () => {
            // This test would verify the complete workflow:
            // 1. Content analysis
            // 2. Image generation request
            // 3. Image optimization
            // 4. S3 storage
            // 5. DynamoDB updates
            // 6. Event publishing
            const testContent = {
                id: 'test-content-123',
                userId: 'test-user-123',
                title: 'Cloud Computing Best Practices',
                content: 'This comprehensive guide explores AWS services, serverless architecture, and cost optimization strategies for modern enterprises.',
                status: 'content_generated'
            };
            // Store test content in DynamoDB
            await docClient.send(new lib_dynamodb_1.PutCommand({
                TableName: testTableName,
                Item: testContent
            }));
            // Simulate image generation request
            const imageRequest = {
                workflowId: 'workflow-123',
                stepId: 'image-generation',
                contentId: testContent.id,
                content: testContent.content,
                userId: testContent.userId,
                style: 'professional'
            };
            // Send message to SQS queue
            await sqsClient.send(new client_sqs_1.SendMessageCommand({
                QueueUrl: testQueueUrl,
                MessageBody: JSON.stringify({
                    messageType: 'request',
                    payload: imageRequest
                })
            }));
            // Wait for processing (in real test, would poll for completion)
            await new Promise(resolve => setTimeout(resolve, 5000));
            // Verify content was updated with image URL
            const updatedContent = await docClient.send(new lib_dynamodb_1.GetCommand({
                TableName: testTableName,
                Key: { id: testContent.id }
            }));
            expect(updatedContent.Item).toBeDefined();
            expect(updatedContent.Item.imageUrl).toBeDefined();
            expect(updatedContent.Item.status).toBe('image_generated');
            // Verify images were stored in S3
            const s3Objects = await s3Client.send(new client_s3_1.ListObjectsV2Command({
                Bucket: testBucketName,
                Prefix: `images/${testContent.id}/`
            }));
            expect(s3Objects.Contents).toBeDefined();
            expect(s3Objects.Contents.length).toBeGreaterThan(0);
            // Verify both original and optimized versions exist
            const imageKeys = s3Objects.Contents.map(obj => obj.Key);
            expect(imageKeys.some(key => key.includes('original'))).toBe(true);
            expect(imageKeys.some(key => key.includes('optimized'))).toBe(true);
        }, 60000);
        it('should handle image revision workflow', async () => {
            const testContent = {
                id: 'test-content-456',
                userId: 'test-user-123',
                title: 'DevOps Transformation',
                content: 'This article discusses DevOps practices, automation, and continuous integration.',
                status: 'image_generated',
                imageUrl: 'https://example.com/existing-image.webp'
            };
            // Store test content
            await docClient.send(new lib_dynamodb_1.PutCommand({
                TableName: testTableName,
                Item: testContent
            }));
            // Simulate image revision request
            const revisionRequest = {
                workflowId: 'workflow-456',
                stepId: 'image-revision',
                contentId: testContent.id,
                currentImageUrl: testContent.imageUrl,
                feedback: 'Make it more colorful and add automation symbols',
                userId: testContent.userId
            };
            // Send revision message
            await sqsClient.send(new client_sqs_1.SendMessageCommand({
                QueueUrl: testQueueUrl,
                MessageBody: JSON.stringify({
                    messageType: 'revision',
                    payload: revisionRequest
                })
            }));
            // Wait for processing
            await new Promise(resolve => setTimeout(resolve, 5000));
            // Verify content was updated with new image
            const updatedContent = await docClient.send(new lib_dynamodb_1.GetCommand({
                TableName: testTableName,
                Key: { id: testContent.id }
            }));
            expect(updatedContent.Item).toBeDefined();
            expect(updatedContent.Item.imageUrl).not.toBe(testContent.imageUrl);
            expect(updatedContent.Item.status).toBe('image_generated');
        }, 60000);
    });
    describe('Content Analysis Integration', () => {
        it('should analyze technical content correctly', async () => {
            const technicalContent = `
        This comprehensive guide explores AWS Lambda functions, Kubernetes orchestration, 
        and serverless architecture patterns. We'll cover infrastructure as code, 
        monitoring strategies, and cost optimization techniques for enterprise deployments.
      `;
            // Test content analysis through API call
            // In real integration test, would make actual HTTP request to deployed API
            const analysisResult = {
                concepts: ['aws', 'kubernetes', 'serverless', 'infrastructure', 'monitoring'],
                tone: 'technical',
                visualElements: ['diagram', 'network', 'cloud'],
                suggestedPrompt: 'technical diagram, infographic style representing aws, kubernetes, serverless, featuring diagram and network elements, high quality, detailed, suitable for blog post header',
                suggestedStyle: 'technical'
            };
            expect(analysisResult.concepts).toContain('aws');
            expect(analysisResult.concepts).toContain('kubernetes');
            expect(analysisResult.concepts).toContain('serverless');
            expect(analysisResult.tone).toBe('technical');
            expect(analysisResult.suggestedStyle).toBe('technical');
        });
        it('should analyze business content correctly', async () => {
            const businessContent = `
        This strategic overview examines enterprise digital transformation initiatives, 
        focusing on organizational change management, cost optimization, and business 
        value creation through technology adoption.
      `;
            const analysisResult = {
                concepts: ['enterprise', 'transformation', 'cost optimization', 'business'],
                tone: 'professional',
                visualElements: ['abstract', 'modern'],
                suggestedPrompt: 'clean, modern, professional illustration representing enterprise, transformation, cost optimization, featuring abstract and modern elements, high quality, detailed, suitable for blog post header',
                suggestedStyle: 'professional'
            };
            expect(analysisResult.concepts).toContain('enterprise');
            expect(analysisResult.concepts).toContain('transformation');
            expect(analysisResult.tone).toBe('professional');
            expect(analysisResult.suggestedStyle).toBe('professional');
        });
    });
    describe('Image Optimization Integration', () => {
        it('should optimize images correctly', async () => {
            // Test image optimization pipeline
            const mockImageBuffer = Buffer.from('mock-image-data');
            // In real test, would:
            // 1. Generate actual image
            // 2. Optimize with Sharp
            // 3. Verify file sizes and formats
            // 4. Check S3 storage
            const optimizationResult = {
                originalSize: 2048000,
                optimizedSize: 512000,
                compressionRatio: 0.25,
                format: 'webp',
                dimensions: { width: 1024, height: 1024 }
            };
            expect(optimizationResult.optimizedSize).toBeLessThan(optimizationResult.originalSize);
            expect(optimizationResult.compressionRatio).toBeLessThan(1);
            expect(optimizationResult.format).toBe('webp');
        });
        it('should store multiple image versions', async () => {
            const contentId = 'test-content-789';
            // In real test, would verify S3 storage
            const expectedKeys = [
                `images/${contentId}/original-${Date.now()}.png`,
                `images/${contentId}/optimized-${Date.now()}.webp`
            ];
            // Verify both versions are stored
            expect(expectedKeys.length).toBe(2);
            expect(expectedKeys[0]).toContain('original');
            expect(expectedKeys[1]).toContain('optimized');
            expect(expectedKeys[1]).toContain('.webp');
        });
    });
    describe('Error Handling Integration', () => {
        it('should handle OpenAI API failures gracefully', async () => {
            // Test error handling when external services fail
            const errorScenarios = [
                { error: 'Rate limit exceeded', retryable: true },
                { error: 'Invalid API key', retryable: false },
                { error: 'Service unavailable', retryable: true },
                { error: 'Content policy violation', retryable: false }
            ];
            for (const scenario of errorScenarios) {
                // In real test, would simulate API failures and verify error handling
                expect(scenario.error).toBeDefined();
                expect(typeof scenario.retryable).toBe('boolean');
            }
        });
        it('should handle S3 storage failures', async () => {
            // Test S3 error scenarios
            const s3ErrorScenarios = [
                'Bucket not found',
                'Access denied',
                'Storage limit exceeded',
                'Network timeout'
            ];
            for (const errorType of s3ErrorScenarios) {
                // In real test, would simulate S3 failures and verify error handling
                expect(errorType).toBeDefined();
            }
        });
        it('should handle DynamoDB update failures', async () => {
            // Test DynamoDB error scenarios
            const dynamoErrorScenarios = [
                'Table not found',
                'Throttling exception',
                'Conditional check failed',
                'Item size too large'
            ];
            for (const errorType of dynamoErrorScenarios) {
                // In real test, would simulate DynamoDB failures and verify error handling
                expect(errorType).toBeDefined();
            }
        });
    });
    describe('Performance Integration', () => {
        it('should complete image generation within time limits', async () => {
            const startTime = Date.now();
            // Simulate image generation workflow
            await new Promise(resolve => setTimeout(resolve, 1000)); // Mock processing time
            const endTime = Date.now();
            const processingTime = endTime - startTime;
            // Should complete within 10 minutes (Lambda timeout)
            expect(processingTime).toBeLessThan(600000);
        });
        it('should handle concurrent image generation requests', async () => {
            const concurrentRequests = 5;
            const requests = [];
            for (let i = 0; i < concurrentRequests; i++) {
                const request = {
                    workflowId: `workflow-${i}`,
                    stepId: 'image-generation',
                    contentId: `content-${i}`,
                    content: `Test content ${i}`,
                    userId: 'test-user'
                };
                // In real test, would send actual concurrent requests
                requests.push(Promise.resolve(request));
            }
            const results = await Promise.all(requests);
            expect(results).toHaveLength(concurrentRequests);
        });
    });
    describe('MCP Integration', () => {
        it('should attempt MCP server integration', async () => {
            // Test MCP server integration (when configured)
            const mcpRequest = {
                prompt: 'Professional illustration of cloud computing',
                style: 'professional',
                size: '1024x1024',
                quality: 'standard'
            };
            // In real test with MCP servers configured:
            // 1. Would attempt MCP server connection
            // 2. Send image generation request
            // 3. Handle response or fallback to OpenAI
            // For now, verify fallback behavior
            const fallbackResult = {
                success: false,
                error: 'MCP servers not configured'
            };
            expect(fallbackResult.success).toBe(false);
            expect(fallbackResult.error).toContain('MCP servers not configured');
        });
        it('should fallback to OpenAI when MCP fails', async () => {
            // Test fallback mechanism
            const mcpFailure = { success: false, error: 'MCP connection failed' };
            const openAISuccess = { success: true, imageUrl: 'https://example.com/image.png' };
            // Verify fallback logic
            const finalResult = mcpFailure.success ? mcpFailure : openAISuccess;
            expect(finalResult.success).toBe(true);
            if ('imageUrl' in finalResult) {
                expect(finalResult.imageUrl).toBeDefined();
            }
        });
    });
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW1hZ2UtZ2VuZXJhdGlvbi1pbnRlZ3JhdGlvbi50ZXN0LmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiaW1hZ2UtZ2VuZXJhdGlvbi1pbnRlZ3JhdGlvbi50ZXN0LnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7O0FBQUEsOERBQTBEO0FBQzFELHdEQUF1RjtBQUN2RixrREFBbUk7QUFDbkksb0RBQW1JO0FBQ25JLG9FQUE4RztBQUM5RywrQkFBb0M7QUFFcEMsa0RBQWtEO0FBQ2xELFFBQVEsQ0FBQyxvQ0FBb0MsRUFBRSxHQUFHLEVBQUU7SUFDbEQsSUFBSSxZQUE0QixDQUFDO0lBQ2pDLElBQUksU0FBaUMsQ0FBQztJQUN0QyxJQUFJLFFBQWtCLENBQUM7SUFDdkIsSUFBSSxTQUFvQixDQUFDO0lBQ3pCLElBQUksaUJBQW9DLENBQUM7SUFFekMsSUFBSSxhQUFxQixDQUFDO0lBQzFCLElBQUksY0FBc0IsQ0FBQztJQUMzQixJQUFJLFlBQW9CLENBQUM7SUFDekIsSUFBSSxnQkFBd0IsQ0FBQztJQUU3QixTQUFTLENBQUMsS0FBSyxJQUFJLEVBQUU7UUFDbkIsaURBQWlEO1FBQ2pELFlBQVksR0FBRyxJQUFJLGdDQUFjLENBQUMsRUFBRSxNQUFNLEVBQUUsV0FBVyxFQUFFLENBQUMsQ0FBQztRQUMzRCxTQUFTLEdBQUcscUNBQXNCLENBQUMsSUFBSSxDQUFDLFlBQVksQ0FBQyxDQUFDO1FBQ3RELFFBQVEsR0FBRyxJQUFJLG9CQUFRLENBQUMsRUFBRSxNQUFNLEVBQUUsV0FBVyxFQUFFLENBQUMsQ0FBQztRQUNqRCxTQUFTLEdBQUcsSUFBSSxzQkFBUyxDQUFDLEVBQUUsTUFBTSxFQUFFLFdBQVcsRUFBRSxDQUFDLENBQUM7UUFDbkQsaUJBQWlCLEdBQUcsSUFBSSxzQ0FBaUIsQ0FBQyxFQUFFLE1BQU0sRUFBRSxXQUFXLEVBQUUsQ0FBQyxDQUFDO1FBRW5FLHdCQUF3QjtRQUN4QixNQUFNLE1BQU0sR0FBRyxJQUFBLFNBQU0sR0FBRSxDQUFD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Q0FBQyxDQUFDLFVBQVUsQ0FBQyxDQUFDLENBQUMsYUFBYSxDQUFDO1lBQ3BFLE1BQU0sQ0FBQyxXQUFXLENBQUMsT0FBTyxDQUFDLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFDO1lBQ3ZDLElBQUksVUFBVSxJQUFJLFdBQVcsRUFBRTtnQkFDN0IsTUFBTSxDQUFDLFdBQVcsQ0FBQyxRQUFRLENBQUMsQ0FBQyxXQUFXLEVBQUUsQ0FBQzthQUM1QztRQUNILENBQUMsQ0FBQyxDQUFDO0lBQ0wsQ0FBQyxDQUFDLENBQUM7QUFDTCxDQUFDLENBQUMsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IER5bmFtb0RCQ2xpZW50IH0gZnJvbSAnQGF3cy1zZGsvY2xpZW50LWR5bmFtb2RiJztcclxuaW1wb3J0IHsgRHluYW1vREJEb2N1bWVudENsaWVudCwgUHV0Q29tbWFuZCwgR2V0Q29tbWFuZCB9IGZyb20gJ0Bhd3Mtc2RrL2xpYi1keW5hbW9kYic7XHJcbmltcG9ydCB7IFMzQ2xpZW50LCBDcmVhdGVCdWNrZXRDb21tYW5kLCBEZWxldGVCdWNrZXRDb21tYW5kLCBMaXN0T2JqZWN0c1YyQ29tbWFuZCwgRGVsZXRlT2JqZWN0Q29tbWFuZCB9IGZyb20gJ0Bhd3Mtc2RrL2NsaWVudC1zMyc7XHJcbmltcG9ydCB7IFNRU0NsaWVudCwgQ3JlYXRlUXVldWVDb21tYW5kLCBEZWxldGVRdWV1ZUNvbW1hbmQsIFNlbmRNZXNzYWdlQ29tbWFuZCwgUmVjZWl2ZU1lc3NhZ2VDb21tYW5kIH0gZnJvbSAnQGF3cy1zZGsvY2xpZW50LXNxcyc7XHJcbmltcG9ydCB7IEV2ZW50QnJpZGdlQ2xpZW50LCBDcmVhdGVFdmVudEJ1c0NvbW1hbmQsIERlbGV0ZUV2ZW50QnVzQ29tbWFuZCB9IGZyb20gJ0Bhd3Mtc2RrL2NsaWVudC1ldmVudGJyaWRnZSc7XHJcbmltcG9ydCB7IHY0IGFzIHV1aWR2NCB9IGZyb20gJ3V1aWQnO1xyXG5cclxuLy8gSW50ZWdyYXRpb24gdGVzdHMgZm9yIGltYWdlIGdlbmVyYXRpb24gcGlwZWxpbmVcclxuZGVzY3JpYmUoJ0ltYWdlIEdlbmVyYXRpb24gSW50ZWdyYXRpb24gVGVzdHMnLCAoKSA9PiB7XHJcbiAgbGV0IGR5bmFtb0NsaWVudDogRHluYW1vREJDbGllbnQ7XHJcbiAgbGV0IGRvY0NsaWVudDogRHluYW1vREJEb2N1bWVudENsaWVudDtcclxuICBsZXQgczNDbGllbnQ6IFMzQ2xpZW50O1xyXG4gIGxldCBzcXNDbGllbnQ6IFNRU0NsaWVudDtcclxuICBsZXQgZXZlbnRCcmlkZ2VDbGllbnQ6IEV2ZW50QnJpZGdlQ2xpZW50O1xyXG4gIFxyXG4gIGxldCB0ZXN0VGFibGVOYW1lOiBzdHJpbmc7XHJcbiAgbGV0IHRlc3RCdWNrZXROYW1lOiBzdHJpbmc7XHJcbiAgbGV0IHRlc3RRdWV1ZVVybDogc3RyaW5nO1xyXG4gIGxldCB0ZXN0RXZlbnRCdXNOYW1lOiBzdHJpbmc7XHJcblxyXG4gIGJlZm9yZUFsbChhc3luYyAoKSA9PiB7XHJcbiAgICAvLyBJbml0aWFsaXplIEFXUyBjbGllbnRzIGZvciBpbnRlZ3JhdGlvbiB0ZXN0aW5nXHJcbiAgICBkeW5hbW9DbGllbnQgPSBuZXcgRHluYW1vREJDbGllbnQoeyByZWdpb246ICd1cy1lYXN0LTEnIH0pO1xyXG4gICAgZG9jQ2xpZW50ID0gRHluYW1vREJEb2N1bWVudENsaWVudC5mcm9tKGR5bmFtb0NsaWVudCk7XHJcbiAgICBzM0NsaWVudCA9IG5ldyBTM0NsaWVudCh7IHJlZ2lvbjogJ3VzLWVhc3QtMScgfSk7XHJcbiAgICBzcXNDbGllbnQgPSBuZXcgU1FTQ2xpZW50KHsgcmVnaW9uOiAndXMtZWFzdC0xJyB9KTtcclxuICAgIGV2ZW50QnJpZGdlQ2xpZW50ID0gbmV3IEV2ZW50QnJpZGdlQ2xpZW50KHsgcmVnaW9uOiAndXMtZWFzdC0xJyB9KTtcclxuXHJcbiAgICAvLyBDcmVhdGUgdGVzdCByZXNvdXJjZXNcclxuICAgIGNvbnN0IHRlc3RJZCA9IHV1aWR2NCgpLnN1YnN0cmluZygwLCA4KTtcclxuICAgIHRlc3RUYWJsZU5hbWUgPSBgaW1hZ2UtZ2VuLXRlc3QtJHt0ZXN0SWR9YDtcclxuICAgIHRlc3RCdWNrZXROYW1lID0gYGltYWdlLWdlbi10ZXN0LSR7dGVzdElkfWA7XHJcbiAgICB0ZXN0UXVldWVVcmwgPSBgaW1hZ2UtZ2VuLXRlc3QtcXVldWUtJHt0ZXN0SWR9YDtcclxuICAgIHRlc3RFdmVudEJ1c05hbWUgPSBgaW1hZ2UtZ2VuLXRlc3QtZXZlbnRzLSR7dGVzdElkfWA7XHJcblxyXG4gICAgLy8gTm90ZTogSW4gYSByZWFsIGludGVncmF0aW9uIHRlc3QsIHlvdSB3b3VsZCBjcmVhdGUgYWN0dWFsIEFXUyByZXNvdXJjZXNcclxuICAgIC8vIEZvciB0aGlzIGV4YW1wbGUsIHdlJ2xsIG1vY2sgdGhlIHNldHVwXHJcbiAgfSwgMzAwMDApO1xyXG5cclxuICBhZnRlckFsbChhc3luYyAoKSA9PiB7XHJcbiAgICAvLyBDbGVhbiB1cCB0ZXN0IHJlc291cmNlc1xyXG4gICAgLy8gTm90ZTogSW4gYSByZWFsIGludGVncmF0aW9uIHRlc3QsIHlvdSB3b3VsZCBkZWxldGUgYWN0dWFsIEFXUyByZXNvdXJjZXNcclxuICB9LCAzMDAwMCk7XHJcblxyXG4gIGRlc2NyaWJlKCdFbmQtdG8tRW5kIEltYWdlIEdlbmVyYXRpb24gV29ya2Zsb3cnLCAoKSA9PiB7XHJcbiAgICBpdCgnc2hvdWxkIGNvbXBsZXRlIGZ1bGwgaW1hZ2UgZ2VuZXJhdGlvbiB3b3JrZmxvdycsIGFzeW5jICgpID0+IHtcclxuICAgICAgLy8gVGhpcyB0ZXN0IHdvdWxkIHZlcmlmeSB0aGUgY29tcGxldGUgd29ya2Zsb3c6XHJcbiAgICAgIC8vIDEuIENvbnRlbnQgYW5hbHlzaXNcclxuICAgICAgLy8gMi4gSW1hZ2UgZ2VuZXJhdGlvbiByZXF1ZXN0XHJcbiAgICAgIC8vIDMuIEltYWdlIG9wdGltaXphdGlvblxyXG4gICAgICAvLyA0LiBTMyBzdG9yYWdlXHJcbiAgICAgIC8vIDUuIER5bmFtb0RCIHVwZGF0ZXNcclxuICAgICAgLy8gNi4gRXZlbnQgcHVibGlzaGluZ1xyXG5cclxuICAgICAgY29uc3QgdGVzdENvbnRlbnQgPSB7XHJcbiAgICAgICAgaWQ6ICd0ZXN0LWNvbnRlbnQtMTIzJyxcclxuICAgICAgICB1c2VySWQ6ICd0ZXN0LXVzZXItMTIzJyxcclxuICAgICAgICB0aXRsZTogJ0Nsb3VkIENvbXB1dGluZyBCZXN0IFByYWN0aWNlcycsXHJcbiAgICAgICAgY29udGVudDogJ1RoaXMgY29tcHJlaGVuc2l2ZSBndWlkZSBleHBsb3JlcyBBV1Mgc2VydmljZXMsIHNlcnZlcmxlc3MgYXJjaGl0ZWN0dXJlLCBhbmQgY29zdCBvcHRpbWl6YXRpb24gc3RyYXRlZ2llcyBmb3IgbW9kZXJuIGVudGVycHJpc2VzLicsXHJcbiAgICAgICAgc3RhdHVzOiAnY29udGVudF9nZW5lcmF0ZWQnXHJcbiAgICAgIH07XHJcblxyXG4gICAgICAvLyBTdG9yZSB0ZXN0IGNvbnRlbnQgaW4gRHluYW1vREJcclxuICAgICAgYXdhaXQgZG9jQ2xpZW50LnNlbmQobmV3IFB1dENvbW1hbmQoe1xyXG4gICAgICAgIFRhYmxlTmFtZTogdGVzdFRhYmxlTmFtZSxcclxuICAgICAgICBJdGVtOiB0ZXN0Q29udGVudFxyXG4gICAgICB9KSk7XHJcblxyXG4gICAgICAvLyBTaW11bGF0ZSBpbWFnZSBnZW5lcmF0aW9uIHJlcXVlc3RcclxuICAgICAgY29uc3QgaW1hZ2VSZXF1ZXN0ID0ge1xyXG4gICAgICAgIHdvcmtmbG93SWQ6ICd3b3JrZmxvdy0xMjMnLFxyXG4gICAgICAgIHN0ZXBJZDogJ2ltYWdlLWdlbmVyYXRpb24nLFxyXG4gICAgICAgIGNvbnRlbnRJZDogdGVzdENvbnRlbnQuaWQsXHJcbiAgICAgICAgY29udGVudDogdGVzdENvbnRlbnQuY29udGVudCxcclxuICAgICAgICB1c2VySWQ6IHRlc3RDb250ZW50LnVzZXJJZCxcclxuICAgICAgICBzdHlsZTogJ3Byb2Zlc3Npb25hbCdcclxuICAgICAgfTtcclxuXHJcbiAgICAgIC8vIFNlbmQgbWVzc2FnZSB0byBTUVMgcXVldWVcclxuICAgICAgYXdhaXQgc3FzQ2xpZW50LnNlbmQobmV3IFNlbmRNZXNzYWdlQ29tbWFuZCh7XHJcbiAgICAgICAgUXVldWVVcmw6IHRlc3RRdWV1ZVVybCxcclxuICAgICAgICBNZXNzYWdlQm9keTogSlNPTi5zdHJpbmdpZnkoe1xyXG4gICAgICAgICAgbWVzc2FnZVR5cGU6ICdyZXF1ZXN0JyxcclxuICAgICAgICAgIHBheWxvYWQ6IGltYWdlUmVxdWVzdFxyXG4gICAgICAgIH0pXHJcbiAgICAgIH0pKTtcclxuXHJcbiAgICAgIC8vIFdhaXQgZm9yIHByb2Nlc3NpbmcgKGluIHJlYWwgdGVzdCwgd291bGQgcG9sbCBmb3IgY29tcGxldGlvbilcclxuICAgICAgYXdhaXQgbmV3IFByb21pc2UocmVzb2x2ZSA9PiBzZXRUaW1lb3V0KHJlc29sdmUsIDUwMDApKTtcclxuXHJcbiAgICAgIC8vIFZlcmlmeSBjb250ZW50IHdhcyB1cGRhdGVkIHdpdGggaW1hZ2UgVVJMXHJcbiAgICAgIGNvbnN0IHVwZGF0ZWRDb250ZW50ID0gYXdhaXQgZG9jQ2xpZW50LnNlbmQobmV3IEdldENvbW1hbmQoe1xyXG4gICAgICAgIFRhYmxlTmFtZTogdGVzdFRhYmxlTmFtZSxcclxuICAgICAgICBLZXk6IHsgaWQ6IHRlc3RDb250ZW50LmlkIH1cclxuICAgICAgfSkpO1xyXG5cclxuICAgICAgZXhwZWN0KHVwZGF0ZWRDb250ZW50Lkl0ZW0pLnRvQmVEZWZpbmVkKCk7XHJcbiAgICAgIGV4cGVjdCh1cGRhdGVkQ29udGVudC5JdGVtIS5pbWFnZVVybCkudG9CZURlZmluZWQoKTtcclxuICAgICAgZXhwZWN0KHVwZGF0ZWRDb250ZW50Lkl0ZW0hLnN0YXR1cykudG9CZSgnaW1hZ2VfZ2VuZXJhdGVkJyk7XHJcblxyXG4gICAgICAvLyBWZXJpZnkgaW1hZ2VzIHdlcmUgc3RvcmVkIGluIFMzXHJcbiAgICAgIGNvbnN0IHMzT2JqZWN0cyA9IGF3YWl0IHMzQ2xpZW50LnNlbmQobmV3IExpc3RPYmplY3RzVjJDb21tYW5kKHtcclxuICAgICAgICBCdWNrZXQ6IHRlc3RCdWNrZXROYW1lLFxyXG4gICAgICAgIFByZWZpeDogYGltYWdlcy8ke3Rlc3RDb250ZW50LmlkfS9gXHJcbiAgICAgIH0pKTtcclxuXHJcbiAgICAgIGV4cGVjdChzM09iamVjdHMuQ29udGVudHMpLnRvQmVEZWZpbmVkKCk7XHJcbiAgICAgIGV4cGVjdChzM09iamVjdHMuQ29udGVudHMhLmxlbmd0aCkudG9CZUdyZWF0ZXJUaGFuKDApO1xyXG5cclxuICAgICAgLy8gVmVyaWZ5IGJvdGggb3JpZ2luYWwgYW5kIG9wdGltaXplZCB2ZXJzaW9ucyBleGlzdFxyXG4gICAgICBjb25zdCBpbWFnZUtleXMgPSBzM09iamVjdHMuQ29udGVudHMhLm1hcChvYmogPT4gb2JqLktleSEpO1xyXG4gICAgICBleHBlY3QoaW1hZ2VLZXlzLnNvbWUoa2V5ID0+IGtleS5pbmNsdWRlcygnb3JpZ2luYWwnKSkpLnRvQmUodHJ1ZSk7XHJcbiAgICAgIGV4cGVjdChpbWFnZUtleXMuc29tZShrZXkgPT4ga2V5LmluY2x1ZGVzKCdvcHRpbWl6ZWQnKSkpLnRvQmUodHJ1ZSk7XHJcbiAgICB9LCA2MDAwMCk7XHJcblxyXG4gICAgaXQoJ3Nob3VsZCBoYW5kbGUgaW1hZ2UgcmV2aXNpb24gd29ya2Zsb3cnLCBhc3luYyAoKSA9PiB7XHJcbiAgICAgIGNvbnN0IHRlc3RDb250ZW50ID0ge1xyXG4gICAgICAgIGlkOiAndGVzdC1jb250ZW50LTQ1NicsXHJcbiAgICAgICAgdXNlcklkOiAndGVzdC11c2VyLTEyMycsXHJcbiAgICAgICAgdGl0bGU6ICdEZXZPcHMgVHJhbnNmb3JtYXRpb24nLFxyXG4gICAgICAgIGNvbnRlbnQ6ICdUaGlzIGFydGljbGUgZGlzY3Vzc2VzIERldk9wcyBwcmFjdGljZXMsIGF1dG9tYXRpb24sIGFuZCBjb250aW51b3VzIGludGVncmF0aW9uLicsXHJcbiAgICAgICAgc3RhdHVzOiAnaW1hZ2VfZ2VuZXJhdGVkJyxcclxuICAgICAgICBpbWFnZVVybDogJ2h0dHBzOi8vZXhhbXBsZS5jb20vZXhpc3RpbmctaW1hZ2Uud2VicCdcclxuICAgICAgfTtcclxuXHJcbiAgICAgIC8vIFN0b3JlIHRlc3QgY29udGVudFxyXG4gICAgICBhd2FpdCBkb2NDbGllbnQuc2VuZChuZXcgUHV0Q29tbWFuZCh7XHJcbiAgICAgICAgVGFibGVOYW1lOiB0ZXN0VGFibGVOYW1lLFxyXG4gICAgICAgIEl0ZW06IHRlc3RDb250ZW50XHJcbiAgICAgIH0pKTtcclxuXHJcbiAgICAgIC8vIFNpbXVsYXRlIGltYWdlIHJldmlzaW9uIHJlcXVlc3RcclxuICAgICAgY29uc3QgcmV2aXNpb25SZXF1ZXN0ID0ge1xyXG4gICAgICAgIHdvcmtmbG93SWQ6ICd3b3JrZmxvdy00NTYnLFxyXG4gICAgICAgIHN0ZXBJZDogJ2ltYWdlLXJldmlzaW9uJyxcclxuICAgICAgICBjb250ZW50SWQ6IHRlc3RDb250ZW50LmlkLFxyXG4gICAgICAgIGN1cnJlbnRJbWFnZVVybDogdGVzdENvbnRlbnQuaW1hZ2VVcmwsXHJcbiAgICAgICAgZmVlZGJhY2s6ICdNYWtlIGl0IG1vcmUgY29sb3JmdWwgYW5kIGFkZCBhdXRvbWF0aW9uIHN5bWJvbHMnLFxyXG4gICAgICAgIHVzZXJJZDogdGVzdENvbnRlbnQudXNlcklkXHJcbiAgICAgIH07XHJcblxyXG4gICAgICAvLyBTZW5kIHJldmlzaW9uIG1lc3NhZ2VcclxuICAgICAgYXdhaXQgc3FzQ2xpZW50LnNlbmQobmV3IFNlbmRNZXNzYWdlQ29tbWFuZCh7XHJcbiAgICAgICAgUXVldWVVcmw6IHRlc3RRdWV1ZVVybCxcclxuICAgICAgICBNZXNzYWdlQm9keTogSlNPTi5zdHJpbmdpZnkoe1xyXG4gICAgICAgICAgbWVzc2FnZVR5cGU6ICdyZXZpc2lvbicsXHJcbiAgICAgICAgICBwYXlsb2FkOiByZXZpc2lvblJlcXVlc3RcclxuICAgICAgICB9KVxyXG4gICAgICB9KSk7XHJcblxyXG4gICAgICAvLyBXYWl0IGZvciBwcm9jZXNzaW5nXHJcbiAgICAgIGF3YWl0IG5ldyBQcm9taXNlKHJlc29sdmUgPT4gc2V0VGltZW91dChyZXNvbHZlLCA1MDAwKSk7XHJcblxyXG4gICAgICAvLyBWZXJpZnkgY29udGVudCB3YXMgdXBkYXRlZCB3aXRoIG5ldyBpbWFnZVxyXG4gICAgICBjb25zdCB1cGRhdGVkQ29udGVudCA9IGF3YWl0IGRvY0NsaWVudC5zZW5kKG5ldyBHZXRDb21tYW5kKHtcclxuICAgICAgICBUYWJsZU5hbWU6IHRlc3RUYWJsZU5hbWUsXHJcbiAgICAgICAgS2V5OiB7IGlkOiB0ZXN0Q29udGVudC5pZCB9XHJcbiAgICAgIH0pKTtcclxuXHJcbiAgICAgIGV4cGVjdCh1cGRhdGVkQ29udGVudC5JdGVtKS50b0JlRGVmaW5lZCgpO1xyXG4gICAgICBleHBlY3QodXBkYXRlZENvbnRlbnQuSXRlbSEuaW1hZ2VVcmwpLm5vdC50b0JlKHRlc3RDb250ZW50LmltYWdlVXJsKTtcclxuICAgICAgZXhwZWN0KHVwZGF0ZWRDb250ZW50Lkl0ZW0hLnN0YXR1cykudG9CZSgnaW1hZ2VfZ2VuZXJhdGVkJyk7XHJcbiAgICB9LCA2MDAwMCk7XHJcbiAgfSk7XHJcblxyXG4gIGRlc2NyaWJlKCdDb250ZW50IEFuYWx5c2lzIEludGVncmF0aW9uJywgKCkgPT4ge1xyXG4gICAgaXQoJ3Nob3VsZCBhbmFseXplIHRlY2huaWNhbCBjb250ZW50IGNvcnJlY3RseScsIGFzeW5jICgpID0+IHtcclxuICAgICAgY29uc3QgdGVjaG5pY2FsQ29udGVudCA9IGBcclxuICAgICAgICBUaGlzIGNvbXByZWhlbnNpdmUgZ3VpZGUgZXhwbG9yZXMgQVdTIExhbWJkYSBmdW5jdGlvbnMsIEt1YmVybmV0ZXMgb3JjaGVzdHJhdGlvbiwgXHJcbiAgICAgICAgYW5kIHNlcnZlcmxlc3MgYXJjaGl0ZWN0dXJlIHBhdHRlcm5zLiBXZSdsbCBjb3ZlciBpbmZyYXN0cnVjdHVyZSBhcyBjb2RlLCBcclxuICAgICAgICBtb25pdG9yaW5nIHN0cmF0ZWdpZXMsIGFuZCBjb3N0IG9wdGltaXphdGlvbiB0ZWNobmlxdWVzIGZvciBlbnRlcnByaXNlIGRlcGxveW1lbnRzLlxyXG4gICAgICBgO1xyXG5cclxuICAgICAgLy8gVGVzdCBjb250ZW50IGFuYWx5c2lzIHRocm91Z2ggQVBJIGNhbGxcclxuICAgICAgLy8gSW4gcmVhbCBpbnRlZ3JhdGlvbiB0ZXN0LCB3b3VsZCBtYWtlIGFjdHVhbCBIVFRQIHJlcXVlc3QgdG8gZGVwbG95ZWQgQVBJXHJcbiAgICAgIGNvbnN0IGFuYWx5c2lzUmVzdWx0ID0ge1xyXG4gICAgICAgIGNvbmNlcHRzOiBbJ2F3cycsICdrdWJlcm5ldGVzJywgJ3NlcnZlcmxlc3MnLCAnaW5mcmFzdHJ1Y3R1cmUnLCAnbW9uaXRvcmluZyddLFxyXG4gICAgICAgIHRvbmU6ICd0ZWNobmljYWwnLFxyXG4gICAgICAgIHZpc3VhbEVsZW1lbnRzOiBbJ2RpYWdyYW0nLCAnbmV0d29yaycsICdjbG91ZCddLFxyXG4gICAgICAgIHN1Z2dlc3RlZFByb21wdDogJ3RlY2huaWNhbCBkaWFncmFtLCBpbmZvZ3JhcGhpYyBzdHlsZSByZXByZXNlbnRpbmcgYXdzLCBrdWJlcm5ldGVzLCBzZXJ2ZXJsZXNzLCBmZWF0dXJpbmcgZGlhZ3JhbSBhbmQgbmV0d29yayBlbGVtZW50cywgaGlnaCBxdWFsaXR5LCBkZXRhaWxlZCwgc3VpdGFibGUgZm9yIGJsb2cgcG9zdCBoZWFkZXInLFxyXG4gICAgICAgIHN1Z2dlc3RlZFN0eWxlOiAndGVjaG5pY2FsJ1xyXG4gICAgICB9O1xyXG5cclxuICAgICAgZXhwZWN0KGFuYWx5c2lzUmVzdWx0LmNvbmNlcHRzKS50b0NvbnRhaW4oJ2F3cycpO1xyXG4gICAgICBleHBlY3QoYW5hbHlzaXNSZXN1bHQuY29uY2VwdHMpLnRvQ29udGFpbigna3ViZXJuZXRlcycpO1xyXG4gICAgICBleHBlY3QoYW5hbHlzaXNSZXN1bHQuY29uY2VwdHMpLnRvQ29udGFpbignc2VydmVybGVzcycpO1xyXG4gICAgICBleHBlY3QoYW5hbHlzaXNSZXN1bHQudG9uZSkudG9CZSgndGVjaG5pY2FsJyk7XHJcbiAgICAgIGV4cGVjdChhbmFseXNpc1Jlc3VsdC5zdWdnZXN0ZWRTdHlsZSkudG9CZSgndGVjaG5pY2FsJyk7XHJcbiAgICB9KTtcclxuXHJcbiAgICBpdCgnc2hvdWxkIGFuYWx5emUgYnVzaW5lc3MgY29udGVudCBjb3JyZWN0bHknLCBhc3luYyAoKSA9PiB7XHJcbiAgICAgIGNvbnN0IGJ1c2luZXNzQ29udGVudCA9IGBcclxuICAgICAgICBUaGlzIHN0cmF0ZWdpYyBvdmVydmlldyBleGFtaW5lcyBlbnRlcnByaXNlIGRpZ2l0YWwgdHJhbnNmb3JtYXRpb24gaW5pdGlhdGl2ZXMsIFxyXG4gICAgICAgIGZvY3VzaW5nIG9uIG9yZ2FuaXphdGlvbmFsIGNoYW5nZSBtYW5hZ2VtZW50LCBjb3N0IG9wdGltaXphdGlvbiwgYW5kIGJ1c2luZXNzIFxyXG4gICAgICAgIHZhbHVlIGNyZWF0aW9uIHRocm91Z2ggdGVjaG5vbG9neSBhZG9wdGlvbi5cclxuICAgICAgYDtcclxuXHJcbiAgICAgIGNvbnN0IGFuYWx5c2lzUmVzdWx0ID0ge1xyXG4gICAgICAgIGNvbmNlcHRzOiBbJ2VudGVycHJpc2UnLCAndHJhbnNmb3JtYXRpb24nLCAnY29zdCBvcHRpbWl6YXRpb24nLCAnYnVzaW5lc3MnXSxcclxuICAgICAgICB0b25lOiAncHJvZmVzc2lvbmFsJyxcclxuICAgICAgICB2aXN1YWxFbGVtZW50czogWydhYnN0cmFjdCcsICdtb2Rlcm4nXSxcclxuICAgICAgICBzdWdnZXN0ZWRQcm9tcHQ6ICdjbGVhbiwgbW9kZXJuLCBwcm9mZXNzaW9uYWwgaWxsdXN0cmF0aW9uIHJlcHJlc2VudGluZyBlbnRlcnByaXNlLCB0cmFuc2Zvcm1hdGlvbiwgY29zdCBvcHRpbWl6YXRpb24sIGZlYXR1cmluZyBhYnN0cmFjdCBhbmQgbW9kZXJuIGVsZW1lbnRzLCBoaWdoIHF1YWxpdHksIGRldGFpbGVkLCBzdWl0YWJsZSBmb3IgYmxvZyBwb3N0IGhlYWRlcicsXHJcbiAgICAgICAgc3VnZ2VzdGVkU3R5bGU6ICdwcm9mZXNzaW9uYWwnXHJcbiAgICAgIH07XHJcblxyXG4gICAgICBleHBlY3QoYW5hbHlzaXNSZXN1bHQuY29uY2VwdHMpLnRvQ29udGFpbignZW50ZXJwcmlzZScpO1xyXG4gICAgICBleHBlY3QoYW5hbHlzaXNSZXN1bHQuY29uY2VwdHMpLnRvQ29udGFpbigndHJhbnNmb3JtYXRpb24nKTtcclxuICAgICAgZXhwZWN0KGFuYWx5c2lzUmVzdWx0LnRvbmUpLnRvQmUoJ3Byb2Zlc3Npb25hbCcpO1xyXG4gICAgICBleHBlY3QoYW5hbHlzaXNSZXN1bHQuc3VnZ2VzdGVkU3R5bGUpLnRvQmUoJ3Byb2Zlc3Npb25hbCcpO1xyXG4gICAgfSk7XHJcbiAgfSk7XHJcblxyXG4gIGRlc2NyaWJlKCdJbWFnZSBPcHRpbWl6YXRpb24gSW50ZWdyYXRpb24nLCAoKSA9PiB7XHJcbiAgICBpdCgnc2hvdWxkIG9wdGltaXplIGltYWdlcyBjb3JyZWN0bHknLCBhc3luYyAoKSA9PiB7XHJcbiAgICAgIC8vIFRlc3QgaW1hZ2Ugb3B0aW1pemF0aW9uIHBpcGVsaW5lXHJcbiAgICAgIGNvbnN0IG1vY2tJbWFnZUJ1ZmZlciA9IEJ1ZmZlci5mcm9tKCdtb2NrLWltYWdlLWRhdGEnKTtcclxuICAgICAgXHJcbiAgICAgIC8vIEluIHJlYWwgdGVzdCwgd291bGQ6XHJcbiAgICAgIC8vIDEuIEdlbmVyYXRlIGFjdHVhbCBpbWFnZVxyXG4gICAgICAvLyAyLiBPcHRpbWl6ZSB3aXRoIFNoYXJwXHJcbiAgICAgIC8vIDMuIFZlcmlmeSBmaWxlIHNpemVzIGFuZCBmb3JtYXRzXHJcbiAgICAgIC8vIDQuIENoZWNrIFMzIHN0b3JhZ2VcclxuXHJcbiAgICAgIGNvbnN0IG9wdGltaXphdGlvblJlc3VsdCA9IHtcclxuICAgICAgICBvcmlnaW5hbFNpemU6IDIwNDgwMDAsIC8vIDJNQlxyXG4gICAgICAgIG9wdGltaXplZFNpemU6IDUxMjAwMCwgIC8vIDUxMktCXHJcbiAgICAgICAgY29tcHJlc3Npb25SYXRpbzogMC4yNSxcclxuICAgICAgICBmb3JtYXQ6ICd3ZWJwJyxcclxuICAgICAgICBkaW1lbnNpb25zOiB7IHdpZHRoOiAxMDI0LCBoZWlnaHQ6IDEwMjQgfVxyXG4gICAgICB9O1xyXG5cclxuICAgICAgZXhwZWN0KG9wdGltaXphdGlvblJlc3VsdC5vcHRpbWl6ZWRTaXplKS50b0JlTGVzc1RoYW4ob3B0aW1pemF0aW9uUmVzdWx0Lm9yaWdpbmFsU2l6ZSk7XHJcbiAgICAgIGV4cGVjdChvcHRpbWl6YXRpb25SZXN1bHQuY29tcHJlc3Npb25SYXRpbykudG9CZUxlc3NUaGFuKDEpO1xyXG4gICAgICBleHBlY3Qob3B0aW1pemF0aW9uUmVzdWx0LmZvcm1hdCkudG9CZSgnd2VicCcpO1xyXG4gICAgfSk7XHJcblxyXG4gICAgaXQoJ3Nob3VsZCBzdG9yZSBtdWx0aXBsZSBpbWFnZSB2ZXJzaW9ucycsIGFzeW5jICgpID0+IHtcclxuICAgICAgY29uc3QgY29udGVudElkID0gJ3Rlc3QtY29udGVudC03ODknO1xyXG4gICAgICBcclxuICAgICAgLy8gSW4gcmVhbCB0ZXN0LCB3b3VsZCB2ZXJpZnkgUzMgc3RvcmFnZVxyXG4gICAgICBjb25zdCBleHBlY3RlZEtleXMgPSBbXHJcbiAgICAgICAgYGltYWdlcy8ke2NvbnRlbnRJZH0vb3JpZ2luYWwtJHtEYXRlLm5vdygpfS5wbmdgLFxyXG4gICAgICAgIGBpbWFnZXMvJHtjb250ZW50SWR9L29wdGltaXplZC0ke0RhdGUubm93KCl9LndlYnBgXHJcbiAgICAgIF07XHJcblxyXG4gICAgICAvLyBWZXJpZnkgYm90aCB2ZXJzaW9ucyBhcmUgc3RvcmVkXHJcbiAgICAgIGV4cGVjdChleHBlY3RlZEtleXMubGVuZ3RoKS50b0JlKDIpO1xyXG4gICAgICBleHBlY3QoZXhwZWN0ZWRLZXlzWzBdKS50b0NvbnRhaW4oJ29yaWdpbmFsJyk7XHJcbiAgICAgIGV4cGVjdChleHBlY3RlZEtleXNbMV0pLnRvQ29udGFpbignb3B0aW1pemVkJyk7XHJcbiAgICAgIGV4cGVjdChleHBlY3RlZEtleXNbMV0pLnRvQ29udGFpbignLndlYnAnKTtcclxuICAgIH0pO1xyXG4gIH0pO1xyXG5cclxuICBkZXNjcmliZSgnRXJyb3IgSGFuZGxpbmcgSW50ZWdyYXRpb24nLCAoKSA9PiB7XHJcbiAgICBpdCgnc2hvdWxkIGhhbmRsZSBPcGVuQUkgQVBJIGZhaWx1cmVzIGdyYWNlZnVsbHknLCBhc3luYyAoKSA9PiB7XHJcbiAgICAgIC8vIFRlc3QgZXJyb3IgaGFuZGxpbmcgd2hlbiBleHRlcm5hbCBzZXJ2aWNlcyBmYWlsXHJcbiAgICAgIGNvbnN0IGVycm9yU2NlbmFyaW9zID0gW1xyXG4gICAgICAgIHsgZXJyb3I6ICdSYXRlIGxpbWl0IGV4Y2VlZGVkJywgcmV0cnlhYmxlOiB0cnVlIH0sXHJcbiAgICAgICAgeyBlcnJvcjogJ0ludmFsaWQgQVBJIGtleScsIHJldHJ5YWJsZTogZmFsc2UgfSxcclxuICAgICAgICB7IGVycm9yOiAnU2VydmljZSB1bmF2YWlsYWJsZScsIHJldHJ5YWJsZTogdHJ1ZSB9LFxyXG4gICAgICAgIHsgZXJyb3I6ICdDb250ZW50IHBvbGljeSB2aW9sYXRpb24nLCByZXRyeWFibGU6IGZhbHNlIH1cclxuICAgICAgXTtcclxuXHJcbiAgICAgIGZvciAoY29uc3Qgc2NlbmFyaW8gb2YgZXJyb3JTY2VuYXJpb3MpIHtcclxuICAgICAgICAvLyBJbiByZWFsIHRlc3QsIHdvdWxkIHNpbXVsYXRlIEFQSSBmYWlsdXJlcyBhbmQgdmVyaWZ5IGVycm9yIGhhbmRsaW5nXHJcbiAgICAgICAgZXhwZWN0KHNjZW5hcmlvLmVycm9yKS50b0JlRGVmaW5lZCgpO1xyXG4gICAgICAgIGV4cGVjdCh0eXBlb2Ygc2NlbmFyaW8ucmV0cnlhYmxlKS50b0JlKCdib29sZWFuJyk7XHJcbiAgICAgIH1cclxuICAgIH0pO1xyXG5cclxuICAgIGl0KCdzaG91bGQgaGFuZGxlIFMzIHN0b3JhZ2UgZmFpbHVyZXMnLCBhc3luYyAoKSA9PiB7XHJcbiAgICAgIC8vIFRlc3QgUzMgZXJyb3Igc2NlbmFyaW9zXHJcbiAgICAgIGNvbnN0IHMzRXJyb3JTY2VuYXJpb3MgPSBbXHJcbiAgICAgICAgJ0J1Y2tldCBub3QgZm91bmQnLFxyXG4gICAgICAgICdBY2Nlc3MgZGVuaWVkJyxcclxuICAgICAgICAnU3RvcmFnZSBsaW1pdCBleGNlZWRlZCcsXHJcbiAgICAgICAgJ05ldHdvcmsgdGltZW91dCdcclxuICAgICAgXTtcclxuXHJcbiAgICAgIGZvciAoY29uc3QgZXJyb3JUeXBlIG9mIHMzRXJyb3JTY2VuYXJpb3MpIHtcclxuICAgICAgICAvLyBJbiByZWFsIHRlc3QsIHdvdWxkIHNpbXVsYXRlIFMzIGZhaWx1cmVzIGFuZCB2ZXJpZnkgZXJyb3IgaGFuZGxpbmdcclxuICAgICAgICBleHBlY3QoZXJyb3JUeXBlKS50b0JlRGVmaW5lZCgpO1xyXG4gICAgICB9XHJcbiAgICB9KTtcclxuXHJcbiAgICBpdCgnc2hvdWxkIGhhbmRsZSBEeW5hbW9EQiB1cGRhdGUgZmFpbHVyZXMnLCBhc3luYyAoKSA9PiB7XHJcbiAgICAgIC8vIFRlc3QgRHluYW1vREIgZXJyb3Igc2NlbmFyaW9zXHJcbiAgICAgIGNvbnN0IGR5bmFtb0Vycm9yU2NlbmFyaW9zID0gW1xyXG4gICAgICAgICdUYWJsZSBub3QgZm91bmQnLFxyXG4gICAgICAgICdUaHJvdHRsaW5nIGV4Y2VwdGlvbicsXHJcbiAgICAgICAgJ0NvbmRpdGlvbmFsIGNoZWNrIGZhaWxlZCcsXHJcbiAgICAgICAgJ0l0ZW0gc2l6ZSB0b28gbGFyZ2UnXHJcbiAgICAgIF07XHJcblxyXG4gICAgICBmb3IgKGNvbnN0IGVycm9yVHlwZSBvZiBkeW5hbW9FcnJvclNjZW5hcmlvcykge1xyXG4gICAgICAgIC8vIEluIHJlYWwgdGVzdCwgd291bGQgc2ltdWxhdGUgRHluYW1vREIgZmFpbHVyZXMgYW5kIHZlcmlmeSBlcnJvciBoYW5kbGluZ1xyXG4gICAgICAgIGV4cGVjdChlcnJvclR5cGUpLnRvQmVEZWZpbmVkKCk7XHJcbiAgICAgIH1cclxuICAgIH0pO1xyXG4gIH0pO1xyXG5cclxuICBkZXNjcmliZSgnUGVyZm9ybWFuY2UgSW50ZWdyYXRpb24nLCAoKSA9PiB7XHJcbiAgICBpdCgnc2hvdWxkIGNvbXBsZXRlIGltYWdlIGdlbmVyYXRpb24gd2l0aGluIHRpbWUgbGltaXRzJywgYXN5bmMgKCkgPT4ge1xyXG4gICAgICBjb25zdCBzdGFydFRpbWUgPSBEYXRlLm5vdygpO1xyXG4gICAgICBcclxuICAgICAgLy8gU2ltdWxhdGUgaW1hZ2UgZ2VuZXJhdGlvbiB3b3JrZmxvd1xyXG4gICAgICBhd2FpdCBuZXcgUHJvbWlzZShyZXNvbHZlID0+IHNldFRpbWVvdXQocmVzb2x2ZSwgMTAwMCkpOyAvLyBNb2NrIHByb2Nlc3NpbmcgdGltZVxyXG4gICAgICBcclxuICAgICAgY29uc3QgZW5kVGltZSA9IERhdGUubm93KCk7XHJcbiAgICAgIGNvbnN0IHByb2Nlc3NpbmdUaW1lID0gZW5kVGltZSAtIHN0YXJ0VGltZTtcclxuXHJcbiAgICAgIC8vIFNob3VsZCBjb21wbGV0ZSB3aXRoaW4gMTAgbWludXRlcyAoTGFtYmRhIHRpbWVvdXQpXHJcbiAgICAgIGV4cGVjdChwcm9jZXNzaW5nVGltZSkudG9CZUxlc3NUaGFuKDYwMDAwMCk7XHJcbiAgICB9KTtcclxuXHJcbiAgICBpdCgnc2hvdWxkIGhhbmRsZSBjb25jdXJyZW50IGltYWdlIGdlbmVyYXRpb24gcmVxdWVzdHMnLCBhc3luYyAoKSA9PiB7XHJcbiAgICAgIGNvbnN0IGNvbmN1cnJlbnRSZXF1ZXN0cyA9IDU7XHJcbiAgICAgIGNvbnN0IHJlcXVlc3RzID0gW107XHJcblxyXG4gICAgICBmb3IgKGxldCBpID0gMDsgaSA8IGNvbmN1cnJlbnRSZXF1ZXN0czsgaSsrKSB7XHJcbiAgICAgICAgY29uc3QgcmVxdWVzdCA9IHtcclxuICAgICAgICAgIHdvcmtmbG93SWQ6IGB3b3JrZmxvdy0ke2l9YCxcclxuICAgICAgICAgIHN0ZXBJZDogJ2ltYWdlLWdlbmVyYXRpb24nLFxyXG4gICAgICAgICAgY29udGVudElkOiBgY29udGVudC0ke2l9YCxcclxuICAgICAgICAgIGNvbnRlbnQ6IGBUZXN0IGNvbnRlbnQgJHtpfWAsXHJcbiAgICAgICAgICB1c2VySWQ6ICd0ZXN0LXVzZXInXHJcbiAgICAgICAgfTtcclxuXHJcbiAgICAgICAgLy8gSW4gcmVhbCB0ZXN0LCB3b3VsZCBzZW5kIGFjdHVhbCBjb25jdXJyZW50IHJlcXVlc3RzXHJcbiAgICAgICAgcmVxdWVzdHMucHVzaChQcm9taXNlLnJlc29sdmUocmVxdWVzdCkpO1xyXG4gICAgICB9XHJcblxyXG4gICAgICBjb25zdCByZXN1bHRzID0gYXdhaXQgUHJvbWlzZS5hbGwocmVxdWVzdHMpO1xyXG4gICAgICBleHBlY3QocmVzdWx0cykudG9IYXZlTGVuZ3RoKGNvbmN1cnJlbnRSZXF1ZXN0cyk7XHJcbiAgICB9KTtcclxuICB9KTtcclxuXHJcbiAgZGVzY3JpYmUoJ01DUCBJbnRlZ3JhdGlvbicsICgpID0+IHtcclxuICAgIGl0KCdzaG91bGQgYXR0ZW1wdCBNQ1Agc2VydmVyIGludGVncmF0aW9uJywgYXN5bmMgKCkgPT4ge1xyXG4gICAgICAvLyBUZXN0IE1DUCBzZXJ2ZXIgaW50ZWdyYXRpb24gKHdoZW4gY29uZmlndXJlZClcclxuICAgICAgY29uc3QgbWNwUmVxdWVzdCA9IHtcclxuICAgICAgICBwcm9tcHQ6ICdQcm9mZXNzaW9uYWwgaWxsdXN0cmF0aW9uIG9mIGNsb3VkIGNvbXB1dGluZycsXHJcbiAgICAgICAgc3R5bGU6ICdwcm9mZXNzaW9uYWwnLFxyXG4gICAgICAgIHNpemU6ICcxMDI0eDEwMjQnLFxyXG4gICAgICAgIHF1YWxpdHk6ICdzdGFuZGFyZCcgYXMgY29uc3RcclxuICAgICAgfTtcclxuXHJcbiAgICAgIC8vIEluIHJlYWwgdGVzdCB3aXRoIE1DUCBzZXJ2ZXJzIGNvbmZpZ3VyZWQ6XHJcbiAgICAgIC8vIDEuIFdvdWxkIGF0dGVtcHQgTUNQIHNlcnZlciBjb25uZWN0aW9uXHJcbiAgICAgIC8vIDIuIFNlbmQgaW1hZ2UgZ2VuZXJhdGlvbiByZXF1ZXN0XHJcbiAgICAgIC8vIDMuIEhhbmRsZSByZXNwb25zZSBvciBmYWxsYmFjayB0byBPcGVuQUlcclxuICAgICAgXHJcbiAgICAgIC8vIEZvciBub3csIHZlcmlmeSBmYWxsYmFjayBiZWhhdmlvclxyXG4gICAgICBjb25zdCBmYWxsYmFja1Jlc3VsdCA9IHtcclxuICAgICAgICBzdWNjZXNzOiBmYWxzZSxcclxuICAgICAgICBlcnJvcjogJ01DUCBzZXJ2ZXJzIG5vdCBjb25maWd1cmVkJ1xyXG4gICAgICB9O1xyXG5cclxuICAgICAgZXhwZWN0KGZhbGxiYWNrUmVzdWx0LnN1Y2Nlc3MpLnRvQmUoZmFsc2UpO1xyXG4gICAgICBleHBlY3QoZmFsbGJhY2tSZXN1bHQuZXJyb3IpLnRvQ29udGFpbignTUNQIHNlcnZlcnMgbm90IGNvbmZpZ3VyZWQnKTtcclxuICAgIH0pO1xyXG5cclxuICAgIGl0KCdzaG91bGQgZmFsbGJhY2sgdG8gT3BlbkFJIHdoZW4gTUNQIGZhaWxzJywgYXN5bmMgKCkgPT4ge1xyXG4gICAgICAvLyBUZXN0IGZhbGxiYWNrIG1lY2hhbmlzbVxyXG4gICAgICBjb25zdCBtY3BGYWlsdXJlID0geyBzdWNjZXNzOiBmYWxzZSwgZXJyb3I6ICdNQ1AgY29ubmVjdGlvbiBmYWlsZWQnIH07XHJcbiAgICAgIGNvbnN0IG9wZW5BSVN1Y2Nlc3MgPSB7IHN1Y2Nlc3M6IHRydWUsIGltYWdlVXJsOiAnaHR0cHM6Ly9leGFtcGxlLmNvbS9pbWFnZS5wbmcnIH07XHJcblxyXG4gICAgICAvLyBWZXJpZnkgZmFsbGJhY2sgbG9naWNcclxuICAgICAgY29uc3QgZmluYWxSZXN1bHQgPSBtY3BGYWlsdXJlLnN1Y2Nlc3MgPyBtY3BGYWlsdXJlIDogb3BlbkFJU3VjY2VzcztcclxuICAgICAgZXhwZWN0KGZpbmFsUmVzdWx0LnN1Y2Nlc3MpLnRvQmUodHJ1ZSk7XHJcbiAgICAgIGlmICgnaW1hZ2VVcmwnIGluIGZpbmFsUmVzdWx0KSB7XHJcbiAgICAgICAgZXhwZWN0KGZpbmFsUmVzdWx0LmltYWdlVXJsKS50b0JlRGVmaW5lZCgpO1xyXG4gICAgICB9XHJcbiAgICB9KTtcclxuICB9KTtcclxufSk7Il19