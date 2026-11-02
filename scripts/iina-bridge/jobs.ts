/**
 * In-process registry of background subtitle-generation jobs.
 *
 * `/api/cues` never waits for the language model: a cache miss registers a job
 * here and answers with a placeholder. The job reports its own progress in cue
 * units, and the plugin polls `/api/job` until the state settles.
 *
 * State lives in memory only — the durable record is the cache entry that the
 * job writes (`~/.glean-iina/cache/`). A bridge restart therefore loses the
 * counters but not the results: a completed entry is reported as `ready`
 * straight from disk.
 */

export type JobState = 'pending' | 'ready' | 'failed';

export interface JobSnapshot {
  state: JobState;
  done: number;
  total: number;
  updatedAt: number;
  cacheKey: string;
  error?: string;
}

/** Cumulative cues completed; the first call after parsing also reports `total`. */
export type JobReport = (done: number, total?: number) => void;

interface JobEntry extends JobSnapshot {
  state: JobState;
}

/** Finished entries are kept (cheap, and `/api/job` may still ask) but bounded. */
const MAX_ENTRIES = 256;

const jobs = new Map<string, JobEntry>();

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Drop the oldest settled entries once the registry grows past `MAX_ENTRIES`. */
function pruneFinished(): void {
  if (jobs.size <= MAX_ENTRIES) return;
  for (const [key, entry] of jobs) {
    if (jobs.size <= MAX_ENTRIES) return;
    if (entry.state !== 'pending') jobs.delete(key);
  }
}

/**
 * Run `run` in the background for `cacheKey`, unless a job for that key is
 * already pending (then this is a no-op — repeated `/api/cues` polls must not
 * start duplicate generations).
 *
 * `run` performs the actual work and writes the cache itself; it receives a
 * `report` callback for progress. Resolving marks the job `ready`, throwing
 * marks it `failed` (with the message logged and kept for `/api/job`).
 */
export function startJob(cacheKey: string, total: number, run: (report: JobReport) => Promise<void>): void {
  const existing = jobs.get(cacheKey);
  if (existing && existing.state === 'pending') return;

  pruneFinished();

  const entry: JobEntry = {
    state: 'pending',
    done: 0,
    total: Number.isFinite(total) ? Math.max(0, Math.floor(total)) : 0,
    updatedAt: Date.now(),
    cacheKey,
  };
  jobs.set(cacheKey, entry);

  const report: JobReport = (done, total) => {
    // A restarted job replaces the entry; late reports from the old one are ignored.
    if (jobs.get(cacheKey) !== entry) return;
    if (typeof total === 'number' && Number.isFinite(total)) {
      entry.total = Math.max(0, Math.floor(total));
    }
    const completed = Number.isFinite(done) ? Math.max(0, Math.floor(done)) : entry.done;
    entry.done = Math.max(entry.done, completed);
    if (entry.total > 0 && entry.done > entry.total) entry.done = entry.total;
    entry.updatedAt = Date.now();
  };

  let pending: Promise<void>;
  try {
    pending = run(report);
  } catch (err) {
    pending = Promise.reject(err);
  }

  void pending.then(
    () => {
      if (jobs.get(cacheKey) !== entry) return;
      entry.state = 'ready';
      entry.done = entry.total;
      entry.updatedAt = Date.now();
    },
    (err: unknown) => {
      if (jobs.get(cacheKey) !== entry) return;
      entry.state = 'failed';
      entry.error = errorMessage(err);
      entry.updatedAt = Date.now();
      console.warn(`[bridge] job ${cacheKey} failed: ${entry.error}`);
    }
  );
}

/** Snapshot of a known job, or `null` when this process never generated that key. */
export function jobStatus(cacheKey: string): JobSnapshot | null {
  const entry = jobs.get(cacheKey);
  if (!entry) return null;
  return {
    state: entry.state,
    done: entry.done,
    total: entry.total,
    updatedAt: entry.updatedAt,
    cacheKey: entry.cacheKey,
    ...(entry.error ? { error: entry.error } : {}),
  };
}
