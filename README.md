# Nighthawk

A small Next.js platform status app with a centered login landing page and a
JSON health endpoint.

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
