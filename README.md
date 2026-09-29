# Nighthawk

A small Next.js platform status app with a centered login landing page and a
JSON health endpoint.

## Development

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) for the landing page. The
health check is available at [http://localhost:3000/health](http://localhost:3000/health)
and returns:

```json
{ "status": "ok" }
```

## Verification

```bash
npm run typecheck
npm run build
```
