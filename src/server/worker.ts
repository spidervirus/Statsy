import { db } from './db';
import { sendEmailAlert } from './mailer';
import { sendWebhookAlert } from './webhooks';
import net from 'net';
import https from 'https';
import { exec } from 'child_process';

interface Service {
  id: number;
  name: string;
  url: string;
  check_interval: number;
  status: string;
  last_checked_at: string | null;
  headers?: string | null;
  type?: string;
  ssl_expiry_days?: number | null;
}

// Check TCP port connectivity
function checkTcpPort(host: string, port: number, timeout = 5000): Promise<{ isUp: boolean, latency: number, errorMessage: string | null }> {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const socket = new net.Socket();
    
    socket.setTimeout(timeout);
    
    socket.on('connect', () => {
      const latency = Date.now() - startTime;
      socket.destroy();
      resolve({ isUp: true, latency, errorMessage: null });
    });
    
    socket.on('timeout', () => {
      socket.destroy();
      resolve({ isUp: false, latency: Date.now() - startTime, errorMessage: 'Connection timed out' });
    });
    
    socket.on('error', (err) => {
      socket.destroy();
      resolve({ isUp: false, latency: Date.now() - startTime, errorMessage: err.message || 'Connection refused' });
    });
    
    socket.connect(port, host);
  });
}

// Check SSL expiry days remaining
function checkSslExpiry(urlStr: string): Promise<number | null> {
  return new Promise((resolve) => {
    try {
      const url = new URL(urlStr);
      if (url.protocol !== 'https:') {
        return resolve(null);
      }
      
      const options = {
        host: url.hostname,
        port: url.port || 443,
        method: 'GET',
        rejectUnauthorized: false,
        agent: false
      };
      
      const req = https.request(options, (res) => {
        const cert = (res.socket as any).getPeerCertificate();
        if (cert && cert.valid_to) {
          const validTo = new Date(cert.valid_to).getTime();
          const daysRemaining = Math.ceil((validTo - Date.now()) / (1000 * 60 * 60 * 24));
          resolve(daysRemaining);
        } else {
          resolve(null);
        }
      });
      
      req.on('error', () => {
        resolve(null);
      });
      
      req.setTimeout(5000, () => {
        req.destroy();
        resolve(null);
      });
      
      req.end();
    } catch (e) {
      resolve(null);
    }
  });
}

function checkIcmpPing(host: string, timeout = 5000): Promise<{ isUp: boolean, latency: number, errorMessage: string | null }> {
  return new Promise((resolve) => {
    const startTime = Date.now();
    if (!/^[a-zA-Z0-9.-]+$/.test(host)) {
      return resolve({ isUp: false, latency: 0, errorMessage: 'Invalid hostname/IP format' });
    }
    const tSeconds = Math.max(1, Math.ceil(timeout / 1000));
    const isMac = process.platform === 'darwin';
    const cmd = isMac 
      ? `ping -c 1 -t ${tSeconds} ${host}`
      : `ping -c 1 -W ${tSeconds} ${host}`;
    exec(cmd, (error, stdout, stderr) => {
      const latency = Date.now() - startTime;
      if (error) {
        return resolve({ isUp: false, latency, errorMessage: stderr.trim() || stdout.trim() || error.message || 'ICMP Ping failed' });
      }
      resolve({ isUp: true, latency, errorMessage: null });
    });
  });
}

export async function runLocalCheck(
  type: string,
  url: string,
  headers?: string | null
): Promise<{
  isUp: boolean;
  statusCode: number | null;
  latency: number;
  errorMessage: string | null;
  sslExpiryDays: number | null;
}> {
  const startTime = Date.now();
  let isUp = false;
  let statusCode: number | null = null;
  let latency = 0;
  let errorMessage: string | null = null;
  let sslExpiryDays: number | null = null;

  if (type === 'tcp') {
    try {
      const parts = url.split(':');
      const host = parts[0];
      const port = parseInt(parts[1], 10) || 80;
      
      const res = await checkTcpPort(host, port);
      isUp = res.isUp;
      latency = res.latency;
      errorMessage = res.errorMessage;
      statusCode = isUp ? 200 : 0;
    } catch (error: any) {
      isUp = false;
      latency = Date.now() - startTime;
      errorMessage = error.message || 'TCP check error';
    }
  } else if (type === 'icmp') {
    try {
      let host = url;
      try {
        const u = new URL(url);
        host = u.hostname;
      } catch (e) {
        // Fallback to plain url string
      }
      const res = await checkIcmpPing(host);
      isUp = res.isUp;
      latency = res.latency;
      errorMessage = res.errorMessage;
      statusCode = isUp ? 200 : 0;
    } catch (error: any) {
      isUp = false;
      latency = Date.now() - startTime;
      errorMessage = error.message || 'ICMP check error';
    }
  } else {
    const requestHeaders: Record<string, string> = {
      'User-Agent': 'StatsyUptimeBot/1.0',
    };

    if (headers) {
      try {
        const parsed = JSON.parse(headers);
        Object.assign(requestHeaders, parsed);
      } catch (e) {
        console.error(`[Worker] Failed to parse custom headers:`, e);
      }
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      const response = await fetch(url, {
        method: 'GET',
        headers: requestHeaders,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      
      latency = Date.now() - startTime;
      statusCode = response.status;
      isUp = response.status >= 200 && response.status < 400;
      
      if (!isUp) {
        errorMessage = `HTTP Status Code ${response.status}`;
      }

      if (isUp && url.startsWith('https://')) {
        sslExpiryDays = await checkSslExpiry(url);
      }
    } catch (error: any) {
      latency = Date.now() - startTime;
      isUp = false;
      if (error.name === 'AbortError') {
        errorMessage = 'Request Timeout (10s limit exceeded)';
      } else {
        errorMessage = error.message || 'Connection failed';
      }
    }
  }

  return { isUp, statusCode, latency, errorMessage, sslExpiryDays };
}

const consecutiveFailuresMap = new Map<number, number>();
let workerInterval: NodeJS.Timeout | null = null;

// Perform a single HTTP/HTTPS or TCP check
async function checkService(service: Service) {
  const checkedAt = new Date().toISOString();
  
  const localNodeNameRow = db.prepare("SELECT value FROM settings WHERE key = 'local_node_name'").get() as { value: string } | undefined;
  const localNodeName = localNodeNameRow?.value || 'Primary';

  const localRes = await runLocalCheck(service.type || 'http', service.url, service.headers);
  const localResultObj = {
    nodeName: localNodeName,
    isUp: localRes.isUp,
    latency: localRes.latency,
    errorMessage: localRes.errorMessage
  };

  const allResults = [localResultObj];

  let activeNodes: any[] = [];
  try {
    activeNodes = db.prepare("SELECT * FROM nodes WHERE is_active = 1").all() as any[];
  } catch (err) {
    console.error("[Worker] Error fetching active nodes:", err);
  }

  if (activeNodes.length > 0) {
    const remoteChecks = activeNodes.map(async (node) => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 12000);
      try {
        const res = await fetch(`${node.api_url}/api/node/check`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${node.api_secret}`
          },
          body: JSON.stringify({
            type: service.type || 'http',
            url: service.url,
            headers: service.headers
          }),
          signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (res.ok) {
          const json = await res.json() as any;
          return {
            nodeName: node.name,
            isUp: !!json.is_up,
            latency: Number(json.latency) || 0,
            errorMessage: json.error_message || null
          };
        } else {
          return {
            nodeName: node.name,
            isUp: false,
            latency: 0,
            errorMessage: `HTTP ${res.status}`
          };
        }
      } catch (err: any) {
        clearTimeout(timeoutId);
        return {
          nodeName: node.name,
          isUp: false,
          latency: 0,
          errorMessage: err.message || 'Connection failure'
        };
      }
    });

    const remoteResults = await Promise.all(remoteChecks);
    allResults.push(...remoteResults);
  }

  const totalLocations = allResults.length;
  const upLocations = allResults.filter(r => r.isUp).length;
  
  let overallIsUp = false;
  let resolvedStatus = 'outage';

  if (upLocations === totalLocations) {
    overallIsUp = true;
    resolvedStatus = 'operational';
  } else if (upLocations >= totalLocations / 2) {
    overallIsUp = true;
    resolvedStatus = 'degraded';
  } else {
    overallIsUp = false;
    resolvedStatus = 'outage';
  }

  const statusCode = localRes.statusCode;
  const latency = localRes.latency;
  const errorMessage = localRes.errorMessage;
  const sslExpiryDays = localRes.sslExpiryDays;
  const nodeResultsStr = JSON.stringify(allResults);

  // 1. Record the latency check in db
  db.prepare(`
    INSERT INTO latency_checks (service_id, status_code, latency, is_up, error_message, checked_at, node_results)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(service.id, statusCode, latency, overallIsUp ? 1 : 0, errorMessage, checkedAt, nodeResultsStr);

  // 2. Determine new status using consecutive failures count
  let newStatus = service.status;
  if (resolvedStatus === 'operational') {
    consecutiveFailuresMap.set(service.id, 0);
    newStatus = 'operational';
  } else if (resolvedStatus === 'degraded') {
    consecutiveFailuresMap.set(service.id, 0);
    newStatus = 'degraded';
  } else {
    const fails = (consecutiveFailuresMap.get(service.id) || 0) + 1;
    consecutiveFailuresMap.set(service.id, fails);
    
    if (fails >= 2) {
      newStatus = 'outage';
    } else {
      console.log(`[Worker] Consensus outage strike ${fails}/2 for "${service.name}". Waiting for retry.`);
    }
  }
  
  const oldStatus = service.status;

  // Check SSL Expiry warning transition (Alert when remaining days <= 14)
  if (sslExpiryDays !== null && sslExpiryDays <= 14) {
    const oldExpiry = service.ssl_expiry_days;
    // Trigger alert if entering the warning window, or every 7 days (e.g. days 14, 7)
    if (oldExpiry === null || oldExpiry === undefined || oldExpiry > 14 || (oldExpiry > sslExpiryDays && sslExpiryDays % 7 === 0)) {
      const warnMsg = `SSL certificate for "${service.name}" (${service.url}) is expiring in ${sslExpiryDays} days!`;
      console.warn(`[Worker] SSL WARNING: ${warnMsg}`);
      
      sendEmailAlert(service.name, service.url, false, `[SSL WARNING] ${warnMsg}`)
        .catch(err => console.error('[Worker] SSL email alert failure:', err));
      
      sendWebhookAlert(service.name, service.url, false, `⚠️ **SSL Warning**: Certificate expires in ${sslExpiryDays} days!`)
        .catch(err => console.error('[Worker] SSL webhook alert failure:', err));
    }
  }

  // 3. Update last_checked_at, status, and ssl_expiry_days in services table
  db.prepare(`
    UPDATE services 
    SET last_checked_at = ?, status = ?, ssl_expiry_days = ?
    WHERE id = ?
  `).run(checkedAt, newStatus, sslExpiryDays, service.id);

  // 4. Trigger alert on status change
  if (oldStatus !== newStatus) {
    console.log(`[Worker] Status change for service "${service.name}": ${oldStatus} -> ${newStatus}`);
    
    const isRecovery = newStatus === 'operational';
    
    // Automated Incident Logging and Resolution
    try {
      const now = new Date().toISOString();
      if (!isRecovery) {
        // Service went down: create automated incident if none exists active
        const existingIncident = db.prepare("SELECT id FROM incidents WHERE service_id = ? AND status != 'resolved'").get(service.id);
        if (!existingIncident) {
          const insertIncident = db.transaction(() => {
            const title = `Outage: ${service.name}`;
            const incidentResult = db.prepare(`
              INSERT INTO incidents (title, status, severity, service_id, created_at, updated_at)
              VALUES (?, 'investigating', 'major', ?, ?, ?)
            `).run(title, service.id, now, now);
            
            const incidentId = incidentResult.lastInsertRowid;
            const msg = `Automated check failed: ${errorMessage || 'Service failed to respond'}.`;
            
            db.prepare(`
              INSERT INTO incident_updates (incident_id, status, message, created_at)
              VALUES (?, 'investigating', ?, ?)
            `).run(incidentId, msg, now);
          });
          insertIncident();
        }
      } else {
        // Service recovered: resolve active incidents linked to this service
        const activeIncidents = db.prepare("SELECT id FROM incidents WHERE service_id = ? AND status != 'resolved'").all(service.id) as { id: number }[];
        if (activeIncidents.length > 0) {
          const resolveIncidents = db.transaction(() => {
            for (const inc of activeIncidents) {
              db.prepare(`
                INSERT INTO incident_updates (incident_id, status, message, created_at)
                VALUES (?, 'resolved', 'Automated check succeeded. Service is back online.', ?)
              `).run(inc.id, now);
              
              db.prepare(`
                UPDATE incidents
                SET status = 'resolved', updated_at = ?
                WHERE id = ?
              `).run(now, inc.id);
            }
          });
          resolveIncidents();
        }
      }
    } catch (err) {
      console.error(`[Worker] Failed running automated incident logging for "${service.name}":`, err);
    }
    
    // Asynchronously dispatch notifications to avoid blocking worker loop
    sendEmailAlert(service.name, service.url, isRecovery, errorMessage || 'OK')
      .catch(err => console.error(`[Worker] Email alert failure for ${service.name}:`, err));

    sendWebhookAlert(service.name, service.url, isRecovery, errorMessage || 'OK')
      .catch(err => console.error(`[Worker] Webhook alert failure for ${service.name}:`, err));
  }
}

// Master worker loop function
export async function runMonitoringSweep() {
  try {
    const services = db.prepare('SELECT * FROM services').all() as Service[];
    const now = Date.now();

    for (const service of services) {
      let shouldCheck = false;

      if (!service.last_checked_at) {
        shouldCheck = true;
      } else {
        const lastCheckedTime = new Date(service.last_checked_at).getTime();
        const diffSeconds = (now - lastCheckedTime) / 1000;
        if (diffSeconds >= service.check_interval) {
          shouldCheck = true;
        }
      }

      if (shouldCheck) {
        // Execute check without blocking other checks (concurrently)
        checkService(service).catch(err => {
          console.error(`Error checking service ${service.name} (${service.url}):`, err);
        });
      }
    }
  } catch (error) {
    console.error('[Worker] Error running monitoring sweep:', error);
  }
}

// Daily logs cleanup (retains only 90 days of logs)
export function runDatabaseCleanup() {
  try {
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
    const dateStr = ninetyDaysAgo.toISOString();

    const result = db.prepare('DELETE FROM latency_checks WHERE checked_at < ?').run(dateStr);
    if (result.changes > 0) {
      console.log(`[Worker Cleanup] Purged ${result.changes} logs older than 90 days (${dateStr}).`);
    }
  } catch (error) {
    console.error('[Worker Cleanup] Error running logs cleanup:', error);
  }
}

// Start the background process
export function startWorker() {
  if (workerInterval) return;

  console.log('[Worker] Starting background uptime monitoring (ticks every 10s)...');
  
  // Run initial sweep immediately
  runMonitoringSweep();
  // Run cleanup sweep immediately on start
  runDatabaseCleanup();

  // Tick every 10 seconds
  workerInterval = setInterval(() => {
    runMonitoringSweep();
  }, 10000);

  // Run cleanup sweep once every 24 hours
  setInterval(() => {
    runDatabaseCleanup();
  }, 24 * 60 * 60 * 1000);
}

// Stop background process (useful for hot-reloads/testing)
export function stopWorker() {
  if (workerInterval) {
    clearInterval(workerInterval);
    workerInterval = null;
    console.log('[Worker] Stopped background uptime monitoring.');
  }
}
