"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = void 0;
const auth_middleware_1 = require("./auth/auth-middleware");
const audit_logger_1 = require("./utils/audit-logger");
const api_handler_1 = require("./api-handler");
// Initialize authentication middleware
const authMiddleware = new auth_middleware_1.AuthMiddleware();
const auditLogger = new audit_logger_1.AuditLogger();
/**
 * Main authenticated API handler that wraps the original handler with authentication
 */
const authenticatedApiHandler = async (event, context) => {
    // Log data access for authenticated requests
    if (event.user) {
        await auditLogger.logDataAccess({
            eventType: 'DATA_ACCESS',
            userId: event.user.userId,
            resourceType: 'content',
            resourceId: 'api-endpoint',
            action: 'READ',
            sourceIp: event.requestContext.identity.sourceIp,
            userAgent: event.headers['User-Agent'],
            metadata: {
                path: event.path,
                method: event.httpMethod,
            },
        });
    }
    // Call the original handler
    return await (0, api_handler_1.handler)(event, context);
};
/**
 * Public endpoints that don't require authentication
 */
const publicEndpoints = [
    { method: 'GET', path: '/' },
    { method: 'GET', path: '/api/status' },
    { method: 'OPTIONS', path: '*' },
    { method: 'POST', path: '/api/auth/exchange' },
    { method: 'POST', path: '/api/auth/refresh' },
];
/**
 * Check if an endpoint is public
 */
function isPublicEndpoint(method, path) {
    return publicEndpoints.some(endpoint => {
        if (endpoint.path === '*') {
            return endpoint.method === method;
        }
        return endpoint.method === method && endpoint.path === path;
    });
}
/**
 * Main Lambda handler with conditional authentication
 */
const handler = async (event, context) => {
    const method = event.httpMethod;
    const path = event.path;
    // Check if this is a public endpoint
    if (isPublicEndpoint(method, path)) {
        // Use optional authentication for public endpoints
        return await authMiddleware.optionalAuthenticate(authenticatedApiHandler)(event, context);
    }
    else {
        // Require authentication for protected endpoints
        return await authMiddleware.authenticate(authenticatedApiHandler)(event, context);
    }
};
exports.handler = handler;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXV0aGVudGljYXRlZC1hcGktaGFuZGxlci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbImF1dGhlbnRpY2F0ZWQtYXBpLWhhbmRsZXIudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBQ0EsNERBQTRFO0FBQzVFLHVEQUFtRDtBQUNuRCwrQ0FBMkQ7QUFFM0QsdUNBQXVDO0FBQ3ZDLE1BQU0sY0FBYyxHQUFHLElBQUksZ0NBQWMsRUFBRSxDQUFDO0FBQzVDLE1BQU0sV0FBVyxHQUFHLElBQUksMEJBQVcsRUFBRSxDQUFDO0FBRXRDOztHQUVHO0FBQ0gsTUFBTSx1QkFBdUIsR0FBRyxLQUFLLEVBQ25DLEtBQXlCLEVBQ3pCLE9BQWdCLEVBQ2dCLEVBQUU7SUFDbEMsNkNBQTZDO0lBQzdDLElBQUksS0FBSyxDQUFDLElBQUksRUFBRTtRQUNkLE1BQU0sV0FBVyxDQUFDLGFBQWEsQ0FBQztZQUM5QixTQUFTLEVBQUUsYUFBYTtZQUN4QixNQUFNLEVBQUUsS0FBSyxDQUFDLElBQUksQ0FBQyxNQUFNO1lBQ3pCLFlBQVksRUFBRSxTQUFTO1lBQ3ZCLFVBQVUsRUFBRSxjQUFjO1lBQzFCLE1BQU0sRUFBRSxNQUFNO1lBQ2QsUUFBUSxFQUFFLEtBQUssQ0FBQyxjQUFjLENBQUMsUUFBUSxDQUFDLFFBQVE7WUFDaEQsU0FBUyxFQUFFLEtBQUssQ0FBQyxPQUFPLENBQUMsWUFBWSxDQUFDO1lBQ3RDLFFBQVEsRUFBRTtnQkFDUixJQUFJLEVBQUUsS0FBSyxDQUFDLElBQUk7Z0JBQ2hCLE1BQU0sRUFBRSxLQUFLLENBQUMsVUFBVTthQUN6QjtTQUNGLENBQUMsQ0FBQztLQUNKO0lBRUQsNEJBQTRCO0lBQzVCLE9BQU8sTUFBTSxJQUFBLHFCQUFlLEVBQUMsS0FBSyxFQUFFLE9BQU8sQ0FBQyxDQUFDO0FBQy9DLENBQUMsQ0FBQztBQUVGOztHQUVHO0FBQ0gsTUFBTSxlQUFlLEdBQUc7SUFDdEIsRUFBRSxNQUFNLEVBQUUsS0FBSyxFQUFFLElBQUksRUFBRSxHQUFHLEVBQUU7SUFDNUIsRUFBRSxNQUFNLEVBQUUsS0FBSyxFQUFFLElBQUksRUFBRSxhQUFhLEVBQUU7SUFDdEMsRUFBRSxNQUFNLEVBQUUsU0FBUyxFQUFFLElBQUksRUFBRSxHQUFHLEVBQUU7SUFDaEMsRUFBRSxNQUFNLEVBQUUsTUFBTSxFQUFFLElBQUksRUFBRSxvQkFBb0IsRUFBRTtJQUM5QyxFQUFFLE1BQU0sRUFBRSxNQUFNLEVBQUUsSUFBSSxFQUFFLG1CQUFtQixFQUFFO0NBQzlDLENBQUM7QUFFRjs7R0FFRztBQUNILFNBQVMsZ0JBQWdCLENBQUMsTUFBYyxFQUFFLElBQVk7SUFDcEQsT0FBTyxlQUFlLENBQUMsSUFBSSxDQUFDLFFBQVEsQ0FBQyxFQUFFO1FBQ3JDLElBQUksUUFBUSxDQUFDLElBQUksS0FBSyxHQUFHLEVBQUU7WUFDekIsT0FBTyxRQUFRLENBQUMsTUFBTSxLQUFLLE1BQU0sQ0FBQztTQUNuQztRQUNELE9BQU8sUUFBUSxDQUFDLE1BQU0sS0FBSyxNQUFNLElBQUksUUFBUSxDQUFDLElBQUksS0FBSyxJQUFJLENBQUM7SUFDOUQsQ0FBQyxDQUFDLENBQUM7QUFDTCxDQUFDO0FBRUQ7O0dBRUc7QUFDSSxNQUFNLE9BQU8sR0FBRyxLQUFLLEVBQzFCLEtBQTJCLEVBQzNCLE9BQWdCLEVBQ2dCLEVBQUU7SUFDbEMsTUFBTSxNQUFNLEdBQUcsS0FBSyxDQUFDLFVBQVUsQ0FBQztJQUNoQyxNQUFNLElBQUksR0FBRyxLQUFLLENBQUMsSUFBSSxDQUFDO0lBRXhCLHFDQUFxQztJQUNyQyxJQUFJLGdCQUFnQixDQUFDLE1BQU0sRUFBRSxJQUFJLENBQUMsRUFBRTtRQUNsQyxtREFBbUQ7UUFDbkQsT0FBTyxNQUFNLGNBQWMsQ0FBQyxvQkFBb0IsQ0FBQyx1QkFBdUIsQ0FBQyxDQUFDLEtBQUssRUFBRSxPQUFPLENBQUMsQ0FBQztLQUMzRjtTQUFNO1FBQ0wsaURBQWlEO1FBQ2pELE9BQU8sTUFBTSxjQUFjLENBQUMsWUFBWSxDQUFDLHVCQUF1QixDQUFDLENBQUMsS0FBSyxFQUFFLE9BQU8sQ0FBQyxDQUFDO0tBQ25GO0FBQ0gsQ0FBQyxDQUFDO0FBZlcsUUFBQSxPQUFPLFdBZWxCIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgQVBJR2F0ZXdheVByb3h5RXZlbnQsIEFQSUdhdGV3YXlQcm94eVJlc3VsdCwgQ29udGV4dCB9IGZyb20gJ2F3cy1sYW1iZGEnO1xyXG5pbXBvcnQgeyBBdXRoTWlkZGxld2FyZSwgQXV0aGVudGljYXRlZEV2ZW50IH0gZnJvbSAnLi9hdXRoL2F1dGgtbWlkZGxld2FyZSc7XHJcbmltcG9ydCB7IEF1ZGl0TG9nZ2VyIH0gZnJvbSAnLi91dGlscy9hdWRpdC1sb2dnZXInO1xyXG5pbXBvcnQgeyBoYW5kbGVyIGFzIG9yaWdpbmFsSGFuZGxlciB9IGZyb20gJy4vYXBpLWhhbmRsZXInO1xyXG5cclxuLy8gSW5pdGlhbGl6ZSBhdXRoZW50aWNhdGlvbiBtaWRkbGV3YXJlXHJcbmNvbnN0IGF1dGhNaWRkbGV3YXJlID0gbmV3IEF1dGhNaWRkbGV3YXJlKCk7XHJcbmNvbnN0IGF1ZGl0TG9nZ2VyID0gbmV3IEF1ZGl0TG9nZ2VyKCk7XHJcblxyXG4vKipcclxuICogTWFpbiBhdXRoZW50aWNhdGVkIEFQSSBoYW5kbGVyIHRoYXQgd3JhcHMgdGhlIG9yaWdpbmFsIGhhbmRsZXIgd2l0aCBhdXRoZW50aWNhdGlvblxyXG4gKi9cclxuY29uc3QgYXV0aGVudGljYXRlZEFwaUhhbmRsZXIgPSBhc3luYyAoXHJcbiAgZXZlbnQ6IEF1dGhlbnRpY2F0ZWRFdmVudCxcclxuICBjb250ZXh0OiBDb250ZXh0XHJcbik6IFByb21pc2U8QVBJR2F0ZXdheVByb3h5UmVzdWx0PiA9PiB7XHJcbiAgLy8gTG9nIGRhdGEgYWNjZXNzIGZvciBhdXRoZW50aWNhdGVkIHJlcXVlc3RzXHJcbiAgaWYgKGV2ZW50LnVzZXIpIHtcclxuICAgIGF3YWl0IGF1ZGl0TG9nZ2VyLmxvZ0RhdGFBY2Nlc3Moe1xyXG4gICAgICBldmVudFR5cGU6ICdEQVRBX0FDQ0VTUycsXHJcbiAgICAgIHVzZXJJZDogZXZlbnQudXNlci51c2VySWQsXHJcbiAgICAgIHJlc291cmNlVHlwZTogJ2NvbnRlbnQnLCAvLyBUaGlzIHdvdWxkIGJlIG1vcmUgc3BlY2lmaWMgaW4gYSByZWFsIGltcGxlbWVudGF0aW9uXHJcbiAgICAgIHJlc291cmNlSWQ6ICdhcGktZW5kcG9pbnQnLFxyXG4gICAgICBhY3Rpb246ICdSRUFEJyxcclxuICAgICAgc291cmNlSXA6IGV2ZW50LnJlcXVlc3RDb250ZXh0LmlkZW50aXR5LnNvdXJjZUlwLFxyXG4gICAgICB1c2VyQWdlbnQ6IGV2ZW50LmhlYWRlcnNbJ1VzZXItQWdlbnQnXSxcclxuICAgICAgbWV0YWRhdGE6IHtcclxuICAgICAgICBwYXRoOiBldmVudC5wYXRoLFxyXG4gICAgICAgIG1ldGhvZDogZXZlbnQuaHR0cE1ldGhvZCxcclxuICAgICAgfSxcclxuICAgIH0pO1xyXG4gIH1cclxuXHJcbiAgLy8gQ2FsbCB0aGUgb3JpZ2luYWwgaGFuZGxlclxyXG4gIHJldHVybiBhd2FpdCBvcmlnaW5hbEhhbmRsZXIoZXZlbnQsIGNvbnRleHQpO1xyXG59O1xyXG5cclxuLyoqXHJcbiAqIFB1YmxpYyBlbmRwb2ludHMgdGhhdCBkb24ndCByZXF1aXJlIGF1dGhlbnRpY2F0aW9uXHJcbiAqL1xyXG5jb25zdCBwdWJsaWNFbmRwb2ludHMgPSBbXHJcbiAgeyBtZXRob2Q6ICdHRVQnLCBwYXRoOiAnLycgfSxcclxuICB7IG1ldGhvZDogJ0dFVCcsIHBhdGg6ICcvYXBpL3N0YXR1cycgfSxcclxuICB7IG1ldGhvZDogJ09QVElPTlMnLCBwYXRoOiAnKicgfSwgLy8gQ09SUyBwcmVmbGlnaHRcclxuICB7IG1ldGhvZDogJ1BPU1QnLCBwYXRoOiAnL2FwaS9hdXRoL2V4Y2hhbmdlJyB9LFxyXG4gIHsgbWV0aG9kOiAnUE9TVCcsIHBhdGg6ICcvYXBpL2F1dGgvcmVmcmVzaCcgfSxcclxuXTtcclxuXHJcbi8qKlxyXG4gKiBDaGVjayBpZiBhbiBlbmRwb2ludCBpcyBwdWJsaWNcclxuICovXHJcbmZ1bmN0aW9uIGlzUHVibGljRW5kcG9pbnQobWV0aG9kOiBzdHJpbmcsIHBhdGg6IHN0cmluZyk6IGJvb2xlYW4ge1xyXG4gIHJldHVybiBwdWJsaWNFbmRwb2ludHMuc29tZShlbmRwb2ludCA9PiB7XHJcbiAgICBpZiAoZW5kcG9pbnQucGF0aCA9PT0gJyonKSB7XHJcbiAgICAgIHJldHVybiBlbmRwb2ludC5tZXRob2QgPT09IG1ldGhvZDtcclxuICAgIH1cclxuICAgIHJldHVybiBlbmRwb2ludC5tZXRob2QgPT09IG1ldGhvZCAmJiBlbmRwb2ludC5wYXRoID09PSBwYXRoO1xyXG4gIH0pO1xyXG59XHJcblxyXG4vKipcclxuICogTWFpbiBMYW1iZGEgaGFuZGxlciB3aXRoIGNvbmRpdGlvbmFsIGF1dGhlbnRpY2F0aW9uXHJcbiAqL1xyXG5leHBvcnQgY29uc3QgaGFuZGxlciA9IGFzeW5jIChcclxuICBldmVudDogQVBJR2F0ZXdheVByb3h5RXZlbnQsXHJcbiAgY29udGV4dDogQ29udGV4dFxyXG4pOiBQcm9taXNlPEFQSUdhdGV3YXlQcm94eVJlc3VsdD4gPT4ge1xyXG4gIGNvbnN0IG1ldGhvZCA9IGV2ZW50Lmh0dHBNZXRob2Q7XHJcbiAgY29uc3QgcGF0aCA9IGV2ZW50LnBhdGg7XHJcblxyXG4gIC8vIENoZWNrIGlmIHRoaXMgaXMgYSBwdWJsaWMgZW5kcG9pbnRcclxuICBpZiAoaXNQdWJsaWNFbmRwb2ludChtZXRob2QsIHBhdGgpKSB7XHJcbiAgICAvLyBVc2Ugb3B0aW9uYWwgYXV0aGVudGljYXRpb24gZm9yIHB1YmxpYyBlbmRwb2ludHNcclxuICAgIHJldHVybiBhd2FpdCBhdXRoTWlkZGxld2FyZS5vcHRpb25hbEF1dGhlbnRpY2F0ZShhdXRoZW50aWNhdGVkQXBpSGFuZGxlcikoZXZlbnQsIGNvbnRleHQpO1xyXG4gIH0gZWxzZSB7XHJcbiAgICAvLyBSZXF1aXJlIGF1dGhlbnRpY2F0aW9uIGZvciBwcm90ZWN0ZWQgZW5kcG9pbnRzXHJcbiAgICByZXR1cm4gYXdhaXQgYXV0aE1pZGRsZXdhcmUuYXV0aGVudGljYXRlKGF1dGhlbnRpY2F0ZWRBcGlIYW5kbGVyKShldmVudCwgY29udGV4dCk7XHJcbiAgfVxyXG59OyJdfQ==