import { EventEmitter } from "node:events";
import type { Job, JobEvent } from "./types.js";
import { isTerminalState } from "./types.js";

export class QueueFullError extends Error {
  constructor(public readonly queueMax: number) {
    super(`queue is full (max ${queueMax})`);
    this.name = "QueueFullError";
  }
}

export interface JobQueueOptions {
  queueMax: number;
}

interface StoredJob {
  job: Job;
}

export class JobQueue {
  private readonly jobs = new Map<string, StoredJob>();
  private readonly waiting: string[] = [];
  private readonly emitter = new EventEmitter();
  private readonly queueMax: number;

  constructor(opts: JobQueueOptions) {
    this.queueMax = opts.queueMax;
    this.emitter.setMaxListeners(0);
  }

  enqueue(job: Job): void {
    const liveCount = this.liveJobCount();
    if (liveCount >= this.queueMax) {
      throw new QueueFullError(this.queueMax);
    }
    this.jobs.set(job.id, { job });
    this.waiting.push(job.id);
  }

  get(jobId: string): Job | undefined {
    return this.jobs.get(jobId)?.job;
  }

  listBySession(sessionId: string): Job[] {
    const out: Job[] = [];
    for (const { job } of this.jobs.values()) {
      if (job.sessionId === sessionId) out.push(job);
    }
    return out.sort((a, b) => b.createdAt - a.createdAt);
  }

  update(jobId: string, patch: Partial<Omit<Job, "id" | "sessionId">>): void {
    const stored = this.jobs.get(jobId);
    if (!stored) return;
    stored.job = { ...stored.job, ...patch };
    const job = stored.job;

    const event: JobEvent = {
      jobId,
      state: job.state,
      progress: job.progress,
    };
    if (job.state === "done") {
      event.outputSize = job.outputSize;
      event.downloadUrl = `/api/download/${jobId}`;
    }
    if (job.state === "error") {
      event.error = job.error;
    }
    this.emitter.emit(`job:${jobId}`, event);
  }

  subscribe(jobId: string, listener: (event: JobEvent) => void): () => void {
    const key = `job:${jobId}`;
    this.emitter.on(key, listener);
    return () => {
      this.emitter.off(key, listener);
    };
  }

  nextWaiting(): Job | undefined {
    while (this.waiting.length) {
      const id = this.waiting.shift()!;
      const stored = this.jobs.get(id);
      if (stored && stored.job.state === "queued") {
        return stored.job;
      }
    }
    return undefined;
  }

  remove(jobId: string): void {
    this.jobs.delete(jobId);
    const idx = this.waiting.indexOf(jobId);
    if (idx !== -1) this.waiting.splice(idx, 1);
  }

  liveJobCount(): number {
    let n = 0;
    for (const { job } of this.jobs.values()) {
      if (!isTerminalState(job.state)) n += 1;
    }
    return n;
  }
}
