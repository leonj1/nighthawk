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
every 10 seconds. Detail views show state changes, newest first, with their
original timestamps; the dashboard uses the latest three aligned check cycles.

## SQLite persistence and first deployment

The app uses Node's built-in `node:sqlite` driver. Schema version 1 has platforms,
instances, check runs/results, and separate instance/platform transition tables.
Foreign keys, WAL, full synchronous writes, and transactions protect commits.
Versioned migrations and the one-time JSON import commit together. Unsupported
future schema versions stop startup. Network probes run outside transactions;
failed writes leave the last committed results available and are logged.

`.deploy.yml` declares `spec.volumes: [{name: data, mountPath: /app/data}]`
using the [Deployer volume configuration](https://deployer-production-4a17.up.railway.app/docs/reference/manifest#persistent-container-volumes).
It sets `NIGHTHAWK_DATA_DIR=/app/data`, so startup creates
`/app/data/nighthawk.sqlite` (and SQLite WAL/SHM files) on that volume.

1. **Before replacing the running service or mounting over `/app/data`, export
   its existing database using the backup procedure below (or `platforms.json`
   for a pre-SQLite service) and keep a separate copy.** A new volume hides the
   ephemeral directory; attaching it does not migrate existing files.
2. Run **Deploy through the API** to apply the manifest. A normal GitHub push
   builds the image but does not submit the volume declaration to Deployer.
   Deployer creates and attaches the volume and reuses it on subsequent Deploys.
   Keep **one replica** and one monitoring process. If a manually attached,
   unowned volume already exists, reconcile ownership with the Deployer operator;
   do not remove a disk containing data to bypass an ownership error.
3. The manifest sets `RAILWAY_RUN_UID=0` so Railway's root-owned volume is
   writable despite the Docker image's default UID 1001. This runs the deployed
   process as root. See [Railway volume permissions](https://docs.railway.com/volumes).
   If moving the mount, change `mountPath` and `NIGHTHAWK_DATA_DIR` together.
4. For existing SQLite data, follow the restore procedure below. For legacy JSON,
   with the service stopped, place the exported `platforms.json` in the mounted
   directory **before the first SQLite startup**. Do not initialize an empty
   database first; the JSON import is intentionally one-time.
5. Start the service. It creates `nighthawk.sqlite` and imports the JSON in one
   transaction, preserving IDs, URLs, state changes, ordering and available
   timestamps. Existing instance URLs are their identity in the API; SQLite
   assigns stable internal IDs. Older records reconstruct only retained history.
6. Verify the expected platforms, instances, endpoints and histories in the API
   and detail views. Replace the container with the same volume attached and
   verify again. `npm run test:container` automates the equivalent local check.

A malformed legacy file, inaccessible directory, or corrupt database produces an
error; the app does not silently reset or fall back to ephemeral storage. After
correcting a failed JSON import, restart to retry. Do not delete an existing
working database to rerun import. Preserve the JSON backup until verified.

## Backup and restore

From a checkout use `npm run backup -- /path/to/new-backup.sqlite`; in the deployed
container use `node scripts/backup.mjs /app/data/new-backup.sqlite`. Choose a new
filename each time. The command uses SQLite `VACUUM INTO` to take a consistent
snapshot including committed WAL data; do not simply copy a live database file.
A missing source or existing destination fails instead of overwriting anything.
Copy verified backups off the service volume and arrange regular backups.

To restore, stop the service and preserve its current database and any `-wal`
and `-shm` files together in a separate backup directory. Restore the snapshot
as `nighthawk.sqlite` in an otherwise clean data directory on the mounted volume,
with writable ownership/permissions. Do not leave WAL/SHM files from another
database beside it. Restart and verify the entities and histories. An imported
snapshot includes the schema version and migration marker; old JSON will not be
re-imported. Roll back to the preserved directory if verification fails.

Monitoring stops when the service stops or is suspended. State transition
history grows with each change and is not pruned; monitor volume capacity.
SQLite durability does not replace volume provisioning or backups. The app has
no authentication; keep it behind your existing access controls.
