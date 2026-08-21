import { loadConfig } from './config/loader';
import { FullWinnowConfig } from './config/models';
import { HttpSearchAdapter } from './adapters/search';
import { InferenceAdapter } from './adapters/inference';
import { stagePlan, PlanOutput } from './stages/plan';
import { stageRetrieve } from './stages/retrieve';
import { stagePrefilter } from './stages/prefilter';
import { stageFetch } from './stages/fetch';
import { stageRerank, RerankOutput } from './stages/rerank';
import { stageAssemble } from './stages/assemble';
import { store } from './store';
import { eventHub } from './events';
import {
  Trace,
  Candidate,
  RankedResult,
  ProgressEvent,
  StageAuditData,
} from './types';

export interface SearchRunOptions {
  query: string;
  intent?: string | null;
  tier?: 'fast' | 'right';
  modelOverride?: string;
}

export class SearchOrchestrator {
  private searchId: string;
  private seq = 0;
  private eventCallback?: (evt: ProgressEvent) => void;
  private audit: StageAuditData = {
    deliberation_log: [],
  };

  constructor(searchId: string, eventCallback?: (evt: ProgressEvent) => void) {
    this.searchId = searchId;
    this.eventCallback = eventCallback;
  }

  private async emit(type: ProgressEvent['type'], data: Record<string, any> = {}): Promise<void> {
    this.seq += 1;
    const evt: ProgressEvent = {
      id: this.seq,
      type,
      data,
      at: new Date().toISOString(),
    };

    await store.appendEvent(this.searchId, evt);
    eventHub.broadcast(this.searchId, evt);

    if (this.eventCallback) {
      this.eventCallback(evt);
    }
  }

  private async logDeliberation(stage: string, message: string, data?: Record<string, any>): Promise<void> {
    const entry = {
      stage,
      message,
      timestamp: new Date().toISOString(),
      data,
    };
    if (!this.audit.deliberation_log) {
      this.audit.deliberation_log = [];
    }
    this.audit.deliberation_log.push(entry);
    await this.emit('deliberation', entry);
  }

  private resolveInferenceAdapter(modelId: string, config: FullWinnowConfig): { adapter: InferenceAdapter; modelId: string; provider: string } {
    const modelConfig = config.inference.models.find((m) => m.id === modelId) || config.inference.models[0];
    const providerConfig = config.inference.inference_providers.find((p) => p.name === modelConfig.provider) || config.inference.inference_providers[0];
    return {
      adapter: new InferenceAdapter(providerConfig, modelConfig),
      modelId: modelConfig.id,
      provider: providerConfig.name,
    };
  }

  async run(options: SearchRunOptions): Promise<Trace> {
    await store.init();
    const config = loadConfig();
    const query = options.query.trim();
    const intent = options.intent && options.intent.trim() ? options.intent.trim() : null;
    const tierName = options.tier || 'fast';
    const tierConfig = config.winnow.tiers[tierName];

    const t0 = Date.now();

    // 1. Resolve Initial Inference Provider & Model
    const requestedModelId = options.modelOverride || config.inference.model_policy.fallback_chain[0];
    let { adapter: inferenceAdapter, modelId, provider } = this.resolveInferenceAdapter(requestedModelId, config);

    const fallbackCandidateList = [
      modelId,
      ...config.inference.model_policy.fallback_chain.filter((id) => id !== modelId),
    ];

    // Resolve Search Adapters
    const searchAdapters = config.providers
      .filter((p) => p.enabled && tierConfig.providers.includes(p.name))
      .map((p) => new HttpSearchAdapter(p));

    if (searchAdapters.length === 0) {
      throw new Error(`No enabled search providers for tier "${tierName}"`);
    }

    const degradedReasons: { reason: string; detail?: string }[] = [];

    // Initialize Trace in Database
    const initialTrace: Trace = {
      id: this.searchId,
      created_at: new Date().toISOString(),
      query,
      intent,
      tier: tierName,
      model_id: modelId,
      status: 'running',
      elapsed_ms: 0,
      prompt_version: 'rerank.v3',
      results: [],
      candidates: [],
      degraded_reasons: [],
      llm_call_count: 0,
      cache_hit_count: 0,
      audit: this.audit,
    };
    await store.saveTrace(initialTrace);

    await this.emit('search_started', {
      query,
      intent,
      tier: tierName,
      model_id: modelId,
      providers: searchAdapters.map((a) => a.name),
    });

    await this.logDeliberation('init', `Search initialized for "${query}" (Tier: ${tierName.toUpperCase()}, Model: ${modelId} via ${provider.toUpperCase()})`);

    // ----------------------------------------------------
    // STAGE 0: PLAN (Multi-Model Fallback Resilient)
    // ----------------------------------------------------
    let planResult: PlanOutput = {
      queries: [query],
      must_avoid_domains: [],
      freshness: 'none',
      interpretation: 'Searching verbatim.',
    };

    if (intent) {
      await this.emit('stage_started', { stage: 'plan', index: 0, label: 'Planning' });
      await this.logDeliberation('plan', `Analyzing intent: "${intent}" via planner model (${modelId})...`);

      let planSuccess = false;
      for (const candModelId of fallbackCandidateList) {
        try {
          const { adapter: candAdapter, modelId: activeCandId } = this.resolveInferenceAdapter(candModelId, config);
          planResult = await stagePlan(query, intent, candAdapter, config.winnow.stage_budgets_ms.plan);

          this.audit.plan = {
            system_prompt: planResult.system_prompt,
            user_prompt: planResult.user_prompt,
            raw_response: planResult.raw_response,
            queries: planResult.queries,
            interpretation: planResult.interpretation,
            avoid_domains: planResult.must_avoid_domains,
          };

          if (!planResult.is_degraded) {
            planSuccess = true;
            inferenceAdapter = candAdapter;
            modelId = activeCandId;
            break;
          }
        } catch (err: any) {
          await this.logDeliberation('plan', `Planner failover: ${candModelId} error (${err.message}). Trying next provider in chain...`);
        }
      }

      if (!planSuccess) {
        degradedReasons.push({ reason: 'plan_failed', detail: 'Fell back to verbatim query across providers' });
        await this.emit('degraded', { reason: 'plan_failed' });
      }

      await this.logDeliberation('plan', `Plan formulated (${planResult.queries.length} queries). Interpretation: "${planResult.interpretation}"`, {
        queries: planResult.queries,
        avoid: planResult.must_avoid_domains,
      });

      await this.emit('plan_done', {
        queries: planResult.queries,
        interpretation: planResult.interpretation,
        freshness: planResult.freshness,
      });
    } else {
      await this.emit('stage_skipped', { stage: 'plan', reason: 'no_intent_provided' });
      await this.logDeliberation('plan', 'No intent provided; querying verbatim.');
      this.audit.plan = {
        queries: [query],
        interpretation: 'Searching verbatim.',
        avoid_domains: [],
      };
    }

    // ----------------------------------------------------
    // STAGE 1: RETRIEVE + DEDUPE + RRF
    // ----------------------------------------------------
    await this.emit('stage_started', { stage: 'retrieve', index: 1, label: 'Retrieving' });
    await this.logDeliberation('retrieve', `Dispatching parallel queries across [${searchAdapters.map((a) => a.name).join(', ')}]...`);

    const providerHitsAudit: { provider: string; query: string; count: number; elapsed_ms: number }[] = [];

    let candidates: Candidate[] = await stageRetrieve({
      providers: searchAdapters,
      queries: planResult.queries,
      countPerRequest: tierConfig.retrieve_count,
      rrfK: config.winnow.fusion.rrf_k,
      maxPerDomain: config.winnow.blocklist.max_per_domain,
      onProviderReturned: async (prov, qIdx, count, elapsedMs) => {
        providerHitsAudit.push({
          provider: prov,
          query: planResult.queries[qIdx] || query,
          count,
          elapsed_ms: elapsedMs,
        });
        await this.logDeliberation('retrieve', `Provider "${prov}" returned ${count} hits for query #${qIdx + 1} (${elapsedMs}ms)`);
        await this.emit('provider_returned', { provider: prov, query_index: qIdx, count, elapsed_ms: elapsedMs });
      },
      onProviderError: async (prov, err) => {
        await this.logDeliberation('retrieve', `Provider "${prov}" error: ${err.message}`);
        await this.emit('provider_error', { provider: prov, status: 500, message: err.message });
      },
    });

    const activeCount = candidates.filter((c) => !c.dropped_at_stage).length;
    this.audit.retrieve = {
      provider_hits: providerHitsAudit,
      dedupe_stats: {
        raw: candidates.length,
        unique: activeCount,
        near_dupes: candidates.length - activeCount,
      },
    };

    await this.logDeliberation('retrieve', `Deduplicated and fused ${candidates.length} raw hits into ${activeCount} candidates (RRF k=${config.winnow.fusion.rrf_k})`);
    await this.emit('retrieve_done', { raw_count: candidates.length, unique_count: activeCount });

    if (activeCount === 0) {
      await this.logDeliberation('retrieve', 'Zero candidates retrieved from search providers.');
      await this.emit('done', { elapsed_ms: Date.now() - t0, total_llm_calls: 0, cache_hits: 0 });
      return {
        ...initialTrace,
        status: 'completed',
        elapsed_ms: Date.now() - t0,
        results: [],
        candidates: [],
      };
    }

    // ----------------------------------------------------
    // STAGE 2: PREFILTER
    // ----------------------------------------------------
    await this.emit('stage_started', { stage: 'prefilter', index: 2, label: 'Prefiltering' });
    await this.emit('prefilter_started', { candidate_count: activeCount });
    await this.logDeliberation('prefilter', `Computing semantic cosine similarity & hard blocklists on ${activeCount} candidates...`);

    const prefilterOut = await stagePrefilter({
      query,
      intent,
      candidates,
      config,
      tierName,
      advisoryAvoidDomains: planResult.must_avoid_domains,
    });
    candidates = prefilterOut.candidates;

    this.audit.prefilter = {
      kept_count: prefilterOut.keptCount,
      dropped_count: prefilterOut.droppedCount,
      drops_by_blocklist: prefilterOut.droppedByBlocklist,
      evaluations: candidates.map((c) => ({
        id: c.id,
        domain: c.domain,
        title: c.title,
        prefilter_score: c.prefilter_score || 0,
        fused_score: c.fused_score || 0,
        action: c.dropped_at_stage ? `Drop (${c.drop_reason})` : 'Keep',
      })),
    };

    await this.logDeliberation('prefilter', `Prefilter finished: kept ${prefilterOut.keptCount}, dropped ${prefilterOut.droppedCount} (Hard-blocked: ${prefilterOut.droppedByBlocklist}).`);
    await this.emit('prefilter_done', {
      kept: prefilterOut.keptCount,
      dropped: prefilterOut.droppedCount,
      blocklist_drops: prefilterOut.droppedByBlocklist,
    });

    // Provisional results
    const interimRanked = stageAssemble(candidates);
    await this.emit('interim_results', { results: interimRanked });

    // ----------------------------------------------------
    // STAGE 3: FETCH (Conditional on Tier)
    // ----------------------------------------------------
    let fromCacheCount = 0;
    if (tierName === 'right') {
      await this.emit('stage_started', { stage: 'fetch', index: 3, label: 'Fetching' });
      await this.emit('fetch_started', { url_count: prefilterOut.keptCount });
      await this.logDeliberation('fetch', `Fetching and extracting readability content for ${prefilterOut.keptCount} candidate pages...`);

      const fetchOut = await stageFetch({
        candidates,
        config,
        tierName,
        stageBudgetMs: config.winnow.stage_budgets_ms.fetch,
        onProgress: async (done, total, ok, failed) => {
          await this.emit('fetch_progress', { completed: done, total, ok, failed });
        },
      });
      candidates = fetchOut.candidates;
      fromCacheCount = fetchOut.fromCacheCount;

      this.audit.fetch = {
        attempted: prefilterOut.keptCount,
        ok: fetchOut.okCount,
        cached: fetchOut.fromCacheCount,
        failed: fetchOut.failedCount,
        items: [],
      };

      await this.logDeliberation('fetch', `Fetch complete: ${fetchOut.okCount} pages read (${fetchOut.fromCacheCount} from cache, ${fetchOut.failedCount} failed/blocked).`);
      await this.emit('fetch_done', {
        ok: fetchOut.okCount,
        failed: fetchOut.failedCount,
        from_cache: fetchOut.fromCacheCount,
      });
    } else {
      await this.emit('stage_skipped', { stage: 'fetch', reason: 'fast_tier_snippets_only' });
      await this.logDeliberation('fetch', 'Fast tier: full-page fetching skipped (evaluating snippets).');
    }

    // ----------------------------------------------------
    // STAGE 4: RERANK (Multi-Model Failover Resilient)
    // ----------------------------------------------------
    await this.emit('stage_started', { stage: 'rerank', index: 4, label: 'Reranking' });
    const activeRerankCandidates = candidates.filter((c) => !c.dropped_at_stage);

    await this.emit('rerank_started', {
      mode: tierConfig.rerank_mode,
      model_id: modelId,
      candidate_count: activeRerankCandidates.length,
    });
    await this.logDeliberation('rerank', `Executing listwise LLM evaluation with ${modelId} across ${activeRerankCandidates.length} candidates...`);

    let rerankOut: RerankOutput = {
      candidates,
      keptCount: activeRerankCandidates.length,
      droppedCount: 0,
    };

    let rerankSuccess = false;
    for (const candModelId of fallbackCandidateList) {
      try {
        const { adapter: candAdapter, modelId: activeCandId, provider: activeProv } = this.resolveInferenceAdapter(candModelId, config);
        
        rerankOut = await stageRerank({
          query,
          intent,
          candidates,
          config,
          inferenceAdapter: candAdapter,
          searchId: this.searchId,
          freshness: planResult.freshness,
          tierName,
        });

        if (!rerankOut.is_degraded) {
          rerankSuccess = true;
          modelId = activeCandId;
          break;
        } else {
          await this.logDeliberation('rerank', `Model ${candModelId} (${activeProv}) degraded, trying next provider in fallback chain...`);
        }
      } catch (err: any) {
        await this.logDeliberation('rerank', `Model ${candModelId} failover error (${err.message}). Retrying next provider...`);
      }
    }

    candidates = rerankOut.candidates;

    this.audit.rerank = {
      system_prompt: rerankOut.system_prompt,
      user_prompt: rerankOut.user_prompt,
      raw_response: rerankOut.raw_response,
      parse_ladder_rung: rerankOut.parse_ladder_rung,
      evaluations: candidates.map((c) => ({
        id: c.id,
        domain: c.domain,
        score: c.final_score || 0,
        verdict: c.verdict || 'keep',
        rationale: c.rationale || '',
      })),
    };

    if (rerankOut.is_degraded && !rerankSuccess) {
      degradedReasons.push({ reason: 'rerank_degraded', detail: 'Parsed via fallback ordering across providers' });
      await this.emit('degraded', { reason: 'rerank_degraded' });
    }

    await this.logDeliberation('rerank', `Reranking complete (${rerankOut.parse_ladder_rung || 'parsed'} via ${modelId}): ${rerankOut.keptCount} kept, ${rerankOut.droppedCount} dropped.`);
    await this.emit('rerank_done', { kept: rerankOut.keptCount, dropped: rerankOut.droppedCount });

    // ----------------------------------------------------
    // STAGE 5: ASSEMBLE (Final Ranked Results & Provenance)
    // ----------------------------------------------------
    const finalResults: RankedResult[] = stageAssemble(candidates);
    const totalElapsed = Date.now() - t0;

    await this.logDeliberation('assemble', `Assembled ${finalResults.length} final ranked results with rank deltas and provenance.`);

    await this.emit('results', {
      results: finalResults,
      trace_summary: {
        elapsed_ms: totalElapsed,
        model_id: modelId,
        kept_candidates_count: finalResults.length,
      },
    });

    await this.emit('done', {
      elapsed_ms: totalElapsed,
      total_llm_calls: intent ? 2 : 1,
      cache_hits: fromCacheCount,
    });

    const finalTrace: Trace = {
      id: this.searchId,
      created_at: initialTrace.created_at,
      query,
      intent,
      tier: tierName,
      model_id: modelId,
      status: 'completed',
      elapsed_ms: totalElapsed,
      prompt_version: 'rerank.v3',
      results: finalResults,
      candidates,
      degraded_reasons: degradedReasons,
      llm_call_count: intent ? 2 : 1,
      cache_hit_count: fromCacheCount,
      audit: this.audit,
    };

    await store.saveTrace(finalTrace);
    return finalTrace;
  }
}
