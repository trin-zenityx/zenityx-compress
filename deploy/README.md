# Deployment artifacts

Static configuration files for the production VPS deployment.

## Files

- `Caddyfile` — copy to `/etc/caddy/Caddyfile` on the VPS
- `../systemd/compress.service` — copy to `/etc/systemd/system/compress.service`
- `logrotate.conf` — copy to `/etc/logrotate.d/compress`

## Deploy procedure

```bash
# 1. Push code to VPS (either git clone from GitHub, or bare-repo push — see plan chunk 9.4)
ssh root@194.233.69.204 'sudo -u compress git clone https://github.com/<owner>/zenityx-compress.git /opt/compress/app'
ssh root@194.233.69.204 'cd /opt/compress/app && sudo -u compress npm ci --omit=dev && sudo -u compress npm run build'

# 2. Generate bcrypt hash and session secret locally, create .env on VPS
ssh root@194.233.69.204 'sudo -u compress /opt/compress/app/node_modules/.bin/tsx /opt/compress/app/scripts/hash-password.ts'
# Copy the $2b$... hash

NODE_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
ssh root@194.233.69.204 "sudo -u compress tee /opt/compress/app/.env > /dev/null" <<ENV
NODE_ENV=production
PORT=4100
HOST=127.0.0.1
LOG_LEVEL=info
AUTH_PASSWORD_HASH=<paste-bcrypt-hash-here>
SESSION_SECRET=${NODE_SECRET}
UPLOAD_DIR=/var/compress/uploads
OUTPUT_DIR=/var/compress/outputs
RETENTION_HOURS=1
MAX_UPLOAD_MB=500
WORKER_CONCURRENCY=2
WORKER_TIMEOUT_MS=900000
QUEUE_MAX=20
LOGIN_RATE_LIMIT=10
LOGIN_RATE_WINDOW_MS=900000
ENV
ssh root@194.233.69.204 'chmod 600 /opt/compress/app/.env && chown compress:compress /opt/compress/app/.env'

# 3. Install Caddy (first time only)
ssh root@194.233.69.204 'apt install -y debian-keyring debian-archive-keyring apt-transport-https curl && curl -1sLf "https://dl.cloudsmith.io/public/caddy/stable/gpg.key" | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg && curl -1sLf "https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt" | tee /etc/apt/sources.list.d/caddy-stable.list && apt update && apt install -y caddy'

# 4. Copy config files
scp deploy/Caddyfile root@194.233.69.204:/etc/caddy/Caddyfile
scp systemd/compress.service root@194.233.69.204:/etc/systemd/system/compress.service
scp deploy/logrotate.conf root@194.233.69.204:/etc/logrotate.d/compress

# 5. Enable and start
ssh root@194.233.69.204 'systemctl daemon-reload && systemctl enable compress && systemctl start compress && systemctl reload caddy && systemctl status compress --no-pager | head -15'

# 6. Verify
curl https://compress.zenityx.com/api/health
```

## DNS

Before step 5, add this A record in the zenityx.com DNS registrar:
- Type: A
- Name: compress
- Value: 194.233.69.204
- TTL: 300

Verify: `dig +short compress.zenityx.com` should return `194.233.69.204`.
