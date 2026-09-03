import { SearchOrchestrator } from './orchestrator';
import { store } from './store';
import { Trace, ProgressEvent } from './types';

export interface SearchJob {
  id: string;
  query: string;
  intent?: string | null;
  tier: 'fast' | 'right';
  modelOverride?: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  promise?: Promise<Trace>;
}

import { eventHub } from './events';

class SearchJobManager {
  private jobs = new Map<string, SearchJob>();

  register(job: SearchJob): void {
    this.jobs.set(job.id, job);
  }

  get(id: string): SearchJob | undefined {
    return this.jobs.get(id);
  }

  startIfNotRunning(id: string): Promise<Trace> | undefined {
    const job = this.jobs.get(id);
    if (!job) return undefined;

    if (!job.promise) {
      job.status = 'running';
      const orchestrator = new SearchOrchestrator(id);
      job.promise = orchestrator
        .run({
          query: job.query,
          intent: job.intent,
          tier: job.tier,
          modelOverride: job.modelOverride,
        })
        .then((trace) => {
          job.status = 'completed';
          return trace;
        })
        .catch(async (err) => {
          job.status = 'failed';
          console.error(`[SearchJob ${id} Failed]:`, err);
          const errorMsg = err?.message || 'Search execution failed';
          const errorTrace: Trace = {
            id,
            created_at: new Date().toISOString(),
            query: job.query,
            intent: job.intent || null,
            tier: job.tier,
            model_id: job.modelOverride || 'auto',
            status: 'failed',
            elapsed_ms: 0,
            prompt_version: 'rerank.v3',
            results: [],
            candidates: [],
            degraded_reasons: [{ reason: 'search_error', detail: errorMsg }],
            llm_call_count: 0,
            cache_hit_count: 0,
            audit: { deliberation_log: [{ timestamp: new Date().toISOString(), stage: 'error', message: errorMsg }] },
          };
          try {
            await store.saveTrace(errorTrace);
            const errEvt: ProgressEvent = {
              id: Date.now(),
              type: 'error',
              data: { message: errorMsg },
              at: new Date().toISOString(),
            };
            await store.appendEvent(id, errEvt);
            eventHub.broadcast(id, errEvt);
          } catch (dbErr) {
            console.error(`[SearchJob ${id} DB Save Failed]:`, dbErr);
          }
          return errorTrace;
        });
    }

    return job.promise;
  }
}

const globalForJobs = globalThis as unknown as {
  winnowJobManager: SearchJobManager | undefined;
};

export const jobManager = globalForJobs.winnowJobManager ?? new SearchJobManager();
globalForJobs.winnowJobManager = jobManager;

