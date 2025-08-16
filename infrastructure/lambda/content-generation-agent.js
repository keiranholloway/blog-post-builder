"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = void 0;
const client_dynamodb_1 = require("@aws-sdk/client-dynamodb");
const client_eventbridge_1 = require("@aws-sdk/client-eventbridge");
const client_sqs_1 = require("@aws-sdk/client-sqs");
const uuid_1 = require("uuid");
// Initialize AWS clients
const dynamoClient = new client_dynamodb_1.DynamoDBClient({ region: process.env.AWS_REGION });
const eventBridgeClient = new client_eventbridge_1.EventBridgeClient({ region: process.env.AWS_REGION });
const sqsClient = new client_sqs_1.SQSClient({ region: process.env.AWS_REGION });
// Environment variables
const USER_TABLE = process.env.USER_TABLE_NAME;
const CONTENT_TABLE = process.env.CONTENT_TABLE_NAME;
const EVENT_BUS = process.env.EVENT_BUS_NAME;
const ORCHESTRATOR_QUEUE = process.env.ORCHESTRATOR_QUEUE_URL;
/**
 * Main handler for content generation agent
 */
const handler = async (event, _context) => {
    console.log('Content Generation Agent Event:', JSON.stringify(event, null, 2));
    for (const record of event.Records) {
        try {
            const message = JSON.parse(record.body);
            console.log(`Processing message: ${message.messageType} for workflow ${message.workflowId}`);
            switch (message.messageType) {
                case 'request':
                    await handleContentGenerationRequest(message.payload);
                    break;
                case 'revision':
                    await handleRevisionRequest(message.payload);
                    break;
                default:
                    console.warn(`Unknown message type: ${message.messageType}`);
            }
        }
        catch (error) {
            console.error('Error processing SQS record:', error);
            // Let the message go to DLQ for manual inspection
            throw error;
        }
    }
};
exports.handler = handler;
/**
 * Handle content generation request
 */
async function handleContentGenerationRequest(request) {
    console.log(`Generating content for workflow ${request.workflowId}`);
    try {
        // Load user preferences
        const userPreferences = await loadUserPreferences(request.userId);
        // Generate content using AI
        const generatedContent = await generateContent(request.input, userPreferences);
        // Validate content quality
        const validationResult = await validateContent(generatedContent);
        if (!validationResult.isValid) {
            throw new Error(`Content validation failed: ${validationResult.issues.join(', ')}`);
        }
        // Send success response back to orchestrator
        await sendResponseToOrchestrator({
            workflowId: request.workflowId,
            stepId: request.stepId,
            messageType: 'response',
            payload: {
                success: true,
                content: generatedContent,
                metadata: {
                    generatedAt: new Date().toISOString(),
                    model: 'content-generation-v1',
                    processingTime: Date.now(), // This would be calculated properly
                },
            },
        });
        // Publish success event
        await publishEvent('Content Generation Completed', {
            workflowId: request.workflowId,
            stepId: request.stepId,
            contentLength: generatedContent.content.length,
            wordCount: generatedContent.wordCount,
            qualityScore: generatedContent.quality.score,
        });
        console.log(`Content generation completed for workflow ${request.workflowId}`);
    }
    catch (error) {
        console.error(`Content generation failed for workflow ${request.workflowId}:`, error);
        // Send error response back to orchestrator
        await sendResponseToOrchestrator({
            workflowId: request.workflowId,
            stepId: request.stepId,
            messageType: 'error',
            payload: {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
                retryable: isRetryableError(error),
            },
        });
        // Publish failure event
        await publishEvent('Content Generation Failed', {
            workflowId: request.workflowId,
            stepId: request.stepId,
            error: error instanceof Error ? error.message : 'Unknown error',
        });
    }
}
/**
 * Handle revision request
 */
async function handleRevisionRequest(request) {
    console.log(`Processing revision for workflow ${request.workflowId}`);
    try {
        // Load user preferences
        const userPreferences = await loadUserPreferences(request.userId);
        // Generate revised content
        const revisedContent = await reviseContent(request.currentContent, request.feedback, request.revisionType, userPreferences);
        // Validate revised content
        const validationResult = await validateContent(revisedContent);
        if (!validationResult.isValid) {
            throw new Error(`Revised content validation failed: ${validationResult.issues.join(', ')}`);
        }
        // Send success response back to orchestrator
        await sendResponseToOrchestrator({
            workflowId: request.workflowId,
            stepId: request.stepId,
            messageType: 'response',
            payload: {
                success: true,
                content: revisedContent,
                revisionType: request.revisionType,
                metadata: {
                    revisedAt: new Date().toISOString(),
                    originalFeedback: request.feedback,
                    model: 'content-revision-v1',
                },
            },
        });
        console.log(`Content revision completed for workflow ${request.workflowId}`);
    }
    catch (error) {
        console.error(`Content revision failed for workflow ${request.workflowId}:`, error);
        // Send error response back to orchestrator
        await sendResponseToOrchestrator({
            workflowId: request.workflowId,
            stepId: request.stepId,
            messageType: 'error',
            payload: {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
                retryable: isRetryableError(error),
            },
        });
    }
}
/**
 * Generate content using AI with user context
 */
async function generateContent(input, userPreferences) {
    // Create prompt template with user context
    const prompt = createContentGenerationPrompt(input, userPreferences);
    console.log('Generated prompt for content creation:', prompt.substring(0, 200) + '...');
    // Simulate AI content generation (in real implementation, this would call an AI service)
    const generatedContent = await simulateAIContentGeneration(prompt, userPreferences);
    return generatedContent;
}
/**
 * Revise content based on feedback
 */
async function reviseContent(currentContent, feedback, revisionType, userPreferences) {
    // Create revision prompt
    const prompt = createRevisionPrompt(currentContent, feedback, revisionType, userPreferences);
    console.log('Generated prompt for content revision:', prompt.substring(0, 200) + '...');
    // Simulate AI content revision
    const revisedContent = await simulateAIContentGeneration(prompt, userPreferences);
    return revisedContent;
}
/**
 * Create content generation prompt with user context
 */
function createContentGenerationPrompt(input, userPreferences) {
    const basePrompt = `
You are a professional content writer tasked with creating a high-quality blog post based on the following input:

INPUT: "${input}"

WRITING GUIDELINES:
- Tone: ${userPreferences.tone || 'conversational'}
- Length: ${userPreferences.length || 'medium'} (${getLengthGuideline(userPreferences.length)})
- Target Audience: ${userPreferences.targetAudience || 'general audience'}
- Writing Style: ${userPreferences.writingStyle || 'clear and engaging'}

REQUIREMENTS:
1. Create an engaging title that captures the main theme
2. Write a compelling introduction that hooks the reader
3. Develop the main content with clear structure and flow
4. Include relevant examples or anecdotes where appropriate
5. End with a strong conclusion that reinforces key points
6. Ensure the content is original, informative, and valuable to readers

STRUCTURE:
- Title: Clear and engaging
- Introduction: 1-2 paragraphs
- Main Content: 3-5 sections with subheadings
- Conclusion: 1-2 paragraphs

Please generate a complete blog post that transforms the input into professional, publishable content.
`;
    return basePrompt.trim();
}
/**
 * Create revision prompt based on feedback
 */
function createRevisionPrompt(currentContent, feedback, revisionType, userPreferences) {
    const basePrompt = `
You are tasked with revising the following blog post based on specific feedback:

CURRENT CONTENT:
"${currentContent}"

FEEDBACK: "${feedback}"

REVISION TYPE: ${revisionType}

WRITING GUIDELINES:
- Tone: ${userPreferences.tone || 'conversational'}
- Target Audience: ${userPreferences.targetAudience || 'general audience'}
- Writing Style: ${userPreferences.writingStyle || 'clear and engaging'}

REVISION INSTRUCTIONS:
${getRevisionInstructions(revisionType)}

Please revise the content addressing the specific feedback while maintaining the overall quality and structure.
`;
    return basePrompt.trim();
}
/**
 * Get revision instructions based on type
 */
function getRevisionInstructions(revisionType) {
    switch (revisionType) {
        case 'content':
            return '- Focus on improving the factual accuracy, depth, and relevance of the content\n- Add or remove information as needed\n- Ensure all claims are well-supported';
        case 'style':
            return '- Adjust the writing style, voice, and tone\n- Improve sentence structure and word choice\n- Enhance readability and flow';
        case 'structure':
            return '- Reorganize content for better logical flow\n- Improve headings and subheadings\n- Enhance transitions between sections';
        case 'tone':
            return '- Adjust the overall tone to better match the target audience\n- Modify language formality as needed\n- Ensure consistent voice throughout';
        default:
            return '- Address the specific feedback provided\n- Maintain overall content quality\n- Preserve the core message and value';
    }
}
/**
 * Get length guideline based on preference
 */
function getLengthGuideline(length) {
    switch (length) {
        case 'short':
            return '500-800 words';
        case 'medium':
            return '800-1500 words';
        case 'long':
            return '1500-2500 words';
        default:
            return '800-1500 words';
    }
}
/**
 * Simulate AI content generation (placeholder for actual AI integration)
 */
async function simulateAIContentGeneration(prompt, userPreferences) {
    // In a real implementation, this would call an AI service like OpenAI, Claude, etc.
    // For now, we'll simulate the response
    const simulatedContent = {
        title: "Transforming Ideas into Action: A Guide to Effective Implementation",
        content: `
# Introduction

Every great achievement starts with an idea, but the journey from concept to reality is where most dreams either flourish or fade. The ability to transform abstract thoughts into concrete actions is what separates successful individuals and organizations from those who remain perpetually in the planning phase.

# The Implementation Mindset

Success in implementation requires more than just good intentions. It demands a fundamental shift in how we approach our goals and challenges. This mindset encompasses several key principles:

## Clarity of Vision
Before taking any action, it's crucial to have a crystal-clear understanding of what you're trying to achieve. Vague goals lead to vague results.

## Systematic Approach
Breaking down large objectives into manageable, actionable steps makes even the most ambitious projects achievable.

## Consistent Execution
Regular, consistent action trumps sporadic bursts of intense effort every time.

# Overcoming Common Obstacles

The path from idea to implementation is rarely smooth. Understanding and preparing for common obstacles can make the difference between success and failure.

## Analysis Paralysis
The tendency to over-analyze and under-execute is one of the biggest killers of good ideas. Sometimes, imperfect action is better than perfect inaction.

## Resource Constraints
Limited time, money, or personnel are common challenges, but they often force creative solutions that wouldn't have emerged otherwise.

# Conclusion

The gap between having great ideas and implementing them successfully is where true value is created. By developing the right mindset, systems, and habits, anyone can become more effective at turning their vision into reality.

Remember: the world doesn't need more ideas—it needs more people who can execute on the ideas they already have.
    `.trim(),
        summary: "A comprehensive guide on transforming ideas into actionable results through systematic implementation and overcoming common obstacles.",
        wordCount: 285,
        readingTime: 2,
        tags: ["productivity", "implementation", "goal-setting", "success", "mindset"],
        quality: {
            score: 8.5,
            issues: [],
            suggestions: [
                "Consider adding specific examples or case studies",
                "Could benefit from actionable tips or checklists"
            ]
        }
    };
    // Simulate processing time
    await new Promise(resolve => setTimeout(resolve, 1000));
    return simulatedContent;
}
/**
 * Validate content quality
 */
async function validateContent(content) {
    const issues = [];
    const suggestions = [];
    // Basic validation checks
    if (!content.title || content.title.length < 10) {
        issues.push('Title is too short or missing');
    }
    if (!content.content || content.content.length < 200) {
        issues.push('Content is too short');
    }
    if (content.wordCount < 100) {
        issues.push('Word count is too low for a meaningful blog post');
    }
    if (content.quality.score < 6.0) {
        issues.push('Content quality score is below acceptable threshold');
    }
    // Content structure validation
    if (!content.content.includes('#')) {
        suggestions.push('Consider adding section headings for better structure');
    }
    if (content.content.split('\n\n').length < 3) {
        suggestions.push('Consider breaking content into more paragraphs for readability');
    }
    return {
        isValid: issues.length === 0,
        issues,
        suggestions: [...suggestions, ...content.quality.suggestions]
    };
}
/**
 * Load user preferences from DynamoDB
 */
async function loadUserPreferences(userId) {
    try {
        const result = await dynamoClient.send(new client_dynamodb_1.GetItemCommand({
            TableName: USER_TABLE,
            Key: {
                id: { S: userId },
            },
        }));
        if (!result.Item) {
            console.log(`User ${userId} not found, using default preferences`);
            return getDefaultUserPreferences();
        }
        // Parse user preferences from the writingStyleContext field
        const writingStyleContext = result.Item.writingStyleContext?.S;
        if (writingStyleContext) {
            try {
                return JSON.parse(writingStyleContext);
            }
            catch (error) {
                console.warn('Failed to parse user writing style context, using defaults');
            }
        }
        return getDefaultUserPreferences();
    }
    catch (error) {
        console.error('Error loading user preferences:', error);
        return getDefaultUserPreferences();
    }
}
/**
 * Get default user preferences
 */
function getDefaultUserPreferences() {
    return {
        tone: 'conversational',
        length: 'medium',
        targetAudience: 'general audience',
        writingStyle: 'clear and engaging',
        topics: []
    };
}
/**
 * Send response back to orchestrator
 */
async function sendResponseToOrchestrator(response) {
    const message = {
        messageId: (0, uuid_1.v4)(),
        workflowId: response.workflowId,
        stepId: response.stepId,
        agentType: 'content-generator',
        messageType: response.messageType,
        payload: response.payload,
        timestamp: new Date().toISOString(),
    };
    await sqsClient.send(new client_sqs_1.SendMessageCommand({
        QueueUrl: ORCHESTRATOR_QUEUE,
        MessageBody: JSON.stringify(message),
        MessageAttributes: {
            workflowId: {
                StringValue: response.workflowId,
                DataType: 'String',
            },
            stepId: {
                StringValue: response.stepId,
                DataType: 'String',
            },
            agentType: {
                StringValue: 'content-generator',
                DataType: 'String',
            },
        },
    }));
}
/**
 * Publish event to EventBridge
 */
async function publishEvent(eventType, detail) {
    await eventBridgeClient.send(new client_eventbridge_1.PutEventsCommand({
        Entries: [{
                Source: 'automated-blog-poster.content-agent',
                DetailType: eventType,
                Detail: JSON.stringify(detail),
                EventBusName: EVENT_BUS,
            }],
    }));
}
/**
 * Determine if an error is retryable
 */
function isRetryableError(error) {
    // Network errors, timeouts, and temporary service issues are retryable
    if (error.code === 'NetworkingError' || error.code === 'TimeoutError') {
        return true;
    }
    // Rate limiting errors are retryable
    if (error.statusCode === 429) {
        return true;
    }
    // Server errors (5xx) are generally retryable
    if (error.statusCode >= 500) {
        return true;
    }
    // Client errors (4xx) are generally not retryable
    return false;
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY29udGVudC1nZW5lcmF0aW9uLWFnZW50LmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiY29udGVudC1nZW5lcmF0aW9uLWFnZW50LnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUNBLDhEQUE2RjtBQUM3RixvRUFBa0Y7QUFDbEYsb0RBQW9FO0FBQ3BFLCtCQUFvQztBQTZDcEMseUJBQXlCO0FBQ3pCLE1BQU0sWUFBWSxHQUFHLElBQUksZ0NBQWMsQ0FBQyxFQUFFLE1BQU0sRUFBRSxPQUFPLENBQUMsR0FBRyxDQUFDLFVBQVUsRUFBRSxDQUFDLENBQUM7QUFDNUUsTUFBTSxpQkFBaUIsR0FBRyxJQUFJLHNDQUFpQixDQUFDLEVBQUUsTUFBTSxFQUFFLE9BQU8sQ0FBQyxHQUFHLENBQUMsVUFBVSxFQUFFLENBQUMsQ0FBQztBQUNwRixNQUFNLFNBQVMsR0FBRyxJQUFJLHNCQUFTLENBQUMsRUFBRSxNQUFNLEVBQUUsT0FBTyxDQUFDLEdBQUcsQ0FBQyxVQUFVLEVBQUUsQ0FBQyxDQUFDO0FBRXBFLHdCQUF3QjtBQUN4QixNQUFNLFVBQVUsR0FBRyxPQUFPLENBQUMsR0FBRyxDQUFDLGVBQWdCLENBQUM7QUFDaEQsTUFBTSxhQUFhLEdBQUcsT0FBTyxDQUFDLEdBQUcsQ0FBQyxrQkFBbUIsQ0FBQztBQUN0RCxNQUFNLFNBQVMsR0FBRyxPQUFPLENBQUMsR0FBRyxDQUFDLGNBQWUsQ0FBQztBQUM5QyxNQUFNLGtCQUFrQixHQUFHLE9BQU8sQ0FBQyxHQUFHLENBQUMsc0JBQXVCLENBQUM7QUFFL0Q7O0dBRUc7QUFDSSxNQUFNLE9BQU8sR0FBRyxLQUFLLEVBQUUsS0FBZSxFQUFFLFFBQWlCLEVBQWlCLEVBQUU7SUFDakYsT0FBTyxDQUFDLEdBQUcsQ0FBQyxpQ0FBaUMsRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFDLEtBQUssRUFBRSxJQUFJLEVBQUUsQ0FBQyxDQUFDLENBQUMsQ0FBQztJQUUvRSxLQUFLLE1BQU0sTUFBTSxJQUFJLEtBQUss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S0FBSyxDQUFDLElBQUksS0FBSyxjQUFjLEVBQUU7UUFDckUsT0FBTyxJQUFJLENBQUM7S0FDYjtJQUVELHFDQUFxQztJQUNyQyxJQUFJLEtBQUssQ0FBQyxVQUFVLEtBQUssR0FBRyxFQUFFO1FBQzVCLE9BQU8sSUFBSSxDQUFDO0tBQ2I7SUFFRCw4Q0FBOEM7SUFDOUMsSUFBSSxLQUFLLENBQUMsVUFBVSxJQUFJLEdBQUcsRUFBRTtRQUMzQixPQUFPLElBQUksQ0FBQztLQUNiO0lBRUQsa0RBQWtEO0lBQ2xELE9BQU8sS0FBSyxDQUFDO0FBQ2YsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IFNRU0V2ZW50LCBDb250ZXh0IH0gZnJvbSAnYXdzLWxhbWJkYSc7XHJcbmltcG9ydCB7IER5bmFtb0RCQ2xpZW50LCBHZXRJdGVtQ29tbWFuZCwgVXBkYXRlSXRlbUNvbW1hbmQgfSBmcm9tICdAYXdzLXNkay9jbGllbnQtZHluYW1vZGInO1xyXG5pbXBvcnQgeyBFdmVudEJyaWRnZUNsaWVudCwgUHV0RXZlbnRzQ29tbWFuZCB9IGZyb20gJ0Bhd3Mtc2RrL2NsaWVudC1ldmVudGJyaWRnZSc7XHJcbmltcG9ydCB7IFNRU0NsaWVudCwgU2VuZE1lc3NhZ2VDb21tYW5kIH0gZnJvbSAnQGF3cy1zZGsvY2xpZW50LXNxcyc7XHJcbmltcG9ydCB7IHY0IGFzIHV1aWR2NCB9IGZyb20gJ3V1aWQnO1xyXG5cclxuLy8gVHlwZXMgZm9yIGNvbnRlbnQgZ2VuZXJhdGlvblxyXG5pbnRlcmZhY2UgQ29udGVudEdlbmVyYXRpb25SZXF1ZXN0IHtcclxuICB3b3JrZmxvd0lkOiBzdHJpbmc7XHJcbiAgc3RlcElkOiBzdHJpbmc7XHJcbiAgaW5wdXQ6IHN0cmluZztcclxuICB1c2VySWQ6IHN0cmluZztcclxuICBjb250ZXh0OiB7XHJcbiAgICBwcmV2aW91c1N0ZXBzOiBhbnlbXTtcclxuICAgIHVzZXJQcmVmZXJlbmNlczogVXNlclByZWZlcmVuY2VzO1xyXG4gIH07XHJcbn1cclxuXHJcbmludGVyZmFjZSBVc2VyUHJlZmVyZW5jZXMge1xyXG4gIHdyaXRpbmdTdHlsZT86IHN0cmluZztcclxuICB0b25lPzogJ3Byb2Zlc3Npb25hbCcgfCAnY2FzdWFsJyB8ICd0ZWNobmljYWwnIHwgJ2NvbnZlcnNhdGlvbmFsJztcclxuICBsZW5ndGg/OiAnc2hvcnQnIHwgJ21lZGl1bScgfCAnbG9uZyc7XHJcbiAgdGFyZ2V0QXVkaWVuY2U/OiBzdHJpbmc7XHJcbiAgdG9waWNzPzogc3RyaW5nW107XHJcbn1cclxuXHJcbmludGVyZmFjZSBDb250ZW50R2VuZXJhdGlvblJlc3BvbnNlIHtcclxuICB0aXRsZTogc3RyaW5nO1xyXG4gIGNvbnRlbnQ6IHN0cmluZztcclxuICBzdW1tYXJ5OiBzdHJpbmc7XHJcbiAgd29yZENvdW50OiBudW1iZXI7XHJcbiAgcmVhZGluZ1RpbWU6IG51bWJlcjtcclxuICB0YWdzOiBzdHJpbmdbXTtcclxuICBxdWFsaXR5OiB7XHJcbiAgICBzY29yZTogbnVtYmVyO1xyXG4gICAgaXNzdWVzOiBzdHJpbmdbXTtcclxuICAgIHN1Z2dlc3Rpb25zOiBzdHJpbmdbXTtcclxuICB9O1xyXG59XHJcblxyXG5pbnRlcmZhY2UgUmV2aXNpb25SZXF1ZXN0IHtcclxuICB3b3JrZmxvd0lkOiBzdHJpbmc7XHJcbiAgc3RlcElkOiBzdHJpbmc7XHJcbiAgY3VycmVudENvbnRlbnQ6IHN0cmluZztcclxuICBmZWVkYmFjazogc3RyaW5nO1xyXG4gIHVzZXJJZDogc3RyaW5nO1xyXG4gIHJldmlzaW9uVHlwZTogJ2NvbnRlbnQnIHwgJ3N0eWxlJyB8ICdzdHJ1Y3R1cmUnIHwgJ3RvbmUnO1xyXG59XHJcblxyXG4vLyBJbml0aWFsaXplIEFXUyBjbGllbnRzXHJcbmNvbnN0IGR5bmFtb0NsaWVudCA9IG5ldyBEeW5hbW9EQkNsaWVudCh7IHJlZ2lvbjogcHJvY2Vzcy5lbnYuQVdTX1JFR0lPTiB9KTtcclxuY29uc3QgZXZlbnRCcmlkZ2VDbGllbnQgPSBuZXcgRXZlbnRCcmlkZ2VDbGllbnQoeyByZWdpb246IHByb2Nlc3MuZW52LkFXU19SRUdJT04gfSk7XHJcbmNvbnN0IHNxc0NsaWVudCA9IG5ldyBTUVNDbGllbnQoeyByZWdpb246IHByb2Nlc3MuZW52LkFXU19SRUdJT04gfSk7XHJcblxyXG4vLyBFbnZpcm9ubWVudCB2YXJpYWJsZXNcclxuY29uc3QgVVNFUl9UQUJMRSA9IHByb2Nlc3MuZW52LlVTRVJfVEFCTEVfTkFNRSE7XHJcbmNvbnN0IENPTlRFTlRfVEFCTEUgPSBwcm9jZXNzLmVudi5DT05URU5UX1RBQkxFX05BTUUhO1xyXG5jb25zdCBFVkVOVF9CVVMgPSBwcm9jZXNzLmVudi5FVkVOVF9CVVNfTkFNRSE7XHJcbmNvbnN0IE9SQ0hFU1RSQVRPUl9RVUVVRSA9IHByb2Nlc3MuZW52Lk9SQ0hFU1RSQVRPUl9RVUVVRV9VUkwhO1xyXG5cclxuLyoqXHJcbiAqIE1haW4gaGFuZGxlciBmb3IgY29udGVudCBnZW5lcmF0aW9uIGFnZW50XHJcbiAqL1xyXG5leHBvcnQgY29uc3QgaGFuZGxlciA9IGFzeW5jIChldmVudDogU1FTRXZlbnQsIF9jb250ZXh0OiBDb250ZXh0KTogUHJvbWlzZTx2b2lkPiA9PiB7XHJcbiAgY29uc29sZS5sb2coJ0NvbnRlbnQgR2VuZXJhdGlvbiBBZ2VudCBFdmVudDonLCBKU09OLnN0cmluZ2lmeShldmVudCwgbnVsbCwgMikpO1xyXG5cclxuICBmb3IgKGNvbnN0IHJlY29yZCBvZiBldmVudC5SZWNvcmRzKSB7XHJcbiAgICB0cnkge1xyXG4gICAgICBjb25zdCBtZXNzYWdlID0gSlNPTi5wYXJzZShyZWNvcmQuYm9keSk7XHJcbiAgICAgIGNvbnNvbGUubG9nKGBQcm9jZXNzaW5nIG1lc3NhZ2U6ICR7bWVzc2FnZS5tZXNzYWdlVHlwZX0gZm9yIHdvcmtmbG93ICR7bWVzc2FnZS53b3JrZmxvd0lkfWApO1xyXG5cclxuICAgICAgc3dpdGNoIChtZXNzYWdlLm1lc3NhZ2VUeXBlKSB7XHJcbiAgICAgICAgY2FzZSAncmVxdWVzdCc6XHJcbiAgICAgICAgICBhd2FpdCBoYW5kbGVDb250ZW50R2VuZXJhdGlvblJlcXVlc3QobWVzc2FnZS5wYXlsb2FkKTtcclxuICAgICAgICAgIGJyZWFrO1xyXG4gICAgICAgIFxyXG4gICAgICAgIGNhc2UgJ3JldmlzaW9uJzpcclxuICAgICAgICAgIGF3YWl0IGhhbmRsZVJldmlzaW9uUmVxdWVzdChtZXNzYWdlLnBheWxvYWQpO1xyXG4gICAgICAgICAgYnJlYWs7XHJcbiAgICAgICAgXHJcbiAgICAgICAgZGVmYXVsdDpcclxuICAgICAgICAgIGNvbnNvbGUud2FybihgVW5rbm93biBtZXNzYWdlIHR5cGU6ICR7bWVzc2FnZS5tZXNzYWdlVHlwZX1gKTtcclxuICAgICAgfVxyXG5cclxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ0Vycm9yIHByb2Nlc3NpbmcgU1FTIHJlY29yZDonLCBlcnJvcik7XHJcbiAgICAgIC8vIExldCB0aGUgbWVzc2FnZSBnbyB0byBETFEgZm9yIG1hbnVhbCBpbnNwZWN0aW9uXHJcbiAgICAgIHRocm93IGVycm9yO1xyXG4gICAgfVxyXG4gIH1cclxufTtcclxuXHJcbi8qKlxyXG4gKiBIYW5kbGUgY29udGVudCBnZW5lcmF0aW9uIHJlcXVlc3RcclxuICovXHJcbmFzeW5jIGZ1bmN0aW9uIGhhbmRsZUNvbnRlbnRHZW5lcmF0aW9uUmVxdWVzdChyZXF1ZXN0OiBDb250ZW50R2VuZXJhdGlvblJlcXVlc3QpOiBQcm9taXNlPHZvaWQ+IHtcclxuICBjb25zb2xlLmxvZyhgR2VuZXJhdGluZyBjb250ZW50IGZvciB3b3JrZmxvdyAke3JlcXVlc3Qud29ya2Zsb3dJZH1gKTtcclxuXHJcbiAgdHJ5IHtcclxuICAgIC8vIExvYWQgdXNlciBwcmVmZXJlbmNlc1xyXG4gICAgY29uc3QgdXNlclByZWZlcmVuY2VzID0gYXdhaXQgbG9hZFVzZXJQcmVmZXJlbmNlcyhyZXF1ZXN0LnVzZXJJZCk7XHJcbiAgICBcclxuICAgIC8vIEdlbmVyYXRlIGNvbnRlbnQgdXNpbmcgQUlcclxuICAgIGNvbnN0IGdlbmVyYXRlZENvbnRlbnQgPSBhd2FpdCBnZW5lcmF0ZUNvbnRlbnQocmVxdWVzdC5pbnB1dCwgdXNlclByZWZlcmVuY2VzKTtcclxuICAgIFxyXG4gICAgLy8gVmFsaWRhdGUgY29udGVudCBxdWFsaXR5XHJcbiAgICBjb25zdCB2YWxpZGF0aW9uUmVzdWx0ID0gYXdhaXQgdmFsaWRhdGVDb250ZW50KGdlbmVyYXRlZENvbnRlbnQpO1xyXG4gICAgXHJcbiAgICBpZiAoIXZhbGlkYXRpb25SZXN1bHQuaXNWYWxpZCkge1xyXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYENvbnRlbnQgdmFsaWRhdGlvbiBmYWlsZWQ6ICR7dmFsaWRhdGlvblJlc3VsdC5pc3N1ZXMuam9pbignLCAnKX1gKTtcclxuICAgIH1cclxuXHJcbiAgICAvLyBTZW5kIHN1Y2Nlc3MgcmVzcG9uc2UgYmFjayB0byBvcmNoZXN0cmF0b3JcclxuICAgIGF3YWl0IHNlbmRSZXNwb25zZVRvT3JjaGVzdHJhdG9yKHtcclxuICAgICAgd29ya2Zsb3dJZDogcmVxdWVzdC53b3JrZmxvd0lkLFxyXG4gICAgICBzdGVwSWQ6IHJlcXVlc3Quc3RlcElkLFxyXG4gICAgICBtZXNzYWdlVHlwZTogJ3Jlc3BvbnNlJyxcclxuICAgICAgcGF5bG9hZDoge1xyXG4gICAgICAgIHN1Y2Nlc3M6IHRydWUsXHJcbiAgICAgICAgY29udGVudDogZ2VuZXJhdGVkQ29udGVudCxcclxuICAgICAgICBtZXRhZGF0YToge1xyXG4gICAgICAgICAgZ2VuZXJhdGVkQXQ6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcclxuICAgICAgICAgIG1vZGVsOiAnY29udGVudC1nZW5lcmF0aW9uLXYxJyxcclxuICAgICAgICAgIHByb2Nlc3NpbmdUaW1lOiBEYXRlLm5vdygpLCAvLyBUaGlzIHdvdWxkIGJlIGNhbGN1bGF0ZWQgcHJvcGVybHlcclxuICAgICAgICB9LFxyXG4gICAgICB9LFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gUHVibGlzaCBzdWNjZXNzIGV2ZW50XHJcbiAgICBhd2FpdCBwdWJsaXNoRXZlbnQoJ0NvbnRlbnQgR2VuZXJhdGlvbiBDb21wbGV0ZWQnLCB7XHJcbiAgICAgIHdvcmtmbG93SWQ6IHJlcXVlc3Qud29ya2Zsb3dJZCxcclxuICAgICAgc3RlcElkOiByZXF1ZXN0LnN0ZXBJZCxcclxuICAgICAgY29udGVudExlbmd0aDogZ2VuZXJhdGVkQ29udGVudC5jb250ZW50Lmxlbmd0aCxcclxuICAgICAgd29yZENvdW50OiBnZW5lcmF0ZWRDb250ZW50LndvcmRDb3VudCxcclxuICAgICAgcXVhbGl0eVNjb3JlOiBnZW5lcmF0ZWRDb250ZW50LnF1YWxpdHkuc2NvcmUsXHJcbiAgICB9KTtcclxuXHJcbiAgICBjb25zb2xlLmxvZyhgQ29udGVudCBnZW5lcmF0aW9uIGNvbXBsZXRlZCBmb3Igd29ya2Zsb3cgJHtyZXF1ZXN0LndvcmtmbG93SWR9YCk7XHJcblxyXG4gIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICBjb25zb2xlLmVycm9yKGBDb250ZW50IGdlbmVyYXRpb24gZmFpbGVkIGZvciB3b3JrZmxvdyAke3JlcXVlc3Qud29ya2Zsb3dJZH06YCwgZXJyb3IpO1xyXG5cclxuICAgIC8vIFNlbmQgZXJyb3IgcmVzcG9uc2UgYmFjayB0byBvcmNoZXN0cmF0b3JcclxuICAgIGF3YWl0IHNlbmRSZXNwb25zZVRvT3JjaGVzdHJhdG9yKHtcclxuICAgICAgd29ya2Zsb3dJZDogcmVxdWVzdC53b3JrZmxvd0lkLFxyXG4gICAgICBzdGVwSWQ6IHJlcXVlc3Quc3RlcElkLFxyXG4gICAgICBtZXNzYWdlVHlwZTogJ2Vycm9yJyxcclxuICAgICAgcGF5bG9hZDoge1xyXG4gICAgICAgIHN1Y2Nlc3M6IGZhbHNlLFxyXG4gICAgICAgIGVycm9yOiBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6ICdVbmtub3duIGVycm9yJyxcclxuICAgICAgICByZXRyeWFibGU6IGlzUmV0cnlhYmxlRXJyb3IoZXJyb3IpLFxyXG4gICAgICB9LFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gUHVibGlzaCBmYWlsdXJlIGV2ZW50XHJcbiAgICBhd2FpdCBwdWJsaXNoRXZlbnQoJ0NvbnRlbnQgR2VuZXJhdGlvbiBGYWlsZWQnLCB7XHJcbiAgICAgIHdvcmtmbG93SWQ6IHJlcXVlc3Qud29ya2Zsb3dJZCxcclxuICAgICAgc3RlcElkOiByZXF1ZXN0LnN0ZXBJZCxcclxuICAgICAgZXJyb3I6IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogJ1Vua25vd24gZXJyb3InLFxyXG4gICAgfSk7XHJcbiAgfVxyXG59XHJcblxyXG4vKipcclxuICogSGFuZGxlIHJldmlzaW9uIHJlcXVlc3RcclxuICovXHJcbmFzeW5jIGZ1bmN0aW9uIGhhbmRsZVJldmlzaW9uUmVxdWVzdChyZXF1ZXN0OiBSZXZpc2lvblJlcXVlc3QpOiBQcm9taXNlPHZvaWQ+IHtcclxuICBjb25zb2xlLmxvZyhgUHJvY2Vzc2luZyByZXZpc2lvbiBmb3Igd29ya2Zsb3cgJHtyZXF1ZXN0LndvcmtmbG93SWR9YCk7XHJcblxyXG4gIHRyeSB7XHJcbiAgICAvLyBMb2FkIHVzZXIgcHJlZmVyZW5jZXNcclxuICAgIGNvbnN0IHVzZXJQcmVmZXJlbmNlcyA9IGF3YWl0IGxvYWRVc2VyUHJlZmVyZW5jZXMocmVxdWVzdC51c2VySWQpO1xyXG4gICAgXHJcbiAgICAvLyBHZW5lcmF0ZSByZXZpc2VkIGNvbnRlbnRcclxuICAgIGNvbnN0IHJldmlzZWRDb250ZW50ID0gYXdhaXQgcmV2aXNlQ29udGVudChcclxuICAgICAgcmVxdWVzdC5jdXJyZW50Q29udGVudCxcclxuICAgICAgcmVxdWVzdC5mZWVkYmFjayxcclxuICAgICAgcmVxdWVzdC5yZXZpc2lvblR5cGUsXHJcbiAgICAgIHVzZXJQcmVmZXJlbmNlc1xyXG4gICAgKTtcclxuICAgIFxyXG4gICAgLy8gVmFsaWRhdGUgcmV2aXNlZCBjb250ZW50XHJcbiAgICBjb25zdCB2YWxpZGF0aW9uUmVzdWx0ID0gYXdhaXQgdmFsaWRhdGVDb250ZW50KHJldmlzZWRDb250ZW50KTtcclxuICAgIFxyXG4gICAgaWYgKCF2YWxpZGF0aW9uUmVzdWx0LmlzVmFsaWQpIHtcclxuICAgICAgdGhyb3cgbmV3IEVycm9yKGBSZXZpc2VkIGNvbnRlbnQgdmFsaWRhdGlvbiBmYWlsZWQ6ICR7dmFsaWRhdGlvblJlc3VsdC5pc3N1ZXMuam9pbignLCAnKX1gKTtcclxuICAgIH1cclxuXHJcbiAgICAvLyBTZW5kIHN1Y2Nlc3MgcmVzcG9uc2UgYmFjayB0byBvcmNoZXN0cmF0b3JcclxuICAgIGF3YWl0IHNlbmRSZXNwb25zZVRvT3JjaGVzdHJhdG9yKHtcclxuICAgICAgd29ya2Zsb3dJZDogcmVxdWVzdC53b3JrZmxvd0lkLFxyXG4gICAgICBzdGVwSWQ6IHJlcXVlc3Quc3RlcElkLFxyXG4gICAgICBtZXNzYWdlVHlwZTogJ3Jlc3BvbnNlJyxcclxuICAgICAgcGF5bG9hZDoge1xyXG4gICAgICAgIHN1Y2Nlc3M6IHRydWUsXHJcbiAgICAgICAgY29udGVudDogcmV2aXNlZENvbnRlbnQsXHJcbiAgICAgICAgcmV2aXNpb25UeXBlOiByZXF1ZXN0LnJldmlzaW9uVHlwZSxcclxuICAgICAgICBtZXRhZGF0YToge1xyXG4gICAgICAgICAgcmV2aXNlZEF0OiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXHJcbiAgICAgICAgICBvcmlnaW5hbEZlZWRiYWNrOiByZXF1ZXN0LmZlZWRiYWNrLFxyXG4gICAgICAgICAgbW9kZWw6ICdjb250ZW50LXJldmlzaW9uLXYxJyxcclxuICAgICAgICB9LFxyXG4gICAgICB9LFxyXG4gICAgfSk7XHJcblxyXG4gICAgY29uc29sZS5sb2coYENvbnRlbnQgcmV2aXNpb24gY29tcGxldGVkIGZvciB3b3JrZmxvdyAke3JlcXVlc3Qud29ya2Zsb3dJZH1gKTtcclxuXHJcbiAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgIGNvbnNvbGUuZXJyb3IoYENvbnRlbnQgcmV2aXNpb24gZmFpbGVkIGZvciB3b3JrZmxvdyAke3JlcXVlc3Qud29ya2Zsb3dJZH06YCwgZXJyb3IpO1xyXG5cclxuICAgIC8vIFNlbmQgZXJyb3IgcmVzcG9uc2UgYmFjayB0byBvcmNoZXN0cmF0b3JcclxuICAgIGF3YWl0IHNlbmRSZXNwb25zZVRvT3JjaGVzdHJhdG9yKHtcclxuICAgICAgd29ya2Zsb3dJZDogcmVxdWVzdC53b3JrZmxvd0lkLFxyXG4gICAgICBzdGVwSWQ6IHJlcXVlc3Quc3RlcElkLFxyXG4gICAgICBtZXNzYWdlVHlwZTogJ2Vycm9yJyxcclxuICAgICAgcGF5bG9hZDoge1xyXG4gICAgICAgIHN1Y2Nlc3M6IGZhbHNlLFxyXG4gICAgICAgIGVycm9yOiBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6ICdVbmtub3duIGVycm9yJyxcclxuICAgICAgICByZXRyeWFibGU6IGlzUmV0cnlhYmxlRXJyb3IoZXJyb3IpLFxyXG4gICAgICB9LFxyXG4gICAgfSk7XHJcbiAgfVxyXG59XHJcblxyXG4vKipcclxuICogR2VuZXJhdGUgY29udGVudCB1c2luZyBBSSB3aXRoIHVzZXIgY29udGV4dFxyXG4gKi9cclxuYXN5bmMgZnVuY3Rpb24gZ2VuZXJhdGVDb250ZW50KGlucHV0OiBzdHJpbmcsIHVzZXJQcmVmZXJlbmNlczogVXNlclByZWZlcmVuY2VzKTogUHJvbWlzZTxDb250ZW50R2VuZXJhdGlvblJlc3BvbnNlPiB7XHJcbiAgLy8gQ3JlYXRlIHByb21wdCB0ZW1wbGF0ZSB3aXRoIHVzZXIgY29udGV4dFxyXG4gIGNvbnN0IHByb21wdCA9IGNyZWF0ZUNvbnRlbnRHZW5lcmF0aW9uUHJvbXB0KGlucHV0LCB1c2VyUHJlZmVyZW5jZXMpO1xyXG4gIFxyXG4gIGNvbnNvbGUubG9nKCdHZW5lcmF0ZWQgcHJvbXB0IGZvciBjb250ZW50IGNyZWF0aW9uOicsIHByb21wdC5zdWJzdHJpbmcoMCwgMjAwKSArICcuLi4nKTtcclxuXHJcbiAgLy8gU2ltdWxhdGUgQUkgY29udGVudCBnZW5lcmF0aW9uIChpbiByZWFsIGltcGxlbWVudGF0aW9uLCB0aGlzIHdvdWxkIGNhbGwgYW4gQUkgc2VydmljZSlcclxuICBjb25zdCBnZW5lcmF0ZWRDb250ZW50ID0gYXdhaXQgc2ltdWxhdGVBSUNvbnRlbnRHZW5lcmF0aW9uKHByb21wdCwgdXNlclByZWZlcmVuY2VzKTtcclxuICBcclxuICByZXR1cm4gZ2VuZXJhdGVkQ29udGVudDtcclxufVxyXG5cclxuLyoqXHJcbiAqIFJldmlzZSBjb250ZW50IGJhc2VkIG9uIGZlZWRiYWNrXHJcbiAqL1xyXG5hc3luYyBmdW5jdGlvbiByZXZpc2VDb250ZW50KFxyXG4gIGN1cnJlbnRDb250ZW50OiBzdHJpbmcsXHJcbiAgZmVlZGJhY2s6IHN0cmluZyxcclxuICByZXZpc2lvblR5cGU6IHN0cmluZyxcclxuICB1c2VyUHJlZmVyZW5jZXM6IFVzZXJQcmVmZXJlbmNlc1xyXG4pOiBQcm9taXNlPENvbnRlbnRHZW5lcmF0aW9uUmVzcG9uc2U+IHtcclxuICAvLyBDcmVhdGUgcmV2aXNpb24gcHJvbXB0XHJcbiAgY29uc3QgcHJvbXB0ID0gY3JlYXRlUmV2aXNpb25Qcm9tcHQoY3VycmVudENvbnRlbnQsIGZlZWRiYWNrLCByZXZpc2lvblR5cGUsIHVzZXJQcmVmZXJlbmNlcyk7XHJcbiAgXHJcbiAgY29uc29sZS5sb2coJ0dlbmVyYXRlZCBwcm9tcHQgZm9yIGNvbnRlbnQgcmV2aXNpb246JywgcHJvbXB0LnN1YnN0cmluZygwLCAyMDApICsgJy4uLicpO1xyXG5cclxuICAvLyBTaW11bGF0ZSBBSSBjb250ZW50IHJldmlzaW9uXHJcbiAgY29uc3QgcmV2aXNlZENvbnRlbnQgPSBhd2FpdCBzaW11bGF0ZUFJQ29udGVudEdlbmVyYXRpb24ocHJvbXB0LCB1c2VyUHJlZmVyZW5jZXMpO1xyXG4gIFxyXG4gIHJldHVybiByZXZpc2VkQ29udGVudDtcclxufVxyXG5cclxuLyoqXHJcbiAqIENyZWF0ZSBjb250ZW50IGdlbmVyYXRpb24gcHJvbXB0IHdpdGggdXNlciBjb250ZXh0XHJcbiAqL1xyXG5mdW5jdGlvbiBjcmVhdGVDb250ZW50R2VuZXJhdGlvblByb21wdChpbnB1dDogc3RyaW5nLCB1c2VyUHJlZmVyZW5jZXM6IFVzZXJQcmVmZXJlbmNlcyk6IHN0cmluZyB7XHJcbiAgY29uc3QgYmFzZVByb21wdCA9IGBcclxuWW91IGFyZSBhIHByb2Zlc3Npb25hbCBjb250ZW50IHdyaXRlciB0YXNrZWQgd2l0aCBjcmVhdGluZyBhIGhpZ2gtcXVhbGl0eSBibG9nIHBvc3QgYmFzZWQgb24gdGhlIGZvbGxvd2luZyBpbnB1dDpcclxuXHJcbklOUFVUOiBcIiR7aW5wdXR9XCJcclxuXHJcbldSSVRJTkcgR1VJREVMSU5FUzpcclxuLSBUb25lOiAke3VzZXJQcmVmZXJlbmNlcy50b25lIHx8ICdjb252ZXJzYXRpb25hbCd9XHJcbi0gTGVuZ3RoOiAke3VzZXJQcmVmZXJlbmNlcy5sZW5ndGggfHwgJ21lZGl1bSd9ICgke2dldExlbmd0aEd1aWRlbGluZSh1c2VyUHJlZmVyZW5jZXMubGVuZ3RoKX0pXHJcbi0gVGFyZ2V0IEF1ZGllbmNlOiAke3VzZXJQcmVmZXJlbmNlcy50YXJnZXRBdWRpZW5jZSB8fCAnZ2VuZXJhbCBhdWRpZW5jZSd9XHJcbi0gV3JpdGluZyBTdHlsZTogJHt1c2VyUHJlZmVyZW5jZXMud3JpdGluZ1N0eWxlIHx8ICdjbGVhciBhbmQgZW5nYWdpbmcnfVxyXG5cclxuUkVRVUlSRU1FTlRTOlxyXG4xLiBDcmVhdGUgYW4gZW5nYWdpbmcgdGl0bGUgdGhhdCBjYXB0dXJlcyB0aGUgbWFpbiB0aGVtZVxyXG4yLiBXcml0ZSBhIGNvbXBlbGxpbmcgaW50cm9kdWN0aW9uIHRoYXQgaG9va3MgdGhlIHJlYWRlclxyXG4zLiBEZXZlbG9wIHRoZSBtYWluIGNvbnRlbnQgd2l0aCBjbGVhciBzdHJ1Y3R1cmUgYW5kIGZsb3dcclxuNC4gSW5jbHVkZSByZWxldmFudCBleGFtcGxlcyBvciBhbmVjZG90ZXMgd2hlcmUgYXBwcm9wcmlhdGVcclxuNS4gRW5kIHdpdGggYSBzdHJvbmcgY29uY2x1c2lvbiB0aGF0IHJlaW5mb3JjZXMga2V5IHBvaW50c1xyXG42LiBFbnN1cmUgdGhlIGNvbnRlbnQgaXMgb3JpZ2luYWwsIGluZm9ybWF0aXZlLCBhbmQgdmFsdWFibGUgdG8gcmVhZGVyc1xyXG5cclxuU1RSVUNUVVJFOlxyXG4tIFRpdGxlOiBDbGVhciBhbmQgZW5nYWdpbmdcclxuLSBJbnRyb2R1Y3Rpb246IDEtMiBwYXJhZ3JhcGhzXHJcbi0gTWFpbiBDb250ZW50OiAzLTUgc2VjdGlvbnMgd2l0aCBzdWJoZWFkaW5nc1xyXG4tIENvbmNsdXNpb246IDEtMiBwYXJhZ3JhcGhzXHJcblxyXG5QbGVhc2UgZ2VuZXJhdGUgYSBjb21wbGV0ZSBibG9nIHBvc3QgdGhhdCB0cmFuc2Zvcm1zIHRoZSBpbnB1dCBpbnRvIHByb2Zlc3Npb25hbCwgcHVibGlzaGFibGUgY29udGVudC5cclxuYDtcclxuXHJcbiAgcmV0dXJuIGJhc2VQcm9tcHQudHJpbSgpO1xyXG59XHJcblxyXG4vKipcclxuICogQ3JlYXRlIHJldmlzaW9uIHByb21wdCBiYXNlZCBvbiBmZWVkYmFja1xyXG4gKi9cclxuZnVuY3Rpb24gY3JlYXRlUmV2aXNpb25Qcm9tcHQoXHJcbiAgY3VycmVudENvbnRlbnQ6IHN0cmluZyxcclxuICBmZWVkYmFjazogc3RyaW5nLFxyXG4gIHJldmlzaW9uVHlwZTogc3RyaW5nLFxyXG4gIHVzZXJQcmVmZXJlbmNlczogVXNlclByZWZlcmVuY2VzXHJcbik6IHN0cmluZyB7XHJcbiAgY29uc3QgYmFzZVByb21wdCA9IGBcclxuWW91IGFyZSB0YXNrZWQgd2l0aCByZXZpc2luZyB0aGUgZm9sbG93aW5nIGJsb2cgcG9zdCBiYXNlZCBvbiBzcGVjaWZpYyBmZWVkYmFjazpcclxuXHJcbkNVUlJFTlQgQ09OVEVOVDpcclxuXCIke2N1cnJlbnRDb250ZW50fVwiXHJcblxyXG5GRUVEQkFDSzogXCIke2ZlZWRiYWNrfVwiXHJcblxyXG5SRVZJU0lPTiBUWVBFOiAke3JldmlzaW9uVHlwZX1cclxuXHJcbldSSVRJTkcgR1VJREVMSU5FUzpcclxuLSBUb25lOiAke3VzZXJQcmVmZXJlbmNlcy50b25lIHx8ICdjb252ZXJzYXRpb25hbCd9XHJcbi0gVGFyZ2V0IEF1ZGllbmNlOiAke3VzZXJQcmVmZXJlbmNlcy50YXJnZXRBdWRpZW5jZSB8fCAnZ2VuZXJhbCBhdWRpZW5jZSd9XHJcbi0gV3JpdGluZyBTdHlsZTogJHt1c2VyUHJlZmVyZW5jZXMud3JpdGluZ1N0eWxlIHx8ICdjbGVhciBhbmQgZW5nYWdpbmcnfVxyXG5cclxuUkVWSVNJT04gSU5TVFJVQ1RJT05TOlxyXG4ke2dldFJldmlzaW9uSW5zdHJ1Y3Rpb25zKHJldmlzaW9uVHlwZSl9XHJcblxyXG5QbGVhc2UgcmV2aXNlIHRoZSBjb250ZW50IGFkZHJlc3NpbmcgdGhlIHNwZWNpZmljIGZlZWRiYWNrIHdoaWxlIG1haW50YWluaW5nIHRoZSBvdmVyYWxsIHF1YWxpdHkgYW5kIHN0cnVjdHVyZS5cclxuYDtcclxuXHJcbiAgcmV0dXJuIGJhc2VQcm9tcHQudHJpbSgpO1xyXG59XHJcblxyXG4vKipcclxuICogR2V0IHJldmlzaW9uIGluc3RydWN0aW9ucyBiYXNlZCBvbiB0eXBlXHJcbiAqL1xyXG5mdW5jdGlvbiBnZXRSZXZpc2lvbkluc3RydWN0aW9ucyhyZXZpc2lvblR5cGU6IHN0cmluZyk6IHN0cmluZyB7XHJcbiAgc3dpdGNoIChyZXZpc2lvblR5cGUpIHtcclxuICAgIGNhc2UgJ2NvbnRlbnQnOlxyXG4gICAgICByZXR1cm4gJy0gRm9jdXMgb24gaW1wcm92aW5nIHRoZSBmYWN0dWFsIGFjY3VyYWN5LCBkZXB0aCwgYW5kIHJlbGV2YW5jZSBvZiB0aGUgY29udGVudFxcbi0gQWRkIG9yIHJlbW92ZSBpbmZvcm1hdGlvbiBhcyBuZWVkZWRcXG4tIEVuc3VyZSBhbGwgY2xhaW1zIGFyZSB3ZWxsLXN1cHBvcnRlZCc7XHJcbiAgICBcclxuICAgIGNhc2UgJ3N0eWxlJzpcclxuICAgICAgcmV0dXJuICctIEFkanVzdCB0aGUgd3JpdGluZyBzdHlsZSwgdm9pY2UsIGFuZCB0b25lXFxuLSBJbXByb3ZlIHNlbnRlbmNlIHN0cnVjdHVyZSBhbmQgd29yZCBjaG9pY2VcXG4tIEVuaGFuY2UgcmVhZGFiaWxpdHkgYW5kIGZsb3cnO1xyXG4gICAgXHJcbiAgICBjYXNlICdzdHJ1Y3R1cmUnOlxyXG4gICAgICByZXR1cm4gJy0gUmVvcmdhbml6ZSBjb250ZW50IGZvciBiZXR0ZXIgbG9naWNhbCBmbG93XFxuLSBJbXByb3ZlIGhlYWRpbmdzIGFuZCBzdWJoZWFkaW5nc1xcbi0gRW5oYW5jZSB0cmFuc2l0aW9ucyBiZXR3ZWVuIHNlY3Rpb25zJztcclxuICAgIFxyXG4gICAgY2FzZSAndG9uZSc6XHJcbiAgICAgIHJldHVybiAnLSBBZGp1c3QgdGhlIG92ZXJhbGwgdG9uZSB0byBiZXR0ZXIgbWF0Y2ggdGhlIHRhcmdldCBhdWRpZW5jZVxcbi0gTW9kaWZ5IGxhbmd1YWdlIGZvcm1hbGl0eSBhcyBuZWVkZWRcXG4tIEVuc3VyZSBjb25zaXN0ZW50IHZvaWNlIHRocm91Z2hvdXQnO1xyXG4gICAgXHJcbiAgICBkZWZhdWx0OlxyXG4gICAgICByZXR1cm4gJy0gQWRkcmVzcyB0aGUgc3BlY2lmaWMgZmVlZGJhY2sgcHJvdmlkZWRcXG4tIE1haW50YWluIG92ZXJhbGwgY29udGVudCBxdWFsaXR5XFxuLSBQcmVzZXJ2ZSB0aGUgY29yZSBtZXNzYWdlIGFuZCB2YWx1ZSc7XHJcbiAgfVxyXG59XHJcblxyXG4vKipcclxuICogR2V0IGxlbmd0aCBndWlkZWxpbmUgYmFzZWQgb24gcHJlZmVyZW5jZVxyXG4gKi9cclxuZnVuY3Rpb24gZ2V0TGVuZ3RoR3VpZGVsaW5lKGxlbmd0aD86IHN0cmluZyk6IHN0cmluZyB7XHJcbiAgc3dpdGNoIChsZW5ndGgpIHtcclxuICAgIGNhc2UgJ3Nob3J0JzpcclxuICAgICAgcmV0dXJuICc1MDAtODAwIHdvcmRzJztcclxuICAgIGNhc2UgJ21lZGl1bSc6XHJcbiAgICAgIHJldHVybiAnODAwLTE1MDAgd29yZHMnO1xyXG4gICAgY2FzZSAnbG9uZyc6XHJcbiAgICAgIHJldHVybiAnMTUwMC0yNTAwIHdvcmRzJztcclxuICAgIGRlZmF1bHQ6XHJcbiAgICAgIHJldHVybiAnODAwLTE1MDAgd29yZHMnO1xyXG4gIH1cclxufVxyXG5cclxuLyoqXHJcbiAqIFNpbXVsYXRlIEFJIGNvbnRlbnQgZ2VuZXJhdGlvbiAocGxhY2Vob2xkZXIgZm9yIGFjdHVhbCBBSSBpbnRlZ3JhdGlvbilcclxuICovXHJcbmFzeW5jIGZ1bmN0aW9uIHNpbXVsYXRlQUlDb250ZW50R2VuZXJhdGlvbihcclxuICBwcm9tcHQ6IHN0cmluZyxcclxuICB1c2VyUHJlZmVyZW5jZXM6IFVzZXJQcmVmZXJlbmNlc1xyXG4pOiBQcm9taXNlPENvbnRlbnRHZW5lcmF0aW9uUmVzcG9uc2U+IHtcclxuICAvLyBJbiBhIHJlYWwgaW1wbGVtZW50YXRpb24sIHRoaXMgd291bGQgY2FsbCBhbiBBSSBzZXJ2aWNlIGxpa2UgT3BlbkFJLCBDbGF1ZGUsIGV0Yy5cclxuICAvLyBGb3Igbm93LCB3ZSdsbCBzaW11bGF0ZSB0aGUgcmVzcG9uc2VcclxuICBcclxuICBjb25zdCBzaW11bGF0ZWRDb250ZW50ID0ge1xyXG4gICAgdGl0bGU6IFwiVHJhbnNmb3JtaW5nIElkZWFzIGludG8gQWN0aW9uOiBBIEd1aWRlIHRvIEVmZmVjdGl2ZSBJbXBsZW1lbnRhdGlvblwiLFxyXG4gICAgY29udGVudDogYFxyXG4jIEludHJvZHVjdGlvblxyXG5cclxuRXZlcnkgZ3JlYXQgYWNoaWV2ZW1lbnQgc3RhcnRzIHdpdGggYW4gaWRlYSwgYnV0IHRoZSBqb3VybmV5IGZyb20gY29uY2VwdCB0byByZWFsaXR5IGlzIHdoZXJlIG1vc3QgZHJlYW1zIGVpdGhlciBmbG91cmlzaCBvciBmYWRlLiBUaGUgYWJpbGl0eSB0byB0cmFuc2Zvcm0gYWJzdHJhY3QgdGhvdWdodHMgaW50byBjb25jcmV0ZSBhY3Rpb25zIGlzIHdoYXQgc2VwYXJhdGVzIHN1Y2Nlc3NmdWwgaW5kaXZpZHVhbHMgYW5kIG9yZ2FuaXphdGlvbnMgZnJvbSB0aG9zZSB3aG8gcmVtYWluIHBlcnBldHVhbGx5IGluIHRoZSBwbGFubmluZyBwaGFzZS5cclxuXHJcbiMgVGhlIEltcGxlbWVudGF0aW9uIE1pbmRzZXRcclxuXHJcblN1Y2Nlc3MgaW4gaW1wbGVtZW50YXRpb24gcmVxdWlyZXMgbW9yZSB0aGFuIGp1c3QgZ29vZCBpbnRlbnRpb25zLiBJdCBkZW1hbmRzIGEgZnVuZGFtZW50YWwgc2hpZnQgaW4gaG93IHdlIGFwcHJvYWNoIG91ciBnb2FscyBhbmQgY2hhbGxlbmdlcy4gVGhpcyBtaW5kc2V0IGVuY29tcGFzc2VzIHNldmVyYWwga2V5IHByaW5jaXBsZXM6XHJcblxyXG4jIyBDbGFyaXR5IG9mIFZpc2lvblxyXG5CZWZvcmUgdGFraW5nIGFueSBhY3Rpb24sIGl0J3MgY3J1Y2lhbCB0byBoYXZlIGEgY3J5c3RhbC1jbGVhciB1bmRlcnN0YW5kaW5nIG9mIHdoYXQgeW91J3JlIHRyeWluZyB0byBhY2hpZXZlLiBWYWd1ZSBnb2FscyBsZWFkIHRvIHZhZ3VlIHJlc3VsdHMuXHJcblxyXG4jIyBTeXN0ZW1hdGljIEFwcHJvYWNoXHJcbkJyZWFraW5nIGRvd24gbGFyZ2Ugb2JqZWN0aXZlcyBpbnRvIG1hbmFnZWFibGUsIGFjdGlvbmFibGUgc3RlcHMgbWFrZXMgZXZlbiB0aGUgbW9zdCBhbWJpdGlvdXMgcHJvamVjdHMgYWNoaWV2YWJsZS5cclxuXHJcbiMjIENvbnNpc3RlbnQgRXhlY3V0aW9uXHJcblJlZ3VsYXIsIGNvbnNpc3RlbnQgYWN0aW9uIHRydW1wcyBzcG9yYWRpYyBidXJzdHMgb2YgaW50ZW5zZSBlZmZvcnQgZXZlcnkgdGltZS5cclxuXHJcbiMgT3ZlcmNvbWluZyBDb21tb24gT2JzdGFjbGVzXHJcblxyXG5UaGUgcGF0aCBmcm9tIGlkZWEgdG8gaW1wbGVtZW50YXRpb24gaXMgcmFyZWx5IHNtb290aC4gVW5kZXJzdGFuZGluZyBhbmQgcHJlcGFyaW5nIGZvciBjb21tb24gb2JzdGFjbGVzIGNhbiBtYWtlIHRoZSBkaWZmZXJlbmNlIGJldHdlZW4gc3VjY2VzcyBhbmQgZmFpbHVyZS5cclxuXHJcbiMjIEFuYWx5c2lzIFBhcmFseXNpc1xyXG5UaGUgdGVuZGVuY3kgdG8gb3Zlci1hbmFseXplIGFuZCB1bmRlci1leGVjdXRlIGlzIG9uZSBvZiB0aGUgYmlnZ2VzdCBraWxsZXJzIG9mIGdvb2QgaWRlYXMuIFNvbWV0aW1lcywgaW1wZXJmZWN0IGFjdGlvbiBpcyBiZXR0ZXIgdGhhbiBwZXJmZWN0IGluYWN0aW9uLlxyXG5cclxuIyMgUmVzb3VyY2UgQ29uc3RyYWludHNcclxuTGltaXRlZCB0aW1lLCBtb25leSwgb3IgcGVyc29ubmVsIGFyZSBjb21tb24gY2hhbGxlbmdlcywgYnV0IHRoZXkgb2Z0ZW4gZm9yY2UgY3JlYXRpdmUgc29sdXRpb25zIHRoYXQgd291bGRuJ3QgaGF2ZSBlbWVyZ2VkIG90aGVyd2lzZS5cclxuXHJcbiMgQ29uY2x1c2lvblxyXG5cclxuVGhlIGdhcCBiZXR3ZWVuIGhhdmluZyBncmVhdCBpZGVhcyBhbmQgaW1wbGVtZW50aW5nIHRoZW0gc3VjY2Vzc2Z1bGx5IGlzIHdoZXJlIHRydWUgdmFsdWUgaXMgY3JlYXRlZC4gQnkgZGV2ZWxvcGluZyB0aGUgcmlnaHQgbWluZHNldCwgc3lzdGVtcywgYW5kIGhhYml0cywgYW55b25lIGNhbiBiZWNvbWUgbW9yZSBlZmZlY3RpdmUgYXQgdHVybmluZyB0aGVpciB2aXNpb24gaW50byByZWFsaXR5LlxyXG5cclxuUmVtZW1iZXI6IHRoZSB3b3JsZCBkb2Vzbid0IG5lZWQgbW9yZSBpZGVhc+KAlGl0IG5lZWRzIG1vcmUgcGVvcGxlIHdobyBjYW4gZXhlY3V0ZSBvbiB0aGUgaWRlYXMgdGhleSBhbHJlYWR5IGhhdmUuXHJcbiAgICBgLnRyaW0oKSxcclxuICAgIHN1bW1hcnk6IFwiQSBjb21wcmVoZW5zaXZlIGd1aWRlIG9uIHRyYW5zZm9ybWluZyBpZGVhcyBpbnRvIGFjdGlvbmFibGUgcmVzdWx0cyB0aHJvdWdoIHN5c3RlbWF0aWMgaW1wbGVtZW50YXRpb24gYW5kIG92ZXJjb21pbmcgY29tbW9uIG9ic3RhY2xlcy5cIixcclxuICAgIHdvcmRDb3VudDogMjg1LFxyXG4gICAgcmVhZGluZ1RpbWU6IDIsXHJcbiAgICB0YWdzOiBbXCJwcm9kdWN0aXZpdHlcIiwgXCJpbXBsZW1lbnRhdGlvblwiLCBcImdvYWwtc2V0dGluZ1wiLCBcInN1Y2Nlc3NcIiwgXCJtaW5kc2V0XCJdLFxyXG4gICAgcXVhbGl0eToge1xyXG4gICAgICBzY29yZTogOC41LFxyXG4gICAgICBpc3N1ZXM6IFtdLFxyXG4gICAgICBzdWdnZXN0aW9uczogW1xyXG4gICAgICAgIFwiQ29uc2lkZXIgYWRkaW5nIHNwZWNpZmljIGV4YW1wbGVzIG9yIGNhc2Ugc3R1ZGllc1wiLFxyXG4gICAgICAgIFwiQ291bGQgYmVuZWZpdCBmcm9tIGFjdGlvbmFibGUgdGlwcyBvciBjaGVja2xpc3RzXCJcclxuICAgICAgXVxyXG4gICAgfVxyXG4gIH07XHJcblxyXG4gIC8vIFNpbXVsYXRlIHByb2Nlc3NpbmcgdGltZVxyXG4gIGF3YWl0IG5ldyBQcm9taXNlKHJlc29sdmUgPT4gc2V0VGltZW91dChyZXNvbHZlLCAxMDAwKSk7XHJcblxyXG4gIHJldHVybiBzaW11bGF0ZWRDb250ZW50O1xyXG59XHJcblxyXG4vKipcclxuICogVmFsaWRhdGUgY29udGVudCBxdWFsaXR5XHJcbiAqL1xyXG5hc3luYyBmdW5jdGlvbiB2YWxpZGF0ZUNvbnRlbnQoY29udGVudDogQ29udGVudEdlbmVyYXRpb25SZXNwb25zZSk6IFByb21pc2U8e1xyXG4gIGlzVmFsaWQ6IGJvb2xlYW47XHJcbiAgaXNzdWVzOiBzdHJpbmdbXTtcclxuICBzdWdnZXN0aW9uczogc3RyaW5nW107XHJcbn0+IHtcclxuICBjb25zdCBpc3N1ZXM6IHN0cmluZ1tdID0gW107XHJcbiAgY29uc3Qgc3VnZ2VzdGlvbnM6IHN0cmluZ1tdID0gW107XHJcblxyXG4gIC8vIEJhc2ljIHZhbGlkYXRpb24gY2hlY2tzXHJcbiAgaWYgKCFjb250ZW50LnRpdGxlIHx8IGNvbnRlbnQudGl0bGUubGVuZ3RoIDwgMTApIHtcclxuICAgIGlzc3Vlcy5wdXNoKCdUaXRsZSBpcyB0b28gc2hvcnQgb3IgbWlzc2luZycpO1xyXG4gIH1cclxuXHJcbiAgaWYgKCFjb250ZW50LmNvbnRlbnQgfHwgY29udGVudC5jb250ZW50Lmxlbmd0aCA8IDIwMCkge1xyXG4gICAgaXNzdWVzLnB1c2goJ0NvbnRlbnQgaXMgdG9vIHNob3J0Jyk7XHJcbiAgfVxyXG5cclxuICBpZiAoY29udGVudC53b3JkQ291bnQgPCAxMDApIHtcclxuICAgIGlzc3Vlcy5wdXNoKCdXb3JkIGNvdW50IGlzIHRvbyBsb3cgZm9yIGEgbWVhbmluZ2Z1bCBibG9nIHBvc3QnKTtcclxuICB9XHJcblxyXG4gIGlmIChjb250ZW50LnF1YWxpdHkuc2NvcmUgPCA2LjApIHtcclxuICAgIGlzc3Vlcy5wdXNoKCdDb250ZW50IHF1YWxpdHkgc2NvcmUgaXMgYmVsb3cgYWNjZXB0YWJsZSB0aHJlc2hvbGQnKTtcclxuICB9XHJcblxyXG4gIC8vIENvbnRlbnQgc3RydWN0dXJlIHZhbGlkYXRpb25cclxuICBpZiAoIWNvbnRlbnQuY29udGVudC5pbmNsdWRlcygnIycpKSB7XHJcbiAgICBzdWdnZXN0aW9ucy5wdXNoKCdDb25zaWRlciBhZGRpbmcgc2VjdGlvbiBoZWFkaW5ncyBmb3IgYmV0dGVyIHN0cnVjdHVyZScpO1xyXG4gIH1cclxuXHJcbiAgaWYgKGNvbnRlbnQuY29udGVudC5zcGxpdCgnXFxuXFxuJykubGVuZ3RoIDwgMykge1xyXG4gICAgc3VnZ2VzdGlvbnMucHVzaCgnQ29uc2lkZXIgYnJlYWtpbmcgY29udGVudCBpbnRvIG1vcmUgcGFyYWdyYXBocyBmb3IgcmVhZGFiaWxpdHknKTtcclxuICB9XHJcblxyXG4gIHJldHVybiB7XHJcbiAgICBpc1ZhbGlkOiBpc3N1ZXMubGVuZ3RoID09PSAwLFxyXG4gICAgaXNzdWVzLFxyXG4gICAgc3VnZ2VzdGlvbnM6IFsuLi5zdWdnZXN0aW9ucywgLi4uY29udGVudC5xdWFsaXR5LnN1Z2dlc3Rpb25zXVxyXG4gIH07XHJcbn1cclxuXHJcbi8qKlxyXG4gKiBMb2FkIHVzZXIgcHJlZmVyZW5jZXMgZnJvbSBEeW5hbW9EQlxyXG4gKi9cclxuYXN5bmMgZnVuY3Rpb24gbG9hZFVzZXJQcmVmZXJlbmNlcyh1c2VySWQ6IHN0cmluZyk6IFByb21pc2U8VXNlclByZWZlcmVuY2VzPiB7XHJcbiAgdHJ5IHtcclxuICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGR5bmFtb0NsaWVudC5zZW5kKG5ldyBHZXRJdGVtQ29tbWFuZCh7XHJcbiAgICAgIFRhYmxlTmFtZTogVVNFUl9UQUJMRSxcclxuICAgICAgS2V5OiB7XHJcbiAgICAgICAgaWQ6IHsgUzogdXNlcklkIH0sXHJcbiAgICAgIH0sXHJcbiAgICB9KSk7XHJcblxyXG4gICAgaWYgKCFyZXN1bHQuSXRlbSkge1xyXG4gICAgICBjb25zb2xlLmxvZyhgVXNlciAke3VzZXJJZH0gbm90IGZvdW5kLCB1c2luZyBkZWZhdWx0IHByZWZlcmVuY2VzYCk7XHJcbiAgICAgIHJldHVybiBnZXREZWZhdWx0VXNlclByZWZlcmVuY2VzKCk7XHJcbiAgICB9XHJcblxyXG4gICAgLy8gUGFyc2UgdXNlciBwcmVmZXJlbmNlcyBmcm9tIHRoZSB3cml0aW5nU3R5bGVDb250ZXh0IGZpZWxkXHJcbiAgICBjb25zdCB3cml0aW5nU3R5bGVDb250ZXh0ID0gcmVzdWx0Lkl0ZW0ud3JpdGluZ1N0eWxlQ29udGV4dD8uUztcclxuICAgIGlmICh3cml0aW5nU3R5bGVDb250ZXh0KSB7XHJcbiAgICAgIHRyeSB7XHJcbiAgICAgICAgcmV0dXJuIEpTT04ucGFyc2Uod3JpdGluZ1N0eWxlQ29udGV4dCk7XHJcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgY29uc29sZS53YXJuKCdGYWlsZWQgdG8gcGFyc2UgdXNlciB3cml0aW5nIHN0eWxlIGNvbnRleHQsIHVzaW5nIGRlZmF1bHRzJyk7XHJcbiAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICByZXR1cm4gZ2V0RGVmYXVsdFVzZXJQcmVmZXJlbmNlcygpO1xyXG5cclxuICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgY29uc29sZS5lcnJvcignRXJyb3IgbG9hZGluZyB1c2VyIHByZWZlcmVuY2VzOicsIGVycm9yKTtcclxuICAgIHJldHVybiBnZXREZWZhdWx0VXNlclByZWZlcmVuY2VzKCk7XHJcbiAgfVxyXG59XHJcblxyXG4vKipcclxuICogR2V0IGRlZmF1bHQgdXNlciBwcmVmZXJlbmNlc1xyXG4gKi9cclxuZnVuY3Rpb24gZ2V0RGVmYXVsdFVzZXJQcmVmZXJlbmNlcygpOiBVc2VyUHJlZmVyZW5jZXMge1xyXG4gIHJldHVybiB7XHJcbiAgICB0b25lOiAnY29udmVyc2F0aW9uYWwnLFxyXG4gICAgbGVuZ3RoOiAnbWVkaXVtJyxcclxuICAgIHRhcmdldEF1ZGllbmNlOiAnZ2VuZXJhbCBhdWRpZW5jZScsXHJcbiAgICB3cml0aW5nU3R5bGU6ICdjbGVhciBhbmQgZW5nYWdpbmcnLFxyXG4gICAgdG9waWNzOiBbXVxyXG4gIH07XHJcbn1cclxuXHJcbi8qKlxyXG4gKiBTZW5kIHJlc3BvbnNlIGJhY2sgdG8gb3JjaGVzdHJhdG9yXHJcbiAqL1xyXG5hc3luYyBmdW5jdGlvbiBzZW5kUmVzcG9uc2VUb09yY2hlc3RyYXRvcihyZXNwb25zZToge1xyXG4gIHdvcmtmbG93SWQ6IHN0cmluZztcclxuICBzdGVwSWQ6IHN0cmluZztcclxuICBtZXNzYWdlVHlwZTogJ3Jlc3BvbnNlJyB8ICdlcnJvcic7XHJcbiAgcGF5bG9hZDogYW55O1xyXG59KTogUHJvbWlzZTx2b2lkPiB7XHJcbiAgY29uc3QgbWVzc2FnZSA9IHtcclxuICAgIG1lc3NhZ2VJZDogdXVpZHY0KCksXHJcbiAgICB3b3JrZmxvd0lkOiByZXNwb25zZS53b3JrZmxvd0lkLFxyXG4gICAgc3RlcElkOiByZXNwb25zZS5zdGVwSWQsXHJcbiAgICBhZ2VudFR5cGU6ICdjb250ZW50LWdlbmVyYXRvcicsXHJcbiAgICBtZXNzYWdlVHlwZTogcmVzcG9uc2UubWVzc2FnZVR5cGUsXHJcbiAgICBwYXlsb2FkOiByZXNwb25zZS5wYXlsb2FkLFxyXG4gICAgdGltZXN0YW1wOiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXHJcbiAgfTtcclxuXHJcbiAgYXdhaXQgc3FzQ2xpZW50LnNlbmQobmV3IFNlbmRNZXNzYWdlQ29tbWFuZCh7XHJcbiAgICBRdWV1ZVVybDogT1JDSEVTVFJBVE9SX1FVRVVFLFxyXG4gICAgTWVzc2FnZUJvZHk6IEpTT04uc3RyaW5naWZ5KG1lc3NhZ2UpLFxyXG4gICAgTWVzc2FnZUF0dHJpYnV0ZXM6IHtcclxuICAgICAgd29ya2Zsb3dJZDoge1xyXG4gICAgICAgIFN0cmluZ1ZhbHVlOiByZXNwb25zZS53b3JrZmxvd0lkLFxyXG4gICAgICAgIERhdGFUeXBlOiAnU3RyaW5nJyxcclxuICAgICAgfSxcclxuICAgICAgc3RlcElkOiB7XHJcbiAgICAgICAgU3RyaW5nVmFsdWU6IHJlc3BvbnNlLnN0ZXBJZCxcclxuICAgICAgICBEYXRhVHlwZTogJ1N0cmluZycsXHJcbiAgICAgIH0sXHJcbiAgICAgIGFnZW50VHlwZToge1xyXG4gICAgICAgIFN0cmluZ1ZhbHVlOiAnY29udGVudC1nZW5lcmF0b3InLFxyXG4gICAgICAgIERhdGFUeXBlOiAnU3RyaW5nJyxcclxuICAgICAgfSxcclxuICAgIH0sXHJcbiAgfSkpO1xyXG59XHJcblxyXG4vKipcclxuICogUHVibGlzaCBldmVudCB0byBFdmVudEJyaWRnZVxyXG4gKi9cclxuYXN5bmMgZnVuY3Rpb24gcHVibGlzaEV2ZW50KGV2ZW50VHlwZTogc3RyaW5nLCBkZXRhaWw6IGFueSk6IFByb21pc2U8dm9pZD4ge1xyXG4gIGF3YWl0IGV2ZW50QnJpZGdlQ2xpZW50LnNlbmQobmV3IFB1dEV2ZW50c0NvbW1hbmQoe1xyXG4gICAgRW50cmllczogW3tcclxuICAgICAgU291cmNlOiAnYXV0b21hdGVkLWJsb2ctcG9zdGVyLmNvbnRlbnQtYWdlbnQnLFxyXG4gICAgICBEZXRhaWxUeXBlOiBldmVudFR5cGUsXHJcbiAgICAgIERldGFpbDogSlNPTi5zdHJpbmdpZnkoZGV0YWlsKSxcclxuICAgICAgRXZlbnRCdXNOYW1lOiBFVkVOVF9CVVMsXHJcbiAgICB9XSxcclxuICB9KSk7XHJcbn1cclxuXHJcbi8qKlxyXG4gKiBEZXRlcm1pbmUgaWYgYW4gZXJyb3IgaXMgcmV0cnlhYmxlXHJcbiAqL1xyXG5mdW5jdGlvbiBpc1JldHJ5YWJsZUVycm9yKGVycm9yOiBhbnkpOiBib29sZWFuIHtcclxuICAvLyBOZXR3b3JrIGVycm9ycywgdGltZW91dHMsIGFuZCB0ZW1wb3Jhcnkgc2VydmljZSBpc3N1ZXMgYXJlIHJldHJ5YWJsZVxyXG4gIGlmIChlcnJvci5jb2RlID09PSAnTmV0d29ya2luZ0Vycm9yJyB8fCBlcnJvci5jb2RlID09PSAnVGltZW91dEVycm9yJykge1xyXG4gICAgcmV0dXJuIHRydWU7XHJcbiAgfVxyXG5cclxuICAvLyBSYXRlIGxpbWl0aW5nIGVycm9ycyBhcmUgcmV0cnlhYmxlXHJcbiAgaWYgKGVycm9yLnN0YXR1c0NvZGUgPT09IDQyOSkge1xyXG4gICAgcmV0dXJuIHRydWU7XHJcbiAgfVxyXG5cclxuICAvLyBTZXJ2ZXIgZXJyb3JzICg1eHgpIGFyZSBnZW5lcmFsbHkgcmV0cnlhYmxlXHJcbiAgaWYgKGVycm9yLnN0YXR1c0NvZGUgPj0gNTAwKSB7XHJcbiAgICByZXR1cm4gdHJ1ZTtcclxuICB9XHJcblxyXG4gIC8vIENsaWVudCBlcnJvcnMgKDR4eCkgYXJlIGdlbmVyYWxseSBub3QgcmV0cnlhYmxlXHJcbiAgcmV0dXJuIGZhbHNlO1xyXG59XHJcblxyXG4vLyBFeHBvcnQgdHlwZXMgZm9yIHRlc3RpbmdcclxuZXhwb3J0IHR5cGUge1xyXG4gIENvbnRlbnRHZW5lcmF0aW9uUmVxdWVzdCxcclxuICBDb250ZW50R2VuZXJhdGlvblJlc3BvbnNlLFxyXG4gIFJldmlzaW9uUmVxdWVzdCxcclxuICBVc2VyUHJlZmVyZW5jZXNcclxufTsiXX0=