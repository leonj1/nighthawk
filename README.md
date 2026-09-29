# Nighthawk

Nighthawk is a monitoring platform for highly available services deployed
across multiple regions. If one regional instance goes offline, the platform
remains online but is marked as having lost resiliency. If every instance goes
offline, the platform is considered offline.

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
npm run typecheck
npm run build
```

## Deployment

See [DEPLOYMENT.md](DEPLOYMENT.md) for the Railway deployment plan and the
Deployer-based release workflow.
