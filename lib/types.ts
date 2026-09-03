export interface RawResult {
  provider: string;
  rank: number;
  title: string;
  snippet: string;
  url: string;
  raw_url: string;
  published_at: string | null;
  site_name: string | null;
  position?: number;
  raw?: any;
}

export interface ProviderHit {
  provider: string;
  rank: number;
}

export type ExtractionMethod = 'readability' | 'cheerio' | 'snippet_only';

export type FetchStatus =
  | 'ok'
  | 'timeout'
  | 'http_error'
  | 'blocked'
  | 'robots_denied'
  | 'unsupported'
  | 'cached';

export interface PageContent {
  text: string;
  char_count: number;
  truncated: boolean;
  extraction_method: ExtractionMethod;
  fetch_status: FetchStatus;
  fetched_at: string;
}

export interface Candidate {
  id: string; // e.g. "c01"
  url: string; // canonical
  raw_url: string; // original
  domain: string;
  title: string;
  snippet: string;
  published_at: string | null;
  sources: ProviderHit[];

  // Stage 1
  fused_score: number;

  // Stage 2
  prefilter_score: number | null;
  blocklist_penalty: number;

  // Stage 3
  content: PageContent | null;

  // Stage 4
  final_score: number | null;
  rationale: string | null;
  verdict: 'keep' | 'drop' | null;

  // bookkeeping
  dropped_at_stage: string | null;
  drop_reason: string | null;
}

export interface Provenance {
  providers: ProviderHit[];
  original_best_rank: number;
  rank_delta: number; // original_best_rank - final_rank; positive = promoted
  prefilter_score: number | null;
  was_read: boolean;
  penalties: string[];
}

export interface RankedResult {
  rank: number;
  url: string;
  domain: string;
  title: string;
  snippet: string;
  score: number;
  rationale: string;
  provenance: Provenance;
}

export interface StageAuditData {
  plan?: {
    system_prompt?: string;
    user_prompt?: string;
    raw_response?: string;
    queries: string[];
    interpretation: string;
    avoid_domains: string[];
  };
  retrieve?: {
    provider_hits: { provider: string; query: string; count: number; elapsed_ms: number }[];
    dedupe_stats: { raw: number; unique: number; near_dupes: number };
  };
  prefilter?: {
    kept_count: number;
    dropped_count: number;
    drops_by_blocklist: number;
    evaluations: { id: string; domain: string; title: string; prefilter_score: number; fused_score: number; action: string }[];
  };
  fetch?: {
    attempted: number;
    ok: number;
    failed: number;
    cached: number;
    items: { url: string; domain: string; status: string; method: string; chars: number }[];
  };
  rerank?: {
    system_prompt?: string;
    user_prompt?: string;
    raw_response?: string;
    parse_ladder_rung?: string;
    evaluations: { id: string; domain: string; score: number; verdict: string; rationale: string }[];
  };
  deliberation_log?: { timestamp: string; stage: string; message: string; data?: any }[];
}

export interface Trace {
  id: string; // UUID
  created_at: string;
  query: string;
  intent: string | null;
  tier: 'rush' | 'fast' | 'right';
  model_id: string;
  status: 'running' | 'completed' | 'failed' | 'degraded';
  elapsed_ms: number;
  prompt_version: string;
  results: RankedResult[];
  candidates: Candidate[];
  degraded_reasons: { reason: string; detail?: string }[];
  llm_call_count: number;
  cache_hit_count: number;
  audit?: StageAuditData;
}

export type ProgressEventType =
  | 'search_started'
  | 'deliberation'
  | 'stage_started'
  | 'stage_skipped'
  | 'plan_done'
  | 'provider_returned'
  | 'provider_error'
  | 'retrieve_done'
  | 'retrieve_candidates'
  | 'prefilter_started'
  | 'prefilter_done'
  | 'prefilter_evaluations'
  | 'interim_results'
  | 'fetch_started'
  | 'fetch_progress'
  | 'fetch_done'
  | 'fetch_content'
  | 'rerank_started'
  | 'rerank_thought'
  | 'rerank_done'
  | 'rerank_inference'
  | 'degraded'
  | 'results'
  | 'done'
  | 'error';

export interface ProgressEvent {
  id: number;
  type: ProgressEventType;
  data: Record<string, any>;
  at: string;
}
