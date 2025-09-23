import { ScheduledEvent, Context } from 'aws-lambda';
import { DataRetentionService } from './utils/data-retention';
import { AuditLogger } from './utils/audit-logger';

const dataRetentionService = new DataRetentionService();
const auditLogger = new AuditLogger();

/**
 * Lambda handler for scheduled data retention cleanup
 */
export const handler = async (event: ScheduledEvent, context: Context): Promise<void> => {
  console.log('Starting scheduled data retention cleanup', JSON.stringify(event));

  try {
    // Log the start of cleanup process
    await auditLogger.logSecurityEvent({
      eventType: 'DATA_MODIFICATION',
      reason: 'Scheduled data retention cleanup started',
      metadata: {
        source: 'scheduled-event',
        requestId: context.awsRequestId,
      },
    });

    // Apply all retention policies
    await dataRetentionService.applyRetentionPolicies();

    // Clean up expired audit logs
    await auditLogger.cleanupOldLogs();

    // Log successful completion
    await auditLogger.logSecurityEvent({
      eventType: 'DATA_MODIFICATION',
      reason: 'Scheduled data retention cleanup completed successfully',
      metadata: {
        source: 'scheduled-event',
        requestId: context.awsRequestId,
      },
    });

    console.log('Data retention cleanup completed successfully');

  } catch (error) {
    console.error('Data retention cleanup failed:', error);

    // Log the failure
    await auditLogger.logSecurityEvent({
      eventType: 'DATA_MODIFICATION',
      reason: 'Scheduled data retention cleanup failed',
      metadata: {
        source: 'scheduled-event',
        requestId: context.awsRequestId,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
    });

    throw error;
  }
};