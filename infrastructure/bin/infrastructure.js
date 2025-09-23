#!/usr/bin/env node
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
require("source-map-support/register");
const cdk = __importStar(require("aws-cdk-lib"));
const automated_blog_poster_stack_1 = require("../lib/automated-blog-poster-stack");
const monitoring_stack_1 = require("../lib/monitoring-stack");
const app = new cdk.App();
// Get environment from context
const environment = app.node.tryGetContext('environment') || 'development';
const account = process.env.CDK_DEFAULT_ACCOUNT;
const region = process.env.CDK_DEFAULT_REGION || 'us-east-1';
// Environment-specific configuration
const envConfig = {
    development: {
        stackName: 'AutomatedBlogPoster-Dev',
        monitoringStackName: 'AutomatedBlogPoster-Monitoring-Dev',
        alertEmail: undefined,
        corsOrigin: 'http://localhost:5173',
        domainName: undefined,
    },
    staging: {
        stackName: 'AutomatedBlogPoster-Staging',
        monitoringStackName: 'AutomatedBlogPoster-Monitoring-Staging',
        alertEmail: process.env.ALERT_EMAIL,
        corsOrigin: 'https://staging.yourdomain.com',
        domainName: 'staging.yourdomain.com',
    },
    production: {
        stackName: 'AutomatedBlogPoster-Prod',
        monitoringStackName: 'AutomatedBlogPoster-Monitoring-Prod',
        alertEmail: process.env.ALERT_EMAIL || 'alerts@yourdomain.com',
        corsOrigin: 'https://keiranholloway.github.io',
        domainName: 'blog-poster.yourdomain.com',
    },
};
const config = envConfig[environment];
if (!config) {
    throw new Error(`Unknown environment: ${environment}`);
}
// Main application stack
const mainStack = new automated_blog_poster_stack_1.AutomatedBlogPosterStack(app, config.stackName, {
    env: { account, region },
    description: `Automated Blog Poster - ${environment} environment`,
    tags: {
        Environment: environment,
        Project: 'AutomatedBlogPoster',
        ManagedBy: 'CDK',
    },
    corsOrigin: config.corsOrigin,
    domainName: config.domainName,
});
// Monitoring stack (only for staging and production)
if (environment !== 'development') {
    new monitoring_stack_1.MonitoringStack(app, config.monitoringStackName, {
        env: { account, region },
        description: `Automated Blog Poster Monitoring - ${environment} environment`,
        tags: {
            Environment: environment,
            Project: 'AutomatedBlogPoster',
            ManagedBy: 'CDK',
        },
        lambdaFunctions: mainStack.lambdaFunctions,
        api: mainStack.api,
        tables: mainStack.tables,
        queues: mainStack.queues,
        alertEmail: config.alertEmail,
    });
}
app.synth();
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5mcmFzdHJ1Y3R1cmUuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJpbmZyYXN0cnVjdHVyZS50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQUNBLHVDQUFxQztBQUNyQyxpREFBbUM7QUFDbkMsb0ZBQThFO0FBQzlFLDhEQUEwRDtBQUUxRCxNQUFNLEdBQUcsR0FBRyxJQUFJLEdBQUcsQ0FBQyxHQUFHLEVBQUUsQ0FBQztBQUUxQiwrQkFBK0I7QUFDL0IsTUFBTSxXQUFXLEdBQUcsR0FBRyxDQUFDLElBQUksQ0FBQyxhQUFhLENBQUMsYUFBYSxDQUFDLElBQUksYUFBYSxDQUFDO0FBQzNFLE1BQU0sT0FBTyxHQUFHLE9BQU8sQ0FBQyxHQUFHLENBQUMsbUJBQW1CLENBQUM7QUFDaEQsTUFBTSxNQUFNLEdBQUcsT0FBTyxDQUFDLEdBQUcsQ0FBQyxrQkFBa0IsSUFBSSxXQUFXLENBQUM7QUFFN0QscUNBQXFDO0FBQ3JDLE1BQU0sU0FBUyxHQUFHO0lBQ2hCLFdBQVcsRUFBRTtRQUNYLFNBQVMsRUFBRSx5QkFBeUI7UUFDcEMsbUJBQW1CLEVBQUUsb0NBQW9DO1FBQ3pELFVBQVUsRUFBRSxTQUFTO1FBQ3JCLFVBQVUsRUFBRSx1QkFBdUI7UUFDbkMsVUFBVSxFQUFFLFNBQVM7S0FDdEI7SUFDRCxPQUFPLEVBQUU7UUFDUCxTQUFTLEVBQUUsNkJBQTZCO1FBQ3hDLG1CQUFtQixFQUFFLHdDQUF3QztRQUM3RCxVQUFVLEVBQUUsT0FBTyxDQUFDLEdBQUcsQ0FBQyxXQUFXO1FBQ25DLFVBQVUsRUFBRSxnQ0FBZ0M7UUFDNUMsVUFBVSxFQUFFLHdCQUF3QjtLQUNyQztJQUNELFVBQVUsRUFBRTtRQUNWLFNBQVMsRUFBRSwwQkFBMEI7UUFDckMsbUJBQW1CLEVBQUUscUNBQXFDO1FBQzFELFVBQVUsRUFBRSxPQUFPLENBQUMsR0FBRyxDQUFDLFdBQVcsSUFBSSx1QkFBdUI7UUFDOUQsVUFBVSxFQUFFLGtDQUFrQztRQUM5QyxVQUFVLEVBQUUsNEJBQTRCO0tBQ3pDO0NBQ0YsQ0FBQztBQUVGLE1BQU0sTUFBTSxHQUFHLFNBQVMsQ0FBQyxXQUFxQyxDQUFDLENBQUM7QUFFaEUsSUFBSSxDQUFDLE1BQU0sRUFBRTtJQUNYLE1BQU0sSUFBSSxLQUFLLENBQUMsd0JBQXdCLFdBQVcsRUFBRSxDQUFDLENBQUM7Q0FDeEQ7QUFFRCx5QkFBeUI7QUFDekIsTUFBTSxTQUFTLEdBQUcsSUFBSSxzREFBd0IsQ0FBQyxHQUFHLEVBQUUsTUFBTSxDQUFDLFNBQVMsRUFBRTtJQUNwRSxHQUFHLEVBQUUsRUFBRSxPQUFPLEVBQUUsTUFBTSxFQUFFO0lBQ3hCLFdBQVcsRUFBRSwyQkFBMkIsV0FBVyxjQUFjO0lBQ2pFLElBQUksRUFBRTtRQUNKLFdBQVcsRUFBRSxXQUFXO1FBQ3hCLE9BQU8sRUFBRSxxQkFBcUI7UUFDOUIsU0FBUyxFQUFFLEtBQUs7S0FDakI7SUFDRCxVQUFVLEVBQUUsTUFBTSxDQUFDLFVBQVU7SUFDN0IsVUFBVSxFQUFFLE1BQU0sQ0FBQyxVQUFVO0NBQzlCLENBQUMsQ0FBQztBQUVILHFEQUFxRDtBQUNyRCxJQUFJLFdBQVcsS0FBSyxhQUFhLEVBQUU7SUFDakMsSUFBSSxrQ0FBZSxDQUFDLEdBQUcsRUFBRSxNQUFNLENBQUMsbUJBQW1CLEVBQUU7UUFDbkQsR0FBRyxFQUFFLEVBQUUsT0FBTyxFQUFFLE1BQU0sRUFBRTtRQUN4QixXQUFXLEVBQUUsc0NBQXNDLFdBQVcsY0FBYztRQUM1RSxJQUFJLEVBQUU7WUFDSixXQUFXLEVBQUUsV0FBVztZQUN4QixPQUFPLEVBQUUscUJBQXFCO1lBQzlCLFNBQVMsRUFBRSxLQUFLO1NBQ2pCO1FBQ0QsZUFBZSxFQUFFLFNBQVMsQ0FBQyxlQUFlO1FBQzFDLEdBQUcsRUFBRSxTQUFTLENBQUMsR0FBRztRQUNsQixNQUFNLEVBQUUsU0FBUyxDQUFDLE1BQU07UUFDeEIsTUFBTSxFQUFFLFNBQVMsQ0FBQyxNQUFNO1FBQ3hCLFVBQVUsRUFBRSxNQUFNLENBQUMsVUFBVTtLQUM5QixDQUFDLENBQUM7Q0FDSjtBQUVELEdBQUcsQ0FBQyxLQUFLLEVBQUUsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIiMhL3Vzci9iaW4vZW52IG5vZGVcclxuaW1wb3J0ICdzb3VyY2UtbWFwLXN1cHBvcnQvcmVnaXN0ZXInO1xyXG5pbXBvcnQgKiBhcyBjZGsgZnJvbSAnYXdzLWNkay1saWInO1xyXG5pbXBvcnQgeyBBdXRvbWF0ZWRCbG9nUG9zdGVyU3RhY2sgfSBmcm9tICcuLi9saWIvYXV0b21hdGVkLWJsb2ctcG9zdGVyLXN0YWNrJztcclxuaW1wb3J0IHsgTW9uaXRvcmluZ1N0YWNrIH0gZnJvbSAnLi4vbGliL21vbml0b3Jpbmctc3RhY2snO1xyXG5cclxuY29uc3QgYXBwID0gbmV3IGNkay5BcHAoKTtcclxuXHJcbi8vIEdldCBlbnZpcm9ubWVudCBmcm9tIGNvbnRleHRcclxuY29uc3QgZW52aXJvbm1lbnQgPSBhcHAubm9kZS50cnlHZXRDb250ZXh0KCdlbnZpcm9ubWVudCcpIHx8ICdkZXZlbG9wbWVudCc7XHJcbmNvbnN0IGFjY291bnQgPSBwcm9jZXNzLmVudi5DREtfREVGQVVMVF9BQ0NPVU5UO1xyXG5jb25zdCByZWdpb24gPSBwcm9jZXNzLmVudi5DREtfREVGQVVMVF9SRUdJT04gfHwgJ3VzLWVhc3QtMSc7XHJcblxyXG4vLyBFbnZpcm9ubWVudC1zcGVjaWZpYyBjb25maWd1cmF0aW9uXHJcbmNvbnN0IGVudkNvbmZpZyA9IHtcclxuICBkZXZlbG9wbWVudDoge1xyXG4gICAgc3RhY2tOYW1lOiAnQXV0b21hdGVkQmxvZ1Bvc3Rlci1EZXYnLFxyXG4gICAgbW9uaXRvcmluZ1N0YWNrTmFtZTogJ0F1dG9tYXRlZEJsb2dQb3N0ZXItTW9uaXRvcmluZy1EZXYnLFxyXG4gICAgYWxlcnRFbWFpbDogdW5kZWZpbmVkLFxyXG4gICAgY29yc09yaWdpbjogJ2h0dHA6Ly9sb2NhbGhvc3Q6NTE3MycsXHJcbiAgICBkb21haW5OYW1lOiB1bmRlZmluZWQsXHJcbiAgfSxcclxuICBzdGFnaW5nOiB7XHJcbiAgICBzdGFja05hbWU6ICdBdXRvbWF0ZWRCbG9nUG9zdGVyLVN0YWdpbmcnLFxyXG4gICAgbW9uaXRvcmluZ1N0YWNrTmFtZTogJ0F1dG9tYXRlZEJsb2dQb3N0ZXItTW9uaXRvcmluZy1TdGFnaW5nJyxcclxuICAgIGFsZXJ0RW1haWw6IHByb2Nlc3MuZW52LkFMRVJUX0VNQUlMLFxyXG4gICAgY29yc09yaWdpbjogJ2h0dHBzOi8vc3RhZ2luZy55b3VyZG9tYWluLmNvbScsXHJcbiAgICBkb21haW5OYW1lOiAnc3RhZ2luZy55b3VyZG9tYWluLmNvbScsXHJcbiAgfSxcclxuICBwcm9kdWN0aW9uOiB7XHJcbiAgICBzdGFja05hbWU6ICdBdXRvbWF0ZWRCbG9nUG9zdGVyLVByb2QnLFxyXG4gICAgbW9uaXRvcmluZ1N0YWNrTmFtZTogJ0F1dG9tYXRlZEJsb2dQb3N0ZXItTW9uaXRvcmluZy1Qcm9kJyxcclxuICAgIGFsZXJ0RW1haWw6IHByb2Nlc3MuZW52LkFMRVJUX0VNQUlMIHx8ICdhbGVydHNAeW91cmRvbWFpbi5jb20nLFxyXG4gICAgY29yc09yaWdpbjogJ2h0dHBzOi8va2VpcmFuaG9sbG93YXkuZ2l0aHViLmlvJyxcclxuICAgIGRvbWFpbk5hbWU6ICdibG9nLXBvc3Rlci55b3VyZG9tYWluLmNvbScsXHJcbiAgfSxcclxufTtcclxuXHJcbmNvbnN0IGNvbmZpZyA9IGVudkNvbmZpZ1tlbnZpcm9ubWVudCBhcyBrZXlvZiB0eXBlb2YgZW52Q29uZmlnXTtcclxuXHJcbmlmICghY29uZmlnKSB7XHJcbiAgdGhyb3cgbmV3IEVycm9yKGBVbmtub3duIGVudmlyb25tZW50OiAke2Vudmlyb25tZW50fWApO1xyXG59XHJcblxyXG4vLyBNYWluIGFwcGxpY2F0aW9uIHN0YWNrXHJcbmNvbnN0IG1haW5TdGFjayA9IG5ldyBBdXRvbWF0ZWRCbG9nUG9zdGVyU3RhY2soYXBwLCBjb25maWcuc3RhY2tOYW1lLCB7XHJcbiAgZW52OiB7IGFjY291bnQsIHJlZ2lvbiB9LFxyXG4gIGRlc2NyaXB0aW9uOiBgQXV0b21hdGVkIEJsb2cgUG9zdGVyIC0gJHtlbnZpcm9ubWVudH0gZW52aXJvbm1lbnRgLFxyXG4gIHRhZ3M6IHtcclxuICAgIEVudmlyb25tZW50OiBlbnZpcm9ubWVudCxcclxuICAgIFByb2plY3Q6ICdBdXRvbWF0ZWRCbG9nUG9zdGVyJyxcclxuICAgIE1hbmFnZWRCeTogJ0NESycsXHJcbiAgfSxcclxuICBjb3JzT3JpZ2luOiBjb25maWcuY29yc09yaWdpbixcclxuICBkb21haW5OYW1lOiBjb25maWcuZG9tYWluTmFtZSxcclxufSk7XHJcblxyXG4vLyBNb25pdG9yaW5nIHN0YWNrIChvbmx5IGZvciBzdGFnaW5nIGFuZCBwcm9kdWN0aW9uKVxyXG5pZiAoZW52aXJvbm1lbnQgIT09ICdkZXZlbG9wbWVudCcpIHtcclxuICBuZXcgTW9uaXRvcmluZ1N0YWNrKGFwcCwgY29uZmlnLm1vbml0b3JpbmdTdGFja05hbWUsIHtcclxuICAgIGVudjogeyBhY2NvdW50LCByZWdpb24gfSxcclxuICAgIGRlc2NyaXB0aW9uOiBgQXV0b21hdGVkIEJsb2cgUG9zdGVyIE1vbml0b3JpbmcgLSAke2Vudmlyb25tZW50fSBlbnZpcm9ubWVudGAsXHJcbiAgICB0YWdzOiB7XHJcbiAgICAgIEVudmlyb25tZW50OiBlbnZpcm9ubWVudCxcclxuICAgICAgUHJvamVjdDogJ0F1dG9tYXRlZEJsb2dQb3N0ZXInLFxyXG4gICAgICBNYW5hZ2VkQnk6ICdDREsnLFxyXG4gICAgfSxcclxuICAgIGxhbWJkYUZ1bmN0aW9uczogbWFpblN0YWNrLmxhbWJkYUZ1bmN0aW9ucyxcclxuICAgIGFwaTogbWFpblN0YWNrLmFwaSxcclxuICAgIHRhYmxlczogbWFpblN0YWNrLnRhYmxlcyxcclxuICAgIHF1ZXVlczogbWFpblN0YWNrLnF1ZXVlcyxcclxuICAgIGFsZXJ0RW1haWw6IGNvbmZpZy5hbGVydEVtYWlsLFxyXG4gIH0pO1xyXG59XHJcblxyXG5hcHAuc3ludGgoKTsiXX0=