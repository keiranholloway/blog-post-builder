export interface SecurityEvent {
    eventType: 'AUTHENTICATION_SUCCESS' | 'AUTHENTICATION_FAILED' | 'AUTHORIZATION_FAILED' | 'DATA_ACCESS' | 'DATA_MODIFICATION' | 'RATE_LIMIT_EXCEEDED' | 'RATE_LIMIT_CHECK' | 'SUSPICIOUS_ACTIVITY' | 'PASSWORD_CHANGE' | 'ACCOUNT_LOCKED' | 'TOKEN_REVOKED';
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
export declare class AuditLogger {
    private readonly dynamoClient;
    private readonly snsClient;
    private readonly auditTableName;
    private readonly alertTopicArn;
    constructor();
    /**
     * Log a security event
     */
    logSecurityEvent(event: SecurityEvent): Promise<void>;
    /**
     * Log a data access event
     */
    logDataAccess(event: DataAccessEvent): Promise<void>;
    /**
     * Log suspicious activity
     */
    logSuspiciousActivity(details: {
        userId?: string;
        sourceIp: string;
        userAgent?: string;
        activity: string;
        riskScore: number;
        metadata?: Record<string, any>;
    }): Promise<void>;
    /**
     * Get event severity based on event type
     */
    private getSeverity;
    /**
     * Send security alert via SNS
     */
    private sendSecurityAlert;
    /**
     * Query audit logs for a user
     */
    getUserAuditLogs(userId: string, limit?: number): Promise<any[]>;
    /**
     * Query audit logs by event type
     */
    getEventTypeAuditLogs(eventType: string, limit?: number): Promise<any[]>;
    /**
     * Clean up old audit logs (should be called periodically)
     */
    cleanupOldLogs(): Promise<void>;
}
