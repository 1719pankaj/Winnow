'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { RankedResult, Candidate, StageAuditData, TokenUsage } from '@/lib/types';
import { ModelBenchmarkItem } from '@/app/api/admin/models/route';

type ActiveViewTab = '0_plan' | '1_retrieve' | '2_prefilter' | '3_fetch' | '4_rerank' | '5_result';

// Lightweight types for streamed data
interface StreamedCandidate {
  id: string; url: string; domain: string; title: string; snippet: string;
  sources: { provider: string; rank: number }[]; fused_score: number; published_at: string | null;
}

interface PrefilterEval {
  id: string; url: string; domain: string; title: string; snippet: string;
  prefilter_score: number; fused_score: number; action: string;
  drop_reason: string | null; dropped_at_stage: string | null;
}

interface FetchedPage {
  id: string; url: string; domain: string; title: string;
  fetch_status: string; extraction_method: string; char_count: number;
  truncated: boolean; text_preview: string;
}

interface RerankEval {
  id: string; domain: string; title: string; url: string;
  final_score: number; verdict: string; rationale: string;
}

interface RerankInference {
  model_id: string; parse_ladder_rung?: string;
  system_prompt?: string; user_prompt?: string; raw_response?: string;
  evaluations: RerankEval[];
  usage?: TokenUsage;
}

function Favicon({ domain, size = 16 }: { domain: string; size?: number }) {
  return (
    <img
      src={`https://www.google.com/s2/favicons?domain=${domain}&sz=${size}`}
      alt=""
      width={size}
      height={size}
      style={{ borderRadius: '2px', flexShrink: 0 }}
      loading="lazy"
    />
  );
}

function XmlPromptViewer({ rawText }: { rawText: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(rawText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const renderFormattedLines = () => {
    return rawText.split('\n').map((line, idx) => {
      const trimmed = line.trim();

      // 1. Candidate opening tag: <candidate id="..." original_rank="..." domain="...">
      if (trimmed.startsWith('<candidate')) {
        const parts = line.split(/(<candidate|\/?>|[a-zA-Z_]+="[^"]*")/g).filter(Boolean);
        return (
          <div key={idx} className="xml-line">
            <span className="xml-line-num">{idx + 1}</span>
            <span className="xml-line-content">
              {parts.map((p, pi) => {
                if (p === '<candidate' || p === '>' || p === '/>') {
                  return <span key={pi} style={{ color: '#38bdf8', fontWeight: 600 }}>{p}</span>;
                }
                if (p.includes('=')) {
                  const eqIdx = p.indexOf('=');
                  const attr = p.slice(0, eqIdx);
                  const val = p.slice(eqIdx + 1);
                  return (
                    <span key={pi}>
                      <span style={{ color: '#fbbf24' }}>{attr}</span>
                      <span style={{ color: '#94a3b8' }}>=</span>
                      <span style={{ color: '#34d399' }}>{val}</span>
                    </span>
                  );
                }
                return <span key={pi}>{p}</span>;
              })}
            </span>
          </div>
        );
      }

      // 2. Candidate closing tag: </candidate>
      if (trimmed === '</candidate>') {
        return (
          <div key={idx} className="xml-line">
            <span className="xml-line-num">{idx + 1}</span>
            <span className="xml-line-content">
              <span style={{ color: '#38bdf8', fontWeight: 600 }}>{'</candidate>'}</span>
            </span>
          </div>
        );
      }

      // 3. Known key prefixes like QUERY:, INTENT:, TITLE:, SNIPPET:, CONTENT:, CONTENT_UNAVAILABLE:
      const fieldMatch = line.match(/^(\s*)(QUERY|INTENT|TITLE|SNIPPET|CONTENT|CONTENT_UNAVAILABLE|URL|RANK):(.*)$/);
      if (fieldMatch) {
        const [, indent, label, rest] = fieldMatch;
        const labelColors: Record<string, string> = {
          QUERY: '#f43f5e',
          INTENT: '#ec4899',
          TITLE: '#60a5fa',
          SNIPPET: '#94a3b8',
          CONTENT: '#a78bfa',
          CONTENT_UNAVAILABLE: '#eab308',
          URL: '#38bdf8',
          RANK: '#fbbf24',
        };
        return (
          <div key={idx} className="xml-line">
            <span className="xml-line-num">{idx + 1}</span>
            <span className="xml-line-content">
              {indent}
              <span style={{ color: labelColors[label] || '#38bdf8', fontWeight: 700, marginRight: '6px' }}>{label}:</span>
              <span style={{ color: label === 'QUERY' ? '#ffffff' : label === 'INTENT' ? '#f1f5f9' : '#e4e4e7' }}>{rest}</span>
            </span>
          </div>
        );
      }

      // 4. Instructions / Header commentary
      if (trimmed.startsWith('CANDIDATES') || trimmed.startsWith('SYSTEM:')) {
        return (
          <div key={idx} className="xml-line">
            <span className="xml-line-num">{idx + 1}</span>
            <span className="xml-line-content">
              <span style={{ color: '#a1a1aa', fontStyle: 'italic', fontWeight: 500 }}>{line}</span>
            </span>
          </div>
        );
      }

      // 5. Generic lines
      return (
        <div key={idx} className="xml-line">
          <span className="xml-line-num">{idx + 1}</span>
          <span className="xml-line-content" style={{ color: '#cbd5e1' }}>{line || ' '}</span>
        </div>
      );
    });
  };

  const lineCount = rawText.split('\n').length;

  return (
    <div className="xml-viewer-container">
      <div className="xml-viewer-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span className="xml-badge-tag">&lt;/&gt; XML PROMPT</span>
          <span style={{ fontSize: '11px', color: '#a1a1aa', fontFamily: 'var(--font-mono, monospace)' }}>
            Candidate XML Context Fed to Model
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '10px', color: '#71717a', fontFamily: 'monospace' }}>
            {lineCount} lines · {(rawText.length / 1024).toFixed(1)} KB
          </span>
          <button type="button" onClick={handleCopy} className="xml-copy-btn">
            {copied ? '✓ Copied' : 'Copy XML'}
          </button>
        </div>
      </div>
      <div className="xml-viewer-body">
        {renderFormattedLines()}
      </div>
    </div>
  );
}

function RawResponseViewer({ rawText, modelId, isStreaming }: { rawText: string; modelId?: string; isStreaming?: boolean }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(rawText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const lineCount = rawText.split('\n').length;

  return (
    <div className="xml-viewer-container">
      <div className="xml-viewer-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span className="xml-badge-tag" style={{ background: 'rgba(34, 197, 94, 0.12)', color: '#22c55e', borderColor: 'rgba(34, 197, 94, 0.3)' }}>
            RAW RESPONSE
          </span>
          {isStreaming && (
            <span className="xml-badge-tag" style={{ background: 'rgba(56, 189, 248, 0.15)', color: '#38bdf8', borderColor: 'rgba(56, 189, 248, 0.4)' }}>
              ● STREAMING
            </span>
          )}
          <span style={{ fontSize: '11px', color: '#a1a1aa', fontFamily: 'var(--font-mono, monospace)' }}>
            {modelId ? `Inference from ${modelId}` : 'Raw LLM Model Output'}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '10px', color: '#71717a', fontFamily: 'monospace' }}>
            {lineCount} lines · {(rawText.length / 1024).toFixed(1)} KB
          </span>
          <button type="button" onClick={handleCopy} className="xml-copy-btn">
            {copied ? '✓ Copied' : 'Copy'}
          </button>
        </div>
      </div>
      <div className="xml-viewer-body" style={{ maxHeight: '420px' }}>
        <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'inherit', color: '#e4e4e7' }}>
          {rawText}
          {isStreaming && <span style={{ display: 'inline-block', width: '8px', height: '13px', background: '#38bdf8', marginLeft: '3px', verticalAlign: 'middle', opacity: 0.8 }} />}
        </pre>
      </div>
    </div>
  );
}

export default function RunPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const searchId = params.id as string;

  const urlQ = searchParams?.get('q') || '';
  const urlIntent = searchParams?.get('intent') || '';
  const rawTier = searchParams?.get('tier');
  const urlTier = (rawTier === 'rush' ? 'rush' : rawTier === 'right' ? 'right' : 'fast') as 'rush' | 'fast' | 'right';
  const urlModel = searchParams?.get('m') || '';
  const urlAdv = searchParams?.get('adv');
  const urlSlider = searchParams?.get('slider');

  // Search Metadata (hydrated immediately on frame 0)
  const [query, setQuery] = useState(urlQ);
  const [intent, setIntent] = useState<string | null>(urlIntent || null);
  const [tier, setTier] = useState<'rush' | 'fast' | 'right'>(urlTier);
  const [modelId, setModelId] = useState<string>(urlModel);
  const [interpretation, setInterpretation] = useState<string | null>(null);

  // New Search Inputs & Header Controls
  const [newQuery, setNewQuery] = useState(urlQ);
  const [newIntent, setNewIntent] = useState(urlIntent);
  const [newTier, setNewTier] = useState<'rush' | 'fast' | 'right'>(urlTier);
  const [sliderValue, setSliderValue] = useState<number>(() => {
    if (urlSlider !== null && urlSlider !== undefined && !isNaN(Number(urlSlider))) {
      return Math.max(0, Math.min(100, Number(urlSlider)));
    }
    if (urlTier === 'rush') return 0;
    if (urlTier === 'right') return 85;
    return 40;
  });
  const [isAdvanced, setIsAdvanced] = useState<boolean>(() => {
    if (urlAdv !== null && urlAdv !== undefined) {
      return urlAdv === '1';
    }
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('winnow_advanced_mode');
        if (saved !== null) return saved === '1';
      } catch (e) {}
    }
    return Boolean(urlModel && urlModel !== 'auto');
  });
  const [manualModelOverride, setManualModelOverride] = useState<string>(urlModel || 'auto');
  const [isModelDropdownOpen, setIsModelDropdownOpen] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [presetIndex, setPresetIndex] = useState(0);

  // Sync advanced mode and slider preference with localStorage
  useEffect(() => {
    if (urlAdv === null || urlAdv === undefined) {
      try {
        const savedAdv = localStorage.getItem('winnow_advanced_mode');
        if (savedAdv !== null) {
          setIsAdvanced(savedAdv === '1');
        }
      } catch (e) {}
    }
    if (urlSlider === null || urlSlider === undefined) {
      try {
        const savedSlider = localStorage.getItem('winnow_slider_value');
        if (savedSlider !== null && !isNaN(Number(savedSlider))) {
          setSliderValue(Math.max(0, Math.min(100, Number(savedSlider))));
        }
      } catch (e) {}
    }
  }, [urlAdv, urlSlider]);

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

  // Dynamic Header Scroll Collapse state
  const [isScrolled, setIsScrolled] = useState(false);
  const [isSearchFocused, setIsSearchFocused] = useState(false);

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

  // Scroll listener for dynamic header collapse with hysteresis and RAF to eliminate jumping
  useEffect(() => {
    let ticking = false;
    let isCurrentlyScrolled = false;

    const handleScroll = () => {
      if (!ticking) {
        window.requestAnimationFrame(() => {
          const currentY = window.scrollY;

          // Wide hysteresis:
          // Collapse only when scrolled down past 90px
          // Expand only when returning near the top (< 20px)
          if (!isCurrentlyScrolled && currentY > 90) {
            isCurrentlyScrolled = true;
            setIsScrolled(true);
          } else if (isCurrentlyScrolled && currentY < 20) {
            isCurrentlyScrolled = false;
            setIsScrolled(false);
          }

          ticking = false;
        });
        ticking = true;
      }
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
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

  // Speech recognition handler
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
          setNewQuery((prev) => (prev ? `${prev} ${transcript}` : transcript));
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

  const INTENT_PRESETS = [
    'architecture comparison, parameter counts, latency benchmarks, and MoE routing details',
    'production best practices, server mutations, cache revalidation, and optimistic updates',
    'minimal lightweight implementation, zero third-party dependencies, step-by-step explanation',
    'security considerations, edge cases, and performance trade-offs',
  ];

  const handleSparkleClick = () => {
    setNewIntent(INTENT_PRESETS[presetIndex % INTENT_PRESETS.length]);
    setPresetIndex((prev) => prev + 1);
  };

  const handleOpenReportIssue = (e: React.MouseEvent) => {
    e.preventDefault();
    window.dispatchEvent(new CustomEvent('open-report-issue'));
  };

  // Filter for active models responding <= 3000ms
  const activeModels = useMemo(() => {
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

  const effectiveTier = isAdvanced ? newTier : (isRush ? 'rush' : isDeep ? 'right' : 'fast');
  const effectiveModelId = isAdvanced
    ? (manualModelOverride !== 'auto' ? manualModelOverride : (newTier === 'right' ? 'gemini-3.7-flash-high' : newTier === 'rush' ? 'none' : 'groq-gpt-120b'))
    : (manualModelOverride !== 'auto' ? manualModelOverride : (dynamicModel?.id || 'gemini-3.7-flash'));

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

  // Status & Stages
  const [searchStatus, setSearchStatus] = useState<'connecting' | 'running' | 'provisional' | 'final' | 'error'>('connecting');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [elapsedMs, setElapsedMs] = useState<number>(0);

  // Active Tab
  const [activeTab, setActiveTab] = useState<ActiveViewTab>('5_result');

  // Results & Chaff
  const [results, setResults] = useState<RankedResult[]>([]);
  const [chaff, setChaff] = useState<Candidate[]>([]);
  const [showChaff, setShowChaff] = useState(false);

  // Audit Data & Deliberation
  const [audit, setAudit] = useState<StageAuditData>({ deliberation_log: [] });

  // Rich Streamed Data
  const [streamedCandidates, setStreamedCandidates] = useState<StreamedCandidate[]>([]);
  const [prefilterEvals, setPrefilterEvals] = useState<PrefilterEval[]>([]);
  const [fetchedPages, setFetchedPages] = useState<FetchedPage[]>([]);
  const [rerankInference, setRerankInference] = useState<RerankInference | null>(null);
  const [isRerankStreaming, setIsRerankStreaming] = useState(false);
  const [tokenUsage, setTokenUsage] = useState<TokenUsage | null>(null);
  const [expandedFetchIds, setExpandedFetchIds] = useState<Set<string>>(new Set());

  // Stage Progress
  const [stageCounts, setStageCounts] = useState<Record<string, { count?: number; status: 'pending' | 'active' | 'done' | 'skipped' }>>({
    plan: { status: 'pending' },
    retrieve: { status: 'pending' },
    prefilter: { status: 'pending' },
    fetch: { status: 'pending' },
    rerank: { status: 'pending' },
    result: { status: 'pending' },
  });

  const lastEventIdRef = useRef<number>(0);
  const logEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [audit.deliberation_log?.length]);

  // Sync state to global window for instant 10/10 issue diagnostic capture
  useEffect(() => {
    if (typeof window !== 'undefined') {
      (window as any).__winnow_current_search__ = {
        searchId,
        query: query || newQuery,
        intent: intent || newIntent,
        tier: tier || effectiveTier,
        modelId,
        searchStatus,
        errorMessage,
        activeTab,
        resultsCount: results.length,
        candidatesCount: streamedCandidates.length,
        deliberationLogCount: audit.deliberation_log?.length || 0,
      };
    }
  }, [searchId, query, newQuery, intent, newIntent, tier, effectiveTier, modelId, searchStatus, errorMessage, activeTab, results.length, streamedCandidates.length, audit.deliberation_log?.length]);

  const handleNewSearch = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!newQuery.trim()) return;

    const newId = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : `s_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const targetUrl = `/s/${newId}?q=${encodeURIComponent(newQuery.trim())}${newIntent.trim() ? `&intent=${encodeURIComponent(newIntent.trim())}` : ''}&tier=${effectiveTier}&adv=${isAdvanced ? '1' : '0'}&slider=${sliderValue}${isAdvanced && manualModelOverride && manualModelOverride !== 'auto' ? `&m=${encodeURIComponent(manualModelOverride)}` : ''}`;

    router.push(targetUrl);

    fetch('/api/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      keepalive: true,
      body: JSON.stringify({
        search_id: newId,
        query: newQuery.trim(),
        intent: newIntent.trim() || undefined,
        tier: effectiveTier,
        model_override: effectiveModelId,
      }),
    }).catch(console.error);
  };

  useEffect(() => {
    if (!searchId) return;
    let isSubscribed = true;

    // Reset all state for new search ID
    lastEventIdRef.current = 0;
    setResults([]);
    setChaff([]);
    setStreamedCandidates([]);
    setPrefilterEvals([]);
    setFetchedPages([]);
    setRerankInference(null);
    setIsRerankStreaming(false);
    setTokenUsage(null);
    setAudit({ deliberation_log: [] });
    setSearchStatus('connecting');
    setErrorMessage(null);
    setElapsedMs(0);
    setStageCounts({
      plan: { status: 'pending' },
      retrieve: { status: 'pending' },
      prefilter: { status: 'pending' },
      fetch: { status: 'pending' },
      rerank: { status: 'pending' },
      result: { status: 'pending' },
    });

    const hydrateFromTrace = (trace: any) => {
      if (!trace) return;
      if (trace.query) { setQuery(trace.query); setNewQuery(trace.query); }
      if (trace.intent !== undefined) { setIntent(trace.intent); setNewIntent(trace.intent || ''); }
      if (trace.tier) { setTier(trace.tier); setNewTier(trace.tier); }
      if (trace.model_id) setModelId(trace.model_id);
      if (trace.elapsed_ms) setElapsedMs(trace.elapsed_ms);
      if (trace.audit) setAudit(trace.audit);
      if (trace.token_usage) setTokenUsage(trace.token_usage);

      if (trace.status === 'running') {
        setSearchStatus((prev) => (prev === 'final' ? 'final' : 'running'));
      } else if (trace.status === 'failed') {
        setSearchStatus('error');
        setErrorMessage(trace.degraded_reasons?.[0]?.detail || 'Search execution failed');
      }

      if (trace.candidates && trace.candidates.length > 0) {
        setStreamedCandidates((prev) => (prev.length > 0 ? prev : trace.candidates.map((c: any) => ({
          id: c.id,
          url: c.url,
          domain: c.domain,
          title: c.title,
          snippet: c.snippet,
          sources: c.sources || [],
          fused_score: c.fused_score || 0,
          published_at: c.published_at || null,
        }))));

        setPrefilterEvals((prev) => {
          if (prev.length > 0) return prev;
          if (trace.audit?.prefilter?.evaluations) {
            return trace.audit.prefilter.evaluations.map((ev: any) => ({
              id: ev.id,
              url: ev.url || '',
              domain: ev.domain,
              title: ev.title,
              snippet: ev.snippet || '',
              prefilter_score: ev.prefilter_score || 0,
              fused_score: ev.fused_score || 0,
              action: ev.action?.includes('Drop') ? 'Drop' : 'Keep',
              drop_reason: ev.drop_reason || (ev.action?.includes('Drop') ? ev.action : null),
              dropped_at_stage: ev.dropped_at_stage || null,
            }));
          }
          return trace.candidates.map((c: any) => ({
            id: c.id,
            url: c.url,
            domain: c.domain,
            title: c.title,
            snippet: c.snippet,
            prefilter_score: c.prefilter_score || 0,
            fused_score: c.fused_score || 0,
            action: c.dropped_at_stage ? 'Drop' : 'Keep',
            drop_reason: c.drop_reason || null,
            dropped_at_stage: c.dropped_at_stage || null,
          }));
        });

        setFetchedPages((prev) => {
          if (prev.length > 0) return prev;
          const withContent = trace.candidates.filter((c: any) => c.content);
          return withContent.map((c: any) => ({
            id: c.id,
            url: c.url,
            domain: c.domain,
            title: c.title,
            fetch_status: c.content.fetch_status,
            extraction_method: c.content.extraction_method,
            char_count: c.content.char_count,
            truncated: c.content.truncated,
            text_preview: c.content.text?.slice(0, 2000) || '',
          }));
        });
      }

      if (trace.audit?.rerank) {
        setRerankInference((prev) => {
          if (prev) return prev;
          return {
            model_id: trace.model_id,
            parse_ladder_rung: trace.audit.rerank.parse_ladder_rung,
            system_prompt: trace.audit.rerank.system_prompt,
            user_prompt: trace.audit.rerank.user_prompt,
            raw_response: trace.audit.rerank.raw_response,
            evaluations: trace.audit.rerank.evaluations?.map((ev: any) => ({
              id: ev.id,
              domain: ev.domain,
              title: ev.title || '',
              url: ev.url || '',
              final_score: ev.score ?? ev.final_score ?? 0,
              verdict: ev.verdict || 'keep',
              rationale: ev.rationale || '',
            })) || [],
          };
        });
      }

      if (trace.status === 'completed') {
        setResults(trace.results || []);
        const dropped = (trace.candidates || []).filter((c: Candidate) => c.dropped_at_stage);
        setChaff(dropped);
        setSearchStatus('final');
        setStageCounts({
          plan: { status: trace.intent ? 'done' : 'skipped', count: trace.audit?.plan?.queries?.length },
          retrieve: { status: 'done', count: trace.candidates?.length },
          prefilter: { status: 'done', count: trace.audit?.prefilter?.kept_count },
          fetch: { status: trace.tier === 'right' ? 'done' : 'skipped', count: trace.audit?.fetch?.ok },
          rerank: { status: 'done', count: trace.results?.length },
          result: { status: 'done', count: trace.results?.length },
        });
      }
    };

    // 1. Initial hydration from trace endpoint
    fetch(`/api/trace/${searchId}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((trace) => {
        if (!isSubscribed) return;
        if (trace) {
          hydrateFromTrace(trace);
        } else if (urlQ) {
          // Fallback bootstrap if trace doesn't exist yet
          fetch('/api/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              search_id: searchId,
              query: urlQ,
              intent: urlIntent || null,
              tier: urlTier,
              model_override: urlModel || undefined,
            }),
          }).catch(() => {});
        }
      }).catch(() => {});

    // 2. Open SSE stream with query params as fallback
    const sseParams = new URLSearchParams({
      lastEventId: String(lastEventIdRef.current),
      ...(urlQ ? { q: urlQ } : {}),
      ...(urlTier ? { tier: urlTier } : {}),
      ...(urlIntent ? { intent: urlIntent } : {}),
      ...(urlModel ? { m: urlModel } : {}),
    });
    const eventSource = new EventSource(`/api/search/${searchId}/events?${sseParams.toString()}`);

    // Fallback polling interval in case SSE stream is blocked by mobile proxy/network
    const pollInterval = setInterval(() => {
      if (!isSubscribed) return;
      fetch(`/api/trace/${searchId}`)
        .then((res) => (res.ok ? res.json() : null))
        .then((trace) => {
          if (!isSubscribed || !trace) return;
          hydrateFromTrace(trace);
          if (trace.status === 'completed' || trace.status === 'failed') {
            clearInterval(pollInterval);
            try { eventSource.close(); } catch {}
          }
        })
        .catch(() => {});
    }, 3000);

    // Timeout guard: If still connecting after 30 seconds with no data
    const timeoutTimer = setTimeout(() => {
      if (!isSubscribed) return;
      setSearchStatus((prev) => {
        if (prev === 'connecting') {
          setErrorMessage('Search request timed out waiting for server response. Please try again.');
          return 'error';
        }
        return prev;
      });
    }, 30000);

    eventSource.onerror = (err) => {
      console.warn('[SSE] EventSource connection retry or error:', err);
      // Trigger immediate trace poll on SSE glitch
      fetch(`/api/trace/${searchId}`)
        .then((res) => (res.ok ? res.json() : null))
        .then((trace) => {
          if (!isSubscribed || !trace) return;
          hydrateFromTrace(trace);
          if (trace.status === 'completed' || trace.status === 'failed') {
            try { eventSource.close(); } catch {}
            clearInterval(pollInterval);
          }
        })
        .catch(() => {});
    };

    const handleEvent = (type: string, dataStr: string, idStr?: string) => {
      if (!isSubscribed) return;
      if (idStr) lastEventIdRef.current = parseInt(idStr, 10) || lastEventIdRef.current;
      let data: any = {};
      try { data = JSON.parse(dataStr); } catch { return; }

      switch (type) {
        case 'search_started':
          setQuery(data.query || ''); setNewQuery(data.query || '');
          setIntent(data.intent || null); setNewIntent(data.intent || '');
          setTier(data.tier || 'fast'); setNewTier(data.tier || 'fast');
          setModelId(data.model_id || ''); setSearchStatus('running');
          break;
        case 'deliberation':
          setAudit((prev) => ({ ...prev, deliberation_log: [...(prev.deliberation_log || []), data] }));
          break;
        case 'stage_started':
          setStageCounts((prev) => ({ ...prev, [data.stage]: { ...prev[data.stage], status: 'active' } }));
          break;
        case 'stage_skipped':
          setStageCounts((prev) => ({ ...prev, [data.stage]: { ...prev[data.stage], status: 'skipped' } }));
          break;
        case 'plan_token':
          if (data.token) {
            setAudit((prev) => ({
              ...prev,
              plan: {
                ...(prev.plan || { queries: [], interpretation: '', avoid_domains: [] }),
                raw_response: ((prev.plan?.raw_response || '') + data.token),
              },
            }));
          }
          break;
        case 'plan_done':
          setInterpretation(data.interpretation);
          setAudit((prev) => ({ ...prev, plan: { queries: data.queries, interpretation: data.interpretation, avoid_domains: [] } }));
          setStageCounts((prev) => ({ ...prev, plan: { status: 'done', count: data.queries?.length } }));
          break;
        case 'retrieve_done':
          setStageCounts((prev) => ({ ...prev, retrieve: { status: 'done', count: data.unique_count || data.raw_count } }));
          break;
        case 'retrieve_candidates':
          if (data.candidates) setStreamedCandidates(data.candidates);
          break;
        case 'prefilter_done':
          setStageCounts((prev) => ({ ...prev, prefilter: { status: 'done', count: data.kept } }));
          break;
        case 'prefilter_evaluations':
          if (data.evaluations) setPrefilterEvals(data.evaluations);
          break;
        case 'interim_results':
          if (data.results && Array.isArray(data.results)) {
            setResults(data.results);
            setSearchStatus((prev) => (prev === 'final' ? 'final' : 'provisional'));
          }
          break;
        case 'fetch_done':
          setStageCounts((prev) => ({ ...prev, fetch: { status: 'done', count: data.ok } }));
          break;
        case 'fetch_content':
          if (data.pages) setFetchedPages(data.pages);
          break;
        case 'rerank_token':
          setIsRerankStreaming(true);
          if (data.token) {
            setRerankInference((prev) => ({
              model_id: data.model_id || prev?.model_id || modelId,
              parse_ladder_rung: prev?.parse_ladder_rung,
              system_prompt: prev?.system_prompt,
              user_prompt: prev?.user_prompt,
              evaluations: prev?.evaluations || [],
              raw_response: (prev?.raw_response || '') + data.token,
            }));
          }
          break;
        case 'rerank_done':
          setIsRerankStreaming(false);
          setStageCounts((prev) => ({ ...prev, rerank: { status: 'done', count: data.kept } }));
          break;
        case 'rerank_inference':
          setIsRerankStreaming(false);
          setRerankInference(data);
          if (data.usage) {
            setTokenUsage((prev) => prev ? {
              prompt_tokens: (prev.prompt_tokens || 0) + (data.usage.prompt_tokens || 0),
              completion_tokens: (prev.completion_tokens || 0) + (data.usage.completion_tokens || 0),
              total_tokens: (prev.total_tokens || 0) + (data.usage.total_tokens || 0),
            } : data.usage);
          }
          break;
        case 'results':
          if (data.results) {
            setResults(data.results);
            setSearchStatus('final');
            setStageCounts((prev) => ({ ...prev, result: { status: 'done', count: data.results.length } }));
          }
          break;
        case 'done':
          setIsRerankStreaming(false);
          if (data.token_usage) setTokenUsage(data.token_usage);
          setElapsedMs(data.elapsed_ms || 0);
          setSearchStatus('final');
          fetch(`/api/trace/${searchId}`)
            .then((r) => r.json())
            .then((t) => {
              if (t) hydrateFromTrace(t);
            }).catch(() => {});
          try { eventSource.close(); } catch {}
          clearInterval(pollInterval);
          break;
        case 'error':
          setIsRerankStreaming(false);
          setErrorMessage(data.message || 'An error occurred');
          setSearchStatus('error');
          try { eventSource.close(); } catch {}
          clearInterval(pollInterval);
          break;
      }
    };

    const eventTypes = [
      'search_started', 'deliberation', 'stage_started', 'stage_skipped',
      'plan_token', 'plan_done', 'provider_returned', 'provider_error', 'retrieve_done', 'retrieve_candidates',
      'prefilter_started', 'prefilter_done', 'prefilter_evaluations', 'interim_results',
      'fetch_started', 'fetch_progress', 'fetch_done', 'fetch_content',
      'rerank_started', 'rerank_token', 'rerank_done', 'rerank_inference', 'degraded', 'results', 'done', 'error',
    ];
    eventTypes.forEach((type) => {
      eventSource.addEventListener(type, (e: MessageEvent) => handleEvent(type, e.data, e.lastEventId));
    });

    return () => {
      isSubscribed = false;
      try { eventSource.close(); } catch {}
      clearInterval(pollInterval);
      clearTimeout(timeoutTimer);
    };
  }, [searchId]);

  const isLive = searchStatus === 'running' || searchStatus === 'provisional';

  return (
    <div>
      {/* Sticky Header with Dynamic Scroll Collapse */}
      <header className={`results-header-sticky ${isScrolled ? 'is-scrolled' : ''}`}>
        <div className="results-header-container">
          <div className="results-header-top-row">
            {/* Brand Logo */}
            <div className="results-header-brand-bar">
              <a href="/" className="header-brand-link" title="Return to Winnow home">
                <span>Winnow</span>
              </a>
            </div>

            {/* Unified Pill Search Bar (Identical to Home Screen) */}
            <div className="results-search-pill-wrapper">
              <form onSubmit={handleNewSearch} className="search-pill-bar">
                {/* Search Magnifying Glass Icon */}
                <svg
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

                {/* Query Input */}
                <input
                  type="text"
                  className="search-pill-query-input"
                  placeholder="What are you looking for?"
                  value={newQuery}
                  onChange={(e) => setNewQuery(e.target.value)}
                  onFocus={() => setIsSearchFocused(true)}
                  onBlur={() => setTimeout(() => setIsSearchFocused(false), 200)}
                />

                {/* Thin Vertical Divider */}
                <div className="search-pill-divider" />

                {/* Inner Intent Capsule */}
                <div className="search-pill-intent-capsule">
                  <input
                    type="text"
                    className="search-pill-intent-input"
                    placeholder="Add your intent or constraints..."
                    value={newIntent}
                    onChange={(e) => setNewIntent(e.target.value)}
                    onFocus={() => setIsSearchFocused(true)}
                    onBlur={() => setTimeout(() => setIsSearchFocused(false), 200)}
                  />
                  {/* Sparkle Magic Wand Button */}
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
            </div>

            {/* Right Header Navigation: Models & Ratings and Report Issue */}
            <div className="results-top-nav-links desktop-only">
              <a href="/models" className="results-nav-link">
                Models & Ratings
              </a>
              <button
                type="button"
                onClick={handleOpenReportIssue}
                className="results-nav-link"
              >
                Report Issue
              </button>
            </div>
          </div>

          {/* Dynamically Collapsible Controls Row (Slides & Fades out when Scrolled) */}
          <div className={`results-header-controls-row ${(!isSearchFocused && isScrolled) ? 'collapsed' : ''}`}>
            {/* Advanced Toggle Switch */}
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

            {/* Normal Mode: Volume Slider */}
            {!isAdvanced ? (
              <div className="home-slider-container">
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

                {/* Absolutely positioned non-shifting badge slot */}
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
              /* Advanced Mode: Model Dropdown + Tier Segmented Pill */
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
                {/* Model Button & Popover */}
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
                        <span>Auto (Default for {newTier.toUpperCase()})</span>
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
                    className={`home-tier-btn ${newTier === 'rush' ? 'active' : ''}`}
                    onClick={() => setNewTier('rush')}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
                    </svg>
                    <span>Rush</span>
                  </button>

                  <div className="home-tier-divider" />

                  <button
                    type="button"
                    className={`home-tier-btn ${newTier === 'fast' ? 'active' : ''}`}
                    onClick={() => setNewTier('fast')}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
                    </svg>
                    <span>Fast</span>
                  </button>

                  <div className="home-tier-divider" />

                  <button
                    type="button"
                    className={`home-tier-btn ${newTier === 'right' ? 'active' : ''}`}
                    onClick={() => setNewTier('right')}
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
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
      </header>

      {/* Main Layout */}
      <div className="results-layout">
        {/* Left Rail */}
        <aside>
          <div className="pipeline-rail">
            <div className="pipeline-rail-title">
              Pipeline Progress
              {isLive && <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#0284c7', display: 'inline-block', marginLeft: '8px', animation: 'pulse 1.5s infinite' }} />}
            </div>

            {[
              { key: '0_plan' as ActiveViewTab, label: '0. Plan', stage: 'plan' },
              { key: '1_retrieve' as ActiveViewTab, label: '1. Retrieve', stage: 'retrieve' },
              { key: '2_prefilter' as ActiveViewTab, label: '2. Prefilter', stage: 'prefilter' },
              { key: '3_fetch' as ActiveViewTab, label: '3. Fetch & Read', stage: 'fetch' },
              { key: '4_rerank' as ActiveViewTab, label: '4. Rerank', stage: 'rerank' },
            ].map(({ key, label, stage }) => {
              const state = stageCounts[stage];
              const isSelected = activeTab === key;
              const isActive = state?.status === 'active';
              const isDone = state?.status === 'done';

              return (
                <button key={key} type="button" className={`rail-stage-item ${isSelected ? 'selected' : ''} ${isActive ? 'active-live' : ''}`} onClick={() => setActiveTab(key)}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {isDone ? (
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                    ) : isActive ? (
                      <svg className="spin-animate" style={{ animation: 'spin 0.8s linear infinite' }} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#0284c7" strokeWidth="2.5"><path d="M21 12a9 9 0 1 1-6.219-8.56"></path></svg>
                    ) : (
                      <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: '#d4d4d8' }} />
                    )}
                    <span>{label}</span>
                  </div>
                  {state?.count !== undefined && <span className="stage-badge-count">{state.count}</span>}
                </button>
              );
            })}

            <div className="rail-divider" />

            <button type="button" className={`rail-stage-item ${activeTab === '5_result' ? 'selected' : ''}`} onClick={() => setActiveTab('5_result')} style={{ fontWeight: 600 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>
                <span>5. Ranked Results</span>
              </div>
              <span className="stage-badge-count" style={{ background: 'var(--primary)', color: 'var(--primary-foreground)' }}>{results.length}</span>
            </button>
          </div>
        </aside>

        {/* Main Content */}
        <main>
          {/* Deliberation Log (Inspected only in audit tabs, never on the clean results screen) */}
          {activeTab !== '5_result' && audit.deliberation_log && audit.deliberation_log.length > 0 && (
            <div className="delib-card">
              <div className="delib-card-head">
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  <span className="delib-pulse-dot" style={{ background: searchStatus === 'final' ? '#22c55e' : searchStatus === 'error' ? '#ef4444' : '#38bdf8' }} />
                  <span>Pipeline Deliberation Log</span>
                </div>
                <span>{searchStatus === 'final' ? 'Completed' : searchStatus === 'error' ? 'Failed' : searchStatus === 'connecting' ? 'Connecting...' : 'Streaming...'}</span>
              </div>
              <div className="delib-scroll-box">
                {audit.deliberation_log?.map((item, idx) => (
                  <div key={idx}>
                    <span className="delib-item-stage">[{item.stage.toUpperCase()}]</span>
                    <span>{item.message}</span>
                  </div>
                ))}
                <div ref={logEndRef} />
              </div>
            </div>
          )}

          {/* ===================== TAB 0: PLAN ===================== */}
          {activeTab === '0_plan' && (
            <div className="audit-details-card">
              <div className="audit-stage-headline">
                <div className="audit-stage-title">Stage 0: Query Planner</div>
                <span className="meta-chip">Intent Decomposition</span>
              </div>
              <div style={{ marginBottom: '16px' }}>
                <strong style={{ fontSize: '13px' }}>Formulated Queries:</strong>
                <ul style={{ marginTop: '8px', paddingLeft: '20px', fontSize: '13px', color: '#3f3f46' }}>
                  {audit.plan?.queries?.map((q, idx) => (
                    <li key={idx} style={{ marginBottom: '4px' }}>{idx === 0 ? `(Original) "${q}"` : `(Expanded) "${q}"`}</li>
                  )) || <li>Verbatim query used</li>}
                </ul>
              </div>
              <div style={{ marginBottom: '16px' }}>
                <strong style={{ fontSize: '13px' }}>Interpretation:</strong>
                <div style={{ marginTop: '4px', fontSize: '13px', color: '#0284c7' }}>{audit.plan?.interpretation || 'Standard verbatim search.'}</div>
              </div>
              {audit.plan?.system_prompt && (
                <div><strong style={{ fontSize: '13px' }}>System Prompt:</strong><pre className="code-pre-box">{audit.plan.system_prompt}</pre></div>
              )}
              {audit.plan?.raw_response && (
                <div style={{ marginTop: '16px' }}><strong style={{ fontSize: '13px' }}>Raw LLM Output:</strong><pre className="code-pre-box">{audit.plan.raw_response}</pre></div>
              )}
            </div>
          )}

          {/* ===================== TAB 1: RETRIEVE ===================== */}
          {activeTab === '1_retrieve' && (
            <div className="audit-details-card">
              <div className="audit-stage-headline">
                <div className="audit-stage-title">Stage 1: Retrieved Sites</div>
                <span className="meta-chip">{streamedCandidates.length} candidates from {audit.retrieve?.provider_hits?.length || '?'} providers</span>
              </div>

              {/* Provider breakdown */}
              {audit.retrieve?.provider_hits && audit.retrieve.provider_hits.length > 0 && (
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '16px' }}>
                  {audit.retrieve.provider_hits.map((p, idx) => (
                    <div key={idx} style={{ background: '#f4f4f5', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '8px 12px', fontSize: '11px' }}>
                      <span style={{ fontWeight: 700, textTransform: 'uppercase' }}>{p.provider}</span>
                      <span style={{ color: 'var(--muted-foreground)', marginLeft: '6px' }}>{p.count} hits · {p.elapsed_ms}ms</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Full candidate table */}
              <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', overflowX: 'auto', WebkitOverflowScrolling: 'touch', maxWidth: '100%' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                  <thead>
                    <tr style={{ background: 'var(--muted)', borderBottom: '1px solid var(--border)' }}>
                      <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600, color: 'var(--muted-foreground)' }}>SITE</th>
                      <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600, color: 'var(--muted-foreground)', width: '120px' }}>PROVIDERS</th>
                      <th style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 600, color: 'var(--muted-foreground)', width: '80px' }}>RRF SCORE</th>
                    </tr>
                  </thead>
                  <tbody>
                    {streamedCandidates.map((c) => (
                      <tr key={c.id} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: '10px 12px' }}>
                          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                            <Favicon domain={c.domain} />
                            <div style={{ minWidth: 0 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <span style={{ fontWeight: 600, color: 'var(--foreground)', fontSize: '13px' }}>{c.domain}</span>
                              </div>
                              <a href={c.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: '13px', color: '#0369a1', fontWeight: 500, textDecoration: 'none' }}>{c.title}</a>
                              <p style={{ fontSize: '11px', color: 'var(--muted-foreground)', marginTop: '2px', lineHeight: '1.4', overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as any }}>{c.snippet}</p>
                            </div>
                          </div>
                        </td>
                        <td style={{ padding: '10px 12px', verticalAlign: 'top' }}>
                          <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                            {c.sources.map((s, si) => (
                              <span key={si} style={{ padding: '1px 5px', borderRadius: 'var(--radius-sm)', fontSize: '9px', fontWeight: 700, background: '#f0f0f0', border: '1px solid #e0e0e0', textTransform: 'uppercase' }}>{s.provider}</span>
                            ))}
                          </div>
                        </td>
                        <td style={{ padding: '10px 12px', textAlign: 'right', verticalAlign: 'top' }}>
                          <span className="mono" style={{ fontWeight: 700, fontSize: '12px', color: '#0284c7' }}>{c.fused_score.toFixed(4)}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {streamedCandidates.length === 0 && (
                  <div style={{ padding: '32px', textAlign: 'center', color: 'var(--muted-foreground)', fontSize: '13px' }}>
                    {isLive ? 'Waiting for providers to return results...' : 'No candidates retrieved.'}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ===================== TAB 2: PREFILTER ===================== */}
          {activeTab === '2_prefilter' && (
            <div className="audit-details-card">
              <div className="audit-stage-headline">
                <div className="audit-stage-title">Stage 2: Prefilter Gate</div>
                <span className="meta-chip">Semantic + Blocklist Filtering</span>
              </div>

              {/* Summary bar */}
              {prefilterEvals.length > 0 && (
                <div style={{ display: 'flex', gap: '12px', marginBottom: '16px' }}>
                  <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 'var(--radius-md)', padding: '8px 14px', fontSize: '12px', fontWeight: 600, color: '#166534' }}>
                    ✓ Kept: {prefilterEvals.filter((e) => e.action === 'Keep').length}
                  </div>
                  <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 'var(--radius-md)', padding: '8px 14px', fontSize: '12px', fontWeight: 600, color: '#991b1b' }}>
                    ✗ Dropped: {prefilterEvals.filter((e) => e.action !== 'Keep').length}
                  </div>
                </div>
              )}

              {/* Kept candidates */}
              {prefilterEvals.filter((e) => e.action === 'Keep').length > 0 && (
                <div style={{ marginBottom: '20px' }}>
                  <div style={{ fontSize: '12px', fontWeight: 700, color: '#166534', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>✓ Passed ({prefilterEvals.filter((e) => e.action === 'Keep').length})</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    {prefilterEvals.filter((e) => e.action === 'Keep').map((ev) => (
                      <div key={ev.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', background: '#fafffe', border: '1px solid #dcfce7', borderRadius: 'var(--radius-md)', fontSize: '12px', minWidth: 0 }}>
                        <Favicon domain={ev.domain} />
                        <span style={{ fontWeight: 600, maxWidth: '120px', minWidth: '70px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ev.domain}</span>
                        <span style={{ flex: 1, minWidth: 0, color: '#3f3f46', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ev.title}</span>
                        <span className="mono" style={{ fontSize: '11px', color: '#16a34a', fontWeight: 600, flexShrink: 0 }}>cos: {ev.prefilter_score.toFixed(3)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Dropped candidates */}
              {prefilterEvals.filter((e) => e.action !== 'Keep').length > 0 && (
                <div>
                  <div style={{ fontSize: '12px', fontWeight: 700, color: '#991b1b', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>✗ Blocked ({prefilterEvals.filter((e) => e.action !== 'Keep').length})</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    {prefilterEvals.filter((e) => e.action !== 'Keep').map((ev) => (
                      <div key={ev.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', background: '#fffbfb', border: '1px solid #fecaca', borderRadius: 'var(--radius-md)', fontSize: '12px', minWidth: 0 }}>
                        <Favicon domain={ev.domain} />
                        <span style={{ fontWeight: 600, maxWidth: '120px', minWidth: '70px', opacity: 0.7, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ev.domain}</span>
                        <span style={{ flex: 1, minWidth: 0, color: '#71717a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textDecoration: 'line-through' }}>{ev.title}</span>
                        <span style={{ padding: '1px 6px', borderRadius: 'var(--radius-sm)', fontSize: '10px', fontWeight: 700, background: '#fee2e2', color: '#991b1b', flexShrink: 0 }}>{ev.drop_reason || 'filtered'}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {prefilterEvals.length === 0 && (
                <div style={{ padding: '32px', textAlign: 'center', color: 'var(--muted-foreground)', fontSize: '13px' }}>
                  {isLive ? 'Prefilter evaluations pending...' : 'No prefilter data available.'}
                </div>
              )}
            </div>
          )}

          {/* ===================== TAB 3: FETCH & READ ===================== */}
          {activeTab === '3_fetch' && (
            <div className="audit-details-card">
              <div className="audit-stage-headline">
                <div className="audit-stage-title">Stage 3: Fetched Page Content</div>
                <span className="meta-chip">{fetchedPages.length > 0 ? `${fetchedPages.length} pages extracted` : tier === 'fast' ? 'Snippet Mode' : 'DOM Parsing'}</span>
              </div>

              {tier === 'fast' && fetchedPages.length === 0 && (
                <div>
                  <div style={{ background: '#fefce8', border: '1px solid #fef08a', borderRadius: 'var(--radius-lg)', padding: '14px 18px', fontSize: '13px', color: '#854d0e', marginBottom: '16px' }}>
                    <strong>Fast Tier:</strong> Full-page scraping is bypassed for low latency (&lt;3s). The candidate snippets below were ingested and passed into the listwise LLM reranker. (Switch to <strong>Right</strong> tier for full DOM readability extraction).
                  </div>

                  <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--foreground)', marginBottom: '10px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    Ingested Candidate Snippets ({streamedCandidates.length})
                  </div>

                  {streamedCandidates.map((c) => {
                    const isExpanded = expandedFetchIds.has(c.id);
                    return (
                      <div key={c.id} style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', marginBottom: '10px', overflow: 'hidden' }}>
                        <button
                          type="button"
                          onClick={() => {
                            setExpandedFetchIds((prev) => {
                              const next = new Set(prev);
                              next.has(c.id) ? next.delete(c.id) : next.add(c.id);
                              return next;
                            });
                          }}
                          style={{ width: '100%', display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 16px', background: 'var(--secondary)', border: 'none', cursor: 'pointer', textAlign: 'left' }}
                        >
                          <span style={{ fontSize: '12px', color: 'var(--muted-foreground)' }}>{isExpanded ? '▾' : '▸'}</span>
                          <Favicon domain={c.domain} />
                          <span style={{ fontWeight: 600, fontSize: '13px', flex: 1 }}>{c.domain}</span>
                          <span style={{ padding: '2px 6px', borderRadius: 'var(--radius-sm)', fontSize: '10px', fontWeight: 700, background: '#f0fdf4', color: '#166534', border: '1px solid #bbf7d0' }}>
                            SNIPPET
                          </span>
                          <span style={{ fontSize: '11px', color: 'var(--muted-foreground)' }}>{c.snippet.length} chars</span>
                        </button>
                        {isExpanded && (
                          <div style={{ padding: '0 16px 16px', borderTop: '1px solid var(--border)' }}>
                            <div style={{ fontSize: '11px', color: 'var(--muted-foreground)', padding: '8px 0 6px', fontWeight: 600 }}>
                              {c.title}
                            </div>
                            <pre style={{
                              background: '#09090b', color: '#d4d4d8', padding: '14px', borderRadius: 'var(--radius-md)',
                              fontSize: '11px', lineHeight: '1.6', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                              margin: 0,
                              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                            }}>
                              {c.snippet}
                            </pre>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {fetchedPages.map((page) => {
                const isExpanded = expandedFetchIds.has(page.id);
                const isOk = page.fetch_status === 'ok' || page.fetch_status === 'cached';

                return (
                  <div key={page.id} style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', marginBottom: '10px', overflow: 'hidden' }}>
                    {/* Card Header */}
                    <button
                      type="button"
                      onClick={() => {
                        setExpandedFetchIds((prev) => {
                          const next = new Set(prev);
                          next.has(page.id) ? next.delete(page.id) : next.add(page.id);
                          return next;
                        });
                      }}
                      style={{ width: '100%', display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 16px', background: 'var(--secondary)', border: 'none', cursor: 'pointer', textAlign: 'left' }}
                    >
                      <span style={{ fontSize: '12px', color: 'var(--muted-foreground)' }}>{isExpanded ? '▾' : '▸'}</span>
                      <Favicon domain={page.domain} />
                      <span style={{ fontWeight: 600, fontSize: '13px', flex: 1 }}>{page.domain}</span>
                      <span style={{ padding: '2px 6px', borderRadius: 'var(--radius-sm)', fontSize: '10px', fontWeight: 700, background: isOk ? '#f0fdf4' : '#fef2f2', color: isOk ? '#166534' : '#991b1b', border: `1px solid ${isOk ? '#bbf7d0' : '#fecaca'}` }}>
                        {page.fetch_status.toUpperCase()}
                      </span>
                      <span style={{ fontSize: '11px', color: 'var(--muted-foreground)' }}>{page.char_count.toLocaleString()} chars</span>
                      <span style={{ fontSize: '10px', color: 'var(--muted-foreground)', textTransform: 'uppercase' }}>{page.extraction_method}</span>
                    </button>

                    {/* Expanded Content */}
                    {isExpanded && (
                      <div style={{ padding: '0 16px 16px', borderTop: '1px solid var(--border)' }}>
                        <div style={{ fontSize: '11px', color: 'var(--muted-foreground)', padding: '8px 0 6px', fontWeight: 600 }}>
                          {page.title}
                        </div>
                        <pre style={{
                          background: '#09090b', color: '#d4d4d8', padding: '14px', borderRadius: 'var(--radius-md)',
                          fontSize: '11px', lineHeight: '1.6', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                          maxHeight: '500px', overflowY: 'auto', margin: 0,
                          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                        }}>
                          {page.text_preview || '(No content extracted)'}
                          {page.truncated && <span style={{ color: '#a855f7' }}>{'\n\n'}... [truncated at 2000 chars — full text: {page.char_count.toLocaleString()} chars]</span>}
                        </pre>
                      </div>
                    )}
                  </div>
                );
              })}

              {tier === 'right' && fetchedPages.length === 0 && isLive && (
                <div style={{ padding: '32px', textAlign: 'center', color: 'var(--muted-foreground)', fontSize: '13px' }}>
                  Fetching and extracting page content...
                </div>
              )}
            </div>
          )}

          {/* ===================== TAB 4: RERANK ===================== */}
          {activeTab === '4_rerank' && (
            <div className="audit-details-card">
              <div className="audit-stage-headline">
                <div className="audit-stage-title">Stage 4: LLM Reranking & Deliberation</div>
                <span className="meta-chip">Model: {rerankInference?.model_id || modelId || '...'}</span>
                {rerankInference?.parse_ladder_rung && <span className="meta-chip">{rerankInference.parse_ladder_rung}</span>}
                {isRerankStreaming && (
                  <span className="meta-chip" style={{ background: 'rgba(56, 189, 248, 0.15)', color: '#38bdf8', borderColor: 'rgba(56, 189, 248, 0.4)' }}>
                    ● Streaming live
                  </span>
                )}
                {rerankInference?.usage && (
                  <span className="meta-chip" style={{ background: 'rgba(168, 85, 247, 0.12)', color: '#c084fc', borderColor: 'rgba(168, 85, 247, 0.3)' }}>
                    ⚡ {rerankInference.usage.total_tokens.toLocaleString()} tokens ({rerankInference.usage.prompt_tokens.toLocaleString()} in / {rerankInference.usage.completion_tokens.toLocaleString()} out)
                  </span>
                )}
              </div>

              {/* Per-candidate evaluation table */}
              {rerankInference?.evaluations && rerankInference.evaluations.length > 0 && (
                <div style={{ marginBottom: '20px' }}>
                  <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--foreground)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Candidate Evaluations</div>
                  <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
                    {rerankInference.evaluations.map((ev, idx) => (
                      <div key={ev.id} style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', padding: '10px 14px', borderBottom: idx < rerankInference.evaluations.length - 1 ? '1px solid var(--border)' : 'none', fontSize: '12px' }}>
                        <Favicon domain={ev.domain} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '2px' }}>
                            <span style={{ fontWeight: 600 }}>{ev.domain}</span>
                            <span style={{ padding: '1px 5px', borderRadius: 'var(--radius-sm)', fontSize: '9px', fontWeight: 700, background: ev.verdict === 'keep' ? '#f0fdf4' : '#fef2f2', color: ev.verdict === 'keep' ? '#166534' : '#991b1b', border: `1px solid ${ev.verdict === 'keep' ? '#bbf7d0' : '#fecaca'}` }}>
                              {ev.verdict.toUpperCase()}
                            </span>
                            <span className="mono" style={{ fontSize: '11px', fontWeight: 700, color: '#0284c7' }}>Score: {ev.final_score}</span>
                          </div>
                          <div style={{ fontSize: '11px', color: '#52525b' }}>{ev.title}</div>
                          {ev.rationale && (
                            <div style={{ marginTop: '4px', fontSize: '11px', color: '#0369a1', fontStyle: 'italic', borderLeft: '2px solid #bae6fd', paddingLeft: '8px' }}>
                              {ev.rationale}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* LLM Prompt */}
              {(rerankInference?.user_prompt || audit.rerank?.user_prompt) && (
                <div style={{ marginBottom: '20px' }}>
                  <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--foreground)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '6px' }}>
                    Candidate XML Context Fed to Model:
                  </div>
                  <XmlPromptViewer rawText={rerankInference?.user_prompt || audit.rerank?.user_prompt || ''} />
                </div>
              )}

              {/* Raw LLM Response */}
              {(rerankInference?.raw_response || audit.rerank?.raw_response) && (
                <div>
                  <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--foreground)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '6px' }}>
                    Raw LLM Model Output:
                  </div>
                  <RawResponseViewer
                    rawText={rerankInference?.raw_response || audit.rerank?.raw_response || ''}
                    modelId={rerankInference?.model_id || modelId}
                    isStreaming={isRerankStreaming}
                  />
                </div>
              )}

              {!rerankInference && !audit.rerank && (
                <div style={{ padding: '32px', textAlign: 'center', color: 'var(--muted-foreground)', fontSize: '13px' }}>
                  {isLive ? 'LLM reranking in progress...' : 'No rerank data available.'}
                </div>
              )}
            </div>
          )}

          {/* ===================== TAB 5: RANKED RESULTS ===================== */}
          {activeTab === '5_result' && (
            <div>
              <div className="results-header-info">
                <h1 className="results-query-title">{query}</h1>
                {intent && <div className="results-intent-text">Intent: {intent}</div>}
                {interpretation && <div style={{ fontSize: '13px', color: '#0284c7', marginTop: '2px' }}>› Interpretation: {interpretation}</div>}
                <div className="results-meta-bar">
                  <span className="meta-chip">{results.length} results</span>
                  {elapsedMs > 0 && <span className="meta-chip">{(elapsedMs / 1000).toFixed(1)}s</span>}
                  <span className="meta-chip">Model: {tier === 'rush' ? 'Direct Search' : (modelId || '...')}</span>
                  {tokenUsage && tokenUsage.total_tokens > 0 && (
                    <span
                      className="meta-chip"
                      style={{ background: 'rgba(168, 85, 247, 0.1)', color: '#c084fc', borderColor: 'rgba(168, 85, 247, 0.3)' }}
                      title={`${tokenUsage.prompt_tokens.toLocaleString()} prompt tokens + ${tokenUsage.completion_tokens.toLocaleString()} completion tokens`}
                    >
                      ⚡ {tokenUsage.total_tokens.toLocaleString()} tokens
                    </span>
                  )}
                  <span className="meta-chip" style={tier === 'rush' ? { background: '#fef3c7', color: '#92400e', borderColor: '#fde68a' } : {}}>
                    {tier === 'rush' ? '⚡ RUSH' : `Tier: ${tier.toUpperCase()}`}
                  </span>
                </div>
              </div>

              {tier === 'rush' && searchStatus === 'final' && (
                <div style={{ background: '#fefce8', border: '1px solid #fef08a', borderRadius: 'var(--radius-lg)', padding: '8px 14px', marginBottom: '14px', fontSize: '12px', color: '#854d0e', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>
                  <span><strong>Rush Mode active:</strong> Delivered direct multi-engine search results with 0ms AI inference delay.</span>
                </div>
              )}

              {searchStatus === 'provisional' && (
                <div style={{ background: '#fefce8', border: '1px solid #fef08a', borderRadius: 'var(--radius-lg)', padding: '10px 14px', marginBottom: '16px', fontSize: '13px', color: '#854d0e', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>
                  <span>Provisional results — listwise LLM reranking in progress...</span>
                </div>
              )}

              {/* Error State */}
              {searchStatus === 'error' && (
                <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 'var(--radius-lg)', padding: '28px 20px', textAlign: 'center', marginTop: '16px' }}>
                  <div style={{ fontSize: '36px', marginBottom: '10px' }}>⚠️</div>
                  <h3 style={{ fontSize: '17px', fontWeight: 700, color: '#991b1b', marginBottom: '6px' }}>
                    Search Could Not Be Completed
                  </h3>
                  <p style={{ fontSize: '13px', color: '#7f1d1d', maxWidth: '480px', margin: '0 auto 18px auto', lineHeight: 1.5 }}>
                    {errorMessage || 'The search process encountered an error or timed out.'}
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setSearchStatus('connecting');
                      setErrorMessage(null);
                      window.location.reload();
                    }}
                    className="results-submit-btn"
                    style={{ padding: '8px 22px', fontSize: '13px', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                  >
                    <span>↻</span>
                    <span>Retry Search</span>
                  </button>
                </div>
              )}

              {/* Connecting / Loading Skeleton */}
              {(searchStatus === 'connecting' || searchStatus === 'running') && results.length === 0 && (
                <div style={{ padding: '48px 16px', textAlign: 'center' }}>
                  <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '52px', height: '52px', borderRadius: '50%', background: 'var(--secondary)', border: '1px solid var(--border)', marginBottom: '16px' }}>
                    <svg className="spin-animate" style={{ animation: 'spin 0.8s linear infinite' }} width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" strokeWidth="2.5">
                      <path d="M21 12a9 9 0 1 1-6.219-8.56"></path>
                    </svg>
                  </div>
                  <h3 style={{ fontSize: '17px', fontWeight: 600, color: 'var(--foreground)', margin: '0 0 8px 0' }}>
                    {query ? `Searching for "${query}"...` : 'Connecting to search pipeline...'}
                  </h3>
                  <p style={{ fontSize: '13px', color: 'var(--muted-foreground)', maxWidth: '440px', margin: '0 auto', lineHeight: 1.5 }}>
                    Multi-provider retrieval, neural prefiltering, content extraction, and listwise model reranking in progress.
                  </p>
                </div>
              )}

              {/* Empty Results State */}
              {searchStatus === 'final' && results.length === 0 && (
                <div style={{ padding: '48px 16px', textAlign: 'center', color: 'var(--muted-foreground)' }}>
                  <div style={{ fontSize: '36px', marginBottom: '10px' }}>🔍</div>
                  <h3 style={{ fontSize: '17px', fontWeight: 600, color: 'var(--foreground)', marginBottom: '6px' }}>
                    No Results Found
                  </h3>
                  <p style={{ fontSize: '13px', maxWidth: '440px', margin: '0 auto', lineHeight: 1.5 }}>
                    No candidates passed relevance criteria for this query. Try adjusting your search terms or selecting the Right tier.
                  </p>
                </div>
              )}

              <div>
                {results.map((r, index) => {
                  const isPromoted = r.provenance.rank_delta > 0;
                  const deltaText = isPromoted ? `+${r.provenance.rank_delta}` : r.provenance.rank_delta === 0 ? '·' : `${r.provenance.rank_delta}`;
                  const providerNames = r.provenance.providers.map((p: any) => typeof p === 'string' ? p : p.provider).join(', ');

                  return (
                    <article key={r.url} className="result-card-shadcn">
                      <div className={`rank-badge-clean ${isPromoted ? 'promoted' : ''}`} title={`Rank delta: ${deltaText}`}>
                        <span>#{index + 1}</span>
                        {r.provenance.rank_delta !== 0 && <span style={{ fontSize: '10px', opacity: 0.8 }}>{deltaText}</span>}
                      </div>

                      <div className="result-card-content">
                        <div className="result-domain-row">
                          <Favicon domain={r.domain} />
                          <span style={{ fontWeight: 600, color: 'var(--foreground)' }}>{r.domain}</span>
                          <span>·</span>
                          <span>{providerNames}</span>
                          {r.provenance.was_read && (
                            <span style={{ background: '#f0fdf4', color: '#166534', border: '1px solid #bbf7d0', borderRadius: 'var(--radius-sm)', padding: '1px 5px', fontSize: '10px', fontWeight: 600 }}>PAGE READ</span>
                          )}
                        </div>

                        <a href={r.url} target="_blank" rel="noopener noreferrer" className="result-title-link">
                          <span>{r.title}</span>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.5 }}>
                            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line>
                          </svg>
                        </a>

                        <p className="result-snippet-text">{r.snippet}</p>

                        {tier !== 'rush' && r.rationale && (
                          <div className="result-rationale-box">
                            <strong>AI Rationale:</strong> {r.rationale}
                          </div>
                        )}
                      </div>

                      <div className="result-score-tag" title="Relevance Score">{r.score}</div>
                    </article>
                  );
                })}
              </div>

              {chaff.length > 0 && (
                <div className="chaff-collapse-card">
                  <button type="button" className="chaff-collapse-btn" onClick={() => setShowChaff(!showChaff)}>
                    <span>{showChaff ? '▾' : '▸'} {chaff.length} Dropped Candidates (Chaff)</span>
                    <span style={{ fontSize: '11px' }}>Filtered during Prefilter / Retrieval</span>
                  </button>
                  {showChaff && (
                    <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {chaff.map((c) => (
                        <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px' }}>
                          <Favicon domain={c.domain} />
                          <span style={{ fontWeight: 600 }}>{c.domain}</span>
                          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#71717a' }}>{c.title}</span>
                          <span style={{ background: '#fee2e2', color: '#991b1b', padding: '2px 6px', borderRadius: 'var(--radius-sm)', fontSize: '10px', fontWeight: 600 }}>{c.drop_reason || 'dropped'}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
