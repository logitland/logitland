import type { Relay } from './context';
import { consentSweepJob } from './services/consent';
import { drainDue } from './services/deliveries';
import { sweepCountersJob } from './services/limits';
import { pruneOriginsJob, purgeRawIpsJob } from './services/origins';
import { resealJob } from './services/reseal';
import { retentionJob } from './services/retention';
import { reviewHeldJob } from './services/review';
import { sweepStuckJob } from './services/sending';
import { wakeStreams } from './services/streams';

/** What a job is told about its run. Jobs that can stop early check `deadline` (Date.now() milliseconds). */
export interface JobContext {
  deadline: number;
}

type Job = {
  name: string;
  every: 'minute' | 'quarter-hour';
  /** The most a run may take. Past it the cron moves on to the next job, and this one finishes or is cut off in the background. */
  budgetMs: number;
  run: (relay: Relay, ctx: JobContext) => Promise<number>;
};

// The jobs run one after another in a single cron invocation, which has one budget of D1 queries (1,000 on the paid plan)
// and one wall-clock limit, so each job gets its own time budget and the slow ones stop early.
const JOBS: Job[] = [
  { name: 'gateway', every: 'minute', budgetMs: 10_000, run: async (relay) => (relay.gateway ? (await relay.gateway.ensure(), 1) : 0) },
  { name: 'held', every: 'minute', budgetMs: 30_000, run: (relay, ctx) => reviewHeldJob(relay, Math.max(0, ctx.deadline - Date.now())) },
  { name: 'stuck', every: 'minute', budgetMs: 15_000, run: sweepStuckJob },
  { name: 'deliveries', every: 'minute', budgetMs: 20_000, run: drainDue },
  // WebSocket subscriptions of a minute and longer fall due without a new event to wake them.
  { name: 'streams', every: 'minute', budgetMs: 10_000, run: async (relay) => (relay.streams ? (await wakeStreams(relay), 1) : 0) },
  { name: 'consent', every: 'minute', budgetMs: 20_000, run: (relay, ctx) => consentSweepJob(relay, ctx) },
  { name: 'retention', every: 'quarter-hour', budgetMs: 25_000, run: retentionJob },
  { name: 'raw-ips', every: 'quarter-hour', budgetMs: 10_000, run: purgeRawIpsJob },
  { name: 'origins', every: 'quarter-hour', budgetMs: 10_000, run: pruneOriginsJob },
  { name: 'counters', every: 'quarter-hour', budgetMs: 10_000, run: sweepCountersJob },
  { name: 'reseal', every: 'quarter-hour', budgetMs: 15_000, run: resealJob },
];

export type JobOutcome = number | 'failed' | 'timed_out';

async function runJob(relay: Relay, job: Job): Promise<JobOutcome> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  // The job itself is told to stop a fifth early, so it can finish what it is doing before the cron gives up on it.
  const work = Promise.resolve().then(() => job.run(relay, { deadline: Date.now() + job.budgetMs * 0.8 }));
  const timeout = new Promise<'timed_out'>((resolve) => {
    timer = setTimeout(() => resolve('timed_out'), job.budgetMs);
  });
  try {
    const outcome = await Promise.race([work, timeout]);
    if (outcome === 'timed_out') {
      relay.log.error('cron.job_timed_out', { job: job.name, budget_ms: job.budgetMs });
      work.catch((error) => relay.log.error('cron.job_failed', { job: job.name, error }));
    }
    return outcome;
  } catch (error) {
    relay.log.error('cron.job_failed', { job: job.name, error });
    return 'failed';
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Cron, every minute. Each job is isolated: one failing or running out of time never stops the others, and every outcome
 * is logged. The quarter-hour jobs run when the cron's scheduled time (the trigger's `scheduledTime`, so a late start
 * still counts) falls on a quarter hour; without it the relay's clock is used.
 */
export async function handleScheduled(relay: Relay, scheduledTime?: number | Date): Promise<Record<string, JobOutcome>> {
  const at = scheduledTime === undefined ? relay.now() : new Date(scheduledTime);
  const quarter = at.getUTCMinutes() % 15 === 0;
  const out: Record<string, JobOutcome> = {};
  for (const job of JOBS) {
    if (job.every === 'quarter-hour' && !quarter) continue;
    out[job.name] = await runJob(relay, job);
  }
  relay.log.info('cron.done', out);
  return out;
}
