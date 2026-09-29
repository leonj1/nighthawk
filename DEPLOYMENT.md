# Railway deployment plan

Nighthawk deploys to Railway through the Deployer API. The repository follows
Deployer's Railway guide and uses the full API workflow because the packaged
Deployer Action currently submits an incomplete manifest.

## Initial deployment

1. Validate the TypeScript app, production build, container image, and
   `/healthz` response locally.
2. Push `Dockerfile`, `.deploy.yml`, and `.github/workflows/deploy.yml` to the
   default branch.
3. Configure the `DEPLOYER_URL`, `TOKEN_EXCHANGE_URL`, and `OIDC_AUDIENCE`
   GitHub Actions variables with the operator-provided values.
4. Run **Deploy through the API** against `dev` and monitor it until Deployer
   reports `succeeded`.
5. Verify `/healthz` and the application pages on the returned Railway public
   domain.

## Production promotion

After the development deployment is healthy, manually run the same workflow
with `environment=prod`, monitor it to completion, and verify the returned
production domain. Railway tracks the repository's default branch for later
deployments.
