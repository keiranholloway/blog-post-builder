import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { JWTService, JWTPayload } from './jwt-service';
import { AuditLogger } from '../utils/audit-logger';

export interface AuthenticatedEvent extends APIGatewayProxyEvent {
  user?: JWTPayload;
}

export type AuthenticatedHandler = (
  event: AuthenticatedEvent,
  context: Context
) => Promise<APIGatewayProxyResult>;

export class AuthMiddleware {
  private readonly jwtService: JWTService;
  private readonly auditLogger: AuditLogger;

  constructor() {
    this.jwtService = new JWTService();
    this.auditLogger = new AuditLogger();
  }

  /**
   * Create an authenticated handler wrapper
   */
  authenticate(handler: AuthenticatedHandler): (event: APIGatewayProxyEvent, context: Context) => Promise<APIGatewayProxyResult> {
    return async (event: APIGatewayProxyEvent, context: Context): Promise<APIGatewayProxyResult> => {
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
        const authenticatedEvent: AuthenticatedEvent = {
          ...event,
          user,
        };

        // Call the original handler
        return await handler(authenticatedEvent, context);

      } catch (error) {
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
  optionalAuthenticate(handler: AuthenticatedHandler): (event: APIGatewayProxyEvent, context: Context) => Promise<APIGatewayProxyResult> {
    return async (event: APIGatewayProxyEvent, context: Context): Promise<APIGatewayProxyResult> => {
      try {
        const authHeader = event.headers.Authorization || event.headers.authorization;
        
        if (authHeader) {
          const tokenMatch = authHeader.match(/^Bearer\s+(.+)$/);
          if (tokenMatch) {
            try {
              const token = tokenMatch[1];
              const user = await this.jwtService.verifyAccessToken(token);
              
              const authenticatedEvent: AuthenticatedEvent = {
                ...event,
                user,
              };

              return await handler(authenticatedEvent, context);
            } catch (error) {
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
        return await handler(event as AuthenticatedEvent, context);

      } catch (error) {
        console.error('Error in optional authentication:', error);
        return await handler(event as AuthenticatedEvent, context);
      }
    };
  }

  /**
   * Create authorization middleware for role-based access
   */
  authorize(requiredRoles: string[] = []) {
    return (handler: AuthenticatedHandler) => {
      return this.authenticate(async (event: AuthenticatedEvent, context: Context) => {
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
  rateLimit(maxRequests: number = 100, windowMinutes: number = 15) {
    return (handler: AuthenticatedHandler) => {
      return async (event: AuthenticatedEvent, context: Context) => {
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
  private unauthorizedResponse(message: string): APIGatewayProxyResult {
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
  private forbiddenResponse(message: string): APIGatewayProxyResult {
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