import { SearchProviderConfig } from '../config/models';
import { resolvePath } from '../config/paths';
import { RawResult } from '../types';
import { getProviderRateLimiter, getProviderSemaphore } from '../limits';
import { store } from '../store';

export class HttpSearchAdapter {
  private config: SearchProviderConfig;

  constructor(config: SearchProviderConfig) {
    this.config = config;
  }

  get name(): string {
    return this.config.name;
  }

  get weight(): number {
    return this.config.weight;
  }

  get isEnabled(): boolean {
    return this.config.enabled;
  }

  async search(query: string, count = 20): Promise<RawResult[]> {
    if (!this.config.enabled) return [];

    // 1. Rate limiting & Semaphore
    const rateLimiter = getProviderRateLimiter(this.config.name, this.config.limits.rpm);
    const semaphore = getProviderSemaphore(this.config.name, this.config.limits.concurrent);

    await rateLimiter.acquire();
    const release = await semaphore.acquire();

    try {
      // 2. Track daily usage
      await store.incrementUsage(this.config.name);

      // 3. Build request
      const effectiveCount = Math.min(count, this.config.limits.max_count);
      const { method, url, auth, params, static_params, headers, timeout_ms } = this.config.request;

      // Map canonical parameters
      const mappedParams: Record<string, any> = { ...static_params };
      if (params.query) mappedParams[params.query] = query;
      if (params.count) mappedParams[params.count] = effectiveCount;

      const reqHeaders: Record<string, string> = {
        ...headers,
      };

      let reqUrl = url;
      let reqBody: any = undefined;

      // Authentication handling
      if (auth.style === 'header') {
        reqHeaders[auth.name] = auth.value;
      } else if (auth.style === 'bearer') {
        reqHeaders['Authorization'] = `Bearer ${auth.value}`;
      } else if (auth.style === 'query') {
        mappedParams[auth.name] = auth.value;
      } else if (auth.style === 'body') {
        mappedParams[auth.name] = auth.value;
      }

      // Method handling
      if (method === 'GET') {
        const queryParams = new URLSearchParams();
        for (const [k, v] of Object.entries(mappedParams)) {
          if (v !== undefined && v !== null) {
            queryParams.append(k, String(v));
          }
        }
        const qs = queryParams.toString();
        if (qs) {
          reqUrl += (reqUrl.includes('?') ? '&' : '?') + qs;
        }
      } else if (method === 'POST') {
        reqBody = JSON.stringify(mappedParams);
        if (!reqHeaders['Content-Type']) {
          reqHeaders['Content-Type'] = 'application/json';
        }
      }

      // 4. Execute HTTP fetch with timeout
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout_ms);

      let res: Response;
      try {
        res = await fetch(reqUrl, {
          method,
          headers: reqHeaders,
          body: reqBody,
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }

      if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        throw new Error(`Search provider "${this.name}" returned HTTP ${res.status}: ${errBody}`);
      }

      const resJson = await res.json();

      // 5. Parse response using dotted path resolver
      const resultsArray = resolvePath(resJson, this.config.response.results_path);
      if (!Array.isArray(resultsArray)) {
        console.warn(`[${this.name}] Results path "${this.config.response.results_path}" did not resolve to an array:`, resJson);
        return [];
      }

      const { title, snippet, url: urlPath, published_at, site_name } = this.config.response.fields;

      return resultsArray.map((item: any, idx: number) => {
        const rTitle = resolvePath(item, title) || 'Untitled';
        const rSnippet = resolvePath(item, snippet) || '';
        const rUrl = resolvePath(item, urlPath) || '';
        const rPublishedAt = published_at ? resolvePath(item, published_at) : null;
        const rSiteName = site_name ? resolvePath(item, site_name) : null;

        return {
          provider: this.name,
          rank: idx + 1,
          title: String(rTitle),
          snippet: String(rSnippet),
          url: String(rUrl),
          raw_url: String(rUrl),
          published_at: rPublishedAt ? String(rPublishedAt) : null,
          site_name: rSiteName ? String(rSiteName) : null,
          raw: item,
        };
      });
    } finally {
      release();
    }
  }
}
