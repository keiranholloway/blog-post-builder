# GitHub Pages Setup Instructions

## Manual Configuration Required

GitHub Pages must be enabled manually in the repository settings:

1. Go to repository **Settings**
2. Scroll to **Pages** section in the left sidebar
3. Under **Source**, select "Deploy from a branch"
4. Select **main** branch
5. Select **/ (root)** folder
6. Click **Save**

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