import dns from 'dns/promises';
import { Candidate, PageContent } from '../types';
import { FullWinnowConfig } from '../config/models';
import { AsyncSemaphore } from '../limits';
import { isPrivateOrReservedIp, canonicalizeUrl, extractDomain } from '../urls';
import { extractContent } from '../extract';
import { store } from '../store';

const robotsCache = new Map<string, string>();

async function isAllowedByRobots(domain: string, userAgent: string): Promise<boolean> {
  // Simple robots check: fail-open
  try {
    if (robotsCache.has(domain)) {
      const robots = robotsCache.get(domain)!;
      if (robots.includes(`User-agent: *\nDisallow: /`)) return false;
      return true;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(`https://${domain}/robots.txt`, { signal: controller.signal });
    clearTimeout(timer);

    if (res.ok) {
      const text = await res.text();
      robotsCache.set(domain, text);
      if (text.includes(`User-agent: *\nDisallow: /`)) return false;
    }
  } catch {
    // Fail-open
  }
  return true;
}

export interface FetchOptions {
  candidates: Candidate[];
  config: FullWinnowConfig;
  tierName: 'fast' | 'right';
  stageBudgetMs?: number;
  onProgress?: (done: number, total: number, ok: number, failed: number) => void;
}

export interface FetchOutput {
  candidates: Candidate[];
  okCount: number;
  failedCount: number;
  fromCacheCount: number;
}

export async function stageFetch(options: FetchOptions): Promise<FetchOutput> {
  const { candidates, config, tierName, stageBudgetMs = 12000, onProgress } = options;
  const tierConfig = config.winnow.tiers[tierName];

  // If fetching is disabled for this tier, skip immediately (Section 6.4)
  if (!tierConfig.fetch_enabled || tierConfig.fetch_max === 0) {
    return {
      candidates,
      okCount: 0,
      failedCount: 0,
      fromCacheCount: 0,
    };
  }

  const fetchConfig = config.winnow.fetch;
  const activeCandidates = candidates.filter((c) => !c.dropped_at_stage);
  const toFetch = activeCandidates.slice(0, tierConfig.fetch_max);

  const semaphore = new AsyncSemaphore(fetchConfig.global_concurrency);

  let okCount = 0;
  let failedCount = 0;
  let fromCacheCount = 0;
  let completed = 0;

  const deadlineTimer = Date.now() + stageBudgetMs;

  const fetchTasks = toFetch.map(async (candidate) => {
    const release = await semaphore.acquire();
    try {
      // 1. Check Stage Deadline
      if (Date.now() > deadlineTimer) {
        candidate.content = null;
        failedCount++;
        return;
      }

      // 2. Check SQLite Page Cache (Section 12.2)
      const cached = await store.getPageCache(candidate.url, config.winnow.cache.page_ttl_hours);
      if (cached) {
        candidate.content = cached;
        fromCacheCount++;
        okCount++;
        return;
      }

      const domain = extractDomain(candidate.raw_url);

      // 3. SSRF Guard (Section 6.4)
      try {
        const u = new URL(candidate.raw_url);
        if (!['http:', 'https:'].includes(u.protocol)) {
          throw new Error('Unsupported protocol');
        }
        const ips = await dns.resolve4(u.hostname).catch(() => []);
        if (ips.some((ip) => isPrivateOrReservedIp(ip))) {
          throw new Error('SSRF IP blocked');
        }
      } catch (err: any) {
        candidate.content = {
          text: '',
          char_count: 0,
          truncated: false,
          extraction_method: 'snippet_only',
          fetch_status: 'blocked',
          fetched_at: new Date().toISOString(),
        };
        failedCount++;
        return;
      }

      // 4. Robots.txt Check
      if (fetchConfig.respect_robots) {
        const allowed = await isAllowedByRobots(domain, fetchConfig.user_agent);
        if (!allowed) {
          candidate.content = {
            text: '',
            char_count: 0,
            truncated: false,
            extraction_method: 'snippet_only',
            fetch_status: 'robots_denied',
            fetched_at: new Date().toISOString(),
          };
          failedCount++;
          return;
        }
      }

      // 5. Fetch Page HTML
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), fetchConfig.per_page_timeout_ms);

      const res = await fetch(candidate.raw_url, {
        headers: {
          'User-Agent': fetchConfig.user_agent,
          Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
        },
        signal: controller.signal,
        redirect: 'follow',
      });
      clearTimeout(timer);

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('text/html') && !contentType.includes('text/plain')) {
        candidate.content = {
          text: '',
          char_count: 0,
          truncated: false,
          extraction_method: 'snippet_only',
          fetch_status: 'unsupported',
          fetched_at: new Date().toISOString(),
        };
        okCount++;
        return;
      }

      const html = await res.text();

      // 6. Extraction Chain (Readability -> Cheerio -> snippet)
      const extracted = extractContent(html, tierConfig.fetch_chars_per_page);

      const pageContent: PageContent = {
        text: extracted.text,
        char_count: extracted.charCount,
        truncated: extracted.truncated,
        extraction_method: extracted.method,
        fetch_status: 'ok',
        fetched_at: new Date().toISOString(),
      };

      candidate.content = pageContent;
      okCount++;

      // Cache to SQLite
      if (extracted.text) {
        await store.setPageCache(candidate.url, pageContent);
      }
    } catch (err: any) {
      candidate.content = {
        text: '',
        char_count: 0,
        truncated: false,
        extraction_method: 'snippet_only',
        fetch_status: err.name === 'AbortError' ? 'timeout' : 'http_error',
        fetched_at: new Date().toISOString(),
      };
      failedCount++;
    } finally {
      completed++;
      if (onProgress) {
        onProgress(completed, toFetch.length, okCount, failedCount);
      }
      release();
    }
  });

  await Promise.all(fetchTasks);

  return {
    candidates,
    okCount,
    failedCount,
    fromCacheCount,
  };
}
