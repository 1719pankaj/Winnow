import { SearchOrchestrator } from './orchestrator';
import { store } from './store';
import { Trace } from './types';

export interface SearchJob {
  id: string;
  query: string;
  intent?: string | null;
  tier: 'fast' | 'right';
  modelOverride?: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  promise?: Promise<Trace>;
}

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
            degraded_reasons: [{ reason: 'search_error', detail: err.message }],
            llm_call_count: 0,
            cache_hit_count: 0,
          };
          await store.saveTrace(errorTrace);
          return errorTrace;
        });
    }

    return job.promise;
  }
}

export const jobManager = new SearchJobManager();
