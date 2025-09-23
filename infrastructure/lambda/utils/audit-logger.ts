import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import * as crypto from 'crypto';

export interface SecurityEvent {
  eventType: 'AUTHENTICATION_SUCCESS' | 'AUTHENTICATION_FAILED' | 'AUTHORIZATION_FAILED' | 
            'DATA_ACCESS' | 'DATA_MODIFICATION' | 'RATE_LIMIT_EXCEEDED' | 'RATE_LIMIT_CHECK' |
            'SUSPICIOUS_ACTIVITY' | 'PASSWORD_CHANGE' | 'ACCOUNT_LOCKED' | 'TOKEN_REVOKED';
  userId?: string;
  sourceIp?: string;
  userAgent?: string;
  path?: string;
  method?: string;
  reason?: string;
  metadata?: Record<string, any>;
}

export interface DataAccessEvent {
  eventType: 'DATA_ACCESS' | 'DATA_MODIFICATION';
  userId: string;
  resourceType: 'content' | 'user' | 'platform' | 'image' | 'audio';
  resourceId: string;
  action: 'CREATE' | 'READ' | 'UPDATE' | 'DELETE';
  sourceIp?: string;
  userAgent?: string;
  metadata?: Record<string, any>;
}

export class AuditLogger {
  private readonly dynamoClient: DynamoDBDocumentClient;
  private readonly snsClient: SNSClient;
  private readonly auditTableName: string;
  private readonly alertTopicArn: string;

  constructor() {
    const client = new DynamoDBClient({});
    this.dynamoClient = DynamoDBDocumentClient.from(client);
    this.snsClient = new SNSClient({});
    
    this.auditTableName = process.env.AUDIT_TABLE_NAME || '';
    this.alertTopicArn = process.env.ALERT_TOPIC_ARN || '';
  }

  /**
   * Log a security event
   */
  async logSecurityEvent(event: SecurityEvent): Promise<void> {
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
      await this.dynamoClient.send(new PutCommand({
        TableName: this.auditTableName,
        Item: auditRecord,
      }));

      // Send alert for high-severity events
      if (auditRecord.severity === 'HIGH' || auditRecord.severity === 'CRITICAL') {
        await this.sendSecurityAlert(auditRecord);
      }

      // Log to CloudWatch for monitoring
      console.log('Security Event:', JSON.stringify(auditRecord));

    } catch (error) {
      console.error('Failed to log security event:', error);
      // Don't throw error to avoid breaking the main flow
    }
  }

  /**
   * Log a data access event
   */
  async logDataAccess(event: DataAccessEvent): Promise<void> {
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
      await this.dynamoClient.send(new PutCommand({
        TableName: this.auditTableName,
        Item: auditRecord,
      }));

      console.log('Data Access Event:', JSON.stringify(auditRecord));

    } catch (error) {
      console.error('Failed to log data access event:', error);
    }
  }

  /**
   * Log suspicious activity
   */
  async logSuspiciousActivity(details: {
    userId?: string;
    sourceIp: string;
    userAgent?: string;
    activity: string;
    riskScore: number;
    metadata?: Record<string, any>;
  }): Promise<void> {
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
  private getSeverity(eventType: SecurityEvent['eventType']): 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' {
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
  private async sendSecurityAlert(auditRecord: any): Promise<void> {
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

      await this.snsClient.send(new PublishCommand({
        TopicArn: this.alertTopicArn,
        Subject: `Security Alert: ${auditRecord.eventType}`,
        Message: JSON.stringify(message, null, 2),
      }));

    } catch (error) {
      console.error('Failed to send security alert:', error);
    }
  }

  /**
   * Query audit logs for a user
   */
  async getUserAuditLogs(userId: string, limit: number = 100): Promise<any[]> {
    // This would require a GSI on userId in a real implementation
    // For now, return empty array as placeholder
    console.log(`Querying audit logs for user ${userId}, limit ${limit}`);
    return [];
  }

  /**
   * Query audit logs by event type
   */
  async getEventTypeAuditLogs(eventType: string, limit: number = 100): Promise<any[]> {
    // This would require a GSI on eventType in a real implementation
    // For now, return empty array as placeholder
    console.log(`Querying audit logs for event type ${eventType}, limit ${limit}`);
    return [];
  }

  /**
   * Clean up old audit logs (should be called periodically)
   */
  async cleanupOldLogs(): Promise<void> {
    // DynamoDB TTL will handle automatic cleanup
    // This method can be used for additional cleanup logic if needed
    console.log('Audit log cleanup completed (handled by DynamoDB TTL)');
  }
}