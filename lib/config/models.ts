import { z } from 'zod';

// 1. Providers Schema
export const SearchProviderAuthSchema = z.object({
  style: z.enum(['header', 'query', 'bearer', 'body']),
  name: z.string(),
  value: z.string(),
});

export const SearchProviderRequestSchema = z.object({
  method: z.enum(['GET', 'POST']),
  url: z.string().url(),
  auth: SearchProviderAuthSchema,
  params: z.record(z.string()),
  static_params: z.record(z.any()).optional().default({}),
  headers: z.record(z.string()).optional().default({}),
  timeout_ms: z.number().default(7000),
});

export const SearchProviderResponseSchema = z.object({
  results_path: z.string(),
  fields: z.object({
    title: z.string(),
    snippet: z.string(),
    url: z.string(),
    published_at: z.string().nullable().optional(),
    site_name: z.string().nullable().optional(),
  }),
  total_path: z.string().nullable().optional(),
});

export const SearchProviderLimitsSchema = z.object({
  max_count: z.number().default(20),
  rpm: z.number().default(60),
  rpd: z.number().nullable().default(null),
  concurrent: z.number().default(4),
});

export const SearchProviderCapabilitiesSchema = z.object({
  freshness_filter: z.boolean().default(false),
  site_filter: z.boolean().default(false),
  pagination: z.boolean().default(false),
});

export const SearchProviderConfigSchema = z.object({
  name: z.string(),
  enabled: z.boolean().default(true),
  weight: z.number().default(1.0),
  request: SearchProviderRequestSchema,
  response: SearchProviderResponseSchema,
  limits: SearchProviderLimitsSchema,
  capabilities: SearchProviderCapabilitiesSchema,
  on_error: z.enum(['skip', 'fail']).default('skip'),
});

export const ProvidersFileSchema = z.object({
  providers: z.array(SearchProviderConfigSchema),
});

// 2. Inference Schema
export const InferenceProviderConfigSchema = z.object({
  name: z.string(),
  enabled: z.boolean().default(true),
  base_url: z.string().url(),
  api_key: z.string(),
  timeout_ms: z.number().default(30000),
  limits: z.object({
    rpm: z.number().default(40),
    rpd: z.number().nullable().default(null),
    concurrent: z.number().default(4),
  }),
  extra_headers: z.record(z.string()).optional(),
});

export const ModelCapabilitiesSchema = z.object({
  supports_tools: z.boolean().default(false),
  supports_parallel_tools: z.boolean().default(false),
  supports_json_schema: z.boolean().default(false),
  max_context: z.number().default(128000),
  dimensions: z.number().optional(),
  thinking_budget: z.number().optional(),
  reasoning_effort: z.enum(['high', 'medium', 'low', 'none']).optional(),
});

export const ModelConfigSchema = z.object({
  id: z.string(),
  provider: z.string(),
  model_string: z.string(),
  role: z.array(z.enum(['rerank', 'prefilter', 'plan', 'embed'])),
  capabilities: ModelCapabilitiesSchema,
  livebench_hint: z.string().optional(),
  cost: z.string().default('free'),
});

export const ModelPolicyTierSchema = z.object({
  rerank: z.object({
    order_by: z.enum(['output_speed', 'intelligence']).optional(),
    min_intelligence: z.number().optional(),
    min_speed_tps: z.number().optional(),
  }),
  plan: z.object({
    order_by: z.enum(['output_speed', 'intelligence']).optional(),
  }),
});

export const ModelPolicySchema = z.object({
  fast: ModelPolicyTierSchema,
  right: ModelPolicyTierSchema,
  fallback_chain: z.array(z.string()),
  embed_model: z.string(),
  refresh_metrics_every_hours: z.number().default(24),
});

export const InferenceFileSchema = z.object({
  inference_providers: z.array(InferenceProviderConfigSchema),
  models: z.array(ModelConfigSchema),
  model_policy: ModelPolicySchema,
});

// 3. Winnow Main Pipeline Schema
export const TierConfigSchema = z.object({
  providers: z.array(z.string()),
  retrieve_count: z.number(),
  prefilter_keep: z.number(),
  fetch_enabled: z.boolean(),
  fetch_max: z.number(),
  fetch_chars_per_page: z.number().default(6000),
  rerank_mode: z.enum(['listwise', 'sliding_window', 'tool_loop']).default('listwise'),
  allow_tool_loop: z.boolean().default(false),
  tool_loop_max_rounds: z.number().default(2),
  deadline_ms: z.number(),
});

export const WinnowFileSchema = z.object({
  tiers: z.object({
    fast: TierConfigSchema,
    right: TierConfigSchema,
  }),
  stage_budgets_ms: z.object({
    plan: z.number(),
    retrieve: z.number(),
    prefilter: z.number(),
    fetch: z.number(),
    rerank: z.number(),
  }),
  blocklist: z.object({
    hard: z.array(z.string()),
    soft: z.array(z.string()),
    soft_penalty: z.number().default(15),
    score_threshold: z.number().default(25),
    max_results: z.number().default(10),
    max_per_domain: z.number().default(3),
  }),
  fusion: z.object({
    rrf_k: z.number().default(60),
  }),
  prefilter: z.object({
    weight_embedding: z.number().default(0.7),
    weight_fused: z.number().default(0.3),
    intent_truncate_tokens: z.number().default(300),
  }),
  fetch: z.object({
    user_agent: z.string(),
    respect_robots: z.boolean().default(true),
    per_page_timeout_ms: z.number().default(5000),
    max_bytes: z.number().default(2500000),
    max_redirects: z.number().default(3),
    allow_pdf: z.boolean().default(true),
    global_concurrency: z.number().default(6),
  }),
  cache: z.object({
    page_ttl_hours: z.number().default(72),
    search_ttl_minutes: z.number().default(30),
    embedding_ttl_days: z.number().default(30),
  }),
  deadline: z.object({
    skip_to_rerank_at_remaining_pct: z.number().default(20),
  }),
});

export type SearchProviderConfig = z.infer<typeof SearchProviderConfigSchema>;
export type InferenceProviderConfig = z.infer<typeof InferenceProviderConfigSchema>;
export type ModelConfig = z.infer<typeof ModelConfigSchema>;
export type ModelPolicy = z.infer<typeof ModelPolicySchema>;
export type TierConfig = z.infer<typeof TierConfigSchema>;
export type WinnowConfig = z.infer<typeof WinnowFileSchema>;
export type FullWinnowConfig = {
  providers: SearchProviderConfig[];
  inference: z.infer<typeof InferenceFileSchema>;
  winnow: WinnowConfig;
};
