"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = void 0;
const handler = async (event, context) => {
    console.log('Event:', JSON.stringify(event, null, 2));
    console.log('Context:', JSON.stringify(context, null, 2));
    const corsHeaders = {
        'Access-Control-Allow-Origin': event.headers.origin || '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Amz-Date,X-Api-Key,X-Amz-Security-Token,X-Requested-With',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
        'Access-Control-Allow-Credentials': 'true',
        'Content-Type': 'application/json',
    };
    try {
        // Handle preflight OPTIONS requests
        if (event.httpMethod === 'OPTIONS') {
            return {
                statusCode: 200,
                headers: corsHeaders,
                body: '',
            };
        }
        // Route handling
        const path = event.path;
        const method = event.httpMethod;
        console.log(`Processing ${method} ${path}`);
        // Health check endpoint
        if (method === 'GET' && path === '/') {
            const response = {
                message: 'Automated Blog Poster API is running',
                version: '1.0.0',
                data: {
                    timestamp: new Date().toISOString(),
                    requestId: context.awsRequestId,
                    environment: {
                        contentTable: process.env.CONTENT_TABLE_NAME,
                        userTable: process.env.USER_TABLE_NAME,
                        audioBucket: process.env.AUDIO_BUCKET_NAME,
                        imageBucket: process.env.IMAGE_BUCKET_NAME,
                    },
                },
            };
            return {
                statusCode: 200,
                headers: corsHeaders,
                body: JSON.stringify(response),
            };
        }
        // API status endpoint
        if (method === 'GET' && path === '/api/status') {
            const response = {
                message: 'API is healthy',
                version: '1.0.0',
                data: {
                    timestamp: new Date().toISOString(),
                    services: {
                        dynamodb: 'available',
                        s3: 'available',
                        sqs: 'available',
                        eventbridge: 'available',
                    },
                },
            };
            return {
                statusCode: 200,
                headers: corsHeaders,
                body: JSON.stringify(response),
            };
        }
        // Default 404 for unmatched routes
        const errorResponse = {
            error: 'Not Found',
            message: `Route ${method} ${path} not found`,
            requestId: context.awsRequestId,
        };
        return {
            statusCode: 404,
            headers: corsHeaders,
            body: JSON.stringify(errorResponse),
        };
    }
    catch (error) {
        console.error('Unhandled error:', error);
        const errorResponse = {
            error: 'Internal Server Error',
            message: error instanceof Error ? error.message : 'An unexpected error occurred',
            requestId: context.awsRequestId,
        };
        return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify(errorResponse),
        };
    }
};
exports.handler = handler;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXBpLWhhbmRsZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJhcGktaGFuZGxlci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFjTyxNQUFNLE9BQU8sR0FBRyxLQUFLLEVBQzFCLEtBQTJCLEVBQzNCLE9BQWdCLEVBQ2dCLEVBQUU7SUFDbEMsT0FBTyxDQUFDLEdBQUcsQ0FBQyxRQUFRLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQyxLQUFLLEVBQUUsSUFBSSxFQUFFLENBQUMsQ0FBQyxDQUFDLENBQUM7SUFDdEQsT0FBTyxDQUFDLEdBQUcsQ0FBQyxVQUFVLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQyxPQUFPLEVBQUUsSUFBSSxFQUFFLENBQUMsQ0FBQyxDQUFDLENBQUM7SUFFMUQsTUFBTSxXQUFXLEdBQUc7UUFDbEIsNkJBQTZCLEVBQUUsS0FBSyxDQUFDLE9BQU8sQ0FBQyxNQUFNLElBQUksR0FBRztRQUMxRCw4QkFBOEIsRUFBRSx1RkFBdUY7UUFDdkgsOEJBQThCLEVBQUUsNkJBQTZCO1FBQzdELGtDQUFrQyxFQUFFLE1BQU07UUFDMUMsY0FBYyxFQUFFLGtCQUFrQjtLQUNuQyxDQUFDO0lBRUYsSUFBSTtRQUNGLG9DQUFvQztRQUNwQyxJQUFJLEtBQUssQ0FBQyxVQUFVLEtBQUssU0FBUyxFQUFFO1lBQ2xDLE9BQU87Z0JBQ0wsVUFBVSxFQUFFLEdBQUc7Z0JBQ2YsT0FBTyxFQUFFLFdBQVc7Z0JBQ3BCLElBQUksRUFBRSxFQUFFO2FBQ1QsQ0FBQztTQUNIO1FBRUQsaUJBQWlCO1FBQ2pCLE1BQU0sSUFBSSxHQUFHLEtBQUssQ0FBQyxJQUFJLENBQUM7UUFDeEIsTUFBTSxNQUFNLEdBQUcsS0FBSyxDQUFDLFVBQVUsQ0FBQztRQUVoQyxPQUFPLENBQUMsR0FBRyxDQUFDLGNBQWMsTUFBTSxJQUFJLElBQUksRUFBRSxDQUFDLENBQUM7UUFFNUMsd0JBQXdCO1FBQ3hCLElBQUksTUFBTSxLQUFLLEtBQUssSUFBSSxJQUFJLEtBQUssR0FBRyxFQUFFO1lBQ3BDLE1BQU0sUUFBUSxHQUFvQjtnQkFDaEMsT0FBTyxFQUFFLHNDQUFzQztnQkFDL0MsT0FBTyxFQUFFLE9BQU87Z0JBQ2hCLElBQUksRUFBRTtvQkFDSixTQUFTLEVBQUUsSUFBSSxJQUFJLEVBQUUsQ0FBQyxXQUFXLEVBQUU7b0JBQ25DLFNBQVMsRUFBRSxPQUFPLENBQUMsWUFBWTtvQkFDL0IsV0FBVyxFQUFFO3dCQUNYLFlBQVksRUFBRSxPQUFPLENBQUMsR0FBRyxDQUFDLGtCQUFrQjt3QkFDNUMsU0FBUyxFQUFFLE9BQU8sQ0FBQyxHQUFHLENBQUMsZUFBZTt3QkFDdEMsV0FBVyxFQUFFLE9BQU8sQ0FBQyxHQUFHLENBQUMsaUJBQWlCO3dCQUMxQyxXQUFXLEVBQUUsT0FBTyxDQUFDLEdBQUcsQ0FBQyxpQkFBaUI7cUJBQzNDO2lCQUNGO2FBQ0YsQ0FBQztZQUVGLE9BQU87Z0JBQ0wsVUFBVSxFQUFFLEdBQUc7Z0JBQ2YsT0FBTyxFQUFFLFdBQVc7Z0JBQ3BCLElBQUksRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFDLFFBQVEsQ0FBQzthQUMvQixDQUFDO1NBQ0g7UUFFRCxzQkFBc0I7UUFDdEIsSUFBSSxNQUFNLEtBQUssS0FBSyxJQUFJLElBQUksS0FBSyxhQUFhLEVBQUU7WUFDOUMsTUFBTSxRQUFRLEdBQW9CO2dCQUNoQyxPQUFPLEVBQUUsZ0JBQWdCO2dCQUN6QixPQUFPLEVBQUUsT0FBTztnQkFDaEIsSUFBSSxFQUFFO29CQUNKLFNBQVMsRUFBRSxJQUFJLElBQUksRUFBRSxDQUFDLFdBQVcsRUFBRTtvQkFDbkMsUUFBUSxFQUFFO3dCQUNSLFFBQVEsRUFBRSxXQUFXO3dCQUNyQixFQUFFLEVBQUUsV0FBVzt3QkFDZixHQUFHLEVBQUUsV0FBVzt3QkFDaEIsV0FBVyxFQUFFLFdBQVc7cUJBQ3pCO2lCQUNGO2FBQ0YsQ0FBQztZQUVGLE9BQU87Z0JBQ0wsVUFBVSxFQUFFLEdBQUc7Z0JBQ2YsT0FBTyxFQUFFLFdBQVc7Z0JBQ3BCLElBQUksRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFDLFFBQVEsQ0FBQzthQUMvQixDQUFDO1NBQ0g7UUFFRCxtQ0FBbUM7UUFDbkMsTUFBTSxhQUFhLEdBQWtCO1lBQ25DLEtBQUssRUFBRSxXQUFXO1lBQ2xCLE9BQU8sRUFBRSxTQUFTLE1BQU0sSUFBSSxJQUFJLFlBQVk7WUFDNUMsU0FBUyxFQUFFLE9BQU8sQ0FBQyxZQUFZO1NBQ2hDLENBQUM7UUFFRixPQUFPO1lBQ0wsVUFBVSxFQUFFLEdBQUc7WUFDZixPQUFPLEVBQUUsV0FBVztZQUNwQixJQUFJLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQyxhQUFhLENBQUM7U0FDcEMsQ0FBQztLQUVIO0lBQUMsT0FBTyxLQUFLLEVBQUU7UUFDZCxPQUFPLENBQUMsS0FBSyxDQUFDLGtCQUFrQixFQUFFLEtBQUssQ0FBQyxDQUFDO1FBRXpDLE1BQU0sYUFBYSxHQUFrQjtZQUNuQyxLQUFLLEVBQUUsdUJBQXVCO1lBQzlCLE9BQU8sRUFBRSxLQUFLLFlBQVksS0FBSyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyw4QkFBOEI7WUFDaEYsU0FBUyxFQUFFLE9BQU8sQ0FBQyxZQUFZO1NBQ2hDLENBQUM7UUFFRixPQUFPO1lBQ0wsVUFBVSxFQUFFLEdBQUc7WUFDZixPQUFPLEVBQUUsV0FBVztZQUNwQixJQUFJLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQyxhQUFhLENBQUM7U0FDcEMsQ0FBQztLQUNIO0FBQ0gsQ0FBQyxDQUFDO0FBMUdXLFFBQUEsT0FBTyxXQTBHbEIiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBBUElHYXRld2F5UHJveHlFdmVudCwgQVBJR2F0ZXdheVByb3h5UmVzdWx0LCBDb250ZXh0IH0gZnJvbSAnYXdzLWxhbWJkYSc7XHJcblxyXG5pbnRlcmZhY2UgRXJyb3JSZXNwb25zZSB7XHJcbiAgZXJyb3I6IHN0cmluZztcclxuICBtZXNzYWdlOiBzdHJpbmc7XHJcbiAgcmVxdWVzdElkPzogc3RyaW5nO1xyXG59XHJcblxyXG5pbnRlcmZhY2UgU3VjY2Vzc1Jlc3BvbnNlIHtcclxuICBtZXNzYWdlOiBzdHJpbmc7XHJcbiAgZGF0YT86IGFueTtcclxuICB2ZXJzaW9uOiBzdHJpbmc7XHJcbn1cclxuXHJcbmV4cG9ydCBjb25zdCBoYW5kbGVyID0gYXN5bmMgKFxyXG4gIGV2ZW50OiBBUElHYXRld2F5UHJveHlFdmVudCxcclxuICBjb250ZXh0OiBDb250ZXh0XHJcbik6IFByb21pc2U8QVBJR2F0ZXdheVByb3h5UmVzdWx0PiA9PiB7XHJcbiAgY29uc29sZS5sb2coJ0V2ZW50OicsIEpTT04uc3RyaW5naWZ5KGV2ZW50LCBudWxsLCAyKSk7XHJcbiAgY29uc29sZS5sb2coJ0NvbnRleHQ6JywgSlNPTi5zdHJpbmdpZnkoY29udGV4dCwgbnVsbCwgMikpO1xyXG5cclxuICBjb25zdCBjb3JzSGVhZGVycyA9IHtcclxuICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1PcmlnaW4nOiBldmVudC5oZWFkZXJzLm9yaWdpbiB8fCAnKicsXHJcbiAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctSGVhZGVycyc6ICdDb250ZW50LVR5cGUsQXV0aG9yaXphdGlvbixYLUFtei1EYXRlLFgtQXBpLUtleSxYLUFtei1TZWN1cml0eS1Ub2tlbixYLVJlcXVlc3RlZC1XaXRoJyxcclxuICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1NZXRob2RzJzogJ0dFVCxQT1NULFBVVCxERUxFVEUsT1BUSU9OUycsXHJcbiAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctQ3JlZGVudGlhbHMnOiAndHJ1ZScsXHJcbiAgICAnQ29udGVudC1UeXBlJzogJ2FwcGxpY2F0aW9uL2pzb24nLFxyXG4gIH07XHJcblxyXG4gIHRyeSB7XHJcbiAgICAvLyBIYW5kbGUgcHJlZmxpZ2h0IE9QVElPTlMgcmVxdWVzdHNcclxuICAgIGlmIChldmVudC5odHRwTWV0aG9kID09PSAnT1BUSU9OUycpIHtcclxuICAgICAgcmV0dXJuIHtcclxuICAgICAgICBzdGF0dXNDb2RlOiAyMDAsXHJcbiAgICAgICAgaGVhZGVyczogY29yc0hlYWRlcnMsXHJcbiAgICAgICAgYm9keTogJycsXHJcbiAgICAgIH07XHJcbiAgICB9XHJcblxyXG4gICAgLy8gUm91dGUgaGFuZGxpbmdcclxuICAgIGNvbnN0IHBhdGggPSBldmVudC5wYXRoO1xyXG4gICAgY29uc3QgbWV0aG9kID0gZXZlbnQuaHR0cE1ldGhvZDtcclxuXHJcbiAgICBjb25zb2xlLmxvZyhgUHJvY2Vzc2luZyAke21ldGhvZH0gJHtwYXRofWApO1xyXG5cclxuICAgIC8vIEhlYWx0aCBjaGVjayBlbmRwb2ludFxyXG4gICAgaWYgKG1ldGhvZCA9PT0gJ0dFVCcgJiYgcGF0aCA9PT0gJy8nKSB7XHJcbiAgICAgIGNvbnN0IHJlc3BvbnNlOiBTdWNjZXNzUmVzcG9uc2UgPSB7XHJcbiAgICAgICAgbWVzc2FnZTogJ0F1dG9tYXRlZCBCbG9nIFBvc3RlciBBUEkgaXMgcnVubmluZycsXHJcbiAgICAgICAgdmVyc2lvbjogJzEuMC4wJyxcclxuICAgICAgICBkYXRhOiB7XHJcbiAgICAgICAgICB0aW1lc3RhbXA6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcclxuICAgICAgICAgIHJlcXVlc3RJZDogY29udGV4dC5hd3NSZXF1ZXN0SWQsXHJcbiAgICAgICAgICBlbnZpcm9ubWVudDoge1xyXG4gICAgICAgICAgICBjb250ZW50VGFibGU6IHByb2Nlc3MuZW52LkNPTlRFTlRfVEFCTEVfTkFNRSxcclxuICAgICAgICAgICAgdXNlclRhYmxlOiBwcm9jZXNzLmVudi5VU0VSX1RBQkxFX05BTUUsXHJcbiAgICAgICAgICAgIGF1ZGlvQnVja2V0OiBwcm9jZXNzLmVudi5BVURJT19CVUNLRVRfTkFNRSxcclxuICAgICAgICAgICAgaW1hZ2VCdWNrZXQ6IHByb2Nlc3MuZW52LklNQUdFX0JVQ0tFVF9OQU1FLFxyXG4gICAgICAgICAgfSxcclxuICAgICAgICB9LFxyXG4gICAgICB9O1xyXG5cclxuICAgICAgcmV0dXJuIHtcclxuICAgICAgICBzdGF0dXNDb2RlOiAyMDAsXHJcbiAgICAgICAgaGVhZGVyczogY29yc0hlYWRlcnMsXHJcbiAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkocmVzcG9uc2UpLFxyXG4gICAgICB9O1xyXG4gICAgfVxyXG5cclxuICAgIC8vIEFQSSBzdGF0dXMgZW5kcG9pbnRcclxuICAgIGlmIChtZXRob2QgPT09ICdHRVQnICYmIHBhdGggPT09ICcvYXBpL3N0YXR1cycpIHtcclxuICAgICAgY29uc3QgcmVzcG9uc2U6IFN1Y2Nlc3NSZXNwb25zZSA9IHtcclxuICAgICAgICBtZXNzYWdlOiAnQVBJIGlzIGhlYWx0aHknLFxyXG4gICAgICAgIHZlcnNpb246ICcxLjAuMCcsXHJcbiAgICAgICAgZGF0YToge1xyXG4gICAgICAgICAgdGltZXN0YW1wOiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXHJcbiAgICAgICAgICBzZXJ2aWNlczoge1xyXG4gICAgICAgICAgICBkeW5hbW9kYjogJ2F2YWlsYWJsZScsXHJcbiAgICAgICAgICAgIHMzOiAnYXZhaWxhYmxlJyxcclxuICAgICAgICAgICAgc3FzOiAnYXZhaWxhYmxlJyxcclxuICAgICAgICAgICAgZXZlbnRicmlkZ2U6ICdhdmFpbGFibGUnLFxyXG4gICAgICAgICAgfSxcclxuICAgICAgICB9LFxyXG4gICAgICB9O1xyXG5cclxuICAgICAgcmV0dXJuIHtcclxuICAgICAgICBzdGF0dXNDb2RlOiAyMDAsXHJcbiAgICAgICAgaGVhZGVyczogY29yc0hlYWRlcnMsXHJcbiAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkocmVzcG9uc2UpLFxyXG4gICAgICB9O1xyXG4gICAgfVxyXG5cclxuICAgIC8vIERlZmF1bHQgNDA0IGZvciB1bm1hdGNoZWQgcm91dGVzXHJcbiAgICBjb25zdCBlcnJvclJlc3BvbnNlOiBFcnJvclJlc3BvbnNlID0ge1xyXG4gICAgICBlcnJvcjogJ05vdCBGb3VuZCcsXHJcbiAgICAgIG1lc3NhZ2U6IGBSb3V0ZSAke21ldGhvZH0gJHtwYXRofSBub3QgZm91bmRgLFxyXG4gICAgICByZXF1ZXN0SWQ6IGNvbnRleHQuYXdzUmVxdWVzdElkLFxyXG4gICAgfTtcclxuXHJcbiAgICByZXR1cm4ge1xyXG4gICAgICBzdGF0dXNDb2RlOiA0MDQsXHJcbiAgICAgIGhlYWRlcnM6IGNvcnNIZWFkZXJzLFxyXG4gICAgICBib2R5OiBKU09OLnN0cmluZ2lmeShlcnJvclJlc3BvbnNlKSxcclxuICAgIH07XHJcblxyXG4gIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICBjb25zb2xlLmVycm9yKCdVbmhhbmRsZWQgZXJyb3I6JywgZXJyb3IpO1xyXG5cclxuICAgIGNvbnN0IGVycm9yUmVzcG9uc2U6IEVycm9yUmVzcG9uc2UgPSB7XHJcbiAgICAgIGVycm9yOiAnSW50ZXJuYWwgU2VydmVyIEVycm9yJyxcclxuICAgICAgbWVzc2FnZTogZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiAnQW4gdW5leHBlY3RlZCBlcnJvciBvY2N1cnJlZCcsXHJcbiAgICAgIHJlcXVlc3RJZDogY29udGV4dC5hd3NSZXF1ZXN0SWQsXHJcbiAgICB9O1xyXG5cclxuICAgIHJldHVybiB7XHJcbiAgICAgIHN0YXR1c0NvZGU6IDUwMCxcclxuICAgICAgaGVhZGVyczogY29yc0hlYWRlcnMsXHJcbiAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KGVycm9yUmVzcG9uc2UpLFxyXG4gICAgfTtcclxuICB9XHJcbn07Il19