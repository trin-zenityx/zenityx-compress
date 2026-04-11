/* global Alpine */
// Register the compressApp component via Alpine's official "alpine:init" hook so
// it is always available before Alpine evaluates any x-data expression. Using
// a global `function compressApp(){}` pattern races with defer script ordering
// when Alpine auto-initialises early (observed in Chrome 2026-04).
document.addEventListener("alpine:init", () => {
  window.Alpine.data("compressApp", () => ({
    authed: false,
    passwordInput: "",
    loggingIn: false,
    loginError: "",

    presets: [],
    selectedPreset: "manychat",
    customTargetMB: 24,

    jobs: [],
    sseByJob: {},
    dragging: false,
    toasts: [],
    nextToastId: 1,

    async init() {
      try {
        const res = await fetch("/api/presets", { credentials: "same-origin" });
        if (res.ok) {
          const body = await res.json();
          this.presets = body.presets;
          this.authed = true;
          await this.refreshJobs();
        }
      } catch {
      }
    },

    get todayCount() {
      return this.jobs.length;
    },

    isActive(job) {
      return ["probing", "pass1", "pass2", "encoding", "queued"].includes(job.state);
    },

    jobSubtitle(job) {
      if (job.state === "queued") return "รออยู่ในคิว";
      if (job.state === "probing") return "กำลังวิเคราะห์ไฟล์...";
      if (job.state === "pass1") return `Pass 1/2 · ${job.progress}%`;
      if (job.state === "pass2") return `Pass 2/2 · ${job.progress}%`;
      if (job.state === "encoding") return `บีบอัด · ${job.progress}%`;
      if (job.state === "done") {
        const before = fmtMB(job.inputSize);
        const after = fmtMB(job.outputSize);
        const pct = job.inputSize ? Math.round(100 - (job.outputSize * 100) / job.inputSize) : 0;
        return `${before} → ${after} · ลด ${pct}%`;
      }
      if (job.state === "error") return job.error || "เกิดข้อผิดพลาด";
      return job.state;
    },

    async login() {
      this.loggingIn = true;
      this.loginError = "";
      try {
        const res = await fetch("/api/login", {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ password: this.passwordInput }),
        });
        if (res.ok) {
          this.authed = true;
          this.passwordInput = "";
          const presetsRes = await fetch("/api/presets", { credentials: "same-origin" });
          this.presets = (await presetsRes.json()).presets;
          await this.refreshJobs();
        } else if (res.status === 429) {
          const body = await res.json().catch(() => ({}));
          this.loginError = `ลองใหม่ในอีก ${body.retryAfterSec ?? 60} วินาที`;
        } else {
          this.loginError = "รหัสผ่านไม่ถูกต้อง";
        }
      } catch (err) {
        this.loginError = "เชื่อมต่อไม่ได้ ลองใหม่อีกครั้ง";
      } finally {
        this.loggingIn = false;
      }
    },

    async logout() {
      for (const jobId of Object.keys(this.sseByJob)) {
        this.sseByJob[jobId].close();
      }
      this.sseByJob = {};
      await fetch("/api/logout", { method: "POST", credentials: "same-origin" });
      this.authed = false;
      this.jobs = [];
    },

    openCustom() {
      this.selectedPreset = "custom";
    },

    async refreshJobs() {
      const res = await fetch("/api/jobs", { credentials: "same-origin" });
      if (!res.ok) return;
      const body = await res.json();
      this.jobs = body.jobs;
      for (const job of this.jobs) {
        if (this.isActive(job) && !this.sseByJob[job.id]) {
          this.subscribeJob(job.id);
        }
      }
    },

    handleDrop(ev) {
      this.dragging = false;
      const files = ev.dataTransfer?.files;
      if (files) this.uploadAll(files);
    },
    handlePicked(ev) {
      const files = ev.target.files;
      if (files) this.uploadAll(files);
      ev.target.value = "";
    },
    async uploadAll(files) {
      for (const file of files) {
        await this.uploadOne(file);
      }
    },
    async uploadOne(file) {
      const form = new FormData();
      form.append("file", file);
      form.append("preset", this.selectedPreset);
      if (this.selectedPreset === "custom") {
        form.append("customTargetMB", String(this.customTargetMB));
      }
      try {
        const res = await fetch("/api/upload", {
          method: "POST",
          credentials: "same-origin",
          body: form,
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: "unknown" }));
          this.toast(uploadErrorMessage(res.status, err));
          return;
        }
        const body = await res.json();
        const job = {
          id: body.jobId,
          type: body.type,
          originalName: body.originalName,
          state: "queued",
          progress: 0,
          inputSize: body.inputSize,
          createdAt: Date.now(),
        };
        this.jobs = [job, ...this.jobs];
        this.subscribeJob(body.jobId);
      } catch (err) {
        this.toast("อัปโหลดไม่สำเร็จ — ลองใหม่");
      }
    },

    subscribeJob(jobId) {
      if (this.sseByJob[jobId]) return;
      const es = new EventSource(`/api/progress/${jobId}`);
      this.sseByJob[jobId] = es;
      const apply = (ev) => {
        try {
          const payload = JSON.parse(ev.data);
          this.updateJob(jobId, payload);
        } catch {}
      };
      const finish = () => {
        es.close();
        delete this.sseByJob[jobId];
      };
      es.addEventListener("progress", apply);
      es.addEventListener("done", (ev) => { apply(ev); finish(); });
      es.addEventListener("failed", (ev) => { apply(ev); finish(); });
      es.onerror = () => {
        if (es.readyState === EventSource.CLOSED) {
          delete this.sseByJob[jobId];
        }
      };
    },

    updateJob(jobId, patch) {
      const idx = this.jobs.findIndex((j) => j.id === jobId);
      if (idx === -1) return;
      this.jobs[idx] = { ...this.jobs[idx], ...patch };
    },

    async cancelJob(job) {
      if (this.sseByJob[job.id]) {
        this.sseByJob[job.id].close();
        delete this.sseByJob[job.id];
      }
      await fetch(`/api/jobs/${job.id}`, { method: "DELETE", credentials: "same-origin" });
      this.jobs = this.jobs.filter((j) => j.id !== job.id);
    },

    toast(message) {
      const id = this.nextToastId++;
      this.toasts.push({ id, message });
      setTimeout(() => {
        this.toasts = this.toasts.filter((t) => t.id !== id);
      }, 5000);
    },
  }));
});

function fmtMB(bytes) {
  if (bytes == null) return "?";
  return (bytes / 1024 / 1024).toFixed(2) + " MB";
}

function uploadErrorMessage(status, body) {
  if (status === 413) return "ไฟล์ใหญ่เกิน 500MB";
  if (status === 415) return "ไม่รองรับไฟล์ประเภทนี้";
  if (status === 422) return body.message ?? "วีดีโอยาวเกินไปสำหรับ target ที่ตั้งไว้";
  if (status === 503) return `ระบบยุ่งอยู่ — มีงาน ${body.queueDepth ?? "?"} ในคิว`;
  if (status === 401) return "เซสชั่นหมดอายุ กรุณาเข้าสู่ระบบใหม่";
  return body?.error ?? "อัปโหลดไม่สำเร็จ";
}
