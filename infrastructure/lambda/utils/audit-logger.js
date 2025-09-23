"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuditLogger = void 0;
const client_dynamodb_1 = require("@aws-sdk/client-dynamodb");
const lib_dynamodb_1 = require("@aws-sdk/lib-dynamodb");
const client_sns_1 = require("@aws-sdk/client-sns");
const crypto = __importStar(require("crypto"));
class AuditLogger {
    constructor() {
        const client = new client_dynamodb_1.DynamoDBClient({});
        this.dynamoClient = lib_dynamodb_1.DynamoDBDocumentClient.from(client);
        this.snsClient = new client_sns_1.SNSClient({});
        this.auditTableName = process.env.AUDIT_TABLE_NAME || '';
        this.alertTopicArn = process.env.ALERT_TOPIC_ARN || '';
    }
    /**
     * Log a security event
     */
    async logSecurityEvent(event) {
        const auditRecord = {
            id: crypto.randomUUID(),
            timestamp: new Date().toISOString(),
            eventType: event.eventType,
            userId: event.userId,
            sourceIp: event.sourceIp,
            userAgent: event.userAgent,
            path: event.path,
            method: event.method,
            reason: event.reason,
            metadata: event.metadata,
            severity: this.getSeverity(event.eventType),
            ttl: Math.floor(Date.now() / 1000) + (365 * 24 * 60 * 60), // 1 year retention
        };
        try {
            // Store in DynamoDB
            await this.dynamoClient.send(new lib_dynamodb_1.PutCommand({
                TableName: this.auditTableName,
                Item: auditRecord,
            }));
            // Send alert for high-severity events
            if (auditRecord.severity === 'HIGH' || auditRecord.severity === 'CRITICAL') {
                await this.sendSecurityAlert(auditRecord);
            }
            // Log to CloudWatch for monitoring
            console.log('Security Event:', JSON.stringify(auditRecord));
        }
        catch (error) {
            console.error('Failed to log security event:', error);
            // Don't throw error to avoid breaking the main flow
        }
    }
    /**
     * Log a data access event
     */
    async logDataAccess(event) {
        const auditRecord = {
            id: crypto.randomUUID(),
            timestamp: new Date().toISOString(),
            eventType: event.eventType,
            userId: event.userId,
            resourceType: event.resourceType,
            resourceId: event.resourceId,
            action: event.action,
            sourceIp: event.sourceIp,
            userAgent: event.userAgent,
            metadata: event.metadata,
            severity: event.action === 'DELETE' ? 'HIGH' : 'MEDIUM',
            ttl: Math.floor(Date.now() / 1000) + (365 * 24 * 60 * 60), // 1 year retention
        };
        try {
            await this.dynamoClient.send(new lib_dynamodb_1.PutCommand({
                TableName: this.auditTableName,
                Item: auditRecord,
            }));
            console.log('Data Access Event:', JSON.stringify(auditRecord));
        }
        catch (error) {
            console.error('Failed to log data access event:', error);
        }
    }
    /**
     * Log suspicious activity
     */
    async logSuspiciousActivity(details) {
        await this.logSecurityEvent({
            eventType: 'SUSPICIOUS_ACTIVITY',
            userId: details.userId,
            sourceIp: details.sourceIp,
            userAgent: details.userAgent,
            reason: details.activity,
            metadata: {
                ...details.metadata,
                riskScore: details.riskScore,
            },
        });
        // Send immediate alert for high-risk activities
        if (details.riskScore >= 8) {
            await this.sendSecurityAlert({
                id: crypto.randomUUID(),
                timestamp: new Date().toISOString(),
                eventType: 'SUSPICIOUS_ACTIVITY',
                userId: details.userId,
                sourceIp: details.sourceIp,
                userAgent: details.userAgent,
                reason: details.activity,
                metadata: details.metadata,
                severity: 'CRITICAL',
            });
        }
    }
    /**
     * Get event severity based on event type
     */
    getSeverity(eventType) {
        switch (eventType) {
            case 'AUTHENTICATION_SUCCESS':
            case 'DATA_ACCESS':
            case 'RATE_LIMIT_CHECK':
                return 'LOW';
            case 'AUTHENTICATION_FAILED':
            case 'DATA_MODIFICATION':
                return 'MEDIUM';
            case 'AUTHORIZATION_FAILED':
            case 'RATE_LIMIT_EXCEEDED':
            case 'PASSWORD_CHANGE':
            case 'TOKEN_REVOKED':
                return 'HIGH';
            case 'SUSPICIOUS_ACTIVITY':
            case 'ACCOUNT_LOCKED':
                return 'CRITICAL';
            default:
                return 'MEDIUM';
        }
    }
    /**
     * Send security alert via SNS
     */
    async sendSecurityAlert(auditRecord) {
        if (!this.alertTopicArn) {
            return;
        }
        try {
            const message = {
                alert: 'Security Event',
                severity: auditRecord.severity,
                eventType: auditRecord.eventType,
                timestamp: auditRecord.timestamp,
                userId: auditRecord.userId,
                sourceIp: auditRecord.sourceIp,
                reason: auditRecord.reason,
                metadata: auditRecord.metadata,
            };
            await this.snsClient.send(new client_sns_1.PublishCommand({
                TopicArn: this.alertTopicArn,
                Subject: `Security Alert: ${auditRecord.eventType}`,
                Message: JSON.stringify(message, null, 2),
            }));
        }
        catch (error) {
            console.error('Failed to send security alert:', error);
        }
    }
    /**
     * Query audit logs for a user
     */
    async getUserAuditLogs(userId, limit = 100) {
        // This would require a GSI on userId in a real implementation
        // For now, return empty array as placeholder
        console.log(`Querying audit logs for user ${userId}, limit ${limit}`);
        return [];
    }
    /**
     * Query audit logs by event type
     */
    async getEventTypeAuditLogs(eventType, limit = 100) {
        // This would require a GSI on eventType in a real implementation
        // For now, return empty array as placeholder
        console.log(`Querying audit logs for event type ${eventType}, limit ${limit}`);
        return [];
    }
    /**
     * Clean up old audit logs (should be called periodically)
     */
    async cleanupOldLogs() {
        // DynamoDB TTL will handle automatic cleanup
        // This method can be used for additional cleanup logic if needed
        console.log('Audit log cleanup completed (handled by DynamoDB TTL)');
    }
}
exports.AuditLogger = AuditLogger;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXVkaXQtbG9nZ2VyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiYXVkaXQtbG9nZ2VyLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBQUEsOERBQTBEO0FBQzFELHdEQUEyRTtBQUMzRSxvREFBZ0U7QUFDaEUsK0NBQWlDO0FBMEJqQyxNQUFhLFdBQVc7SUFNdEI7UUFDRSxNQUFNLE1BQU0sR0FBRyxJQUFJLGdDQUFjLENBQUMsRUFBRSxDQUFDLENBQUM7UUFDdEMsSUFBSSxDQUFDLFlBQVksR0FBRyxxQ0FBc0IsQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDLENBQUM7UUFDeEQsSUFBSSxDQUFDLFNBQVMsR0FBRyxJQUFJLHNCQUFTLENBQUMsRUFBRSxDQUFDLENBQUM7UUFFbkMsSUFBSSxDQUFDLGNBQWMsR0FBRyxPQUFPLENBQUMsR0FBRyxDQUFDLGdCQUFnQixJQUFJLEVBQUUsQ0FBQztRQUN6RCxJQUFJLENBQUMsYUFBYSxHQUFHLE9BQU8sQ0FBQyxHQUFHLENBQUMsZUFBZSxJQUFJLEVBQUUsQ0FBQztJQUN6RCxDQUFDO0lBRUQ7O09BRUc7SUFDSCxLQUFLLENBQUMsZ0JBQWdCLENBQUMsS0FBb0I7UUFDekMsTUFBTSxXQUFXLEdBQUc7WUFDbEIsRUFBRSxFQUFFLE1BQU0sQ0FBQyxVQUFVLEVBQUU7WUFDdkIsU0FBUyxFQUFFLElBQUksSUFBSSxFQUFFLENBQUMsV0FBVyxFQUFFO1lBQ25DLFNBQVMsRUFBRSxLQUFLLENBQUMsU0FBUztZQUMxQixNQUFNLEVBQUUsS0FBSyxDQUFDLE1BQU07WUFDcEIsUUFBUSxFQUFFLEtBQUssQ0FBQyxRQUFRO1lBQ3hCLFNBQVMsRUFBRSxLQUFLLENBQUMsU0FBUztZQUMxQixJQUFJLEVBQUUsS0FBSyxDQUFDLElBQUk7WUFDaEIsTUFBTSxFQUFFLEtBQUssQ0FBQyxNQUFNO1lBQ3BCLE1BQU0sRUFBRSxLQUFLLENBQUMsTUFBTTtZQUNwQixRQUFRLEVB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QUFLLEVBQUUsQ0FBQyxDQUFDO1FBQ3RFLE9BQU8sRUFBRSxDQUFDO0lBQ1osQ0FBQztJQUVEOztPQUVHO0lBQ0gsS0FBSyxDQUFDLHFCQUFxQixDQUFDLFNBQWlCLEVBQUUsUUFBZ0IsR0FBRztRQUNoRSxpRUFBaUU7UUFDakUsNkNBQTZDO1FBQzdDLE9BQU8sQ0FBQyxHQUFHLENBQUMsc0NBQXNDLFNBQVMsV0FBVyxLQUFLLEVBQUUsQ0FBQyxDQUFDO1FBQy9FLE9BQU8sRUFBRSxDQUFDO0lBQ1osQ0FBQztJQUVEOztPQUVHO0lBQ0gsS0FBSyxDQUFDLGNBQWM7UUFDbEIsNkNBQTZDO1FBQzdDLGlFQUFpRTtRQUNqRSxPQUFPLENBQUMsR0FBRyxDQUFDLHVEQUF1RCxDQUFDLENBQUM7SUFDdkUsQ0FBQztDQUNGO0FBdE5ELGtDQXNOQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IER5bmFtb0RCQ2xpZW50IH0gZnJvbSAnQGF3cy1zZGsvY2xpZW50LWR5bmFtb2RiJztcclxuaW1wb3J0IHsgRHluYW1vREJEb2N1bWVudENsaWVudCwgUHV0Q29tbWFuZCB9IGZyb20gJ0Bhd3Mtc2RrL2xpYi1keW5hbW9kYic7XHJcbmltcG9ydCB7IFNOU0NsaWVudCwgUHVibGlzaENvbW1hbmQgfSBmcm9tICdAYXdzLXNkay9jbGllbnQtc25zJztcclxuaW1wb3J0ICogYXMgY3J5cHRvIGZyb20gJ2NyeXB0byc7XHJcblxyXG5leHBvcnQgaW50ZXJmYWNlIFNlY3VyaXR5RXZlbnQge1xyXG4gIGV2ZW50VHlwZTogJ0FVVEhFTlRJQ0FUSU9OX1NVQ0NFU1MnIHwgJ0FVVEhFTlRJQ0FUSU9OX0ZBSUxFRCcgfCAnQVVUSE9SSVpBVElPTl9GQUlMRUQnIHwgXHJcbiAgICAgICAgICAgICdEQVRBX0FDQ0VTUycgfCAnREFUQV9NT0RJRklDQVRJT04nIHwgJ1JBVEVfTElNSVRfRVhDRUVERUQnIHwgJ1JBVEVfTElNSVRfQ0hFQ0snIHxcclxuICAgICAgICAgICAgJ1NVU1BJQ0lPVVNfQUNUSVZJVFknIHwgJ1BBU1NXT1JEX0NIQU5HRScgfCAnQUNDT1VOVF9MT0NLRUQnIHwgJ1RPS0VOX1JFVk9LRUQnO1xyXG4gIHVzZXJJZD86IHN0cmluZztcclxuICBzb3VyY2VJcD86IHN0cmluZztcclxuICB1c2VyQWdlbnQ/OiBzdHJpbmc7XHJcbiAgcGF0aD86IHN0cmluZztcclxuICBtZXRob2Q/OiBzdHJpbmc7XHJcbiAgcmVhc29uPzogc3RyaW5nO1xyXG4gIG1ldGFkYXRhPzogUmVjb3JkPHN0cmluZywgYW55PjtcclxufVxyXG5cclxuZXhwb3J0IGludGVyZmFjZSBEYXRhQWNjZXNzRXZlbnQge1xyXG4gIGV2ZW50VHlwZTogJ0RBVEFfQUNDRVNTJyB8ICdEQVRBX01PRElGSUNBVElPTic7XHJcbiAgdXNlcklkOiBzdHJpbmc7XHJcbiAgcmVzb3VyY2VUeXBlOiAnY29udGVudCcgfCAndXNlcicgfCAncGxhdGZvcm0nIHwgJ2ltYWdlJyB8ICdhdWRpbyc7XHJcbiAgcmVzb3VyY2VJZDogc3RyaW5nO1xyXG4gIGFjdGlvbjogJ0NSRUFURScgfCAnUkVBRCcgfCAnVVBEQVRFJyB8ICdERUxFVEUnO1xyXG4gIHNvdXJjZUlwPzogc3RyaW5nO1xyXG4gIHVzZXJBZ2VudD86IHN0cmluZztcclxuICBtZXRhZGF0YT86IFJlY29yZDxzdHJpbmcsIGFueT47XHJcbn1cclxuXHJcbmV4cG9ydCBjbGFzcyBBdWRpdExvZ2dlciB7XHJcbiAgcHJpdmF0ZSByZWFkb25seSBkeW5hbW9DbGllbnQ6IER5bmFtb0RCRG9jdW1lbnRDbGllbnQ7XHJcbiAgcHJpdmF0ZSByZWFkb25seSBzbnNDbGllbnQ6IFNOU0NsaWVudDtcclxuICBwcml2YXRlIHJlYWRvbmx5IGF1ZGl0VGFibGVOYW1lOiBzdHJpbmc7XHJcbiAgcHJpdmF0ZSByZWFkb25seSBhbGVydFRvcGljQXJuOiBzdHJpbmc7XHJcblxyXG4gIGNvbnN0cnVjdG9yKCkge1xyXG4gICAgY29uc3QgY2xpZW50ID0gbmV3IER5bmFtb0RCQ2xpZW50KHt9KTtcclxuICAgIHRoaXMuZHluYW1vQ2xpZW50ID0gRHluYW1vREJEb2N1bWVudENsaWVudC5mcm9tKGNsaWVudCk7XHJcbiAgICB0aGlzLnNuc0NsaWVudCA9IG5ldyBTTlNDbGllbnQoe30pO1xyXG4gICAgXHJcbiAgICB0aGlzLmF1ZGl0VGFibGVOYW1lID0gcHJvY2Vzcy5lbnYuQVVESVRfVEFCTEVfTkFNRSB8fCAnJztcclxuICAgIHRoaXMuYWxlcnRUb3BpY0FybiA9IHByb2Nlc3MuZW52LkFMRVJUX1RPUElDX0FSTiB8fCAnJztcclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIExvZyBhIHNlY3VyaXR5IGV2ZW50XHJcbiAgICovXHJcbiAgYXN5bmMgbG9nU2VjdXJpdHlFdmVudChldmVudDogU2VjdXJpdHlFdmVudCk6IFByb21pc2U8dm9pZD4ge1xyXG4gICAgY29uc3QgYXVkaXRSZWNvcmQgPSB7XHJcbiAgICAgIGlkOiBjcnlwdG8ucmFuZG9tVVVJRCgpLFxyXG4gICAgICB0aW1lc3RhbXA6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcclxuICAgICAgZXZlbnRUeXBlOiBldmVudC5ldmVudFR5cGUsXHJcbiAgICAgIHVzZXJJZDogZXZlbnQudXNlcklkLFxyXG4gICAgICBzb3VyY2VJcDogZXZlbnQuc291cmNlSXAsXHJcbiAgICAgIHVzZXJBZ2VudDogZXZlbnQudXNlckFnZW50LFxyXG4gICAgICBwYXRoOiBldmVudC5wYXRoLFxyXG4gICAgICBtZXRob2Q6IGV2ZW50Lm1ldGhvZCxcclxuICAgICAgcmVhc29uOiBldmVudC5yZWFzb24sXHJcbiAgICAgIG1ldGFkYXRhOiBldmVudC5tZXRhZGF0YSxcclxuICAgICAgc2V2ZXJpdHk6IHRoaXMuZ2V0U2V2ZXJpdHkoZXZlbnQuZXZlbnRUeXBlKSxcclxuICAgICAgdHRsOiBNYXRoLmZsb29yKERhdGUubm93KCkgLyAxMDAwKSArICgzNjUgKiAyNCAqIDYwICogNjApLCAvLyAxIHllYXIgcmV0ZW50aW9uXHJcbiAgICB9O1xyXG5cclxuICAgIHRyeSB7XHJcbiAgICAgIC8vIFN0b3JlIGluIER5bmFtb0RCXHJcbiAgICAgIGF3YWl0IHRoaXMuZHluYW1vQ2xpZW50LnNlbmQobmV3IFB1dENvbW1hbmQoe1xyXG4gICAgICAgIFRhYmxlTmFtZTogdGhpcy5hdWRpdFRhYmxlTmFtZSxcclxuICAgICAgICBJdGVtOiBhdWRpdFJlY29yZCxcclxuICAgICAgfSkpO1xyXG5cclxuICAgICAgLy8gU2VuZCBhbGVydCBmb3IgaGlnaC1zZXZlcml0eSBldmVudHNcclxuICAgICAgaWYgKGF1ZGl0UmVjb3JkLnNldmVyaXR5ID09PSAnSElHSCcgfHwgYXVkaXRSZWNvcmQuc2V2ZXJpdHkgPT09ICdDUklUSUNBTCcpIHtcclxuICAgICAgICBhd2FpdCB0aGlzLnNlbmRTZWN1cml0eUFsZXJ0KGF1ZGl0UmVjb3JkKTtcclxuICAgICAgfVxyXG5cclxuICAgICAgLy8gTG9nIHRvIENsb3VkV2F0Y2ggZm9yIG1vbml0b3JpbmdcclxuICAgICAgY29uc29sZS5sb2coJ1NlY3VyaXR5IEV2ZW50OicsIEpTT04uc3RyaW5naWZ5KGF1ZGl0UmVjb3JkKSk7XHJcblxyXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgY29uc29sZS5lcnJvcignRmFpbGVkIHRvIGxvZyBzZWN1cml0eSBldmVudDonLCBlcnJvcik7XHJcbiAgICAgIC8vIERvbid0IHRocm93IGVycm9yIHRvIGF2b2lkIGJyZWFraW5nIHRoZSBtYWluIGZsb3dcclxuICAgIH1cclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIExvZyBhIGRhdGEgYWNjZXNzIGV2ZW50XHJcbiAgICovXHJcbiAgYXN5bmMgbG9nRGF0YUFjY2VzcyhldmVudDogRGF0YUFjY2Vzc0V2ZW50KTogUHJvbWlzZTx2b2lkPiB7XHJcbiAgICBjb25zdCBhdWRpdFJlY29yZCA9IHtcclxuICAgICAgaWQ6IGNyeXB0by5yYW5kb21VVUlEKCksXHJcbiAgICAgIHRpbWVzdGFtcDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxyXG4gICAgICBldmVudFR5cGU6IGV2ZW50LmV2ZW50VHlwZSxcclxuICAgICAgdXNlcklkOiBldmVudC51c2VySWQsXHJcbiAgICAgIHJlc291cmNlVHlwZTogZXZlbnQucmVzb3VyY2VUeXBlLFxyXG4gICAgICByZXNvdXJjZUlkOiBldmVudC5yZXNvdXJjZUlkLFxyXG4gICAgICBhY3Rpb246IGV2ZW50LmFjdGlvbixcclxuICAgICAgc291cmNlSXA6IGV2ZW50LnNvdXJjZUlwLFxyXG4gICAgICB1c2VyQWdlbnQ6IGV2ZW50LnVzZXJBZ2VudCxcclxuICAgICAgbWV0YWRhdGE6IGV2ZW50Lm1ldGFkYXRhLFxyXG4gICAgICBzZXZlcml0eTogZXZlbnQuYWN0aW9uID09PSAnREVMRVRFJyA/ICdISUdIJyA6ICdNRURJVU0nLFxyXG4gICAgICB0dGw6IE1hdGguZmxvb3IoRGF0ZS5ub3coKSAvIDEwMDApICsgKDM2NSAqIDI0ICogNjAgKiA2MCksIC8vIDEgeWVhciByZXRlbnRpb25cclxuICAgIH07XHJcblxyXG4gICAgdHJ5IHtcclxuICAgICAgYXdhaXQgdGhpcy5keW5hbW9DbGllbnQuc2VuZChuZXcgUHV0Q29tbWFuZCh7XHJcbiAgICAgICAgVGFibGVOYW1lOiB0aGlzLmF1ZGl0VGFibGVOYW1lLFxyXG4gICAgICAgIEl0ZW06IGF1ZGl0UmVjb3JkLFxyXG4gICAgICB9KSk7XHJcblxyXG4gICAgICBjb25zb2xlLmxvZygnRGF0YSBBY2Nlc3MgRXZlbnQ6JywgSlNPTi5zdHJpbmdpZnkoYXVkaXRSZWNvcmQpKTtcclxuXHJcbiAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICBjb25zb2xlLmVycm9yKCdGYWlsZWQgdG8gbG9nIGRhdGEgYWNjZXNzIGV2ZW50OicsIGVycm9yKTtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIExvZyBzdXNwaWNpb3VzIGFjdGl2aXR5XHJcbiAgICovXHJcbiAgYXN5bmMgbG9nU3VzcGljaW91c0FjdGl2aXR5KGRldGFpbHM6IHtcclxuICAgIHVzZXJJZD86IHN0cmluZztcclxuICAgIHNvdXJjZUlwOiBzdHJpbmc7XHJcbiAgICB1c2VyQWdlbnQ/OiBzdHJpbmc7XHJcbiAgICBhY3Rpdml0eTogc3RyaW5nO1xyXG4gICAgcmlza1Njb3JlOiBudW1iZXI7XHJcbiAgICBtZXRhZGF0YT86IFJlY29yZDxzdHJpbmcsIGFueT47XHJcbiAgfSk6IFByb21pc2U8dm9pZD4ge1xyXG4gICAgYXdhaXQgdGhpcy5sb2dTZWN1cml0eUV2ZW50KHtcclxuICAgICAgZXZlbnRUeXBlOiAnU1VTUElDSU9VU19BQ1RJVklUWScsXHJcbiAgICAgIHVzZXJJZDogZGV0YWlscy51c2VySWQsXHJcbiAgICAgIHNvdXJjZUlwOiBkZXRhaWxzLnNvdXJjZUlwLFxyXG4gICAgICB1c2VyQWdlbnQ6IGRldGFpbHMudXNlckFnZW50LFxyXG4gICAgICByZWFzb246IGRldGFpbHMuYWN0aXZpdHksXHJcbiAgICAgIG1ldGFkYXRhOiB7XHJcbiAgICAgICAgLi4uZGV0YWlscy5tZXRhZGF0YSxcclxuICAgICAgICByaXNrU2NvcmU6IGRldGFpbHMucmlza1Njb3JlLFxyXG4gICAgICB9LFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gU2VuZCBpbW1lZGlhdGUgYWxlcnQgZm9yIGhpZ2gtcmlzayBhY3Rpdml0aWVzXHJcbiAgICBpZiAoZGV0YWlscy5yaXNrU2NvcmUgPj0gOCkge1xyXG4gICAgICBhd2FpdCB0aGlzLnNlbmRTZWN1cml0eUFsZXJ0KHtcclxuICAgICAgICBpZDogY3J5cHRvLnJhbmRvbVVVSUQoKSxcclxuICAgICAgICB0aW1lc3RhbXA6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcclxuICAgICAgICBldmVudFR5cGU6ICdTVVNQSUNJT1VTX0FDVElWSVRZJyxcclxuICAgICAgICB1c2VySWQ6IGRldGFpbHMudXNlcklkLFxyXG4gICAgICAgIHNvdXJjZUlwOiBkZXRhaWxzLnNvdXJjZUlwLFxyXG4gICAgICAgIHVzZXJBZ2VudDogZGV0YWlscy51c2VyQWdlbnQsXHJcbiAgICAgICAgcmVhc29uOiBkZXRhaWxzLmFjdGl2aXR5LFxyXG4gICAgICAgIG1ldGFkYXRhOiBkZXRhaWxzLm1ldGFkYXRhLFxyXG4gICAgICAgIHNldmVyaXR5OiAnQ1JJVElDQUwnLFxyXG4gICAgICB9KTtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIEdldCBldmVudCBzZXZlcml0eSBiYXNlZCBvbiBldmVudCB0eXBlXHJcbiAgICovXHJcbiAgcHJpdmF0ZSBnZXRTZXZlcml0eShldmVudFR5cGU6IFNlY3VyaXR5RXZlbnRbJ2V2ZW50VHlwZSddKTogJ0xPVycgfCAnTUVESVVNJyB8ICdISUdIJyB8ICdDUklUSUNBTCcge1xyXG4gICAgc3dpdGNoIChldmVudFR5cGUpIHtcclxuICAgICAgY2FzZSAnQVVUSEVOVElDQVRJT05fU1VDQ0VTUyc6XHJcbiAgICAgIGNhc2UgJ0RBVEFfQUNDRVNTJzpcclxuICAgICAgY2FzZSAnUkFURV9MSU1JVF9DSEVDSyc6XHJcbiAgICAgICAgcmV0dXJuICdMT1cnO1xyXG4gICAgICBcclxuICAgICAgY2FzZSAnQVVUSEVOVElDQVRJT05fRkFJTEVEJzpcclxuICAgICAgY2FzZSAnREFUQV9NT0RJRklDQVRJT04nOlxyXG4gICAgICAgIHJldHVybiAnTUVESVVNJztcclxuICAgICAgXHJcbiAgICAgIGNhc2UgJ0FVVEhPUklaQVRJT05fRkFJTEVEJzpcclxuICAgICAgY2FzZSAnUkFURV9MSU1JVF9FWENFRURFRCc6XHJcbiAgICAgIGNhc2UgJ1BBU1NXT1JEX0NIQU5HRSc6XHJcbiAgICAgIGNhc2UgJ1RPS0VOX1JFVk9LRUQnOlxyXG4gICAgICAgIHJldHVybiAnSElHSCc7XHJcbiAgICAgIFxyXG4gICAgICBjYXNlICdTVVNQSUNJT1VTX0FDVElWSVRZJzpcclxuICAgICAgY2FzZSAnQUNDT1VOVF9MT0NLRUQnOlxyXG4gICAgICAgIHJldHVybiAnQ1JJVElDQUwnO1xyXG4gICAgICBcclxuICAgICAgZGVmYXVsdDpcclxuICAgICAgICByZXR1cm4gJ01FRElVTSc7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBTZW5kIHNlY3VyaXR5IGFsZXJ0IHZpYSBTTlNcclxuICAgKi9cclxuICBwcml2YXRlIGFzeW5jIHNlbmRTZWN1cml0eUFsZXJ0KGF1ZGl0UmVjb3JkOiBhbnkpOiBQcm9taXNlPHZvaWQ+IHtcclxuICAgIGlmICghdGhpcy5hbGVydFRvcGljQXJuKSB7XHJcbiAgICAgIHJldHVybjtcclxuICAgIH1cclxuXHJcbiAgICB0cnkge1xyXG4gICAgICBjb25zdCBtZXNzYWdlID0ge1xyXG4gICAgICAgIGFsZXJ0OiAnU2VjdXJpdHkgRXZlbnQnLFxyXG4gICAgICAgIHNldmVyaXR5OiBhdWRpdFJlY29yZC5zZXZlcml0eSxcclxuICAgICAgICBldmVudFR5cGU6IGF1ZGl0UmVjb3JkLmV2ZW50VHlwZSxcclxuICAgICAgICB0aW1lc3RhbXA6IGF1ZGl0UmVjb3JkLnRpbWVzdGFtcCxcclxuICAgICAgICB1c2VySWQ6IGF1ZGl0UmVjb3JkLnVzZXJJZCxcclxuICAgICAgICBzb3VyY2VJcDogYXVkaXRSZWNvcmQuc291cmNlSXAsXHJcbiAgICAgICAgcmVhc29uOiBhdWRpdFJlY29yZC5yZWFzb24sXHJcbiAgICAgICAgbWV0YWRhdGE6IGF1ZGl0UmVjb3JkLm1ldGFkYXRhLFxyXG4gICAgICB9O1xyXG5cclxuICAgICAgYXdhaXQgdGhpcy5zbnNDbGllbnQuc2VuZChuZXcgUHVibGlzaENvbW1hbmQoe1xyXG4gICAgICAgIFRvcGljQXJuOiB0aGlzLmFsZXJ0VG9waWNBcm4sXHJcbiAgICAgICAgU3ViamVjdDogYFNlY3VyaXR5IEFsZXJ0OiAke2F1ZGl0UmVjb3JkLmV2ZW50VHlwZX1gLFxyXG4gICAgICAgIE1lc3NhZ2U6IEpTT04uc3RyaW5naWZ5KG1lc3NhZ2UsIG51bGwsIDIpLFxyXG4gICAgICB9KSk7XHJcblxyXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgY29uc29sZS5lcnJvcignRmFpbGVkIHRvIHNlbmQgc2VjdXJpdHkgYWxlcnQ6JywgZXJyb3IpO1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogUXVlcnkgYXVkaXQgbG9ncyBmb3IgYSB1c2VyXHJcbiAgICovXHJcbiAgYXN5bmMgZ2V0VXNlckF1ZGl0TG9ncyh1c2VySWQ6IHN0cmluZywgbGltaXQ6IG51bWJlciA9IDEwMCk6IFByb21pc2U8YW55W10+IHtcclxuICAgIC8vIFRoaXMgd291bGQgcmVxdWlyZSBhIEdTSSBvbiB1c2VySWQgaW4gYSByZWFsIGltcGxlbWVudGF0aW9uXHJcbiAgICAvLyBGb3Igbm93LCByZXR1cm4gZW1wdHkgYXJyYXkgYXMgcGxhY2Vob2xkZXJcclxuICAgIGNvbnNvbGUubG9nKGBRdWVyeWluZyBhdWRpdCBsb2dzIGZvciB1c2VyICR7dXNlcklkfSwgbGltaXQgJHtsaW1pdH1gKTtcclxuICAgIHJldHVybiBbXTtcclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIFF1ZXJ5IGF1ZGl0IGxvZ3MgYnkgZXZlbnQgdHlwZVxyXG4gICAqL1xyXG4gIGFzeW5jIGdldEV2ZW50VHlwZUF1ZGl0TG9ncyhldmVudFR5cGU6IHN0cmluZywgbGltaXQ6IG51bWJlciA9IDEwMCk6IFByb21pc2U8YW55W10+IHtcclxuICAgIC8vIFRoaXMgd291bGQgcmVxdWlyZSBhIEdTSSBvbiBldmVudFR5cGUgaW4gYSByZWFsIGltcGxlbWVudGF0aW9uXHJcbiAgICAvLyBGb3Igbm93LCByZXR1cm4gZW1wdHkgYXJyYXkgYXMgcGxhY2Vob2xkZXJcclxuICAgIGNvbnNvbGUubG9nKGBRdWVyeWluZyBhdWRpdCBsb2dzIGZvciBldmVudCB0eXBlICR7ZXZlbnRUeXBlfSwgbGltaXQgJHtsaW1pdH1gKTtcclxuICAgIHJldHVybiBbXTtcclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIENsZWFuIHVwIG9sZCBhdWRpdCBsb2dzIChzaG91bGQgYmUgY2FsbGVkIHBlcmlvZGljYWxseSlcclxuICAgKi9cclxuICBhc3luYyBjbGVhbnVwT2xkTG9ncygpOiBQcm9taXNlPHZvaWQ+IHtcclxuICAgIC8vIER5bmFtb0RCIFRUTCB3aWxsIGhhbmRsZSBhdXRvbWF0aWMgY2xlYW51cFxyXG4gICAgLy8gVGhpcyBtZXRob2QgY2FuIGJlIHVzZWQgZm9yIGFkZGl0aW9uYWwgY2xlYW51cCBsb2dpYyBpZiBuZWVkZWRcclxuICAgIGNvbnNvbGUubG9nKCdBdWRpdCBsb2cgY2xlYW51cCBjb21wbGV0ZWQgKGhhbmRsZWQgYnkgRHluYW1vREIgVFRMKScpO1xyXG4gIH1cclxufSJdfQ==