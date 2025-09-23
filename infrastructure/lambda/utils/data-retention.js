"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DataRetentionService = void 0;
const client_dynamodb_1 = require("@aws-sdk/client-dynamodb");
const lib_dynamodb_1 = require("@aws-sdk/lib-dynamodb");
const client_s3_1 = require("@aws-sdk/client-s3");
const audit_logger_1 = require("./audit-logger");
class DataRetentionService {
    constructor() {
        // Default retention policies (can be overridden via environment variables)
        this.defaultPolicies = [
            {
                resourceType: 'audio',
                retentionDays: 7,
                bucketName: process.env.AUDIO_BUCKET_NAME,
                dateField: 'lastModified',
            },
            {
                resourceType: 'content',
                retentionDays: 365,
                tableName: process.env.CONTENT_TABLE_NAME,
                dateField: 'deletedAt',
            },
            {
                resourceType: 'audit',
                retentionDays: 365,
                tableName: process.env.AUDIT_TABLE_NAME,
                dateField: 'timestamp',
            },
            {
                resourceType: 'tokens',
                retentionDays: 30,
                tableName: process.env.TOKENS_TABLE_NAME,
                dateField: 'revokedAt',
            },
            {
                resourceType: 'image',
                retentionDays: 90,
                bucketName: process.env.IMAGE_BUCKET_NAME,
                dateField: 'lastModified',
            },
        ];
        const client = new client_dynamodb_1.DynamoDBClient({});
        this.dynamoClient = lib_dynamodb_1.DynamoDBDocumentClient.from(client);
        this.s3Client = new client_s3_1.S3Client({});
        this.auditLogger = new audit_logger_1.AuditLogger();
    }
    /**
     * Apply all retention policies
     */
    async applyRetentionPolicies() {
        console.log('Starting data retention cleanup...');
        for (const policy of this.defaultPolicies) {
            try {
                await this.applyRetentionPolicy(policy);
            }
            catch (error) {
                console.error(`Failed to apply retention policy for ${policy.resourceType}:`, error);
                await this.auditLogger.logSecurityEvent({
                    eventType: 'DATA_MODIFICATION',
                    reason: `Retention policy failed for ${policy.resourceType}`,
                    metadata: {
                        error: error instanceof Error ? error.message : 'Unknown error',
                        policy,
                    },
                });
            }
        }
        console.log('Data retention cleanup completed');
    }
    /**
     * Apply a specific retention policy
     */
    async applyRetentionPolicy(policy) {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - policy.retentionDays);
        console.log(`Applying retention policy for ${policy.resourceType}, cutoff date: ${cutoffDate.toISOString()}`);
        if (policy.tableName) {
            await this.cleanupDynamoDBTable(policy, cutoffDate);
        }
        if (policy.bucketName) {
            await this.cleanupS3Bucket(policy, cutoffDate);
        }
    }
    /**
     * Clean up expired items from DynamoDB table
     */
    async cleanupDynamoDBTable(policy, cutoffDate) {
        if (!policy.tableName)
            return;
        let deletedCount = 0;
        let lastEvaluatedKey = undefined;
        do {
            try {
                const scanResult = await this.dynamoClient.send(new lib_dynamodb_1.ScanCommand({
                    TableName: policy.tableName,
                    FilterExpression: `#dateField < :cutoffDate`,
                    ExpressionAttributeNames: {
                        '#dateField': policy.dateField,
                    },
                    ExpressionAttributeValues: {
                        ':cutoffDate': cutoffDate.toISOString(),
                    },
                    ExclusiveStartKey: lastEvaluatedKey,
                    Limit: 25, // Process in small batches
                }));
                if (scanResult.Items) {
                    for (const item of scanResult.Items) {
                        try {
                            // Get the primary key for deletion
                            const key = this.extractPrimaryKey(item, policy.tableName);
                            await this.dynamoClient.send(new lib_dynamodb_1.DeleteCommand({
                                TableName: policy.tableName,
                                Key: key,
                            }));
                            deletedCount++;
                            // Log data deletion
                            await this.auditLogger.logDataAccess({
                                eventType: 'DATA_MODIFICATION',
                                userId: 'system',
                                resourceType: policy.resourceType,
                                resourceId: key.id || key.tokenId || 'unknown',
                                action: 'DELETE',
                                metadata: {
                                    reason: 'Data retention policy',
                                    policy: policy.resourceType,
                                    retentionDays: policy.retentionDays,
                                },
                            });
                        }
                        catch (error) {
                            console.error(`Failed to delete item from ${policy.tableName}:`, error);
                        }
                    }
                }
                lastEvaluatedKey = scanResult.LastEvaluatedKey;
            }
            catch (error) {
                console.error(`Failed to scan ${policy.tableName}:`, error);
                break;
            }
        } while (lastEvaluatedKey);
        console.log(`Deleted ${deletedCount} items from ${policy.tableName}`);
    }
    /**
     * Clean up expired objects from S3 bucket
     */
    async cleanupS3Bucket(policy, cutoffDate) {
        if (!policy.bucketName)
            return;
        let deletedCount = 0;
        let continuationToken;
        do {
            try {
                const listResult = await this.s3Client.send(new client_s3_1.ListObjectsV2Command({
                    Bucket: policy.bucketName,
                    ContinuationToken: continuationToken,
                    MaxKeys: 100, // Process in batches
                }));
                if (listResult.Contents) {
                    for (const object of listResult.Contents) {
                        if (object.LastModified && object.LastModified < cutoffDate && object.Key) {
                            try {
                                await this.s3Client.send(new client_s3_1.DeleteObjectCommand({
                                    Bucket: policy.bucketName,
                                    Key: object.Key,
                                }));
                                deletedCount++;
                                // Log data deletion
                                await this.auditLogger.logDataAccess({
                                    eventType: 'DATA_MODIFICATION',
                                    userId: 'system',
                                    resourceType: policy.resourceType,
                                    resourceId: object.Key,
                                    action: 'DELETE',
                                    metadata: {
                                        reason: 'Data retention policy',
                                        policy: policy.resourceType,
                                        retentionDays: policy.retentionDays,
                                        lastModified: object.LastModified.toISOString(),
                                    },
                                });
                            }
                            catch (error) {
                                console.error(`Failed to delete object ${object.Key} from ${policy.bucketName}:`, error);
                            }
                        }
                    }
                }
                continuationToken = listResult.NextContinuationToken;
            }
            catch (error) {
                console.error(`Failed to list objects in ${policy.bucketName}:`, error);
                break;
            }
        } while (continuationToken);
        console.log(`Deleted ${deletedCount} objects from ${policy.bucketName}`);
    }
    /**
     * Extract primary key from DynamoDB item
     */
    extractPrimaryKey(item, tableName) {
        // This is a simplified approach - in a real implementation,
        // you'd need to know the exact key schema for each table
        if (tableName.includes('content')) {
            return { id: item.id };
        }
        else if (tableName.includes('user')) {
            return { id: item.id };
        }
        else if (tableName.includes('token')) {
            return { tokenId: item.tokenId };
        }
        else if (tableName.includes('audit')) {
            return { id: item.id };
        }
        else if (tableName.includes('platform')) {
            return { userId: item.userId, platform: item.platform };
        }
        else if (tableName.includes('oauth')) {
            return { state: item.state };
        }
        else {
            return { id: item.id };
        }
    }
    /**
     * Get retention policy for a resource type
     */
    getRetentionPolicy(resourceType) {
        return this.defaultPolicies.find(policy => policy.resourceType === resourceType);
    }
    /**
     * Update retention policy
     */
    updateRetentionPolicy(resourceType, retentionDays) {
        const policyIndex = this.defaultPolicies.findIndex(policy => policy.resourceType === resourceType);
        if (policyIndex >= 0) {
            this.defaultPolicies[policyIndex].retentionDays = retentionDays;
        }
    }
    /**
     * Soft delete content (mark as deleted instead of immediate deletion)
     */
    async softDeleteContent(contentId, userId) {
        const tableName = process.env.CONTENT_TABLE_NAME;
        if (!tableName)
            return;
        try {
            // Update content with deletion timestamp
            await this.dynamoClient.send(new lib_dynamodb_1.PutCommand({
                TableName: tableName,
                Item: {
                    id: contentId,
                    deletedAt: new Date().toISOString(),
                    deletedBy: userId,
                    status: 'deleted',
                },
                ConditionExpression: 'attribute_exists(id)',
            }));
            await this.auditLogger.logDataAccess({
                eventType: 'DATA_MODIFICATION',
                userId,
                resourceType: 'content',
                resourceId: contentId,
                action: 'DELETE',
                metadata: {
                    type: 'soft_delete',
                },
            });
        }
        catch (error) {
            console.error(`Failed to soft delete content ${contentId}:`, error);
            throw error;
        }
    }
    /**
     * Restore soft-deleted content
     */
    async restoreContent(contentId, userId) {
        const tableName = process.env.CONTENT_TABLE_NAME;
        if (!tableName)
            return;
        try {
            // Remove deletion timestamp and restore status
            await this.dynamoClient.send(new lib_dynamodb_1.UpdateCommand({
                TableName: tableName,
                Key: { id: contentId },
                UpdateExpression: 'REMOVE deletedAt, deletedBy SET #status = :status',
                ExpressionAttributeNames: {
                    '#status': 'status',
                },
                ExpressionAttributeValues: {
                    ':status': 'draft',
                },
                ConditionExpression: 'attribute_exists(deletedAt)',
            }));
            await this.auditLogger.logDataAccess({
                eventType: 'DATA_MODIFICATION',
                userId,
                resourceType: 'content',
                resourceId: contentId,
                action: 'UPDATE',
                metadata: {
                    type: 'restore',
                },
            });
        }
        catch (error) {
            console.error(`Failed to restore content ${contentId}:`, error);
            throw error;
        }
    }
}
exports.DataRetentionService = DataRetentionService;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZGF0YS1yZXRlbnRpb24uanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJkYXRhLXJldGVudGlvbi50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFBQSw4REFBMEY7QUFDMUYsd0RBQXdJO0FBQ3hJLGtEQUF5RjtBQUN6RixpREFBNkM7QUFVN0MsTUFBYSxvQkFBb0I7SUF1Qy9CO1FBbENBLDJFQUEyRTtRQUMxRCxvQkFBZSxHQUFzQjtZQUNwRDtnQkFDRSxZQUFZLEVBQUUsT0FBTztnQkFDckIsYUFBYSxFQUFFLENBQUM7Z0JBQ2hCLFVBQVUsRUFBRSxPQUFPLENBQUMsR0FBRyxDQUFDLGlCQUFpQjtnQkFDekMsU0FBUyxFQUFFLGNBQWM7YUFDMUI7WUFDRDtnQkFDRSxZQUFZLEVBQUUsU0FBUztnQkFDdkIsYUFBYSxFQUFFLEdBQUc7Z0JBQ2xCLFNBQVMsRUFBRSxPQUFPLENBQUMsR0FBRyxDQUFDLGtCQUFrQjtnQkFDekMsU0FBUyxFQUFFLFdBQVc7YUFDdkI7WUFDRDtnQkFDRSxZQUFZLEVBQUUsT0FBTztnQkFDckIsYUFBYSxFQUFFLEdBQUc7Z0JBQ2xCLFNBQVMsRUFBRSxPQUFPLENBQUMsR0FBRyxDQUFDLGdCQUFnQjtnQkFDdkMsU0FBUyxFQUFFLFdBQVc7YUFDdkI7WUFDRDtnQkFDRSxZQUFZLEVBQUUsUUFBUTtnQkFDdEIsYUFBYSxFQUFFLEVBQUU7Z0JBQ2pCLFNBQVMsRUFBRSxPQUFPLENBQUMsR0FBRyxDQUFDLGlCQUFpQjtnQkFDeEMsU0FBUyxFQUFFLFdBQVc7YUFDdkI7WUFDRDtnQkFDRSxZQUFZLEVBQUUsT0FBTztnQkFDckIsYUFBYSxFQUFFLEVBQUU7Z0JBQ2pCLFVBQVUsRUFBRSxPQUFPLENBQUMsR0FBRyxDQUFDLGlCQUFpQjtnQkFDekMsU0FBUyxFQUFFLGNBQWM7YUFDMUI7U0FDRixDQUFDO1FBR0EsTUFBTSxNQUFNLEdBQUcsSUFBSSxnQ0FBYyxDQUFDLEVBQUUsQ0FBQyxDQUFDO1FBQ3RDLElBQUksQ0FBQyxZ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LElBQUk7WUFDRiwrQ0FBK0M7WUFDL0MsTUFBTSxJQUFJLENBQUMsWUFBWSxDQUFDLElBQUksQ0FBQyxJQUFJLDRCQUFhLENBQUM7Z0JBQzdDLFNBQVMsRUFBRSxTQUFTO2dCQUNwQixHQUFHLEVBQUUsRUFBRSxFQUFFLEVBQUUsU0FBUyxFQUFFO2dCQUN0QixnQkFBZ0IsRUFBRSxtREFBbUQ7Z0JBQ3JFLHdCQUF3QixFQUFFO29CQUN4QixTQUFTLEVBQUUsUUFBUTtpQkFDcEI7Z0JBQ0QseUJBQXlCLEVBQUU7b0JBQ3pCLFNBQVMsRUFBRSxPQUFPO2lCQUNuQjtnQkFDRCxtQkFBbUIsRUFBRSw2QkFBNkI7YUFDbkQsQ0FBQyxDQUFDLENBQUM7WUFFSixNQUFNLElBQUksQ0FBQyxXQUFXLENBQUMsYUFBYSxDQUFDO2dCQUNuQyxTQUFTLEVBQUUsbUJBQW1CO2dCQUM5QixNQUFNO2dCQUNOLFlBQVksRUFBRSxTQUFTO2dCQUN2QixVQUFVLEVBQUUsU0FBUztnQkFDckIsTUFBTSxFQUFFLFFBQVE7Z0JBQ2hCLFFBQVEsRUFBRTtvQkFDUixJQUFJLEVBQUUsU0FBUztpQkFDaEI7YUFDRixDQUFDLENBQUM7U0FFSjtRQUFDLE9BQU8sS0FBSyxFQUFFO1lBQ2QsT0FBTyxDQUFDLEtBQUssQ0FBQyw2QkFBNkIsU0FBUyxHQUFHLEVBQUUsS0FBSyxDQUFDLENBQUM7WUFDaEUsTUFBTSxLQUFLLENBQUM7U0FDYjtJQUNILENBQUM7Q0FDRjtBQWhWRCxvREFnVkMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBEeW5hbW9EQkNsaWVudCwgU2NhbkNvbW1hbmQsIERlbGV0ZUl0ZW1Db21tYW5kIH0gZnJvbSAnQGF3cy1zZGsvY2xpZW50LWR5bmFtb2RiJztcclxuaW1wb3J0IHsgRHluYW1vREJEb2N1bWVudENsaWVudCwgU2NhbkNvbW1hbmQgYXMgRG9jU2NhbkNvbW1hbmQsIERlbGV0ZUNvbW1hbmQsIFB1dENvbW1hbmQsIFVwZGF0ZUNvbW1hbmQgfSBmcm9tICdAYXdzLXNkay9saWItZHluYW1vZGInO1xyXG5pbXBvcnQgeyBTM0NsaWVudCwgTGlzdE9iamVjdHNWMkNvbW1hbmQsIERlbGV0ZU9iamVjdENvbW1hbmQgfSBmcm9tICdAYXdzLXNkay9jbGllbnQtczMnO1xyXG5pbXBvcnQgeyBBdWRpdExvZ2dlciB9IGZyb20gJy4vYXVkaXQtbG9nZ2VyJztcclxuXHJcbmV4cG9ydCBpbnRlcmZhY2UgUmV0ZW50aW9uUG9saWN5IHtcclxuICByZXNvdXJjZVR5cGU6ICdjb250ZW50JyB8ICd1c2VyJyB8ICdhdWRpbycgfCAnaW1hZ2UnIHwgJ2F1ZGl0JyB8ICd0b2tlbnMnO1xyXG4gIHJldGVudGlvbkRheXM6IG51bWJlcjtcclxuICB0YWJsZU5hbWU/OiBzdHJpbmc7XHJcbiAgYnVja2V0TmFtZT86IHN0cmluZztcclxuICBkYXRlRmllbGQ6IHN0cmluZztcclxufVxyXG5cclxuZXhwb3J0IGNsYXNzIERhdGFSZXRlbnRpb25TZXJ2aWNlIHtcclxuICBwcml2YXRlIHJlYWRvbmx5IGR5bmFtb0NsaWVudDogRHluYW1vREJEb2N1bWVudENsaWVudDtcclxuICBwcml2YXRlIHJlYWRvbmx5IHMzQ2xpZW50OiBTM0NsaWVudDtcclxuICBwcml2YXRlIHJlYWRvbmx5IGF1ZGl0TG9nZ2VyOiBBdWRpdExvZ2dlcjtcclxuXHJcbiAgLy8gRGVmYXVsdCByZXRlbnRpb24gcG9saWNpZXMgKGNhbiBiZSBvdmVycmlkZGVuIHZpYSBlbnZpcm9ubWVudCB2YXJpYWJsZXMpXHJcbiAgcHJpdmF0ZSByZWFkb25seSBkZWZhdWx0UG9saWNpZXM6IFJldGVudGlvblBvbGljeVtdID0gW1xyXG4gICAge1xyXG4gICAgICByZXNvdXJjZVR5cGU6ICdhdWRpbycsXHJcbiAgICAgIHJldGVudGlvbkRheXM6IDcsIC8vIEF1ZGlvIGZpbGVzIGRlbGV0ZWQgYWZ0ZXIgNyBkYXlzXHJcbiAgICAgIGJ1Y2tldE5hbWU6IHByb2Nlc3MuZW52LkFVRElPX0JVQ0tFVF9OQU1FLFxyXG4gICAgICBkYXRlRmllbGQ6ICdsYXN0TW9kaWZpZWQnLFxyXG4gICAgfSxcclxuICAgIHtcclxuICAgICAgcmVzb3VyY2VUeXBlOiAnY29udGVudCcsXHJcbiAgICAgIHJldGVudGlvbkRheXM6IDM2NSwgLy8gQ29udGVudCBrZXB0IGZvciAxIHllYXIgYWZ0ZXIgZGVsZXRpb25cclxuICAgICAgdGFibGVOYW1lOiBwcm9jZXNzLmVudi5DT05URU5UX1RBQkxFX05BTUUsXHJcbiAgICAgIGRhdGVGaWVsZDogJ2RlbGV0ZWRBdCcsXHJcbiAgICB9LFxyXG4gICAge1xyXG4gICAgICByZXNvdXJjZVR5cGU6ICdhdWRpdCcsXHJcbiAgICAgIHJldGVudGlvbkRheXM6IDM2NSwgLy8gQXVkaXQgbG9ncyBrZXB0IGZvciAxIHllYXJcclxuICAgICAgdGFibGVOYW1lOiBwcm9jZXNzLmVudi5BVURJVF9UQUJMRV9OQU1FLFxyXG4gICAgICBkYXRlRmllbGQ6ICd0aW1lc3RhbXAnLFxyXG4gICAgfSxcclxuICAgIHtcclxuICAgICAgcmVzb3VyY2VUeXBlOiAndG9rZW5zJyxcclxuICAgICAgcmV0ZW50aW9uRGF5czogMzAsIC8vIFJldm9rZWQgdG9rZW5zIGtlcHQgZm9yIDMwIGRheXNcclxuICAgICAgdGFibGVOYW1lOiBwcm9jZXNzLmVudi5UT0tFTlNfVEFCTEVfTkFNRSxcclxuICAgICAgZGF0ZUZpZWxkOiAncmV2b2tlZEF0JyxcclxuICAgIH0sXHJcbiAgICB7XHJcbiAgICAgIHJlc291cmNlVHlwZTogJ2ltYWdlJyxcclxuICAgICAgcmV0ZW50aW9uRGF5czogOTAsIC8vIEltYWdlcyBtb3ZlZCB0byBHbGFjaWVyIGFmdGVyIDkwIGRheXMgKGhhbmRsZWQgYnkgUzMgbGlmZWN5Y2xlKVxyXG4gICAgICBidWNrZXROYW1lOiBwcm9jZXNzLmVudi5JTUFHRV9CVUNLRVRfTkFNRSxcclxuICAgICAgZGF0ZUZpZWxkOiAnbGFzdE1vZGlmaWVkJyxcclxuICAgIH0sXHJcbiAgXTtcclxuXHJcbiAgY29uc3RydWN0b3IoKSB7XHJcbiAgICBjb25zdCBjbGllbnQgPSBuZXcgRHluYW1vREJDbGllbnQoe30pO1xyXG4gICAgdGhpcy5keW5hbW9DbGllbnQgPSBEeW5hbW9EQkRvY3VtZW50Q2xpZW50LmZyb20oY2xpZW50KTtcclxuICAgIHRoaXMuczNDbGllbnQgPSBuZXcgUzNDbGllbnQoe30pO1xyXG4gICAgdGhpcy5hdWRpdExvZ2dlciA9IG5ldyBBdWRpdExvZ2dlcigpO1xyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogQXBwbHkgYWxsIHJldGVudGlvbiBwb2xpY2llc1xyXG4gICAqL1xyXG4gIGFzeW5jIGFwcGx5UmV0ZW50aW9uUG9saWNpZXMoKTogUHJvbWlzZTx2b2lkPiB7XHJcbiAgICBjb25zb2xlLmxvZygnU3RhcnRpbmcgZGF0YSByZXRlbnRpb24gY2xlYW51cC4uLicpO1xyXG5cclxuICAgIGZvciAoY29uc3QgcG9saWN5IG9mIHRoaXMuZGVmYXVsdFBvbGljaWVzKSB7XHJcbiAgICAgIHRyeSB7XHJcbiAgICAgICAgYXdhaXQgdGhpcy5hcHBseVJldGVudGlvblBvbGljeShwb2xpY3kpO1xyXG4gICAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICAgIGNvbnNvbGUuZXJyb3IoYEZhaWxlZCB0byBhcHBseSByZXRlbnRpb24gcG9saWN5IGZvciAke3BvbGljeS5yZXNvdXJjZVR5cGV9OmAsIGVycm9yKTtcclxuICAgICAgICBcclxuICAgICAgICBhd2FpdCB0aGlzLmF1ZGl0TG9nZ2VyLmxvZ1NlY3VyaXR5RXZlbnQoe1xyXG4gICAgICAgICAgZXZlbnRUeXBlOiAnREFUQV9NT0RJRklDQVRJT04nLFxyXG4gICAgICAgICAgcmVhc29uOiBgUmV0ZW50aW9uIHBvbGljeSBmYWlsZWQgZm9yICR7cG9saWN5LnJlc291cmNlVHlwZX1gLFxyXG4gICAgICAgICAgbWV0YWRhdGE6IHtcclxuICAgICAgICAgICAgZXJyb3I6IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogJ1Vua25vd24gZXJyb3InLFxyXG4gICAgICAgICAgICBwb2xpY3ksXHJcbiAgICAgICAgICB9LFxyXG4gICAgICAgIH0pO1xyXG4gICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgY29uc29sZS5sb2coJ0RhdGEgcmV0ZW50aW9uIGNsZWFudXAgY29tcGxldGVkJyk7XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBBcHBseSBhIHNwZWNpZmljIHJldGVudGlvbiBwb2xpY3lcclxuICAgKi9cclxuICBhc3luYyBhcHBseVJldGVudGlvblBvbGljeShwb2xpY3k6IFJldGVudGlvblBvbGljeSk6IFByb21pc2U8dm9pZD4ge1xyXG4gICAgY29uc3QgY3V0b2ZmRGF0ZSA9IG5ldyBEYXRlKCk7XHJcbiAgICBjdXRvZmZEYXRlLnNldERhdGUoY3V0b2ZmRGF0ZS5nZXREYXRlKCkgLSBwb2xpY3kucmV0ZW50aW9uRGF5cyk7XHJcblxyXG4gICAgY29uc29sZS5sb2coYEFwcGx5aW5nIHJldGVudGlvbiBwb2xpY3kgZm9yICR7cG9saWN5LnJlc291cmNlVHlwZX0sIGN1dG9mZiBkYXRlOiAke2N1dG9mZkRhdGUudG9JU09TdHJpbmcoKX1gKTtcclxuXHJcbiAgICBpZiAocG9saWN5LnRhYmxlTmFtZSkge1xyXG4gICAgICBhd2FpdCB0aGlzLmNsZWFudXBEeW5hbW9EQlRhYmxlKHBvbGljeSwgY3V0b2ZmRGF0ZSk7XHJcbiAgICB9XHJcblxyXG4gICAgaWYgKHBvbGljeS5idWNrZXROYW1lKSB7XHJcbiAgICAgIGF3YWl0IHRoaXMuY2xlYW51cFMzQnVja2V0KHBvbGljeSwgY3V0b2ZmRGF0ZSk7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBDbGVhbiB1cCBleHBpcmVkIGl0ZW1zIGZyb20gRHluYW1vREIgdGFibGVcclxuICAgKi9cclxuICBwcml2YXRlIGFzeW5jIGNsZWFudXBEeW5hbW9EQlRhYmxlKHBvbGljeTogUmV0ZW50aW9uUG9saWN5LCBjdXRvZmZEYXRlOiBEYXRlKTogUHJvbWlzZTx2b2lkPiB7XHJcbiAgICBpZiAoIXBvbGljeS50YWJsZU5hbWUpIHJldHVybjtcclxuXHJcbiAgICBsZXQgZGVsZXRlZENvdW50ID0gMDtcclxuICAgIGxldCBsYXN0RXZhbHVhdGVkS2V5OiBhbnkgPSB1bmRlZmluZWQ7XHJcblxyXG4gICAgZG8ge1xyXG4gICAgICB0cnkge1xyXG4gICAgICAgIGNvbnN0IHNjYW5SZXN1bHQgPSBhd2FpdCB0aGlzLmR5bmFtb0NsaWVudC5zZW5kKG5ldyBEb2NTY2FuQ29tbWFuZCh7XHJcbiAgICAgICAgICBUYWJsZU5hbWU6IHBvbGljeS50YWJsZU5hbWUsXHJcbiAgICAgICAgICBGaWx0ZXJFeHByZXNzaW9uOiBgI2RhdGVGaWVsZCA8IDpjdXRvZmZEYXRlYCxcclxuICAgICAgICAgIEV4cHJlc3Npb25BdHRyaWJ1dGVOYW1lczoge1xyXG4gICAgICAgICAgICAnI2RhdGVGaWVsZCc6IHBvbGljeS5kYXRlRmllbGQsXHJcbiAgICAgICAgICB9LFxyXG4gICAgICAgICAgRXhwcmVzc2lvbkF0dHJpYnV0ZVZhbHVlczoge1xyXG4gICAgICAgICAgICAnOmN1dG9mZkRhdGUnOiBjdXRvZmZEYXRlLnRvSVNPU3RyaW5nKCksXHJcbiAgICAgICAgICB9LFxyXG4gICAgICAgICAgRXhjbHVzaXZlU3RhcnRLZXk6IGxhc3RFdmFsdWF0ZWRLZXksXHJcbiAgICAgICAgICBMaW1pdDogMjUsIC8vIFByb2Nlc3MgaW4gc21hbGwgYmF0Y2hlc1xyXG4gICAgICAgIH0pKTtcclxuXHJcbiAgICAgICAgaWYgKHNjYW5SZXN1bHQuSXRlbXMpIHtcclxuICAgICAgICAgIGZvciAoY29uc3QgaXRlbSBvZiBzY2FuUmVzdWx0Lkl0ZW1zKSB7XHJcbiAgICAgICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgICAgLy8gR2V0IHRoZSBwcmltYXJ5IGtleSBmb3IgZGVsZXRpb25cclxuICAgICAgICAgICAgICBjb25zdCBrZXkgPSB0aGlzLmV4dHJhY3RQcmltYXJ5S2V5KGl0ZW0sIHBvbGljeS50YWJsZU5hbWUpO1xyXG4gICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgIGF3YWl0IHRoaXMuZHluYW1vQ2xpZW50LnNlbmQobmV3IERlbGV0ZUNvbW1hbmQoe1xyXG4gICAgICAgICAgICAgICAgVGFibGVOYW1lOiBwb2xpY3kudGFibGVOYW1lLFxyXG4gICAgICAgICAgICAgICAgS2V5OiBrZXksXHJcbiAgICAgICAgICAgICAgfSkpO1xyXG5cclxuICAgICAgICAgICAgICBkZWxldGVkQ291bnQrKztcclxuXHJcbiAgICAgICAgICAgICAgLy8gTG9nIGRhdGEgZGVsZXRpb25cclxuICAgICAgICAgICAgICBhd2FpdCB0aGlzLmF1ZGl0TG9nZ2VyLmxvZ0RhdGFBY2Nlc3Moe1xyXG4gICAgICAgICAgICAgICAgZXZlbnRUeXBlOiAnREFUQV9NT0RJRklDQVRJT04nLFxyXG4gICAgICAgICAgICAgICAgdXNlcklkOiAnc3lzdGVtJyxcclxuICAgICAgICAgICAgICAgIHJlc291cmNlVHlwZTogcG9saWN5LnJlc291cmNlVHlwZSBhcyBhbnksXHJcbiAgICAgICAgICAgICAgICByZXNvdXJjZUlkOiBrZXkuaWQgfHwga2V5LnRva2VuSWQgfHwgJ3Vua25vd24nLFxyXG4gICAgICAgICAgICAgICAgYWN0aW9uOiAnREVMRVRFJyxcclxuICAgICAgICAgICAgICAgIG1ldGFkYXRhOiB7XHJcbiAgICAgICAgICAgICAgICAgIHJlYXNvbjogJ0RhdGEgcmV0ZW50aW9uIHBvbGljeScsXHJcbiAgICAgICAgICAgICAgICAgIHBvbGljeTogcG9saWN5LnJlc291cmNlVHlwZSxcclxuICAgICAgICAgICAgICAgICAgcmV0ZW50aW9uRGF5czogcG9saWN5LnJldGVudGlvbkRheXMsXHJcbiAgICAgICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICAgIH0pO1xyXG5cclxuICAgICAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKGBGYWlsZWQgdG8gZGVsZXRlIGl0ZW0gZnJvbSAke3BvbGljeS50YWJsZU5hbWV9OmAsIGVycm9yKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgbGFzdEV2YWx1YXRlZEtleSA9IHNjYW5SZXN1bHQuTGFzdEV2YWx1YXRlZEtleTtcclxuXHJcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgY29uc29sZS5lcnJvcihgRmFpbGVkIHRvIHNjYW4gJHtwb2xpY3kudGFibGVOYW1lfTpgLCBlcnJvcik7XHJcbiAgICAgICAgYnJlYWs7XHJcbiAgICAgIH1cclxuXHJcbiAgICB9IHdoaWxlIChsYXN0RXZhbHVhdGVkS2V5KTtcclxuXHJcbiAgICBjb25zb2xlLmxvZyhgRGVsZXRlZCAke2RlbGV0ZWRDb3VudH0gaXRlbXMgZnJvbSAke3BvbGljeS50YWJsZU5hbWV9YCk7XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBDbGVhbiB1cCBleHBpcmVkIG9iamVjdHMgZnJvbSBTMyBidWNrZXRcclxuICAgKi9cclxuICBwcml2YXRlIGFzeW5jIGNsZWFudXBTM0J1Y2tldChwb2xpY3k6IFJldGVudGlvblBvbGljeSwgY3V0b2ZmRGF0ZTogRGF0ZSk6IFByb21pc2U8dm9pZD4ge1xyXG4gICAgaWYgKCFwb2xpY3kuYnVja2V0TmFtZSkgcmV0dXJuO1xyXG5cclxuICAgIGxldCBkZWxldGVkQ291bnQgPSAwO1xyXG4gICAgbGV0IGNvbnRpbnVhdGlvblRva2VuOiBzdHJpbmcgfCB1bmRlZmluZWQ7XHJcblxyXG4gICAgZG8ge1xyXG4gICAgICB0cnkge1xyXG4gICAgICAgIGNvbnN0IGxpc3RSZXN1bHQgPSBhd2FpdCB0aGlzLnMzQ2xpZW50LnNlbmQobmV3IExpc3RPYmplY3RzVjJDb21tYW5kKHtcclxuICAgICAgICAgIEJ1Y2tldDogcG9saWN5LmJ1Y2tldE5hbWUsXHJcbiAgICAgICAgICBDb250aW51YXRpb25Ub2tlbjogY29udGludWF0aW9uVG9rZW4sXHJcbiAgICAgICAgICBNYXhLZXlzOiAxMDAsIC8vIFByb2Nlc3MgaW4gYmF0Y2hlc1xyXG4gICAgICAgIH0pKTtcclxuXHJcbiAgICAgICAgaWYgKGxpc3RSZXN1bHQuQ29udGVudHMpIHtcclxuICAgICAgICAgIGZvciAoY29uc3Qgb2JqZWN0IG9mIGxpc3RSZXN1bHQuQ29udGVudHMpIHtcclxuICAgICAgICAgICAgaWYgKG9iamVjdC5MYXN0TW9kaWZpZWQgJiYgb2JqZWN0Lkxhc3RNb2RpZmllZCA8IGN1dG9mZkRhdGUgJiYgb2JqZWN0LktleSkge1xyXG4gICAgICAgICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgICAgICBhd2FpdCB0aGlzLnMzQ2xpZW50LnNlbmQobmV3IERlbGV0ZU9iamVjdENvbW1hbmQoe1xyXG4gICAgICAgICAgICAgICAgICBCdWNrZXQ6IHBvbGljeS5idWNrZXROYW1lLFxyXG4gICAgICAgICAgICAgICAgICBLZXk6IG9iamVjdC5LZXksXHJcbiAgICAgICAgICAgICAgICB9KSk7XHJcblxyXG4gICAgICAgICAgICAgICAgZGVsZXRlZENvdW50Kys7XHJcblxyXG4gICAgICAgICAgICAgICAgLy8gTG9nIGRhdGEgZGVsZXRpb25cclxuICAgICAgICAgICAgICAgIGF3YWl0IHRoaXMuYXVkaXRMb2dnZXIubG9nRGF0YUFjY2Vzcyh7XHJcbiAgICAgICAgICAgICAgICAgIGV2ZW50VHlwZTogJ0RBVEFfTU9ESUZJQ0FUSU9OJyxcclxuICAgICAgICAgICAgICAgICAgdXNlcklkOiAnc3lzdGVtJyxcclxuICAgICAgICAgICAgICAgICAgcmVzb3VyY2VUeXBlOiBwb2xpY3kucmVzb3VyY2VUeXBlIGFzIGFueSxcclxuICAgICAgICAgICAgICAgICAgcmVzb3VyY2VJZDogb2JqZWN0LktleSxcclxuICAgICAgICAgICAgICAgICAgYWN0aW9uOiAnREVMRVRFJyxcclxuICAgICAgICAgICAgICAgICAgbWV0YWRhdGE6IHtcclxuICAgICAgICAgICAgICAgICAgICByZWFzb246ICdEYXRhIHJldGVudGlvbiBwb2xpY3knLFxyXG4gICAgICAgICAgICAgICAgICAgIHBvbGljeTogcG9saWN5LnJlc291cmNlVHlwZSxcclxuICAgICAgICAgICAgICAgICAgICByZXRlbnRpb25EYXlzOiBwb2xpY3kucmV0ZW50aW9uRGF5cyxcclxuICAgICAgICAgICAgICAgICAgICBsYXN0TW9kaWZpZWQ6IG9iamVjdC5MYXN0TW9kaWZpZWQudG9JU09TdHJpbmcoKSxcclxuICAgICAgICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgICAgIH0pO1xyXG5cclxuICAgICAgICAgICAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcihgRmFpbGVkIHRvIGRlbGV0ZSBvYmplY3QgJHtvYmplY3QuS2V5fSBmcm9tICR7cG9saWN5LmJ1Y2tldE5hbWV9OmAsIGVycm9yKTtcclxuICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgIH1cclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGNvbnRpbnVhdGlvblRva2VuID0gbGlzdFJlc3VsdC5OZXh0Q29udGludWF0aW9uVG9rZW47XHJcblxyXG4gICAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICAgIGNvbnNvbGUuZXJyb3IoYEZhaWxlZCB0byBsaXN0IG9iamVjdHMgaW4gJHtwb2xpY3kuYnVja2V0TmFtZX06YCwgZXJyb3IpO1xyXG4gICAgICAgIGJyZWFrO1xyXG4gICAgICB9XHJcblxyXG4gICAgfSB3aGlsZSAoY29udGludWF0aW9uVG9rZW4pO1xyXG5cclxuICAgIGNvbnNvbGUubG9nKGBEZWxldGVkICR7ZGVsZXRlZENvdW50fSBvYmplY3RzIGZyb20gJHtwb2xpY3kuYnVja2V0TmFtZX1gKTtcclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIEV4dHJhY3QgcHJpbWFyeSBrZXkgZnJvbSBEeW5hbW9EQiBpdGVtXHJcbiAgICovXHJcbiAgcHJpdmF0ZSBleHRyYWN0UHJpbWFyeUtleShpdGVtOiBhbnksIHRhYmxlTmFtZTogc3RyaW5nKTogYW55IHtcclxuICAgIC8vIFRoaXMgaXMgYSBzaW1wbGlmaWVkIGFwcHJvYWNoIC0gaW4gYSByZWFsIGltcGxlbWVudGF0aW9uLFxyXG4gICAgLy8geW91J2QgbmVlZCB0byBrbm93IHRoZSBleGFjdCBrZXkgc2NoZW1hIGZvciBlYWNoIHRhYmxlXHJcbiAgICBpZiAodGFibGVOYW1lLmluY2x1ZGVzKCdjb250ZW50JykpIHtcclxuICAgICAgcmV0dXJuIHsgaWQ6IGl0ZW0uaWQgfTtcclxuICAgIH0gZWxzZSBpZiAodGFibGVOYW1lLmluY2x1ZGVzKCd1c2VyJykpIHtcclxuICAgICAgcmV0dXJuIHsgaWQ6IGl0ZW0uaWQgfTtcclxuICAgIH0gZWxzZSBpZiAodGFibGVOYW1lLmluY2x1ZGVzKCd0b2tlbicpKSB7XHJcbiAgICAgIHJldHVybiB7IHRva2VuSWQ6IGl0ZW0udG9rZW5JZCB9O1xyXG4gICAgfSBlbHNlIGlmICh0YWJsZU5hbWUuaW5jbHVkZXMoJ2F1ZGl0JykpIHtcclxuICAgICAgcmV0dXJuIHsgaWQ6IGl0ZW0uaWQgfTtcclxuICAgIH0gZWxzZSBpZiAodGFibGVOYW1lLmluY2x1ZGVzKCdwbGF0Zm9ybScpKSB7XHJcbiAgICAgIHJldHVybiB7IHVzZXJJZDogaXRlbS51c2VySWQsIHBsYXRmb3JtOiBpdGVtLnBsYXRmb3JtIH07XHJcbiAgICB9IGVsc2UgaWYgKHRhYmxlTmFtZS5pbmNsdWRlcygnb2F1dGgnKSkge1xyXG4gICAgICByZXR1cm4geyBzdGF0ZTogaXRlbS5zdGF0ZSB9O1xyXG4gICAgfSBlbHNlIHtcclxuICAgICAgcmV0dXJuIHsgaWQ6IGl0ZW0uaWQgfTtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIEdldCByZXRlbnRpb24gcG9saWN5IGZvciBhIHJlc291cmNlIHR5cGVcclxuICAgKi9cclxuICBnZXRSZXRlbnRpb25Qb2xpY3kocmVzb3VyY2VUeXBlOiBzdHJpbmcpOiBSZXRlbnRpb25Qb2xpY3kgfCB1bmRlZmluZWQge1xyXG4gICAgcmV0dXJuIHRoaXMuZGVmYXVsdFBvbGljaWVzLmZpbmQocG9saWN5ID0+IHBvbGljeS5yZXNvdXJjZVR5cGUgPT09IHJlc291cmNlVHlwZSk7XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBVcGRhdGUgcmV0ZW50aW9uIHBvbGljeVxyXG4gICAqL1xyXG4gIHVwZGF0ZVJldGVudGlvblBvbGljeShyZXNvdXJjZVR5cGU6IHN0cmluZywgcmV0ZW50aW9uRGF5czogbnVtYmVyKTogdm9pZCB7XHJcbiAgICBjb25zdCBwb2xpY3lJbmRleCA9IHRoaXMuZGVmYXVsdFBvbGljaWVzLmZpbmRJbmRleChwb2xpY3kgPT4gcG9saWN5LnJlc291cmNlVHlwZSA9PT0gcmVzb3VyY2VUeXBlKTtcclxuICAgIGlmIChwb2xpY3lJbmRleCA+PSAwKSB7XHJcbiAgICAgIHRoaXMuZGVmYXVsdFBvbGljaWVzW3BvbGljeUluZGV4XS5yZXRlbnRpb25EYXlzID0gcmV0ZW50aW9uRGF5cztcclxuICAgIH1cclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIFNvZnQgZGVsZXRlIGNvbnRlbnQgKG1hcmsgYXMgZGVsZXRlZCBpbnN0ZWFkIG9mIGltbWVkaWF0ZSBkZWxldGlvbilcclxuICAgKi9cclxuICBhc3luYyBzb2Z0RGVsZXRlQ29udGVudChjb250ZW50SWQ6IHN0cmluZywgdXNlcklkOiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcclxuICAgIGNvbnN0IHRhYmxlTmFtZSA9IHByb2Nlc3MuZW52LkNPTlRFTlRfVEFCTEVfTkFNRTtcclxuICAgIGlmICghdGFibGVOYW1lKSByZXR1cm47XHJcblxyXG4gICAgdHJ5IHtcclxuICAgICAgLy8gVXBkYXRlIGNvbnRlbnQgd2l0aCBkZWxldGlvbiB0aW1lc3RhbXBcclxuICAgICAgYXdhaXQgdGhpcy5keW5hbW9DbGllbnQuc2VuZChuZXcgUHV0Q29tbWFuZCh7XHJcbiAgICAgICAgVGFibGVOYW1lOiB0YWJsZU5hbWUsXHJcbiAgICAgICAgSXRlbToge1xyXG4gICAgICAgICAgaWQ6IGNvbnRlbnRJZCxcclxuICAgICAgICAgIGRlbGV0ZWRBdDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxyXG4gICAgICAgICAgZGVsZXRlZEJ5OiB1c2VySWQsXHJcbiAgICAgICAgICBzdGF0dXM6ICdkZWxldGVkJyxcclxuICAgICAgICB9LFxyXG4gICAgICAgIENvbmRpdGlvbkV4cHJlc3Npb246ICdhdHRyaWJ1dGVfZXhpc3RzKGlkKScsXHJcbiAgICAgIH0pKTtcclxuXHJcbiAgICAgIGF3YWl0IHRoaXMuYXVkaXRMb2dnZXIubG9nRGF0YUFjY2Vzcyh7XHJcbiAgICAgICAgZXZlbnRUeXBlOiAnREFUQV9NT0RJRklDQVRJT04nLFxyXG4gICAgICAgIHVzZXJJZCxcclxuICAgICAgICByZXNvdXJjZVR5cGU6ICdjb250ZW50JyxcclxuICAgICAgICByZXNvdXJjZUlkOiBjb250ZW50SWQsXHJcbiAgICAgICAgYWN0aW9uOiAnREVMRVRFJyxcclxuICAgICAgICBtZXRhZGF0YToge1xyXG4gICAgICAgICAgdHlwZTogJ3NvZnRfZGVsZXRlJyxcclxuICAgICAgICB9LFxyXG4gICAgICB9KTtcclxuXHJcbiAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICBjb25zb2xlLmVycm9yKGBGYWlsZWQgdG8gc29mdCBkZWxldGUgY29udGVudCAke2NvbnRlbnRJZH06YCwgZXJyb3IpO1xyXG4gICAgICB0aHJvdyBlcnJvcjtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIFJlc3RvcmUgc29mdC1kZWxldGVkIGNvbnRlbnRcclxuICAgKi9cclxuICBhc3luYyByZXN0b3JlQ29udGVudChjb250ZW50SWQ6IHN0cmluZywgdXNlcklkOiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcclxuICAgIGNvbnN0IHRhYmxlTmFtZSA9IHByb2Nlc3MuZW52LkNPTlRFTlRfVEFCTEVfTkFNRTtcclxuICAgIGlmICghdGFibGVOYW1lKSByZXR1cm47XHJcblxyXG4gICAgdHJ5IHtcclxuICAgICAgLy8gUmVtb3ZlIGRlbGV0aW9uIHRpbWVzdGFtcCBhbmQgcmVzdG9yZSBzdGF0dXNcclxuICAgICAgYXdhaXQgdGhpcy5keW5hbW9DbGllbnQuc2VuZChuZXcgVXBkYXRlQ29tbWFuZCh7XHJcbiAgICAgICAgVGFibGVOYW1lOiB0YWJsZU5hbWUsXHJcbiAgICAgICAgS2V5OiB7IGlkOiBjb250ZW50SWQgfSxcclxuICAgICAgICBVcGRhdGVFeHByZXNzaW9uOiAnUkVNT1ZFIGRlbGV0ZWRBdCwgZGVsZXRlZEJ5IFNFVCAjc3RhdHVzID0gOnN0YXR1cycsXHJcbiAgICAgICAgRXhwcmVzc2lvbkF0dHJpYnV0ZU5hbWVzOiB7XHJcbiAgICAgICAgICAnI3N0YXR1cyc6ICdzdGF0dXMnLFxyXG4gICAgICAgIH0sXHJcbiAgICAgICAgRXhwcmVzc2lvbkF0dHJpYnV0ZVZhbHVlczoge1xyXG4gICAgICAgICAgJzpzdGF0dXMnOiAnZHJhZnQnLFxyXG4gICAgICAgIH0sXHJcbiAgICAgICAgQ29uZGl0aW9uRXhwcmVzc2lvbjogJ2F0dHJpYnV0ZV9leGlzdHMoZGVsZXRlZEF0KScsXHJcbiAgICAgIH0pKTtcclxuXHJcbiAgICAgIGF3YWl0IHRoaXMuYXVkaXRMb2dnZXIubG9nRGF0YUFjY2Vzcyh7XHJcbiAgICAgICAgZXZlbnRUeXBlOiAnREFUQV9NT0RJRklDQVRJT04nLFxyXG4gICAgICAgIHVzZXJJZCxcclxuICAgICAgICByZXNvdXJjZVR5cGU6ICdjb250ZW50JyxcclxuICAgICAgICByZXNvdXJjZUlkOiBjb250ZW50SWQsXHJcbiAgICAgICAgYWN0aW9uOiAnVVBEQVRFJyxcclxuICAgICAgICBtZXRhZGF0YToge1xyXG4gICAgICAgICAgdHlwZTogJ3Jlc3RvcmUnLFxyXG4gICAgICAgIH0sXHJcbiAgICAgIH0pO1xyXG5cclxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoYEZhaWxlZCB0byByZXN0b3JlIGNvbnRlbnQgJHtjb250ZW50SWR9OmAsIGVycm9yKTtcclxuICAgICAgdGhyb3cgZXJyb3I7XHJcbiAgICB9XHJcbiAgfVxyXG59Il19