# ZenityX Media Compressor

Self-hosted media compression web app built for [ManyChat](https://manychat.com) file size limits. Upload videos and images, get optimized files back -- no cloud dependency, your server, your data.

**Live:** [compress.zenityx.com](https://compress.zenityx.com)

## Why This Exists

ManyChat limits uploads to **25 MB for video** and **5 MB for images**. Our admin team was sending files to a single person for manual compression. This app lets anyone on the team compress files themselves through a simple browser interface.

## Built with AI (Vibecoding)

This entire project -- 4,100+ lines of TypeScript, 111 tests, production deployment -- was built using **Claude Code** (Anthropic's AI coding agent) in a single collaborative session.

It serves as a real-world case study from [ZenityX](https://zenityxai.com), an AI training institute in Thailand, demonstrating that AI-assisted development can produce production-grade software with proper architecture, testing, and security.

### What the AI did:

- Brainstormed product requirements through interactive Q&A
- Wrote a 6,400-line implementation plan broken into 9 chunks
- Implemented all backend code with TDD (test-first, then implementation)
- Built the frontend with Alpine.js + Tailwind CSS
- Deployed to a VPS with Caddy, systemd, and Let's Encrypt
- Configured Cloudflare DNS via CLI
- Debugged production issues (Alpine.js script loading race condition, SSH lockout recovery via VNC)
- Self-audited the live site via browser automation

## Features

- **2-pass FFmpeg encoding** (preset slow, libx264) -- best quality-per-byte for a given target size
- **ManyChat preset** with hardcoded 25 MB video / 5 MB image limits
- **Custom preset** for arbitrary target sizes
- **Image compression** via sharp (mozjpeg) with auto quality + scale search
- **Real-time progress** via Server-Sent Events (SSE)
- **Shared password auth** with bcrypt + secure sessions
- **Auto-cleanup** of files after 1 hour (configurable)
- **Rate limiting** on login and upload endpoints
- **Thai language UI** with ZenityX branding

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 22, TypeScript |
| Backend | Fastify |
| Video | FFmpeg (libx264, 2-pass) |
| Images | sharp (libvips, mozjpeg) |
| Frontend | Alpine.js, Tailwind CSS (no build step) |
| Auth | bcrypt, @fastify/secure-session |
| Validation | Zod |
| Testing | Vitest (111 tests, 25 test files) |
| Reverse Proxy | Caddy (auto HTTPS) |
| Process | systemd |

## Quick Start

### Prerequisites

- Node.js >= 22
- FFmpeg with libx264 support
- (Optional) Caddy for HTTPS reverse proxy

### Setup

```bash
git clone https://github.com/zenityx/zenityx-compress.git
cd zenityx-compress
npm install

# Generate a password hash
npm run hash-password
# Enter your desired password, copy the output

# Configure
cp .env.example .env
# Edit .env: paste AUTH_PASSWORD_HASH and generate SESSION_SECRET
# SESSION_SECRET: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Create storage directories
mkdir -p /var/compress/uploads /var/compress/outputs

# Build & run
npm run build
npm start
```

Open `http://localhost:4100` and log in with your password.

### Development

```bash
npm run dev          # Start with hot reload
npm test             # Run all 111 tests
npm run test:watch   # Watch mode
npm run lint         # ESLint check
npm run typecheck    # TypeScript check
```

## Deployment

See [`deploy/README.md`](deploy/README.md) for full production deployment guide covering:

- VPS setup (Ubuntu/Debian)
- systemd service with security hardening
- Caddy reverse proxy with automatic Let's Encrypt
- Cloudflare DNS configuration
- Firewall (UFW) rules

## Architecture

```
src/
  auth/           Session management, login route, middleware
  jobs/           Video & image compression workers
  presets/        ManyChat and Custom preset definitions
  routes/         Upload, download, progress (SSE), jobs list
  storage/        File management with TTL-based cleanup
  utils/          Logger (pino), FFmpeg probe
  config.ts       Zod-validated environment config
  server.ts       Fastify app factory

public/
  index.html      Single-page app shell
  app.js          Alpine.js component (no build step)
  styles.css      Tailwind utilities + custom styles
```

## Configuration

All settings via environment variables (see [`.env.example`](.env.example)):

| Variable | Default | Description |
|---|---|---|
| `AUTH_PASSWORD_HASH` | (required) | bcrypt hash from `npm run hash-password` |
| `SESSION_SECRET` | (required) | 64-char hex string for cookie encryption |
| `UPLOAD_DIR` | `/var/compress/uploads` | Temp upload storage |
| `OUTPUT_DIR` | `/var/compress/outputs` | Compressed file storage |
| `RETENTION_HOURS` | `1` | Auto-delete files after N hours |
| `MAX_UPLOAD_MB` | `500` | Maximum upload file size |
| `WORKER_CONCURRENCY` | `2` | Parallel compression jobs |

## License

MIT

---

Built by [ZenityX](https://zenityxai.com) -- AI training institute, Thailand.
