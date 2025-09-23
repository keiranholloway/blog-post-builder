import { BasePublishingAgent, PublishingConfig, PublishResult, FormattedContent } from './base-publishing-agent';
import { BlogContent } from '../../../frontend/src/types/BlogContent';
export declare class MediumPublishingAgent extends BasePublishingAgent {
    readonly platformName = "Medium";
    readonly supportedFeatures: string[];
    private readonly baseUrl;
    validateCredentials(credentials: Record<string, any>): Promise<boolean>;
    formatContent(content: BlogContent, imageUrl?: string): Promise<FormattedContent>;
    publish(formattedContent: FormattedContent, config: PublishingConfig): Promise<PublishResult>;
    getPublishingStatus(platformId: string, config: PublishingConfig): Promise<'published' | 'draft' | 'failed' | 'unknown'>;
    private formatMarkdownForMedium;
}
