import type { Relay } from './context';
import { drainDue } from './services/deliveries';
import { sweepCountersJob } from './services/limits';
import { purgeRawIpsJob } from './services/origins';
import { retentionJob } from './services/retention';
import { reviewHeldJob } from './services/review';
import { sweepStuckJob } from './services/sending';

type Job = { name: string; every: 'minute' | 'quarter-hour'; run: (relay: Relay) => Promise<number> };

const JOBS: Job[] = [
  { name: 'gateway', every: 'minute', run: async (relay) => (relay.gateway ? (await relay.gateway.ensure(), 1) : 0) },
  { name: 'held', every: 'minute', run: reviewHeldJob },
  { name: 'stuck', every: 'minute', run: sweepStuckJob },
  { name: 'deliveries', every: 'minute', run: drainDue },
  { name: 'retention', every: 'quarter-hour', run: retentionJob },
  { name: 'raw-ips', every: 'quarter-hour', run: purgeRawIpsJob },
  { name: 'counters', every: 'quarter-hour', run: sweepCountersJob },
];

/** Cron, every minute. Each job is isolated: one failing never stops the others, and every outcome is logged. */
export async function handleScheduled(relay: Relay): Promise<Record<string, number | 'failed'>> {
  const quarter = relay.now().getUTCMinutes() % 15 === 0;
  const out: Record<string, number | 'failed'> = {};
  for (const job of JOBS) {
    if (job.every === 'quarter-hour' && !quarter) continue;
    try {
      out[job.name] = await job.run(relay);
    } catch (error) {
      out[job.name] = 'failed';
      relay.log.error('cron.job_failed', { job: job.name, error });
    }
  }
  relay.log.info('cron.done', out);
  return out;
}
