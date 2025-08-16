"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
// Simple integration test without complex mocking
describe('Input Processor Integration', () => {
    const mockContext = {
        callbackWaitsForEmptyEventLoop: false,
        functionName: 'test-function',
        functionVersion: '1',
        invokedFunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:test-function',
        memoryLimitInMB: '512',
        awsRequestId: 'test-request-id',
        logGroupName: '/aws/lambda/test-function',
        logStreamName: '2023/01/01/[$LATEST]test-stream',
        getRemainingTimeInMillis: () => 30000,
        done: jest.fn(),
        fail: jest.fn(),
        succeed: jest.fn(),
    };
    // Set environment variables
    beforeAll(() => {
        process.env.AUDIO_BUCKET_NAME = 'test-audio-bucket';
        process.env.CONTENT_TABLE_NAME = 'test-content-table';
        process.env.EVENT_BUS_NAME = 'test-event-bus';
        process.env.AWS_REGION = 'us-east-1';
    });
    describe('Route handling', () => {
        it('should handle OPTIONS requests', async () => {
            // This test doesn't require AWS services, so it should work
            const { handler } = await Promise.resolve().then(() => __importStar(require('../lambda/input-processor')));
            const event = {
                httpMethod: 'OPTIONS',
                path: '/api/input/audio',
                headers: { origin: 'https://example.github.io' },
                multiValueHeaders: {},
                queryStringParameters: null,
                multiValueQueryStringParameters: null,
                pathParameters: null,
                stageVariables: null,
                requestContext: {},
                resource: '',
                body: null,
                isBase64Encoded: false,
            };
            const result = await handler(event, mockContext);
            expect(result.statusCode).toBe(200);
            expect(result.headers).toHaveProperty('Access-Control-Allow-Origin');
            expect(result.headers).toHaveProperty('Access-Control-Allow-Methods');
            expect(result.body).toBe('');
        });
        it('should return 404 for unknown routes', async () => {
            const { handler } = await Promise.resolve().then(() => __importStar(require('../lambda/input-processor')));
            const event = {
                httpMethod: 'GET',
                path: '/api/unknown-route',
                headers: {},
                multiValueHeaders: {},
                queryStringParameters: null,
                multiValueQueryStringParameters: null,
                pathParameters: null,
                stageVariables: null,
                requestContext: {},
                resource: '',
                body: null,
                isBase64Encoded: false,
            };
            const result = await handler(event, mockContext);
            expect(result.statusCode).toBe(404);
            expect(JSON.parse(result.body)).toMatchObject({
                error: 'Not Found',
                message: 'Route GET /api/unknown-route not found',
            });
        });
    });
    describe('Validation functions', () => {
        it('should validate audio upload requests', async () => {
            // Test validation logic without AWS calls
            const validRequest = {
                audioData: 'UklGRiQIAABXQVZFZm10IBAAAAABAAIARKwAABCxAgAEABAAZGF0YQAIAAA=',
                contentType: 'audio/wav',
                userId: 'test-user-123',
            };
            // Import validation functions (we'd need to export them from the module)
            // For now, we'll test through the handler with invalid data
            const { handler } = await Promise.resolve().then(() => __importStar(require('../lambda/input-processor')));
            const event = {
                httpMethod: 'POST',
                path: '/api/input/audio',
                headers: { 'content-type': 'application/json' },
                multiValueHeaders: {},
                queryStringParameters: null,
                multiValueQueryStringParameters: null,
                pathParameters: null,
                stageVariables: null,
                requestContext: {},
                resource: '',
                body: JSON.stringify({
                    audioData: '',
                    contentType: 'audio/wav',
                    userId: 'test-user-123',
                }),
                isBase64Encoded: false,
            };
            const result = await handler(event, mockContext);
            expect(result.statusCode).toBe(400);
            expect(JSON.parse(result.body)).toMatchObject({
                error: 'Validation Error',
                message: 'Audio data is required',
            });
        });
        it('should validate text input requests', async () => {
            const { handler } = await Promise.resolve().then(() => __importStar(require('../lambda/input-processor')));
            const event = {
                httpMethod: 'POST',
                path: '/api/input/text',
                headers: { 'content-type': 'application/json' },
                multiValueHeaders: {},
                queryStringParameters: null,
                multiValueQueryStringParameters: null,
                pathParameters: null,
                stageVariables: null,
                requestContext: {},
                resource: '',
                body: JSON.stringify({
                    text: '',
                    userId: 'test-user-123',
                }),
                isBase64Encoded: false,
            };
            const result = await handler(event, mockContext);
            expect(result.statusCode).toBe(400);
            expect(JSON.parse(result.body)).toMatchObject({
                error: 'Validation Error',
                message: 'Text is required',
            });
        });
    });
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5wdXQtcHJvY2Vzc29yLWludGVncmF0aW9uLnRlc3QuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJpbnB1dC1wcm9jZXNzb3ItaW50ZWdyYXRpb24udGVzdC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBRUEsa0RBQWtEO0FBQ2xELFFBQVEsQ0FBQyw2QkFBNkIsRUFBRSxHQUFHLEVBQUU7SUFDM0MsTUFBTSxXQUFXLEdBQVk7UUFDM0IsOEJBQThCLEVBQUUsS0FBSztRQUNyQyxZQUFZLEVBQUUsZUFBZTtRQUM3QixlQUFlLEVBQUUsR0FBRztRQUNwQixrQkFBa0IsRUFBRSw4REFBOEQ7UUFDbEYsZUFBZSxFQUFFLEtBQUs7UUFDdEIsWUFBWSxFQUFFLGlCQUFpQjtRQUMvQixZQUFZLEVBQUUsMkJBQTJCO1FBQ3pDLGFBQWEsRUFBRSxpQ0FBaUM7UUFDaEQsd0JBQXdCLEVBQUUsR0FBRyxFQUFFLENBQUMsS0FBSztRQUNyQyxJQUFJLEVBQUUsSUFBSSxDQUFDLEVBQUUsRUFBRTtRQUNmLElBQUksRUFBRSxJQUFJLENBQUMsRUFBRSxFQUFFO1FBQ2YsT0FBTyxFQUFFLElBQUksQ0FBQyxFQUFFLEVBQUU7S0FDbkIsQ0FBQztJQUVGLDRCQUE0QjtJQUM1QixTQUFTLENBQUMsR0FBRyxFQUFFO1FBQ2IsT0FBTyxDQUFDLEdBQUcsQ0FBQyxpQkFBaUIsR0FBRyxtQkFBbUIsQ0FBQztRQUNwRCxPQUFPLENBQUMsR0FBRyxDQUFDLGtCQUFrQixHQUFHLG9CQUFvQixDQUFDO1FBQ3RELE9BQU8sQ0FBQyxHQUFHLENBQUMsY0FBYyxHQUFHLGdCQUFnQixDQUFDO1FBQzlDLE9BQU8sQ0FBQyxHQUFHLENBQUMsVUFBVSxHQUFHLFdBQVcsQ0FBQztJQUN2QyxDQUFDLENBQUMsQ0FBQztJQUVILFFBQVEsQ0FBQyxnQkFBZ0IsRUFBRSxHQUFHLEVBQUU7UUFDOUIsRUFBRSxDQUFDLGdDQUFnQyxFQUFFLEtBQUss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QUUsSUFBSTtnQkFDckMsY0FBYyxFQUFFLElBQUk7Z0JBQ3BCLGNBQWMsRUFBRSxJQUFJO2dCQUNwQixjQUFjLEVBQUUsRUFBUztnQkFDekIsUUFBUSxFQUFFLEVBQUU7Z0JBQ1osSUFBSSxFQUFFLElBQUksQ0FBQyxTQUFTLENBQUM7b0JBQ25CLElBQUksRUFBRSxFQUFFO29CQUNSLE1BQU0sRUFBRSxlQUFlO2lCQUN4QixDQUFDO2dCQUNGLGVBQWUsRUFBRSxLQUFLO2FBQ3ZCLENBQUM7WUFFRixNQUFNLE1BQU0sR0FBRyxNQUFNLE9BQU8sQ0FBQyxLQUFLLEVBQUUsV0FBVyxDQUFDLENBQUM7WUFFakQsTUFBTSxDQUFDLE1BQU0sQ0FBQyxVQUFVLENBQUMsQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFDLENBQUM7WUFDcEMsTUFBTSxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsYUFBYSxDQUFDO2dCQUM1QyxLQUFLLEVBQUUsa0JBQWtCO2dCQUN6QixPQUFPLEVBQUUsa0JBQWtCO2FBQzVCLENBQUMsQ0FBQztRQUNMLENBQUMsQ0FBQyxDQUFDO0lBQ0wsQ0FBQyxDQUFDLENBQUM7QUFDTCxDQUFDLENBQUMsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IEFQSUdhdGV3YXlQcm94eUV2ZW50LCBDb250ZXh0IH0gZnJvbSAnYXdzLWxhbWJkYSc7XHJcblxyXG4vLyBTaW1wbGUgaW50ZWdyYXRpb24gdGVzdCB3aXRob3V0IGNvbXBsZXggbW9ja2luZ1xyXG5kZXNjcmliZSgnSW5wdXQgUHJvY2Vzc29yIEludGVncmF0aW9uJywgKCkgPT4ge1xyXG4gIGNvbnN0IG1vY2tDb250ZXh0OiBDb250ZXh0ID0ge1xyXG4gICAgY2FsbGJhY2tXYWl0c0ZvckVtcHR5RXZlbnRMb29wOiBmYWxzZSxcclxuICAgIGZ1bmN0aW9uTmFtZTogJ3Rlc3QtZnVuY3Rpb24nLFxyXG4gICAgZnVuY3Rpb25WZXJzaW9uOiAnMScsXHJcbiAgICBpbnZva2VkRnVuY3Rpb25Bcm46ICdhcm46YXdzOmxhbWJkYTp1cy1lYXN0LTE6MTIzNDU2Nzg5MDEyOmZ1bmN0aW9uOnRlc3QtZnVuY3Rpb24nLFxyXG4gICAgbWVtb3J5TGltaXRJbk1COiAnNTEyJyxcclxuICAgIGF3c1JlcXVlc3RJZDogJ3Rlc3QtcmVxdWVzdC1pZCcsXHJcbiAgICBsb2dHcm91cE5hbWU6ICcvYXdzL2xhbWJkYS90ZXN0LWZ1bmN0aW9uJyxcclxuICAgIGxvZ1N0cmVhbU5hbWU6ICcyMDIzLzAxLzAxL1skTEFURVNUXXRlc3Qtc3RyZWFtJyxcclxuICAgIGdldFJlbWFpbmluZ1RpbWVJbk1pbGxpczogKCkgPT4gMzAwMDAsXHJcbiAgICBkb25lOiBqZXN0LmZuKCksXHJcbiAgICBmYWlsOiBqZXN0LmZuKCksXHJcbiAgICBzdWNjZWVkOiBqZXN0LmZuKCksXHJcbiAgfTtcclxuXHJcbiAgLy8gU2V0IGVudmlyb25tZW50IHZhcmlhYmxlc1xyXG4gIGJlZm9yZUFsbCgoKSA9PiB7XHJcbiAgICBwcm9jZXNzLmVudi5BVURJT19CVUNLRVRfTkFNRSA9ICd0ZXN0LWF1ZGlvLWJ1Y2tldCc7XHJcbiAgICBwcm9jZXNzLmVudi5DT05URU5UX1RBQkxFX05BTUUgPSAndGVzdC1jb250ZW50LXRhYmxlJztcclxuICAgIHByb2Nlc3MuZW52LkVWRU5UX0JVU19OQU1FID0gJ3Rlc3QtZXZlbnQtYnVzJztcclxuICAgIHByb2Nlc3MuZW52LkFXU19SRUdJT04gPSAndXMtZWFzdC0xJztcclxuICB9KTtcclxuXHJcbiAgZGVzY3JpYmUoJ1JvdXRlIGhhbmRsaW5nJywgKCkgPT4ge1xyXG4gICAgaXQoJ3Nob3VsZCBoYW5kbGUgT1BUSU9OUyByZXF1ZXN0cycsIGFzeW5jICgpID0+IHtcclxuICAgICAgLy8gVGhpcyB0ZXN0IGRvZXNuJ3QgcmVxdWlyZSBBV1Mgc2VydmljZXMsIHNvIGl0IHNob3VsZCB3b3JrXHJcbiAgICAgIGNvbnN0IHsgaGFuZGxlciB9ID0gYXdhaXQgaW1wb3J0KCcuLi9sYW1iZGEvaW5wdXQtcHJvY2Vzc29yJyk7XHJcbiAgICAgIFxyXG4gICAgICBjb25zdCBldmVudDogQVBJR2F0ZXdheVByb3h5RXZlbnQgPSB7XHJcbiAgICAgICAgaHR0cE1ldGhvZDogJ09QVElPTlMnLFxyXG4gICAgICAgIHBhdGg6ICcvYXBpL2lucHV0L2F1ZGlvJyxcclxuICAgICAgICBoZWFkZXJzOiB7IG9yaWdpbjogJ2h0dHBzOi8vZXhhbXBsZS5naXRodWIuaW8nIH0sXHJcbiAgICAgICAgbXVsdGlWYWx1ZUhlYWRlcnM6IHt9LFxyXG4gICAgICAgIHF1ZXJ5U3RyaW5nUGFyYW1ldGVyczogbnVsbCxcclxuICAgICAgICBtdWx0aVZhbHVlUXVlcnlTdHJpbmdQYXJhbWV0ZXJzOiBudWxsLFxyXG4gICAgICAgIHBhdGhQYXJhbWV0ZXJzOiBudWxsLFxyXG4gICAgICAgIHN0YWdlVmFyaWFibGVzOiBudWxsLFxyXG4gICAgICAgIHJlcXVlc3RDb250ZXh0OiB7fSBhcyBhbnksXHJcbiAgICAgICAgcmVzb3VyY2U6ICcnLFxyXG4gICAgICAgIGJvZHk6IG51bGwsXHJcbiAgICAgICAgaXNCYXNlNjRFbmNvZGVkOiBmYWxzZSxcclxuICAgICAgfTtcclxuXHJcbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGhhbmRsZXIoZXZlbnQsIG1vY2tDb250ZXh0KTtcclxuXHJcbiAgICAgIGV4cGVjdChyZXN1bHQuc3RhdHVzQ29kZSkudG9CZSgyMDApO1xyXG4gICAgICBleHBlY3QocmVzdWx0LmhlYWRlcnMpLnRvSGF2ZVByb3BlcnR5KCdBY2Nlc3MtQ29udHJvbC1BbGxvdy1PcmlnaW4nKTtcclxuICAgICAgZXhwZWN0KHJlc3VsdC5oZWFkZXJzKS50b0hhdmVQcm9wZXJ0eSgnQWNjZXNzLUNvbnRyb2wtQWxsb3ctTWV0aG9kcycpO1xyXG4gICAgICBleHBlY3QocmVzdWx0LmJvZHkpLnRvQmUoJycpO1xyXG4gICAgfSk7XHJcblxyXG4gICAgaXQoJ3Nob3VsZCByZXR1cm4gNDA0IGZvciB1bmtub3duIHJvdXRlcycsIGFzeW5jICgpID0+IHtcclxuICAgICAgY29uc3QgeyBoYW5kbGVyIH0gPSBhd2FpdCBpbXBvcnQoJy4uL2xhbWJkYS9pbnB1dC1wcm9jZXNzb3InKTtcclxuICAgICAgXHJcbiAgICAgIGNvbnN0IGV2ZW50OiBBUElHYXRld2F5UHJveHlFdmVudCA9IHtcclxuICAgICAgICBodHRwTWV0aG9kOiAnR0VUJyxcclxuICAgICAgICBwYXRoOiAnL2FwaS91bmtub3duLXJvdXRlJyxcclxuICAgICAgICBoZWFkZXJzOiB7fSxcclxuICAgICAgICBtdWx0aVZhbHVlSGVhZGVyczoge30sXHJcbiAgICAgICAgcXVlcnlTdHJpbmdQYXJhbWV0ZXJzOiBudWxsLFxyXG4gICAgICAgIG11bHRpVmFsdWVRdWVyeVN0cmluZ1BhcmFtZXRlcnM6IG51bGwsXHJcbiAgICAgICAgcGF0aFBhcmFtZXRlcnM6IG51bGwsXHJcbiAgICAgICAgc3RhZ2VWYXJpYWJsZXM6IG51bGwsXHJcbiAgICAgICAgcmVxdWVzdENvbnRleHQ6IHt9IGFzIGFueSxcclxuICAgICAgICByZXNvdXJjZTogJycsXHJcbiAgICAgICAgYm9keTogbnVsbCxcclxuICAgICAgICBpc0Jhc2U2NEVuY29kZWQ6IGZhbHNlLFxyXG4gICAgICB9O1xyXG5cclxuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgaGFuZGxlcihldmVudCwgbW9ja0NvbnRleHQpO1xyXG5cclxuICAgICAgZXhwZWN0KHJlc3VsdC5zdGF0dXNDb2RlKS50b0JlKDQwNCk7XHJcbiAgICAgIGV4cGVjdChKU09OLnBhcnNlKHJlc3VsdC5ib2R5KSkudG9NYXRjaE9iamVjdCh7XHJcbiAgICAgICAgZXJyb3I6ICdOb3QgRm91bmQnLFxyXG4gICAgICAgIG1lc3NhZ2U6ICdSb3V0ZSBHRVQgL2FwaS91bmtub3duLXJvdXRlIG5vdCBmb3VuZCcsXHJcbiAgICAgIH0pO1xyXG4gICAgfSk7XHJcbiAgfSk7XHJcblxyXG4gIGRlc2NyaWJlKCdWYWxpZGF0aW9uIGZ1bmN0aW9ucycsICgpID0+IHtcclxuICAgIGl0KCdzaG91bGQgdmFsaWRhdGUgYXVkaW8gdXBsb2FkIHJlcXVlc3RzJywgYXN5bmMgKCkgPT4ge1xyXG4gICAgICAvLyBUZXN0IHZhbGlkYXRpb24gbG9naWMgd2l0aG91dCBBV1MgY2FsbHNcclxuICAgICAgY29uc3QgdmFsaWRSZXF1ZXN0ID0ge1xyXG4gICAgICAgIGF1ZGlvRGF0YTogJ1VrbEdSaVFJQUFCWFFWWkZabTEwSUJBQUFBQUJBQUlBUkt3QUFCQ3hBZ0FFQUJBQVpHRjBZUUFJQUFBPScsXHJcbiAgICAgICAgY29udGVudFR5cGU6ICdhdWRpby93YXYnLFxyXG4gICAgICAgIHVzZXJJZDogJ3Rlc3QtdXNlci0xMjMnLFxyXG4gICAgICB9O1xyXG5cclxuICAgICAgLy8gSW1wb3J0IHZhbGlkYXRpb24gZnVuY3Rpb25zICh3ZSdkIG5lZWQgdG8gZXhwb3J0IHRoZW0gZnJvbSB0aGUgbW9kdWxlKVxyXG4gICAgICAvLyBGb3Igbm93LCB3ZSdsbCB0ZXN0IHRocm91Z2ggdGhlIGhhbmRsZXIgd2l0aCBpbnZhbGlkIGRhdGFcclxuICAgICAgY29uc3QgeyBoYW5kbGVyIH0gPSBhd2FpdCBpbXBvcnQoJy4uL2xhbWJkYS9pbnB1dC1wcm9jZXNzb3InKTtcclxuICAgICAgXHJcbiAgICAgIGNvbnN0IGV2ZW50OiBBUElHYXRld2F5UHJveHlFdmVudCA9IHtcclxuICAgICAgICBodHRwTWV0aG9kOiAnUE9TVCcsXHJcbiAgICAgICAgcGF0aDogJy9hcGkvaW5wdXQvYXVkaW8nLFxyXG4gICAgICAgIGhlYWRlcnM6IHsgJ2NvbnRlbnQtdHlwZSc6ICdhcHBsaWNhdGlvbi9qc29uJyB9LFxyXG4gICAgICAgIG11bHRpVmFsdWVIZWFkZXJzOiB7fSxcclxuICAgICAgICBxdWVyeVN0cmluZ1BhcmFtZXRlcnM6IG51bGwsXHJcbiAgICAgICAgbXVsdGlWYWx1ZVF1ZXJ5U3RyaW5nUGFyYW1ldGVyczogbnVsbCxcclxuICAgICAgICBwYXRoUGFyYW1ldGVyczogbnVsbCxcclxuICAgICAgICBzdGFnZVZhcmlhYmxlczogbnVsbCxcclxuICAgICAgICByZXF1ZXN0Q29udGV4dDoge30gYXMgYW55LFxyXG4gICAgICAgIHJlc291cmNlOiAnJyxcclxuICAgICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7XHJcbiAgICAgICAgICBhdWRpb0RhdGE6ICcnLCAvLyBJbnZhbGlkOiBlbXB0eSBhdWRpbyBkYXRhXHJcbiAgICAgICAgICBjb250ZW50VHlwZTogJ2F1ZGlvL3dhdicsXHJcbiAgICAgICAgICB1c2VySWQ6ICd0ZXN0LXVzZXItMTIzJyxcclxuICAgICAgICB9KSxcclxuICAgICAgICBpc0Jhc2U2NEVuY29kZWQ6IGZhbHNlLFxyXG4gICAgICB9O1xyXG5cclxuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgaGFuZGxlcihldmVudCwgbW9ja0NvbnRleHQpO1xyXG5cclxuICAgICAgZXhwZWN0KHJlc3VsdC5zdGF0dXNDb2RlKS50b0JlKDQwMCk7XHJcbiAgICAgIGV4cGVjdChKU09OLnBhcnNlKHJlc3VsdC5ib2R5KSkudG9NYXRjaE9iamVjdCh7XHJcbiAgICAgICAgZXJyb3I6ICdWYWxpZGF0aW9uIEVycm9yJyxcclxuICAgICAgICBtZXNzYWdlOiAnQXVkaW8gZGF0YSBpcyByZXF1aXJlZCcsXHJcbiAgICAgIH0pO1xyXG4gICAgfSk7XHJcblxyXG4gICAgaXQoJ3Nob3VsZCB2YWxpZGF0ZSB0ZXh0IGlucHV0IHJlcXVlc3RzJywgYXN5bmMgKCkgPT4ge1xyXG4gICAgICBjb25zdCB7IGhhbmRsZXIgfSA9IGF3YWl0IGltcG9ydCgnLi4vbGFtYmRhL2lucHV0LXByb2Nlc3NvcicpO1xyXG4gICAgICBcclxuICAgICAgY29uc3QgZXZlbnQ6IEFQSUdhdGV3YXlQcm94eUV2ZW50ID0ge1xyXG4gICAgICAgIGh0dHBNZXRob2Q6ICdQT1NUJyxcclxuICAgICAgICBwYXRoOiAnL2FwaS9pbnB1dC90ZXh0JyxcclxuICAgICAgICBoZWFkZXJzOiB7ICdjb250ZW50LXR5cGUnOiAnYXBwbGljYXRpb24vanNvbicgfSxcclxuICAgICAgICBtdWx0aVZhbHVlSGVhZGVyczoge30sXHJcbiAgICAgICAgcXVlcnlTdHJpbmdQYXJhbWV0ZXJzOiBudWxsLFxyXG4gICAgICAgIG11bHRpVmFsdWVRdWVyeVN0cmluZ1BhcmFtZXRlcnM6IG51bGwsXHJcbiAgICAgICAgcGF0aFBhcmFtZXRlcnM6IG51bGwsXHJcbiAgICAgICAgc3RhZ2VWYXJpYWJsZXM6IG51bGwsXHJcbiAgICAgICAgcmVxdWVzdENvbnRleHQ6IHt9IGFzIGFueSxcclxuICAgICAgICByZXNvdXJjZTogJycsXHJcbiAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoe1xyXG4gICAgICAgICAgdGV4dDogJycsIC8vIEludmFsaWQ6IGVtcHR5IHRleHRcclxuICAgICAgICAgIHVzZXJJZDogJ3Rlc3QtdXNlci0xMjMnLFxyXG4gICAgICAgIH0pLFxyXG4gICAgICAgIGlzQmFzZTY0RW5jb2RlZDogZmFsc2UsXHJcbiAgICAgIH07XHJcblxyXG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBoYW5kbGVyKGV2ZW50LCBtb2NrQ29udGV4dCk7XHJcblxyXG4gICAgICBleHBlY3QocmVzdWx0LnN0YXR1c0NvZGUpLnRvQmUoNDAwKTtcclxuICAgICAgZXhwZWN0KEpTT04ucGFyc2UocmVzdWx0LmJvZHkpKS50b01hdGNoT2JqZWN0KHtcclxuICAgICAgICBlcnJvcjogJ1ZhbGlkYXRpb24gRXJyb3InLFxyXG4gICAgICAgIG1lc3NhZ2U6ICdUZXh0IGlzIHJlcXVpcmVkJyxcclxuICAgICAgfSk7XHJcbiAgICB9KTtcclxuICB9KTtcclxufSk7Il19