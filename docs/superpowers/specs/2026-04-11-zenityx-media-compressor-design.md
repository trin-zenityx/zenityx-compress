# ZenityX Media Compressor — Design Spec

**Date:** 2026-04-11
**Status:** Approved (brainstorming phase)
**Author:** Trin (with Claude)

## 1. Purpose

Internal web tool for the ZenityX admin team to compress videos and images to size targets required by third-party platforms (primarily ManyChat: videos ≤ 25 MB, images ≤ 5 MB) without sending source files to a central person. Admins use the tool from Mac, Windows, or mobile browsers; the tool runs on the existing ZenityX VPS and reuses the ffmpeg 2-pass pipeline already validated manually.

## 2. Goals and non-goals

### Goals

- Allow any admin with the shared password to drop a file in a browser, see live encoding progress, and download a result sized to a preset.
- Produce H.264 output whose quality-per-byte matches what the manual ffmpeg workflow produces today (2-pass, preset slow).
- Work on desktop and mobile browsers with a single responsive layout.
- Self-contained on a single VPS (4 vCPU / 8 GB RAM / 145 GB disk) with no external database or Redis.
- Automatically clean up uploaded and produced files after one hour.

### Non-goals (explicitly deferred)

- Multi-user accounts, RBAC, audit logging per person.
- Resumable / chunked upload.
- Real-time multi-admin presence ("X is also working on this file").
- Editing, trimming, cropping, filtering, watermarking.
- Client-side compression (ffmpeg.wasm) — evaluated and rejected in favor of server-side quality.
- CI/CD pipeline — manual git-pull + systemctl restart is sufficient for Phase 1.
- Alerting to Line/Slack — logs-only monitoring for now.

## 3. Users and key flows

**User:** ZenityX admin staff. Technical comfort varies. Primary device mix is mix of desktop and mobile. Shared team password — no per-person accounts.

**Primary flow (happy path):**
1. Admin opens `https://compress.zenityx.com`.
2. Admin enters shared password → gets cookie session (24 h).
3. Admin picks a preset (ManyChat is default) or enters a custom target in MB.
4. Admin drops one or more files (videos or images) into the dropzone.
5. Each file becomes a card in a "Today" timeline. Cards show state (queued / encoding / done / error) and live progress.
6. When a card reaches "done", admin clicks Download. Output filename is `<original>.ready-for-<preset>.<ext>` — e.g. `02จารย์.ready-for-manychat.mp4`.
7. One hour after completion the file is auto-deleted from the server.

**Refresh / reconnect flow:** If the admin refreshes or loses network during encoding, the backend keeps running. On page load the frontend calls `GET /api/jobs` to rebuild the timeline and reconnects SSE streams by job id.

## 4. Decisions (brainstorming outputs)

Every row here is a decision fixed during brainstorming. The implementation plan must not re-open these without explicit user direction.

| Area | Decision | Rationale |
|---|---|---|
| Architecture | Server-side on the existing VPS `194.233.69.204` | VPS is idle, CPU is 2x slower than local Mac but acceptable; ffmpeg 2-pass quality beats client-side wasm. |
| Hostname | `compress.zenityx.com` (A record → VPS IP) | Uses existing domain. |
| TLS | Let's Encrypt via Caddy (automatic) | Zero-config HTTPS. |
| Auth | Single shared password, bcrypt cost 12, signed cookie session | Small team, lowest-friction. |
| Rate limit on login | 10 attempts / 15 min / IP | Prevents brute force without locking out typo-prone admins. |
| Queue | BullMQ in-process (no Redis) | Single worker, small team; Redis would be premature complexity. |
| Encoding | ffmpeg 2-pass, libx264 `preset slow`, CABAC, `+faststart` | Matches validated manual workflow. |
| Video safety margin | Target = 93% of preset ceiling | 2-pass lands ±3% of target; 7% margin keeps files under the wire. |
| Audio | AAC 128 kbps stereo, first audio track only | Sufficient for marketing content. |
| Image encoding | `sharp` (`mozjpeg: true`) with q=95 start, step −5 until file ≤ limit or q=50 | Gives near-lossless output when size allows, graceful degradation when not. |
| PNG alpha | Flatten on white background automatically (no dialog) | JPEG target has no alpha; white is the safest default. |
| Image fallback when q=50 still oversize | Auto-downscale 15% then retry quality loop | Prevents hard failure on giant PNGs. |
| Presets (v1) | `manychat` (video 25 MB, image 5 MB, default) + `custom` (admin enters MB) | Other presets (Line, Facebook) can be added later as config. |
| UX | Synchronous — admin keeps page open, watches progress bar | No email/notification layer to build. |
| UI layout | Stacked timeline (dropzone on top, cards below, most recent first) | Works well on mobile and desktop; shows history until cleanup. |
| Output filename pattern | `<original>.ready-for-<preset>.<ext>` | Positive, explicit, professional. |
| Icons | Inline SVG (Lucide style), no emoji | Looks professional, renders identically across platforms. |
| Retention | 1 hour after completion | Balance convenience vs disk pressure. |
| Tech stack | Node 22 + TypeScript + Fastify + BullMQ + sharp + fluent-ffmpeg + Alpine.js + Tailwind CDN | Node is already on the VPS; Fastify and Alpine keep the stack small. |
| Concurrency | 2 simultaneous jobs, `MemoryMax=4G` under systemd | Leaves 4 GB + 2 cores for OS and the existing OpenClaw gateway. |
| Worker timeout | 15 min per job | Upper bound for the largest realistic input. |
| Retry button | Not offered | Admin re-uploads if needed; simplifies retention. |

## 5. Architecture

```
                     HTTPS
  +----------+  +--------------+     +---------------------+
  |  Admin   |--|   Caddy      |-----|  Node.js (Fastify)  |
  | Browser  |  | (reverse     | 80  |  port 4100 (loop)   |
  |          |  |  proxy +     | 443 |                     |
  | Mac / Win|  |  Let's       |     |  - Session auth     |
  |  / Phone |  |  Encrypt)    |     |  - Upload (multer)  |
  +----------+  +--------------+     |  - Job queue        |
                                     |  - SSE progress     |
                                     |  - Download stream  |
                                     +----------+----------+
                                                |
                                     +----------v----------+
                                     |  BullMQ worker      |
                                     |  (in-process)       |
                                     |                     |
                                     |  fluent-ffmpeg (2p) |
                                     |  sharp (image)      |
                                     +----------+----------+
                                                |
                                     +----------v----------+
                                     |  /var/compress/     |
                                     |   uploads/          |
                                     |   outputs/          |
                                     |  (node-cron cleanup)|
                                     +---------------------+
```

### Why these choices (summary)

- **Caddy** owns TLS and certificate renewal; the Node app never touches certificates.
- **Fastify + BullMQ in-process** lets a single Node process serve HTTP, own the queue, and run the worker — simplest topology with no Redis and no IPC.
- **SSE** is one-way (server → browser), so there is no reason to pay the complexity of WebSockets.
- **Cookie session** avoids a database: the signed cookie itself is the state.

## 6. Directory layout

### Source tree

```
zenityx-compress/
├── package.json
├── tsconfig.json
├── .env.example
├── .gitignore
├── src/
│   ├── server.ts                # Fastify bootstrap, plugins, routes, error handler
│   ├── config.ts                # env validation via zod
│   ├── auth/
│   │   ├── session.ts           # @fastify/secure-session setup
│   │   └── login-route.ts       # POST /api/login, POST /api/logout
│   ├── jobs/
│   │   ├── queue.ts             # BullMQ in-memory instance, event emitter
│   │   ├── worker.ts            # pulls jobs, dispatches to handler
│   │   ├── video-job.ts         # 2-pass ffmpeg pipeline, progress reporting
│   │   ├── image-job.ts         # sharp quality loop, PNG-alpha flattening
│   │   └── types.ts             # Job, Preset, Progress types
│   ├── routes/
│   │   ├── upload.ts            # POST /api/upload (multipart)
│   │   ├── progress.ts          # GET /api/progress/:jobId (SSE)
│   │   ├── download.ts          # GET /api/download/:jobId
│   │   ├── jobs.ts              # GET /api/jobs, DELETE /api/jobs/:id
│   │   ├── presets.ts           # GET /api/presets
│   │   └── health.ts            # GET /api/health
│   ├── presets/
│   │   └── index.ts             # ManyChat preset, custom schema (zod)
│   ├── storage/
│   │   ├── paths.ts             # uploads/outputs dir helpers, nanoid filenames
│   │   └── cleanup.ts           # node-cron scans, TTL deletes
│   └── utils/
│       ├── bitrate.ts           # video bitrate from target MB + duration
│       ├── probe.ts             # ffprobe wrapper
│       └── logger.ts            # pino setup
├── public/
│   ├── index.html               # login + main app (Alpine.js)
│   ├── app.js                   # dropzone, SSE, timeline, UI state
│   ├── styles.css               # minimal, mostly Tailwind CDN
│   └── assets/
│       ├── logo.png             # from /Users/trin/Logo/zenityX Logo2.png
│       └── favicon.png          # rounded app icon
└── systemd/
    └── compress.service         # systemd unit for deploy
```

### Runtime data (outside source tree)

```
/var/compress/uploads/<jobId>/<originalName>          # temp, deleted after encode
/var/compress/uploads/<jobId>/pass.log                # ffmpeg 2-pass log
/var/compress/uploads/<jobId>/pass.log.mbtree         # ffmpeg 2-pass mbtree
/var/compress/outputs/<jobId>/<originalName>.ready-for-<preset>.<ext>
/var/log/compress/app.log                             # pino JSON, rotated daily
```

The ffmpeg 2-pass log files (`pass.log`, `pass.log.mbtree`) are written into the same `uploads/<jobId>/` directory as the input file. When the job finishes (`done` or `error`), `video-job.ts` removes the entire `uploads/<jobId>/` directory, which cleans up the input and both pass-log files in one `rm -rf`. The orphan sweep in `storage/cleanup.ts` handles any `uploads/<jobId>/` directory whose mtime is older than 30 minutes as a safety net.

## 7. Component responsibilities

| Component | Responsibility | Depends on |
|---|---|---|
| `src/server.ts` | Fastify bootstrap, plugin registration, global error handler | config, auth, routes |
| `src/config.ts` | Parse and validate env, export typed config | zod |
| `src/auth/session.ts` | Register secure-session plugin, HttpOnly + Secure + SameSite cookie | @fastify/secure-session |
| `src/auth/login-route.ts` | Verify shared password, set or clear cookie, apply login rate limit | session, rate-limit plugin |
| `src/jobs/queue.ts` | Create BullMQ queue, expose enqueue + subscribe helpers | bullmq |
| `src/jobs/worker.ts` | Pull jobs, call video-job or image-job, translate progress into SSE events | queue |
| `src/jobs/video-job.ts` | 2-pass ffmpeg, bitrate calc, stream ffmpeg progress, cleanup pass logs | fluent-ffmpeg, probe, bitrate |
| `src/jobs/image-job.ts` | Sharp JPEG loop with alpha flatten and downscale fallback | sharp |
| `src/routes/upload.ts` | Multer multipart parse, magic-byte validation, probe, enqueue | queue, probe, paths |
| `src/routes/progress.ts` | SSE stream with 15 s heartbeat, reconnect-safe | queue |
| `src/routes/download.ts` | Stream output, set `Content-Disposition` with RFC 5987 encoding | paths |
| `src/routes/jobs.ts` | List and cancel jobs scoped to current session | queue |
| `src/presets/index.ts` | ManyChat preset literal + custom preset zod schema | zod |
| `src/storage/cleanup.ts` | node-cron: 10-min TTL sweep for uploads and outputs | paths |

### TypeScript interfaces

```typescript
type MediaType = "video" | "image";

interface Preset {
  id: string;              // "manychat" | "custom"
  name: string;            // "ManyChat"
  videoMaxMB: number;      // 25
  imageMaxMB: number;      // 5
}

interface Job {
  id: string;              // nanoid(10)
  sessionId: string;       // isolates jobs per browser session (see note below)
  type: MediaType;
  originalName: string;
  inputPath: string;
  outputPath: string;
  preset: Preset;
  customTargetMB?: number;
  createdAt: number;
  // State machine:
  //   video: queued → probing → pass1 → pass2 → done | error
  //   image: queued → probing → encoding → done | error
  // "encoding" is image-only; video jobs go through pass1 then pass2 instead.
  state: "queued" | "probing" | "pass1" | "pass2" | "encoding" | "done" | "error";
  progress: number;        // 0–100
  error?: string;
  inputSize?: number;
  outputSize?: number;
}
```

**Note on `sessionId`:** each browser session (login on a given device) gets its own `sessionId` derived from the signed cookie. Two admins on different devices sharing the same password still get two different `sessionId`s, so `GET /api/jobs` correctly shows each device its own jobs rather than merging them. This is the intended behavior.

```typescript

interface ProgressEvent {
  jobId: string;
  state: Job["state"];
  progress: number;
  etaSeconds?: number;
  message?: string;
}
```

### Bitrate calculation

```typescript
export function calcVideoBitrate(
  durationSec: number,
  targetMB: number,
  audioKbps: number = 128
): number {
  const targetBits = targetMB * 1024 * 1024 * 8;
  const safetyMargin = 0.93;
  const totalKbps = Math.floor(targetBits * safetyMargin / durationSec / 1000);
  const videoKbps = totalKbps - audioKbps;
  if (videoKbps < 500) {
    throw new Error("วีดีโอยาวเกินไปสำหรับ target นี้");
  }
  return videoKbps;
}
```

### Image encoding loop

```typescript
async function compressImage(inputPath: string, outputPath: string, maxBytes: number) {
  // Read metadata once to learn original dimensions.
  // Note: sharp pipelines are single-use, so each attempt re-opens the input.
  // libvips caches the decoded source, so re-opening is cheap after the first read.
  const { width, height } = await sharp(inputPath).metadata();
  let scale = 1.0;

  while (scale >= 0.25) {          // don't shrink below 25% of original
    let quality = 95;
    const targetW = Math.round(width! * scale);
    const targetH = Math.round(height! * scale);

    while (quality >= 50) {
      await sharp(inputPath)
        .flatten({ background: { r: 255, g: 255, b: 255 } })  // PNG alpha → white
        .resize(targetW, targetH, { fit: "inside", withoutEnlargement: true })
        .jpeg({ quality, mozjpeg: true })
        .toFile(outputPath);
      const { size } = await fs.stat(outputPath);
      if (size <= maxBytes) return { quality, size, scale };
      quality -= 5;
    }

    // Quality loop exhausted at this scale → downscale 15% and retry
    scale -= 0.15;
  }

  throw new Error("ไม่สามารถลดขนาดให้เข้าเป้าได้แม้หลังจาก downscale");
}
```

## 8. HTTP API

| Method | Path | Purpose | Auth |
|---|---|---|---|
| `GET` | `/` | Serves SPA (login or app based on cookie) | optional |
| `POST` | `/api/login` | Verify shared password → set cookie | public |
| `POST` | `/api/logout` | Clear cookie | required |
| `GET` | `/api/presets` | List presets | required |
| `POST` | `/api/upload` | Multipart upload + enqueue | required |
| `GET` | `/api/progress/:jobId` | SSE stream | required |
| `GET` | `/api/jobs` | List jobs for current session | required |
| `GET` | `/api/download/:jobId` | Stream output file | required |
| `DELETE` | `/api/jobs/:jobId` | Cancel or remove | required |
| `GET` | `/api/health` | Health probe | public |

### POST /api/login
- Request: `{ "password": "..." }`
- 200 → `{ "ok": true }` + `Set-Cookie: session=...`
- 401 → `{ "error": "invalid_password" }`
- 429 → `{ "error": "rate_limited", "retryAfterSec": N }`

### POST /api/upload
- `multipart/form-data`: `file`, `preset`, `customTargetMB?`
- The server detects media type from the uploaded file's magic bytes and MIME; the client does not send a `type` field. The returned `type` in the response is authoritative.
- 200 → `{ jobId, type, originalName, inputSize, probe: { duration, width, height, fps }, targetVideoBitrateKbps, estimatedDurationSeconds }`
- 413 file > 500 MB · 415 unsupported type · 422 bitrate < 500 kbps · 503 queue full (body `{ error: "queue_full", queueDepth, queueMax }`)

### GET /api/progress/:jobId (SSE)
Headers: `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`. Emits `progress`, `done`, and `error` named events, plus a `: ping` heartbeat every 15 s.

### GET /api/jobs
Returns all jobs belonging to the current session that are still alive (not expired by retention).

### GET /api/download/:jobId
Streams the output, with `Content-Disposition: attachment; filename*=UTF-8''<encoded>` per RFC 5987 to preserve Thai characters. 404 if expired, 403 if job belongs to another session.

### DELETE /api/jobs/:jobId
Behavior depends on state:
- **Queued job** (`queued`): removed from the BullMQ queue before any child process starts; the `uploads/<jobId>/` directory is unlinked. No SSE event (the job never started processing).
- **In-flight job** (`probing | pass1 | pass2 | encoding`): the worker sends `SIGTERM` to the ffmpeg / sharp child process, marks the job `state=error, error=cancelled_by_user`, pushes a final SSE `error` event, and cleans up the partial output and pass-log files.
- **Completed job** (`done`): unlinks the output file immediately rather than waiting for the retention sweep.
- **Already errored job** (`error`): unlinks any lingering files and removes the job record.

Returns `200 { ok: true }` on success, `404` if job does not exist, `403` if the job belongs to another session.

### Health
`GET /api/health` → `{ ok: true, version, uptime, queueDepth }`.

## 9. Error handling

### Taxonomy

**Client errors (4xx)** — validated before or during request handling:

| Code | HTTP | Thai message shown to admin |
|---|---|---|
| `AUTH_REQUIRED` | 401 | กรุณาเข้าสู่ระบบก่อน |
| `AUTH_INVALID` | 401 | รหัสผ่านไม่ถูกต้อง |
| `AUTH_RATE_LIMITED` | 429 | พยายามเข้าสู่ระบบบ่อยเกินไป กรุณารอ X นาที |
| `FILE_TOO_LARGE` | 413 | ไฟล์ใหญ่เกิน 500 MB กรุณาลดขนาดก่อนอัปโหลด |
| `FILE_UNSUPPORTED` | 415 | ไม่รองรับไฟล์ประเภทนี้ (รองรับเฉพาะ mp4/mov/mkv/webm/jpg/png/webp/heic) |
| `FILE_EMPTY` | 400 | ไฟล์ว่างเปล่า |
| `PRESET_INVALID` | 400 | ต้องเลือก preset |
| `CUSTOM_TARGET_INVALID` | 400 | Custom target ต้องอยู่ระหว่าง 1–500 MB |
| `VIDEO_TOO_LONG_FOR_TARGET` | 422 | วีดีโอนี้ยาวเกินไปสำหรับเป้าหมาย X MB (ต้องการอย่างน้อย Y MB) |
| `JOB_NOT_FOUND` | 404 | งานไม่พบหรือหมดอายุแล้ว |
| `JOB_FORBIDDEN` | 403 | ไม่มีสิทธิ์เข้าถึงงานนี้ |

**Processing errors (async, surfaced via SSE `error` event):**

| Code | Thai message |
|---|---|
| `PROBE_FAILED` | ไฟล์เสียหายหรือ codec ไม่รองรับ |
| `FFMPEG_PASS1_FAILED` | การเข้ารหัสรอบที่ 1 ล้มเหลว: `{reason}` |
| `FFMPEG_PASS2_FAILED` | การเข้ารหัสรอบที่ 2 ล้มเหลว: `{reason}` |
| `OUTPUT_OVERSIZED` | Warning: บีบได้ `{X}` MB (เกิน target `{Y}` MB เล็กน้อย) — download ยังใช้ได้ |
| `SHARP_FAILED` | โหลดไฟล์ภาพไม่ได้: `{reason}` |
| `IMAGE_TOO_LARGE_AT_Q50` | ลด quality แล้วยังเกินเป้า — auto-downscale แล้วลองอีกครั้ง |
| `WORKER_TIMEOUT` | การเข้ารหัสใช้เวลานานเกินไป (>15 นาที) |

> **On `OUTPUT_OVERSIZED`:** the 93% safety margin in section 4 is chosen so this warning should almost never fire. It exists as a belt-and-suspenders code path for pathological edge cases — very short clips where audio dominates, or content where x264 hits rate-control ceiling — rather than as part of the normal flow. If this warning appears regularly, the safety margin needs to be tightened further.

**System errors (5xx):**

| Code | Action |
|---|---|
| `DISK_FULL` | Emergency cleanup: delete 10 oldest outputs, retry once, then 507 |
| `QUEUE_OVERFLOW` | 503 when queue depth > `QUEUE_MAX` (default 20) |
| `UNEXPECTED` | 500, log full stack trace with request id |

**Network / client-side:**

- **Upload abort:** Fastify `request.close` → delete partial upload.
- **SSE disconnect:** Browser `EventSource` auto-reconnects using the same job id.
- **SSE proxy timeout:** Prevented by 15-s heartbeat.
- **Page refresh during encode:** Job keeps running; frontend rebuilds state from `GET /api/jobs`.
- **Multi-tab:** Same session cookie → same job list in both tabs.

### Edge cases to handle explicitly

- Portrait video (TikTok, Reel) — use ffprobe `naturalSize` directly.
- Multi-audio track — take first audio track only.
- HEVC / H.265 input — decode via libavcodec, output as H.264.
- 4K input — auto-downscale to 1080p when `w*h > 2073600`.
- Thai / special characters in filename — internal filenames use nanoid; original name survives only in metadata and `Content-Disposition`.
- Image with alpha (PNG) — flatten on white before JPEG.
- HEIC from iPhone camera — sharp with libvips heif support on Ubuntu 24.04.
- Duplicate upload — no dedupe; new job id per upload.

### Logging

Pino JSON lines at `/var/log/compress/app.log`, one structured record per log point with `reqId`, `sessionId`, `jobId`, `code`, `msg`, and timings. Logrotate daily, keep 14 days, SIGHUP app on rotate.

## 10. Deployment and operations

### Caddyfile

```caddy
compress.zenityx.com {
    reverse_proxy 127.0.0.1:4100 {
        flush_interval -1
        transport http {
            read_timeout 30m
            write_timeout 30m
        }
    }
    request_body { max_size 500MB }
    header {
        Strict-Transport-Security "max-age=31536000"
        X-Content-Type-Options "nosniff"
        X-Frame-Options "DENY"
        Referrer-Policy "strict-origin-when-cross-origin"
    }
    encode gzip zstd
}
```

### systemd unit

```ini
[Unit]
Description=ZenityX Media Compressor
After=network.target

[Service]
Type=simple
User=compress
Group=compress
WorkingDirectory=/opt/compress
EnvironmentFile=/opt/compress/.env
ExecStart=/usr/bin/node dist/server.js
Restart=always
RestartSec=5
StandardOutput=append:/var/log/compress/app.log
StandardError=append:/var/log/compress/app.log

NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=/var/compress /var/log/compress
MemoryMax=4G

[Install]
WantedBy=multi-user.target
```

### Environment variables

```
NODE_ENV=production
PORT=4100
HOST=127.0.0.1

AUTH_PASSWORD_HASH=<bcrypt-cost-12>
SESSION_SECRET=<64-char-random>

UPLOAD_DIR=/var/compress/uploads
OUTPUT_DIR=/var/compress/outputs
RETENTION_HOURS=1
MAX_UPLOAD_MB=500

WORKER_CONCURRENCY=2
WORKER_TIMEOUT_MS=900000
QUEUE_MAX=20

LOGIN_RATE_LIMIT=10
LOGIN_RATE_WINDOW_MS=900000
```

### Deployment workflow (manual, Phase 1)

```
git push origin main

ssh compress@194.233.69.204
cd /opt/compress
git pull
npm install --production
npm run build
sudo systemctl restart compress
sudo systemctl status compress
```

### Monitoring

- `GET /api/health` for uptime + queue depth.
- Pino logs with daily rotation (`/etc/logrotate.d/compress`).
- Disk usage warning written to log when disk > 80% full. No external alerting in Phase 1.
- `node-cron` inside the app process runs the cleanup sweeps every 10 minutes (upload orphans > 30 min, outputs > 1 h).

### Security posture

- UFW: allow 22, 80, 443 only.
- Caddy handles TLS; Let's Encrypt auto-renew.
- bcrypt password + HttpOnly / Secure / SameSite=Strict cookies + login rate limit.
- Multer validates file type by magic bytes, not just extension.
- systemd sandboxing: `NoNewPrivileges`, `ProtectSystem=strict`, `PrivateTmp`, restricted `ReadWritePaths`.
- `.env` permissions `0600` owned by the `compress` user.
- Dependencies checked with `npm audit` before each deploy.

### Backup

- No backup for user uploads or outputs — they expire in 1 hour anyway.
- Code backed up in a private GitHub repository.
- VPS-level snapshots via the hosting provider if available.

### Future scale (not in scope for Phase 1)

If future demand requires it: raise `WORKER_CONCURRENCY`, introduce Redis-backed BullMQ, split API and worker into separate processes or hosts. None of this is needed now.

## 11. Estimated implementation size

| Phase | Work | Rough time |
|---|---|---|
| 1 | VPS prep, Caddy, DNS, TLS | 1–2 h |
| 2 | Backend core: Fastify, auth, upload, download | 4–6 h |
| 3 | Worker + jobs: BullMQ, ffmpeg, sharp, progress | 4–6 h |
| 4 | Frontend: HTML + Alpine, dropzone, timeline, SSE | 3–5 h |
| 5 | Error handling, logging, cleanup crons | 2–3 h |
| 6 | Deploy, systemd, end-to-end test on mobile and desktop | 2–3 h |
| Total | | ~20 h (≈ 2–3 focused work days) |

## 12. Assets already available

- Logo: `/Users/trin/Logo/zenityX Logo2.png` and `/Users/trin/Logo/zenityX Logo1.png`.
- App icon: `/Users/trin/icon ZenityX-Final.png`.
- VPS: `194.233.69.204` (Ubuntu 24.04, Node 22, 4 vCPU / 8 GB / 145 GB), currently running OpenClaw gateway on ports 18789-18792 and a Node app on 4000.
- Domain: `zenityx.com` (subdomain `compress.zenityx.com` to be created as A record).
- Brand color: ZenityX red `#E50914`, `#C40812` for hover/gradient end.
