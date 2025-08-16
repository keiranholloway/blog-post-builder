import { SQSEvent, Context } from 'aws-lambda';
import { DynamoDBClient, GetItemCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { BedrockAgentRuntimeClient, InvokeAgentCommand } from '@aws-sdk/client-bedrock-agent-runtime';
import { v4 as uuidv4 } from 'uuid';

// Types for content generation
interface ContentGenerationRequest {
  workflowId: string;
  stepId: string;
  input: string;
  userId: string;
  context: {
    previousSteps: any[];
    userPreferences: UserPreferences;
  };
}

interface UserPreferences {
  writingStyle?: string;
  tone?: 'professional' | 'casual' | 'technical' | 'conversational';
  length?: 'short' | 'medium' | 'long';
  targetAudience?: string;
  topics?: string[];
}

interface ContentGenerationResponse {
  title: string;
  content: string;
  summary: string;
  wordCount: number;
  readingTime: number;
  tags: string[];
  quality: {
    score: number;
    issues: string[];
    suggestions: string[];
  };
}

interface RevisionRequest {
  workflowId: string;
  stepId: string;
  currentContent: string;
  feedback: string;
  userId: string;
  revisionType: 'content' | 'style' | 'structure' | 'tone';
}

// Initialize AWS clients
const dynamoClient = new DynamoDBClient({ region: process.env.AWS_REGION });
const eventBridgeClient = new EventBridgeClient({ region: process.env.AWS_REGION });
const sqsClient = new SQSClient({ region: process.env.AWS_REGION });
const bedrockAgentClient = new BedrockAgentRuntimeClient({ region: process.env.AWS_REGION });

// Environment variables
const USER_TABLE = process.env.USER_TABLE_NAME!;
const CONTENT_TABLE = process.env.CONTENT_TABLE_NAME!;
const EVENT_BUS = process.env.EVENT_BUS_NAME!;
const ORCHESTRATOR_QUEUE = process.env.ORCHESTRATOR_QUEUE_URL!;
const BEDROCK_AGENT_ID = process.env.BEDROCK_AGENT_ID!;
const BEDROCK_AGENT_ALIAS_ID = process.env.BEDROCK_AGENT_ALIAS_ID!;

/**
 * Main handler for content generation agent
 */
export const handler = async (event: SQSEvent, _context: Context): Promise<void> => {
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

    } catch (error) {
      console.error('Error processing SQS record:', error);
      // Let the message go to DLQ for manual inspection
      throw error;
    }
  }
};

/**
 * Handle content generation request
 */
async function handleContentGenerationRequest(request: ContentGenerationRequest): Promise<void> {
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

  } catch (error) {
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
async function handleRevisionRequest(request: RevisionRequest): Promise<void> {
  console.log(`Processing revision for workflow ${request.workflowId}`);

  try {
    // Load user preferences
    const userPreferences = await loadUserPreferences(request.userId);
    
    // Generate revised content
    const revisedContent = await reviseContent(
      request.currentContent,
      request.feedback,
      request.revisionType,
      userPreferences
    );
    
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

  } catch (error) {
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
async function generateContent(input: string, userPreferences: UserPreferences): Promise<ContentGenerationResponse> {
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
async function reviseContent(
  currentContent: string,
  feedback: string,
  revisionType: string,
  userPreferences: UserPreferences
): Promise<ContentGenerationResponse> {
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
function createContentGenerationPrompt(input: string, userPreferences: UserPreferences): string {
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
function createRevisionPrompt(
  currentContent: string,
  feedback: string,
  revisionType: string,
  userPreferences: UserPreferences
): string {
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
function getRevisionInstructions(revisionType: string): string {
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
function getLengthGuideline(length?: string): string {
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
async function simulateAIContentGeneration(
  prompt: string,
  userPreferences: UserPreferences
): Promise<ContentGenerationResponse> {
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
async function validateContent(content: ContentGenerationResponse): Promise<{
  isValid: boolean;
  issues: string[];
  suggestions: string[];
}> {
  const issues: string[] = [];
  const suggestions: string[] = [];

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
async function loadUserPreferences(userId: string): Promise<UserPreferences> {
  try {
    const result = await dynamoClient.send(new GetItemCommand({
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
      } catch (error) {
        console.warn('Failed to parse user writing style context, using defaults');
      }
    }

    return getDefaultUserPreferences();

  } catch (error) {
    console.error('Error loading user preferences:', error);
    return getDefaultUserPreferences();
  }
}

/**
 * Get default user preferences
 */
function getDefaultUserPreferences(): UserPreferences {
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
async function sendResponseToOrchestrator(response: {
  workflowId: string;
  stepId: string;
  messageType: 'response' | 'error';
  payload: any;
}): Promise<void> {
  const message = {
    messageId: uuidv4(),
    workflowId: response.workflowId,
    stepId: response.stepId,
    agentType: 'content-generator',
    messageType: response.messageType,
    payload: response.payload,
    timestamp: new Date().toISOString(),
  };

  await sqsClient.send(new SendMessageCommand({
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
async function publishEvent(eventType: string, detail: any): Promise<void> {
  await eventBridgeClient.send(new PutEventsCommand({
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
function isRetryableError(error: any): boolean {
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

// Export types for testing
export type {
  ContentGenerationRequest,
  ContentGenerationResponse,
  RevisionRequest,
  UserPreferences
};