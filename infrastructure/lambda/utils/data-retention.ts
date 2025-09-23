import { DynamoDBClient, ScanCommand, DeleteItemCommand } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand as DocScanCommand, DeleteCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, ListObjectsV2Command, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { AuditLogger } from './audit-logger';

export interface RetentionPolicy {
  resourceType: 'content' | 'user' | 'audio' | 'image' | 'audit' | 'tokens';
  retentionDays: number;
  tableName?: string;
  bucketName?: string;
  dateField: string;
}

export class DataRetentionService {
  private readonly dynamoClient: DynamoDBDocumentClient;
  private readonly s3Client: S3Client;
  private readonly auditLogger: AuditLogger;

  // Default retention policies (can be overridden via environment variables)
  private readonly defaultPolicies: RetentionPolicy[] = [
    {
      resourceType: 'audio',
      retentionDays: 7, // Audio files deleted after 7 days
      bucketName: process.env.AUDIO_BUCKET_NAME,
      dateField: 'lastModified',
    },
    {
      resourceType: 'content',
      retentionDays: 365, // Content kept for 1 year after deletion
      tableName: process.env.CONTENT_TABLE_NAME,
      dateField: 'deletedAt',
    },
    {
      resourceType: 'audit',
      retentionDays: 365, // Audit logs kept for 1 year
      tableName: process.env.AUDIT_TABLE_NAME,
      dateField: 'timestamp',
    },
    {
      resourceType: 'tokens',
      retentionDays: 30, // Revoked tokens kept for 30 days
      tableName: process.env.TOKENS_TABLE_NAME,
      dateField: 'revokedAt',
    },
    {
      resourceType: 'image',
      retentionDays: 90, // Images moved to Glacier after 90 days (handled by S3 lifecycle)
      bucketName: process.env.IMAGE_BUCKET_NAME,
      dateField: 'lastModified',
    },
  ];

  constructor() {
    const client = new DynamoDBClient({});
    this.dynamoClient = DynamoDBDocumentClient.from(client);
    this.s3Client = new S3Client({});
    this.auditLogger = new AuditLogger();
  }

  /**
   * Apply all retention policies
   */
  async applyRetentionPolicies(): Promise<void> {
    console.log('Starting data retention cleanup...');

    for (const policy of this.defaultPolicies) {
      try {
        await this.applyRetentionPolicy(policy);
      } catch (error) {
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
  async applyRetentionPolicy(policy: RetentionPolicy): Promise<void> {
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
  private async cleanupDynamoDBTable(policy: RetentionPolicy, cutoffDate: Date): Promise<void> {
    if (!policy.tableName) return;

    let deletedCount = 0;
    let lastEvaluatedKey: any = undefined;

    do {
      try {
        const scanResult = await this.dynamoClient.send(new DocScanCommand({
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
              
              await this.dynamoClient.send(new DeleteCommand({
                TableName: policy.tableName,
                Key: key,
              }));

              deletedCount++;

              // Log data deletion
              await this.auditLogger.logDataAccess({
                eventType: 'DATA_MODIFICATION',
                userId: 'system',
                resourceType: policy.resourceType as any,
                resourceId: key.id || key.tokenId || 'unknown',
                action: 'DELETE',
                metadata: {
                  reason: 'Data retention policy',
                  policy: policy.resourceType,
                  retentionDays: policy.retentionDays,
                },
              });

            } catch (error) {
              console.error(`Failed to delete item from ${policy.tableName}:`, error);
            }
          }
        }

        lastEvaluatedKey = scanResult.LastEvaluatedKey;

      } catch (error) {
        console.error(`Failed to scan ${policy.tableName}:`, error);
        break;
      }

    } while (lastEvaluatedKey);

    console.log(`Deleted ${deletedCount} items from ${policy.tableName}`);
  }

  /**
   * Clean up expired objects from S3 bucket
   */
  private async cleanupS3Bucket(policy: RetentionPolicy, cutoffDate: Date): Promise<void> {
    if (!policy.bucketName) return;

    let deletedCount = 0;
    let continuationToken: string | undefined;

    do {
      try {
        const listResult = await this.s3Client.send(new ListObjectsV2Command({
          Bucket: policy.bucketName,
          ContinuationToken: continuationToken,
          MaxKeys: 100, // Process in batches
        }));

        if (listResult.Contents) {
          for (const object of listResult.Contents) {
            if (object.LastModified && object.LastModified < cutoffDate && object.Key) {
              try {
                await this.s3Client.send(new DeleteObjectCommand({
                  Bucket: policy.bucketName,
                  Key: object.Key,
                }));

                deletedCount++;

                // Log data deletion
                await this.auditLogger.logDataAccess({
                  eventType: 'DATA_MODIFICATION',
                  userId: 'system',
                  resourceType: policy.resourceType as any,
                  resourceId: object.Key,
                  action: 'DELETE',
                  metadata: {
                    reason: 'Data retention policy',
                    policy: policy.resourceType,
                    retentionDays: policy.retentionDays,
                    lastModified: object.LastModified.toISOString(),
                  },
                });

              } catch (error) {
                console.error(`Failed to delete object ${object.Key} from ${policy.bucketName}:`, error);
              }
            }
          }
        }

        continuationToken = listResult.NextContinuationToken;

      } catch (error) {
        console.error(`Failed to list objects in ${policy.bucketName}:`, error);
        break;
      }

    } while (continuationToken);

    console.log(`Deleted ${deletedCount} objects from ${policy.bucketName}`);
  }

  /**
   * Extract primary key from DynamoDB item
   */
  private extractPrimaryKey(item: any, tableName: string): any {
    // This is a simplified approach - in a real implementation,
    // you'd need to know the exact key schema for each table
    if (tableName.includes('content')) {
      return { id: item.id };
    } else if (tableName.includes('user')) {
      return { id: item.id };
    } else if (tableName.includes('token')) {
      return { tokenId: item.tokenId };
    } else if (tableName.includes('audit')) {
      return { id: item.id };
    } else if (tableName.includes('platform')) {
      return { userId: item.userId, platform: item.platform };
    } else if (tableName.includes('oauth')) {
      return { state: item.state };
    } else {
      return { id: item.id };
    }
  }

  /**
   * Get retention policy for a resource type
   */
  getRetentionPolicy(resourceType: string): RetentionPolicy | undefined {
    return this.defaultPolicies.find(policy => policy.resourceType === resourceType);
  }

  /**
   * Update retention policy
   */
  updateRetentionPolicy(resourceType: string, retentionDays: number): void {
    const policyIndex = this.defaultPolicies.findIndex(policy => policy.resourceType === resourceType);
    if (policyIndex >= 0) {
      this.defaultPolicies[policyIndex].retentionDays = retentionDays;
    }
  }

  /**
   * Soft delete content (mark as deleted instead of immediate deletion)
   */
  async softDeleteContent(contentId: string, userId: string): Promise<void> {
    const tableName = process.env.CONTENT_TABLE_NAME;
    if (!tableName) return;

    try {
      // Update content with deletion timestamp
      await this.dynamoClient.send(new PutCommand({
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

    } catch (error) {
      console.error(`Failed to soft delete content ${contentId}:`, error);
      throw error;
    }
  }

  /**
   * Restore soft-deleted content
   */
  async restoreContent(contentId: string, userId: string): Promise<void> {
    const tableName = process.env.CONTENT_TABLE_NAME;
    if (!tableName) return;

    try {
      // Remove deletion timestamp and restore status
      await this.dynamoClient.send(new UpdateCommand({
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

    } catch (error) {
      console.error(`Failed to restore content ${contentId}:`, error);
      throw error;
    }
  }
}