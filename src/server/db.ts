import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

// Setup DB path in a 'data' folder at root of the project
const DB_DIR = path.resolve(process.cwd(), 'data');
if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

const DB_PATH = path.join(DB_DIR, 'statsy.db');
export const db = new Database(DB_PATH);

// Enable WAL mode for better concurrency in SQLite
db.pragma('journal_mode = WAL');

export function initDatabase() {
  // 1. Services table
  db.prepare(`
    CREATE TABLE IF NOT EXISTS services (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      check_interval INTEGER NOT NULL DEFAULT 60, -- in seconds
      status TEXT NOT NULL DEFAULT 'operational', -- operational, degraded, outage
      last_checked_at TEXT,
      headers TEXT, -- custom HTTP headers stored as a JSON string
      type TEXT NOT NULL DEFAULT 'http', -- http, tcp
      ssl_expiry_days INTEGER
    )
  `).run();

  // 2. Latency checks table
  db.prepare(`
    CREATE TABLE IF NOT EXISTS latency_checks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      service_id INTEGER NOT NULL,
      status_code INTEGER,
      latency INTEGER, -- in ms
      is_up INTEGER NOT NULL, -- 1 for true, 0 for false
      error_message TEXT,
      checked_at TEXT NOT NULL,
      FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE CASCADE
    )
  `).run();

  // Index on service_id + checked_at for rapid 90-day history queries
  db.prepare(`
    CREATE INDEX IF NOT EXISTS idx_latency_checks_service_checked 
    ON latency_checks(service_id, checked_at DESC)
  `).run();

  // Index on checked_at for older logs cleanup queries
  db.prepare(`
    CREATE INDEX IF NOT EXISTS idx_latency_checks_checked_at 
    ON latency_checks(checked_at)
  `).run();

  // 3. Incidents table
  db.prepare(`
    CREATE TABLE IF NOT EXISTS incidents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'investigating', -- investigating, identified, monitoring, resolved
      severity TEXT NOT NULL DEFAULT 'degraded', -- degraded, major
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `).run();

  // 4. Incident Updates table
  db.prepare(`
    CREATE TABLE IF NOT EXISTS incident_updates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      incident_id INTEGER NOT NULL,
      status TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (incident_id) REFERENCES incidents(id) ON DELETE CASCADE
    )
  `).run();

  db.prepare(`
    CREATE INDEX IF NOT EXISTS idx_incident_updates_incident_id 
    ON incident_updates(incident_id)
  `).run();

  // 5. Scheduled Maintenances table
  db.prepare(`
    CREATE TABLE IF NOT EXISTS maintenances (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      start_at TEXT NOT NULL,
      end_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'scheduled', -- scheduled, in_progress, completed, cancelled
      created_at TEXT NOT NULL
    )
  `).run();

  // 6. Settings table (key-value store)
  db.prepare(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    )
  `).run();

  // 7. Nodes table for multi-region probing
  db.prepare(`
    CREATE TABLE IF NOT EXISTS nodes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      api_url TEXT NOT NULL,
      api_secret TEXT NOT NULL,
      is_active INTEGER DEFAULT 1,
      created_at TEXT NOT NULL
    )
  `).run();

  // Seed default settings if they are missing
  const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  insertSetting.run('smtp_host', '');
  insertSetting.run('smtp_port', '587');
  insertSetting.run('smtp_user', '');
  insertSetting.run('smtp_pass', '');
  insertSetting.run('smtp_from', 'noreply@statsy.dev');
  insertSetting.run('alert_email', '');
  insertSetting.run('webhook_url', '');
  insertSetting.run('webhook_type', 'discord'); // discord, slack, or generic
  insertSetting.run('local_node_name', 'Primary');

  // Generate a secure node_secret if it doesn't exist
  const existingSecret = db.prepare("SELECT value FROM settings WHERE key = 'node_secret'").get() as { value: string } | undefined;
  if (!existingSecret || !existingSecret.value) {
    const secret = crypto.randomBytes(32).toString('hex');
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('node_secret', ?)").run(secret);
  }

  // Migration: Check if headers column exists in services table, otherwise alter table
  const tableInfo = db.prepare("PRAGMA table_info(services)").all() as any[];
  const hasHeaders = tableInfo.some(col => col.name === 'headers');
  if (!hasHeaders) {
    db.prepare("ALTER TABLE services ADD COLUMN headers TEXT").run();
  }

  // Migration: Check if service_id column exists in incidents table, otherwise alter table
  const incidentTableInfo = db.prepare("PRAGMA table_info(incidents)").all() as any[];
  const hasServiceId = incidentTableInfo.some(col => col.name === 'service_id');
  if (!hasServiceId) {
    db.prepare("ALTER TABLE incidents ADD COLUMN service_id INTEGER").run();
  }

  // Migration: Check if type column exists in services table, otherwise alter table
  const hasType = tableInfo.some(col => col.name === 'type');
  if (!hasType) {
    db.prepare("ALTER TABLE services ADD COLUMN type TEXT DEFAULT 'http'").run();
  }

  // Migration: Check if ssl_expiry_days column exists in services table, otherwise alter table
  const hasSslExpiry = tableInfo.some(col => col.name === 'ssl_expiry_days');
  if (!hasSslExpiry) {
    db.prepare("ALTER TABLE services ADD COLUMN ssl_expiry_days INTEGER").run();
  }

  // Migration: Check if node_results column exists in latency_checks table, otherwise alter table
  const latencyChecksTableInfo = db.prepare("PRAGMA table_info(latency_checks)").all() as any[];
  const hasNodeResults = latencyChecksTableInfo.some(col => col.name === 'node_results');
  if (!hasNodeResults) {
    db.prepare("ALTER TABLE latency_checks ADD COLUMN node_results TEXT").run();
  }
}

// Automatically initialize schema on export/load
initDatabase();
