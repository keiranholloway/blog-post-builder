import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { AuthMiddleware, AuthenticatedEvent } from './auth/auth-middleware';
import { AuditLogger } from './utils/audit-logger';
import { handler as originalHandler } from './api-handler';

// Initialize authentication middleware
const authMiddleware = new AuthMiddleware();
const auditLogger = new AuditLogger();

/**
 * Main authenticated API handler that wraps the original handler with authentication
 */
const authenticatedApiHandler = async (
  event: AuthenticatedEvent,
  context: Context
): Promise<APIGatewayProxyResult> => {
  // Log data access for authenticated requests
  if (event.user) {
    await auditLogger.logDataAccess({
      eventType: 'DATA_ACCESS',
      userId: event.user.userId,
      resourceType: 'content', // This would be more specific in a real implementation
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
  return await originalHandler(event, context);
};

/**
 * Public endpoints that don't require authentication
 */
const publicEndpoints = [
  { method: 'GET', path: '/' },
  { method: 'GET', path: '/api/status' },
  { method: 'OPTIONS', path: '*' }, // CORS preflight
  { method: 'POST', path: '/api/auth/exchange' },
  { method: 'POST', path: '/api/auth/refresh' },
];

/**
 * Check if an endpoint is public
 */
function isPublicEndpoint(method: string, path: string): boolean {
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
export const handler = async (
  event: APIGatewayProxyEvent,
  context: Context
): Promise<APIGatewayProxyResult> => {
  const method = event.httpMethod;
  const path = event.path;

  // Check if this is a public endpoint
  if (isPublicEndpoint(method, path)) {
    // Use optional authentication for public endpoints
    return await authMiddleware.optionalAuthenticate(authenticatedApiHandler)(event, context);
  } else {
    // Require authentication for protected endpoints
    return await authMiddleware.authenticate(authenticatedApiHandler)(event, context);
  }
};