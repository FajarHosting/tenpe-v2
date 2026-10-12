import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const dbPath = process.env.SQLITE_DB_PATH || path.resolve(process.cwd(), 'data', 'adviora.sqlite');
const schemaPath = path.resolve(process.cwd(), 'db', 'schema.sql');
const rollbackPath = path.resolve(process.cwd(), 'db', 'migrations', '001_initial_adviora.down.sql');

const command = process.argv[2] || 'up';

fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new DatabaseSync(dbPath);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

if (command === 'down' || command === 'rollback') {
  const downSql = fs.readFileSync(rollbackPath, 'utf8');
  db.exec(downSql);
  console.log(`[migrate] Rolled back migration 001_initial_adviora on ${dbPath}`);
} else {
  const schemaSql = fs.readFileSync(schemaPath, 'utf8');
  db.exec(schemaSql);
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (?, ?)`
  );
  stmt.run('001_initial_adviora', new Date().toISOString());
  console.log(`[migrate] Applied migration 001_initial_adviora on ${dbPath}`);
}
