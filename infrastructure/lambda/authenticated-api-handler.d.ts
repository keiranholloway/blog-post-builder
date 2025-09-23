import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
/**
 * Main Lambda handler with conditional authentication
 */
export declare const handler: (event: APIGatewayProxyEvent, context: Context) => Promise<APIGatewayProxyResult>;
