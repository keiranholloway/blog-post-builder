"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = void 0;
const jwt_service_1 = require("./auth/jwt-service");
const audit_logger_1 = require("./utils/audit-logger");
const auth_middleware_1 = require("./auth/auth-middleware");
const jwtService = new jwt_service_1.JWTService();
const auditLogger = new audit_logger_1.AuditLogger();
const authMiddleware = new auth_middleware_1.AuthMiddleware();
/**
 * Handle token generation and refresh
 */
const tokenHandler = async (event, context) => {
    const corsHeaders = {
        'Access-Control-Allow-Origin': process.env.CORS_ORIGIN || '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Access-Control-Allow-Methods': 'POST,OPTIONS',
        'Access-Control-Allow-Credentials': 'true',
        'Content-Type': 'application/json',
    };
    try {
        const path = event.path;
        const method = event.httpMethod;
        // Handle preflight OPTIONS requests
        if (method === 'OPTIONS') {
            return {
                statusCode: 200,
                headers: corsHeaders,
                body: '',
            };
        }
        if (method === 'POST' && path === '/api/auth/token') {
            // Generate new tokens (login)
            const body = JSON.parse(event.body || '{}');
            if (!body.email) {
                return {
                    statusCode: 400,
                    headers: corsHeaders,
                    body: JSON.stringify({
                        error: 'Bad Request',
                        message: 'Email is required',
                    }),
                };
            }
            // In a real implementation, you would validate credentials here
            // For now, we'll generate tokens for any valid email
            const userId = `user-${Buffer.from(body.email).toString('base64').substring(0, 8)}`;
            const tokens = await jwtService.generateTokens(userId, body.email);
            await auditLogger.logSecurityEvent({
                eventType: 'AUTHENTICATION_SUCCESS',
                userId,
                sourceIp: event.requestContext.identity.sourceIp,
                userAgent: event.headers['User-Agent'],
                path: event.path,
                method: event.httpMethod,
                metadata: {
                    email: body.email,
                },
            });
            const response = {
                accessToken: tokens.accessToken,
                refreshToken: tokens.refreshToken,
                expiresIn: tokens.expiresIn,
                tokenType: 'Bearer',
            };
            return {
                statusCode: 200,
                headers: corsHeaders,
                body: JSON.stringify(response),
            };
        }
        if (method === 'POST' && path === '/api/auth/refresh') {
            // Refresh access token
            const body = JSON.parse(event.body || '{}');
            if (!body.refreshToken) {
                return {
                    statusCode: 400,
                    headers: corsHeaders,
                    body: JSON.stringify({
                        error: 'Bad Request',
                        message: 'Refresh token is required',
                    }),
                };
            }
            const refreshed = await jwtService.refreshAccessToken(body.refreshToken);
            await auditLogger.logSecurityEvent({
                eventType: 'AUTHENTICATION_SUCCESS',
                sourceIp: event.requestContext.identity.sourceIp,
                userAgent: event.headers['User-Agent'],
                path: event.path,
                method: event.httpMethod,
                reason: 'Token refreshed',
            });
            const response = {
                accessToken: refreshed.accessToken,
                expiresIn: refreshed.expiresIn,
                tokenType: 'Bearer',
            };
            return {
                statusCode: 200,
                headers: corsHeaders,
                body: JSON.stringify(response),
            };
        }
        if (method === 'POST' && path === '/api/auth/revoke') {
            // Revoke tokens (logout)
            if (!event.user) {
                return {
                    statusCode: 401,
                    headers: corsHeaders,
                    body: JSON.stringify({
                        error: 'Unauthorized',
                        message: 'Authentication required',
                    }),
                };
            }
            await jwtService.revokeToken(event.user.jti);
            await auditLogger.logSecurityEvent({
                eventType: 'TOKEN_REVOKED',
                userId: event.user.userId,
                sourceIp: event.requestContext.identity.sourceIp,
                userAgent: event.headers['User-Agent'],
                path: event.path,
                method: event.httpMethod,
                metadata: {
                    tokenId: event.user.jti,
                },
            });
            return {
                statusCode: 200,
                headers: corsHeaders,
                body: JSON.stringify({
                    message: 'Token revoked successfully',
                }),
            };
        }
        if (method === 'POST' && path === '/api/auth/revoke-all') {
            // Revoke all tokens for user
            if (!event.user) {
                return {
                    statusCode: 401,
                    headers: corsHeaders,
                    body: JSON.stringify({
                        error: 'Unauthorized',
                        message: 'Authentication required',
                    }),
                };
            }
            await jwtService.revokeAllUserTokens(event.user.userId);
            await auditLogger.logSecurityEvent({
                eventType: 'TOKEN_REVOKED',
                userId: event.user.userId,
                sourceIp: event.requestContext.identity.sourceIp,
                userAgent: event.headers['User-Agent'],
                path: event.path,
                method: event.httpMethod,
                reason: 'All tokens revoked',
            });
            return {
                statusCode: 200,
                headers: corsHeaders,
                body: JSON.stringify({
                    message: 'All tokens revoked successfully',
                }),
            };
        }
        // Route not found
        return {
            statusCode: 404,
            headers: corsHeaders,
            body: JSON.stringify({
                error: 'Not Found',
                message: 'Route not found',
            }),
        };
    }
    catch (error) {
        console.error('Token handler error:', error);
        await auditLogger.logSecurityEvent({
            eventType: 'AUTHENTICATION_FAILED',
            reason: error instanceof Error ? error.message : 'Unknown error',
            sourceIp: event.requestContext.identity.sourceIp,
            userAgent: event.headers['User-Agent'],
            path: event.path,
            method: event.httpMethod,
        });
        return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({
                error: 'Internal Server Error',
                message: 'Token operation failed',
            }),
        };
    }
};
/**
 * Main Lambda handler
 */
const handler = async (event, context) => {
    // Token endpoints use optional authentication (some require auth, some don't)
    return await authMiddleware.optionalAuthenticate(tokenHandler)(event, context);
};
exports.handler = handler;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidG9rZW4taGFuZGxlci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbInRva2VuLWhhbmRsZXIudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBQ0Esb0RBQWdEO0FBQ2hELHVEQUFtRDtBQUNuRCw0REFBNEU7QUFFNUUsTUFBTSxVQUFVLEdBQUcsSUFBSSx3QkFBVSxFQUFFLENBQUM7QUFDcEMsTUFBTSxXQUFXLEdBQUcsSUFBSSwwQkFBVyxFQUFFLENBQUM7QUFDdEMsTUFBTSxjQUFjLEdBQUcsSUFBSSxnQ0FBYyxFQUFFLENBQUM7QUFlNUM7O0dBRUc7QUFDSCxNQUFNLFlBQVksR0FBRyxLQUFLLEVBQ3hCLEtBQXlCLEVBQ3pCLE9BQWdCLEVBQ2dCLEVBQUU7SUFDbEMsTUFBTSxXQUFXLEdBQUc7UUFDbEIsNkJBQTZCLEVBQUUsT0FBTyxDQUFDLEdBQUcsQ0FBQyxXQUFXLElBQUksR0FBRztRQUM3RCw4QkFBOEIsRUFBRSw0QkFBNEI7UUFDNUQsOEJBQThCLEVBQUUsY0FBYztRQUM5QyxrQ0FBa0MsRUFBRSxNQUFNO1FBQzFDLGNBQWMsRUFBRSxrQkFBa0I7S0FDbkMsQ0FBQztJQUVGLElBQUk7UUFDRixNQUFNLElBQUksR0FBRyxLQUFLLENBQUMsSUFBSSxDQUFDO1FBQ3hCLE1BQU0sTUFBTSxHQUFHLEtBQUssQ0FBQyxVQUFVLENBQUM7UUFFaEMsb0NBQW9DO1FBQ3BDLElBQUksTUFBTSxLQUFLLFNBQVMsRUFBRTtZQUN4QixPQUFPO2dCQUNMLFVBQVUsRUFBRSxHQUFHO2dCQUNmLE9BQU8sRUFBRSxXQUFXO2dCQUNwQixJQUFJLEVBQUUsRUFBRTthQUNULENBQUM7U0FDSDtRQUVELElBQUksTUFBTSxLQUFLLE1BQU0sSUFBSSxJQUFJLEtBQUssaUJBQWlCLEVBQUU7WUFDbkQsOEJBQThCO1lBQzlCLE1BQU0sSUFBSSxHQUFpQixJQUFJLENBQUMsS0FBSyxDQUFDLEtBQUssQ0FBQyxJQUFJLElBQUksSUFBSSxDQUFDLENBQUM7WUFFMUQs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QUssRUFBRSxXQUFXO2dCQUNsQixPQUFPLEVBQUUsaUJBQWlCO2FBQzNCLENBQUM7U0FDSCxDQUFDO0tBRUg7SUFBQyxPQUFPLEtBQUssRUFBRTtRQUNkLE9BQU8sQ0FBQyxLQUFLLENBQUMsc0JBQXNCLEVBQUUsS0FBSyxDQUFDLENBQUM7UUFFN0MsTUFBTSxXQUFXLENBQUMsZ0JBQWdCLENBQUM7WUFDakMsU0FBUyxFQUFFLHVCQUF1QjtZQUNsQyxNQUFNLEVBQUUsS0FBSyxZQUFZLEtBQUssQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsZUFBZTtZQUNoRSxRQUFRLEVBQUUsS0FBSyxDQUFDLGNBQWMsQ0FBQyxRQUFRLENBQUMsUUFBUTtZQUNoRCxTQUFTLEVBQUUsS0FBSyxDQUFDLE9BQU8sQ0FBQyxZQUFZLENBQUM7WUFDdEMsSUFBSSxFQUFFLEtBQUssQ0FBQyxJQUFJO1lBQ2hCLE1BQU0sRUFBRSxLQUFLLENBQUMsVUFBVTtTQUN6QixDQUFDLENBQUM7UUFFSCxPQUFPO1lBQ0wsVUFBVSxFQUFFLEdBQUc7WUFDZixPQUFPLEVBQUUsV0FBVztZQUNwQixJQUFJLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQztnQkFDbkIsS0FBSyxFQUFFLHVCQUF1QjtnQkFDOUIsT0FBTyxFQUFFLHdCQUF3QjthQUNsQyxDQUFDO1NBQ0gsQ0FBQztLQUNIO0FBQ0gsQ0FBQyxDQUFDO0FBRUY7O0dBRUc7QUFDSSxNQUFNLE9BQU8sR0FBRyxLQUFLLEVBQzFCLEtBQTJCLEVBQzNCLE9BQWdCLEVBQ2dCLEVBQUU7SUFDbEMsOEVBQThFO0lBQzlFLE9BQU8sTUFBTSxjQUFjLENBQUMsb0JBQW9CLENBQUMsWUFBWSxDQUFDLENBQUMsS0FBSyxFQUFFLE9BQU8sQ0FBQyxDQUFDO0FBQ2pGLENBQUMsQ0FBQztBQU5XLFFBQUEsT0FBTyxXQU1sQiIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IEFQSUdhdGV3YXlQcm94eUV2ZW50LCBBUElHYXRld2F5UHJveHlSZXN1bHQsIENvbnRleHQgfSBmcm9tICdhd3MtbGFtYmRhJztcclxuaW1wb3J0IHsgSldUU2VydmljZSB9IGZyb20gJy4vYXV0aC9qd3Qtc2VydmljZSc7XHJcbmltcG9ydCB7IEF1ZGl0TG9nZ2VyIH0gZnJvbSAnLi91dGlscy9hdWRpdC1sb2dnZXInO1xyXG5pbXBvcnQgeyBBdXRoTWlkZGxld2FyZSwgQXV0aGVudGljYXRlZEV2ZW50IH0gZnJvbSAnLi9hdXRoL2F1dGgtbWlkZGxld2FyZSc7XHJcblxyXG5jb25zdCBqd3RTZXJ2aWNlID0gbmV3IEpXVFNlcnZpY2UoKTtcclxuY29uc3QgYXVkaXRMb2dnZXIgPSBuZXcgQXVkaXRMb2dnZXIoKTtcclxuY29uc3QgYXV0aE1pZGRsZXdhcmUgPSBuZXcgQXV0aE1pZGRsZXdhcmUoKTtcclxuXHJcbmludGVyZmFjZSBUb2tlblJlcXVlc3Qge1xyXG4gIGVtYWlsOiBzdHJpbmc7XHJcbiAgcGFzc3dvcmQ/OiBzdHJpbmc7XHJcbiAgcmVmcmVzaFRva2VuPzogc3RyaW5nO1xyXG59XHJcblxyXG5pbnRlcmZhY2UgVG9rZW5SZXNwb25zZSB7XHJcbiAgYWNjZXNzVG9rZW46IHN0cmluZztcclxuICByZWZyZXNoVG9rZW4/OiBzdHJpbmc7XHJcbiAgZXhwaXJlc0luOiBudW1iZXI7XHJcbiAgdG9rZW5UeXBlOiBzdHJpbmc7XHJcbn1cclxuXHJcbi8qKlxyXG4gKiBIYW5kbGUgdG9rZW4gZ2VuZXJhdGlvbiBhbmQgcmVmcmVzaFxyXG4gKi9cclxuY29uc3QgdG9rZW5IYW5kbGVyID0gYXN5bmMgKFxyXG4gIGV2ZW50OiBBdXRoZW50aWNhdGVkRXZlbnQsXHJcbiAgY29udGV4dDogQ29udGV4dFxyXG4pOiBQcm9taXNlPEFQSUdhdGV3YXlQcm94eVJlc3VsdD4gPT4ge1xyXG4gIGNvbnN0IGNvcnNIZWFkZXJzID0ge1xyXG4gICAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LU9yaWdpbic6IHByb2Nlc3MuZW52LkNPUlNfT1JJR0lOIHx8ICcqJyxcclxuICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1IZWFkZXJzJzogJ0NvbnRlbnQtVHlwZSxBdXRob3JpemF0aW9uJyxcclxuICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1NZXRob2RzJzogJ1BPU1QsT1BUSU9OUycsXHJcbiAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctQ3JlZGVudGlhbHMnOiAndHJ1ZScsXHJcbiAgICAnQ29udGVudC1UeXBlJzogJ2FwcGxpY2F0aW9uL2pzb24nLFxyXG4gIH07XHJcblxyXG4gIHRyeSB7XHJcbiAgICBjb25zdCBwYXRoID0gZXZlbnQucGF0aDtcclxuICAgIGNvbnN0IG1ldGhvZCA9IGV2ZW50Lmh0dHBNZXRob2Q7XHJcblxyXG4gICAgLy8gSGFuZGxlIHByZWZsaWdodCBPUFRJT05TIHJlcXVlc3RzXHJcbiAgICBpZiAobWV0aG9kID09PSAnT1BUSU9OUycpIHtcclxuICAgICAgcmV0dXJuIHtcclxuICAgICAgICBzdGF0dXNDb2RlOiAyMDAsXHJcbiAgICAgICAgaGVhZGVyczogY29yc0hlYWRlcnMsXHJcbiAgICAgICAgYm9keTogJycsXHJcbiAgICAgIH07XHJcbiAgICB9XHJcblxyXG4gICAgaWYgKG1ldGhvZCA9PT0gJ1BPU1QnICYmIHBhdGggPT09ICcvYXBpL2F1dGgvdG9rZW4nKSB7XHJcbiAgICAgIC8vIEdlbmVyYXRlIG5ldyB0b2tlbnMgKGxvZ2luKVxyXG4gICAgICBjb25zdCBib2R5OiBUb2tlblJlcXVlc3QgPSBKU09OLnBhcnNlKGV2ZW50LmJvZHkgfHwgJ3t9Jyk7XHJcbiAgICAgIFxyXG4gICAgICBpZiAoIWJvZHkuZW1haWwpIHtcclxuICAgICAgICByZXR1cm4ge1xyXG4gICAgICAgICAgc3RhdHVzQ29kZTogNDAwLFxyXG4gICAgICAgICAgaGVhZGVyczogY29yc0hlYWRlcnMsXHJcbiAgICAgICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7XHJcbiAgICAgICAgICAgIGVycm9yOiAnQmFkIFJlcXVlc3QnLFxyXG4gICAgICAgICAgICBtZXNzYWdlOiAnRW1haWwgaXMgcmVxdWlyZWQnLFxyXG4gICAgICAgICAgfSksXHJcbiAgICAgICAgfTtcclxuICAgICAgfVxyXG5cclxuICAgICAgLy8gSW4gYSByZWFsIGltcGxlbWVudGF0aW9uLCB5b3Ugd291bGQgdmFsaWRhdGUgY3JlZGVudGlhbHMgaGVyZVxyXG4gICAgICAvLyBGb3Igbm93LCB3ZSdsbCBnZW5lcmF0ZSB0b2tlbnMgZm9yIGFueSB2YWxpZCBlbWFpbFxyXG4gICAgICBjb25zdCB1c2VySWQgPSBgdXNlci0ke0J1ZmZlci5mcm9tKGJvZHkuZW1haWwpLnRvU3RyaW5nKCdiYXNlNjQnKS5zdWJzdHJpbmcoMCwgOCl9YDtcclxuICAgICAgXHJcbiAgICAgIGNvbnN0IHRva2VucyA9IGF3YWl0IGp3dFNlcnZpY2UuZ2VuZXJhdGVUb2tlbnModXNlcklkLCBib2R5LmVtYWlsKTtcclxuXHJcbiAgICAgIGF3YWl0IGF1ZGl0TG9nZ2VyLmxvZ1NlY3VyaXR5RXZlbnQoe1xyXG4gICAgICAgIGV2ZW50VHlwZTogJ0FVVEhFTlRJQ0FUSU9OX1NVQ0NFU1MnLFxyXG4gICAgICAgIHVzZXJJZCxcclxuICAgICAgICBzb3VyY2VJcDogZXZlbnQucmVxdWVzdENvbnRleHQuaWRlbnRpdHkuc291cmNlSXAsXHJcbiAgICAgICAgdXNlckFnZW50OiBldmVudC5oZWFkZXJzWydVc2VyLUFnZW50J10sXHJcbiAgICAgICAgcGF0aDogZXZlbnQucGF0aCxcclxuICAgICAgICBtZXRob2Q6IGV2ZW50Lmh0dHBNZXRob2QsXHJcbiAgICAgICAgbWV0YWRhdGE6IHtcclxuICAgICAgICAgIGVtYWlsOiBib2R5LmVtYWlsLFxyXG4gICAgICAgIH0sXHJcbiAgICAgIH0pO1xyXG5cclxuICAgICAgY29uc3QgcmVzcG9uc2U6IFRva2VuUmVzcG9uc2UgPSB7XHJcbiAgICAgICAgYWNjZXNzVG9rZW46IHRva2Vucy5hY2Nlc3NUb2tlbixcclxuICAgICAgICByZWZyZXNoVG9rZW46IHRva2Vucy5yZWZyZXNoVG9rZW4sXHJcbiAgICAgICAgZXhwaXJlc0luOiB0b2tlbnMuZXhwaXJlc0luLFxyXG4gICAgICAgIHRva2VuVHlwZTogJ0JlYXJlcicsXHJcbiAgICAgIH07XHJcblxyXG4gICAgICByZXR1cm4ge1xyXG4gICAgICAgIHN0YXR1c0NvZGU6IDIwMCxcclxuICAgICAgICBoZWFkZXJzOiBjb3JzSGVhZGVycyxcclxuICAgICAgICBib2R5OiBKU09OLnN0cmluZ2lmeShyZXNwb25zZSksXHJcbiAgICAgIH07XHJcbiAgICB9XHJcblxyXG4gICAgaWYgKG1ldGhvZCA9PT0gJ1BPU1QnICYmIHBhdGggPT09ICcvYXBpL2F1dGgvcmVmcmVzaCcpIHtcclxuICAgICAgLy8gUmVmcmVzaCBhY2Nlc3MgdG9rZW5cclxuICAgICAgY29uc3QgYm9keTogVG9rZW5SZXF1ZXN0ID0gSlNPTi5wYXJzZShldmVudC5ib2R5IHx8ICd7fScpO1xyXG4gICAgICBcclxuICAgICAgaWYgKCFib2R5LnJlZnJlc2hUb2tlbikge1xyXG4gICAgICAgIHJldHVybiB7XHJcbiAgICAgICAgICBzdGF0dXNDb2RlOiA0MDAsXHJcbiAgICAgICAgICBoZWFkZXJzOiBjb3JzSGVhZGVycyxcclxuICAgICAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHtcclxuICAgICAgICAgICAgZXJyb3I6ICdCYWQgUmVxdWVzdCcsXHJcbiAgICAgICAgICAgIG1lc3NhZ2U6ICdSZWZyZXNoIHRva2VuIGlzIHJlcXVpcmVkJyxcclxuICAgICAgICAgIH0pLFxyXG4gICAgICAgIH07XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIGNvbnN0IHJlZnJlc2hlZCA9IGF3YWl0IGp3dFNlcnZpY2UucmVmcmVzaEFjY2Vzc1Rva2VuKGJvZHkucmVmcmVzaFRva2VuKTtcclxuXHJcbiAgICAgIGF3YWl0IGF1ZGl0TG9nZ2VyLmxvZ1NlY3VyaXR5RXZlbnQoe1xyXG4gICAgICAgIGV2ZW50VHlwZTogJ0FVVEhFTlRJQ0FUSU9OX1NVQ0NFU1MnLFxyXG4gICAgICAgIHNvdXJjZUlwOiBldmVudC5yZXF1ZXN0Q29udGV4dC5pZGVudGl0eS5zb3VyY2VJcCxcclxuICAgICAgICB1c2VyQWdlbnQ6IGV2ZW50LmhlYWRlcnNbJ1VzZXItQWdlbnQnXSxcclxuICAgICAgICBwYXRoOiBldmVudC5wYXRoLFxyXG4gICAgICAgIG1ldGhvZDogZXZlbnQuaHR0cE1ldGhvZCxcclxuICAgICAgICByZWFzb246ICdUb2tlbiByZWZyZXNoZWQnLFxyXG4gICAgICB9KTtcclxuXHJcbiAgICAgIGNvbnN0IHJlc3BvbnNlOiBPbWl0PFRva2VuUmVzcG9uc2UsICdyZWZyZXNoVG9rZW4nPiA9IHtcclxuICAgICAgICBhY2Nlc3NUb2tlbjogcmVmcmVzaGVkLmFjY2Vzc1Rva2VuLFxyXG4gICAgICAgIGV4cGlyZXNJbjogcmVmcmVzaGVkLmV4cGlyZXNJbixcclxuICAgICAgICB0b2tlblR5cGU6ICdCZWFyZXInLFxyXG4gICAgICB9O1xyXG5cclxuICAgICAgcmV0dXJuIHtcclxuICAgICAgICBzdGF0dXNDb2RlOiAyMDAsXHJcbiAgICAgICAgaGVhZGVyczogY29yc0hlYWRlcnMsXHJcbiAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkocmVzcG9uc2UpLFxyXG4gICAgICB9O1xyXG4gICAgfVxyXG5cclxuICAgIGlmIChtZXRob2QgPT09ICdQT1NUJyAmJiBwYXRoID09PSAnL2FwaS9hdXRoL3Jldm9rZScpIHtcclxuICAgICAgLy8gUmV2b2tlIHRva2VucyAobG9nb3V0KVxyXG4gICAgICBpZiAoIWV2ZW50LnVzZXIpIHtcclxuICAgICAgICByZXR1cm4ge1xyXG4gICAgICAgICAgc3RhdHVzQ29kZTogNDAxLFxyXG4gICAgICAgICAgaGVhZGVyczogY29yc0hlYWRlcnMsXHJcbiAgICAgICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7XHJcbiAgICAgICAgICAgIGVycm9yOiAnVW5hdXRob3JpemVkJyxcclxuICAgICAgICAgICAgbWVzc2FnZTogJ0F1dGhlbnRpY2F0aW9uIHJlcXVpcmVkJyxcclxuICAgICAgICAgIH0pLFxyXG4gICAgICAgIH07XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIGF3YWl0IGp3dFNlcnZpY2UucmV2b2tlVG9rZW4oZXZlbnQudXNlci5qdGkpO1xyXG5cclxuICAgICAgYXdhaXQgYXVkaXRMb2dnZXIubG9nU2VjdXJpdHlFdmVudCh7XHJcbiAgICAgICAgZXZlbnRUeXBlOiAnVE9LRU5fUkVWT0tFRCcsXHJcbiAgICAgICAgdXNlcklkOiBldmVudC51c2VyLnVzZXJJZCxcclxuICAgICAgICBzb3VyY2VJcDogZXZlbnQucmVxdWVzdENvbnRleHQuaWRlbnRpdHkuc291cmNlSXAsXHJcbiAgICAgICAgdXNlckFnZW50OiBldmVudC5oZWFkZXJzWydVc2VyLUFnZW50J10sXHJcbiAgICAgICAgcGF0aDogZXZlbnQucGF0aCxcclxuICAgICAgICBtZXRob2Q6IGV2ZW50Lmh0dHBNZXRob2QsXHJcbiAgICAgICAgbWV0YWRhdGE6IHtcclxuICAgICAgICAgIHRva2VuSWQ6IGV2ZW50LnVzZXIuanRpLFxyXG4gICAgICAgIH0sXHJcbiAgICAgIH0pO1xyXG5cclxuICAgICAgcmV0dXJuIHtcclxuICAgICAgICBzdGF0dXNDb2RlOiAyMDAsXHJcbiAgICAgICAgaGVhZGVyczogY29yc0hlYWRlcnMsXHJcbiAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoe1xyXG4gICAgICAgICAgbWVzc2FnZTogJ1Rva2VuIHJldm9rZWQgc3VjY2Vzc2Z1bGx5JyxcclxuICAgICAgICB9KSxcclxuICAgICAgfTtcclxuICAgIH1cclxuXHJcbiAgICBpZiAobWV0aG9kID09PSAnUE9TVCcgJiYgcGF0aCA9PT0gJy9hcGkvYXV0aC9yZXZva2UtYWxsJykge1xyXG4gICAgICAvLyBSZXZva2UgYWxsIHRva2VucyBmb3IgdXNlclxyXG4gICAgICBpZiAoIWV2ZW50LnVzZXIpIHtcclxuICAgICAgICByZXR1cm4ge1xyXG4gICAgICAgICAgc3RhdHVzQ29kZTogNDAxLFxyXG4gICAgICAgICAgaGVhZGVyczogY29yc0hlYWRlcnMsXHJcbiAgICAgICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7XHJcbiAgICAgICAgICAgIGVycm9yOiAnVW5hdXRob3JpemVkJyxcclxuICAgICAgICAgICAgbWVzc2FnZTogJ0F1dGhlbnRpY2F0aW9uIHJlcXVpcmVkJyxcclxuICAgICAgICAgIH0pLFxyXG4gICAgICAgIH07XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIGF3YWl0IGp3dFNlcnZpY2UucmV2b2tlQWxsVXNlclRva2VucyhldmVudC51c2VyLnVzZXJJZCk7XHJcblxyXG4gICAgICBhd2FpdCBhdWRpdExvZ2dlci5sb2dTZWN1cml0eUV2ZW50KHtcclxuICAgICAgICBldmVudFR5cGU6ICdUT0tFTl9SRVZPS0VEJyxcclxuICAgICAgICB1c2VySWQ6IGV2ZW50LnVzZXIudXNlcklkLFxyXG4gICAgICAgIHNvdXJjZUlwOiBldmVudC5yZXF1ZXN0Q29udGV4dC5pZGVudGl0eS5zb3VyY2VJcCxcclxuICAgICAgICB1c2VyQWdlbnQ6IGV2ZW50LmhlYWRlcnNbJ1VzZXItQWdlbnQnXSxcclxuICAgICAgICBwYXRoOiBldmVudC5wYXRoLFxyXG4gICAgICAgIG1ldGhvZDogZXZlbnQuaHR0cE1ldGhvZCxcclxuICAgICAgICByZWFzb246ICdBbGwgdG9rZW5zIHJldm9rZWQnLFxyXG4gICAgICB9KTtcclxuXHJcbiAgICAgIHJldHVybiB7XHJcbiAgICAgICAgc3RhdHVzQ29kZTogMjAwLFxyXG4gICAgICAgIGhlYWRlcnM6IGNvcnNIZWFkZXJzLFxyXG4gICAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHtcclxuICAgICAgICAgIG1lc3NhZ2U6ICdBbGwgdG9rZW5zIHJldm9rZWQgc3VjY2Vzc2Z1bGx5JyxcclxuICAgICAgICB9KSxcclxuICAgICAgfTtcclxuICAgIH1cclxuXHJcbiAgICAvLyBSb3V0ZSBub3QgZm91bmRcclxuICAgIHJldHVybiB7XHJcbiAgICAgIHN0YXR1c0NvZGU6IDQwNCxcclxuICAgICAgaGVhZGVyczogY29yc0hlYWRlcnMsXHJcbiAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHtcclxuICAgICAgICBlcnJvcjogJ05vdCBGb3VuZCcsXHJcbiAgICAgICAgbWVzc2FnZTogJ1JvdXRlIG5vdCBmb3VuZCcsXHJcbiAgICAgIH0pLFxyXG4gICAgfTtcclxuXHJcbiAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgIGNvbnNvbGUuZXJyb3IoJ1Rva2VuIGhhbmRsZXIgZXJyb3I6JywgZXJyb3IpO1xyXG5cclxuICAgIGF3YWl0IGF1ZGl0TG9nZ2VyLmxvZ1NlY3VyaXR5RXZlbnQoe1xyXG4gICAgICBldmVudFR5cGU6ICdBVVRIRU5USUNBVElPTl9GQUlMRUQnLFxyXG4gICAgICByZWFzb246IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogJ1Vua25vd24gZXJyb3InLFxyXG4gICAgICBzb3VyY2VJcDogZXZlbnQucmVxdWVzdENvbnRleHQuaWRlbnRpdHkuc291cmNlSXAsXHJcbiAgICAgIHVzZXJBZ2VudDogZXZlbnQuaGVhZGVyc1snVXNlci1BZ2VudCddLFxyXG4gICAgICBwYXRoOiBldmVudC5wYXRoLFxyXG4gICAgICBtZXRob2Q6IGV2ZW50Lmh0dHBNZXRob2QsXHJcbiAgICB9KTtcclxuXHJcbiAgICByZXR1cm4ge1xyXG4gICAgICBzdGF0dXNDb2RlOiA1MDAsXHJcbiAgICAgIGhlYWRlcnM6IGNvcnNIZWFkZXJzLFxyXG4gICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7XHJcbiAgICAgICAgZXJyb3I6ICdJbnRlcm5hbCBTZXJ2ZXIgRXJyb3InLFxyXG4gICAgICAgIG1lc3NhZ2U6ICdUb2tlbiBvcGVyYXRpb24gZmFpbGVkJyxcclxuICAgICAgfSksXHJcbiAgICB9O1xyXG4gIH1cclxufTtcclxuXHJcbi8qKlxyXG4gKiBNYWluIExhbWJkYSBoYW5kbGVyXHJcbiAqL1xyXG5leHBvcnQgY29uc3QgaGFuZGxlciA9IGFzeW5jIChcclxuICBldmVudDogQVBJR2F0ZXdheVByb3h5RXZlbnQsXHJcbiAgY29udGV4dDogQ29udGV4dFxyXG4pOiBQcm9taXNlPEFQSUdhdGV3YXlQcm94eVJlc3VsdD4gPT4ge1xyXG4gIC8vIFRva2VuIGVuZHBvaW50cyB1c2Ugb3B0aW9uYWwgYXV0aGVudGljYXRpb24gKHNvbWUgcmVxdWlyZSBhdXRoLCBzb21lIGRvbid0KVxyXG4gIHJldHVybiBhd2FpdCBhdXRoTWlkZGxld2FyZS5vcHRpb25hbEF1dGhlbnRpY2F0ZSh0b2tlbkhhbmRsZXIpKGV2ZW50LCBjb250ZXh0KTtcclxufTsiXX0=