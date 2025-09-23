import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { JWTService } from './auth/jwt-service';
import { AuditLogger } from './utils/audit-logger';
import { AuthMiddleware, AuthenticatedEvent } from './auth/auth-middleware';

const jwtService = new JWTService();
const auditLogger = new AuditLogger();
const authMiddleware = new AuthMiddleware();

interface TokenRequest {
  email: string;
  password?: string;
  refreshToken?: string;
}

interface TokenResponse {
  accessToken: string;
  refreshToken?: string;
  expiresIn: number;
  tokenType: string;
}

/**
 * Handle token generation and refresh
 */
const tokenHandler = async (
  event: AuthenticatedEvent,
  context: Context
): Promise<APIGatewayProxyResult> => {
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
      const body: TokenRequest = JSON.parse(event.body || '{}');
      
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

      const response: TokenResponse = {
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
      const body: TokenRequest = JSON.parse(event.body || '{}');
      
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

      const response: Omit<TokenResponse, 'refreshToken'> = {
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

  } catch (error) {
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
export const handler = async (
  event: APIGatewayProxyEvent,
  context: Context
): Promise<APIGatewayProxyResult> => {
  // Token endpoints use optional authentication (some require auth, some don't)
  return await authMiddleware.optionalAuthenticate(tokenHandler)(event, context);
};