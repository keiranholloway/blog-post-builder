import { PublishingAgent, PublishingConfig, PublishResult, FormattedContent } from './base-publishing-agent';
import { MediumPublishingAgent } from './medium-agent';
import { LinkedInPublishingAgent } from './linkedin-agent';
import { BlogContent } from '../../../frontend/src/types/BlogContent';

export interface PublishingAgentPlugin {
  name: string;
  agent: PublishingAgent;
  isEnabled: boolean;
  configuration?: Record<string, any>;
}

export class PublishingAgentRegistry {
  private agents: Map<string, PublishingAgentPlugin> = new Map();
  private static instance: PublishingAgentRegistry;

  private constructor() {
    this.registerDefaultAgents();
  }

  static getInstance(): PublishingAgentRegistry {
    if (!PublishingAgentRegistry.instance) {
      PublishingAgentRegistry.instance = new PublishingAgentRegistry();
    }
    return PublishingAgentRegistry.instance;
  }

  private registerDefaultAgents(): void {
    // Register built-in agents
    this.registerAgent('medium', new MediumPublishingAgent(), true);
    this.registerAgent('linkedin', new LinkedInPublishingAgent(), true);
  }

  registerAgent(platformName: string, agent: PublishingAgent, isEnabled: boolean = true, configuration?: Record<string, any>): void {
    this.agents.set(platformName.toLowerCase(), {
      name: platformName,
      agent,
      isEnabled,
      configuration
    });
  }

  unregisterAgent(platformName: string): boolean {
    return this.agents.delete(platformName.toLowerCase());
  }

  getAgent(platformName: string): PublishingAgent | null {
    const plugin = this.agents.get(platformName.toLowerCase());
    return plugin?.isEnabled ? plugin.agent : null;
  }

  getAllAgents(): PublishingAgentPlugin[] {
    return Array.from(this.agents.values());
  }

  getEnabledAgents(): PublishingAgentPlugin[] {
    return Array.from(this.agents.values()).filter(plugin => plugin.isEnabled);
  }

  enableAgent(platformName: string): boolean {
    const plugin = this.agents.get(platformName.toLowerCase());
    if (plugin) {
      plugin.isEnabled = true;
      return true;
    }
    return false;
  }

  disableAgent(platformName: string): boolean {
    const plugin = this.agents.get(platformName.toLowerCase());
    if (plugin) {
      plugin.isEnabled = false;
      return true;
    }
    return false;
  }

  async validateCredentials(platformName: string, credentials: Record<string, any>): Promise<boolean> {
    const agent = this.getAgent(platformName);
    if (!agent) {
      throw new Error(`Publishing agent not found for platform: ${platformName}`);
    }
    return agent.validateCredentials(credentials);
  }

  async formatContent(platformName: string, content: BlogContent, imageUrl?: string): Promise<FormattedContent> {
    const agent = this.getAgent(platformName);
    if (!agent) {
      throw new Error(`Publishing agent not found for platform: ${platformName}`);
    }
    return agent.formatContent(content, imageUrl);
  }

  async publish(platformName: string, content: BlogContent, config: PublishingConfig, imageUrl?: string): Promise<PublishResult> {
    const agent = this.getAgent(platformName);
    if (!agent) {
      throw new Error(`Publishing agent not found for platform: ${platformName}`);
    }

    try {
      const formattedContent = await agent.formatContent(content, imageUrl);
      return await agent.publish(formattedContent, config);
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      };
    }
  }

  async publishToMultiplePlatforms(
    platforms: string[], 
    content: BlogContent, 
    configs: Map<string, PublishingConfig>, 
    imageUrl?: string
  ): Promise<Map<string, PublishResult>> {
    const results = new Map<string, PublishResult>();
    
    // Publish to all platforms in parallel
    const publishPromises = platforms.map(async (platform) => {
      const config = configs.get(platform);
      if (!config) {
        results.set(platform, {
          success: false,
          error: `No configuration found for platform: ${platform}`
        });
        return;
      }

      try {
        const result = await this.publish(platform, content, config, imageUrl);
        results.set(platform, result);
      } catch (error) {
        results.set(platform, {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error occurred'
        });
      }
    });

    await Promise.all(publishPromises);
    return results;
  }

  async getPublishingStatus(platformName: string, platformId: string, config: PublishingConfig): Promise<'published' | 'draft' | 'failed' | 'unknown'> {
    const agent = this.getAgent(platformName);
    if (!agent) {
      throw new Error(`Publishing agent not found for platform: ${platformName}`);
    }
    return agent.getPublishingStatus(platformId, config);
  }

  getSupportedPlatforms(): string[] {
    return this.getEnabledAgents().map(plugin => plugin.name);
  }

  getPlatformFeatures(platformName: string): string[] {
    const agent = this.getAgent(platformName);
    return agent?.supportedFeatures || [];
  }

  updateAgentConfiguration(platformName: string, configuration: Record<string, any>): boolean {
    const plugin = this.agents.get(platformName.toLowerCase());
    if (plugin) {
      plugin.configuration = { ...plugin.configuration, ...configuration };
      return true;
    }
    return false;
  }
}

// Export singleton instance
export const publishingRegistry = PublishingAgentRegistry.getInstance();