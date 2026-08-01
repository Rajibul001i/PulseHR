/**
 * Job queue.
 *
 * ADR-004 / P0-6: payroll and attrition scoring must NOT run in the API process. Node is
 * single-threaded for JavaScript, so a payroll run over thousands of employees inside the
 * request path blocks the event loop and hangs every other request.
 *
 * This is an in-process runner with the same interface a real queue would expose
 * (enqueue / status / complete). Swapping in BullMQ + Redis for production is a
 * one-file change — the call sites do not move.
 */

import { randomUUID } from 'node:crypto';

export type JobType = 'PAYROLL_RUN' | 'ATTRITION_SCORING';
export type JobState = 'QUEUED' | 'RUNNING' | 'DONE' | 'FAILED';

export interface Job {
  id: string;
  type: JobType;
  state: JobState;
  payload: Record<string, unknown>;
  result?: unknown;
  error?: string;
  enqueuedAt: string;
  finishedAt?: string;
}

const jobs = new Map<string, Job>();
const pending: string[] = [];

type Handler = (payload: Record<string, unknown>) => Promise<unknown> | unknown;
const handlers = new Map<JobType, Handler>();

export function registerHandler(type: JobType, fn: Handler): void {
  handlers.set(type, fn);
}

export function enqueue(type: JobType, payload: Record<string, unknown>): string {
  const job: Job = {
    id: randomUUID(),
    type,
    state: 'QUEUED',
    payload,
    enqueuedAt: new Date().toISOString(),
  };
  jobs.set(job.id, job);
  pending.push(job.id);
  // Yield to the event loop so the HTTP response goes out before work begins.
  setImmediate(drain);
  return job.id;
}

export function jobStatus(id: string): Job | undefined {
  return jobs.get(id);
}

let draining = false;

async function drain(): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    while (pending.length > 0) {
      const id = pending.shift()!;
      const job = jobs.get(id);
      if (!job) continue;

      const handler = handlers.get(job.type);
      if (!handler) {
        job.state = 'FAILED';
        job.error = `No handler registered for ${job.type}`;
        job.finishedAt = new Date().toISOString();
        continue;
      }

      job.state = 'RUNNING';
      try {
        job.result = await handler(job.payload);
        job.state = 'DONE';
      } catch (err) {
        job.state = 'FAILED';
        job.error = (err as Error).message;
      }
      job.finishedAt = new Date().toISOString();
    }
  } finally {
    draining = false;
  }
}
