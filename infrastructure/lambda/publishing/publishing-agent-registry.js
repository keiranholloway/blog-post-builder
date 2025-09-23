"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.publishingRegistry = exports.PublishingAgentRegistry = void 0;
const medium_agent_1 = require("./medium-agent");
const linkedin_agent_1 = require("./linkedin-agent");
class PublishingAgentRegistry {
    constructor() {
        this.agents = new Map();
        this.registerDefaultAgents();
    }
    static getInstance() {
        if (!PublishingAgentRegistry.instance) {
            PublishingAgentRegistry.instance = new PublishingAgentRegistry();
        }
        return PublishingAgentRegistry.instance;
    }
    registerDefaultAgents() {
        // Register built-in agents
        this.registerAgent('medium', new medium_agent_1.MediumPublishingAgent(), true);
        this.registerAgent('linkedin', new linkedin_agent_1.LinkedInPublishingAgent(), true);
    }
    registerAgent(platformName, agent, isEnabled = true, configuration) {
        this.agents.set(platformName.toLowerCase(), {
            name: platformName,
            agent,
            isEnabled,
            configuration
        });
    }
    unregisterAgent(platformName) {
        return this.agents.delete(platformName.toLowerCase());
    }
    getAgent(platformName) {
        const plugin = this.agents.get(platformName.toLowerCase());
        return plugin?.isEnabled ? plugin.agent : null;
    }
    getAllAgents() {
        return Array.from(this.agents.values());
    }
    getEnabledAgents() {
        return Array.from(this.agents.values()).filter(plugin => plugin.isEnabled);
    }
    enableAgent(platformName) {
        const plugin = this.agents.get(platformName.toLowerCase());
        if (plugin) {
            plugin.isEnabled = true;
            return true;
        }
        return false;
    }
    disableAgent(platformName) {
        const plugin = this.agents.get(platformName.toLowerCase());
        if (plugin) {
            plugin.isEnabled = false;
            return true;
        }
        return false;
    }
    async validateCredentials(platformName, credentials) {
        const agent = this.getAgent(platformName);
        if (!agent) {
            throw new Error(`Publishing agent not found for platform: ${platformName}`);
        }
        return agent.validateCredentials(credentials);
    }
    async formatContent(platformName, content, imageUrl) {
        const agent = this.getAgent(platformName);
        if (!agent) {
            throw new Error(`Publishing agent not found for platform: ${platformName}`);
        }
        return agent.formatContent(content, imageUrl);
    }
    async publish(platformName, content, config, imageUrl) {
        const agent = this.getAgent(platformName);
        if (!agent) {
            throw new Error(`Publishing agent not found for platform: ${platformName}`);
        }
        try {
            const formattedContent = await agent.formatContent(content, imageUrl);
            return await agent.publish(formattedContent, config);
        }
        catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error occurred'
            };
        }
    }
    async publishToMultiplePlatforms(platforms, content, configs, imageUrl) {
        const results = new Map();
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
            }
            catch (error) {
                results.set(platform, {
                    success: false,
                    error: error instanceof Error ? error.message : 'Unknown error occurred'
                });
            }
        });
        await Promise.all(publishPromises);
        return results;
    }
    async getPublishingStatus(platformName, platformId, config) {
        const agent = this.getAgent(platformName);
        if (!agent) {
            throw new Error(`Publishing agent not found for platform: ${platformName}`);
        }
        return agent.getPublishingStatus(platformId, config);
    }
    getSupportedPlatforms() {
        return this.getEnabledAgents().map(plugin => plugin.name);
    }
    getPlatformFeatures(platformName) {
        const agent = this.getAgent(platformName);
        return agent?.supportedFeatures || [];
    }
    updateAgentConfiguration(platformName, configuration) {
        const plugin = this.agents.get(platformName.toLowerCase());
        if (plugin) {
            plugin.configuration = { ...plugin.configuration, ...configuration };
            return true;
        }
        return false;
    }
}
exports.PublishingAgentRegistry = PublishingAgentRegistry;
// Export singleton instance
exports.publishingRegistry = PublishingAgentRegistry.getInstance();
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicHVibGlzaGluZy1hZ2VudC1yZWdpc3RyeS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbInB1Ymxpc2hpbmctYWdlbnQtcmVnaXN0cnkudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBQ0EsaURBQXVEO0FBQ3ZELHFEQUEyRDtBQVUzRCxNQUFhLHVCQUF1QjtJQUlsQztRQUhRLFdBQU0sR0FBdUMsSUFBSSxHQUFHLEVBQUUsQ0FBQztRQUk3RCxJQUFJLENBQUMscUJBQXFCLEVBQUUsQ0FBQztJQUMvQixDQUFDO0lBRUQsTUFBTSxDQUFDLFdBQVc7UUFDaEIsSUFBSSxDQUFDLHVCQUF1QixDQUFDLFFBQVEsRUFBRTtZQUNyQyx1QkFBdUIsQ0FBQyxRQUFRLEdBQUcsSUFBSSx1QkFBdUIsRUFBRSxDQUFDO1NBQ2xFO1FBQ0QsT0FBTyx1QkFBdUIsQ0FBQyxRQUFRLENBQUM7SUFDMUMsQ0FBQztJQUVPLHFCQUFxQjtRQUMzQiwyQkFBMkI7UUFDM0IsSUFBSSxDQUFDLGFBQWEsQ0FBQyxRQUFRLEVBQUUsSUFBSSxvQ0FBcUIsRUFBRSxFQUFFLElBQUksQ0FBQyxDQUFDO1FBQ2hFLElBQUksQ0FBQyxhQUFhLENBQUMsVUFBVSxFQUFFLElBQUksd0NBQXVCLEVBQUUsRUFBRSxJQUFJLENBQUMsQ0FBQztJQUN0RSxDQUFDO0lBRUQsYUFBYSxDQUFDLFlBQW9CLEVBQUUsS0FBc0IsRUFBRSxZQUFxQixJQUFJLEVBQUUsYUFBbUM7UUFDeEgsSUFBSSxDQUFDLE1BQU0sQ0FBQyxHQUFHLENBQUMsWUFBWSxDQUFDLFdBQVcsRUFBRSxFQUFFO1lBQzFDLElBQUksRUFBRSxZQUFZO1lBQ2xCLEtBQUs7WUFDTCxTQUFTO1lBQ1QsYUFBYTtTQUNkLENBQUMsQ0FBQztJQUNMLENBQUM7SUFFRCxlQUFlLENBQUMsWUFBb0I7UUFDbEMsT0FBTyxJQUFJLENBQUMsTUFBTSxDQUFDLE1BQU0sQ0FBQyxZQUFZLENBQUMsV0FBVyxFQUFFLENBQUMsQ0FBQztJQUN4RCxD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dCB7IFB1Ymxpc2hpbmdBZ2VudCwgUHVibGlzaGluZ0NvbmZpZywgUHVibGlzaFJlc3VsdCwgRm9ybWF0dGVkQ29udGVudCB9IGZyb20gJy4vYmFzZS1wdWJsaXNoaW5nLWFnZW50JztcclxuaW1wb3J0IHsgTWVkaXVtUHVibGlzaGluZ0FnZW50IH0gZnJvbSAnLi9tZWRpdW0tYWdlbnQnO1xyXG5pbXBvcnQgeyBMaW5rZWRJblB1Ymxpc2hpbmdBZ2VudCB9IGZyb20gJy4vbGlua2VkaW4tYWdlbnQnO1xyXG5pbXBvcnQgeyBCbG9nQ29udGVudCB9IGZyb20gJy4uLy4uLy4uL2Zyb250ZW5kL3NyYy90eXBlcy9CbG9nQ29udGVudCc7XHJcblxyXG5leHBvcnQgaW50ZXJmYWNlIFB1Ymxpc2hpbmdBZ2VudFBsdWdpbiB7XHJcbiAgbmFtZTogc3RyaW5nO1xyXG4gIGFnZW50OiBQdWJsaXNoaW5nQWdlbnQ7XHJcbiAgaXNFbmFibGVkOiBib29sZWFuO1xyXG4gIGNvbmZpZ3VyYXRpb24/OiBSZWNvcmQ8c3RyaW5nLCBhbnk+O1xyXG59XHJcblxyXG5leHBvcnQgY2xhc3MgUHVibGlzaGluZ0FnZW50UmVnaXN0cnkge1xyXG4gIHByaXZhdGUgYWdlbnRzOiBNYXA8c3RyaW5nLCBQdWJsaXNoaW5nQWdlbnRQbHVnaW4+ID0gbmV3IE1hcCgpO1xyXG4gIHByaXZhdGUgc3RhdGljIGluc3RhbmNlOiBQdWJsaXNoaW5nQWdlbnRSZWdpc3RyeTtcclxuXHJcbiAgcHJpdmF0ZSBjb25zdHJ1Y3RvcigpIHtcclxuICAgIHRoaXMucmVnaXN0ZXJEZWZhdWx0QWdlbnRzKCk7XHJcbiAgfVxyXG5cclxuICBzdGF0aWMgZ2V0SW5zdGFuY2UoKTogUHVibGlzaGluZ0FnZW50UmVnaXN0cnkge1xyXG4gICAgaWYgKCFQdWJsaXNoaW5nQWdlbnRSZWdpc3RyeS5pbnN0YW5jZSkge1xyXG4gICAgICBQdWJsaXNoaW5nQWdlbnRSZWdpc3RyeS5pbnN0YW5jZSA9IG5ldyBQdWJsaXNoaW5nQWdlbnRSZWdpc3RyeSgpO1xyXG4gICAgfVxyXG4gICAgcmV0dXJuIFB1Ymxpc2hpbmdBZ2VudFJlZ2lzdHJ5Lmluc3RhbmNlO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSByZWdpc3RlckRlZmF1bHRBZ2VudHMoKTogdm9pZCB7XHJcbiAgICAvLyBSZWdpc3RlciBidWlsdC1pbiBhZ2VudHNcclxuICAgIHRoaXMucmVnaXN0ZXJBZ2VudCgnbWVkaXVtJywgbmV3IE1lZGl1bVB1Ymxpc2hpbmdBZ2VudCgpLCB0cnVlKTtcclxuICAgIHRoaXMucmVnaXN0ZXJBZ2VudCgnbGlua2VkaW4nLCBuZXcgTGlua2VkSW5QdWJsaXNoaW5nQWdlbnQoKSwgdHJ1ZSk7XHJcbiAgfVxyXG5cclxuICByZWdpc3RlckFnZW50KHBsYXRmb3JtTmFtZTogc3RyaW5nLCBhZ2VudDogUHVibGlzaGluZ0FnZW50LCBpc0VuYWJsZWQ6IGJvb2xlYW4gPSB0cnVlLCBjb25maWd1cmF0aW9uPzogUmVjb3JkPHN0cmluZywgYW55Pik6IHZvaWQge1xyXG4gICAgdGhpcy5hZ2VudHMuc2V0KHBsYXRmb3JtTmFtZS50b0xvd2VyQ2FzZSgpLCB7XHJcbiAgICAgIG5hbWU6IHBsYXRmb3JtTmFtZSxcclxuICAgICAgYWdlbnQsXHJcbiAgICAgIGlzRW5hYmxlZCxcclxuICAgICAgY29uZmlndXJhdGlvblxyXG4gICAgfSk7XHJcbiAgfVxyXG5cclxuICB1bnJlZ2lzdGVyQWdlbnQocGxhdGZvcm1OYW1lOiBzdHJpbmcpOiBib29sZWFuIHtcclxuICAgIHJldHVybiB0aGlzLmFnZW50cy5kZWxldGUocGxhdGZvcm1OYW1lLnRvTG93ZXJDYXNlKCkpO1xyXG4gIH1cclxuXHJcbiAgZ2V0QWdlbnQocGxhdGZvcm1OYW1lOiBzdHJpbmcpOiBQdWJsaXNoaW5nQWdlbnQgfCBudWxsIHtcclxuICAgIGNvbnN0IHBsdWdpbiA9IHRoaXMuYWdlbnRzLmdldChwbGF0Zm9ybU5hbWUudG9Mb3dlckNhc2UoKSk7XHJcbiAgICByZXR1cm4gcGx1Z2luPy5pc0VuYWJsZWQgPyBwbHVnaW4uYWdlbnQgOiBudWxsO1xyXG4gIH1cclxuXHJcbiAgZ2V0QWxsQWdlbnRzKCk6IFB1Ymxpc2hpbmdBZ2VudFBsdWdpbltdIHtcclxuICAgIHJldHVybiBBcnJheS5mcm9tKHRoaXMuYWdlbnRzLnZhbHVlcygpKTtcclxuICB9XHJcblxyXG4gIGdldEVuYWJsZWRBZ2VudHMoKTogUHVibGlzaGluZ0FnZW50UGx1Z2luW10ge1xyXG4gICAgcmV0dXJuIEFycmF5LmZyb20odGhpcy5hZ2VudHMudmFsdWVzKCkpLmZpbHRlcihwbHVnaW4gPT4gcGx1Z2luLmlzRW5hYmxlZCk7XHJcbiAgfVxyXG5cclxuICBlbmFibGVBZ2VudChwbGF0Zm9ybU5hbWU6IHN0cmluZyk6IGJvb2xlYW4ge1xyXG4gICAgY29uc3QgcGx1Z2luID0gdGhpcy5hZ2VudHMuZ2V0KHBsYXRmb3JtTmFtZS50b0xvd2VyQ2FzZSgpKTtcclxuICAgIGlmIChwbHVnaW4pIHtcclxuICAgICAgcGx1Z2luLmlzRW5hYmxlZCA9IHRydWU7XHJcbiAgICAgIHJldHVybiB0cnVlO1xyXG4gICAgfVxyXG4gICAgcmV0dXJuIGZhbHNlO1xyXG4gIH1cclxuXHJcbiAgZGlzYWJsZUFnZW50KHBsYXRmb3JtTmFtZTogc3RyaW5nKTogYm9vbGVhbiB7XHJcbiAgICBjb25zdCBwbHVnaW4gPSB0aGlzLmFnZW50cy5nZXQocGxhdGZvcm1OYW1lLnRvTG93ZXJDYXNlKCkpO1xyXG4gICAgaWYgKHBsdWdpbikge1xyXG4gICAgICBwbHVnaW4uaXNFbmFibGVkID0gZmFsc2U7XHJcbiAgICAgIHJldHVybiB0cnVlO1xyXG4gICAgfVxyXG4gICAgcmV0dXJuIGZhbHNlO1xyXG4gIH1cclxuXHJcbiAgYXN5bmMgdmFsaWRhdGVDcmVkZW50aWFscyhwbGF0Zm9ybU5hbWU6IHN0cmluZywgY3JlZGVudGlhbHM6IFJlY29yZDxzdHJpbmcsIGFueT4pOiBQcm9taXNlPGJvb2xlYW4+IHtcclxuICAgIGNvbnN0IGFnZW50ID0gdGhpcy5nZXRBZ2VudChwbGF0Zm9ybU5hbWUpO1xyXG4gICAgaWYgKCFhZ2VudCkge1xyXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYFB1Ymxpc2hpbmcgYWdlbnQgbm90IGZvdW5kIGZvciBwbGF0Zm9ybTogJHtwbGF0Zm9ybU5hbWV9YCk7XHJcbiAgICB9XHJcbiAgICByZXR1cm4gYWdlbnQudmFsaWRhdGVDcmVkZW50aWFscyhjcmVkZW50aWFscyk7XHJcbiAgfVxyXG5cclxuICBhc3luYyBmb3JtYXRDb250ZW50KHBsYXRmb3JtTmFtZTogc3RyaW5nLCBjb250ZW50OiBCbG9nQ29udGVudCwgaW1hZ2VVcmw/OiBzdHJpbmcpOiBQcm9taXNlPEZvcm1hdHRlZENvbnRlbnQ+IHtcclxuICAgIGNvbnN0IGFnZW50ID0gdGhpcy5nZXRBZ2VudChwbGF0Zm9ybU5hbWUpO1xyXG4gICAgaWYgKCFhZ2VudCkge1xyXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYFB1Ymxpc2hpbmcgYWdlbnQgbm90IGZvdW5kIGZvciBwbGF0Zm9ybTogJHtwbGF0Zm9ybU5hbWV9YCk7XHJcbiAgICB9XHJcbiAgICByZXR1cm4gYWdlbnQuZm9ybWF0Q29udGVudChjb250ZW50LCBpbWFnZVVybCk7XHJcbiAgfVxyXG5cclxuICBhc3luYyBwdWJsaXNoKHBsYXRmb3JtTmFtZTogc3RyaW5nLCBjb250ZW50OiBCbG9nQ29udGVudCwgY29uZmlnOiBQdWJsaXNoaW5nQ29uZmlnLCBpbWFnZVVybD86IHN0cmluZyk6IFByb21pc2U8UHVibGlzaFJlc3VsdD4ge1xyXG4gICAgY29uc3QgYWdlbnQgPSB0aGlzLmdldEFnZW50KHBsYXRmb3JtTmFtZSk7XHJcbiAgICBpZiAoIWFnZW50KSB7XHJcbiAgICAgIHRocm93IG5ldyBFcnJvcihgUHVibGlzaGluZyBhZ2VudCBub3QgZm91bmQgZm9yIHBsYXRmb3JtOiAke3BsYXRmb3JtTmFtZX1gKTtcclxuICAgIH1cclxuXHJcbiAgICB0cnkge1xyXG4gICAgICBjb25zdCBmb3JtYXR0ZWRDb250ZW50ID0gYXdhaXQgYWdlbnQuZm9ybWF0Q29udGVudChjb250ZW50LCBpbWFnZVVybCk7XHJcbiAgICAgIHJldHVybiBhd2FpdCBhZ2VudC5wdWJsaXNoKGZvcm1hdHRlZENvbnRlbnQsIGNvbmZpZyk7XHJcbiAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICByZXR1cm4ge1xyXG4gICAgICAgIHN1Y2Nlc3M6IGZhbHNlLFxyXG4gICAgICAgIGVycm9yOiBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6ICdVbmtub3duIGVycm9yIG9jY3VycmVkJ1xyXG4gICAgICB9O1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgYXN5bmMgcHVibGlzaFRvTXVsdGlwbGVQbGF0Zm9ybXMoXHJcbiAgICBwbGF0Zm9ybXM6IHN0cmluZ1tdLCBcclxuICAgIGNvbnRlbnQ6IEJsb2dDb250ZW50LCBcclxuICAgIGNvbmZpZ3M6IE1hcDxzdHJpbmcsIFB1Ymxpc2hpbmdDb25maWc+LCBcclxuICAgIGltYWdlVXJsPzogc3RyaW5nXHJcbiAgKTogUHJvbWlzZTxNYXA8c3RyaW5nLCBQdWJsaXNoUmVzdWx0Pj4ge1xyXG4gICAgY29uc3QgcmVzdWx0cyA9IG5ldyBNYXA8c3RyaW5nLCBQdWJsaXNoUmVzdWx0PigpO1xyXG4gICAgXHJcbiAgICAvLyBQdWJsaXNoIHRvIGFsbCBwbGF0Zm9ybXMgaW4gcGFyYWxsZWxcclxuICAgIGNvbnN0IHB1Ymxpc2hQcm9taXNlcyA9IHBsYXRmb3Jtcy5tYXAoYXN5bmMgKHBsYXRmb3JtKSA9PiB7XHJcbiAgICAgIGNvbnN0IGNvbmZpZyA9IGNvbmZpZ3MuZ2V0KHBsYXRmb3JtKTtcclxuICAgICAgaWYgKCFjb25maWcpIHtcclxuICAgICAgICByZXN1bHRzLnNldChwbGF0Zm9ybSwge1xyXG4gICAgICAgICAgc3VjY2VzczogZmFsc2UsXHJcbiAgICAgICAgICBlcnJvcjogYE5vIGNvbmZpZ3VyYXRpb24gZm91bmQgZm9yIHBsYXRmb3JtOiAke3BsYXRmb3JtfWBcclxuICAgICAgICB9KTtcclxuICAgICAgICByZXR1cm47XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIHRyeSB7XHJcbiAgICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdGhpcy5wdWJsaXNoKHBsYXRmb3JtLCBjb250ZW50LCBjb25maWcsIGltYWdlVXJsKTtcclxuICAgICAgICByZXN1bHRzLnNldChwbGF0Zm9ybSwgcmVzdWx0KTtcclxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICByZXN1bHRzLnNldChwbGF0Zm9ybSwge1xyXG4gICAgICAgICAgc3VjY2VzczogZmFsc2UsXHJcbiAgICAgICAgICBlcnJvcjogZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiAnVW5rbm93biBlcnJvciBvY2N1cnJlZCdcclxuICAgICAgICB9KTtcclxuICAgICAgfVxyXG4gICAgfSk7XHJcblxyXG4gICAgYXdhaXQgUHJvbWlzZS5hbGwocHVibGlzaFByb21pc2VzKTtcclxuICAgIHJldHVybiByZXN1bHRzO1xyXG4gIH1cclxuXHJcbiAgYXN5bmMgZ2V0UHVibGlzaGluZ1N0YXR1cyhwbGF0Zm9ybU5hbWU6IHN0cmluZywgcGxhdGZvcm1JZDogc3RyaW5nLCBjb25maWc6IFB1Ymxpc2hpbmdDb25maWcpOiBQcm9taXNlPCdwdWJsaXNoZWQnIHwgJ2RyYWZ0JyB8ICdmYWlsZWQnIHwgJ3Vua25vd24nPiB7XHJcbiAgICBjb25zdCBhZ2VudCA9IHRoaXMuZ2V0QWdlbnQocGxhdGZvcm1OYW1lKTtcclxuICAgIGlmICghYWdlbnQpIHtcclxuICAgICAgdGhyb3cgbmV3IEVycm9yKGBQdWJsaXNoaW5nIGFnZW50IG5vdCBmb3VuZCBmb3IgcGxhdGZvcm06ICR7cGxhdGZvcm1OYW1lfWApO1xyXG4gICAgfVxyXG4gICAgcmV0dXJuIGFnZW50LmdldFB1Ymxpc2hpbmdTdGF0dXMocGxhdGZvcm1JZCwgY29uZmlnKTtcclxuICB9XHJcblxyXG4gIGdldFN1cHBvcnRlZFBsYXRmb3JtcygpOiBzdHJpbmdbXSB7XHJcbiAgICByZXR1cm4gdGhpcy5nZXRFbmFibGVkQWdlbnRzKCkubWFwKHBsdWdpbiA9PiBwbHVnaW4ubmFtZSk7XHJcbiAgfVxyXG5cclxuICBnZXRQbGF0Zm9ybUZlYXR1cmVzKHBsYXRmb3JtTmFtZTogc3RyaW5nKTogc3RyaW5nW10ge1xyXG4gICAgY29uc3QgYWdlbnQgPSB0aGlzLmdldEFnZW50KHBsYXRmb3JtTmFtZSk7XHJcbiAgICByZXR1cm4gYWdlbnQ/LnN1cHBvcnRlZEZlYXR1cmVzIHx8IFtdO1xyXG4gIH1cclxuXHJcbiAgdXBkYXRlQWdlbnRDb25maWd1cmF0aW9uKHBsYXRmb3JtTmFtZTogc3RyaW5nLCBjb25maWd1cmF0aW9uOiBSZWNvcmQ8c3RyaW5nLCBhbnk+KTogYm9vbGVhbiB7XHJcbiAgICBjb25zdCBwbHVnaW4gPSB0aGlzLmFnZW50cy5nZXQocGxhdGZvcm1OYW1lLnRvTG93ZXJDYXNlKCkpO1xyXG4gICAgaWYgKHBsdWdpbikge1xyXG4gICAgICBwbHVnaW4uY29uZmlndXJhdGlvbiA9IHsgLi4ucGx1Z2luLmNvbmZpZ3VyYXRpb24sIC4uLmNvbmZpZ3VyYXRpb24gfTtcclxuICAgICAgcmV0dXJuIHRydWU7XHJcbiAgICB9XHJcbiAgICByZXR1cm4gZmFsc2U7XHJcbiAgfVxyXG59XHJcblxyXG4vLyBFeHBvcnQgc2luZ2xldG9uIGluc3RhbmNlXHJcbmV4cG9ydCBjb25zdCBwdWJsaXNoaW5nUmVnaXN0cnkgPSBQdWJsaXNoaW5nQWdlbnRSZWdpc3RyeS5nZXRJbnN0YW5jZSgpOyJdfQ==