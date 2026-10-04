'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { ModelBenchmarkItem } from './api/admin/models/route';

interface ActiveModelOption {
  id: string;
  label: string;
  provider: string;
  intelligenceIndex: number;
}

const INTENT_PRESETS = [
  'architecture comparison, parameter counts, latency benchmarks, and MoE routing details',
  'production best practices, server mutations, cache revalidation, and optimistic updates',
  'minimal lightweight implementation, zero third-party dependencies, step-by-step explanation',
  'security considerations, edge cases, and performance trade-offs',
];

export default function HomePage() {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [intent, setIntent] = useState('');
  const [sliderValue, setSliderValue] = useState<number>(40);
  const [isAdvanced, setIsAdvanced] = useState(false);
  const [discreteTier, setDiscreteTier] = useState<'rush' | 'fast' | 'right'>('fast');
  const [manualModelOverride, setManualModelOverride] = useState<string>('auto');

  // Hydrate advanced mode and slider preference from localStorage
  useEffect(() => {
    try {
      const savedAdv = localStorage.getItem('winnow_advanced_mode');
      if (savedAdv !== null) {
        setIsAdvanced(savedAdv === '1');
      }
      const savedSlider = localStorage.getItem('winnow_slider_value');
      if (savedSlider !== null && !isNaN(Number(savedSlider))) {
        setSliderValue(Math.max(0, Math.min(100, Number(savedSlider))));
      }
    } catch (e) {}
  }, []);

  const handleToggleAdvanced = () => {
    setIsAdvanced((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('winnow_advanced_mode', next ? '1' : '0');
      } catch (e) {}
      return next;
    });
  };

  const handleSliderChange = (val: number) => {
    setSliderValue(val);
    try {
      localStorage.setItem('winnow_slider_value', String(val));
    } catch (e) {}
  };
  const [isModelDropdownOpen, setIsModelDropdownOpen] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [presetIndex, setPresetIndex] = useState(0);

  const dropdownRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);

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

  // Close model popover on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsModelDropdownOpen(false);
      }
    };
    if (isModelDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isModelDropdownOpen]);

  // Clean speech recognition handler
  const handleVoiceInput = () => {
    if (typeof window === 'undefined') return;

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert('Speech recognition is not supported in this browser. Please type your query.');
      return;
    }

    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }

    try {
      const recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.lang = 'en-US';

      recognition.onstart = () => setIsListening(true);
      recognition.onresult = (event: any) => {
        const transcript = event.results[0]?.[0]?.transcript;
        if (transcript) {
          setQuery((prev) => (prev ? `${prev} ${transcript}` : transcript));
        }
      };
      recognition.onerror = (event: any) => {
        console.warn('[Speech Recognition Error]', event.error);
        setIsListening(false);
      };
      recognition.onend = () => setIsListening(false);

      recognitionRef.current = recognition;
      recognition.start();
    } catch (err) {
      console.error('Failed to start speech recognition', err);
      setIsListening(false);
    }
  };

  const handleSparkleClick = () => {
    setIntent(INTENT_PRESETS[presetIndex % INTENT_PRESETS.length]);
    setPresetIndex((prev) => prev + 1);
  };

  const handleOpenReportIssue = (e: React.MouseEvent) => {
    e.preventDefault();
    window.dispatchEvent(new CustomEvent('open-report-issue'));
  };

  // Filter for active models responding <= 3000ms
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
        if (m.category !== 'active') return false;
        if (m.tested_status === 'fail') return false;
        if (m.tested_latency_ms !== undefined && m.tested_latency_ms > 3000) return false;
        if (m.tested_latency_ms === undefined && m.time_per_task_s > 3.0) return false;
        return true;
      })
      .map((m) => ({
        id: m.id,
        label: m.benchmark_hint || m.id,
        provider: m.provider,
        intelligenceIndex: m.openrouter_match?.intelligence_index || 30.0,
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

  // Rush mode at 0%; Deep research threshold at >= 75%
  const isRush = !isAdvanced && sliderValue === 0;
  const isDeep = !isAdvanced && sliderValue >= 75;

  const dynamicModel = useMemo(() => {
    if (isRush) {
      return { id: 'none', label: 'Direct Search (0s AI overhead)', provider: 'direct', intelligenceIndex: 0 };
    }
    if (!isDeep) {
      if (fastModels.length === 0) return activeModels[0];
      const ratio = Math.max(0, (sliderValue - 1)) / 73;
      const idx = Math.min(fastModels.length - 1, Math.floor(ratio * fastModels.length));
      return fastModels[idx];
    } else {
      if (rightModels.length === 0) return activeModels[activeModels.length - 1];
      const ratio = (sliderValue - 75) / 25;
      const idx = Math.min(rightModels.length - 1, Math.floor(ratio * rightModels.length));
      return rightModels[idx];
    }
  }, [sliderValue, isRush, isDeep, fastModels, rightModels, activeModels]);

  // Grouped models for the model popover dropdown
  const groupedModelOptions = useMemo(() => {
    if (!modelItems || modelItems.length === 0) {
      return {
        groq: activeModels.filter((m) => m.provider === 'groq'),
        gemini: activeModels.filter((m) => m.provider === 'gemini'),
        nim: activeModels.filter((m) => m.provider === 'nim'),
        openrouter: activeModels.filter((m) => m.provider === 'openrouter'),
      };
    }

    const groq: any[] = [];
    const gemini: any[] = [];
    const nim: any[] = [];
    const openrouter: any[] = [];

    for (const m of modelItems) {
      if (m.category === 'active' && m.tested_status !== 'fail') {
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

    return { groq, gemini, nim, openrouter };
  }, [modelItems, activeModels]);

  const selectedModelLabel = useMemo(() => {
    if (manualModelOverride === 'auto') return 'Default';
    const foundItem = modelItems.find((m) => m.id === manualModelOverride);
    if (foundItem) return foundItem.benchmark_hint || foundItem.id;
    const foundActive = activeModels.find((m) => m.id === manualModelOverride);
    if (foundActive) return foundActive.label;
    return manualModelOverride;
  }, [manualModelOverride, modelItems, activeModels]);

  const effectiveTier = isAdvanced ? discreteTier : (isRush ? 'rush' : isDeep ? 'right' : 'fast');
  const effectiveModelId = isAdvanced
    ? (manualModelOverride !== 'auto' ? manualModelOverride : (discreteTier === 'right' ? 'gemini-3.7-flash-high' : discreteTier === 'rush' ? 'none' : 'groq-gpt-120b'))
    : (manualModelOverride !== 'auto' ? manualModelOverride : (dynamicModel?.id || 'gemini-3.7-flash'));

  const handleSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!query.trim()) return;

    setErrorMsg(null);
    setIsSubmitting(true);

    // Instant 0ms navigation: Generate client searchId and push route immediately
    const searchId = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : `s_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const targetUrl = `/s/${searchId}?q=${encodeURIComponent(query.trim())}${intent.trim() ? `&intent=${encodeURIComponent(intent.trim())}` : ''}&tier=${effectiveTier}&adv=${isAdvanced ? '1' : '0'}&slider=${sliderValue}${isAdvanced && manualModelOverride && manualModelOverride !== 'auto' ? `&m=${encodeURIComponent(manualModelOverride)}` : ''}`;

    // Dispatch search orchestrator in parallel before triggering client navigation
    fetch('/api/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      keepalive: true,
      body: JSON.stringify({
        search_id: searchId,
        query: query.trim(),
        intent: intent.trim() || null,
        tier: effectiveTier,
        model_override: effectiveModelId,
      }),
    }).catch((err) => {
      console.error('[Search Submit Background Error]', err);
    });

    // Navigate immediately
    router.push(targetUrl);
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
      {/* Top-Right Header Links: Models & Ratings and Report Issue */}
      <nav className="home-top-nav">
        <a href="/models" className="home-nav-link">
          Models & Ratings
        </a>
        <button
          type="button"
          onClick={handleOpenReportIssue}
          className="home-nav-link"
        >
          Report Issue
        </button>
      </nav>

      {/* Centered Main Winnow Logo */}
      <h1 className="home-logo">
        Winnow
      </h1>

      {/* Unified Search Pill Container */}
      <div className="home-search-wrapper">
        <form onSubmit={handleSubmit} className="search-pill-bar">
          {/* Magnifying Glass Search Icon */}
          <svg
            className="search-pill-search-icon"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#18181b"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ flexShrink: 0, marginLeft: '2px' }}
          >
            <circle cx="11" cy="11" r="8"></circle>
            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
          </svg>

          {/* Primary Query Input */}
          <input
            type="text"
            className="search-pill-query-input"
            placeholder="What are you looking for?"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              if (errorMsg) setErrorMsg(null);
            }}
            onKeyDown={handleKeyDown}
            autoFocus
          />

          {/* Thin Vertical Divider Line */}
          <div className="search-pill-divider" />

          {/* Inner Intent Capsule */}
          <div className="search-pill-intent-capsule">
            <input
              type="text"
              className="search-pill-intent-input"
              placeholder="Add your intent or constraints..."
              value={intent}
              onChange={(e) => setIntent(e.target.value)}
              onKeyDown={handleKeyDown}
            />
            {/* Sparkle / Magic Wand Icon Button */}
            <button
              type="button"
              className="search-pill-sparkle-btn"
              title="Cycle smart intent suggestions"
              onClick={handleSparkleClick}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#18181b"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72Z" />
                <path d="m14 7 3 3" />
                <path d="M5 6v4" />
                <path d="M19 14v4" />
                <path d="M10 2v2" />
                <path d="M7 8H3" />
                <path d="M21 16h-4" />
                <path d="M11 3H9" />
              </svg>
            </button>
          </div>

          {/* Black Microphone Icon Button */}
          <button
            type="button"
            className={`search-pill-mic-btn ${isListening ? 'listening' : ''}`}
            onClick={handleVoiceInput}
            title={isListening ? 'Listening... click to stop' : 'Search by voice'}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#18181b"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" y1="19" x2="12" y2="22" />
            </svg>
          </button>

          {/* Blue Circular Submit Button with Right Arrow */}
          <button
            type="submit"
            className="search-pill-submit-btn"
            disabled={isSubmitting}
            title="Search"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#ffffff"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="5" y1="12" x2="19" y2="12"></line>
              <polyline points="12 5 19 12 12 19"></polyline>
            </svg>
          </button>
        </form>

        {errorMsg && (
          <div style={{ color: '#ef4444', fontSize: '13px', fontWeight: 500, textAlign: 'center', marginTop: '10px' }}>
            {errorMsg}
          </div>
        )}

        {/* Suggested Search Chips */}
        <div className="home-suggestions-row">
          <button
            type="button"
            className="home-suggestion-pill"
            onClick={() => setExample(
              'DeepSeek V4 vs Nemotron 3',
              'architecture comparison, parameter counts, latency benchmarks, and MoE routing details'
            )}
          >
            DeepSeek V4 vs Nemotron 3
          </button>
          <button
            type="button"
            className="home-suggestion-pill"
            onClick={() => setExample(
              'Next.js 16 Server Actions',
              'production best practices, server mutations, cache revalidation, and optimistic updates'
            )}
          >
            Next.js 16 Server Actions
          </button>
        </div>

        {/* Bottom Controls Row: Advanced Toggle | Model Dropdown | Segmented Tier Pill */}
        <div className="home-controls-row">
          {/* Advanced Blue Toggle Switch */}
          <label className="home-switch-label" onClick={handleToggleAdvanced}>
            <div
              className="home-switch-track"
              style={{
                background: isAdvanced ? '#2563eb' : '#e4e4e7',
              }}
            >
              <div
                className="home-switch-knob"
                style={{
                  left: isAdvanced ? '18px' : '2px',
                }}
              />
            </div>
            <span className="home-switch-text">Advanced</span>
          </label>

          {/* When Advanced is OFF: Show Slider Container with Lightning & Brain & Dynamic Badges */}
          {!isAdvanced ? (
            <div className="home-slider-container">
              {/* Lightning Icon (Fast) */}
              <div
                title="Fast & Shallow"
                style={{
                  color: isDeep ? '#a1a1aa' : '#18181b',
                  display: 'flex',
                  alignItems: 'center',
                  transition: 'color 0.2s',
                }}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
                </svg>
              </div>

              {/* Range Slider Track */}
              <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  value={sliderValue}
                  onChange={(e) => handleSliderChange(Number(e.target.value))}
                  className="home-volume-slider"
                />
              </div>

              {/* Brain Icon (Deep) */}
              <div
                title="Slow & Deep"
                style={{
                  color: isDeep ? '#18181b' : '#a1a1aa',
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

              {/* Badges placed in absolutely positioned slot to avoid any slider layout shift */}
              <div className="home-slider-badge-slot">
                {isRush && (
                  <div className="home-mode-pill rush">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
                    </svg>
                    <span>Rush (Instant)</span>
                  </div>
                )}

                {isDeep && (
                  <div className="home-mode-pill deep">
                    <span className="dot" />
                    <span>Deep Research</span>
                  </div>
                )}
              </div>
            </div>
          ) : (
            /* When Advanced is ON: Show Model Picker + Discrete Tier Buttons */
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
              {/* Model Selection Button & Popover */}
              <div style={{ position: 'relative' }} ref={dropdownRef}>
                <button
                  type="button"
                  className="home-model-btn"
                  onClick={() => setIsModelDropdownOpen(!isModelDropdownOpen)}
                  aria-expanded={isModelDropdownOpen}
                >
                  <span>Model: {selectedModelLabel}</span>
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    style={{
                      transition: 'transform 0.15s ease',
                      transform: isModelDropdownOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                    }}
                  >
                    <polyline points="6 9 12 15 18 9"></polyline>
                  </svg>
                </button>

                {/* Floating Model Popover Card */}
                {isModelDropdownOpen && (
                  <div className="home-model-popover">
                    <button
                      type="button"
                      className={`home-model-item ${manualModelOverride === 'auto' ? 'active' : ''}`}
                      onClick={() => {
                        setManualModelOverride('auto');
                        setIsModelDropdownOpen(false);
                      }}
                    >
                      <span>Auto (Default for {discreteTier.toUpperCase()})</span>
                      {manualModelOverride === 'auto' && <span>✓</span>}
                    </button>

                    {groupedModelOptions.groq.length > 0 && (
                      <>
                        <div className="home-model-group-title">Groq Ultra Speed (LPU)</div>
                        {groupedModelOptions.groq.map((m: any) => (
                          <button
                            key={m.id}
                            type="button"
                            className={`home-model-item ${manualModelOverride === m.id ? 'active' : ''}`}
                            onClick={() => {
                              setManualModelOverride(m.id);
                              setIsModelDropdownOpen(false);
                            }}
                          >
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {m.benchmark_hint || m.label || m.id}
                            </span>
                            {manualModelOverride === m.id && <span>✓</span>}
                          </button>
                        ))}
                      </>
                    )}

                    {groupedModelOptions.gemini.length > 0 && (
                      <>
                        <div className="home-model-group-title">Google Gemini</div>
                        {groupedModelOptions.gemini.map((m: any) => (
                          <button
                            key={m.id}
                            type="button"
                            className={`home-model-item ${manualModelOverride === m.id ? 'active' : ''}`}
                            onClick={() => {
                              setManualModelOverride(m.id);
                              setIsModelDropdownOpen(false);
                            }}
                          >
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {m.benchmark_hint || m.label || m.id}
                            </span>
                            {manualModelOverride === m.id && <span>✓</span>}
                          </button>
                        ))}
                      </>
                    )}

                    {groupedModelOptions.nim.length > 0 && (
                      <>
                        <div className="home-model-group-title">NVIDIA NIM</div>
                        {groupedModelOptions.nim.map((m: any) => (
                          <button
                            key={m.id}
                            type="button"
                            className={`home-model-item ${manualModelOverride === m.id ? 'active' : ''}`}
                            onClick={() => {
                              setManualModelOverride(m.id);
                              setIsModelDropdownOpen(false);
                            }}
                          >
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {m.benchmark_hint || m.label || m.id}
                            </span>
                            {manualModelOverride === m.id && <span>✓</span>}
                          </button>
                        ))}
                      </>
                    )}

                    {groupedModelOptions.openrouter.length > 0 && (
                      <>
                        <div className="home-model-group-title">OpenRouter</div>
                        {groupedModelOptions.openrouter.map((m: any) => (
                          <button
                            key={m.id}
                            type="button"
                            className={`home-model-item ${manualModelOverride === m.id ? 'active' : ''}`}
                            onClick={() => {
                              setManualModelOverride(m.id);
                              setIsModelDropdownOpen(false);
                            }}
                          >
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {m.benchmark_hint || m.label || m.id}
                            </span>
                            {manualModelOverride === m.id && <span>✓</span>}
                          </button>
                        ))}
                      </>
                    )}
                  </div>
                )}
              </div>

              {/* Segmented Pill Container: ⚡ Rush | ⚡ Fast | 🎯 Right */}
              <div className="home-tier-pill">
                <button
                  type="button"
                  className={`home-tier-btn ${discreteTier === 'rush' ? 'active' : ''}`}
                  onClick={() => setDiscreteTier('rush')}
                >
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
                  </svg>
                  <span>Rush</span>
                </button>

                <div className="home-tier-divider" />

                <button
                  type="button"
                  className={`home-tier-btn ${discreteTier === 'fast' ? 'active' : ''}`}
                  onClick={() => setDiscreteTier('fast')}
                >
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
                  </svg>
                  <span>Fast</span>
                </button>

                <div className="home-tier-divider" />

                <button
                  type="button"
                  className={`home-tier-btn ${discreteTier === 'right' ? 'active' : ''}`}
                  onClick={() => setDiscreteTier('right')}
                >
                  <svg
                    width="13"
                    height="13"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <circle cx="12" cy="12" r="10"></circle>
                    <circle cx="12" cy="12" r="6"></circle>
                    <circle cx="12" cy="12" r="2"></circle>
                  </svg>
                  <span>Right</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

