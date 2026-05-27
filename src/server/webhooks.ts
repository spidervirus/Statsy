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

export async function sendWebhookAlert(
  serviceName: string,
  serviceUrl: string,
  isRecovery: boolean,
  details: string
) {
  const settings = getSettingsMap();
  const webhookUrl = settings.webhook_url;
  const webhookType = settings.webhook_type || 'discord';

  if (!webhookUrl) {
    console.log('[Webhook] Webhook URL not configured. Skipping webhook alert.');
    return;
  }

  let payload: any = {};

  if (webhookType === 'discord') {
    // Discord Embed Format
    const embedColor = isRecovery ? 3066993 : 15158332; // Green or Red
    const embedTitle = isRecovery ? '🟢 Service Recovered' : '🔴 Service Outage Detected';
    
    payload = {
      embeds: [
        {
          title: embedTitle,
          description: `Uptime status change detected for **${serviceName}**.`,
          color: embedColor,
          fields: [
            {
              name: 'Service Name',
              value: serviceName,
              inline: true,
            },
            {
              name: 'Endpoint URL',
              value: serviceUrl,
              inline: true,
            },
            {
              name: 'Status Details',
              value: `\`${details}\``,
              inline: false,
            },
            {
              name: 'Timestamp (UTC)',
              value: new Date().toISOString(),
              inline: false,
            },
          ],
          footer: {
            text: 'Statsy Monitor Alerts',
          },
        },
      ],
    };
  } else if (webhookType === 'slack') {
    // Slack Blocks Format
    const marker = isRecovery ? '🟢' : '🔴';
    const statusText = isRecovery ? '*Recovered*' : '*Outage*';

    payload = {
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `${marker} *Service Alert: ${serviceName} is ${statusText}*`,
          },
        },
        {
          type: 'section',
          fields: [
            {
              type: 'mrkdwn',
              text: `*Service:*\n${serviceName}`,
            },
            {
              type: 'mrkdwn',
              text: `*URL:*\n<${serviceUrl}|Link>`,
            },
            {
              type: 'mrkdwn',
              text: `*Status:*\n${isRecovery ? 'Operational' : 'Down'}`,
            },
            {
              type: 'mrkdwn',
              text: `*Details:*\n\`${details}\``,
            },
          ],
        },
        {
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: `Statsy Alert • ${new Date().toISOString()}`,
            },
          ],
        },
      ],
    };
  } else {
    // Generic Webhook Payload
    payload = {
      event: isRecovery ? 'service.recovered' : 'service.down',
      service: {
        name: serviceName,
        url: serviceUrl,
        status: isRecovery ? 'operational' : 'outage',
      },
      details: details,
      timestamp: new Date().toISOString(),
    };
  }

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      console.error(`[Webhook] Webhook request failed with status: ${response.status}`);
    } else {
      console.log(`[Webhook] Dispatch successful to (${webhookType}) endpoint.`);
    }
  } catch (error: any) {
    console.error(`[Webhook] Error dispatching webhook payload:`, error.message || error);
  }
}
