# 📊 Statsy

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-Ready-blue?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-18-blue?logo=react&logoColor=61DAFB)](https://react.dev/)
[![Docker](https://img.shields.io/badge/Docker-Compatible-blue?logo=docker&logoColor=white)](https://www.docker.com/)

**Statsy** is a free, beautiful, self-hostable status page that lets developers and small teams publicly communicate the health of their services—uptime, response times, incidents, and maintenance windows—without paying $100+/month for proprietary tools like Statuspage.io or Better Stack.

Anyone should be able to deploy a gorgeous status page in minutes with a single command.

---

## ✨ Features

- **Multi-Protocol Monitoring**:
  - **HTTP/HTTPS**: Standard web checking with custom headers support.
  - **TCP Port Checks**: Monitor databases, caches, or custom ports (e.g., PostgreSQL on `5432`, Redis on `6379`).
  - **ICMP Ping**: Raw network ping checks (hostname/IP) for hardware and server infrastructure health.
- **SSL Certificate Expiry Alerts**: Automatically parses certificates for HTTPS endpoints and triggers Email/Webhook warnings if the target certificate expires in $\le 14$ days.
- **Multi-Region Probing (Nodes)**: Configure distributed parent-child probe configurations. Register multiple Statsy instances in different regions to check service reachability from multiple geographies concurrently and verify global routing issues.
- **Uptime Status Consensus**: Calculates reachability using a majority consensus threshold across configured regional nodes (Operational, Degraded, Outage).
- **Interactive 24-Hour Latency Graphs**: Gorgeous, highly responsive raw SVG line charts detailing response time latency trends over the last 24 hours.
- **GitHub-Style History Bars**: Interactive 90-day history bar for each service with hover tooltips detailing date-specific uptime percentage and average latency.
- **Incident Management**: Publish, update, and resolve incidents with chronological updates and color-coded severity tags (degraded performance 🟡, major outage 🔴).
- **Scheduled Maintenance**: Plan infrastructure windows in advance and notify users.
- **XSS-Immune HttpOnly Cookies**: Secure authentication utilizing backend `HttpOnly` and `Secure` cookie session tokens.
- **Brute-Force Rate Limiting**: Built-in IP rate limiter securing authentication routes.
- **Instant Alerts**:
  - **Email (SMTP)**: Beautiful HTML email notifications on downtime and recovery.
  - **Webhooks**: Formatted payloads for **Discord (Embed Cards)** and **Slack (Block Kit)**.
- **Lightweight & Portable**: Powered by Express + SQLite (with WAL mode), compiling into a tiny, high-performance runtime.

---

## 🚀 Quick Start (Docker Compose)

Deploy Statsy in less than 60 seconds.

Create a `docker-compose.yml` file:

```yaml
version: '3.8'

services:
  statsy:
    image: statsy/statsy:latest # Or build locally using build: .
    container_name: statsy-monitor
    restart: unless-stopped
    ports:
      - "3001:3001"
    volumes:
      - statsy-data:/app/data
    environment:
      - PORT=3001
      # Optional default settings (can also be configured in the UI settings panel)
      # - SMTP_HOST=smtp.gmail.com
      # - SMTP_PORT=587
      # - SMTP_USER=your_email@gmail.com
      # - SMTP_PASS=your_gmail_app_password
      # - SMTP_FROM=noreply@yourdomain.com
      # - ALERT_EMAIL=admin@yourdomain.com
      # - WEBHOOK_URL=https://discord.com/api/webhooks/...

volumes:
  statsy-data:
```

Start the container:
```bash
docker compose up -d
```
Visit **`http://localhost:3001`** to see your status page, or **`http://localhost:3001/admin`** to set up your master credentials!

---

## 🛠️ Local Development

### Prerequisites
- Node.js (v18+)
- npm

### Setup
1. Clone the repository and install dependencies:
   ```bash
   git clone https://github.com/yourusername/statsy.git
   cd statsy
   npm install
   ```

2. Run the development server (runs React Vite on port `5173` with proxy, Express on port `3001` concurrently):
   ```bash
   npm run dev
   ```

3. Build and run in production mode locally:
   ```bash
   npm run build
   ```
   ```bash
   npm start
   ```

---

## 🔒 Production Deployment Guidelines

For production environments, follow these configurations:

### 1. Reverse Proxy & SSL (HTTPS)
Place Statsy behind a reverse proxy to manage SSL certificates automatically.

#### Caddyfile (Recommended)
```caddy
status.yourdomain.com {
    reverse_proxy localhost:3001
}
```

#### Nginx Config
```nginx
server {
    listen 80;
    server_name status.yourdomain.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name status.yourdomain.com;

    ssl_certificate /etc/letsencrypt/live/status.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/status.yourdomain.com/privkey.pem;

    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

### 2. SQLite Database Backups
SQLite database is saved at `/app/data/statsy.db`. Create a cron job on your host server to backup the database daily:
```bash
sqlite3 /var/lib/docker/volumes/statsy_statsy-data/_data/statsy.db ".backup '/backups/statsy-$(date +%F).db'"
```

---

## 🤝 Contributing

Contributions are welcome! Please follow these steps:
1. Fork the Project.
2. Create your Feature Branch (`git checkout -b feature/AmazingFeature`).
3. Commit your Changes (`git commit -m 'Add some AmazingFeature'`).
4. Push to the Branch (`git push origin feature/AmazingFeature`).
5. Open a Pull Request.

---

## 📄 License

Distributed under the MIT License. See `LICENSE` for more information.
