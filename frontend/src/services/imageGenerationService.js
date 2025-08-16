"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.imageGenerationService = void 0;
const api_1 = require("../config/api");
class ImageGenerationService {
    constructor() {
        this.baseUrl = api_1.API_BASE_URL;
    }
    /**
     * Generate an image for blog content
     */
    async generateImage(request) {
        try {
            const response = await fetch(`${this.baseUrl}/api/image/generate`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(request),
            });
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
            }
            return await response.json();
        }
        catch (error) {
            console.error('Error generating image:', error);
            throw error;
        }
    }
    /**
     * Get image generation status
     */
    async getImageStatus(contentId) {
        try {
            const response = await fetch(`${this.baseUrl}/api/image/status/${contentId}`, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                },
            });
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
            }
            return await response.json();
        }
        catch (error) {
            console.error('Error getting image status:', error);
            throw error;
        }
    }
    /**
     * Request image revision with feedback
     */
    async requestImageRevision(contentId, feedback, newPrompt) {
        try {
            const response = await fetch(`${this.baseUrl}/api/image/revise`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    contentId,
                    feedback,
                    newPrompt,
                }),
            });
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
            }
            return await response.json();
        }
        catch (error) {
            console.error('Error requesting image revision:', error);
            throw error;
        }
    }
    /**
     * Analyze content to generate appropriate image prompt
     */
    async analyzeContentForImage(content) {
        try {
            const response = await fetch(`${this.baseUrl}/api/image/analyze`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ content }),
            });
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
            }
            return await response.json();
        }
        catch (error) {
            console.error('Error analyzing content for image:', error);
            throw error;
        }
    }
    /**
     * Poll for image generation status with timeout
     */
    async pollImageStatus(contentId, timeoutMs = 60000, intervalMs = 2000) {
        const startTime = Date.now();
        while (Date.now() - startTime < timeoutMs) {
            const status = await this.getImageStatus(contentId);
            if (status.status === 'completed' || status.status === 'failed') {
                return status;
            }
            await new Promise(resolve => setTimeout(resolve, intervalMs));
        }
        throw new Error('Image generation timeout');
    }
    /**
     * Generate image prompt from blog content
     */
    generateImagePrompt(title, content, style = 'professional') {
        // Extract key themes and concepts from the content
        const words = content.toLowerCase().split(/\s+/);
        const keyWords = words.filter(word => word.length > 4 &&
            !['that', 'this', 'with', 'from', 'they', 'have', 'will', 'been', 'were', 'said', 'each', 'which', 'their', 'time', 'would', 'there', 'could', 'other'].includes(word));
        // Take first few key concepts
        const concepts = keyWords.slice(0, 3).join(', ');
        const stylePrompts = {
            professional: 'clean, modern, professional illustration',
            creative: 'artistic, creative, vibrant illustration',
            minimal: 'minimalist, simple, clean design',
            technical: 'technical diagram, infographic style',
            abstract: 'abstract, conceptual art'
        };
        const selectedStyle = stylePrompts[style] || stylePrompts.professional;
        return `${selectedStyle} representing ${title}, featuring ${concepts}, high quality, detailed`;
    }
}
exports.imageGenerationService = new ImageGenerationService();
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW1hZ2VHZW5lcmF0aW9uU2VydmljZS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbImltYWdlR2VuZXJhdGlvblNlcnZpY2UudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBQUEsdUNBQTZDO0FBdUI3QyxNQUFNLHNCQUFzQjtJQUcxQjtRQUNFLElBQUksQ0FBQyxPQUFPLEdBQUcsa0JBQVksQ0FBQztJQUM5QixDQUFDO0lBRUQ7O09BRUc7SUFDSCxLQUFLLENBQUMsYUFBYSxDQUFDLE9BQStCO1FBQ2pELElBQUk7WUFDRixNQUFNLFFBQVEsR0FBRyxNQUFNLEtBQUssQ0FBQyxHQUFHLElBQUksQ0FBQyxPQUFPLHFCQUFxQixFQUFFO2dCQUNqRSxNQUFNLEVBQUUsTUFBTTtnQkFDZCxPQUFPLEVBQUU7b0JBQ1AsY0FBYyxFQUFFLGtCQUFrQjtpQkFDbkM7Z0JBQ0QsSUFBSSxFQUFFLElBQUksQ0FBQyxTQUFTLENBQUMsT0FBTyxDQUFDO2FBQzlCLENBQUMsQ0FBQztZQUVILElBQUksQ0FBQyxRQUFRLENBQUMsRUFBRSxFQUFFO2dCQUNoQixNQUFNLFNBQVMsR0FBRyxNQUFNLFFBQVEsQ0FBQyxJQUFJLEVBQUUsQ0FBQztnQkFDeEMsTUFBTSxJQUFJLEtBQUssQ0FBQyxTQUFTLENBQUMsS0FBSyxJQUFJLHVCQUF1QixRQUFRLENBQUMsTUFBTSxFQUFFLENBQUMsQ0FBQzthQUM5RTtZQUVELE9BQU8sTUFBTSxRQUFRLENBQUMsSUFBSSxFQUFFLENBQUM7U0FDOUI7UUFBQyxPQUFPLEtBQUssRUFBRTtZQUNkLE9BQU8sQ0FBQyxLQUFLLENBQUMseUJBQXlCLEVBQUUsS0FBSyxDQUFDLENBQUM7WUFDaEQsTUFBTSxLQUFLLENBQUM7U0FDYjtJQUNILENBQUM7SUFFRDs7T0FFRztJQUNILEtBQUssQ0FBQyxjQUFjLENBQUMsU0FBaUI7UUFDcEMsSUFBSTtZQUNGLE1BQU0sUUFBUSxHQUFHLE1BQU0sS0FBSyxDQUFDLEdBQUcsSUFBSSxDQUFDLE9B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LElBQUksQ0FBQyxDQUFDO1FBRWpELE1BQU0sWUFBWSxHQUFHO1lBQ25CLFlBQVksRUFBRSwwQ0FBMEM7WUFDeEQsUUFBUSxFQUFFLDBDQUEwQztZQUNwRCxPQUFPLEVBQUUsa0NBQWtDO1lBQzNDLFNBQVMsRUFBRSxzQ0FBc0M7WUFDakQsUUFBUSxFQUFFLDBCQUEwQjtTQUNyQyxDQUFDO1FBRUYsTUFBTSxhQUFhLEdBQUcsWUFBWSxDQUFDLEtBQWtDLENBQUMsSUFBSSxZQUFZLENBQUMsWUFBWSxDQUFDO1FBRXBHLE9BQU8sR0FBRyxhQUFhLGlCQUFpQixLQUFLLGVBQWUsUUFBUSwwQkFBMEIsQ0FBQztJQUNqRyxDQUFDO0NBQ0Y7QUFFWSxRQUFBLHNCQUFzQixHQUFHLElBQUksc0JBQXNCLEVBQUUsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IEFQSV9CQVNFX1VSTCB9IGZyb20gJy4uL2NvbmZpZy9hcGknO1xyXG5cclxuZXhwb3J0IGludGVyZmFjZSBJbWFnZUdlbmVyYXRpb25SZXF1ZXN0IHtcclxuICBjb250ZW50SWQ6IHN0cmluZztcclxuICBwcm9tcHQ6IHN0cmluZztcclxuICBzdHlsZT86IHN0cmluZztcclxuICBzaXplPzogJzEwMjR4MTAyNCcgfCAnMTc5MngxMDI0JyB8ICcxMDI0eDE3OTInO1xyXG59XHJcblxyXG5leHBvcnQgaW50ZXJmYWNlIEltYWdlR2VuZXJhdGlvblJlc3BvbnNlIHtcclxuICBzdWNjZXNzOiBib29sZWFuO1xyXG4gIGltYWdlVXJsPzogc3RyaW5nO1xyXG4gIGVycm9yPzogc3RyaW5nO1xyXG59XHJcblxyXG5leHBvcnQgaW50ZXJmYWNlIEltYWdlR2VuZXJhdGlvblN0YXR1cyB7XHJcbiAgY29udGVudElkOiBzdHJpbmc7XHJcbiAgc3RhdHVzOiAncGVuZGluZycgfCAnZ2VuZXJhdGluZycgfCAnY29tcGxldGVkJyB8ICdmYWlsZWQnO1xyXG4gIGltYWdlVXJsPzogc3RyaW5nO1xyXG4gIGVycm9yPzogc3RyaW5nO1xyXG4gIHByb2dyZXNzPzogbnVtYmVyO1xyXG59XHJcblxyXG5jbGFzcyBJbWFnZUdlbmVyYXRpb25TZXJ2aWNlIHtcclxuICBwcml2YXRlIGJhc2VVcmw6IHN0cmluZztcclxuXHJcbiAgY29uc3RydWN0b3IoKSB7XHJcbiAgICB0aGlzLmJhc2VVcmwgPSBBUElfQkFTRV9VUkw7XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBHZW5lcmF0ZSBhbiBpbWFnZSBmb3IgYmxvZyBjb250ZW50XHJcbiAgICovXHJcbiAgYXN5bmMgZ2VuZXJhdGVJbWFnZShyZXF1ZXN0OiBJbWFnZUdlbmVyYXRpb25SZXF1ZXN0KTogUHJvbWlzZTxJbWFnZUdlbmVyYXRpb25SZXNwb25zZT4ge1xyXG4gICAgdHJ5IHtcclxuICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBmZXRjaChgJHt0aGlzLmJhc2VVcmx9L2FwaS9pbWFnZS9nZW5lcmF0ZWAsIHtcclxuICAgICAgICBtZXRob2Q6ICdQT1NUJyxcclxuICAgICAgICBoZWFkZXJzOiB7XHJcbiAgICAgICAgICAnQ29udGVudC1UeXBlJzogJ2FwcGxpY2F0aW9uL2pzb24nLFxyXG4gICAgICAgIH0sXHJcbiAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkocmVxdWVzdCksXHJcbiAgICAgIH0pO1xyXG5cclxuICAgICAgaWYgKCFyZXNwb25zZS5vaykge1xyXG4gICAgICAgIGNvbnN0IGVycm9yRGF0YSA9IGF3YWl0IHJlc3BvbnNlLmpzb24oKTtcclxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoZXJyb3JEYXRhLmVycm9yIHx8IGBIVFRQIGVycm9yISBzdGF0dXM6ICR7cmVzcG9uc2Uuc3RhdHVzfWApO1xyXG4gICAgICB9XHJcblxyXG4gICAgICByZXR1cm4gYXdhaXQgcmVzcG9uc2UuanNvbigpO1xyXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgY29uc29sZS5lcnJvcignRXJyb3IgZ2VuZXJhdGluZyBpbWFnZTonLCBlcnJvcik7XHJcbiAgICAgIHRocm93IGVycm9yO1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogR2V0IGltYWdlIGdlbmVyYXRpb24gc3RhdHVzXHJcbiAgICovXHJcbiAgYXN5bmMgZ2V0SW1hZ2VTdGF0dXMoY29udGVudElkOiBzdHJpbmcpOiBQcm9taXNlPEltYWdlR2VuZXJhdGlvblN0YXR1cz4ge1xyXG4gICAgdHJ5IHtcclxuICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBmZXRjaChgJHt0aGlzLmJhc2VVcmx9L2FwaS9pbWFnZS9zdGF0dXMvJHtjb250ZW50SWR9YCwge1xyXG4gICAgICAgIG1ldGhvZDogJ0dFVCcsXHJcbiAgICAgICAgaGVhZGVyczoge1xyXG4gICAgICAgICAgJ0NvbnRlbnQtVHlwZSc6ICdhcHBsaWNhdGlvbi9qc29uJyxcclxuICAgICAgICB9LFxyXG4gICAgICB9KTtcclxuXHJcbiAgICAgIGlmICghcmVzcG9uc2Uub2spIHtcclxuICAgICAgICBjb25zdCBlcnJvckRhdGEgPSBhd2FpdCByZXNwb25zZS5qc29uKCk7XHJcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGVycm9yRGF0YS5lcnJvciB8fCBgSFRUUCBlcnJvciEgc3RhdHVzOiAke3Jlc3BvbnNlLnN0YXR1c31gKTtcclxuICAgICAgfVxyXG5cclxuICAgICAgcmV0dXJuIGF3YWl0IHJlc3BvbnNlLmpzb24oKTtcclxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ0Vycm9yIGdldHRpbmcgaW1hZ2Ugc3RhdHVzOicsIGVycm9yKTtcclxuICAgICAgdGhyb3cgZXJyb3I7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBSZXF1ZXN0IGltYWdlIHJldmlzaW9uIHdpdGggZmVlZGJhY2tcclxuICAgKi9cclxuICBhc3luYyByZXF1ZXN0SW1hZ2VSZXZpc2lvbihjb250ZW50SWQ6IHN0cmluZywgZmVlZGJhY2s6IHN0cmluZywgbmV3UHJvbXB0Pzogc3RyaW5nKTogUHJvbWlzZTxJbWFnZUdlbmVyYXRpb25SZXNwb25zZT4ge1xyXG4gICAgdHJ5IHtcclxuICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBmZXRjaChgJHt0aGlzLmJhc2VVcmx9L2FwaS9pbWFnZS9yZXZpc2VgLCB7XHJcbiAgICAgICAgbWV0aG9kOiAnUE9TVCcsXHJcbiAgICAgICAgaGVhZGVyczoge1xyXG4gICAgICAgICAgJ0NvbnRlbnQtVHlwZSc6ICdhcHBsaWNhdGlvbi9qc29uJyxcclxuICAgICAgICB9LFxyXG4gICAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHtcclxuICAgICAgICAgIGNvbnRlbnRJZCxcclxuICAgICAgICAgIGZlZWRiYWNrLFxyXG4gICAgICAgICAgbmV3UHJvbXB0LFxyXG4gICAgICAgIH0pLFxyXG4gICAgICB9KTtcclxuXHJcbiAgICAgIGlmICghcmVzcG9uc2Uub2spIHtcclxuICAgICAgICBjb25zdCBlcnJvckRhdGEgPSBhd2FpdCByZXNwb25zZS5qc29uKCk7XHJcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGVycm9yRGF0YS5lcnJvciB8fCBgSFRUUCBlcnJvciEgc3RhdHVzOiAke3Jlc3BvbnNlLnN0YXR1c31gKTtcclxuICAgICAgfVxyXG5cclxuICAgICAgcmV0dXJuIGF3YWl0IHJlc3BvbnNlLmpzb24oKTtcclxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ0Vycm9yIHJlcXVlc3RpbmcgaW1hZ2UgcmV2aXNpb246JywgZXJyb3IpO1xyXG4gICAgICB0aHJvdyBlcnJvcjtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIEFuYWx5emUgY29udGVudCB0byBnZW5lcmF0ZSBhcHByb3ByaWF0ZSBpbWFnZSBwcm9tcHRcclxuICAgKi9cclxuICBhc3luYyBhbmFseXplQ29udGVudEZvckltYWdlKGNvbnRlbnQ6IHN0cmluZyk6IFByb21pc2U8eyBwcm9tcHQ6IHN0cmluZzsgc3R5bGU/OiBzdHJpbmcgfT4ge1xyXG4gICAgdHJ5IHtcclxuICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBmZXRjaChgJHt0aGlzLmJhc2VVcmx9L2FwaS9pbWFnZS9hbmFseXplYCwge1xyXG4gICAgICAgIG1ldGhvZDogJ1BPU1QnLFxyXG4gICAgICAgIGhlYWRlcnM6IHtcclxuICAgICAgICAgICdDb250ZW50LVR5cGUnOiAnYXBwbGljYXRpb24vanNvbicsXHJcbiAgICAgICAgfSxcclxuICAgICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7IGNvbnRlbnQgfSksXHJcbiAgICAgIH0pO1xyXG5cclxuICAgICAgaWYgKCFyZXNwb25zZS5vaykge1xyXG4gICAgICAgIGNvbnN0IGVycm9yRGF0YSA9IGF3YWl0IHJlc3BvbnNlLmpzb24oKTtcclxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoZXJyb3JEYXRhLmVycm9yIHx8IGBIVFRQIGVycm9yISBzdGF0dXM6ICR7cmVzcG9uc2Uuc3RhdHVzfWApO1xyXG4gICAgICB9XHJcblxyXG4gICAgICByZXR1cm4gYXdhaXQgcmVzcG9uc2UuanNvbigpO1xyXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgY29uc29sZS5lcnJvcignRXJyb3IgYW5hbHl6aW5nIGNvbnRlbnQgZm9yIGltYWdlOicsIGVycm9yKTtcclxuICAgICAgdGhyb3cgZXJyb3I7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBQb2xsIGZvciBpbWFnZSBnZW5lcmF0aW9uIHN0YXR1cyB3aXRoIHRpbWVvdXRcclxuICAgKi9cclxuICBhc3luYyBwb2xsSW1hZ2VTdGF0dXMoXHJcbiAgICBjb250ZW50SWQ6IHN0cmluZywgXHJcbiAgICB0aW1lb3V0TXM6IG51bWJlciA9IDYwMDAwLFxyXG4gICAgaW50ZXJ2YWxNczogbnVtYmVyID0gMjAwMFxyXG4gICk6IFByb21pc2U8SW1hZ2VHZW5lcmF0aW9uU3RhdHVzPiB7XHJcbiAgICBjb25zdCBzdGFydFRpbWUgPSBEYXRlLm5vdygpO1xyXG4gICAgXHJcbiAgICB3aGlsZSAoRGF0ZS5ub3coKSAtIHN0YXJ0VGltZSA8IHRpbWVvdXRNcykge1xyXG4gICAgICBjb25zdCBzdGF0dXMgPSBhd2FpdCB0aGlzLmdldEltYWdlU3RhdHVzKGNvbnRlbnRJZCk7XHJcbiAgICAgIFxyXG4gICAgICBpZiAoc3RhdHVzLnN0YXR1cyA9PT0gJ2NvbXBsZXRlZCcgfHwgc3RhdHVzLnN0YXR1cyA9PT0gJ2ZhaWxlZCcpIHtcclxuICAgICAgICByZXR1cm4gc3RhdHVzO1xyXG4gICAgICB9XHJcbiAgICAgIFxyXG4gICAgICBhd2FpdCBuZXcgUHJvbWlzZShyZXNvbHZlID0+IHNldFRpbWVvdXQocmVzb2x2ZSwgaW50ZXJ2YWxNcykpO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ0ltYWdlIGdlbmVyYXRpb24gdGltZW91dCcpO1xyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogR2VuZXJhdGUgaW1hZ2UgcHJvbXB0IGZyb20gYmxvZyBjb250ZW50XHJcbiAgICovXHJcbiAgZ2VuZXJhdGVJbWFnZVByb21wdCh0aXRsZTogc3RyaW5nLCBjb250ZW50OiBzdHJpbmcsIHN0eWxlOiBzdHJpbmcgPSAncHJvZmVzc2lvbmFsJyk6IHN0cmluZyB7XHJcbiAgICAvLyBFeHRyYWN0IGtleSB0aGVtZXMgYW5kIGNvbmNlcHRzIGZyb20gdGhlIGNvbnRlbnRcclxuICAgIGNvbnN0IHdvcmRzID0gY29udGVudC50b0xvd2VyQ2FzZSgpLnNwbGl0KC9cXHMrLyk7XHJcbiAgICBjb25zdCBrZXlXb3JkcyA9IHdvcmRzLmZpbHRlcih3b3JkID0+IFxyXG4gICAgICB3b3JkLmxlbmd0aCA+IDQgJiYgXHJcbiAgICAgICFbJ3RoYXQnLCAndGhpcycsICd3aXRoJywgJ2Zyb20nLCAndGhleScsICdoYXZlJywgJ3dpbGwnLCAnYmVlbicsICd3ZXJlJywgJ3NhaWQnLCAnZWFjaCcsICd3aGljaCcsICd0aGVpcicsICd0aW1lJywgJ3dvdWxkJywgJ3RoZXJlJywgJ2NvdWxkJywgJ290aGVyJ10uaW5jbHVkZXMod29yZClcclxuICAgICk7XHJcbiAgICBcclxuICAgIC8vIFRha2UgZmlyc3QgZmV3IGtleSBjb25jZXB0c1xyXG4gICAgY29uc3QgY29uY2VwdHMgPSBrZXlXb3Jkcy5zbGljZSgwLCAzKS5qb2luKCcsICcpO1xyXG4gICAgXHJcbiAgICBjb25zdCBzdHlsZVByb21wdHMgPSB7XHJcbiAgICAgIHByb2Zlc3Npb25hbDogJ2NsZWFuLCBtb2Rlcm4sIHByb2Zlc3Npb25hbCBpbGx1c3RyYXRpb24nLFxyXG4gICAgICBjcmVhdGl2ZTogJ2FydGlzdGljLCBjcmVhdGl2ZSwgdmlicmFudCBpbGx1c3RyYXRpb24nLFxyXG4gICAgICBtaW5pbWFsOiAnbWluaW1hbGlzdCwgc2ltcGxlLCBjbGVhbiBkZXNpZ24nLFxyXG4gICAgICB0ZWNobmljYWw6ICd0ZWNobmljYWwgZGlhZ3JhbSwgaW5mb2dyYXBoaWMgc3R5bGUnLFxyXG4gICAgICBhYnN0cmFjdDogJ2Fic3RyYWN0LCBjb25jZXB0dWFsIGFydCdcclxuICAgIH07XHJcbiAgICBcclxuICAgIGNvbnN0IHNlbGVjdGVkU3R5bGUgPSBzdHlsZVByb21wdHNbc3R5bGUgYXMga2V5b2YgdHlwZW9mIHN0eWxlUHJvbXB0c10gfHwgc3R5bGVQcm9tcHRzLnByb2Zlc3Npb25hbDtcclxuICAgIFxyXG4gICAgcmV0dXJuIGAke3NlbGVjdGVkU3R5bGV9IHJlcHJlc2VudGluZyAke3RpdGxlfSwgZmVhdHVyaW5nICR7Y29uY2VwdHN9LCBoaWdoIHF1YWxpdHksIGRldGFpbGVkYDtcclxuICB9XHJcbn1cclxuXHJcbmV4cG9ydCBjb25zdCBpbWFnZUdlbmVyYXRpb25TZXJ2aWNlID0gbmV3IEltYWdlR2VuZXJhdGlvblNlcnZpY2UoKTsiXX0=