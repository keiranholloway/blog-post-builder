import { ScheduledEvent, Context } from 'aws-lambda';
/**
 * Lambda handler for scheduled data retention cleanup
 */
export declare const handler: (event: ScheduledEvent, context: Context) => Promise<void>;
