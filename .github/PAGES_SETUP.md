# GitHub Pages Setup Instructions

## Manual Configuration Required

GitHub Pages must be configured to use GitHub Actions (NOT branch deployment):

1. Go to repository **Settings**
2. Scroll to **Pages** section in the left sidebar
3. Under **Source**, select **"GitHub Actions"** (NOT "Deploy from a branch")
4. This will use the workflow in `.github/workflows/deploy.yml`
5. The workflow will automatically deploy the built React app from `frontend/build`

## IMPORTANT: Do NOT use "Deploy from a branch"
- If you select "Deploy from a branch", it will serve README.md as the index page
- Always use "GitHub Actions" as the source for this project

## Verification

After enabling Pages:
- The site will be available at: `https://[username].github.io/[repository-name]`
- GitHub Actions will automatically deploy on pushes to main branch
- Check the Actions tab for deployment status

## Custom Domain (Optional)

To use a custom domain:
1. Add your domain to the **Custom domain** field in Pages settings
2. Create a `CNAME` file in the repository root with your domain
3. Configure DNS CNAME record pointing to `[username].github.io`

## Troubleshooting

- If deployment fails, check the Actions tab for error logs
- Ensure the `frontend/build` directory is created by the build process
- Verify CORS settings in API Gateway match your domain