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
4. Run **Deploy through the API** against the shared Railway project's
   `production` environment and monitor it until Deployer reports `succeeded`.
5. Verify `/healthz` and the application pages on the returned Railway public
   domain.

## Production promotion

When the operator adds separate `dev` or `prod` Railway environments, manually
run the same workflow with that environment selected and verify the returned
domain. Railway tracks the repository's default branch for later deployments.

## Live monitoring

The Node server checks every configured instance every 10 seconds, including
when no browser is open. GET requests follow up to three redirects; HTTP 2xx is
healthy, and other responses, connection failures or an 8-second timeout are
offline. Only public IPv4 destinations are supported; private, loopback and
metadata addresses are blocked, including redirect targets.

The create-platform form accepts an optional health-check path (for example,
`/health`) or full HTTP(S) URL per instance. Existing browser-local platforms
are imported on the next dashboard or instances-page visit and default to their
saved instance URL. Sample platforms are no longer displayed. The pages refresh
every 10 seconds and show the latest three completed checks, newest first.

Platforms and results are stored in `data/platforms.json`. Set
`NIGHTHAWK_DATA_DIR` to a writable persistent volume mount path on Railway to
retain configuration across redeployments. Run a single Node service replica;
the file store is not intended for concurrent replicas. Monitoring stops when
the service is stopped or suspended. The app currently has no authentication;
keep it behind your existing access controls.
