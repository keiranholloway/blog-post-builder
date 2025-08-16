import { SQSEvent, Context } from 'aws-lambda';
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
/**
 * Main handler for content generation agent
 */
export declare const handler: (event: SQSEvent, _context: Context) => Promise<void>;
export type { ContentGenerationRequest, ContentGenerationResponse, RevisionRequest, UserPreferences };
