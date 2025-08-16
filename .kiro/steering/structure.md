# Project Structure

## Repository Organization

```
automated-blog-poster/
├── frontend/              # React PWA frontend application
│   ├── public/           # Static assets, PWA manifest
│   ├── src/              # React components and application code
│   ├── package.json      # Frontend dependencies and scripts
│   ├── tsconfig.json     # TypeScript configuration
│   └── vite.config.ts    # Vite build configuration
├── infrastructure/        # AWS CDK infrastructure code
│   ├── bin/              # CDK app entry point
│   ├── lib/              # CDK stack definitions
│   ├── test/             # Infrastructure unit tests
│   ├── package.json      # Infrastructure dependencies
│   ├── cdk.json          # CDK configuration
│   ├── jest.config.js    # Jest test configuration
│   └── tsconfig.json     # TypeScript configuration
├── docs/                 # Project documentation
│   ├── DEVELOPMENT.md    # Development setup and workflow
│   └── DEPLOYMENT.md     # Deployment procedures
├── .github/              # GitHub Actions workflows
├── .kiro/                # Kiro AI assistant configuration
│   └── steering/         # AI guidance documents
├── .nvmrc                # Node.js version specification
├── package.json          # Root package with workspace scripts
└── README.md             # Project overview and quick start
```

## Key Conventions

### File Organization
- **Separation of concerns**: Frontend and infrastructure are completely separate
- **TypeScript everywhere**: All code uses TypeScript with strict configuration
- **Configuration co-location**: Each module has its own package.json and tsconfig.json
- **Documentation proximity**: Keep docs close to relevant code

### Naming Patterns
- **Kebab-case**: For file names and directory names
- **PascalCase**: For React components and CDK constructs
- **camelCase**: For variables and functions
- **SCREAMING_SNAKE_CASE**: For environment variables and constants

### Development Workflow
- **Monorepo scripts**: Use root package.json scripts for cross-module operations
- **Independent builds**: Each module can be built and tested independently
- **Shared dependencies**: Common dev dependencies at root level where possible

### Infrastructure Patterns
- **Stack-per-environment**: Use CDK context for environment-specific deployments
- **Resource naming**: Include environment and purpose in resource names
- **Security by default**: Apply least privilege and encryption by default

### Frontend Patterns
- **Component co-location**: Keep components, styles, and tests together
- **Public assets**: Static files in public/ directory for GitHub Pages
- **Environment configuration**: Use build-time environment variables
- **Vite entry point**: index.html MUST be in frontend root, not public/
- **Build validation**: Always test `npm run build` locally before pushing

## Module Responsibilities

### Frontend (`/frontend`)
- React PWA for voice input and content management
- Mobile-optimized UI components
- Offline capability and service worker
- API integration with backend services

### Infrastructure (`/infrastructure`)
- AWS CDK stack definitions
- Lambda function code and configuration
- Database schema and access patterns
- API Gateway routes and CORS setup

### Documentation (`/docs`)
- Development setup and guidelines
- Deployment procedures and troubleshooting
- Architecture decisions and patterns

### Root Level
- Workspace-wide scripts and configuration
- Shared development dependencies
- Project overview and quick start guide