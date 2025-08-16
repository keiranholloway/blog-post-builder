"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = void 0;
const client_dynamodb_1 = require("@aws-sdk/client-dynamodb");
const client_eventbridge_1 = require("@aws-sdk/client-eventbridge");
const client_sqs_1 = require("@aws-sdk/client-sqs");
const client_bedrock_agent_runtime_1 = require("@aws-sdk/client-bedrock-agent-runtime");
const uuid_1 = require("uuid");
// Initialize AWS clients
const dynamoClient = new client_dynamodb_1.DynamoDBClient({ region: process.env.AWS_REGION });
const eventBridgeClient = new client_eventbridge_1.EventBridgeClient({ region: process.env.AWS_REGION });
const sqsClient = new client_sqs_1.SQSClient({ region: process.env.AWS_REGION });
const bedrockAgentClient = new client_bedrock_agent_runtime_1.BedrockAgentRuntimeClient({ region: process.env.AWS_REGION });
// Environment variables
const USER_TABLE = process.env.USER_TABLE_NAME;
const CONTENT_TABLE = process.env.CONTENT_TABLE_NAME;
const EVENT_BUS = process.env.EVENT_BUS_NAME;
const ORCHESTRATOR_QUEUE = process.env.ORCHESTRATOR_QUEUE_URL;
const BEDROCK_AGENT_ID = process.env.BEDROCK_AGENT_ID;
const BEDROCK_AGENT_ALIAS_ID = process.env.BEDROCK_AGENT_ALIAS_ID;
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
 * Generate content using Bedrock Agent with user context
 */
async function generateContent(input, userPreferences) {
    // Create prompt template with user context
    const prompt = createContentGenerationPrompt(input, userPreferences);
    console.log('Generated prompt for content creation:', prompt.substring(0, 200) + '...');
    // Call Bedrock Agent for content generation
    const generatedContent = await callBedrockAgent(prompt, 'content-generation');
    return parseBedrockResponse(generatedContent, userPreferences);
}
/**
 * Revise content based on feedback using Bedrock Agent
 */
async function reviseContent(currentContent, feedback, revisionType, userPreferences) {
    // Create revision prompt
    const prompt = createRevisionPrompt(currentContent, feedback, revisionType, userPreferences);
    console.log('Generated prompt for content revision:', prompt.substring(0, 200) + '...');
    // Call Bedrock Agent for content revision
    const revisedContent = await callBedrockAgent(prompt, 'content-revision');
    return parseBedrockResponse(revisedContent, userPreferences);
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
 * Call Bedrock Agent for content generation
 */
async function callBedrockAgent(prompt, sessionId) {
    try {
        const command = new client_bedrock_agent_runtime_1.InvokeAgentCommand({
            agentId: BEDROCK_AGENT_ID,
            agentAliasId: BEDROCK_AGENT_ALIAS_ID,
            sessionId: sessionId,
            inputText: prompt,
        });
        console.log(`Calling Bedrock Agent ${BEDROCK_AGENT_ID} with session ${sessionId}`);
        const response = await bedrockAgentClient.send(command);
        // Process the streaming response
        let fullResponse = '';
        if (response.completion) {
            for await (const chunk of response.completion) {
                if (chunk.chunk?.bytes) {
                    const chunkText = new TextDecoder().decode(chunk.chunk.bytes);
                    fullResponse += chunkText;
                }
            }
        }
        console.log(`Bedrock Agent response length: ${fullResponse.length} characters`);
        return fullResponse;
    }
    catch (error) {
        console.error('Error calling Bedrock Agent:', error);
        throw new Error(`Bedrock Agent call failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}
/**
 * Parse Bedrock Agent response into structured content format
 */
function parseBedrockResponse(response, userPreferences) {
    // Extract title (look for first # heading or create from first line)
    const titleMatch = response.match(/^#\s+(.+)$/m);
    const title = titleMatch ? titleMatch[1].trim() :
        response.split('\n')[0].replace(/^#+\s*/, '').trim() ||
            'Generated Blog Post';
    // Clean up content (remove title if it was extracted)
    let content = response;
    if (titleMatch) {
        content = response.replace(titleMatch[0], '').trim();
    }
    // Calculate metrics
    const wordCount = content.split(/\s+/).filter(word => word.length > 0).length;
    const readingTime = Math.max(1, Math.ceil(wordCount / 200)); // 200 words per minute
    // Extract potential tags from content (look for technical terms, topics)
    const tags = extractTagsFromContent(content);
    // Generate summary (first paragraph or first 200 characters)
    const summary = generateSummary(content);
    // Assess quality
    const quality = assessContentQuality(content, wordCount);
    return {
        title,
        content,
        summary,
        wordCount,
        readingTime,
        tags,
        quality
    };
}
/**
 * Extract relevant tags from content
 */
function extractTagsFromContent(content) {
    const commonTechTerms = [
        'aws', 'azure', 'gcp', 'cloud', 'kubernetes', 'docker', 'serverless',
        'devops', 'finops', 'infrastructure', 'architecture', 'security',
        'platform engineering', 'backstage', 'cost optimization', 'automation',
        'monitoring', 'observability', 'microservices', 'containers'
    ];
    const contentLower = content.toLowerCase();
    const foundTags = commonTechTerms.filter(term => contentLower.includes(term.toLowerCase()));
    // Add some default tags based on Keiran's expertise
    const defaultTags = ['cloud', 'enterprise', 'technology'];
    return [...new Set([...foundTags, ...defaultTags])].slice(0, 8);
}
/**
 * Generate summary from content
 */
function generateSummary(content) {
    // Find first paragraph or first 200 characters
    const paragraphs = content.split('\n\n').filter(p => p.trim().length > 0);
    if (paragraphs.length > 0) {
        const firstParagraph = paragraphs[0].replace(/^#+\s*/, '').trim();
        if (firstParagraph.length <= 300) {
            return firstParagraph;
        }
    }
    // Fallback to first 200 characters
    return content.substring(0, 200).trim() + '...';
}
/**
 * Assess content quality
 */
function assessContentQuality(content, wordCount) {
    const issues = [];
    const suggestions = [];
    let score = 10;
    // Check word count
    if (wordCount < 300) {
        issues.push('Content is quite short for a blog post');
        score -= 2;
    }
    else if (wordCount < 500) {
        suggestions.push('Consider expanding the content for better depth');
        score -= 0.5;
    }
    // Check for structure
    if (!content.includes('#')) {
        suggestions.push('Consider adding section headings for better structure');
        score -= 0.5;
    }
    // Check for paragraphs
    const paragraphs = content.split('\n\n').filter(p => p.trim().length > 0);
    if (paragraphs.length < 3) {
        suggestions.push('Consider breaking content into more paragraphs for readability');
        score -= 0.5;
    }
    // Ensure minimum quality
    score = Math.max(6.0, score);
    return {
        score: Math.round(score * 10) / 10,
        issues,
        suggestions
    };
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY29udGVudC1nZW5lcmF0aW9uLWFnZW50LmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiY29udGVudC1nZW5lcmF0aW9uLWFnZW50LnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUNBLDhEQUE2RjtBQUM3RixvRUFBa0Y7QUFDbEYsb0RBQW9FO0FBQ3BFLHdGQUFzRztBQUN0RywrQkFBb0M7QUE2Q3BDLHlCQUF5QjtBQUN6QixNQUFNLFlBQVksR0FBRyxJQUFJLGdDQUFjLENBQUMsRUFBRSxNQUFNLEVBQUUsT0FBTyxDQUFDLEdBQUcsQ0FBQyxVQUFVLEVBQUUsQ0FBQyxDQUFDO0FBQzVFLE1BQU0saUJBQWlCLEdBQUcsSUFBSSxzQ0FBaUIsQ0FBQyxFQUFFLE1BQU0sRUFBRSxPQUFPLENBQUMsR0FBRyxDQUFDLFVBQVUsRUFBRSxDQUFDLENBQUM7QUFDcEYsTUFBTSxTQUFTLEdBQUcsSUFBSSxzQkFBUyxDQUFDLEVBQUUsTUFBTSxFQUFFLE9BQU8sQ0FBQyxHQUFHLENBQUMsVUFBVSxFQUFFLENBQUMsQ0FBQztBQUNwRSxNQUFNLGtCQUFrQixHQUFHLElBQUksd0RBQXlCLENBQUMsRUFBRSxNQUFNLEVBQUUsT0FBTyxDQUFDLEdBQUcsQ0FBQyxVQUFVLEVBQUUsQ0FBQyxDQUFDO0FBRTdGLHdCQUF3QjtBQUN4QixNQUFNLFVBQVUsR0FBRyxPQUFPLENBQUMsR0FBRyxDQUFDLGVBQWdCLENBQUM7QUFDaEQsTUFBTSxhQUFhLEdBQUcsT0FBTyxDQUFDLEdBQUcsQ0FBQyxrQkFBbUIsQ0FBQztBQUN0RCxNQUFNLFNBQVMsR0FBRyxPQUFPLENBQUMsR0FBRyxDQUFDLGNBQWUsQ0FBQztBQUM5QyxNQUFNLGtCQUFrQixHQUFHLE9BQU8sQ0FBQyxHQUFHLENBQUMsc0JBQXVCLENBQUM7QUFDL0QsTUFBTSxnQkFBZ0IsR0FBRyxPQUFPLENBQUMsR0FBRyxDQUFDLGdCQUFpQixDQUFDO0FBQ3ZELE1BQU0sc0JBQXNCLEdBQUcsT0FBTyxDQUFDLEdB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QkFDOUIsWUFBWSxFQUFFLFNBQVM7YUFDeEIsQ0FBQztLQUNILENBQUMsQ0FBQyxDQUFDO0FBQ04sQ0FBQztBQUVEOztHQUVHO0FBQ0gsU0FBUyxnQkFBZ0IsQ0FBQyxLQUFVO0lBQ2xDLHVFQUF1RTtJQUN2RSxJQUFJLEtBQUssQ0FBQyxJQUFJLEtBQUssaUJBQWlCLElBQUksS0FBSyxDQUFDLElBQUksS0FBSyxjQUFjLEVBQUU7UUFDckUsT0FBTyxJQUFJLENBQUM7S0FDYjtJQUVELHFDQUFxQztJQUNyQyxJQUFJLEtBQUssQ0FBQyxVQUFVLEtBQUssR0FBRyxFQUFFO1FBQzVCLE9BQU8sSUFBSSxDQUFDO0tBQ2I7SUFFRCw4Q0FBOEM7SUFDOUMsSUFBSSxLQUFLLENBQUMsVUFBVSxJQUFJLEdBQUcsRUFBRTtRQUMzQixPQUFPLElBQUksQ0FBQztLQUNiO0lBRUQsa0RBQWtEO0lBQ2xELE9BQU8sS0FBSyxDQUFDO0FBQ2YsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IFNRU0V2ZW50LCBDb250ZXh0IH0gZnJvbSAnYXdzLWxhbWJkYSc7XHJcbmltcG9ydCB7IER5bmFtb0RCQ2xpZW50LCBHZXRJdGVtQ29tbWFuZCwgVXBkYXRlSXRlbUNvbW1hbmQgfSBmcm9tICdAYXdzLXNkay9jbGllbnQtZHluYW1vZGInO1xyXG5pbXBvcnQgeyBFdmVudEJyaWRnZUNsaWVudCwgUHV0RXZlbnRzQ29tbWFuZCB9IGZyb20gJ0Bhd3Mtc2RrL2NsaWVudC1ldmVudGJyaWRnZSc7XHJcbmltcG9ydCB7IFNRU0NsaWVudCwgU2VuZE1lc3NhZ2VDb21tYW5kIH0gZnJvbSAnQGF3cy1zZGsvY2xpZW50LXNxcyc7XHJcbmltcG9ydCB7IEJlZHJvY2tBZ2VudFJ1bnRpbWVDbGllbnQsIEludm9rZUFnZW50Q29tbWFuZCB9IGZyb20gJ0Bhd3Mtc2RrL2NsaWVudC1iZWRyb2NrLWFnZW50LXJ1bnRpbWUnO1xyXG5pbXBvcnQgeyB2NCBhcyB1dWlkdjQgfSBmcm9tICd1dWlkJztcclxuXHJcbi8vIFR5cGVzIGZvciBjb250ZW50IGdlbmVyYXRpb25cclxuaW50ZXJmYWNlIENvbnRlbnRHZW5lcmF0aW9uUmVxdWVzdCB7XHJcbiAgd29ya2Zsb3dJZDogc3RyaW5nO1xyXG4gIHN0ZXBJZDogc3RyaW5nO1xyXG4gIGlucHV0OiBzdHJpbmc7XHJcbiAgdXNlcklkOiBzdHJpbmc7XHJcbiAgY29udGV4dDoge1xyXG4gICAgcHJldmlvdXNTdGVwczogYW55W107XHJcbiAgICB1c2VyUHJlZmVyZW5jZXM6IFVzZXJQcmVmZXJlbmNlcztcclxuICB9O1xyXG59XHJcblxyXG5pbnRlcmZhY2UgVXNlclByZWZlcmVuY2VzIHtcclxuICB3cml0aW5nU3R5bGU/OiBzdHJpbmc7XHJcbiAgdG9uZT86ICdwcm9mZXNzaW9uYWwnIHwgJ2Nhc3VhbCcgfCAndGVjaG5pY2FsJyB8ICdjb252ZXJzYXRpb25hbCc7XHJcbiAgbGVuZ3RoPzogJ3Nob3J0JyB8ICdtZWRpdW0nIHwgJ2xvbmcnO1xyXG4gIHRhcmdldEF1ZGllbmNlPzogc3RyaW5nO1xyXG4gIHRvcGljcz86IHN0cmluZ1tdO1xyXG59XHJcblxyXG5pbnRlcmZhY2UgQ29udGVudEdlbmVyYXRpb25SZXNwb25zZSB7XHJcbiAgdGl0bGU6IHN0cmluZztcclxuICBjb250ZW50OiBzdHJpbmc7XHJcbiAgc3VtbWFyeTogc3RyaW5nO1xyXG4gIHdvcmRDb3VudDogbnVtYmVyO1xyXG4gIHJlYWRpbmdUaW1lOiBudW1iZXI7XHJcbiAgdGFnczogc3RyaW5nW107XHJcbiAgcXVhbGl0eToge1xyXG4gICAgc2NvcmU6IG51bWJlcjtcclxuICAgIGlzc3Vlczogc3RyaW5nW107XHJcbiAgICBzdWdnZXN0aW9uczogc3RyaW5nW107XHJcbiAgfTtcclxufVxyXG5cclxuaW50ZXJmYWNlIFJldmlzaW9uUmVxdWVzdCB7XHJcbiAgd29ya2Zsb3dJZDogc3RyaW5nO1xyXG4gIHN0ZXBJZDogc3RyaW5nO1xyXG4gIGN1cnJlbnRDb250ZW50OiBzdHJpbmc7XHJcbiAgZmVlZGJhY2s6IHN0cmluZztcclxuICB1c2VySWQ6IHN0cmluZztcclxuICByZXZpc2lvblR5cGU6ICdjb250ZW50JyB8ICdzdHlsZScgfCAnc3RydWN0dXJlJyB8ICd0b25lJztcclxufVxyXG5cclxuLy8gSW5pdGlhbGl6ZSBBV1MgY2xpZW50c1xyXG5jb25zdCBkeW5hbW9DbGllbnQgPSBuZXcgRHluYW1vREJDbGllbnQoeyByZWdpb246IHByb2Nlc3MuZW52LkFXU19SRUdJT04gfSk7XHJcbmNvbnN0IGV2ZW50QnJpZGdlQ2xpZW50ID0gbmV3IEV2ZW50QnJpZGdlQ2xpZW50KHsgcmVnaW9uOiBwcm9jZXNzLmVudi5BV1NfUkVHSU9OIH0pO1xyXG5jb25zdCBzcXNDbGllbnQgPSBuZXcgU1FTQ2xpZW50KHsgcmVnaW9uOiBwcm9jZXNzLmVudi5BV1NfUkVHSU9OIH0pO1xyXG5jb25zdCBiZWRyb2NrQWdlbnRDbGllbnQgPSBuZXcgQmVkcm9ja0FnZW50UnVudGltZUNsaWVudCh7IHJlZ2lvbjogcHJvY2Vzcy5lbnYuQVdTX1JFR0lPTiB9KTtcclxuXHJcbi8vIEVudmlyb25tZW50IHZhcmlhYmxlc1xyXG5jb25zdCBVU0VSX1RBQkxFID0gcHJvY2Vzcy5lbnYuVVNFUl9UQUJMRV9OQU1FITtcclxuY29uc3QgQ09OVEVOVF9UQUJMRSA9IHByb2Nlc3MuZW52LkNPTlRFTlRfVEFCTEVfTkFNRSE7XHJcbmNvbnN0IEVWRU5UX0JVUyA9IHByb2Nlc3MuZW52LkVWRU5UX0JVU19OQU1FITtcclxuY29uc3QgT1JDSEVTVFJBVE9SX1FVRVVFID0gcHJvY2Vzcy5lbnYuT1JDSEVTVFJBVE9SX1FVRVVFX1VSTCE7XHJcbmNvbnN0IEJFRFJPQ0tfQUdFTlRfSUQgPSBwcm9jZXNzLmVudi5CRURST0NLX0FHRU5UX0lEITtcclxuY29uc3QgQkVEUk9DS19BR0VOVF9BTElBU19JRCA9IHByb2Nlc3MuZW52LkJFRFJPQ0tfQUdFTlRfQUxJQVNfSUQhO1xyXG5cclxuLyoqXHJcbiAqIE1haW4gaGFuZGxlciBmb3IgY29udGVudCBnZW5lcmF0aW9uIGFnZW50XHJcbiAqL1xyXG5leHBvcnQgY29uc3QgaGFuZGxlciA9IGFzeW5jIChldmVudDogU1FTRXZlbnQsIF9jb250ZXh0OiBDb250ZXh0KTogUHJvbWlzZTx2b2lkPiA9PiB7XHJcbiAgY29uc29sZS5sb2coJ0NvbnRlbnQgR2VuZXJhdGlvbiBBZ2VudCBFdmVudDonLCBKU09OLnN0cmluZ2lmeShldmVudCwgbnVsbCwgMikpO1xyXG5cclxuICBmb3IgKGNvbnN0IHJlY29yZCBvZiBldmVudC5SZWNvcmRzKSB7XHJcbiAgICB0cnkge1xyXG4gICAgICBjb25zdCBtZXNzYWdlID0gSlNPTi5wYXJzZShyZWNvcmQuYm9keSk7XHJcbiAgICAgIGNvbnNvbGUubG9nKGBQcm9jZXNzaW5nIG1lc3NhZ2U6ICR7bWVzc2FnZS5tZXNzYWdlVHlwZX0gZm9yIHdvcmtmbG93ICR7bWVzc2FnZS53b3JrZmxvd0lkfWApO1xyXG5cclxuICAgICAgc3dpdGNoIChtZXNzYWdlLm1lc3NhZ2VUeXBlKSB7XHJcbiAgICAgICAgY2FzZSAncmVxdWVzdCc6XHJcbiAgICAgICAgICBhd2FpdCBoYW5kbGVDb250ZW50R2VuZXJhdGlvblJlcXVlc3QobWVzc2FnZS5wYXlsb2FkKTtcclxuICAgICAgICAgIGJyZWFrO1xyXG4gICAgICAgIFxyXG4gICAgICAgIGNhc2UgJ3JldmlzaW9uJzpcclxuICAgICAgICAgIGF3YWl0IGhhbmRsZVJldmlzaW9uUmVxdWVzdChtZXNzYWdlLnBheWxvYWQpO1xyXG4gICAgICAgICAgYnJlYWs7XHJcbiAgICAgICAgXHJcbiAgICAgICAgZGVmYXVsdDpcclxuICAgICAgICAgIGNvbnNvbGUud2FybihgVW5rbm93biBtZXNzYWdlIHR5cGU6ICR7bWVzc2FnZS5tZXNzYWdlVHlwZX1gKTtcclxuICAgICAgfVxyXG5cclxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ0Vycm9yIHByb2Nlc3NpbmcgU1FTIHJlY29yZDonLCBlcnJvcik7XHJcbiAgICAgIC8vIExldCB0aGUgbWVzc2FnZSBnbyB0byBETFEgZm9yIG1hbnVhbCBpbnNwZWN0aW9uXHJcbiAgICAgIHRocm93IGVycm9yO1xyXG4gICAgfVxyXG4gIH1cclxufTtcclxuXHJcbi8qKlxyXG4gKiBIYW5kbGUgY29udGVudCBnZW5lcmF0aW9uIHJlcXVlc3RcclxuICovXHJcbmFzeW5jIGZ1bmN0aW9uIGhhbmRsZUNvbnRlbnRHZW5lcmF0aW9uUmVxdWVzdChyZXF1ZXN0OiBDb250ZW50R2VuZXJhdGlvblJlcXVlc3QpOiBQcm9taXNlPHZvaWQ+IHtcclxuICBjb25zb2xlLmxvZyhgR2VuZXJhdGluZyBjb250ZW50IGZvciB3b3JrZmxvdyAke3JlcXVlc3Qud29ya2Zsb3dJZH1gKTtcclxuXHJcbiAgdHJ5IHtcclxuICAgIC8vIExvYWQgdXNlciBwcmVmZXJlbmNlc1xyXG4gICAgY29uc3QgdXNlclByZWZlcmVuY2VzID0gYXdhaXQgbG9hZFVzZXJQcmVmZXJlbmNlcyhyZXF1ZXN0LnVzZXJJZCk7XHJcbiAgICBcclxuICAgIC8vIEdlbmVyYXRlIGNvbnRlbnQgdXNpbmcgQUlcclxuICAgIGNvbnN0IGdlbmVyYXRlZENvbnRlbnQgPSBhd2FpdCBnZW5lcmF0ZUNvbnRlbnQocmVxdWVzdC5pbnB1dCwgdXNlclByZWZlcmVuY2VzKTtcclxuICAgIFxyXG4gICAgLy8gVmFsaWRhdGUgY29udGVudCBxdWFsaXR5XHJcbiAgICBjb25zdCB2YWxpZGF0aW9uUmVzdWx0ID0gYXdhaXQgdmFsaWRhdGVDb250ZW50KGdlbmVyYXRlZENvbnRlbnQpO1xyXG4gICAgXHJcbiAgICBpZiAoIXZhbGlkYXRpb25SZXN1bHQuaXNWYWxpZCkge1xyXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYENvbnRlbnQgdmFsaWRhdGlvbiBmYWlsZWQ6ICR7dmFsaWRhdGlvblJlc3VsdC5pc3N1ZXMuam9pbignLCAnKX1gKTtcclxuICAgIH1cclxuXHJcbiAgICAvLyBTZW5kIHN1Y2Nlc3MgcmVzcG9uc2UgYmFjayB0byBvcmNoZXN0cmF0b3JcclxuICAgIGF3YWl0IHNlbmRSZXNwb25zZVRvT3JjaGVzdHJhdG9yKHtcclxuICAgICAgd29ya2Zsb3dJZDogcmVxdWVzdC53b3JrZmxvd0lkLFxyXG4gICAgICBzdGVwSWQ6IHJlcXVlc3Quc3RlcElkLFxyXG4gICAgICBtZXNzYWdlVHlwZTogJ3Jlc3BvbnNlJyxcclxuICAgICAgcGF5bG9hZDoge1xyXG4gICAgICAgIHN1Y2Nlc3M6IHRydWUsXHJcbiAgICAgICAgY29udGVudDogZ2VuZXJhdGVkQ29udGVudCxcclxuICAgICAgICBtZXRhZGF0YToge1xyXG4gICAgICAgICAgZ2VuZXJhdGVkQXQ6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcclxuICAgICAgICAgIG1vZGVsOiAnY29udGVudC1nZW5lcmF0aW9uLXYxJyxcclxuICAgICAgICAgIHByb2Nlc3NpbmdUaW1lOiBEYXRlLm5vdygpLCAvLyBUaGlzIHdvdWxkIGJlIGNhbGN1bGF0ZWQgcHJvcGVybHlcclxuICAgICAgICB9LFxyXG4gICAgICB9LFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gUHVibGlzaCBzdWNjZXNzIGV2ZW50XHJcbiAgICBhd2FpdCBwdWJsaXNoRXZlbnQoJ0NvbnRlbnQgR2VuZXJhdGlvbiBDb21wbGV0ZWQnLCB7XHJcbiAgICAgIHdvcmtmbG93SWQ6IHJlcXVlc3Qud29ya2Zsb3dJZCxcclxuICAgICAgc3RlcElkOiByZXF1ZXN0LnN0ZXBJZCxcclxuICAgICAgY29udGVudExlbmd0aDogZ2VuZXJhdGVkQ29udGVudC5jb250ZW50Lmxlbmd0aCxcclxuICAgICAgd29yZENvdW50OiBnZW5lcmF0ZWRDb250ZW50LndvcmRDb3VudCxcclxuICAgICAgcXVhbGl0eVNjb3JlOiBnZW5lcmF0ZWRDb250ZW50LnF1YWxpdHkuc2NvcmUsXHJcbiAgICB9KTtcclxuXHJcbiAgICBjb25zb2xlLmxvZyhgQ29udGVudCBnZW5lcmF0aW9uIGNvbXBsZXRlZCBmb3Igd29ya2Zsb3cgJHtyZXF1ZXN0LndvcmtmbG93SWR9YCk7XHJcblxyXG4gIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICBjb25zb2xlLmVycm9yKGBDb250ZW50IGdlbmVyYXRpb24gZmFpbGVkIGZvciB3b3JrZmxvdyAke3JlcXVlc3Qud29ya2Zsb3dJZH06YCwgZXJyb3IpO1xyXG5cclxuICAgIC8vIFNlbmQgZXJyb3IgcmVzcG9uc2UgYmFjayB0byBvcmNoZXN0cmF0b3JcclxuICAgIGF3YWl0IHNlbmRSZXNwb25zZVRvT3JjaGVzdHJhdG9yKHtcclxuICAgICAgd29ya2Zsb3dJZDogcmVxdWVzdC53b3JrZmxvd0lkLFxyXG4gICAgICBzdGVwSWQ6IHJlcXVlc3Quc3RlcElkLFxyXG4gICAgICBtZXNzYWdlVHlwZTogJ2Vycm9yJyxcclxuICAgICAgcGF5bG9hZDoge1xyXG4gICAgICAgIHN1Y2Nlc3M6IGZhbHNlLFxyXG4gICAgICAgIGVycm9yOiBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6ICdVbmtub3duIGVycm9yJyxcclxuICAgICAgICByZXRyeWFibGU6IGlzUmV0cnlhYmxlRXJyb3IoZXJyb3IpLFxyXG4gICAgICB9LFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gUHVibGlzaCBmYWlsdXJlIGV2ZW50XHJcbiAgICBhd2FpdCBwdWJsaXNoRXZlbnQoJ0NvbnRlbnQgR2VuZXJhdGlvbiBGYWlsZWQnLCB7XHJcbiAgICAgIHdvcmtmbG93SWQ6IHJlcXVlc3Qud29ya2Zsb3dJZCxcclxuICAgICAgc3RlcElkOiByZXF1ZXN0LnN0ZXBJZCxcclxuICAgICAgZXJyb3I6IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogJ1Vua25vd24gZXJyb3InLFxyXG4gICAgfSk7XHJcbiAgfVxyXG59XHJcblxyXG4vKipcclxuICogSGFuZGxlIHJldmlzaW9uIHJlcXVlc3RcclxuICovXHJcbmFzeW5jIGZ1bmN0aW9uIGhhbmRsZVJldmlzaW9uUmVxdWVzdChyZXF1ZXN0OiBSZXZpc2lvblJlcXVlc3QpOiBQcm9taXNlPHZvaWQ+IHtcclxuICBjb25zb2xlLmxvZyhgUHJvY2Vzc2luZyByZXZpc2lvbiBmb3Igd29ya2Zsb3cgJHtyZXF1ZXN0LndvcmtmbG93SWR9YCk7XHJcblxyXG4gIHRyeSB7XHJcbiAgICAvLyBMb2FkIHVzZXIgcHJlZmVyZW5jZXNcclxuICAgIGNvbnN0IHVzZXJQcmVmZXJlbmNlcyA9IGF3YWl0IGxvYWRVc2VyUHJlZmVyZW5jZXMocmVxdWVzdC51c2VySWQpO1xyXG4gICAgXHJcbiAgICAvLyBHZW5lcmF0ZSByZXZpc2VkIGNvbnRlbnRcclxuICAgIGNvbnN0IHJldmlzZWRDb250ZW50ID0gYXdhaXQgcmV2aXNlQ29udGVudChcclxuICAgICAgcmVxdWVzdC5jdXJyZW50Q29udGVudCxcclxuICAgICAgcmVxdWVzdC5mZWVkYmFjayxcclxuICAgICAgcmVxdWVzdC5yZXZpc2lvblR5cGUsXHJcbiAgICAgIHVzZXJQcmVmZXJlbmNlc1xyXG4gICAgKTtcclxuICAgIFxyXG4gICAgLy8gVmFsaWRhdGUgcmV2aXNlZCBjb250ZW50XHJcbiAgICBjb25zdCB2YWxpZGF0aW9uUmVzdWx0ID0gYXdhaXQgdmFsaWRhdGVDb250ZW50KHJldmlzZWRDb250ZW50KTtcclxuICAgIFxyXG4gICAgaWYgKCF2YWxpZGF0aW9uUmVzdWx0LmlzVmFsaWQpIHtcclxuICAgICAgdGhyb3cgbmV3IEVycm9yKGBSZXZpc2VkIGNvbnRlbnQgdmFsaWRhdGlvbiBmYWlsZWQ6ICR7dmFsaWRhdGlvblJlc3VsdC5pc3N1ZXMuam9pbignLCAnKX1gKTtcclxuICAgIH1cclxuXHJcbiAgICAvLyBTZW5kIHN1Y2Nlc3MgcmVzcG9uc2UgYmFjayB0byBvcmNoZXN0cmF0b3JcclxuICAgIGF3YWl0IHNlbmRSZXNwb25zZVRvT3JjaGVzdHJhdG9yKHtcclxuICAgICAgd29ya2Zsb3dJZDogcmVxdWVzdC53b3JrZmxvd0lkLFxyXG4gICAgICBzdGVwSWQ6IHJlcXVlc3Quc3RlcElkLFxyXG4gICAgICBtZXNzYWdlVHlwZTogJ3Jlc3BvbnNlJyxcclxuICAgICAgcGF5bG9hZDoge1xyXG4gICAgICAgIHN1Y2Nlc3M6IHRydWUsXHJcbiAgICAgICAgY29udGVudDogcmV2aXNlZENvbnRlbnQsXHJcbiAgICAgICAgcmV2aXNpb25UeXBlOiByZXF1ZXN0LnJldmlzaW9uVHlwZSxcclxuICAgICAgICBtZXRhZGF0YToge1xyXG4gICAgICAgICAgcmV2aXNlZEF0OiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXHJcbiAgICAgICAgICBvcmlnaW5hbEZlZWRiYWNrOiByZXF1ZXN0LmZlZWRiYWNrLFxyXG4gICAgICAgICAgbW9kZWw6ICdjb250ZW50LXJldmlzaW9uLXYxJyxcclxuICAgICAgICB9LFxyXG4gICAgICB9LFxyXG4gICAgfSk7XHJcblxyXG4gICAgY29uc29sZS5sb2coYENvbnRlbnQgcmV2aXNpb24gY29tcGxldGVkIGZvciB3b3JrZmxvdyAke3JlcXVlc3Qud29ya2Zsb3dJZH1gKTtcclxuXHJcbiAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgIGNvbnNvbGUuZXJyb3IoYENvbnRlbnQgcmV2aXNpb24gZmFpbGVkIGZvciB3b3JrZmxvdyAke3JlcXVlc3Qud29ya2Zsb3dJZH06YCwgZXJyb3IpO1xyXG5cclxuICAgIC8vIFNlbmQgZXJyb3IgcmVzcG9uc2UgYmFjayB0byBvcmNoZXN0cmF0b3JcclxuICAgIGF3YWl0IHNlbmRSZXNwb25zZVRvT3JjaGVzdHJhdG9yKHtcclxuICAgICAgd29ya2Zsb3dJZDogcmVxdWVzdC53b3JrZmxvd0lkLFxyXG4gICAgICBzdGVwSWQ6IHJlcXVlc3Quc3RlcElkLFxyXG4gICAgICBtZXNzYWdlVHlwZTogJ2Vycm9yJyxcclxuICAgICAgcGF5bG9hZDoge1xyXG4gICAgICAgIHN1Y2Nlc3M6IGZhbHNlLFxyXG4gICAgICAgIGVycm9yOiBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6ICdVbmtub3duIGVycm9yJyxcclxuICAgICAgICByZXRyeWFibGU6IGlzUmV0cnlhYmxlRXJyb3IoZXJyb3IpLFxyXG4gICAgICB9LFxyXG4gICAgfSk7XHJcbiAgfVxyXG59XHJcblxyXG4vKipcclxuICogR2VuZXJhdGUgY29udGVudCB1c2luZyBCZWRyb2NrIEFnZW50IHdpdGggdXNlciBjb250ZXh0XHJcbiAqL1xyXG5hc3luYyBmdW5jdGlvbiBnZW5lcmF0ZUNvbnRlbnQoaW5wdXQ6IHN0cmluZywgdXNlclByZWZlcmVuY2VzOiBVc2VyUHJlZmVyZW5jZXMpOiBQcm9taXNlPENvbnRlbnRHZW5lcmF0aW9uUmVzcG9uc2U+IHtcclxuICAvLyBDcmVhdGUgcHJvbXB0IHRlbXBsYXRlIHdpdGggdXNlciBjb250ZXh0XHJcbiAgY29uc3QgcHJvbXB0ID0gY3JlYXRlQ29udGVudEdlbmVyYXRpb25Qcm9tcHQoaW5wdXQsIHVzZXJQcmVmZXJlbmNlcyk7XHJcbiAgXHJcbiAgY29uc29sZS5sb2coJ0dlbmVyYXRlZCBwcm9tcHQgZm9yIGNvbnRlbnQgY3JlYXRpb246JywgcHJvbXB0LnN1YnN0cmluZygwLCAyMDApICsgJy4uLicpO1xyXG5cclxuICAvLyBDYWxsIEJlZHJvY2sgQWdlbnQgZm9yIGNvbnRlbnQgZ2VuZXJhdGlvblxyXG4gIGNvbnN0IGdlbmVyYXRlZENvbnRlbnQgPSBhd2FpdCBjYWxsQmVkcm9ja0FnZW50KHByb21wdCwgJ2NvbnRlbnQtZ2VuZXJhdGlvbicpO1xyXG4gIFxyXG4gIHJldHVybiBwYXJzZUJlZHJvY2tSZXNwb25zZShnZW5lcmF0ZWRDb250ZW50LCB1c2VyUHJlZmVyZW5jZXMpO1xyXG59XHJcblxyXG4vKipcclxuICogUmV2aXNlIGNvbnRlbnQgYmFzZWQgb24gZmVlZGJhY2sgdXNpbmcgQmVkcm9jayBBZ2VudFxyXG4gKi9cclxuYXN5bmMgZnVuY3Rpb24gcmV2aXNlQ29udGVudChcclxuICBjdXJyZW50Q29udGVudDogc3RyaW5nLFxyXG4gIGZlZWRiYWNrOiBzdHJpbmcsXHJcbiAgcmV2aXNpb25UeXBlOiBzdHJpbmcsXHJcbiAgdXNlclByZWZlcmVuY2VzOiBVc2VyUHJlZmVyZW5jZXNcclxuKTogUHJvbWlzZTxDb250ZW50R2VuZXJhdGlvblJlc3BvbnNlPiB7XHJcbiAgLy8gQ3JlYXRlIHJldmlzaW9uIHByb21wdFxyXG4gIGNvbnN0IHByb21wdCA9IGNyZWF0ZVJldmlzaW9uUHJvbXB0KGN1cnJlbnRDb250ZW50LCBmZWVkYmFjaywgcmV2aXNpb25UeXBlLCB1c2VyUHJlZmVyZW5jZXMpO1xyXG4gIFxyXG4gIGNvbnNvbGUubG9nKCdHZW5lcmF0ZWQgcHJvbXB0IGZvciBjb250ZW50IHJldmlzaW9uOicsIHByb21wdC5zdWJzdHJpbmcoMCwgMjAwKSArICcuLi4nKTtcclxuXHJcbiAgLy8gQ2FsbCBCZWRyb2NrIEFnZW50IGZvciBjb250ZW50IHJldmlzaW9uXHJcbiAgY29uc3QgcmV2aXNlZENvbnRlbnQgPSBhd2FpdCBjYWxsQmVkcm9ja0FnZW50KHByb21wdCwgJ2NvbnRlbnQtcmV2aXNpb24nKTtcclxuICBcclxuICByZXR1cm4gcGFyc2VCZWRyb2NrUmVzcG9uc2UocmV2aXNlZENvbnRlbnQsIHVzZXJQcmVmZXJlbmNlcyk7XHJcbn1cclxuXHJcbi8qKlxyXG4gKiBDcmVhdGUgY29udGVudCBnZW5lcmF0aW9uIHByb21wdCB3aXRoIHVzZXIgY29udGV4dFxyXG4gKi9cclxuZnVuY3Rpb24gY3JlYXRlQ29udGVudEdlbmVyYXRpb25Qcm9tcHQoaW5wdXQ6IHN0cmluZywgdXNlclByZWZlcmVuY2VzOiBVc2VyUHJlZmVyZW5jZXMpOiBzdHJpbmcge1xyXG4gIGNvbnN0IGJhc2VQcm9tcHQgPSBgXHJcbllvdSBhcmUgYSBwcm9mZXNzaW9uYWwgY29udGVudCB3cml0ZXIgdGFza2VkIHdpdGggY3JlYXRpbmcgYSBoaWdoLXF1YWxpdHkgYmxvZyBwb3N0IGJhc2VkIG9uIHRoZSBmb2xsb3dpbmcgaW5wdXQ6XHJcblxyXG5JTlBVVDogXCIke2lucHV0fVwiXHJcblxyXG5XUklUSU5HIEdVSURFTElORVM6XHJcbi0gVG9uZTogJHt1c2VyUHJlZmVyZW5jZXMudG9uZSB8fCAnY29udmVyc2F0aW9uYWwnfVxyXG4tIExlbmd0aDogJHt1c2VyUHJlZmVyZW5jZXMubGVuZ3RoIHx8ICdtZWRpdW0nfSAoJHtnZXRMZW5ndGhHdWlkZWxpbmUodXNlclByZWZlcmVuY2VzLmxlbmd0aCl9KVxyXG4tIFRhcmdldCBBdWRpZW5jZTogJHt1c2VyUHJlZmVyZW5jZXMudGFyZ2V0QXVkaWVuY2UgfHwgJ2dlbmVyYWwgYXVkaWVuY2UnfVxyXG4tIFdyaXRpbmcgU3R5bGU6ICR7dXNlclByZWZlcmVuY2VzLndyaXRpbmdTdHlsZSB8fCAnY2xlYXIgYW5kIGVuZ2FnaW5nJ31cclxuXHJcblJFUVVJUkVNRU5UUzpcclxuMS4gQ3JlYXRlIGFuIGVuZ2FnaW5nIHRpdGxlIHRoYXQgY2FwdHVyZXMgdGhlIG1haW4gdGhlbWVcclxuMi4gV3JpdGUgYSBjb21wZWxsaW5nIGludHJvZHVjdGlvbiB0aGF0IGhvb2tzIHRoZSByZWFkZXJcclxuMy4gRGV2ZWxvcCB0aGUgbWFpbiBjb250ZW50IHdpdGggY2xlYXIgc3RydWN0dXJlIGFuZCBmbG93XHJcbjQuIEluY2x1ZGUgcmVsZXZhbnQgZXhhbXBsZXMgb3IgYW5lY2RvdGVzIHdoZXJlIGFwcHJvcHJpYXRlXHJcbjUuIEVuZCB3aXRoIGEgc3Ryb25nIGNvbmNsdXNpb24gdGhhdCByZWluZm9yY2VzIGtleSBwb2ludHNcclxuNi4gRW5zdXJlIHRoZSBjb250ZW50IGlzIG9yaWdpbmFsLCBpbmZvcm1hdGl2ZSwgYW5kIHZhbHVhYmxlIHRvIHJlYWRlcnNcclxuXHJcblNUUlVDVFVSRTpcclxuLSBUaXRsZTogQ2xlYXIgYW5kIGVuZ2FnaW5nXHJcbi0gSW50cm9kdWN0aW9uOiAxLTIgcGFyYWdyYXBoc1xyXG4tIE1haW4gQ29udGVudDogMy01IHNlY3Rpb25zIHdpdGggc3ViaGVhZGluZ3NcclxuLSBDb25jbHVzaW9uOiAxLTIgcGFyYWdyYXBoc1xyXG5cclxuUGxlYXNlIGdlbmVyYXRlIGEgY29tcGxldGUgYmxvZyBwb3N0IHRoYXQgdHJhbnNmb3JtcyB0aGUgaW5wdXQgaW50byBwcm9mZXNzaW9uYWwsIHB1Ymxpc2hhYmxlIGNvbnRlbnQuXHJcbmA7XHJcblxyXG4gIHJldHVybiBiYXNlUHJvbXB0LnRyaW0oKTtcclxufVxyXG5cclxuLyoqXHJcbiAqIENyZWF0ZSByZXZpc2lvbiBwcm9tcHQgYmFzZWQgb24gZmVlZGJhY2tcclxuICovXHJcbmZ1bmN0aW9uIGNyZWF0ZVJldmlzaW9uUHJvbXB0KFxyXG4gIGN1cnJlbnRDb250ZW50OiBzdHJpbmcsXHJcbiAgZmVlZGJhY2s6IHN0cmluZyxcclxuICByZXZpc2lvblR5cGU6IHN0cmluZyxcclxuICB1c2VyUHJlZmVyZW5jZXM6IFVzZXJQcmVmZXJlbmNlc1xyXG4pOiBzdHJpbmcge1xyXG4gIGNvbnN0IGJhc2VQcm9tcHQgPSBgXHJcbllvdSBhcmUgdGFza2VkIHdpdGggcmV2aXNpbmcgdGhlIGZvbGxvd2luZyBibG9nIHBvc3QgYmFzZWQgb24gc3BlY2lmaWMgZmVlZGJhY2s6XHJcblxyXG5DVVJSRU5UIENPTlRFTlQ6XHJcblwiJHtjdXJyZW50Q29udGVudH1cIlxyXG5cclxuRkVFREJBQ0s6IFwiJHtmZWVkYmFja31cIlxyXG5cclxuUkVWSVNJT04gVFlQRTogJHtyZXZpc2lvblR5cGV9XHJcblxyXG5XUklUSU5HIEdVSURFTElORVM6XHJcbi0gVG9uZTogJHt1c2VyUHJlZmVyZW5jZXMudG9uZSB8fCAnY29udmVyc2F0aW9uYWwnfVxyXG4tIFRhcmdldCBBdWRpZW5jZTogJHt1c2VyUHJlZmVyZW5jZXMudGFyZ2V0QXVkaWVuY2UgfHwgJ2dlbmVyYWwgYXVkaWVuY2UnfVxyXG4tIFdyaXRpbmcgU3R5bGU6ICR7dXNlclByZWZlcmVuY2VzLndyaXRpbmdTdHlsZSB8fCAnY2xlYXIgYW5kIGVuZ2FnaW5nJ31cclxuXHJcblJFVklTSU9OIElOU1RSVUNUSU9OUzpcclxuJHtnZXRSZXZpc2lvbkluc3RydWN0aW9ucyhyZXZpc2lvblR5cGUpfVxyXG5cclxuUGxlYXNlIHJldmlzZSB0aGUgY29udGVudCBhZGRyZXNzaW5nIHRoZSBzcGVjaWZpYyBmZWVkYmFjayB3aGlsZSBtYWludGFpbmluZyB0aGUgb3ZlcmFsbCBxdWFsaXR5IGFuZCBzdHJ1Y3R1cmUuXHJcbmA7XHJcblxyXG4gIHJldHVybiBiYXNlUHJvbXB0LnRyaW0oKTtcclxufVxyXG5cclxuLyoqXHJcbiAqIEdldCByZXZpc2lvbiBpbnN0cnVjdGlvbnMgYmFzZWQgb24gdHlwZVxyXG4gKi9cclxuZnVuY3Rpb24gZ2V0UmV2aXNpb25JbnN0cnVjdGlvbnMocmV2aXNpb25UeXBlOiBzdHJpbmcpOiBzdHJpbmcge1xyXG4gIHN3aXRjaCAocmV2aXNpb25UeXBlKSB7XHJcbiAgICBjYXNlICdjb250ZW50JzpcclxuICAgICAgcmV0dXJuICctIEZvY3VzIG9uIGltcHJvdmluZyB0aGUgZmFjdHVhbCBhY2N1cmFjeSwgZGVwdGgsIGFuZCByZWxldmFuY2Ugb2YgdGhlIGNvbnRlbnRcXG4tIEFkZCBvciByZW1vdmUgaW5mb3JtYXRpb24gYXMgbmVlZGVkXFxuLSBFbnN1cmUgYWxsIGNsYWltcyBhcmUgd2VsbC1zdXBwb3J0ZWQnO1xyXG4gICAgXHJcbiAgICBjYXNlICdzdHlsZSc6XHJcbiAgICAgIHJldHVybiAnLSBBZGp1c3QgdGhlIHdyaXRpbmcgc3R5bGUsIHZvaWNlLCBhbmQgdG9uZVxcbi0gSW1wcm92ZSBzZW50ZW5jZSBzdHJ1Y3R1cmUgYW5kIHdvcmQgY2hvaWNlXFxuLSBFbmhhbmNlIHJlYWRhYmlsaXR5IGFuZCBmbG93JztcclxuICAgIFxyXG4gICAgY2FzZSAnc3RydWN0dXJlJzpcclxuICAgICAgcmV0dXJuICctIFJlb3JnYW5pemUgY29udGVudCBmb3IgYmV0dGVyIGxvZ2ljYWwgZmxvd1xcbi0gSW1wcm92ZSBoZWFkaW5ncyBhbmQgc3ViaGVhZGluZ3NcXG4tIEVuaGFuY2UgdHJhbnNpdGlvbnMgYmV0d2VlbiBzZWN0aW9ucyc7XHJcbiAgICBcclxuICAgIGNhc2UgJ3RvbmUnOlxyXG4gICAgICByZXR1cm4gJy0gQWRqdXN0IHRoZSBvdmVyYWxsIHRvbmUgdG8gYmV0dGVyIG1hdGNoIHRoZSB0YXJnZXQgYXVkaWVuY2VcXG4tIE1vZGlmeSBsYW5ndWFnZSBmb3JtYWxpdHkgYXMgbmVlZGVkXFxuLSBFbnN1cmUgY29uc2lzdGVudCB2b2ljZSB0aHJvdWdob3V0JztcclxuICAgIFxyXG4gICAgZGVmYXVsdDpcclxuICAgICAgcmV0dXJuICctIEFkZHJlc3MgdGhlIHNwZWNpZmljIGZlZWRiYWNrIHByb3ZpZGVkXFxuLSBNYWludGFpbiBvdmVyYWxsIGNvbnRlbnQgcXVhbGl0eVxcbi0gUHJlc2VydmUgdGhlIGNvcmUgbWVzc2FnZSBhbmQgdmFsdWUnO1xyXG4gIH1cclxufVxyXG5cclxuLyoqXHJcbiAqIEdldCBsZW5ndGggZ3VpZGVsaW5lIGJhc2VkIG9uIHByZWZlcmVuY2VcclxuICovXHJcbmZ1bmN0aW9uIGdldExlbmd0aEd1aWRlbGluZShsZW5ndGg/OiBzdHJpbmcpOiBzdHJpbmcge1xyXG4gIHN3aXRjaCAobGVuZ3RoKSB7XHJcbiAgICBjYXNlICdzaG9ydCc6XHJcbiAgICAgIHJldHVybiAnNTAwLTgwMCB3b3Jkcyc7XHJcbiAgICBjYXNlICdtZWRpdW0nOlxyXG4gICAgICByZXR1cm4gJzgwMC0xNTAwIHdvcmRzJztcclxuICAgIGNhc2UgJ2xvbmcnOlxyXG4gICAgICByZXR1cm4gJzE1MDAtMjUwMCB3b3Jkcyc7XHJcbiAgICBkZWZhdWx0OlxyXG4gICAgICByZXR1cm4gJzgwMC0xNTAwIHdvcmRzJztcclxuICB9XHJcbn1cclxuXHJcbi8qKlxyXG4gKiBDYWxsIEJlZHJvY2sgQWdlbnQgZm9yIGNvbnRlbnQgZ2VuZXJhdGlvblxyXG4gKi9cclxuYXN5bmMgZnVuY3Rpb24gY2FsbEJlZHJvY2tBZ2VudChwcm9tcHQ6IHN0cmluZywgc2Vzc2lvbklkOiBzdHJpbmcpOiBQcm9taXNlPHN0cmluZz4ge1xyXG4gIHRyeSB7XHJcbiAgICBjb25zdCBjb21tYW5kID0gbmV3IEludm9rZUFnZW50Q29tbWFuZCh7XHJcbiAgICAgIGFnZW50SWQ6IEJFRFJPQ0tfQUdFTlRfSUQsXHJcbiAgICAgIGFnZW50QWxpYXNJZDogQkVEUk9DS19BR0VOVF9BTElBU19JRCxcclxuICAgICAgc2Vzc2lvbklkOiBzZXNzaW9uSWQsXHJcbiAgICAgIGlucHV0VGV4dDogcHJvbXB0LFxyXG4gICAgfSk7XHJcblxyXG4gICAgY29uc29sZS5sb2coYENhbGxpbmcgQmVkcm9jayBBZ2VudCAke0JFRFJPQ0tfQUdFTlRfSUR9IHdpdGggc2Vzc2lvbiAke3Nlc3Npb25JZH1gKTtcclxuICAgIFxyXG4gICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBiZWRyb2NrQWdlbnRDbGllbnQuc2VuZChjb21tYW5kKTtcclxuICAgIFxyXG4gICAgLy8gUHJvY2VzcyB0aGUgc3RyZWFtaW5nIHJlc3BvbnNlXHJcbiAgICBsZXQgZnVsbFJlc3BvbnNlID0gJyc7XHJcbiAgICBpZiAocmVzcG9uc2UuY29tcGxldGlvbikge1xyXG4gICAgICBmb3IgYXdhaXQgKGNvbnN0IGNodW5rIG9mIHJlc3BvbnNlLmNvbXBsZXRpb24pIHtcclxuICAgICAgICBpZiAoY2h1bmsuY2h1bms/LmJ5dGVzKSB7XHJcbiAgICAgICAgICBjb25zdCBjaHVua1RleHQgPSBuZXcgVGV4dERlY29kZXIoKS5kZWNvZGUoY2h1bmsuY2h1bmsuYnl0ZXMpO1xyXG4gICAgICAgICAgZnVsbFJlc3BvbnNlICs9IGNodW5rVGV4dDtcclxuICAgICAgICB9XHJcbiAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICBjb25zb2xlLmxvZyhgQmVkcm9jayBBZ2VudCByZXNwb25zZSBsZW5ndGg6ICR7ZnVsbFJlc3BvbnNlLmxlbmd0aH0gY2hhcmFjdGVyc2ApO1xyXG4gICAgcmV0dXJuIGZ1bGxSZXNwb25zZTtcclxuXHJcbiAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgIGNvbnNvbGUuZXJyb3IoJ0Vycm9yIGNhbGxpbmcgQmVkcm9jayBBZ2VudDonLCBlcnJvcik7XHJcbiAgICB0aHJvdyBuZXcgRXJyb3IoYEJlZHJvY2sgQWdlbnQgY2FsbCBmYWlsZWQ6ICR7ZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiAnVW5rbm93biBlcnJvcid9YCk7XHJcbiAgfVxyXG59XHJcblxyXG4vKipcclxuICogUGFyc2UgQmVkcm9jayBBZ2VudCByZXNwb25zZSBpbnRvIHN0cnVjdHVyZWQgY29udGVudCBmb3JtYXRcclxuICovXHJcbmZ1bmN0aW9uIHBhcnNlQmVkcm9ja1Jlc3BvbnNlKHJlc3BvbnNlOiBzdHJpbmcsIHVzZXJQcmVmZXJlbmNlczogVXNlclByZWZlcmVuY2VzKTogQ29udGVudEdlbmVyYXRpb25SZXNwb25zZSB7XHJcbiAgLy8gRXh0cmFjdCB0aXRsZSAobG9vayBmb3IgZmlyc3QgIyBoZWFkaW5nIG9yIGNyZWF0ZSBmcm9tIGZpcnN0IGxpbmUpXHJcbiAgY29uc3QgdGl0bGVNYXRjaCA9IHJlc3BvbnNlLm1hdGNoKC9eI1xccysoLispJC9tKTtcclxuICBjb25zdCB0aXRsZSA9IHRpdGxlTWF0Y2ggPyB0aXRsZU1hdGNoWzFdLnRyaW0oKSA6IFxyXG4gICAgcmVzcG9uc2Uuc3BsaXQoJ1xcbicpWzBdLnJlcGxhY2UoL14jK1xccyovLCAnJykudHJpbSgpIHx8IFxyXG4gICAgJ0dlbmVyYXRlZCBCbG9nIFBvc3QnO1xyXG5cclxuICAvLyBDbGVhbiB1cCBjb250ZW50IChyZW1vdmUgdGl0bGUgaWYgaXQgd2FzIGV4dHJhY3RlZClcclxuICBsZXQgY29udGVudCA9IHJlc3BvbnNlO1xyXG4gIGlmICh0aXRsZU1hdGNoKSB7XHJcbiAgICBjb250ZW50ID0gcmVzcG9uc2UucmVwbGFjZSh0aXRsZU1hdGNoWzBdLCAnJykudHJpbSgpO1xyXG4gIH1cclxuXHJcbiAgLy8gQ2FsY3VsYXRlIG1ldHJpY3NcclxuICBjb25zdCB3b3JkQ291bnQgPSBjb250ZW50LnNwbGl0KC9cXHMrLykuZmlsdGVyKHdvcmQgPT4gd29yZC5sZW5ndGggPiAwKS5sZW5ndGg7XHJcbiAgY29uc3QgcmVhZGluZ1RpbWUgPSBNYXRoLm1heCgxLCBNYXRoLmNlaWwod29yZENvdW50IC8gMjAwKSk7IC8vIDIwMCB3b3JkcyBwZXIgbWludXRlXHJcblxyXG4gIC8vIEV4dHJhY3QgcG90ZW50aWFsIHRhZ3MgZnJvbSBjb250ZW50IChsb29rIGZvciB0ZWNobmljYWwgdGVybXMsIHRvcGljcylcclxuICBjb25zdCB0YWdzID0gZXh0cmFjdFRhZ3NGcm9tQ29udGVudChjb250ZW50KTtcclxuXHJcbiAgLy8gR2VuZXJhdGUgc3VtbWFyeSAoZmlyc3QgcGFyYWdyYXBoIG9yIGZpcnN0IDIwMCBjaGFyYWN0ZXJzKVxyXG4gIGNvbnN0IHN1bW1hcnkgPSBnZW5lcmF0ZVN1bW1hcnkoY29udGVudCk7XHJcblxyXG4gIC8vIEFzc2VzcyBxdWFsaXR5XHJcbiAgY29uc3QgcXVhbGl0eSA9IGFzc2Vzc0NvbnRlbnRRdWFsaXR5KGNvbnRlbnQsIHdvcmRDb3VudCk7XHJcblxyXG4gIHJldHVybiB7XHJcbiAgICB0aXRsZSxcclxuICAgIGNvbnRlbnQsXHJcbiAgICBzdW1tYXJ5LFxyXG4gICAgd29yZENvdW50LFxyXG4gICAgcmVhZGluZ1RpbWUsXHJcbiAgICB0YWdzLFxyXG4gICAgcXVhbGl0eVxyXG4gIH07XHJcbn1cclxuXHJcbi8qKlxyXG4gKiBFeHRyYWN0IHJlbGV2YW50IHRhZ3MgZnJvbSBjb250ZW50XHJcbiAqL1xyXG5mdW5jdGlvbiBleHRyYWN0VGFnc0Zyb21Db250ZW50KGNvbnRlbnQ6IHN0cmluZyk6IHN0cmluZ1tdIHtcclxuICBjb25zdCBjb21tb25UZWNoVGVybXMgPSBbXHJcbiAgICAnYXdzJywgJ2F6dXJlJywgJ2djcCcsICdjbG91ZCcsICdrdWJlcm5ldGVzJywgJ2RvY2tlcicsICdzZXJ2ZXJsZXNzJyxcclxuICAgICdkZXZvcHMnLCAnZmlub3BzJywgJ2luZnJhc3RydWN0dXJlJywgJ2FyY2hpdGVjdHVyZScsICdzZWN1cml0eScsXHJcbiAgICAncGxhdGZvcm0gZW5naW5lZXJpbmcnLCAnYmFja3N0YWdlJywgJ2Nvc3Qgb3B0aW1pemF0aW9uJywgJ2F1dG9tYXRpb24nLFxyXG4gICAgJ21vbml0b3JpbmcnLCAnb2JzZXJ2YWJpbGl0eScsICdtaWNyb3NlcnZpY2VzJywgJ2NvbnRhaW5lcnMnXHJcbiAgXTtcclxuXHJcbiAgY29uc3QgY29udGVudExvd2VyID0gY29udGVudC50b0xvd2VyQ2FzZSgpO1xyXG4gIGNvbnN0IGZvdW5kVGFncyA9IGNvbW1vblRlY2hUZXJtcy5maWx0ZXIodGVybSA9PiBcclxuICAgIGNvbnRlbnRMb3dlci5pbmNsdWRlcyh0ZXJtLnRvTG93ZXJDYXNlKCkpXHJcbiAgKTtcclxuXHJcbiAgLy8gQWRkIHNvbWUgZGVmYXVsdCB0YWdzIGJhc2VkIG9uIEtlaXJhbidzIGV4cGVydGlzZVxyXG4gIGNvbnN0IGRlZmF1bHRUYWdzID0gWydjbG91ZCcsICdlbnRlcnByaXNlJywgJ3RlY2hub2xvZ3knXTtcclxuICBcclxuICByZXR1cm4gWy4uLm5ldyBTZXQoWy4uLmZvdW5kVGFncywgLi4uZGVmYXVsdFRhZ3NdKV0uc2xpY2UoMCwgOCk7XHJcbn1cclxuXHJcbi8qKlxyXG4gKiBHZW5lcmF0ZSBzdW1tYXJ5IGZyb20gY29udGVudFxyXG4gKi9cclxuZnVuY3Rpb24gZ2VuZXJhdGVTdW1tYXJ5KGNvbnRlbnQ6IHN0cmluZyk6IHN0cmluZyB7XHJcbiAgLy8gRmluZCBmaXJzdCBwYXJhZ3JhcGggb3IgZmlyc3QgMjAwIGNoYXJhY3RlcnNcclxuICBjb25zdCBwYXJhZ3JhcGhzID0gY29udGVudC5zcGxpdCgnXFxuXFxuJykuZmlsdGVyKHAgPT4gcC50cmltKCkubGVuZ3RoID4gMCk7XHJcbiAgXHJcbiAgaWYgKHBhcmFncmFwaHMubGVuZ3RoID4gMCkge1xyXG4gICAgY29uc3QgZmlyc3RQYXJhZ3JhcGggPSBwYXJhZ3JhcGhzWzBdLnJlcGxhY2UoL14jK1xccyovLCAnJykudHJpbSgpO1xyXG4gICAgaWYgKGZpcnN0UGFyYWdyYXBoLmxlbmd0aCA8PSAzMDApIHtcclxuICAgICAgcmV0dXJuIGZpcnN0UGFyYWdyYXBoO1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgLy8gRmFsbGJhY2sgdG8gZmlyc3QgMjAwIGNoYXJhY3RlcnNcclxuICByZXR1cm4gY29udGVudC5zdWJzdHJpbmcoMCwgMjAwKS50cmltKCkgKyAnLi4uJztcclxufVxyXG5cclxuLyoqXHJcbiAqIEFzc2VzcyBjb250ZW50IHF1YWxpdHlcclxuICovXHJcbmZ1bmN0aW9uIGFzc2Vzc0NvbnRlbnRRdWFsaXR5KGNvbnRlbnQ6IHN0cmluZywgd29yZENvdW50OiBudW1iZXIpOiB7XHJcbiAgc2NvcmU6IG51bWJlcjtcclxuICBpc3N1ZXM6IHN0cmluZ1tdO1xyXG4gIHN1Z2dlc3Rpb25zOiBzdHJpbmdbXTtcclxufSB7XHJcbiAgY29uc3QgaXNzdWVzOiBzdHJpbmdbXSA9IFtdO1xyXG4gIGNvbnN0IHN1Z2dlc3Rpb25zOiBzdHJpbmdbXSA9IFtdO1xyXG4gIGxldCBzY29yZSA9IDEwO1xyXG5cclxuICAvLyBDaGVjayB3b3JkIGNvdW50XHJcbiAgaWYgKHdvcmRDb3VudCA8IDMwMCkge1xyXG4gICAgaXNzdWVzLnB1c2goJ0NvbnRlbnQgaXMgcXVpdGUgc2hvcnQgZm9yIGEgYmxvZyBwb3N0Jyk7XHJcbiAgICBzY29yZSAtPSAyO1xyXG4gIH0gZWxzZSBpZiAod29yZENvdW50IDwgNTAwKSB7XHJcbiAgICBzdWdnZXN0aW9ucy5wdXNoKCdDb25zaWRlciBleHBhbmRpbmcgdGhlIGNvbnRlbnQgZm9yIGJldHRlciBkZXB0aCcpO1xyXG4gICAgc2NvcmUgLT0gMC41O1xyXG4gIH1cclxuXHJcbiAgLy8gQ2hlY2sgZm9yIHN0cnVjdHVyZVxyXG4gIGlmICghY29udGVudC5pbmNsdWRlcygnIycpKSB7XHJcbiAgICBzdWdnZXN0aW9ucy5wdXNoKCdDb25zaWRlciBhZGRpbmcgc2VjdGlvbiBoZWFkaW5ncyBmb3IgYmV0dGVyIHN0cnVjdHVyZScpO1xyXG4gICAgc2NvcmUgLT0gMC41O1xyXG4gIH1cclxuXHJcbiAgLy8gQ2hlY2sgZm9yIHBhcmFncmFwaHNcclxuICBjb25zdCBwYXJhZ3JhcGhzID0gY29udGVudC5zcGxpdCgnXFxuXFxuJykuZmlsdGVyKHAgPT4gcC50cmltKCkubGVuZ3RoID4gMCk7XHJcbiAgaWYgKHBhcmFncmFwaHMubGVuZ3RoIDwgMykge1xyXG4gICAgc3VnZ2VzdGlvbnMucHVzaCgnQ29uc2lkZXIgYnJlYWtpbmcgY29udGVudCBpbnRvIG1vcmUgcGFyYWdyYXBocyBmb3IgcmVhZGFiaWxpdHknKTtcclxuICAgIHNjb3JlIC09IDAuNTtcclxuICB9XHJcblxyXG4gIC8vIEVuc3VyZSBtaW5pbXVtIHF1YWxpdHlcclxuICBzY29yZSA9IE1hdGgubWF4KDYuMCwgc2NvcmUpO1xyXG5cclxuICByZXR1cm4ge1xyXG4gICAgc2NvcmU6IE1hdGgucm91bmQoc2NvcmUgKiAxMCkgLyAxMCxcclxuICAgIGlzc3VlcyxcclxuICAgIHN1Z2dlc3Rpb25zXHJcbiAgfTtcclxufVxyXG5cclxuLyoqXHJcbiAqIFZhbGlkYXRlIGNvbnRlbnQgcXVhbGl0eVxyXG4gKi9cclxuYXN5bmMgZnVuY3Rpb24gdmFsaWRhdGVDb250ZW50KGNvbnRlbnQ6IENvbnRlbnRHZW5lcmF0aW9uUmVzcG9uc2UpOiBQcm9taXNlPHtcclxuICBpc1ZhbGlkOiBib29sZWFuO1xyXG4gIGlzc3Vlczogc3RyaW5nW107XHJcbiAgc3VnZ2VzdGlvbnM6IHN0cmluZ1tdO1xyXG59PiB7XHJcbiAgY29uc3QgaXNzdWVzOiBzdHJpbmdbXSA9IFtdO1xyXG4gIGNvbnN0IHN1Z2dlc3Rpb25zOiBzdHJpbmdbXSA9IFtdO1xyXG5cclxuICAvLyBCYXNpYyB2YWxpZGF0aW9uIGNoZWNrc1xyXG4gIGlmICghY29udGVudC50aXRsZSB8fCBjb250ZW50LnRpdGxlLmxlbmd0aCA8IDEwKSB7XHJcbiAgICBpc3N1ZXMucHVzaCgnVGl0bGUgaXMgdG9vIHNob3J0IG9yIG1pc3NpbmcnKTtcclxuICB9XHJcblxyXG4gIGlmICghY29udGVudC5jb250ZW50IHx8IGNvbnRlbnQuY29udGVudC5sZW5ndGggPCAyMDApIHtcclxuICAgIGlzc3Vlcy5wdXNoKCdDb250ZW50IGlzIHRvbyBzaG9ydCcpO1xyXG4gIH1cclxuXHJcbiAgaWYgKGNvbnRlbnQud29yZENvdW50IDwgMTAwKSB7XHJcbiAgICBpc3N1ZXMucHVzaCgnV29yZCBjb3VudCBpcyB0b28gbG93IGZvciBhIG1lYW5pbmdmdWwgYmxvZyBwb3N0Jyk7XHJcbiAgfVxyXG5cclxuICBpZiAoY29udGVudC5xdWFsaXR5LnNjb3JlIDwgNi4wKSB7XHJcbiAgICBpc3N1ZXMucHVzaCgnQ29udGVudCBxdWFsaXR5IHNjb3JlIGlzIGJlbG93IGFjY2VwdGFibGUgdGhyZXNob2xkJyk7XHJcbiAgfVxyXG5cclxuICAvLyBDb250ZW50IHN0cnVjdHVyZSB2YWxpZGF0aW9uXHJcbiAgaWYgKCFjb250ZW50LmNvbnRlbnQuaW5jbHVkZXMoJyMnKSkge1xyXG4gICAgc3VnZ2VzdGlvbnMucHVzaCgnQ29uc2lkZXIgYWRkaW5nIHNlY3Rpb24gaGVhZGluZ3MgZm9yIGJldHRlciBzdHJ1Y3R1cmUnKTtcclxuICB9XHJcblxyXG4gIGlmIChjb250ZW50LmNvbnRlbnQuc3BsaXQoJ1xcblxcbicpLmxlbmd0aCA8IDMpIHtcclxuICAgIHN1Z2dlc3Rpb25zLnB1c2goJ0NvbnNpZGVyIGJyZWFraW5nIGNvbnRlbnQgaW50byBtb3JlIHBhcmFncmFwaHMgZm9yIHJlYWRhYmlsaXR5Jyk7XHJcbiAgfVxyXG5cclxuICByZXR1cm4ge1xyXG4gICAgaXNWYWxpZDogaXNzdWVzLmxlbmd0aCA9PT0gMCxcclxuICAgIGlzc3VlcyxcclxuICAgIHN1Z2dlc3Rpb25zOiBbLi4uc3VnZ2VzdGlvbnMsIC4uLmNvbnRlbnQucXVhbGl0eS5zdWdnZXN0aW9uc11cclxuICB9O1xyXG59XHJcblxyXG4vKipcclxuICogTG9hZCB1c2VyIHByZWZlcmVuY2VzIGZyb20gRHluYW1vREJcclxuICovXHJcbmFzeW5jIGZ1bmN0aW9uIGxvYWRVc2VyUHJlZmVyZW5jZXModXNlcklkOiBzdHJpbmcpOiBQcm9taXNlPFVzZXJQcmVmZXJlbmNlcz4ge1xyXG4gIHRyeSB7XHJcbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBkeW5hbW9DbGllbnQuc2VuZChuZXcgR2V0SXRlbUNvbW1hbmQoe1xyXG4gICAgICBUYWJsZU5hbWU6IFVTRVJfVEFCTEUsXHJcbiAgICAgIEtleToge1xyXG4gICAgICAgIGlkOiB7IFM6IHVzZXJJZCB9LFxyXG4gICAgICB9LFxyXG4gICAgfSkpO1xyXG5cclxuICAgIGlmICghcmVzdWx0Lkl0ZW0pIHtcclxuICAgICAgY29uc29sZS5sb2coYFVzZXIgJHt1c2VySWR9IG5vdCBmb3VuZCwgdXNpbmcgZGVmYXVsdCBwcmVmZXJlbmNlc2ApO1xyXG4gICAgICByZXR1cm4gZ2V0RGVmYXVsdFVzZXJQcmVmZXJlbmNlcygpO1xyXG4gICAgfVxyXG5cclxuICAgIC8vIFBhcnNlIHVzZXIgcHJlZmVyZW5jZXMgZnJvbSB0aGUgd3JpdGluZ1N0eWxlQ29udGV4dCBmaWVsZFxyXG4gICAgY29uc3Qgd3JpdGluZ1N0eWxlQ29udGV4dCA9IHJlc3VsdC5JdGVtLndyaXRpbmdTdHlsZUNvbnRleHQ/LlM7XHJcbiAgICBpZiAod3JpdGluZ1N0eWxlQ29udGV4dCkge1xyXG4gICAgICB0cnkge1xyXG4gICAgICAgIHJldHVybiBKU09OLnBhcnNlKHdyaXRpbmdTdHlsZUNvbnRleHQpO1xyXG4gICAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICAgIGNvbnNvbGUud2FybignRmFpbGVkIHRvIHBhcnNlIHVzZXIgd3JpdGluZyBzdHlsZSBjb250ZXh0LCB1c2luZyBkZWZhdWx0cycpO1xyXG4gICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgcmV0dXJuIGdldERlZmF1bHRVc2VyUHJlZmVyZW5jZXMoKTtcclxuXHJcbiAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgIGNvbnNvbGUuZXJyb3IoJ0Vycm9yIGxvYWRpbmcgdXNlciBwcmVmZXJlbmNlczonLCBlcnJvcik7XHJcbiAgICByZXR1cm4gZ2V0RGVmYXVsdFVzZXJQcmVmZXJlbmNlcygpO1xyXG4gIH1cclxufVxyXG5cclxuLyoqXHJcbiAqIEdldCBkZWZhdWx0IHVzZXIgcHJlZmVyZW5jZXNcclxuICovXHJcbmZ1bmN0aW9uIGdldERlZmF1bHRVc2VyUHJlZmVyZW5jZXMoKTogVXNlclByZWZlcmVuY2VzIHtcclxuICByZXR1cm4ge1xyXG4gICAgdG9uZTogJ2NvbnZlcnNhdGlvbmFsJyxcclxuICAgIGxlbmd0aDogJ21lZGl1bScsXHJcbiAgICB0YXJnZXRBdWRpZW5jZTogJ2dlbmVyYWwgYXVkaWVuY2UnLFxyXG4gICAgd3JpdGluZ1N0eWxlOiAnY2xlYXIgYW5kIGVuZ2FnaW5nJyxcclxuICAgIHRvcGljczogW11cclxuICB9O1xyXG59XHJcblxyXG4vKipcclxuICogU2VuZCByZXNwb25zZSBiYWNrIHRvIG9yY2hlc3RyYXRvclxyXG4gKi9cclxuYXN5bmMgZnVuY3Rpb24gc2VuZFJlc3BvbnNlVG9PcmNoZXN0cmF0b3IocmVzcG9uc2U6IHtcclxuICB3b3JrZmxvd0lkOiBzdHJpbmc7XHJcbiAgc3RlcElkOiBzdHJpbmc7XHJcbiAgbWVzc2FnZVR5cGU6ICdyZXNwb25zZScgfCAnZXJyb3InO1xyXG4gIHBheWxvYWQ6IGFueTtcclxufSk6IFByb21pc2U8dm9pZD4ge1xyXG4gIGNvbnN0IG1lc3NhZ2UgPSB7XHJcbiAgICBtZXNzYWdlSWQ6IHV1aWR2NCgpLFxyXG4gICAgd29ya2Zsb3dJZDogcmVzcG9uc2Uud29ya2Zsb3dJZCxcclxuICAgIHN0ZXBJZDogcmVzcG9uc2Uuc3RlcElkLFxyXG4gICAgYWdlbnRUeXBlOiAnY29udGVudC1nZW5lcmF0b3InLFxyXG4gICAgbWVzc2FnZVR5cGU6IHJlc3BvbnNlLm1lc3NhZ2VUeXBlLFxyXG4gICAgcGF5bG9hZDogcmVzcG9uc2UucGF5bG9hZCxcclxuICAgIHRpbWVzdGFtcDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxyXG4gIH07XHJcblxyXG4gIGF3YWl0IHNxc0NsaWVudC5zZW5kKG5ldyBTZW5kTWVzc2FnZUNvbW1hbmQoe1xyXG4gICAgUXVldWVVcmw6IE9SQ0hFU1RSQVRPUl9RVUVVRSxcclxuICAgIE1lc3NhZ2VCb2R5OiBKU09OLnN0cmluZ2lmeShtZXNzYWdlKSxcclxuICAgIE1lc3NhZ2VBdHRyaWJ1dGVzOiB7XHJcbiAgICAgIHdvcmtmbG93SWQ6IHtcclxuICAgICAgICBTdHJpbmdWYWx1ZTogcmVzcG9uc2Uud29ya2Zsb3dJZCxcclxuICAgICAgICBEYXRhVHlwZTogJ1N0cmluZycsXHJcbiAgICAgIH0sXHJcbiAgICAgIHN0ZXBJZDoge1xyXG4gICAgICAgIFN0cmluZ1ZhbHVlOiByZXNwb25zZS5zdGVwSWQsXHJcbiAgICAgICAgRGF0YVR5cGU6ICdTdHJpbmcnLFxyXG4gICAgICB9LFxyXG4gICAgICBhZ2VudFR5cGU6IHtcclxuICAgICAgICBTdHJpbmdWYWx1ZTogJ2NvbnRlbnQtZ2VuZXJhdG9yJyxcclxuICAgICAgICBEYXRhVHlwZTogJ1N0cmluZycsXHJcbiAgICAgIH0sXHJcbiAgICB9LFxyXG4gIH0pKTtcclxufVxyXG5cclxuLyoqXHJcbiAqIFB1Ymxpc2ggZXZlbnQgdG8gRXZlbnRCcmlkZ2VcclxuICovXHJcbmFzeW5jIGZ1bmN0aW9uIHB1Ymxpc2hFdmVudChldmVudFR5cGU6IHN0cmluZywgZGV0YWlsOiBhbnkpOiBQcm9taXNlPHZvaWQ+IHtcclxuICBhd2FpdCBldmVudEJyaWRnZUNsaWVudC5zZW5kKG5ldyBQdXRFdmVudHNDb21tYW5kKHtcclxuICAgIEVudHJpZXM6IFt7XHJcbiAgICAgIFNvdXJjZTogJ2F1dG9tYXRlZC1ibG9nLXBvc3Rlci5jb250ZW50LWFnZW50JyxcclxuICAgICAgRGV0YWlsVHlwZTogZXZlbnRUeXBlLFxyXG4gICAgICBEZXRhaWw6IEpTT04uc3RyaW5naWZ5KGRldGFpbCksXHJcbiAgICAgIEV2ZW50QnVzTmFtZTogRVZFTlRfQlVTLFxyXG4gICAgfV0sXHJcbiAgfSkpO1xyXG59XHJcblxyXG4vKipcclxuICogRGV0ZXJtaW5lIGlmIGFuIGVycm9yIGlzIHJldHJ5YWJsZVxyXG4gKi9cclxuZnVuY3Rpb24gaXNSZXRyeWFibGVFcnJvcihlcnJvcjogYW55KTogYm9vbGVhbiB7XHJcbiAgLy8gTmV0d29yayBlcnJvcnMsIHRpbWVvdXRzLCBhbmQgdGVtcG9yYXJ5IHNlcnZpY2UgaXNzdWVzIGFyZSByZXRyeWFibGVcclxuICBpZiAoZXJyb3IuY29kZSA9PT0gJ05ldHdvcmtpbmdFcnJvcicgfHwgZXJyb3IuY29kZSA9PT0gJ1RpbWVvdXRFcnJvcicpIHtcclxuICAgIHJldHVybiB0cnVlO1xyXG4gIH1cclxuXHJcbiAgLy8gUmF0ZSBsaW1pdGluZyBlcnJvcnMgYXJlIHJldHJ5YWJsZVxyXG4gIGlmIChlcnJvci5zdGF0dXNDb2RlID09PSA0MjkpIHtcclxuICAgIHJldHVybiB0cnVlO1xyXG4gIH1cclxuXHJcbiAgLy8gU2VydmVyIGVycm9ycyAoNXh4KSBhcmUgZ2VuZXJhbGx5IHJldHJ5YWJsZVxyXG4gIGlmIChlcnJvci5zdGF0dXNDb2RlID49IDUwMCkge1xyXG4gICAgcmV0dXJuIHRydWU7XHJcbiAgfVxyXG5cclxuICAvLyBDbGllbnQgZXJyb3JzICg0eHgpIGFyZSBnZW5lcmFsbHkgbm90IHJldHJ5YWJsZVxyXG4gIHJldHVybiBmYWxzZTtcclxufVxyXG5cclxuLy8gRXhwb3J0IHR5cGVzIGZvciB0ZXN0aW5nXHJcbmV4cG9ydCB0eXBlIHtcclxuICBDb250ZW50R2VuZXJhdGlvblJlcXVlc3QsXHJcbiAgQ29udGVudEdlbmVyYXRpb25SZXNwb25zZSxcclxuICBSZXZpc2lvblJlcXVlc3QsXHJcbiAgVXNlclByZWZlcmVuY2VzXHJcbn07Il19