"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthMiddleware = void 0;
const jwt_service_1 = require("./jwt-service");
const audit_logger_1 = require("../utils/audit-logger");
class AuthMiddleware {
    constructor() {
        this.jwtService = new jwt_service_1.JWTService();
        this.auditLogger = new audit_logger_1.AuditLogger();
    }
    /**
     * Create an authenticated handler wrapper
     */
    authenticate(handler) {
        return async (event, context) => {
            try {
                // Extract token from Authorization header
                const authHeader = event.headers.Authorization || event.headers.authorization;
                if (!authHeader) {
                    await this.auditLogger.logSecurityEvent({
                        eventType: 'AUTHENTICATION_FAILED',
                        reason: 'Missing authorization header',
                        sourceIp: event.requestContext.identity.sourceIp,
                        userAgent: event.headers['User-Agent'] || 'Unknown',
                        path: event.path,
                        method: event.httpMethod,
                    });
                    return this.unauthorizedResponse('Missing authorization header');
                }
                // Validate Bearer token format
                const tokenMatch = authHeader.match(/^Bearer\s+(.+)$/);
                if (!tokenMatch) {
                    await this.auditLogger.logSecurityEvent({
                        eventType: 'AUTHENTICATION_FAILED',
                        reason: 'Invalid authorization header format',
                        sourceIp: event.requestContext.identity.sourceIp,
                        userAgent: event.headers['User-Agent'] || 'Unknown',
                        path: event.path,
                        method: event.httpMethod,
                    });
                    return this.unauthorizedResponse('Invalid authorization header format');
                }
                const token = tokenMatch[1];
                // Verify JWT token
                const user = await this.jwtService.verifyAccessToken(token);
                // Log successful authentication
                await this.auditLogger.logSecurityEvent({
                    eventType: 'AUTHENTICATION_SUCCESS',
                    userId: user.userId,
                    sourceIp: event.requestContext.identity.sourceIp,
                    userAgent: event.headers['User-Agent'] || 'Unknown',
                    path: event.path,
                    method: event.httpMethod,
                });
                // Add user to event object
                const authenticatedEvent = {
                    ...event,
                    user,
                };
                // Call the original handler
                return await handler(authenticatedEvent, context);
            }
            catch (error) {
                const errorMessage = error instanceof Error ? error.message : 'Authentication failed';
                await this.auditLogger.logSecurityEvent({
                    eventType: 'AUTHENTICATION_FAILED',
                    reason: errorMessage,
                    sourceIp: event.requestContext.identity.sourceIp,
                    userAgent: event.headers['User-Agent'] || 'Unknown',
                    path: event.path,
                    method: event.httpMethod,
                });
                return this.unauthorizedResponse(errorMessage);
            }
        };
    }
    /**
     * Create an optional authentication handler (allows both authenticated and anonymous access)
     */
    optionalAuthenticate(handler) {
        return async (event, context) => {
            try {
                const authHeader = event.headers.Authorization || event.headers.authorization;
                if (authHeader) {
                    const tokenMatch = authHeader.match(/^Bearer\s+(.+)$/);
                    if (tokenMatch) {
                        try {
                            const token = tokenMatch[1];
                            const user = await this.jwtService.verifyAccessToken(token);
                            const authenticatedEvent = {
                                ...event,
                                user,
                            };
                            return await handler(authenticatedEvent, context);
                        }
                        catch (error) {
                            // Log failed authentication attempt but continue as anonymous
                            await this.auditLogger.logSecurityEvent({
                                eventType: 'AUTHENTICATION_FAILED',
                                reason: error instanceof Error ? error.message : 'Token verification failed',
                                sourceIp: event.requestContext.identity.sourceIp,
                                userAgent: event.headers['User-Agent'] || 'Unknown',
                                path: event.path,
                                method: event.httpMethod,
                            });
                        }
                    }
                }
                // Continue as anonymous user
                return await handler(event, context);
            }
            catch (error) {
                console.error('Error in optional authentication:', error);
                return await handler(event, context);
            }
        };
    }
    /**
     * Create authorization middleware for role-based access
     */
    authorize(requiredRoles = []) {
        return (handler) => {
            return this.authenticate(async (event, context) => {
                if (!event.user) {
                    return this.forbiddenResponse('User not authenticated');
                }
                // In a real implementation, you'd check user roles from database
                // For now, we'll assume all authenticated users have basic access
                if (requiredRoles.length > 0) {
                    // Placeholder for role checking logic
                    const userRoles = ['user']; // This would come from user profile
                    const hasRequiredRole = requiredRoles.some(role => userRoles.includes(role));
                    if (!hasRequiredRole) {
                        await this.auditLogger.logSecurityEvent({
                            eventType: 'AUTHORIZATION_FAILED',
                            userId: event.user.userId,
                            reason: `Insufficient permissions. Required: ${requiredRoles.join(', ')}`,
                            sourceIp: event.requestContext.identity.sourceIp,
                            userAgent: event.headers['User-Agent'] || 'Unknown',
                            path: event.path,
                            method: event.httpMethod,
                        });
                        return this.forbiddenResponse('Insufficient permissions');
                    }
                }
                return await handler(event, context);
            });
        };
    }
    /**
     * Rate limiting middleware
     */
    rateLimit(maxRequests = 100, windowMinutes = 15) {
        return (handler) => {
            return async (event, context) => {
                const sourceIp = event.requestContext.identity.sourceIp;
                const userId = event.user?.userId;
                // In a real implementation, you'd use Redis or DynamoDB to track request counts
                // For now, we'll log the rate limiting attempt
                await this.auditLogger.logSecurityEvent({
                    eventType: 'RATE_LIMIT_CHECK',
                    userId,
                    sourceIp,
                    path: event.path,
                    method: event.httpMethod,
                    metadata: {
                        maxRequests,
                        windowMinutes,
                    },
                });
                return await handler(event, context);
            };
        };
    }
    /**
     * Return unauthorized response
     */
    unauthorizedResponse(message) {
        return {
            statusCode: 401,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': process.env.CORS_ORIGIN || '*',
                'Access-Control-Allow-Credentials': 'true',
            },
            body: JSON.stringify({
                error: 'Unauthorized',
                message,
            }),
        };
    }
    /**
     * Return forbidden response
     */
    forbiddenResponse(message) {
        return {
            statusCode: 403,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': process.env.CORS_ORIGIN || '*',
                'Access-Control-Allow-Credentials': 'true',
            },
            body: JSON.stringify({
                error: 'Forbidden',
                message,
            }),
        };
    }
}
exports.AuthMiddleware = AuthMiddleware;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXV0aC1taWRkbGV3YXJlLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiYXV0aC1taWRkbGV3YXJlLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUNBLCtDQUF1RDtBQUN2RCx3REFBb0Q7QUFXcEQsTUFBYSxjQUFjO0lBSXpCO1FBQ0UsSUFBSSxDQUFDLFVBQVUsR0FBRyxJQUFJLHdCQUFVLEVBQUUsQ0FBQztRQUNuQyxJQUFJLENBQUMsV0FBVyxHQUFHLElBQUksMEJBQVcsRUFBRSxDQUFDO0lBQ3ZDLENBQUM7SUFFRDs7T0FFRztJQUNILFlBQVksQ0FBQyxPQUE2QjtRQUN4QyxPQUFPLEtBQUssRUFBRSxLQUEyQixFQUFFLE9BQWdCLEVBQWtDLEVBQUU7WUFDN0YsSUFBSTtnQkFDRiwwQ0FBMEM7Z0JBQzFDLE1BQU0sVUFBVSxHQUFHLEtBQUssQ0FBQyxPQUFPLENBQUMsYUFBYSxJQUFJLEtBQUssQ0FBQyxPQUFPLENBQUMsYUFBYSxDQUFDO2dCQUM5RSxJQUFJLENBQUMsVUFBVSxFQUFFO29CQUNmLE1BQU0sSUFBSSxDQUFDLFdBQVcsQ0FBQyxnQkFBZ0IsQ0FBQzt3QkFDdEMsU0FBUyxFQUFFLHVCQUF1Qjt3QkFDbEMsTUFBTSxFQUFFLDhCQUE4Qjt3QkFDdEMsUUFBUSxFQUFFLEtBQUssQ0FBQyxjQUFjLENBQUMsUUFBUSxDQUFDLFFBQVE7d0JBQ2hELFNBQVMsRUFBRSxLQUFLLENBQUMsT0FBTyxDQUFDLFlBQVksQ0FBQyxJQUFJLFNBQVM7d0JBQ25ELElBQUksRUFBRSxLQUFLLENBQUMsSUFBSTt3QkFDaEIsTUFBTSxFQUFFLEtBQUssQ0FBQyxVQUFVO3FCQUN6QixDQUFDLENBQUM7b0JBRUgsT0FBTyxJQUFJLENBQUMsb0JBQW9CLENBQUMsOEJBQThCLENBQUMsQ0FBQztpQkFDbEU7Z0JBRUQsK0JBQStCO2dCQUMvQixNQUFNLFVBQVUsR0FBRyxVQUFVLENBQUMsS0FBSyxDQUFDLGlCQUFpQixDQUFDLENBQUM7Z0JBQ3ZELElB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WUFDTCxVQUFVLEVBQUUsR0FBRztZQUNmLE9BQU8sRUFBRTtnQkFDUCxjQUFjLEVBQUUsa0JBQWtCO2dCQUNsQyw2QkFBNkIsRUFBRSxPQUFPLENBQUMsR0FBRyxDQUFDLFdBQVcsSUFBSSxHQUFHO2dCQUM3RCxrQ0FBa0MsRUFBRSxNQUFNO2FBQzNDO1lBQ0QsSUFBSSxFQUFFLElBQUksQ0FBQyxTQUFTLENBQUM7Z0JBQ25CLEtBQUssRUFBRSxXQUFXO2dCQUNsQixPQUFPO2FBQ1IsQ0FBQztTQUNILENBQUM7SUFDSixDQUFDO0NBQ0Y7QUF2T0Qsd0NBdU9DIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgQVBJR2F0ZXdheVByb3h5RXZlbnQsIEFQSUdhdGV3YXlQcm94eVJlc3VsdCwgQ29udGV4dCB9IGZyb20gJ2F3cy1sYW1iZGEnO1xyXG5pbXBvcnQgeyBKV1RTZXJ2aWNlLCBKV1RQYXlsb2FkIH0gZnJvbSAnLi9qd3Qtc2VydmljZSc7XHJcbmltcG9ydCB7IEF1ZGl0TG9nZ2VyIH0gZnJvbSAnLi4vdXRpbHMvYXVkaXQtbG9nZ2VyJztcclxuXHJcbmV4cG9ydCBpbnRlcmZhY2UgQXV0aGVudGljYXRlZEV2ZW50IGV4dGVuZHMgQVBJR2F0ZXdheVByb3h5RXZlbnQge1xyXG4gIHVzZXI/OiBKV1RQYXlsb2FkO1xyXG59XHJcblxyXG5leHBvcnQgdHlwZSBBdXRoZW50aWNhdGVkSGFuZGxlciA9IChcclxuICBldmVudDogQXV0aGVudGljYXRlZEV2ZW50LFxyXG4gIGNvbnRleHQ6IENvbnRleHRcclxuKSA9PiBQcm9taXNlPEFQSUdhdGV3YXlQcm94eVJlc3VsdD47XHJcblxyXG5leHBvcnQgY2xhc3MgQXV0aE1pZGRsZXdhcmUge1xyXG4gIHByaXZhdGUgcmVhZG9ubHkgand0U2VydmljZTogSldUU2VydmljZTtcclxuICBwcml2YXRlIHJlYWRvbmx5IGF1ZGl0TG9nZ2VyOiBBdWRpdExvZ2dlcjtcclxuXHJcbiAgY29uc3RydWN0b3IoKSB7XHJcbiAgICB0aGlzLmp3dFNlcnZpY2UgPSBuZXcgSldUU2VydmljZSgpO1xyXG4gICAgdGhpcy5hdWRpdExvZ2dlciA9IG5ldyBBdWRpdExvZ2dlcigpO1xyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogQ3JlYXRlIGFuIGF1dGhlbnRpY2F0ZWQgaGFuZGxlciB3cmFwcGVyXHJcbiAgICovXHJcbiAgYXV0aGVudGljYXRlKGhhbmRsZXI6IEF1dGhlbnRpY2F0ZWRIYW5kbGVyKTogKGV2ZW50OiBBUElHYXRld2F5UHJveHlFdmVudCwgY29udGV4dDogQ29udGV4dCkgPT4gUHJvbWlzZTxBUElHYXRld2F5UHJveHlSZXN1bHQ+IHtcclxuICAgIHJldHVybiBhc3luYyAoZXZlbnQ6IEFQSUdhdGV3YXlQcm94eUV2ZW50LCBjb250ZXh0OiBDb250ZXh0KTogUHJvbWlzZTxBUElHYXRld2F5UHJveHlSZXN1bHQ+ID0+IHtcclxuICAgICAgdHJ5IHtcclxuICAgICAgICAvLyBFeHRyYWN0IHRva2VuIGZyb20gQXV0aG9yaXphdGlvbiBoZWFkZXJcclxuICAgICAgICBjb25zdCBhdXRoSGVhZGVyID0gZXZlbnQuaGVhZGVycy5BdXRob3JpemF0aW9uIHx8IGV2ZW50LmhlYWRlcnMuYXV0aG9yaXphdGlvbjtcclxuICAgICAgICBpZiAoIWF1dGhIZWFkZXIpIHtcclxuICAgICAgICAgIGF3YWl0IHRoaXMuYXVkaXRMb2dnZXIubG9nU2VjdXJpdHlFdmVudCh7XHJcbiAgICAgICAgICAgIGV2ZW50VHlwZTogJ0FVVEhFTlRJQ0FUSU9OX0ZBSUxFRCcsXHJcbiAgICAgICAgICAgIHJlYXNvbjogJ01pc3NpbmcgYXV0aG9yaXphdGlvbiBoZWFkZXInLFxyXG4gICAgICAgICAgICBzb3VyY2VJcDogZXZlbnQucmVxdWVzdENvbnRleHQuaWRlbnRpdHkuc291cmNlSXAsXHJcbiAgICAgICAgICAgIHVzZXJBZ2VudDogZXZlbnQuaGVhZGVyc1snVXNlci1BZ2VudCddIHx8ICdVbmtub3duJyxcclxuICAgICAgICAgICAgcGF0aDogZXZlbnQucGF0aCxcclxuICAgICAgICAgICAgbWV0aG9kOiBldmVudC5odHRwTWV0aG9kLFxyXG4gICAgICAgICAgfSk7XHJcblxyXG4gICAgICAgICAgcmV0dXJuIHRoaXMudW5hdXRob3JpemVkUmVzcG9uc2UoJ01pc3NpbmcgYXV0aG9yaXphdGlvbiBoZWFkZXInKTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIC8vIFZhbGlkYXRlIEJlYXJlciB0b2tlbiBmb3JtYXRcclxuICAgICAgICBjb25zdCB0b2tlbk1hdGNoID0gYXV0aEhlYWRlci5tYXRjaCgvXkJlYXJlclxccysoLispJC8pO1xyXG4gICAgICAgIGlmICghdG9rZW5NYXRjaCkge1xyXG4gICAgICAgICAgYXdhaXQgdGhpcy5hdWRpdExvZ2dlci5sb2dTZWN1cml0eUV2ZW50KHtcclxuICAgICAgICAgICAgZXZlbnRUeXBlOiAnQVVUSEVOVElDQVRJT05fRkFJTEVEJyxcclxuICAgICAgICAgICAgcmVhc29uOiAnSW52YWxpZCBhdXRob3JpemF0aW9uIGhlYWRlciBmb3JtYXQnLFxyXG4gICAgICAgICAgICBzb3VyY2VJcDogZXZlbnQucmVxdWVzdENvbnRleHQuaWRlbnRpdHkuc291cmNlSXAsXHJcbiAgICAgICAgICAgIHVzZXJBZ2VudDogZXZlbnQuaGVhZGVyc1snVXNlci1BZ2VudCddIHx8ICdVbmtub3duJyxcclxuICAgICAgICAgICAgcGF0aDogZXZlbnQucGF0aCxcclxuICAgICAgICAgICAgbWV0aG9kOiBldmVudC5odHRwTWV0aG9kLFxyXG4gICAgICAgICAgfSk7XHJcblxyXG4gICAgICAgICAgcmV0dXJuIHRoaXMudW5hdXRob3JpemVkUmVzcG9uc2UoJ0ludmFsaWQgYXV0aG9yaXphdGlvbiBoZWFkZXIgZm9ybWF0Jyk7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBjb25zdCB0b2tlbiA9IHRva2VuTWF0Y2hbMV07XHJcblxyXG4gICAgICAgIC8vIFZlcmlmeSBKV1QgdG9rZW5cclxuICAgICAgICBjb25zdCB1c2VyID0gYXdhaXQgdGhpcy5qd3RTZXJ2aWNlLnZlcmlmeUFjY2Vzc1Rva2VuKHRva2VuKTtcclxuXHJcbiAgICAgICAgLy8gTG9nIHN1Y2Nlc3NmdWwgYXV0aGVudGljYXRpb25cclxuICAgICAgICBhd2FpdCB0aGlzLmF1ZGl0TG9nZ2VyLmxvZ1NlY3VyaXR5RXZlbnQoe1xyXG4gICAgICAgICAgZXZlbnRUeXBlOiAnQVVUSEVOVElDQVRJT05fU1VDQ0VTUycsXHJcbiAgICAgICAgICB1c2VySWQ6IHVzZXIudXNlcklkLFxyXG4gICAgICAgICAgc291cmNlSXA6IGV2ZW50LnJlcXVlc3RDb250ZXh0LmlkZW50aXR5LnNvdXJjZUlwLFxyXG4gICAgICAgICAgdXNlckFnZW50OiBldmVudC5oZWFkZXJzWydVc2VyLUFnZW50J10gfHwgJ1Vua25vd24nLFxyXG4gICAgICAgICAgcGF0aDogZXZlbnQucGF0aCxcclxuICAgICAgICAgIG1ldGhvZDogZXZlbnQuaHR0cE1ldGhvZCxcclxuICAgICAgICB9KTtcclxuXHJcbiAgICAgICAgLy8gQWRkIHVzZXIgdG8gZXZlbnQgb2JqZWN0XHJcbiAgICAgICAgY29uc3QgYXV0aGVudGljYXRlZEV2ZW50OiBBdXRoZW50aWNhdGVkRXZlbnQgPSB7XHJcbiAgICAgICAgICAuLi5ldmVudCxcclxuICAgICAgICAgIHVzZXIsXHJcbiAgICAgICAgfTtcclxuXHJcbiAgICAgICAgLy8gQ2FsbCB0aGUgb3JpZ2luYWwgaGFuZGxlclxyXG4gICAgICAgIHJldHVybiBhd2FpdCBoYW5kbGVyKGF1dGhlbnRpY2F0ZWRFdmVudCwgY29udGV4dCk7XHJcblxyXG4gICAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICAgIGNvbnN0IGVycm9yTWVzc2FnZSA9IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogJ0F1dGhlbnRpY2F0aW9uIGZhaWxlZCc7XHJcbiAgICAgICAgXHJcbiAgICAgICAgYXdhaXQgdGhpcy5hdWRpdExvZ2dlci5sb2dTZWN1cml0eUV2ZW50KHtcclxuICAgICAgICAgIGV2ZW50VHlwZTogJ0FVVEhFTlRJQ0FUSU9OX0ZBSUxFRCcsXHJcbiAgICAgICAgICByZWFzb246IGVycm9yTWVzc2FnZSxcclxuICAgICAgICAgIHNvdXJjZUlwOiBldmVudC5yZXF1ZXN0Q29udGV4dC5pZGVudGl0eS5zb3VyY2VJcCxcclxuICAgICAgICAgIHVzZXJBZ2VudDogZXZlbnQuaGVhZGVyc1snVXNlci1BZ2VudCddIHx8ICdVbmtub3duJyxcclxuICAgICAgICAgIHBhdGg6IGV2ZW50LnBhdGgsXHJcbiAgICAgICAgICBtZXRob2Q6IGV2ZW50Lmh0dHBNZXRob2QsXHJcbiAgICAgICAgfSk7XHJcblxyXG4gICAgICAgIHJldHVybiB0aGlzLnVuYXV0aG9yaXplZFJlc3BvbnNlKGVycm9yTWVzc2FnZSk7XHJcbiAgICAgIH1cclxuICAgIH07XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBDcmVhdGUgYW4gb3B0aW9uYWwgYXV0aGVudGljYXRpb24gaGFuZGxlciAoYWxsb3dzIGJvdGggYXV0aGVudGljYXRlZCBhbmQgYW5vbnltb3VzIGFjY2VzcylcclxuICAgKi9cclxuICBvcHRpb25hbEF1dGhlbnRpY2F0ZShoYW5kbGVyOiBBdXRoZW50aWNhdGVkSGFuZGxlcik6IChldmVudDogQVBJR2F0ZXdheVByb3h5RXZlbnQsIGNvbnRleHQ6IENvbnRleHQpID0+IFByb21pc2U8QVBJR2F0ZXdheVByb3h5UmVzdWx0PiB7XHJcbiAgICByZXR1cm4gYXN5bmMgKGV2ZW50OiBBUElHYXRld2F5UHJveHlFdmVudCwgY29udGV4dDogQ29udGV4dCk6IFByb21pc2U8QVBJR2F0ZXdheVByb3h5UmVzdWx0PiA9PiB7XHJcbiAgICAgIHRyeSB7XHJcbiAgICAgICAgY29uc3QgYXV0aEhlYWRlciA9IGV2ZW50LmhlYWRlcnMuQXV0aG9yaXphdGlvbiB8fCBldmVudC5oZWFkZXJzLmF1dGhvcml6YXRpb247XHJcbiAgICAgICAgXHJcbiAgICAgICAgaWYgKGF1dGhIZWFkZXIpIHtcclxuICAgICAgICAgIGNvbnN0IHRva2VuTWF0Y2ggPSBhdXRoSGVhZGVyLm1hdGNoKC9eQmVhcmVyXFxzKyguKykkLyk7XHJcbiAgICAgICAgICBpZiAodG9rZW5NYXRjaCkge1xyXG4gICAgICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICAgIGNvbnN0IHRva2VuID0gdG9rZW5NYXRjaFsxXTtcclxuICAgICAgICAgICAgICBjb25zdCB1c2VyID0gYXdhaXQgdGhpcy5qd3RTZXJ2aWNlLnZlcmlmeUFjY2Vzc1Rva2VuKHRva2VuKTtcclxuICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICBjb25zdCBhdXRoZW50aWNhdGVkRXZlbnQ6IEF1dGhlbnRpY2F0ZWRFdmVudCA9IHtcclxuICAgICAgICAgICAgICAgIC4uLmV2ZW50LFxyXG4gICAgICAgICAgICAgICAgdXNlcixcclxuICAgICAgICAgICAgICB9O1xyXG5cclxuICAgICAgICAgICAgICByZXR1cm4gYXdhaXQgaGFuZGxlcihhdXRoZW50aWNhdGVkRXZlbnQsIGNvbnRleHQpO1xyXG4gICAgICAgICAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICAgICAgICAgIC8vIExvZyBmYWlsZWQgYXV0aGVudGljYXRpb24gYXR0ZW1wdCBidXQgY29udGludWUgYXMgYW5vbnltb3VzXHJcbiAgICAgICAgICAgICAgYXdhaXQgdGhpcy5hdWRpdExvZ2dlci5sb2dTZWN1cml0eUV2ZW50KHtcclxuICAgICAgICAgICAgICAgIGV2ZW50VHlwZTogJ0FVVEhFTlRJQ0FUSU9OX0ZBSUxFRCcsXHJcbiAgICAgICAgICAgICAgICByZWFzb246IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogJ1Rva2VuIHZlcmlmaWNhdGlvbiBmYWlsZWQnLFxyXG4gICAgICAgICAgICAgICAgc291cmNlSXA6IGV2ZW50LnJlcXVlc3RDb250ZXh0LmlkZW50aXR5LnNvdXJjZUlwLFxyXG4gICAgICAgICAgICAgICAgdXNlckFnZW50OiBldmVudC5oZWFkZXJzWydVc2VyLUFnZW50J10gfHwgJ1Vua25vd24nLFxyXG4gICAgICAgICAgICAgICAgcGF0aDogZXZlbnQucGF0aCxcclxuICAgICAgICAgICAgICAgIG1ldGhvZDogZXZlbnQuaHR0cE1ldGhvZCxcclxuICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgLy8gQ29udGludWUgYXMgYW5vbnltb3VzIHVzZXJcclxuICAgICAgICByZXR1cm4gYXdhaXQgaGFuZGxlcihldmVudCBhcyBBdXRoZW50aWNhdGVkRXZlbnQsIGNvbnRleHQpO1xyXG5cclxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICBjb25zb2xlLmVycm9yKCdFcnJvciBpbiBvcHRpb25hbCBhdXRoZW50aWNhdGlvbjonLCBlcnJvcik7XHJcbiAgICAgICAgcmV0dXJuIGF3YWl0IGhhbmRsZXIoZXZlbnQgYXMgQXV0aGVudGljYXRlZEV2ZW50LCBjb250ZXh0KTtcclxuICAgICAgfVxyXG4gICAgfTtcclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIENyZWF0ZSBhdXRob3JpemF0aW9uIG1pZGRsZXdhcmUgZm9yIHJvbGUtYmFzZWQgYWNjZXNzXHJcbiAgICovXHJcbiAgYXV0aG9yaXplKHJlcXVpcmVkUm9sZXM6IHN0cmluZ1tdID0gW10pIHtcclxuICAgIHJldHVybiAoaGFuZGxlcjogQXV0aGVudGljYXRlZEhhbmRsZXIpID0+IHtcclxuICAgICAgcmV0dXJuIHRoaXMuYXV0aGVudGljYXRlKGFzeW5jIChldmVudDogQXV0aGVudGljYXRlZEV2ZW50LCBjb250ZXh0OiBDb250ZXh0KSA9PiB7XHJcbiAgICAgICAgaWYgKCFldmVudC51c2VyKSB7XHJcbiAgICAgICAgICByZXR1cm4gdGhpcy5mb3JiaWRkZW5SZXNwb25zZSgnVXNlciBub3QgYXV0aGVudGljYXRlZCcpO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgLy8gSW4gYSByZWFsIGltcGxlbWVudGF0aW9uLCB5b3UnZCBjaGVjayB1c2VyIHJvbGVzIGZyb20gZGF0YWJhc2VcclxuICAgICAgICAvLyBGb3Igbm93LCB3ZSdsbCBhc3N1bWUgYWxsIGF1dGhlbnRpY2F0ZWQgdXNlcnMgaGF2ZSBiYXNpYyBhY2Nlc3NcclxuICAgICAgICBpZiAocmVxdWlyZWRSb2xlcy5sZW5ndGggPiAwKSB7XHJcbiAgICAgICAgICAvLyBQbGFjZWhvbGRlciBmb3Igcm9sZSBjaGVja2luZyBsb2dpY1xyXG4gICAgICAgICAgY29uc3QgdXNlclJvbGVzID0gWyd1c2VyJ107IC8vIFRoaXMgd291bGQgY29tZSBmcm9tIHVzZXIgcHJvZmlsZVxyXG4gICAgICAgICAgY29uc3QgaGFzUmVxdWlyZWRSb2xlID0gcmVxdWlyZWRSb2xlcy5zb21lKHJvbGUgPT4gdXNlclJvbGVzLmluY2x1ZGVzKHJvbGUpKTtcclxuICAgICAgICAgIFxyXG4gICAgICAgICAgaWYgKCFoYXNSZXF1aXJlZFJvbGUpIHtcclxuICAgICAgICAgICAgYXdhaXQgdGhpcy5hdWRpdExvZ2dlci5sb2dTZWN1cml0eUV2ZW50KHtcclxuICAgICAgICAgICAgICBldmVudFR5cGU6ICdBVVRIT1JJWkFUSU9OX0ZBSUxFRCcsXHJcbiAgICAgICAgICAgICAgdXNlcklkOiBldmVudC51c2VyLnVzZXJJZCxcclxuICAgICAgICAgICAgICByZWFzb246IGBJbnN1ZmZpY2llbnQgcGVybWlzc2lvbnMuIFJlcXVpcmVkOiAke3JlcXVpcmVkUm9sZXMuam9pbignLCAnKX1gLFxyXG4gICAgICAgICAgICAgIHNvdXJjZUlwOiBldmVudC5yZXF1ZXN0Q29udGV4dC5pZGVudGl0eS5zb3VyY2VJcCxcclxuICAgICAgICAgICAgICB1c2VyQWdlbnQ6IGV2ZW50LmhlYWRlcnNbJ1VzZXItQWdlbnQnXSB8fCAnVW5rbm93bicsXHJcbiAgICAgICAgICAgICAgcGF0aDogZXZlbnQucGF0aCxcclxuICAgICAgICAgICAgICBtZXRob2Q6IGV2ZW50Lmh0dHBNZXRob2QsXHJcbiAgICAgICAgICAgIH0pO1xyXG5cclxuICAgICAgICAgICAgcmV0dXJuIHRoaXMuZm9yYmlkZGVuUmVzcG9uc2UoJ0luc3VmZmljaWVudCBwZXJtaXNzaW9ucycpO1xyXG4gICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgcmV0dXJuIGF3YWl0IGhhbmRsZXIoZXZlbnQsIGNvbnRleHQpO1xyXG4gICAgICB9KTtcclxuICAgIH07XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBSYXRlIGxpbWl0aW5nIG1pZGRsZXdhcmVcclxuICAgKi9cclxuICByYXRlTGltaXQobWF4UmVxdWVzdHM6IG51bWJlciA9IDEwMCwgd2luZG93TWludXRlczogbnVtYmVyID0gMTUpIHtcclxuICAgIHJldHVybiAoaGFuZGxlcjogQXV0aGVudGljYXRlZEhhbmRsZXIpID0+IHtcclxuICAgICAgcmV0dXJuIGFzeW5jIChldmVudDogQXV0aGVudGljYXRlZEV2ZW50LCBjb250ZXh0OiBDb250ZXh0KSA9PiB7XHJcbiAgICAgICAgY29uc3Qgc291cmNlSXAgPSBldmVudC5yZXF1ZXN0Q29udGV4dC5pZGVudGl0eS5zb3VyY2VJcDtcclxuICAgICAgICBjb25zdCB1c2VySWQgPSBldmVudC51c2VyPy51c2VySWQ7XHJcbiAgICAgICAgXHJcbiAgICAgICAgLy8gSW4gYSByZWFsIGltcGxlbWVudGF0aW9uLCB5b3UnZCB1c2UgUmVkaXMgb3IgRHluYW1vREIgdG8gdHJhY2sgcmVxdWVzdCBjb3VudHNcclxuICAgICAgICAvLyBGb3Igbm93LCB3ZSdsbCBsb2cgdGhlIHJhdGUgbGltaXRpbmcgYXR0ZW1wdFxyXG4gICAgICAgIGF3YWl0IHRoaXMuYXVkaXRMb2dnZXIubG9nU2VjdXJpdHlFdmVudCh7XHJcbiAgICAgICAgICBldmVudFR5cGU6ICdSQVRFX0xJTUlUX0NIRUNLJyxcclxuICAgICAgICAgIHVzZXJJZCxcclxuICAgICAgICAgIHNvdXJjZUlwLFxyXG4gICAgICAgICAgcGF0aDogZXZlbnQucGF0aCxcclxuICAgICAgICAgIG1ldGhvZDogZXZlbnQuaHR0cE1ldGhvZCxcclxuICAgICAgICAgIG1ldGFkYXRhOiB7XHJcbiAgICAgICAgICAgIG1heFJlcXVlc3RzLFxyXG4gICAgICAgICAgICB3aW5kb3dNaW51dGVzLFxyXG4gICAgICAgICAgfSxcclxuICAgICAgICB9KTtcclxuXHJcbiAgICAgICAgcmV0dXJuIGF3YWl0IGhhbmRsZXIoZXZlbnQsIGNvbnRleHQpO1xyXG4gICAgICB9O1xyXG4gICAgfTtcclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIFJldHVybiB1bmF1dGhvcml6ZWQgcmVzcG9uc2VcclxuICAgKi9cclxuICBwcml2YXRlIHVuYXV0aG9yaXplZFJlc3BvbnNlKG1lc3NhZ2U6IHN0cmluZyk6IEFQSUdhdGV3YXlQcm94eVJlc3VsdCB7XHJcbiAgICByZXR1cm4ge1xyXG4gICAgICBzdGF0dXNDb2RlOiA0MDEsXHJcbiAgICAgIGhlYWRlcnM6IHtcclxuICAgICAgICAnQ29udGVudC1UeXBlJzogJ2FwcGxpY2F0aW9uL2pzb24nLFxyXG4gICAgICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1PcmlnaW4nOiBwcm9jZXNzLmVudi5DT1JTX09SSUdJTiB8fCAnKicsXHJcbiAgICAgICAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LUNyZWRlbnRpYWxzJzogJ3RydWUnLFxyXG4gICAgICB9LFxyXG4gICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7XHJcbiAgICAgICAgZXJyb3I6ICdVbmF1dGhvcml6ZWQnLFxyXG4gICAgICAgIG1lc3NhZ2UsXHJcbiAgICAgIH0pLFxyXG4gICAgfTtcclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIFJldHVybiBmb3JiaWRkZW4gcmVzcG9uc2VcclxuICAgKi9cclxuICBwcml2YXRlIGZvcmJpZGRlblJlc3BvbnNlKG1lc3NhZ2U6IHN0cmluZyk6IEFQSUdhdGV3YXlQcm94eVJlc3VsdCB7XHJcbiAgICByZXR1cm4ge1xyXG4gICAgICBzdGF0dXNDb2RlOiA0MDMsXHJcbiAgICAgIGhlYWRlcnM6IHtcclxuICAgICAgICAnQ29udGVudC1UeXBlJzogJ2FwcGxpY2F0aW9uL2pzb24nLFxyXG4gICAgICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1PcmlnaW4nOiBwcm9jZXNzLmVudi5DT1JTX09SSUdJTiB8fCAnKicsXHJcbiAgICAgICAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LUNyZWRlbnRpYWxzJzogJ3RydWUnLFxyXG4gICAgICB9LFxyXG4gICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7XHJcbiAgICAgICAgZXJyb3I6ICdGb3JiaWRkZW4nLFxyXG4gICAgICAgIG1lc3NhZ2UsXHJcbiAgICAgIH0pLFxyXG4gICAgfTtcclxuICB9XHJcbn0iXX0=