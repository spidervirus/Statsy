import nodemailer from 'nodemailer';
import { db } from './db';

interface Setting {
  key: string;
  value: string;
}

function getSettingsMap(): Record<string, string> {
  const rows = db.prepare('SELECT key, value FROM settings').all() as Setting[];
  const map: Record<string, string> = {};
  for (const row of rows) {
    map[row.key] = row.value || '';
  }
  return map;
}

export async function sendEmailAlert(
  serviceName: string,
  serviceUrl: string,
  isRecovery: boolean,
  details: string
) {
  const settings = getSettingsMap();
  const {
    smtp_host,
    smtp_port,
    smtp_user,
    smtp_pass,
    smtp_from,
    alert_email
  } = settings;

  // Verify that required settings exist
  if (!smtp_host || !smtp_port || !alert_email) {
    console.log('[Mailer] SMTP or recipient settings not configured. Skipping email alert.');
    return;
  }

  const transporter = nodemailer.createTransport({
    host: smtp_host,
    port: parseInt(smtp_port, 10) || 587,
    secure: parseInt(smtp_port, 10) === 465, // true for 465, false for other ports
    auth: smtp_user && smtp_pass ? {
      user: smtp_user,
      pass: smtp_pass,
    } : undefined,
  });

  const statusTitle = isRecovery ? '🟢 SERVICE RECOVERED' : '🔴 SERVICE OUTAGE DETECTED';
  const statusColor = isRecovery ? '#10B981' : '#EF4444';
  const actionText = isRecovery 
    ? `Great news! The service is now back online and operational.`
    : `Attention! Our automated health checks detected an outage. Please investigate.`;

  const htmlContent = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <title>${statusTitle}</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f3f4f6; color: #1f2937; margin: 0; padding: 20px; }
          .container { max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 8px; border: 1px solid #e5e7eb; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); }
          .header { padding: 30px; text-align: center; color: white; }
          .content { padding: 30px; line-height: 1.6; }
          .detail-box { background: #f9fafb; border: 1px solid #f3f4f6; padding: 15px; border-radius: 6px; margin: 20px 0; }
          .detail-row { margin: 8px 0; font-size: 14px; }
          .detail-label { font-weight: bold; color: #4b5563; display: inline-block; width: 120px; }
          .footer { background: #f9fafb; padding: 20px; text-align: center; font-size: 12px; color: #6b7280; border-top: 1px solid #e5e7eb; }
          a { color: #3b82f6; text-decoration: none; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header" style="background-color: ${statusColor};">
            <h2 style="margin: 0; font-weight: 600; letter-spacing: 0.5px;">${statusTitle}</h2>
          </div>
          <div class="content">
            <p style="font-size: 16px; margin-top: 0;">Hi there,</p>
            <p>${actionText}</p>
            
            <div class="detail-box">
              <div class="detail-row">
                <span class="detail-label">Service:</span>
                <strong>${serviceName}</strong>
              </div>
              <div class="detail-row">
                <span class="detail-label">Endpoint URL:</span>
                <a href="${serviceUrl}" target="_blank">${serviceUrl}</a>
              </div>
              <div class="detail-row">
                <span class="detail-label">Details/Error:</span>
                <code>${details}</code>
              </div>
              <div class="detail-row">
                <span class="detail-label">Time (UTC):</span>
                <span>${new Date().toISOString()}</span>
              </div>
            </div>
            
            <p style="font-size: 14px; color: #6b7280; margin-bottom: 0;">
              This alert was dispatched automatically by your Statsy self-hosted monitoring system.
            </p>
          </div>
          <div class="footer">
            <p style="margin: 0;">Powered by <a href="https://github.com/statsy/statsy" target="_blank" style="color: #4b5563; font-weight: bold;">Statsy</a></p>
          </div>
        </div>
      </body>
    </html>
  `;

  const info = await transporter.sendMail({
    from: smtp_from ? `Statsy <${smtp_from}>` : 'Statsy Alerts <noreply@statsy.dev>',
    to: alert_email,
    subject: `[Statsy] ${isRecovery ? 'Recovered' : 'Down'}: ${serviceName}`,
    html: htmlContent,
  });

  console.log(`[Mailer] Uptime alert email sent to ${alert_email}. Message ID: ${info.messageId}`);
}
