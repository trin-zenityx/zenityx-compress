import { describe, it, expect, beforeEach } from "vitest";
import { JobQueue, QueueFullError } from "./queue.js";
import type { Job } from "./types.js";
import { getPreset } from "../presets/index.js";

function makeJob(id: string, sessionId: string = "sess1"): Job {
  return {
    id,
    sessionId,
    type: "video",
    originalName: `${id}.mp4`,
    inputPath: `/tmp/in/${id}.mp4`,
    outputPath: `/tmp/out/${id}.mp4`,
    preset: getPreset("manychat"),
    createdAt: Date.now(),
    state: "queued",
    progress: 0,
  };
}

describe("JobQueue", () => {
  let q: JobQueue;

  beforeEach(() => {
    q = new JobQueue({ queueMax: 3 });
  });

  it("enqueue stores the job and returns it", () => {
    const job = makeJob("a");
    q.enqueue(job);
    expect(q.get("a")?.id).toBe("a");
  });

  it("enqueue rejects when queue is full", () => {
    q.enqueue(makeJob("a"));
    q.enqueue(makeJob("b"));
    q.enqueue(makeJob("c"));
    expect(() => q.enqueue(makeJob("d"))).toThrow(QueueFullError);
  });

  it("completed jobs do not count toward queueMax", () => {
    q.enqueue(makeJob("a"));
    q.enqueue(makeJob("b"));
    q.enqueue(makeJob("c"));
    q.update("a", { state: "done", progress: 100 });
    q.enqueue(makeJob("d"));
    expect(q.get("d")?.id).toBe("d");
  });

  it("listBySession returns only jobs in that session", () => {
    q.enqueue(makeJob("a", "sess1"));
    q.enqueue(makeJob("b", "sess2"));
    q.enqueue(makeJob("c", "sess1"));
    const list = q.listBySession("sess1");
    expect(list.map((j) => j.id).sort()).toEqual(["a", "c"]);
  });

  it("update merges partial state and keeps id/sessionId stable", () => {
    q.enqueue(makeJob("a"));
    q.update("a", { state: "pass1", progress: 45 });
    const j = q.get("a")!;
    expect(j.state).toBe("pass1");
    expect(j.progress).toBe(45);
    expect(j.id).toBe("a");
  });

  it("update on unknown id is a no-op", () => {
    q.update("nope", { state: "done", progress: 100 });
    expect(q.get("nope")).toBeUndefined();
  });

  it("subscribe receives events for the given jobId", async () => {
    q.enqueue(makeJob("a"));
    const events: Array<{ state: string; progress: number }> = [];
    const unsubscribe = q.subscribe("a", (ev) => {
      events.push({ state: ev.state, progress: ev.progress });
    });
    q.update("a", { state: "pass1", progress: 10 });
    q.update("a", { state: "pass1", progress: 50 });
    q.update("a", { state: "done", progress: 100, outputSize: 1000 });
    unsubscribe();
    q.update("a", { state: "done", progress: 100 });
    expect(events).toEqual([
      { state: "pass1", progress: 10 },
      { state: "pass1", progress: 50 },
      { state: "done", progress: 100 },
    ]);
  });

  it("nextWaiting returns the oldest queued job and drops it from the waiting list", () => {
    q.enqueue(makeJob("a"));
    q.enqueue(makeJob("b"));
    expect(q.nextWaiting()?.id).toBe("a");
    expect(q.nextWaiting()?.id).toBe("b");
    expect(q.nextWaiting()).toBeUndefined();
  });

  it("remove unlinks a job by id", () => {
    q.enqueue(makeJob("a"));
    q.remove("a");
    expect(q.get("a")).toBeUndefined();
  });
});
