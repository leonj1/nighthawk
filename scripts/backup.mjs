import { DatabaseSync } from "node:sqlite";
import path from "node:path";

const destination = process.argv[2];
if (!destination) throw new Error("Usage: node scripts/backup.mjs <new-backup-file.sqlite>");
const source = path.join(process.env.NIGHTHAWK_DATA_DIR || path.join(process.cwd(), "data"), "nighthawk.sqlite");
// Opening read-only refuses a missing source instead of creating an empty backup.
const database = new DatabaseSync(source, { readOnly: true });
try {
  database.exec("PRAGMA busy_timeout = 1000");
  database.prepare("VACUUM INTO ?").run(path.resolve(destination));
  console.log(`SQLite backup saved to ${path.resolve(destination)}`);
} finally { database.close(); }
