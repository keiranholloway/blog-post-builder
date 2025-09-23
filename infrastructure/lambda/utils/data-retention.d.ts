export interface RetentionPolicy {
    resourceType: 'content' | 'user' | 'audio' | 'image' | 'audit' | 'tokens';
    retentionDays: number;
    tableName?: string;
    bucketName?: string;
    dateField: string;
}
export declare class DataRetentionService {
    private readonly dynamoClient;
    private readonly s3Client;
    private readonly auditLogger;
    private readonly defaultPolicies;
    constructor();
    /**
     * Apply all retention policies
     */
    applyRetentionPolicies(): Promise<void>;
    /**
     * Apply a specific retention policy
     */
    applyRetentionPolicy(policy: RetentionPolicy): Promise<void>;
    /**
     * Clean up expired items from DynamoDB table
     */
    private cleanupDynamoDBTable;
    /**
     * Clean up expired objects from S3 bucket
     */
    private cleanupS3Bucket;
    /**
     * Extract primary key from DynamoDB item
     */
    private extractPrimaryKey;
    /**
     * Get retention policy for a resource type
     */
    getRetentionPolicy(resourceType: string): RetentionPolicy | undefined;
    /**
     * Update retention policy
     */
    updateRetentionPolicy(resourceType: string, retentionDays: number): void;
    /**
     * Soft delete content (mark as deleted instead of immediate deletion)
     */
    softDeleteContent(contentId: string, userId: string): Promise<void>;
    /**
     * Restore soft-deleted content
     */
    restoreContent(contentId: string, userId: string): Promise<void>;
}
