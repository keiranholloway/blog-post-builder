# Deployment Checklist

## Before Every Deployment

### Frontend (GitHub Pages)
- [ ] `cd frontend && npm run build` completes successfully
- [ ] `npm run preview` shows working app locally
- [ ] index.html exists in frontend root (not public/)
- [ ] All TypeScript compilation passes
- [ ] No console errors in browser dev tools

### Infrastructure (AWS CDK)
- [ ] `cd infrastructure && npm run build` passes
- [ ] `npm run synth` generates CloudFormation successfully
- [ ] `npm run diff` shows expected changes only
- [ ] AWS credentials are configured and valid
- [ ] CDK is bootstrapped in target region

## Common Failure Points to Check

### Vite/React Issues
- Missing index.html in frontend root
- Incorrect import paths (case sensitivity)
- Missing dependencies in package.json
- TypeScript errors not caught locally

### CDK Issues
- Missing AWS permissions
- Resource naming conflicts
- Stack dependencies not resolved
- Environment variables not set

## Quick Fix Commands

```bash
# Reset frontend if broken
cd frontend
rm -rf node_modules build
npm install
npm run build

# Reset infrastructure if broken
cd infrastructure
rm -rf node_modules cdk.out
npm install
npm run build
```

## Emergency Rollback

### Frontend
```bash
git revert HEAD
git push origin main
```

### Infrastructure
```bash
git checkout previous-working-commit
cd infrastructure
npm run deploy
```