# Nighthawk

Nighthawk is a monitoring platform for highly available services deployed
across multiple regions. A successful instance health check is green; a failed
check is red. A platform is red only when every instance is offline at the same
check time, and remains available if at least one instance has a successful check.

Only the dashboard uses amber: the platform is currently available, but every
instance was offline together during the displayed monitoring window. Current
total outages take precedence and remain red. Detail history uses green or red
for each check time, with gray for missing or inconclusive checks.

The current UI uses sample checks for Platform 1–15 and browser-local storage
for created platforms. There is no remote health-check collector yet. New and
previously saved platforms without check results appear gray. Check histories
are stored in `checks`, keyed by instance URL, with newest-first boolean results
(`true` for success, `false` for failure, `null` for unknown). Array positions
must refer to the same check time across instances; the displayed window is
the latest three positions (now, 30 minutes ago, and one hour ago).

This repository contains the Next.js application, including its status
dashboard and JSON health endpoints.

## Development

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) for the landing page. The
health checks are available at [http://localhost:3000/health](http://localhost:3000/health)
and [http://localhost:3000/healthz](http://localhost:3000/healthz). Both return:

```json
{ "status": "ok" }
```

## Verification

```bash
npm test
npm run typecheck
npm run build
```

## Deployment

See [DEPLOYMENT.md](DEPLOYMENT.md) for the Railway deployment plan and the
Deployer-based release workflow.
