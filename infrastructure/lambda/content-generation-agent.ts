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
 * Call Bedrock Agent for content generation
 */
async function callBedrockAgent(prompt: string, sessionId: string): Promise<string> {
  try {
    const command = new InvokeAgentCommand({
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

  } catch (error) {
    console.error('Error calling Bedrock Agent:', error);
    throw new Error(`Bedrock Agent call failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Parse Bedrock Agent response into structured content format
 */
function parseBedrockResponse(response: string, userPreferences: UserPreferences): ContentGenerationResponse {
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
function extractTagsFromContent(content: string): string[] {
  const commonTechTerms = [
    'aws', 'azure', 'gcp', 'cloud', 'kubernetes', 'docker', 'serverless',
    'devops', 'finops', 'infrastructure', 'architecture', 'security',
    'platform engineering', 'backstage', 'cost optimization', 'automation',
    'monitoring', 'observability', 'microservices', 'containers'
  ];

  const contentLower = content.toLowerCase();
  const foundTags = commonTechTerms.filter(term => 
    contentLower.includes(term.toLowerCase())
  );

  // Add some default tags based on Keiran's expertise
  const defaultTags = ['cloud', 'enterprise', 'technology'];
  
  return [...new Set([...foundTags, ...defaultTags])].slice(0, 8);
}

/**
 * Generate summary from content
 */
function generateSummary(content: string): string {
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
function assessContentQuality(content: string, wordCount: number): {
  score: number;
  issues: string[];
  suggestions: string[];
} {
  const issues: string[] = [];
  const suggestions: string[] = [];
  let score = 10;

  // Check word count
  if (wordCount < 300) {
    issues.push('Content is quite short for a blog post');
    score -= 2;
  } else if (wordCount < 500) {
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