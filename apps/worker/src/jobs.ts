import type { Logger } from 'pino';

export interface Job {
  name: string;
  run(): Promise<{ affected: number }>;
}

/**
 * Runs each job sequentially. A failing job is logged and does not stop the
 * others (no silent swallowing: failures are logged at error level).
 */
export async function runJobs(jobs: Job[], logger: Logger): Promise<{ failed: number }> {
  let failed = 0;
  for (const job of jobs) {
    const started = Date.now();
    try {
      const { affected } = await job.run();
      logger.info({ job: job.name, affected, durationMs: Date.now() - started }, 'job_completed');
    } catch (err) {
      failed++;
      logger.error({ job: job.name, err }, 'job_failed');
    }
  }
  return { failed };
}
