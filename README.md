# Nighthawk

Nighthawk checks configured HTTP(S) health endpoints every 10 seconds while the
Node server is running. Instances begin with one gray box, then gain a green
(success) or amber (failure) box only when their state changes. Platform detail
history uses gray, green, and red for unknown, available, and fully offline.
The dashboard uses amber when a currently available platform had a total outage
within the latest three check cycles.
Each dashboard box shows only the number of full days since the most recent
platform outage recovered. An ongoing outage shows 0. Platforms with no recorded
outage count from creation; unavailable timestamps show 0. Individual instance
failures do not reset the count while another instance keeps the platform online.

Platforms, instances, the latest three aligned check cycles, state transitions,
and hourly uptime counts persist in SQLite. Uptime is healthy checks divided by
known checks over a rolling 30 days, with a 99.5% target. New instances are
measured only from their first check; the coverage label shows how much of the
window has data. Unknown results and missed monitoring runs are excluded. Hourly
counts older than 30 days are pruned during check cycles. A bucket crossing the
window edge is included whole, so the figure can include up to one extra hour.
The database is
`$NIGHTHAWK_DATA_DIR/nighthawk.sqlite`, defaulting to `data/nighthawk.sqlite`
(`/app/data/nighthawk.sqlite` in Docker). A persistent volume is required to keep
this file across deployments. `.deploy.yml` declares that volume and points
`NIGHTHAWK_DATA_DIR` at it; apply it using **Deploy through the API** as described
in [DEPLOYMENT.md](DEPLOYMENT.md). Use Node 24 (the Docker runtime); local Node
22.13+ also supports the built-in SQLite driver, with an experimental warning.

On first startup, existing `platforms.json` data in the same directory is imported
atomically and left untouched as a backup. Invalid legacy data stops startup
without a partial import. Correct it and restart to retry. Later startups do
not re-import JSON. Missing legacy timestamps remain unknown; discarded history
cannot be recovered. Browser-local imports remain supported and idempotent.

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
npm run test:bdd
npm run typecheck
npm run build
```

`tests/uptime.test.mjs` covers the percentage and coverage rules;
`tests/features/uptime-window.feature` covers the rendered uptime views.

Run the Gherkin acceptance specification for instance state changes with:

```bash
npm run test:bdd
```

`tests/features/instance-state-history.feature` specifies one initial gray box,
green for online, amber for offline, and one additional box per state change.
Repeated identical results must not add boxes. The initial unknown state is
retained in the expected history, ordered newest first.

The original Gherkin scenarios render the real instance view. The durable
monitoring scenarios run controlled checks, reopen a file-backed database, and
render its persisted histories. Integration tests cover migrations, transaction
rollback, foreign keys, stale/overlapping cycles, timeouts, duplicate imports,
API responses, ordering, retention, process restarts, and backup restoration.
Tests use temporary directories inside this workspace and controlled responses.

With Docker available, run `npm run test:container` to build the Node 24 image,
check the mounted directory is writable by the container user, save data through
the API, and replace the container while reusing that directory. It also tests
the production backup command and cleans up its containers and test data.

## Deployment

See [DEPLOYMENT.md](DEPLOYMENT.md) for the Railway deployment plan and the
Deployer-based release workflow.
