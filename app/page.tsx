'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { ModelBenchmarkItem } from './api/admin/models/route';

interface ActiveModelOption {
  id: string;
  label: string;
  provider: string;
  intelligenceIndex: number;
}

export default function HomePage() {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [intent, setIntent] = useState('');
  const [sliderValue, setSliderValue] = useState<number>(40);
  const [isAdvanced, setIsAdvanced] = useState(false);
  const [discreteTier, setDiscreteTier] = useState<'fast' | 'right'>('fast');
  const [manualModelOverride, setManualModelOverride] = useState<string>('auto');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Live/cached models loaded from DB & OpenRouter API
  const [modelItems, setModelItems] = useState<ModelBenchmarkItem[]>([]);

  useEffect(() => {
    fetch('/api/admin/models')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.models) {
          setModelItems(data.models);
        }
      })
      .catch((err) => console.error('Failed to load cached models', err));
  }, []);

  // Filter for dynamic slider mapping: Only active models responding with OK in <= 3 seconds (3000ms)
  const activeModels: ActiveModelOption[] = useMemo(() => {
    if (!modelItems || modelItems.length === 0) {
      return [
        { id: 'groq-gpt-20b', label: 'Groq GPT-OSS 20B (~0.3s)', provider: 'groq', intelligenceIndex: 15.2 },
        { id: 'groq-gpt-120b', label: 'Groq GPT-OSS 120B (~0.35s)', provider: 'groq', intelligenceIndex: 24.1 },
        { id: 'groq-qwen-27b', label: 'Groq Qwen 3.6 27B (~0.35s)', provider: 'groq', intelligenceIndex: 37.7 },
        { id: 'or-gemma-4-31b-free', label: 'Gemma 4 31B (Free)', provider: 'openrouter', intelligenceIndex: 29.7 },
        { id: 'or-nemotron-3-ultra-free', label: 'Nemotron 3 Ultra (Free)', provider: 'openrouter', intelligenceIndex: 38.3 },
        { id: 'or-minimax-m3-free', label: 'MiniMax M3 (Free)', provider: 'openrouter', intelligenceIndex: 45.4 },
        { id: 'or-deepseek-v4-pro', label: 'DeepSeek V4 Pro', provider: 'openrouter', intelligenceIndex: 45.3 },
        { id: 'or-gemini-3.7-flash', label: 'Google Gemini 3.7 Flash', provider: 'openrouter', intelligenceIndex: 56.0 },
      ];
    }

    return modelItems
      .filter((m) => {
        // 1. Must be in active category (not disabled, incompatible, or outdated)
        if (m.category !== 'active') return false;

        // 2. Must not have failed ping
        if (m.tested_status === 'fail') return false;

        // 3. Strict 3-second rule: Must respond with OK in <= 3000ms
        if (m.tested_latency_ms !== undefined && m.tested_latency_ms > 3000) {
          return false;
        }

        // 4. If untested, verify expected task latency is <= 3.0s
        if (m.tested_latency_ms === undefined && m.time_per_task_s > 3.0) {
          return false;
        }

        return true;
      })
      .map((m) => ({
        id: m.id,
        label: m.benchmark_hint || m.id,
        provider: m.provider,
        intelligenceIndex: m.openrouter_match.intelligence_index || 30.0,
      }));
  }, [modelItems]);

  const fastModels = useMemo(() => {
    return [...activeModels].sort((a, b) => {
      const pA = a.provider === 'groq' ? 0 : 1;
      const pB = b.provider === 'groq' ? 0 : 1;
      if (pA !== pB) return pA - pB;
      return a.intelligenceIndex - b.intelligenceIndex;
    });
  }, [activeModels]);

  const rightModels = useMemo(() => {
    return [...activeModels]
      .filter((m) => m.intelligenceIndex >= 38 || m.id.includes('high') || m.id.includes('pro') || m.id.includes('ultra'))
      .sort((a, b) => a.intelligenceIndex - b.intelligenceIndex);
  }, [activeModels]);

  // Grouped models for the Advanced Search dropdown
  const groupedModelOptions = useMemo(() => {
    if (!modelItems || modelItems.length === 0) {
      return {
        groq: activeModels.filter((m) => m.provider === 'groq'),
        gemini: activeModels.filter((m) => m.provider === 'gemini'),
        nim: activeModels.filter((m) => m.provider === 'nim'),
        openrouter: activeModels.filter((m) => m.provider === 'openrouter'),
        outdated: [] as ModelBenchmarkItem[],
      };
    }

    const groq: (ModelBenchmarkItem | ActiveModelOption)[] = [];
    const gemini: (ModelBenchmarkItem | ActiveModelOption)[] = [];
    const nim: (ModelBenchmarkItem | ActiveModelOption)[] = [];
    const openrouter: (ModelBenchmarkItem | ActiveModelOption)[] = [];
    const outdated: ModelBenchmarkItem[] = [];

    for (const m of modelItems) {
      if (m.category === 'outdated') {
        outdated.push(m);
      } else if (m.category === 'active' && m.tested_status !== 'fail') {
        if (m.provider === 'groq') groq.push(m);
        else if (m.provider === 'gemini') gemini.push(m);
        else if (m.provider === 'nim') nim.push(m);
        else if (m.provider === 'openrouter') openrouter.push(m);
      }
    }

    const sortFn = (a: any, b: any) => {
      const scoreA = a.openrouter_match?.intelligence_index ?? a.intelligenceIndex ?? 30;
      const scoreB = b.openrouter_match?.intelligence_index ?? b.intelligenceIndex ?? 30;
      return scoreB - scoreA;
    };

    groq.sort(sortFn);
    gemini.sort(sortFn);
    nim.sort(sortFn);
    openrouter.sort(sortFn);
    outdated.sort(sortFn);

    return { groq, gemini, nim, openrouter, outdated };
  }, [modelItems, activeModels]);

  // Deep research threshold: >= 75%
  const isDeep = sliderValue >= 75;

  const dynamicModel = useMemo(() => {
    if (!isDeep) {
      if (fastModels.length === 0) return activeModels[0];
      const ratio = sliderValue / 74;
      const idx = Math.min(fastModels.length - 1, Math.floor(ratio * fastModels.length));
      return fastModels[idx];
    } else {
      if (rightModels.length === 0) return activeModels[activeModels.length - 1];
      const ratio = (sliderValue - 75) / 25;
      const idx = Math.min(rightModels.length - 1, Math.floor(ratio * rightModels.length));
      return rightModels[idx];
    }
  }, [sliderValue, isDeep, fastModels, rightModels, activeModels]);

  const effectiveTier = isAdvanced ? discreteTier : (isDeep ? 'right' : 'fast');
  const effectiveModelId = isAdvanced
    ? (manualModelOverride !== 'auto' ? manualModelOverride : (discreteTier === 'right' ? 'gemini-3.7-flash-high' : 'groq-gpt-120b'))
    : (manualModelOverride !== 'auto' ? manualModelOverride : (dynamicModel?.id || 'gemini-3.7-flash'));

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!query.trim() || isSubmitting) return;

    try {
      setIsSubmitting(true);
      setErrorMsg(null);

      const res = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: query.trim(),
          intent: intent.trim() || null,
          tier: effectiveTier,
          model_override: effectiveModelId,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Search submission failed');
      }

      const data = await res.json();
      if (data.search_id) {
        router.push(`/s/${data.search_id}`);
      } else {
        throw new Error('No search_id returned');
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to start search');
      setIsSubmitting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const setExample = (q: string, i: string) => {
    setQuery(q);
    setIntent(i);
  };

  return (
    <div className="home-screen">
      {/* Top-Right Models & Ratings Button */}
      <div style={{ position: 'fixed', top: '20px', right: '24px', zIndex: 50 }}>
        <a
          href="/models"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            background: 'var(--card)',
            border: '1px solid var(--border)',
            padding: '6px 12px',
            borderRadius: 'var(--radius-lg)',
            fontSize: '12px',
            fontWeight: 500,
            color: 'var(--foreground)',
            boxShadow: 'var(--shadow-subtle)',
            transition: 'all 0.15s',
          }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="2" width="20" height="8" rx="2" ry="2"></rect>
            <rect x="2" y="14" width="20" height="8" rx="2" ry="2"></rect>
            <line x1="6" y1="6" x2="6.01" y2="6"></line>
            <line x1="6" y1="18" x2="6.01" y2="18"></line>
          </svg>
          <span>Models & Ratings</span>
        </a>
      </div>

      {/* Stylized Big Logo */}
      <h1 className="home-logo">
        Winnow
      </h1>

      {/* Centered Search Card */}
      <div className="home-search-wrapper">
        <form onSubmit={handleSubmit} className="search-box-shadcn">
          {/* Query Row */}
          <div className="search-main-line">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--muted-foreground)', flexShrink: 0 }}>
              <circle cx="11" cy="11" r="8"></circle>
              <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
            </svg>
            <input
              type="text"
              className="search-input-primary"
              placeholder="What are you looking for?"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                if (errorMsg) setErrorMsg(null);
              }}
              onKeyDown={handleKeyDown}
              autoFocus
            />
          </div>

          {/* Intent Row (Auto-flexing multi-line) */}
          <div className="intent-field-box">
            <span className="intent-label-tag">Intent</span>
            <textarea
              className="intent-textarea-auto"
              placeholder="Add your goal or constraints (e.g. lightweight code, specific libraries, benchmarks)..."
              value={intent}
              onChange={(e) => setIntent(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={2}
            />
          </div>

          {errorMsg && (
            <div style={{ color: '#ef4444', fontSize: '13px', fontWeight: 500 }}>
              {errorMsg}
            </div>
          )}

          {/* Minimalist Volume Bar with Lightning and Brain Icons (Uniform Solid Black Track) */}
          {!isAdvanced ? (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              padding: '6px 4px',
            }}>
              {/* Lightning Icon (Fast) */}
              <div
                title="Fast & Shallow"
                style={{
                  color: isDeep ? 'var(--muted-foreground)' : 'var(--foreground)',
                  display: 'flex',
                  alignItems: 'center',
                  transition: 'color 0.2s',
                }}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
                </svg>
              </div>

              {/* Volume Slider Track (Uniform Solid Black / Dark Track) */}
              <div style={{ flex: 1, position: 'relative', display: 'flex', alignItems: 'center' }}>
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  value={sliderValue}
                  onChange={(e) => setSliderValue(Number(e.target.value))}
                  style={{
                    width: '100%',
                    height: '6px',
                    borderRadius: '3px',
                    appearance: 'none',
                    outline: 'none',
                    cursor: 'pointer',
                    background: '#18181b',
                  }}
                />
              </div>

              {/* Brain Icon (Deep) */}
              <div
                title="Slow & Deep"
                style={{
                  color: isDeep ? 'var(--foreground)' : 'var(--muted-foreground)',
                  display: 'flex',
                  alignItems: 'center',
                  transition: 'color 0.2s',
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 4.44-2.04z"></path>
                  <path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-4.44-2.04z"></path>
                </svg>
              </div>
            </div>
          ) : (
            /* Advanced Mode: Discrete Buttons + Model Dropdown */
            <div
              style={{
                background: '#fafafa',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-lg)',
                padding: '10px 14px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: '10px',
                animation: 'fadeIn 0.15s ease',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                {/* Discrete Fast / Right Tier Switcher */}
                <div className="tier-segmented" style={{ padding: '2px' }}>
                  <button
                    type="button"
                    className={`tier-tab-btn ${discreteTier === 'fast' ? 'active' : ''}`}
                    onClick={() => setDiscreteTier('fast')}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
                    </svg>
                    <span>Fast</span>
                  </button>
                  <button
                    type="button"
                    className={`tier-tab-btn ${discreteTier === 'right' ? 'active' : ''}`}
                    onClick={() => setDiscreteTier('right')}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="10"></circle>
                      <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"></polygon>
                    </svg>
                    <span>Right</span>
                  </button>
                </div>

                {/* Model Picker */}
                <select
                  className="model-dropdown-select"
                  value={manualModelOverride}
                  onChange={(e) => setManualModelOverride(e.target.value)}
                  style={{ maxWidth: '280px' }}
                >
                  <option value="auto">Auto: Default for {discreteTier.toUpperCase()}</option>

                  {groupedModelOptions.groq.length > 0 && (
                    <optgroup label="Groq Ultra Speed (LPU)">
                      {groupedModelOptions.groq.map((m: any) => (
                        <option key={m.id} value={m.id}>
                          {m.benchmark_hint || m.label || m.id}
                          {m.tested_latency_ms ? ` (${m.tested_latency_ms}ms)` : ''}
                        </option>
                      ))}
                    </optgroup>
                  )}

                  {groupedModelOptions.gemini.length > 0 && (
                    <optgroup label="Google Gemini">
                      {groupedModelOptions.gemini.map((m: any) => (
                        <option key={m.id} value={m.id}>
                          {m.benchmark_hint || m.label || m.id}
                          {m.tested_latency_ms ? ` (${m.tested_latency_ms}ms)` : ''}
                        </option>
                      ))}
                    </optgroup>
                  )}

                  {groupedModelOptions.nim.length > 0 && (
                    <optgroup label="NVIDIA NIM">
                      {groupedModelOptions.nim.map((m: any) => (
                        <option key={m.id} value={m.id}>
                          {m.benchmark_hint || m.label || m.id}
                          {m.tested_latency_ms ? ` (${m.tested_latency_ms}ms)` : ''}
                        </option>
                      ))}
                    </optgroup>
                  )}

                  {groupedModelOptions.openrouter.length > 0 && (
                    <optgroup label="OpenRouter Production">
                      {groupedModelOptions.openrouter.map((m: any) => (
                        <option key={m.id} value={m.id}>
                          {m.benchmark_hint || m.label || m.id}
                          {m.tested_latency_ms ? ` (${m.tested_latency_ms}ms)` : ''}
                        </option>
                      ))}
                    </optgroup>
                  )}

                  {groupedModelOptions.outdated.length > 0 && (
                    <optgroup label="Legacy / Outdated">
                      {groupedModelOptions.outdated.map((m: any) => (
                        <option key={m.id} value={m.id}>
                          {m.benchmark_hint || m.label || m.id} (Outdated)
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>
              </div>
            </div>
          )}

          {/* Bottom Bar: Advanced Toggle Switch + Deep Research Pill + Search Button */}
          <div className="search-bottom-bar">
            {/* Clean Toggle Switch */}
            <label
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                cursor: 'pointer',
                userSelect: 'none',
              }}
            >
              {/* Custom Switch Component */}
              <div
                onClick={() => setIsAdvanced(!isAdvanced)}
                style={{
                  width: '32px',
                  height: '18px',
                  borderRadius: '9px',
                  background: isAdvanced ? '#18181b' : '#e4e4e7',
                  position: 'relative',
                  transition: 'background 0.2s ease',
                  cursor: 'pointer',
                }}
              >
                <div
                  style={{
                    width: '14px',
                    height: '14px',
                    borderRadius: '50%',
                    background: '#ffffff',
                    position: 'absolute',
                    top: '2px',
                    left: isAdvanced ? '16px' : '2px',
                    transition: 'left 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
                    boxShadow: '0 1px 2px rgba(0,0,0,0.2)',
                  }}
                />
              </div>

              <span style={{ fontSize: '12px', fontWeight: 500, color: isAdvanced ? 'var(--foreground)' : 'var(--muted-foreground)' }}>
                Advanced
              </span>
            </label>

            {/* Right Group: Deep Research Pill (Next to Search) + Submit Button */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              {/* Deep Research Pill (Next to Search Button when >= 75%) */}
              {!isAdvanced && isDeep && (
                <div
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '5px',
                    padding: '4px 10px',
                    borderRadius: 'var(--radius-full)',
                    fontSize: '11px',
                    fontWeight: 600,
                    background: '#f4f4f5',
                    color: '#09090b',
                    border: '1px solid #e4e4e7',
                    animation: 'fadeIn 0.15s ease',
                    whiteSpace: 'nowrap',
                  }}
                >
                  <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#18181b', display: 'inline-block' }} />
                  <span>Deep Research</span>
                </div>
              )}

              {/* Submit Button */}
              <button
                type="submit"
                className="btn-search-submit"
                disabled={isSubmitting}
              >
                <span>{isSubmitting ? 'Searching...' : 'Search'}</span>
                {!isSubmitting && (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="5" y1="12" x2="19" y2="12"></line>
                    <polyline points="12 5 19 12 12 19"></polyline>
                  </svg>
                )}
              </button>
            </div>
          </div>
        </form>

        {/* Suggestion Chips */}
        <div className="home-suggestions">
          <button
            type="button"
            className="suggestion-chip"
            onClick={() => setExample(
              'DeepSeek V4 vs Nemotron 3 Ultra architecture and benchmark comparisons',
              'technical evaluation, parameter counts, latency benchmarks, and MoE routing details'
            )}
          >
            DeepSeek V4 vs Nemotron 3
          </button>
          <button
            type="button"
            className="suggestion-chip"
            onClick={() => setExample(
              'Next.js 16 Server Actions best practices and mutations',
              'production code examples, optimistic updates, and cache revalidation'
            )}
          >
            Next.js 16 Server Actions
          </button>
          <button
            type="button"
            className="suggestion-chip"
            onClick={() => setExample(
              'Cerebras CS-3 wafer scale engine throughput vs Nvidia B200',
              'wafer scale specs, token generation latency, and real world benchmarks'
            )}
          >
            Cerebras CS-3 vs NVIDIA B200
          </button>
        </div>
      </div>
    </div>
  );
}
