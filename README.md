# WINNOW (Personal Search Engine)

**Winnow** is an intent-aware personal search engine and metasearch pipeline built in **100% TypeScript / JavaScript** for high performance and zero-ceremony deployment on **Vercel** and local environments.

---

## Key Features

- **Intent-Driven Reranking**: Re-orders candidate search results based on your stated intent (*"the same query with different intent produces completely different results"*).
- **Zero Python / 100% JS/TS**: Low memory footprint, fast cold starts, native streaming via Web Streams & Server-Sent Events (SSE).
- **Config-Driven Modularity**: Add or modify search providers (`Serper`, `Tavily`, `SerpApi`) and inference providers (`Groq`, `Cerebras`, `Google Gemini`, `NVIDIA NIM`, `OpenRouter`) via YAML files without writing TypeScript code.
- **Dynamic Speed vs Depth Slider**: Seamless volume-bar control transitioning from Ultra-Speed (`Cerebras`, `Groq`) to Deep Research (`Gemini 3.7 Flash High`, `DeepSeek V4 Pro`, `Nemotron 3 Ultra`).
- **LiveBench Leaderboard Integration**: Contamination-free open benchmark intelligence scoring with automated local DB caching.
- **Multi-Provider Fallback Resilience**: Automated failover across providers if rate limits or network issues arise.
- **Two Tier Modes**:
  - **Fast Mode** (~1-4s): Rapid snippet evaluation with cosine prefiltering and listwise LLM reranking.
  - **Right Mode** (~10-20s): Full webpage reading with Mozilla Readability, SSRF guards, robots.txt compliance, and deep content analysis.
- **The Winnow Rail**: Real-time progress visualization showing candidate flow through each pipeline stage (`24 -> 14 -> 10`).
- **Provisional Interim Results**: Displays initial prefilter ordering in < 2s while LLM reranking completes.
- **Prompt Injection Defense**: Defense-in-depth sanitization that penalizes and drops prompt injection payloads.
- **Universal Storage Layer**: Seamlessly uses local SQLite (`file:winnow.db`) locally or remote cloud **Turso** (`@libsql/client`) in production on Vercel.

---

## Configuration (`config/`)

- **[config/providers.yaml](file:///d:/Codez/AI/Search/config/providers.yaml)**: Declarative search provider configurations.
- **[config/inference.yaml](file:///d:/Codez/AI/Search/config/inference.yaml)**: Declarative LLM endpoints, fallback chains, reasoning variants, and model capabilities.
- **[config/winnow.yaml](file:///d:/Codez/AI/Search/config/winnow.yaml)**: Tier settings, timeouts, blocklists, RRF constants, and cache TTLs.

---

## Environment Variables (`.env`)

```env
# Search Providers (At least one required)
SERPER_KEY=your_serper_key
TRAVITY_KEY=your_tavily_key
SERPAPI_KEY=your_serpapi_key

# Inference Providers (At least one required)
GROQ_KEY=your_groq_key
CEREBRAS_KEY=your_cerebras_key
GEMINI_AI_STUDIO_KEY=your_gemini_key
NVIDIA_NIM_API_KEY=your_nvidia_nim_key
OPEN_ROUTER_API_KEY=your_openrouter_key

# Remote Storage (Optional - Defaults to local SQLite file:winnow.db)
TURSO_DATABASE_URL=
TURSO_AUTH_TOKEN=
```

---

## Local Development

```bash
# 1. Install dependencies
npm install

# 2. Run startup self-check diagnostics
npx tsx scripts/run_self_check.ts

# 3. Start development server
npm run dev

# 4. Open in browser
http://localhost:3000
```

---

## Vercel Deployment

1. Push this repository to GitHub / GitLab.
2. Import the project into **Vercel**.
3. Under **Environment Variables**, add your API keys from `.env`.
4. *(Optional for persistence)*: Create a free database at [Turso](https://turso.tech) and set `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN`.
5. Deploy!
