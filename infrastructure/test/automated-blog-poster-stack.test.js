"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
const cdk = __importStar(require("aws-cdk-lib"));
const assertions_1 = require("aws-cdk-lib/assertions");
const Infrastructure = __importStar(require("../lib/automated-blog-poster-stack"));
test('Stack creates required resources', () => {
    const app = new cdk.App();
    const stack = new Infrastructure.AutomatedBlogPosterStack(app, 'MyTestStack');
    const template = assertions_1.Template.fromStack(stack);
    // Test DynamoDB tables
    template.hasResourceProperties('AWS::DynamoDB::Table', {
        TableName: 'automated-blog-poster-content'
    });
    template.hasResourceProperties('AWS::DynamoDB::Table', {
        TableName: 'automated-blog-poster-users'
    });
    // Test S3 buckets
    template.resourceCountIs('AWS::S3::Bucket', 2);
    // Test Lambda function
    template.hasResourceProperties('AWS::Lambda::Function', {
        Runtime: 'nodejs18.x'
    });
    // Test API Gateway
    template.hasResourceProperties('AWS::ApiGateway::RestApi', {
        Name: 'Automated Blog Poster API'
    });
    // Test SQS queue
    template.hasResourceProperties('AWS::SQS::Queue', {
        QueueName: 'automated-blog-poster-agents'
    });
    // Test EventBridge
    template.hasResourceProperties('AWS::Events::EventBus', {
        Name: 'automated-blog-poster-events'
    });
    // Test Secrets Manager
    template.hasResourceProperties('AWS::SecretsManager::Secret', {
        Name: 'automated-blog-poster/platform-credentials'
    });
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXV0b21hdGVkLWJsb2ctcG9zdGVyLXN0YWNrLnRlc3QuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJhdXRvbWF0ZWQtYmxvZy1wb3N0ZXItc3RhY2sudGVzdC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBQUEsaURBQW1DO0FBQ25DLHVEQUFrRDtBQUNsRCxtRkFBcUU7QUFFckUsSUFBSSxDQUFDLGtDQUFrQyxFQUFFLEdBQUcsRUFBRTtJQUM1QyxNQUFNLEdBQUcsR0FBRyxJQUFJLEdBQUcsQ0FBQyxHQUFHLEVBQUUsQ0FBQztJQUMxQixNQUFNLEtBQUssR0FBRyxJQUFJLGNBQWMsQ0FBQyx3QkFBd0IsQ0FBQyxHQUFHLEVBQUUsYUFBYSxDQUFDLENBQUM7SUFDOUUsTUFBTSxRQUFRLEdBQUcscUJBQVEsQ0FBQyxTQUFTLENBQUMsS0FBSyxDQUFDLENBQUM7SUFFM0MsdUJBQXVCO0lBQ3ZCLFFBQVEsQ0FBQyxxQkFBcUIsQ0FBQyxzQkFBc0IsRUFBRTtRQUNyRCxTQUFTLEVBQUUsK0JBQStCO0tBQzNDLENBQUMsQ0FBQztJQUVILFFBQVEsQ0FBQyxxQkFBcUIsQ0FBQyxzQkFBc0IsRUFBRTtRQUNyRCxTQUFTLEVBQUUsNkJBQTZCO0tBQ3pDLENBQUMsQ0FBQztJQUVILGtCQUFrQjtJQUNsQixRQUFRLENBQUMsZUFBZSxDQUFDLGlCQUFpQixFQUFFLENBQUMsQ0FBQyxDQUFDO0lBRS9DLHVCQUF1QjtJQUN2QixRQUFRLENBQUMscUJBQXFCLENBQUMsdUJBQXVCLEVBQUU7UUFDdEQsT0FBTyxFQUFFLFlBQVk7S0FDdEIsQ0FBQyxDQUFDO0lBRUgsbUJBQW1CO0lBQ25CLFFBQVEsQ0FBQyxxQkFBcUIsQ0FBQywwQkFBMEIsRUFBRTtRQUN6RCxJQUFJLEVBQUUsMkJBQTJCO0tBQ2xDLENBQUMsQ0FBQztJQUVILGlCQUFpQjtJQUNqQixRQUFRLENBQUMscUJBQXFCLENBQUMsaUJBQWlCLEVBQUU7UUFDaEQsU0FBUyxFQUFFLDhCQUE4QjtLQUMxQyxDQUFDLENBQUM7SUFFSCxtQkFBbUI7SUFDbkIsUUFBUSxDQUFDLHFCQUFxQixDQUFDLHVCQUF1QixFQUFFO1FBQ3RELElBQUksRUFBRSw4QkFBOEI7S0FDckMsQ0FBQyxDQUFDO0lBRUgsdUJBQXVCO0lBQ3ZCLFFBQVEsQ0FBQyxxQkFBcUIsQ0FBQyw2QkFBNkIsRUFBRTtRQUM1RCxJQUFJLEVBQUUsNENBQTRDO0tBQ25ELENBQUMsQ0FBQztBQUNMLENBQUMsQ0FBQyxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0ICogYXMgY2RrIGZyb20gJ2F3cy1jZGstbGliJztcclxuaW1wb3J0IHsgVGVtcGxhdGUgfSBmcm9tICdhd3MtY2RrLWxpYi9hc3NlcnRpb25zJztcclxuaW1wb3J0ICogYXMgSW5mcmFzdHJ1Y3R1cmUgZnJvbSAnLi4vbGliL2F1dG9tYXRlZC1ibG9nLXBvc3Rlci1zdGFjayc7XHJcblxyXG50ZXN0KCdTdGFjayBjcmVhdGVzIHJlcXVpcmVkIHJlc291cmNlcycsICgpID0+IHtcclxuICBjb25zdCBhcHAgPSBuZXcgY2RrLkFwcCgpO1xyXG4gIGNvbnN0IHN0YWNrID0gbmV3IEluZnJhc3RydWN0dXJlLkF1dG9tYXRlZEJsb2dQb3N0ZXJTdGFjayhhcHAsICdNeVRlc3RTdGFjaycpO1xyXG4gIGNvbnN0IHRlbXBsYXRlID0gVGVtcGxhdGUuZnJvbVN0YWNrKHN0YWNrKTtcclxuXHJcbiAgLy8gVGVzdCBEeW5hbW9EQiB0YWJsZXNcclxuICB0ZW1wbGF0ZS5oYXNSZXNvdXJjZVByb3BlcnRpZXMoJ0FXUzo6RHluYW1vREI6OlRhYmxlJywge1xyXG4gICAgVGFibGVOYW1lOiAnYXV0b21hdGVkLWJsb2ctcG9zdGVyLWNvbnRlbnQnXHJcbiAgfSk7XHJcblxyXG4gIHRlbXBsYXRlLmhhc1Jlc291cmNlUHJvcGVydGllcygnQVdTOjpEeW5hbW9EQjo6VGFibGUnLCB7XHJcbiAgICBUYWJsZU5hbWU6ICdhdXRvbWF0ZWQtYmxvZy1wb3N0ZXItdXNlcnMnXHJcbiAgfSk7XHJcblxyXG4gIC8vIFRlc3QgUzMgYnVja2V0c1xyXG4gIHRlbXBsYXRlLnJlc291cmNlQ291bnRJcygnQVdTOjpTMzo6QnVja2V0JywgMik7XHJcblxyXG4gIC8vIFRlc3QgTGFtYmRhIGZ1bmN0aW9uXHJcbiAgdGVtcGxhdGUuaGFzUmVzb3VyY2VQcm9wZXJ0aWVzKCdBV1M6OkxhbWJkYTo6RnVuY3Rpb24nLCB7XHJcbiAgICBSdW50aW1lOiAnbm9kZWpzMTgueCdcclxuICB9KTtcclxuXHJcbiAgLy8gVGVzdCBBUEkgR2F0ZXdheVxyXG4gIHRlbXBsYXRlLmhhc1Jlc291cmNlUHJvcGVydGllcygnQVdTOjpBcGlHYXRld2F5OjpSZXN0QXBpJywge1xyXG4gICAgTmFtZTogJ0F1dG9tYXRlZCBCbG9nIFBvc3RlciBBUEknXHJcbiAgfSk7XHJcblxyXG4gIC8vIFRlc3QgU1FTIHF1ZXVlXHJcbiAgdGVtcGxhdGUuaGFzUmVzb3VyY2VQcm9wZXJ0aWVzKCdBV1M6OlNRUzo6UXVldWUnLCB7XHJcbiAgICBRdWV1ZU5hbWU6ICdhdXRvbWF0ZWQtYmxvZy1wb3N0ZXItYWdlbnRzJ1xyXG4gIH0pO1xyXG5cclxuICAvLyBUZXN0IEV2ZW50QnJpZGdlXHJcbiAgdGVtcGxhdGUuaGFzUmVzb3VyY2VQcm9wZXJ0aWVzKCdBV1M6OkV2ZW50czo6RXZlbnRCdXMnLCB7XHJcbiAgICBOYW1lOiAnYXV0b21hdGVkLWJsb2ctcG9zdGVyLWV2ZW50cydcclxuICB9KTtcclxuXHJcbiAgLy8gVGVzdCBTZWNyZXRzIE1hbmFnZXJcclxuICB0ZW1wbGF0ZS5oYXNSZXNvdXJjZVByb3BlcnRpZXMoJ0FXUzo6U2VjcmV0c01hbmFnZXI6OlNlY3JldCcsIHtcclxuICAgIE5hbWU6ICdhdXRvbWF0ZWQtYmxvZy1wb3N0ZXIvcGxhdGZvcm0tY3JlZGVudGlhbHMnXHJcbiAgfSk7XHJcbn0pOyJdfQ==