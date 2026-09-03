import { createClient, Client } from '@libsql/client';
import path from 'path';
import { Trace, ProgressEvent, PageContent } from './types';

export interface CachedModelCard {
  id: string;
  provider: string;
  model_string: string;
  intelligence_index?: number;
  coding_index?: number;
  agentic_index?: number;
  openrouter_id?: string;
  context_length?: number;
  match_status: 'success' | 'fail';
  tested_latency_ms?: number;
  tested_status: 'ok' | 'fail' | 'disabled' | 'untested';
  tested_error?: string;
  capabilities_json?: string;
  status_override?: 'active' | 'outdated' | 'incompatible' | 'disabled' | null;
  updated_at: string;
}

class WinnowStore {
  private client: Client;
  private initialized: boolean = false;

  constructor() {
    const dbUrl = process.env.TURSO_DATABASE_URL || `file:${path.join(process.cwd(), 'winnow.db')}`;
    const authToken = process.env.TURSO_AUTH_TOKEN || undefined;

    this.client = createClient({
      url: dbUrl,
      authToken: authToken,
    });
  }

  private initPromise: Promise<void> | null = null;

  async init(): Promise<void> {
    if (this.initialized) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      // Initialize base tables
      await this.client.executeMultiple(`
        CREATE TABLE IF NOT EXISTS traces (
          id TEXT PRIMARY KEY,
          created_at TEXT,
          query TEXT,
          intent TEXT,
          tier TEXT,
          model_id TEXT,
          status TEXT,
          elapsed_ms INTEGER,
          prompt_version TEXT,
          results_json TEXT,
          candidates_json TEXT,
          degraded_json TEXT,
          llm_call_count INTEGER,
          cache_hit_count INTEGER,
          audit_json TEXT
        );

        CREATE TABLE IF NOT EXISTS events (
          search_id TEXT,
          seq INTEGER,
          type TEXT,
          data_json TEXT,
          at TEXT,
          PRIMARY KEY (search_id, seq)
        );

        CREATE TABLE IF NOT EXISTS page_cache (
          url_canonical TEXT PRIMARY KEY,
          fetched_at TEXT,
          status TEXT,
          extraction_method TEXT,
          char_count INTEGER,
          text TEXT
        );

        CREATE TABLE IF NOT EXISTS embed_cache (
          hash TEXT PRIMARY KEY,
          model_id TEXT,
          dims INTEGER,
          vector BLOB,
          created_at TEXT
        );

        CREATE TABLE IF NOT EXISTS model_cards (
          id TEXT PRIMARY KEY,
          provider TEXT,
          model_string TEXT,
          intelligence_index REAL,
          coding_index REAL,
          agentic_index REAL,
          openrouter_id TEXT,
          context_length INTEGER,
          match_status TEXT,
          tested_latency_ms REAL,
          tested_status TEXT,
          tested_error TEXT,
          capabilities_json TEXT,
          updated_at TEXT
        );

        CREATE TABLE IF NOT EXISTS usage (
          provider TEXT,
          utc_date TEXT,
          count INTEGER,
          PRIMARY KEY (provider, utc_date)
        );
      `);

      // Parallel column migrations
      const alterStatements = [
        `ALTER TABLE traces ADD COLUMN audit_json TEXT`,
        `ALTER TABLE model_cards ADD COLUMN model_string TEXT`,
        `ALTER TABLE model_cards ADD COLUMN intelligence_index REAL`,
        `ALTER TABLE model_cards ADD COLUMN coding_index REAL`,
        `ALTER TABLE model_cards ADD COLUMN agentic_index REAL`,
        `ALTER TABLE model_cards ADD COLUMN openrouter_id TEXT`,
        `ALTER TABLE model_cards ADD COLUMN context_length INTEGER`,
        `ALTER TABLE model_cards ADD COLUMN match_status TEXT`,
        `ALTER TABLE model_cards ADD COLUMN tested_latency_ms REAL`,
        `ALTER TABLE model_cards ADD COLUMN tested_status TEXT`,
        `ALTER TABLE model_cards ADD COLUMN tested_error TEXT`,
        `ALTER TABLE model_cards ADD COLUMN capabilities_json TEXT`,
        `ALTER TABLE model_cards ADD COLUMN status_override TEXT`,
        `ALTER TABLE model_cards ADD COLUMN updated_at TEXT`,
      ];

      await Promise.all(
        alterStatements.map((stmt) =>
          this.client.execute(stmt).catch(() => {
            // Column already exists or already migrated
          })
        )
      );

      this.initialized = true;
    })();

    return this.initPromise;
  }

  // --- Trace Operations ---
  async saveTrace(trace: Trace): Promise<void> {
    await this.init();
    await this.client.execute({
      sql: `
        INSERT INTO traces (
          id, created_at, query, intent, tier, model_id, status, elapsed_ms,
          prompt_version, results_json, candidates_json, degraded_json,
          llm_call_count, cache_hit_count, audit_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          status=excluded.status,
          elapsed_ms=excluded.elapsed_ms,
          results_json=excluded.results_json,
          candidates_json=excluded.candidates_json,
          degraded_json=excluded.degraded_json,
          llm_call_count=excluded.llm_call_count,
          cache_hit_count=excluded.cache_hit_count,
          audit_json=excluded.audit_json
      `,
      args: [
        trace.id,
        trace.created_at,
        trace.query,
        trace.intent || null,
        trace.tier,
        trace.model_id,
        trace.status,
        trace.elapsed_ms,
        trace.prompt_version,
        JSON.stringify(trace.results),
        JSON.stringify(trace.candidates),
        JSON.stringify(trace.degraded_reasons),
        trace.llm_call_count,
        trace.cache_hit_count,
        trace.audit ? JSON.stringify(trace.audit) : null,
      ],
    });
  }

  async getTrace(id: string): Promise<Trace | null> {
    await this.init();
    const rs = await this.client.execute({
      sql: 'SELECT * FROM traces WHERE id = ?',
      args: [id],
    });

    if (rs.rows.length === 0) return null;
    const row: any = rs.rows[0];

    let audit = undefined;
    if (row.audit_json) {
      try {
        audit = JSON.parse(row.audit_json);
      } catch (e) {
        console.error('[Store] Failed to parse audit_json for trace', id, e);
      }
    }

    return {
      id: row.id,
      created_at: row.created_at,
      query: row.query,
      intent: row.intent,
      tier: row.tier,
      model_id: row.model_id,
      status: row.status,
      elapsed_ms: row.elapsed_ms,
      prompt_version: row.prompt_version,
      results: JSON.parse(row.results_json || '[]'),
      candidates: JSON.parse(row.candidates_json || '[]'),
      degraded_reasons: JSON.parse(row.degraded_json || '[]'),
      llm_call_count: row.llm_call_count,
      cache_hit_count: row.cache_hit_count,
      audit,
    };
  }

  // --- Event Stream Operations ---
  async appendEvent(searchId: string, event: ProgressEvent): Promise<void> {
    await this.init();
    await this.client.execute({
      sql: `
        INSERT INTO events (search_id, seq, type, data_json, at)
        VALUES (?, ?, ?, ?, ?)
      `,
      args: [
        searchId,
        event.id,
        event.type,
        JSON.stringify(event.data),
        event.at,
      ],
    });
  }

  async getEvents(searchId: string, sinceSeq: number = 0): Promise<ProgressEvent[]> {
    await this.init();
    const rs = await this.client.execute({
      sql: `
        SELECT seq, type, data_json, at
        FROM events
        WHERE search_id = ? AND seq > ?
        ORDER BY seq ASC
      `,
      args: [searchId, sinceSeq],
    });

    return rs.rows.map((row: any) => ({
      id: row.seq,
      type: row.type,
      data: JSON.parse(row.data_json || '{}'),
      at: row.at,
    }));
  }

  async getEventsSince(searchId: string, sinceSeq: number = 0): Promise<ProgressEvent[]> {
    return this.getEvents(searchId, sinceSeq);
  }

  // --- Page Cache Operations ---
  async getPageCache(canonicalUrl: string, ttlHours = 72): Promise<PageContent | null> {
    await this.init();
    const rs = await this.client.execute({
      sql: 'SELECT * FROM page_cache WHERE url_canonical = ?',
      args: [canonicalUrl],
    });

    if (rs.rows.length === 0) return null;
    const row: any = rs.rows[0];

    const fetchedAt = new Date(row.fetched_at).getTime();
    const ageHours = (Date.now() - fetchedAt) / (1000 * 60 * 60);
    if (ageHours > ttlHours) return null;

    return {
      text: row.text,
      char_count: row.char_count,
      truncated: false,
      extraction_method: row.extraction_method,
      fetch_status: row.status,
      fetched_at: row.fetched_at,
    };
  }

  async setPageCache(canonicalUrl: string, content: PageContent): Promise<void> {
    await this.init();
    await this.client.execute({
      sql: `
        INSERT INTO page_cache (url_canonical, fetched_at, status, extraction_method, char_count, text)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(url_canonical) DO UPDATE SET
          fetched_at=excluded.fetched_at,
          status=excluded.status,
          extraction_method=excluded.extraction_method,
          char_count=excluded.char_count,
          text=excluded.text
      `,
      args: [
        canonicalUrl,
        content.fetched_at,
        content.fetch_status,
        content.extraction_method,
        content.char_count,
        content.text,
      ],
    });
  }

  // --- Model Benchmark Cache Operations (Turso DB) ---
  async getCachedModelCards(): Promise<CachedModelCard[]> {
    await this.init();
    const rs = await this.client.execute({
      sql: 'SELECT * FROM model_cards ORDER BY intelligence_index DESC',
      args: [],
    });

    return rs.rows.map((row: any) => ({
      id: row.id,
      provider: row.provider,
      model_string: row.model_string || '',
      intelligence_index: row.intelligence_index !== null && row.intelligence_index !== undefined ? Number(row.intelligence_index) : undefined,
      coding_index: row.coding_index !== null && row.coding_index !== undefined ? Number(row.coding_index) : undefined,
      agentic_index: row.agentic_index !== null && row.agentic_index !== undefined ? Number(row.agentic_index) : undefined,
      openrouter_id: row.openrouter_id || undefined,
      context_length: row.context_length !== null && row.context_length !== undefined ? Number(row.context_length) : undefined,
      match_status: row.match_status || 'fail',
      tested_latency_ms: row.tested_latency_ms !== null && row.tested_latency_ms !== undefined ? Number(row.tested_latency_ms) : undefined,
      tested_status: row.tested_status || 'untested',
      tested_error: row.tested_error || undefined,
      capabilities_json: row.capabilities_json || undefined,
      status_override: row.status_override || undefined,
      updated_at: row.updated_at || new Date().toISOString(),
    }));
  }

  async setModelStatusOverride(id: string, status: 'active' | 'outdated' | 'incompatible' | 'disabled' | null): Promise<void> {
    await this.init();
    await this.client.execute({
      sql: `
        INSERT INTO model_cards (id, status_override, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          status_override = excluded.status_override,
          updated_at = excluded.updated_at
      `,
      args: [id, status, new Date().toISOString()],
    });
  }

  async saveCachedModelCard(card: CachedModelCard): Promise<void> {
    await this.init();
    await this.client.execute({
      sql: `
        INSERT INTO model_cards (
          id, provider, model_string, intelligence_index, coding_index, agentic_index,
          openrouter_id, context_length, match_status, tested_latency_ms,
          tested_status, tested_error, capabilities_json, status_override, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          provider=coalesce(excluded.provider, model_cards.provider),
          model_string=coalesce(excluded.model_string, model_cards.model_string),
          intelligence_index=coalesce(excluded.intelligence_index, model_cards.intelligence_index),
          coding_index=coalesce(excluded.coding_index, model_cards.coding_index),
          agentic_index=coalesce(excluded.agentic_index, model_cards.agentic_index),
          openrouter_id=coalesce(excluded.openrouter_id, model_cards.openrouter_id),
          context_length=coalesce(excluded.context_length, model_cards.context_length),
          match_status=coalesce(excluded.match_status, model_cards.match_status),
          tested_latency_ms=coalesce(excluded.tested_latency_ms, model_cards.tested_latency_ms),
          tested_status=coalesce(excluded.tested_status, model_cards.tested_status),
          tested_error=excluded.tested_error,
          capabilities_json=coalesce(excluded.capabilities_json, model_cards.capabilities_json),
          status_override=coalesce(excluded.status_override, model_cards.status_override),
          updated_at=excluded.updated_at
      `,
      args: [
        card.id,
        card.provider || null,
        card.model_string || null,
        card.intelligence_index !== undefined ? card.intelligence_index : null,
        card.coding_index !== undefined ? card.coding_index : null,
        card.agentic_index !== undefined ? card.agentic_index : null,
        card.openrouter_id || null,
        card.context_length !== undefined ? card.context_length : null,
        card.match_status || null,
        card.tested_latency_ms !== undefined ? card.tested_latency_ms : null,
        card.tested_status || null,
        card.tested_error || null,
        card.capabilities_json || null,
        card.status_override || null,
        card.updated_at,
      ],
    });
  }

  async saveAllCachedModelCards(cards: CachedModelCard[]): Promise<void> {
    await this.init();
    for (const card of cards) {
      await this.saveCachedModelCard(card);
    }
  }

  // --- Usage Tracking (Daily Quotas) ---
  async incrementUsage(provider: string): Promise<number> {
    await this.init();
    const today = new Date().toISOString().split('T')[0];
    await this.client.execute({
      sql: `
        INSERT INTO usage (provider, utc_date, count)
        VALUES (?, ?, 1)
        ON CONFLICT(provider, utc_date) DO UPDATE SET count = count + 1
      `,
      args: [provider, today],
    });

    const rs = await this.client.execute({
      sql: 'SELECT count FROM usage WHERE provider = ? AND utc_date = ?',
      args: [provider, today],
    });

    return (rs.rows[0] as any)?.count || 1;
  }

  async getDailyUsage(provider: string): Promise<number> {
    await this.init();
    const today = new Date().toISOString().split('T')[0];
    const rs = await this.client.execute({
      sql: 'SELECT count FROM usage WHERE provider = ? AND utc_date = ?',
      args: [provider, today],
    });

    return (rs.rows[0] as any)?.count || 0;
  }
}

const globalForStore = globalThis as unknown as {
  winnowStore: WinnowStore | undefined;
};

export const store = globalForStore.winnowStore ?? new WinnowStore();
globalForStore.winnowStore = store;
