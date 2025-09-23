import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { JWTPayload } from './jwt-service';
export interface AuthenticatedEvent extends APIGatewayProxyEvent {
    user?: JWTPayload;
}
export type AuthenticatedHandler = (event: AuthenticatedEvent, context: Context) => Promise<APIGatewayProxyResult>;
export declare class AuthMiddleware {
    private readonly jwtService;
    private readonly auditLogger;
    constructor();
    /**
     * Create an authenticated handler wrapper
     */
    authenticate(handler: AuthenticatedHandler): (event: APIGatewayProxyEvent, context: Context) => Promise<APIGatewayProxyResult>;
    /**
     * Create an optional authentication handler (allows both authenticated and anonymous access)
     */
    optionalAuthenticate(handler: AuthenticatedHandler): (event: APIGatewayProxyEvent, context: Context) => Promise<APIGatewayProxyResult>;
    /**
     * Create authorization middleware for role-based access
     */
    authorize(requiredRoles?: string[]): (handler: AuthenticatedHandler) => (event: APIGatewayProxyEvent, context: Context) => Promise<APIGatewayProxyResult>;
    /**
     * Rate limiting middleware
     */
    rateLimit(maxRequests?: number, windowMinutes?: number): (handler: AuthenticatedHandler) => (event: AuthenticatedEvent, context: Context) => Promise<APIGatewayProxyResult>;
    /**
     * Return unauthorized response
     */
    private unauthorizedResponse;
    /**
     * Return forbidden response
     */
    private forbiddenResponse;
}
