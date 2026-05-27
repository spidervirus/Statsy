import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';

import { db } from './db';
import { startWorker } from './worker';
import { sendEmailAlert } from './mailer';
import { sendWebhookAlert } from './webhooks';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Initialize JWT Secret in database if missing
let jwtSecret = '';
const dbSecret = db.prepare("SELECT value FROM settings WHERE key = 'jwt_secret'").get() as { value: string } | undefined;
if (dbSecret && dbSecret.value) {
  jwtSecret = dbSecret.value;
} else {
  jwtSecret = crypto.randomBytes(32).toString('hex');
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('jwt_secret', ?)").run(jwtSecret);
}

// -------------------------------------------------------------
// Simple in-memory Rate Limiter for secure routes
// -------------------------------------------------------------
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();

function rateLimiter(limit: number, timeframeMs: number) {
  return (req: Request, res: Response, next: NextFunction) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const record = rateLimitMap.get(ip);

    if (!record || now > record.resetTime) {
      rateLimitMap.set(ip, { count: 1, resetTime: now + timeframeMs });
      return next();
    }

    if (record.count >= limit) {
      return res.status(429).json({ error: 'Too many requests from this IP. Please try again later.' });
    }

    record.count++;
    next();
  };
}

// Helper to parse cookies manually from raw headers
function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const list: Record<string, string> = {};
  if (!cookieHeader) return list;
  cookieHeader.split(';').forEach((cookie) => {
    const parts = cookie.split('=');
    list[parts.shift()!.trim()] = decodeURI(parts.join('='));
  });
  return list;
}

// -------------------------------------------------------------
// Authentication Middleware
// -------------------------------------------------------------
export interface AuthRequest extends Request {
  user?: { username: string };
}

function authenticateToken(req: AuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers['authorization'];
  let token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    const cookies = parseCookies(req.headers.cookie);
    token = cookies['statsy_token'];
  }

  if (!token) {
    return res.status(401).json({ error: 'Access denied. Token missing.' });
  }

  jwt.verify(token, jwtSecret, (err: any, user: any) => {
    if (err) {
      return res.status(403).json({ error: 'Access denied. Invalid token.' });
    }
    req.user = user;
    next();
  });
}

// -------------------------------------------------------------
// 1. Auth & Initial Setup APIs
// -------------------------------------------------------------

// Check if admin password has been set up
app.get('/api/auth/status', (req, res) => {
  const adminHash = db.prepare("SELECT value FROM settings WHERE key = 'admin_password_hash'").get() as { value: string } | undefined;
  const setupRequired = !adminHash || !adminHash.value;
  res.json({ setupRequired });
});

// Check current session state using HttpOnly cookie validation
app.get('/api/auth/session', (req, res) => {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies['statsy_token'];
  if (!token) {
    return res.json({ loggedIn: false });
  }

  jwt.verify(token, jwtSecret, (err: any, user: any) => {
    if (err) {
      return res.json({ loggedIn: false });
    }
    res.json({ loggedIn: true, username: user.username });
  });
});

// Setup admin account password (only works once)
app.post('/api/auth/setup', rateLimiter(5, 60 * 1000), (req, res) => {
  const adminHash = db.prepare("SELECT value FROM settings WHERE key = 'admin_password_hash'").get() as { value: string } | undefined;
  
  if (adminHash && adminHash.value) {
    return res.status(400).json({ error: 'Setup already completed. Please use /api/auth/login instead.' });
  }

  const { password } = req.body;
  if (!password || password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters long.' });
  }

  const salt = bcrypt.genSaltSync(10);
  const hash = bcrypt.hashSync(password, salt);

  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('admin_password_hash', ?)").run(hash);
  
  // Set SMTP and alert email values from env as defaults if they exist
  if (process.env.SMTP_HOST) db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('smtp_host', ?)").run(process.env.SMTP_HOST);
  if (process.env.SMTP_PORT) db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('smtp_port', ?)").run(process.env.SMTP_PORT);
  if (process.env.SMTP_USER) db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('smtp_user', ?)").run(process.env.SMTP_USER);
  if (process.env.SMTP_PASS) db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('smtp_pass', ?)").run(process.env.SMTP_PASS);
  if (process.env.ALERT_EMAIL) db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('alert_email', ?)").run(process.env.ALERT_EMAIL);
  if (process.env.WEBHOOK_URL) db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('webhook_url', ?)").run(process.env.WEBHOOK_URL);

  const token = jwt.sign({ username: 'admin' }, jwtSecret, { expiresIn: '7d' });
  
  // Set HttpOnly, Secure cookie
  res.setHeader('Set-Cookie', `statsy_token=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${7 * 24 * 60 * 60}`);
  res.json({ success: true, token });
});

// Login using admin password
app.post('/api/auth/login', rateLimiter(5, 60 * 1000), (req, res) => {
  const { password } = req.body;
  const adminHash = db.prepare("SELECT value FROM settings WHERE key = 'admin_password_hash'").get() as { value: string } | undefined;

  if (!adminHash || !adminHash.value) {
    return res.status(400).json({ error: 'System is not set up. Please visit the setup wizard.' });
  }

  if (!password) {
    return res.status(400).json({ error: 'Password is required.' });
  }

  const validPassword = bcrypt.compareSync(password, adminHash.value);
  if (!validPassword) {
    return res.status(401).json({ error: 'Invalid password.' });
  }

  const token = jwt.sign({ username: 'admin' }, jwtSecret, { expiresIn: '7d' });
  
  // Set HttpOnly, Secure cookie
  res.setHeader('Set-Cookie', `statsy_token=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${7 * 24 * 60 * 60}`);
  res.json({ success: true, token });
});

// Logout endpoint to clear HttpOnly cookie
app.post('/api/auth/logout', (req, res) => {
  res.setHeader('Set-Cookie', 'statsy_token=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0');
  res.json({ success: true });
});

// -------------------------------------------------------------
// 2. Public Status Page APIs
// -------------------------------------------------------------

// Get status page details: services, 90-day daily aggregated checks, and active incidents
app.get('/api/public/status', (req, res) => {
  try {
    const services = db.prepare('SELECT * FROM services').all() as any[];
    const resultServices = [];

    // Date bounds for 90 days query (starting from midnight 90 days ago)
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
    ninetyDaysAgo.setHours(0, 0, 0, 0);
    const dateStr = ninetyDaysAgo.toISOString();

    for (const service of services) {
      // Get aggregated checks per day for the last 90 days
      const checks = db.prepare(`
        SELECT 
          date(checked_at) as date,
          AVG(CASE WHEN is_up = 1 THEN 1.0 ELSE 0.0 END) as uptime_pct,
          AVG(latency) as avg_latency
        FROM latency_checks
        WHERE service_id = ? AND checked_at >= ?
        GROUP BY date(checked_at)
        ORDER BY date(checked_at) ASC
      `).all(service.id, dateStr) as any[];

      // Get current stats (last check response time and node results)
      const lastCheck = db.prepare(`
        SELECT latency, checked_at, node_results 
        FROM latency_checks 
        WHERE service_id = ? 
        ORDER BY checked_at DESC 
        LIMIT 1
      `).get(service.id) as { latency: number, checked_at: string, node_results?: string | null } | undefined;

      // Get overall uptime % for last 90 days
      const overallUptime = db.prepare(`
        SELECT AVG(CASE WHEN is_up = 1 THEN 100.0 ELSE 0.0 END) as uptime_pct
        FROM latency_checks
        WHERE service_id = ? AND checked_at >= ?
      `).get(service.id, dateStr) as { uptime_pct: number | null };

      // Get latency data over the last 24 hours for line graphs
      const twentyFourHoursAgo = new Date();
      twentyFourHoursAgo.setHours(twentyFourHoursAgo.getHours() - 24);
      const tfAgoStr = twentyFourHoursAgo.toISOString();

      const rawChecks = db.prepare(`
        SELECT checked_at, latency, is_up 
        FROM latency_checks
        WHERE service_id = ? AND checked_at >= ?
        ORDER BY checked_at ASC
      `).all(service.id, tfAgoStr) as any[];

      resultServices.push({
        id: service.id,
        name: service.name,
        url: service.url,
        status: service.status,
        check_interval: service.check_interval,
        last_checked_at: service.last_checked_at,
        current_latency: lastCheck ? lastCheck.latency : null,
        overall_uptime_pct: overallUptime.uptime_pct !== null ? Number(overallUptime.uptime_pct.toFixed(2)) : 100,
        type: service.type || 'http',
        ssl_expiry_days: service.ssl_expiry_days,
        node_results: lastCheck && lastCheck.node_results ? JSON.parse(lastCheck.node_results) : null,
        twenty_four_hour_latency: rawChecks.map(c => ({
          time: c.checked_at,
          latency: c.latency,
          is_up: c.is_up === 1
        })),
        history: checks.map(c => ({
          date: c.date,
          uptime_pct: Number((c.uptime_pct * 100).toFixed(1)),
          avg_latency: Math.round(c.avg_latency)
        }))
      });
    }

    // Fetch active incidents (unresolved)
    const activeIncidents = db.prepare("SELECT * FROM incidents WHERE status != 'resolved' ORDER BY created_at DESC").all() as any[];
    for (const incident of activeIncidents) {
      incident.updates = db.prepare("SELECT * FROM incident_updates WHERE incident_id = ? ORDER BY created_at DESC").all(incident.id);
    }

    // Fetch upcoming maintenances (scheduled or in_progress)
    const activeMaintenances = db.prepare(`
      SELECT * FROM maintenances 
      WHERE status IN ('scheduled', 'in_progress') 
      ORDER BY start_at ASC
    `).all() as any[];

    res.json({
      services: resultServices,
      activeIncidents,
      activeMaintenances,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// Get comprehensive incident history
app.get('/api/public/incidents', (req, res) => {
  try {
    const incidents = db.prepare('SELECT * FROM incidents ORDER BY created_at DESC').all() as any[];
    for (const incident of incidents) {
      incident.updates = db.prepare('SELECT * FROM incident_updates WHERE incident_id = ? ORDER BY created_at DESC').all(incident.id);
    }
    res.json(incidents);
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// Get scheduled maintenance history
app.get('/api/public/maintenances', (req, res) => {
  try {
    const maintenances = db.prepare('SELECT * FROM maintenances ORDER BY start_at DESC').all();
    res.json(maintenances);
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// Dynamic SVG Status Badge Generation
function generateBadgeSvg(label: string, value: string, color: string): string {
  const labelWidth = Math.max(60, label.length * 7 + 10);
  const valueWidth = Math.max(70, value.length * 7 + 10);
  const totalWidth = labelWidth + valueWidth;
  
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="20" viewBox="0 0 ${totalWidth} 20">
    <linearGradient id="b" x2="0" y2="100%">
      <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
      <stop offset="1" stop-opacity=".1"/>
    </linearGradient>
    <mask id="a">
      <rect width="${totalWidth}" height="20" rx="3" fill="#fff"/>
    </mask>
    <g mask="url(#a)">
      <path fill="#555" d="M0 0h${labelWidth}v20H0z"/>
      <path fill="${color}" d="M${labelWidth} 0h${valueWidth}v20H${labelWidth}z"/>
      <path fill="url(#b)" d="M0 0h${totalWidth}v20H0z"/>
    </g>
    <g fill="#fff" text-anchor="middle" font-family="DejaVu Sans,Verdana,Geneva,sans-serif" font-size="11">
      <text x="${labelWidth / 2}" y="15" fill="#010101" fill-opacity=".3">${label}</text>
      <text x="${labelWidth / 2}" y="14">${label}</text>
      <text x="${labelWidth + valueWidth / 2}" y="15" fill="#010101" fill-opacity=".3">${value}</text>
      <text x="${labelWidth + valueWidth / 2}" y="14">${value}</text>
    </g>
  </svg>`;
}

app.get('/api/public/services/:id/badge', (req, res) => {
  const { id } = req.params;
  try {
    const service = db.prepare('SELECT name, status FROM services WHERE id = ?').get(id) as { name: string, status: string } | undefined;
    if (!service) {
      res.setHeader('Content-Type', 'image/svg+xml');
      res.send(generateBadgeSvg('Statsy', 'not found', '#9CA3AF'));
      return;
    }
    
    let color = '#10B981'; // green for operational
    if (service.status === 'outage') color = '#EF4444'; // red for outage
    else if (service.status === 'degraded') color = '#F59E0B'; // yellow for degraded
    
    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate'); // Ensure client fetches status fresh
    res.send(generateBadgeSvg(service.name, service.status, color));
  } catch (error) {
    res.setHeader('Content-Type', 'image/svg+xml');
    res.send(generateBadgeSvg('Statsy', 'error', '#EF4444'));
  }
});

// -------------------------------------------------------------
// 3. Admin Protected APIs
// -------------------------------------------------------------

// --- Services CRUD ---
app.get('/api/admin/services', authenticateToken, (req, res) => {
  const services = db.prepare('SELECT * FROM services ORDER BY name ASC').all();
  res.json(services);
});

app.post('/api/admin/services', authenticateToken, (req, res) => {
  const { name, url, check_interval, headers, type } = req.body;
  if (!name || !url) {
    return res.status(400).json({ error: 'Name and URL are required.' });
  }
  const interval = parseInt(check_interval, 10) || 60;
  const serviceType = type || 'http';

  let headersStr: string | null = null;
  if (headers) {
    headersStr = typeof headers === 'string' ? headers : JSON.stringify(headers);
    try {
      JSON.parse(headersStr);
    } catch (e) {
      return res.status(400).json({ error: 'Custom headers must be a valid JSON object string.' });
    }
  }

  const result = db.prepare(`
    INSERT INTO services (name, url, check_interval, status, headers, type)
    VALUES (?, ?, ?, 'operational', ?, ?)
  `).run(name, url, interval, headersStr, serviceType);

  res.status(201).json({ id: result.lastInsertRowid, name, url, check_interval: interval, status: 'operational', headers: headersStr, type: serviceType });
});

app.put('/api/admin/services/:id', authenticateToken, (req, res) => {
  const { name, url, check_interval, headers, type } = req.body;
  const { id } = req.params;

  if (!name || !url) {
    return res.status(400).json({ error: 'Name and URL are required.' });
  }
  const interval = parseInt(check_interval, 10) || 60;
  const serviceType = type || 'http';

  let headersStr: string | null = null;
  if (headers) {
    headersStr = typeof headers === 'string' ? headers : JSON.stringify(headers);
    try {
      JSON.parse(headersStr);
    } catch (e) {
      return res.status(400).json({ error: 'Custom headers must be a valid JSON object string.' });
    }
  }

  const result = db.prepare(`
    UPDATE services 
    SET name = ?, url = ?, check_interval = ?, headers = ?, type = ?
    WHERE id = ?
  `).run(name, url, interval, headersStr, serviceType, id);

  if (result.changes === 0) {
    return res.status(404).json({ error: 'Service not found.' });
  }

  res.json({ id: Number(id), name, url, check_interval: interval, headers: headersStr, type: serviceType });
});

app.delete('/api/admin/services/:id', authenticateToken, (req, res) => {
  const { id } = req.params;

  const result = db.prepare('DELETE FROM services WHERE id = ?').run(id);

  if (result.changes === 0) {
    return res.status(404).json({ error: 'Service not found.' });
  }

  res.json({ success: true, message: 'Service deleted successfully.' });
});

// --- Incidents CRUD ---
app.get('/api/admin/incidents', authenticateToken, (req, res) => {
  const incidents = db.prepare('SELECT * FROM incidents ORDER BY created_at DESC').all() as any[];
  for (const incident of incidents) {
    incident.updates = db.prepare('SELECT * FROM incident_updates WHERE incident_id = ? ORDER BY created_at DESC').all(incident.id);
  }
  res.json(incidents);
});

app.post('/api/admin/incidents', authenticateToken, (req, res) => {
  const { title, status, severity, message } = req.body;
  if (!title || !status || !severity || !message) {
    return res.status(400).json({ error: 'Title, status, severity, and message are required.' });
  }

  const now = new Date().toISOString();

  // Run in a transaction
  const insertIncident = db.transaction(() => {
    const incidentResult = db.prepare(`
      INSERT INTO incidents (title, status, severity, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(title, status, severity, now, now);

    const incidentId = incidentResult.lastInsertRowid;

    db.prepare(`
      INSERT INTO incident_updates (incident_id, status, message, created_at)
      VALUES (?, ?, ?, ?)
    `).run(incidentId, status, message, now);

    return incidentId;
  });

  const incidentId = insertIncident();
  res.status(201).json({ id: incidentId, title, status, severity, created_at: now, updated_at: now });
});

app.post('/api/admin/incidents/:id/updates', authenticateToken, (req, res) => {
  const { id } = req.params;
  const { status, message } = req.body;

  if (!status || !message) {
    return res.status(400).json({ error: 'Status and message are required.' });
  }

  const now = new Date().toISOString();

  const addUpdate = db.transaction(() => {
    // Check if incident exists
    const incident = db.prepare('SELECT id FROM incidents WHERE id = ?').get(id);
    if (!incident) return null;

    db.prepare(`
      INSERT INTO incident_updates (incident_id, status, message, created_at)
      VALUES (?, ?, ?, ?)
    `).run(id, status, message, now);

    db.prepare(`
      UPDATE incidents 
      SET status = ?, updated_at = ?
      WHERE id = ?
    `).run(status, now, id);

    return true;
  });

  const success = addUpdate();
  if (!success) {
    return res.status(404).json({ error: 'Incident not found.' });
  }

  res.status(201).json({ success: true, message: 'Incident update added.' });
});

app.delete('/api/admin/incidents/:id', authenticateToken, (req, res) => {
  const { id } = req.params;
  const result = db.prepare('DELETE FROM incidents WHERE id = ?').run(id);

  if (result.changes === 0) {
    return res.status(404).json({ error: 'Incident not found.' });
  }

  res.json({ success: true, message: 'Incident deleted.' });
});

// --- Scheduled Maintenance CRUD ---
app.get('/api/admin/maintenances', authenticateToken, (req, res) => {
  const list = db.prepare('SELECT * FROM maintenances ORDER BY start_at DESC').all();
  res.json(list);
});

app.post('/api/admin/maintenances', authenticateToken, (req, res) => {
  const { title, description, start_at, end_at, status } = req.body;
  if (!title || !description || !start_at || !end_at || !status) {
    return res.status(400).json({ error: 'All fields are required.' });
  }

  const now = new Date().toISOString();
  const result = db.prepare(`
    INSERT INTO maintenances (title, description, start_at, end_at, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(title, description, start_at, end_at, status, now);

  res.status(201).json({ id: result.lastInsertRowid, title, description, start_at, end_at, status });
});

app.put('/api/admin/maintenances/:id', authenticateToken, (req, res) => {
  const { id } = req.params;
  const { title, description, start_at, end_at, status } = req.body;

  if (!title || !description || !start_at || !end_at || !status) {
    return res.status(400).json({ error: 'All fields are required.' });
  }

  const result = db.prepare(`
    UPDATE maintenances 
    SET title = ?, description = ?, start_at = ?, end_at = ?, status = ?
    WHERE id = ?
  `).run(title, description, start_at, end_at, status, id);

  if (result.changes === 0) {
    return res.status(404).json({ error: 'Maintenance window not found.' });
  }

  res.json({ id: Number(id), title, description, start_at, end_at, status });
});

app.delete('/api/admin/maintenances/:id', authenticateToken, (req, res) => {
  const { id } = req.params;
  const result = db.prepare('DELETE FROM maintenances WHERE id = ?').run(id);

  if (result.changes === 0) {
    return res.status(404).json({ error: 'Maintenance window not found.' });
  }

  res.json({ success: true, message: 'Maintenance window deleted.' });
});

// --- Settings Operations ---
app.get('/api/admin/settings', authenticateToken, (req, res) => {
  const rows = db.prepare("SELECT key, value FROM settings WHERE key NOT IN ('admin_password_hash', 'jwt_secret')").all() as any[];
  const settings: Record<string, string> = {};
  for (const r of rows) {
    settings[r.key] = r.value || '';
  }
  res.json(settings);
});

app.put('/api/admin/settings', authenticateToken, (req, res) => {
  const config = req.body;
  const saveSetting = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
  
  const updateTransaction = db.transaction(() => {
    for (const key of Object.keys(config)) {
      // Never allow updating password or JWT secret here
      if (key === 'admin_password_hash' || key === 'jwt_secret') continue;
      saveSetting.run(key, String(config[key]));
    }
  });

  updateTransaction();
  res.json({ success: true, message: 'Settings saved successfully.' });
});

app.post('/api/admin/settings/test-notifications', authenticateToken, async (req, res) => {
  let emailSent = false;
  let emailError = '';
  let webhookSent = false;
  let webhookError = '';

  try {
    await sendEmailAlert('Statsy Test', 'https://statsy.dev', false, 'SMTP configuration check from Statsy Admin panel.');
    emailSent = true;
  } catch (error: any) {
    emailError = error.message || String(error);
  }

  try {
    await sendWebhookAlert('Statsy Test', 'https://statsy.dev', false, 'Webhook configuration check from Statsy Admin panel.');
    webhookSent = true;
  } catch (error: any) {
    webhookError = error.message || String(error);
  }

  res.json({ emailSent, emailError, webhookSent, webhookError });
});

app.put('/api/admin/settings/password', authenticateToken, (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword || newPassword.length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters.' });
  }

  const adminHash = db.prepare("SELECT value FROM settings WHERE key = 'admin_password_hash'").get() as { value: string } | undefined;
  if (!adminHash || !adminHash.value) {
    return res.status(400).json({ error: 'System password has not been initialized.' });
  }

  const validPassword = bcrypt.compareSync(currentPassword, adminHash.value);
  if (!validPassword) {
    return res.status(400).json({ error: 'Incorrect current password.' });
  }

  const salt = bcrypt.genSaltSync(10);
  const hash = bcrypt.hashSync(newPassword, salt);
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('admin_password_hash', ?)").run(hash);

  res.json({ success: true, message: 'Password changed successfully.' });
});

// -------------------------------------------------------------
// Node and Probe APIs for Multi-Region checks
// -------------------------------------------------------------

// Local endpoint executing raw local probes, authorized by node_secret
app.post('/api/node/check', async (req, res) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  const dbSecret = db.prepare("SELECT value FROM settings WHERE key = 'node_secret'").get() as { value: string } | undefined;
  const nodeSecret = dbSecret?.value;
  
  if (!nodeSecret || token !== nodeSecret) {
    return res.status(401).json({ error: 'Unauthorized node authentication' });
  }
  
  const { type, url, headers } = req.body;
  if (!type || !url) {
    return res.status(400).json({ error: 'Type and URL are required.' });
  }
  
  try {
    const { runLocalCheck } = await import('./worker');
    const checkRes = await runLocalCheck(type, url, headers);
    res.json({
      is_up: checkRes.isUp,
      latency: checkRes.latency,
      error_message: checkRes.errorMessage
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Check failed' });
  }
});

// Admin Node Management routes
app.get('/api/admin/nodes', authenticateToken, (req, res) => {
  try {
    const nodes = db.prepare("SELECT * FROM nodes ORDER BY name ASC").all();
    res.json(nodes);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/nodes', authenticateToken, (req, res) => {
  const { name, api_url, api_secret, is_active } = req.body;
  if (!name || !api_url || !api_secret) {
    return res.status(400).json({ error: 'Name, API URL, and API Secret are required.' });
  }
  const active = is_active === undefined ? 1 : (is_active ? 1 : 0);
  const now = new Date().toISOString();
  try {
    const result = db.prepare(`
      INSERT INTO nodes (name, api_url, api_secret, is_active, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(name, api_url, api_secret, active, now);
    res.status(201).json({ id: result.lastInsertRowid, name, api_url, api_secret, is_active: active });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/admin/nodes/:id', authenticateToken, (req, res) => {
  const { id } = req.params;
  const { name, api_url, api_secret, is_active } = req.body;
  if (!name || !api_url || !api_secret) {
    return res.status(400).json({ error: 'Name, API URL, and API Secret are required.' });
  }
  const active = is_active === undefined ? 1 : (is_active ? 1 : 0);
  try {
    const result = db.prepare(`
      UPDATE nodes 
      SET name = ?, api_url = ?, api_secret = ?, is_active = ?
      WHERE id = ?
    `).run(name, api_url, api_secret, active, id);
    
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Node not found' });
    }
    res.json({ id: Number(id), name, api_url, api_secret, is_active: active });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/admin/nodes/:id', authenticateToken, (req, res) => {
  const { id } = req.params;
  try {
    const result = db.prepare("DELETE FROM nodes WHERE id = ?").run(id);
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Node not found' });
    }
    res.json({ success: true, message: 'Node deleted successfully.' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});


// -------------------------------------------------------------
// 4. Static Frontend Assets Serving (Production mode)
// -------------------------------------------------------------
const CLIENT_BUILD_PATH = path.resolve(process.cwd(), 'dist/client');

if (fs.existsSync(CLIENT_BUILD_PATH)) {
  console.log(`[Server] Serving production static client assets from ${CLIENT_BUILD_PATH}`);
  app.use(express.static(CLIENT_BUILD_PATH));
  
  // Return client index.html for SPA routes (like /admin, etc.)
  app.get('*', (req, res, next) => {
    // Avoid capturing API routes
    if (req.path.startsWith('/api')) {
      return next();
    }
    res.sendFile(path.join(CLIENT_BUILD_PATH, 'index.html'));
  });
} else {
  console.log(`[Server] Client build folder NOT found at ${CLIENT_BUILD_PATH}. Running API-only server mode.`);
}


// Start database and monitoring worker
startWorker();

app.listen(PORT, () => {
  console.log(`[Server] Statsy API running on http://localhost:${PORT}`);
});
