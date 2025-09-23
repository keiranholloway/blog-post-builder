import { PublishingAgent, PublishingConfig, PublishResult, FormattedContent } from './base-publishing-agent';
import { BlogContent } from '../../../frontend/src/types/BlogContent';
export interface PublishingAgentPlugin {
    name: string;
    agent: PublishingAgent;
    isEnabled: boolean;
    configuration?: Record<string, any>;
}
export declare class PublishingAgentRegistry {
    private agents;
    private static instance;
    private constructor();
    static getInstance(): PublishingAgentRegistry;
    private registerDefaultAgents;
    registerAgent(platformName: string, agent: PublishingAgent, isEnabled?: boolean, configuration?: Record<string, any>): void;
    unregisterAgent(platformName: string): boolean;
    getAgent(platformName: string): PublishingAgent | null;
    getAllAgents(): PublishingAgentPlugin[];
    getEnabledAgents(): PublishingAgentPlugin[];
    enableAgent(platformName: string): boolean;
    disableAgent(platformName: string): boolean;
    validateCredentials(platformName: string, credentials: Record<string, any>): Promise<boolean>;
    formatContent(platformName: string, content: BlogContent, imageUrl?: string): Promise<FormattedContent>;
    publish(platformName: string, content: BlogContent, config: PublishingConfig, imageUrl?: string): Promise<PublishResult>;
    publishToMultiplePlatforms(platforms: string[], content: BlogContent, configs: Map<string, PublishingConfig>, imageUrl?: string): Promise<Map<string, PublishResult>>;
    getPublishingStatus(platformName: string, platformId: string, config: PublishingConfig): Promise<'published' | 'draft' | 'failed' | 'unknown'>;
    getSupportedPlatforms(): string[];
    getPlatformFeatures(platformName: string): string[];
    updateAgentConfiguration(platformName: string, configuration: Record<string, any>): boolean;
}
export declare const publishingRegistry: PublishingAgentRegistry;
