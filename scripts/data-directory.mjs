import path from "node:path";

// Shared by the server and backup command so both open the same database.
export function dataDirectory(env = process.env, cwd = process.cwd()) {
  const mount = env.RAILWAY_VOLUME_MOUNT_PATH;
  const directory = path.resolve(cwd, env.NIGHTHAWK_DATA_DIR || mount || "data");
  if (env.RAILWAY_ENVIRONMENT_ID || env.RAILWAY_SERVICE_ID || mount) {
    if (!mount || !path.isAbsolute(mount)) {
      throw new Error("SQLite persistence requires a Railway volume. Attach the data volume at /app/data using Deploy through the API; RAILWAY_VOLUME_MOUNT_PATH must be supplied by Railway.");
    }
    const relative = path.relative(path.resolve(mount), directory);
    if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error(`SQLite data directory ${directory} is outside the Railway volume at ${mount}. Set NIGHTHAWK_DATA_DIR to the mounted directory before starting.`);
    }
  }
  return directory;
}
