"use strict";
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
            const { handler } = await Promise.resolve().then(() => require('../lambda/input-processor'));
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
            const { handler } = await Promise.resolve().then(() => require('../lambda/input-processor'));
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
            const { handler } = await Promise.resolve().then(() => require('../lambda/input-processor'));
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
            const { handler } = await Promise.resolve().then(() => require('../lambda/input-processor'));
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5wdXQtcHJvY2Vzc29yLWludGVncmF0aW9uLnRlc3QuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJpbnB1dC1wcm9jZXNzb3ItaW50ZWdyYXRpb24udGVzdC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOztBQUVBLGtEQUFrRDtBQUNsRCxRQUFRLENBQUMsNkJBQTZCLEVBQUUsR0FBRyxFQUFFO0lBQzNDLE1BQU0sV0FBVyxHQUFZO1FBQzNCLDhCQUE4QixFQUFFLEtBQUs7UUFDckMsWUFBWSxFQUFFLGVBQWU7UUFDN0IsZUFBZSxFQUFFLEdBQUc7UUFDcEIsa0JBQWtCLEVBQUUsOERBQThEO1FBQ2xGLGVBQWUsRUFBRSxLQUFLO1FBQ3RCLFlBQVksRUFBRSxpQkFBaUI7UUFDL0IsWUFBWSxFQUFFLDJCQUEyQjtRQUN6QyxhQUFhLEVBQUUsaUNBQWlDO1FBQ2hELHdCQUF3QixFQUFFLEdBQUcsRUFBRSxDQUFDLEtBQUs7UUFDckMsSUFBSSxFQUFFLElBQUksQ0FBQyxFQUFFLEVBQUU7UUFDZixJQUFJLEVBQUUsSUFBSSxDQUFDLEVBQUUsRUFBRTtRQUNmLE9BQU8sRUFBRSxJQUFJLENBQUMsRUFBRSxFQUFFO0tBQ25CLENBQUM7SUFFRiw0QkFBNEI7SUFDNUIsU0FBUyxDQUFDLEdBQUcsRUFBRTtRQUNiLE9BQU8sQ0FBQyxHQUFHLENBQUMsaUJBQWlCLEdBQUcsbUJBQW1CLENBQUM7UUFDcEQsT0FBTyxDQUFDLEdBQUcsQ0FBQyxrQkFBa0IsR0FBRyxvQkFBb0IsQ0FBQztRQUN0RCxPQUFPLENBQUMsR0FBRyxDQUFDLGNBQWMsR0FBRyxnQkFBZ0IsQ0FBQztRQUM5QyxPQUFPLENBQUMsR0FBRyxDQUFDLFVBQVUsR0FBRyxXQUFXLENBQUM7SUFDdkMsQ0FBQyxDQUFDLENBQUM7SUFFSCxRQUFRLENBQUMsZ0JBQWdCLEVBQUUsR0FBRyxFQUFFO1FBQzlCLEVBQUUsQ0FBQyxnQ0FBZ0MsRUFBRSxLQUFLLElBQUksRUFBRTtZQUM5Qyw0REFBNEQ7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RSxJQUFJO2dCQUNwQixjQUFjLEVBQUUsSUFBSTtnQkFDcEIsY0FBYyxFQUFFLEVBQVM7Z0JBQ3pCLFFBQVEsRUFBRSxFQUFFO2dCQUNaLElBQUksRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFDO29CQUNuQixJQUFJLEVBQUUsRUFBRTtvQkFDUixNQUFNLEVBQUUsZUFBZTtpQkFDeEIsQ0FBQztnQkFDRixlQUFlLEVBQUUsS0FBSzthQUN2QixDQUFDO1lBRUYsTUFBTSxNQUFNLEdBQUcsTUFBTSxPQUFPLENBQUMsS0FBSyxFQUFFLFdBQVcsQ0FBQyxDQUFDO1lBRWpELE1BQU0sQ0FBQyxNQUFNLENBQUMsVUFBVSxDQUFDLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxDQUFDO1lBQ3BDLE1BQU0sQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLGFBQWEsQ0FBQztnQkFDNUMsS0FBSyxFQUFFLGtCQUFrQjtnQkFDekIsT0FBTyxFQUFFLGtCQUFrQjthQUM1QixDQUFDLENBQUM7UUFDTCxDQUFDLENBQUMsQ0FBQztJQUNMLENBQUMsQ0FBQyxDQUFDO0FBQ0wsQ0FBQyxDQUFDLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBBUElHYXRld2F5UHJveHlFdmVudCwgQ29udGV4dCB9IGZyb20gJ2F3cy1sYW1iZGEnO1xyXG5cclxuLy8gU2ltcGxlIGludGVncmF0aW9uIHRlc3Qgd2l0aG91dCBjb21wbGV4IG1vY2tpbmdcclxuZGVzY3JpYmUoJ0lucHV0IFByb2Nlc3NvciBJbnRlZ3JhdGlvbicsICgpID0+IHtcclxuICBjb25zdCBtb2NrQ29udGV4dDogQ29udGV4dCA9IHtcclxuICAgIGNhbGxiYWNrV2FpdHNGb3JFbXB0eUV2ZW50TG9vcDogZmFsc2UsXHJcbiAgICBmdW5jdGlvbk5hbWU6ICd0ZXN0LWZ1bmN0aW9uJyxcclxuICAgIGZ1bmN0aW9uVmVyc2lvbjogJzEnLFxyXG4gICAgaW52b2tlZEZ1bmN0aW9uQXJuOiAnYXJuOmF3czpsYW1iZGE6dXMtZWFzdC0xOjEyMzQ1Njc4OTAxMjpmdW5jdGlvbjp0ZXN0LWZ1bmN0aW9uJyxcclxuICAgIG1lbW9yeUxpbWl0SW5NQjogJzUxMicsXHJcbiAgICBhd3NSZXF1ZXN0SWQ6ICd0ZXN0LXJlcXVlc3QtaWQnLFxyXG4gICAgbG9nR3JvdXBOYW1lOiAnL2F3cy9sYW1iZGEvdGVzdC1mdW5jdGlvbicsXHJcbiAgICBsb2dTdHJlYW1OYW1lOiAnMjAyMy8wMS8wMS9bJExBVEVTVF10ZXN0LXN0cmVhbScsXHJcbiAgICBnZXRSZW1haW5pbmdUaW1lSW5NaWxsaXM6ICgpID0+IDMwMDAwLFxyXG4gICAgZG9uZTogamVzdC5mbigpLFxyXG4gICAgZmFpbDogamVzdC5mbigpLFxyXG4gICAgc3VjY2VlZDogamVzdC5mbigpLFxyXG4gIH07XHJcblxyXG4gIC8vIFNldCBlbnZpcm9ubWVudCB2YXJpYWJsZXNcclxuICBiZWZvcmVBbGwoKCkgPT4ge1xyXG4gICAgcHJvY2Vzcy5lbnYuQVVESU9fQlVDS0VUX05BTUUgPSAndGVzdC1hdWRpby1idWNrZXQnO1xyXG4gICAgcHJvY2Vzcy5lbnYuQ09OVEVOVF9UQUJMRV9OQU1FID0gJ3Rlc3QtY29udGVudC10YWJsZSc7XHJcbiAgICBwcm9jZXNzLmVudi5FVkVOVF9CVVNfTkFNRSA9ICd0ZXN0LWV2ZW50LWJ1cyc7XHJcbiAgICBwcm9jZXNzLmVudi5BV1NfUkVHSU9OID0gJ3VzLWVhc3QtMSc7XHJcbiAgfSk7XHJcblxyXG4gIGRlc2NyaWJlKCdSb3V0ZSBoYW5kbGluZycsICgpID0+IHtcclxuICAgIGl0KCdzaG91bGQgaGFuZGxlIE9QVElPTlMgcmVxdWVzdHMnLCBhc3luYyAoKSA9PiB7XHJcbiAgICAgIC8vIFRoaXMgdGVzdCBkb2Vzbid0IHJlcXVpcmUgQVdTIHNlcnZpY2VzLCBzbyBpdCBzaG91bGQgd29ya1xyXG4gICAgICBjb25zdCB7IGhhbmRsZXIgfSA9IGF3YWl0IGltcG9ydCgnLi4vbGFtYmRhL2lucHV0LXByb2Nlc3NvcicpO1xyXG4gICAgICBcclxuICAgICAgY29uc3QgZXZlbnQ6IEFQSUdhdGV3YXlQcm94eUV2ZW50ID0ge1xyXG4gICAgICAgIGh0dHBNZXRob2Q6ICdPUFRJT05TJyxcclxuICAgICAgICBwYXRoOiAnL2FwaS9pbnB1dC9hdWRpbycsXHJcbiAgICAgICAgaGVhZGVyczogeyBvcmlnaW46ICdodHRwczovL2V4YW1wbGUuZ2l0aHViLmlvJyB9LFxyXG4gICAgICAgIG11bHRpVmFsdWVIZWFkZXJzOiB7fSxcclxuICAgICAgICBxdWVyeVN0cmluZ1BhcmFtZXRlcnM6IG51bGwsXHJcbiAgICAgICAgbXVsdGlWYWx1ZVF1ZXJ5U3RyaW5nUGFyYW1ldGVyczogbnVsbCxcclxuICAgICAgICBwYXRoUGFyYW1ldGVyczogbnVsbCxcclxuICAgICAgICBzdGFnZVZhcmlhYmxlczogbnVsbCxcclxuICAgICAgICByZXF1ZXN0Q29udGV4dDoge30gYXMgYW55LFxyXG4gICAgICAgIHJlc291cmNlOiAnJyxcclxuICAgICAgICBib2R5OiBudWxsLFxyXG4gICAgICAgIGlzQmFzZTY0RW5jb2RlZDogZmFsc2UsXHJcbiAgICAgIH07XHJcblxyXG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBoYW5kbGVyKGV2ZW50LCBtb2NrQ29udGV4dCk7XHJcblxyXG4gICAgICBleHBlY3QocmVzdWx0LnN0YXR1c0NvZGUpLnRvQmUoMjAwKTtcclxuICAgICAgZXhwZWN0KHJlc3VsdC5oZWFkZXJzKS50b0hhdmVQcm9wZXJ0eSgnQWNjZXNzLUNvbnRyb2wtQWxsb3ctT3JpZ2luJyk7XHJcbiAgICAgIGV4cGVjdChyZXN1bHQuaGVhZGVycykudG9IYXZlUHJvcGVydHkoJ0FjY2Vzcy1Db250cm9sLUFsbG93LU1ldGhvZHMnKTtcclxuICAgICAgZXhwZWN0KHJlc3VsdC5ib2R5KS50b0JlKCcnKTtcclxuICAgIH0pO1xyXG5cclxuICAgIGl0KCdzaG91bGQgcmV0dXJuIDQwNCBmb3IgdW5rbm93biByb3V0ZXMnLCBhc3luYyAoKSA9PiB7XHJcbiAgICAgIGNvbnN0IHsgaGFuZGxlciB9ID0gYXdhaXQgaW1wb3J0KCcuLi9sYW1iZGEvaW5wdXQtcHJvY2Vzc29yJyk7XHJcbiAgICAgIFxyXG4gICAgICBjb25zdCBldmVudDogQVBJR2F0ZXdheVByb3h5RXZlbnQgPSB7XHJcbiAgICAgICAgaHR0cE1ldGhvZDogJ0dFVCcsXHJcbiAgICAgICAgcGF0aDogJy9hcGkvdW5rbm93bi1yb3V0ZScsXHJcbiAgICAgICAgaGVhZGVyczoge30sXHJcbiAgICAgICAgbXVsdGlWYWx1ZUhlYWRlcnM6IHt9LFxyXG4gICAgICAgIHF1ZXJ5U3RyaW5nUGFyYW1ldGVyczogbnVsbCxcclxuICAgICAgICBtdWx0aVZhbHVlUXVlcnlTdHJpbmdQYXJhbWV0ZXJzOiBudWxsLFxyXG4gICAgICAgIHBhdGhQYXJhbWV0ZXJzOiBudWxsLFxyXG4gICAgICAgIHN0YWdlVmFyaWFibGVzOiBudWxsLFxyXG4gICAgICAgIHJlcXVlc3RDb250ZXh0OiB7fSBhcyBhbnksXHJcbiAgICAgICAgcmVzb3VyY2U6ICcnLFxyXG4gICAgICAgIGJvZHk6IG51bGwsXHJcbiAgICAgICAgaXNCYXNlNjRFbmNvZGVkOiBmYWxzZSxcclxuICAgICAgfTtcclxuXHJcbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGhhbmRsZXIoZXZlbnQsIG1vY2tDb250ZXh0KTtcclxuXHJcbiAgICAgIGV4cGVjdChyZXN1bHQuc3RhdHVzQ29kZSkudG9CZSg0MDQpO1xyXG4gICAgICBleHBlY3QoSlNPTi5wYXJzZShyZXN1bHQuYm9keSkpLnRvTWF0Y2hPYmplY3Qoe1xyXG4gICAgICAgIGVycm9yOiAnTm90IEZvdW5kJyxcclxuICAgICAgICBtZXNzYWdlOiAnUm91dGUgR0VUIC9hcGkvdW5rbm93bi1yb3V0ZSBub3QgZm91bmQnLFxyXG4gICAgICB9KTtcclxuICAgIH0pO1xyXG4gIH0pO1xyXG5cclxuICBkZXNjcmliZSgnVmFsaWRhdGlvbiBmdW5jdGlvbnMnLCAoKSA9PiB7XHJcbiAgICBpdCgnc2hvdWxkIHZhbGlkYXRlIGF1ZGlvIHVwbG9hZCByZXF1ZXN0cycsIGFzeW5jICgpID0+IHtcclxuICAgICAgLy8gVGVzdCB2YWxpZGF0aW9uIGxvZ2ljIHdpdGhvdXQgQVdTIGNhbGxzXHJcbiAgICAgIGNvbnN0IHZhbGlkUmVxdWVzdCA9IHtcclxuICAgICAgICBhdWRpb0RhdGE6ICdVa2xHUmlRSUFBQlhRVlpGWm0xMElCQUFBQUFCQUFJQVJLd0FBQkN4QWdBRUFCQUFaR0YwWVFBSUFBQT0nLFxyXG4gICAgICAgIGNvbnRlbnRUeXBlOiAnYXVkaW8vd2F2JyxcclxuICAgICAgICB1c2VySWQ6ICd0ZXN0LXVzZXItMTIzJyxcclxuICAgICAgfTtcclxuXHJcbiAgICAgIC8vIEltcG9ydCB2YWxpZGF0aW9uIGZ1bmN0aW9ucyAod2UnZCBuZWVkIHRvIGV4cG9ydCB0aGVtIGZyb20gdGhlIG1vZHVsZSlcclxuICAgICAgLy8gRm9yIG5vdywgd2UnbGwgdGVzdCB0aHJvdWdoIHRoZSBoYW5kbGVyIHdpdGggaW52YWxpZCBkYXRhXHJcbiAgICAgIGNvbnN0IHsgaGFuZGxlciB9ID0gYXdhaXQgaW1wb3J0KCcuLi9sYW1iZGEvaW5wdXQtcHJvY2Vzc29yJyk7XHJcbiAgICAgIFxyXG4gICAgICBjb25zdCBldmVudDogQVBJR2F0ZXdheVByb3h5RXZlbnQgPSB7XHJcbiAgICAgICAgaHR0cE1ldGhvZDogJ1BPU1QnLFxyXG4gICAgICAgIHBhdGg6ICcvYXBpL2lucHV0L2F1ZGlvJyxcclxuICAgICAgICBoZWFkZXJzOiB7ICdjb250ZW50LXR5cGUnOiAnYXBwbGljYXRpb24vanNvbicgfSxcclxuICAgICAgICBtdWx0aVZhbHVlSGVhZGVyczoge30sXHJcbiAgICAgICAgcXVlcnlTdHJpbmdQYXJhbWV0ZXJzOiBudWxsLFxyXG4gICAgICAgIG11bHRpVmFsdWVRdWVyeVN0cmluZ1BhcmFtZXRlcnM6IG51bGwsXHJcbiAgICAgICAgcGF0aFBhcmFtZXRlcnM6IG51bGwsXHJcbiAgICAgICAgc3RhZ2VWYXJpYWJsZXM6IG51bGwsXHJcbiAgICAgICAgcmVxdWVzdENvbnRleHQ6IHt9IGFzIGFueSxcclxuICAgICAgICByZXNvdXJjZTogJycsXHJcbiAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoe1xyXG4gICAgICAgICAgYXVkaW9EYXRhOiAnJywgLy8gSW52YWxpZDogZW1wdHkgYXVkaW8gZGF0YVxyXG4gICAgICAgICAgY29udGVudFR5cGU6ICdhdWRpby93YXYnLFxyXG4gICAgICAgICAgdXNlcklkOiAndGVzdC11c2VyLTEyMycsXHJcbiAgICAgICAgfSksXHJcbiAgICAgICAgaXNCYXNlNjRFbmNvZGVkOiBmYWxzZSxcclxuICAgICAgfTtcclxuXHJcbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGhhbmRsZXIoZXZlbnQsIG1vY2tDb250ZXh0KTtcclxuXHJcbiAgICAgIGV4cGVjdChyZXN1bHQuc3RhdHVzQ29kZSkudG9CZSg0MDApO1xyXG4gICAgICBleHBlY3QoSlNPTi5wYXJzZShyZXN1bHQuYm9keSkpLnRvTWF0Y2hPYmplY3Qoe1xyXG4gICAgICAgIGVycm9yOiAnVmFsaWRhdGlvbiBFcnJvcicsXHJcbiAgICAgICAgbWVzc2FnZTogJ0F1ZGlvIGRhdGEgaXMgcmVxdWlyZWQnLFxyXG4gICAgICB9KTtcclxuICAgIH0pO1xyXG5cclxuICAgIGl0KCdzaG91bGQgdmFsaWRhdGUgdGV4dCBpbnB1dCByZXF1ZXN0cycsIGFzeW5jICgpID0+IHtcclxuICAgICAgY29uc3QgeyBoYW5kbGVyIH0gPSBhd2FpdCBpbXBvcnQoJy4uL2xhbWJkYS9pbnB1dC1wcm9jZXNzb3InKTtcclxuICAgICAgXHJcbiAgICAgIGNvbnN0IGV2ZW50OiBBUElHYXRld2F5UHJveHlFdmVudCA9IHtcclxuICAgICAgICBodHRwTWV0aG9kOiAnUE9TVCcsXHJcbiAgICAgICAgcGF0aDogJy9hcGkvaW5wdXQvdGV4dCcsXHJcbiAgICAgICAgaGVhZGVyczogeyAnY29udGVudC10eXBlJzogJ2FwcGxpY2F0aW9uL2pzb24nIH0sXHJcbiAgICAgICAgbXVsdGlWYWx1ZUhlYWRlcnM6IHt9LFxyXG4gICAgICAgIHF1ZXJ5U3RyaW5nUGFyYW1ldGVyczogbnVsbCxcclxuICAgICAgICBtdWx0aVZhbHVlUXVlcnlTdHJpbmdQYXJhbWV0ZXJzOiBudWxsLFxyXG4gICAgICAgIHBhdGhQYXJhbWV0ZXJzOiBudWxsLFxyXG4gICAgICAgIHN0YWdlVmFyaWFibGVzOiBudWxsLFxyXG4gICAgICAgIHJlcXVlc3RDb250ZXh0OiB7fSBhcyBhbnksXHJcbiAgICAgICAgcmVzb3VyY2U6ICcnLFxyXG4gICAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHtcclxuICAgICAgICAgIHRleHQ6ICcnLCAvLyBJbnZhbGlkOiBlbXB0eSB0ZXh0XHJcbiAgICAgICAgICB1c2VySWQ6ICd0ZXN0LXVzZXItMTIzJyxcclxuICAgICAgICB9KSxcclxuICAgICAgICBpc0Jhc2U2NEVuY29kZWQ6IGZhbHNlLFxyXG4gICAgICB9O1xyXG5cclxuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgaGFuZGxlcihldmVudCwgbW9ja0NvbnRleHQpO1xyXG5cclxuICAgICAgZXhwZWN0KHJlc3VsdC5zdGF0dXNDb2RlKS50b0JlKDQwMCk7XHJcbiAgICAgIGV4cGVjdChKU09OLnBhcnNlKHJlc3VsdC5ib2R5KSkudG9NYXRjaE9iamVjdCh7XHJcbiAgICAgICAgZXJyb3I6ICdWYWxpZGF0aW9uIEVycm9yJyxcclxuICAgICAgICBtZXNzYWdlOiAnVGV4dCBpcyByZXF1aXJlZCcsXHJcbiAgICAgIH0pO1xyXG4gICAgfSk7XHJcbiAgfSk7XHJcbn0pOyJdfQ==