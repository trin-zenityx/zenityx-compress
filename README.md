# ZenityX Media Compressor

แอปบีบอัดไฟล์วิดีโอและรูปภาพแบบ self-hosted สำหรับข้อจำกัดขนาดไฟล์ของ [ManyChat](https://manychat.com) อัปโหลดไฟล์เข้าไป ได้ไฟล์ที่บีบอัดแล้วกลับมา -- ไม่พึ่ง cloud ภายนอก ใช้เซิร์ฟเวอร์ของตัวเอง

**Live:** [compress.zenityx.com](https://compress.zenityx.com)

---

## ทำไมถึงสร้างโปรเจคนี้

ManyChat จำกัดขนาดไฟล์ที่อัปโหลดไว้ที่ **25 MB สำหรับวิดีโอ** และ **5 MB สำหรับรูปภาพ** ทีมแอดมินของเราต้องส่งไฟล์ให้คนเดียวบีบอัดทุกครั้ง แอปนี้ทำให้ทุกคนในทีมบีบอัดไฟล์เองได้ผ่านเบราว์เซอร์

## สร้างด้วย AI (Vibecoding)

โปรเจคทั้งหมด -- TypeScript 4,100+ บรรทัด, เทสต์ 111 ตัว, deploy ขึ้น production -- สร้างด้วย **Claude Code** (AI coding agent ของ Anthropic) ใน session เดียว

เป็น case study จริงจาก [ZenityX](https://zenityxai.com) สถาบันอบรม AI ประเทศไทย เพื่อแสดงให้เห็นว่า AI-assisted development สามารถสร้างซอฟต์แวร์ระดับ production ที่มี architecture, testing, และ security ครบถ้วน

### สิ่งที่ AI ทำ:

- ระดมสมองกับผู้ใช้ผ่าน Q&A เพื่อกำหนด requirements
- เขียนแผน implementation 6,400 บรรทัด แบ่งเป็น 9 chunks
- เขียน backend ทั้งหมดแบบ TDD (เขียนเทสต์ก่อน แล้วค่อย implement)
- สร้าง frontend ด้วย Alpine.js + Tailwind CSS
- Deploy ขึ้น VPS พร้อม Caddy, systemd, และ Let's Encrypt
- ตั้งค่า Cloudflare DNS ผ่าน CLI
- Debug ปัญหา production (Alpine.js script loading race condition, กู้คืน SSH lockout ผ่าน VNC)
- Audit ตัวเองผ่าน browser automation ทดสอบ end-to-end

## ฟีเจอร์

- **FFmpeg 2-pass encoding** (preset slow, libx264) -- คุณภาพดีที่สุดต่อขนาดไฟล์ที่กำหนด
- **ManyChat preset** กำหนด 25 MB วิดีโอ / 5 MB รูปภาพ
- **Custom preset** กำหนดขนาดเป้าหมายเอง
- **บีบอัดรูปภาพ** ผ่าน sharp (mozjpeg) ค้นหา quality + scale อัตโนมัติ
- **Progress แบบ real-time** ผ่าน Server-Sent Events (SSE)
- **ยืนยันตัวตนด้วยรหัสผ่านร่วม** ใช้ bcrypt + secure sessions
- **ลบไฟล์อัตโนมัติ** หลังผ่านไป 1 ชั่วโมง (ตั้งค่าได้)
- **Rate limiting** บน login และ upload endpoints
- **UI ภาษาไทย** พร้อมแบรนด์ ZenityX

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 22, TypeScript |
| Backend | Fastify |
| Video | FFmpeg (libx264, 2-pass) |
| Images | sharp (libvips, mozjpeg) |
| Frontend | Alpine.js, Tailwind CSS (ไม่มี build step) |
| Auth | bcrypt, @fastify/secure-session |
| Validation | Zod |
| Testing | Vitest (111 tests, 25 test files) |
| Reverse Proxy | Caddy (auto HTTPS) |
| Process | systemd |

## เริ่มต้นใช้งาน

### สิ่งที่ต้องมี

- Node.js >= 22
- FFmpeg ที่รองรับ libx264
- (ไม่บังคับ) Caddy สำหรับ HTTPS reverse proxy

### ติดตั้ง

```bash
git clone https://github.com/trin-zenityx/zenityx-compress.git
cd zenityx-compress
npm install

# สร้าง password hash
npm run hash-password
# ใส่รหัสผ่านที่ต้องการ แล้วคัดลอกผลลัพธ์

# ตั้งค่า
cp .env.example .env
# แก้ไข .env: วาง AUTH_PASSWORD_HASH และสร้าง SESSION_SECRET
# SESSION_SECRET: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# สร้างโฟลเดอร์เก็บไฟล์
mkdir -p /var/compress/uploads /var/compress/outputs

# Build และรัน
npm run build
npm start
```

เปิด `http://localhost:4100` แล้วล็อกอินด้วยรหัสผ่านที่ตั้งไว้

### สำหรับนักพัฒนา

```bash
npm run dev          # รันแบบ hot reload
npm test             # รันเทสต์ทั้งหมด 111 ตัว
npm run test:watch   # Watch mode
npm run lint         # ตรวจสอบด้วย ESLint
npm run typecheck    # ตรวจสอบ TypeScript
```

## การ Deploy

ดู [`deploy/README.md`](deploy/README.md) สำหรับคู่มือ deploy ขึ้น production ครอบคลุม:

- ตั้งค่า VPS (Ubuntu/Debian)
- systemd service พร้อม security hardening
- Caddy reverse proxy พร้อม Let's Encrypt อัตโนมัติ
- ตั้งค่า Cloudflare DNS
- Firewall (UFW)

## โครงสร้างโปรเจค

```
src/
  auth/           จัดการ session, login route, middleware
  jobs/           Worker บีบอัดวิดีโอและรูปภาพ
  presets/        ManyChat และ Custom preset
  routes/         Upload, download, progress (SSE), jobs list
  storage/        จัดการไฟล์พร้อมลบอัตโนมัติตาม TTL
  utils/          Logger (pino), FFmpeg probe
  config.ts       ตรวจสอบ environment config ด้วย Zod
  server.ts       Fastify app factory

public/
  index.html      Single-page app shell
  app.js          Alpine.js component (ไม่มี build step)
  styles.css      Tailwind utilities + custom styles
```

## ตั้งค่าผ่าน Environment Variables

ดูรายละเอียดทั้งหมดใน [`.env.example`](.env.example):

| Variable | Default | คำอธิบาย |
|---|---|---|
| `AUTH_PASSWORD_HASH` | (จำเป็น) | bcrypt hash จาก `npm run hash-password` |
| `SESSION_SECRET` | (จำเป็น) | hex string 64 ตัวอักษรสำหรับเข้ารหัส cookie |
| `UPLOAD_DIR` | `/var/compress/uploads` | โฟลเดอร์เก็บไฟล์ที่อัปโหลด |
| `OUTPUT_DIR` | `/var/compress/outputs` | โฟลเดอร์เก็บไฟล์ที่บีบอัดแล้ว |
| `RETENTION_HOURS` | `1` | ลบไฟล์อัตโนมัติหลังผ่านไป N ชั่วโมง |
| `MAX_UPLOAD_MB` | `500` | ขนาดไฟล์อัปโหลดสูงสุด |
| `WORKER_CONCURRENCY` | `2` | จำนวน job ที่รันพร้อมกัน |

## License

MIT

---

สร้างโดย [ZenityX](https://zenityxai.com) -- สถาบันอบรม AI ประเทศไทย

---

# ZenityX Media Compressor (English)

Self-hosted media compression web app built for [ManyChat](https://manychat.com) file size limits. Upload videos and images, get optimized files back -- no cloud dependency, your server, your data.

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
git clone https://github.com/trin-zenityx/zenityx-compress.git
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
