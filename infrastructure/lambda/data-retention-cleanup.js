"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = void 0;
const data_retention_1 = require("./utils/data-retention");
const audit_logger_1 = require("./utils/audit-logger");
const dataRetentionService = new data_retention_1.DataRetentionService();
const auditLogger = new audit_logger_1.AuditLogger();
/**
 * Lambda handler for scheduled data retention cleanup
 */
const handler = async (event, context) => {
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
    }
    catch (error) {
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
exports.handler = handler;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZGF0YS1yZXRlbnRpb24tY2xlYW51cC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbImRhdGEtcmV0ZW50aW9uLWNsZWFudXAudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBQ0EsMkRBQThEO0FBQzlELHVEQUFtRDtBQUVuRCxNQUFNLG9CQUFvQixHQUFHLElBQUkscUNBQW9CLEVBQUUsQ0FBQztBQUN4RCxNQUFNLFdBQVcsR0FBRyxJQUFJLDBCQUFXLEVBQUUsQ0FBQztBQUV0Qzs7R0FFRztBQUNJLE1BQU0sT0FBTyxHQUFHLEtBQUssRUFBRSxLQUFxQixFQUFFLE9BQWdCLEVBQWlCLEVBQUU7SUFDdEYsT0FBTyxDQUFDLEdBQUcsQ0FBQywyQ0FBMkMsRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUM7SUFFaEYsSUFBSTtRQUNGLG1DQUFtQztRQUNuQyxNQUFNLFdBQVcsQ0FBQyxnQkFBZ0IsQ0FBQztZQUNqQyxTQUFTLEVBQUUsbUJBQW1CO1lBQzlCLE1BQU0sRUFBRSwwQ0FBMEM7WUFDbEQsUUFBUSxFQUFFO2dCQUNSLE1BQU0sRUFBRSxpQkFBaUI7Z0JBQ3pCLFNBQVMsRUFBRSxPQUFPLENBQUMsWUFBWTthQUNoQztTQUNGLENBQUMsQ0FBQztRQUVILCtCQUErQjtRQUMvQixNQUFNLG9CQUFvQixDQUFDLHNCQUFzQixFQUFFLENBQUM7UUFFcEQsOEJBQThCO1FBQzlCLE1BQU0sV0FBVyxDQUFDLGNBQWMsRUFBRSxDQUFDO1FBRW5DLDRCQUE0QjtRQUM1QixNQUFNLFdBQVcsQ0FBQyxnQkFBZ0IsQ0FBQztZQUNqQyxTQUFTLEVBQUUsbUJBQW1CO1lBQzlCLE1BQU0sRUFBRSx5REFBeUQ7WUFDakUsUUFBUSxFQUFFO2dCQUNSLE1BQU0sRUFBRSxpQkFBaUI7Z0JBQ3pCLFNBQVMsRUFBRSxPQUFPLENBQUMsWUFBWTthQUNoQztTQUNGLENBQUMsQ0FBQztRQUVILE9BQU8sQ0FBQyxHQUFHLENBQUMsK0NBQStDLENBQUMsQ0FBQztLQUU5RDtJQUFDLE9BQU8sS0FBSyxFQUFFO1FBQ2QsT0FBTyxDQUFDLEtBQUssQ0FBQyxnQ0FBZ0MsRUFBRSxLQUFLLENBQUMsQ0FBQztRQUV2RCxrQkFBa0I7UUFDbEIsTUFBTSxXQUFXLENBQUMsZ0JBQWdCLENBQUM7WUFDakMsU0FBUyxFQUFFLG1CQUFtQjtZQUM5QixNQUFNLEVBQUUseUNBQXlDO1lBQ2pELFFBQVEsRUFBRTtnQkFDUixNQUFNLEVBQUUsaUJBQWlCO2dCQUN6QixTQUFTLEVBQUUsT0FBTyxDQUFDLFlBQVk7Z0JBQy9CLEtBQUssRUFBRSxLQUFLLFlBQVksS0FBSyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxlQUFlO2FBQ2hFO1NBQ0YsQ0FBQyxDQUFDO1FBRUgsTUFBTSxLQUFLLENBQUM7S0FDYjtBQUNILENBQUMsQ0FBQztBQWhEVyxRQUFBLE9BQU8sV0FnRGxCIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgU2NoZWR1bGVkRXZlbnQsIENvbnRleHQgfSBmcm9tICdhd3MtbGFtYmRhJztcclxuaW1wb3J0IHsgRGF0YVJldGVudGlvblNlcnZpY2UgfSBmcm9tICcuL3V0aWxzL2RhdGEtcmV0ZW50aW9uJztcclxuaW1wb3J0IHsgQXVkaXRMb2dnZXIgfSBmcm9tICcuL3V0aWxzL2F1ZGl0LWxvZ2dlcic7XHJcblxyXG5jb25zdCBkYXRhUmV0ZW50aW9uU2VydmljZSA9IG5ldyBEYXRhUmV0ZW50aW9uU2VydmljZSgpO1xyXG5jb25zdCBhdWRpdExvZ2dlciA9IG5ldyBBdWRpdExvZ2dlcigpO1xyXG5cclxuLyoqXHJcbiAqIExhbWJkYSBoYW5kbGVyIGZvciBzY2hlZHVsZWQgZGF0YSByZXRlbnRpb24gY2xlYW51cFxyXG4gKi9cclxuZXhwb3J0IGNvbnN0IGhhbmRsZXIgPSBhc3luYyAoZXZlbnQ6IFNjaGVkdWxlZEV2ZW50LCBjb250ZXh0OiBDb250ZXh0KTogUHJvbWlzZTx2b2lkPiA9PiB7XHJcbiAgY29uc29sZS5sb2coJ1N0YXJ0aW5nIHNjaGVkdWxlZCBkYXRhIHJldGVudGlvbiBjbGVhbnVwJywgSlNPTi5zdHJpbmdpZnkoZXZlbnQpKTtcclxuXHJcbiAgdHJ5IHtcclxuICAgIC8vIExvZyB0aGUgc3RhcnQgb2YgY2xlYW51cCBwcm9jZXNzXHJcbiAgICBhd2FpdCBhdWRpdExvZ2dlci5sb2dTZWN1cml0eUV2ZW50KHtcclxuICAgICAgZXZlbnRUeXBlOiAnREFUQV9NT0RJRklDQVRJT04nLFxyXG4gICAgICByZWFzb246ICdTY2hlZHVsZWQgZGF0YSByZXRlbnRpb24gY2xlYW51cCBzdGFydGVkJyxcclxuICAgICAgbWV0YWRhdGE6IHtcclxuICAgICAgICBzb3VyY2U6ICdzY2hlZHVsZWQtZXZlbnQnLFxyXG4gICAgICAgIHJlcXVlc3RJZDogY29udGV4dC5hd3NSZXF1ZXN0SWQsXHJcbiAgICAgIH0sXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBBcHBseSBhbGwgcmV0ZW50aW9uIHBvbGljaWVzXHJcbiAgICBhd2FpdCBkYXRhUmV0ZW50aW9uU2VydmljZS5hcHBseVJldGVudGlvblBvbGljaWVzKCk7XHJcblxyXG4gICAgLy8gQ2xlYW4gdXAgZXhwaXJlZCBhdWRpdCBsb2dzXHJcbiAgICBhd2FpdCBhdWRpdExvZ2dlci5jbGVhbnVwT2xkTG9ncygpO1xyXG5cclxuICAgIC8vIExvZyBzdWNjZXNzZnVsIGNvbXBsZXRpb25cclxuICAgIGF3YWl0IGF1ZGl0TG9nZ2VyLmxvZ1NlY3VyaXR5RXZlbnQoe1xyXG4gICAgICBldmVudFR5cGU6ICdEQVRBX01PRElGSUNBVElPTicsXHJcbiAgICAgIHJlYXNvbjogJ1NjaGVkdWxlZCBkYXRhIHJldGVudGlvbiBjbGVhbnVwIGNvbXBsZXRlZCBzdWNjZXNzZnVsbHknLFxyXG4gICAgICBtZXRhZGF0YToge1xyXG4gICAgICAgIHNvdXJjZTogJ3NjaGVkdWxlZC1ldmVudCcsXHJcbiAgICAgICAgcmVxdWVzdElkOiBjb250ZXh0LmF3c1JlcXVlc3RJZCxcclxuICAgICAgfSxcclxuICAgIH0pO1xyXG5cclxuICAgIGNvbnNvbGUubG9nKCdEYXRhIHJldGVudGlvbiBjbGVhbnVwIGNvbXBsZXRlZCBzdWNjZXNzZnVsbHknKTtcclxuXHJcbiAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgIGNvbnNvbGUuZXJyb3IoJ0RhdGEgcmV0ZW50aW9uIGNsZWFudXAgZmFpbGVkOicsIGVycm9yKTtcclxuXHJcbiAgICAvLyBMb2cgdGhlIGZhaWx1cmVcclxuICAgIGF3YWl0IGF1ZGl0TG9nZ2VyLmxvZ1NlY3VyaXR5RXZlbnQoe1xyXG4gICAgICBldmVudFR5cGU6ICdEQVRBX01PRElGSUNBVElPTicsXHJcbiAgICAgIHJlYXNvbjogJ1NjaGVkdWxlZCBkYXRhIHJldGVudGlvbiBjbGVhbnVwIGZhaWxlZCcsXHJcbiAgICAgIG1ldGFkYXRhOiB7XHJcbiAgICAgICAgc291cmNlOiAnc2NoZWR1bGVkLWV2ZW50JyxcclxuICAgICAgICByZXF1ZXN0SWQ6IGNvbnRleHQuYXdzUmVxdWVzdElkLFxyXG4gICAgICAgIGVycm9yOiBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6ICdVbmtub3duIGVycm9yJyxcclxuICAgICAgfSxcclxuICAgIH0pO1xyXG5cclxuICAgIHRocm93IGVycm9yO1xyXG4gIH1cclxufTsiXX0=