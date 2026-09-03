'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { toPng } from 'html-to-image';
import { ReportIssueModal, ClientDiagnostics } from './ReportIssueModal';

interface CapturedError {
  message: string;
  source?: string;
  lineno?: number;
  colno?: number;
  time: string;
}

export function ReportIssueButton() {
  const pathname = usePathname() || '';
  const [isOpen, setIsOpen] = useState(false);
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [screenshotError, setScreenshotError] = useState<string | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const [searchId, setSearchId] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<ClientDiagnostics | null>(null);

  const errorBufferRef = useRef<CapturedError[]>([]);

  // Collect client-side errors in a rolling buffer of 5
  useEffect(() => {
    const handleGlobalError = (event: ErrorEvent) => {
      const errItem: CapturedError = {
        message: event.message || 'Unknown runtime error',
        source: event.filename,
        lineno: event.lineno,
        colno: event.colno,
        time: new Date().toISOString(),
      };
      errorBufferRef.current = [...errorBufferRef.current.slice(-4), errItem];
    };

    const handleRejection = (event: PromiseRejectionEvent) => {
      const errItem: CapturedError = {
        message: String(event.reason?.message || event.reason || 'Unhandled Promise Rejection'),
        time: new Date().toISOString(),
      };
      errorBufferRef.current = [...errorBufferRef.current.slice(-4), errItem];
    };

    window.addEventListener('error', handleGlobalError);
    window.addEventListener('unhandledrejection', handleRejection);
    return () => {
      window.removeEventListener('error', handleGlobalError);
      window.removeEventListener('unhandledrejection', handleRejection);
    };
  }, []);

  // Extract searchId if on /s/[id] page
  useEffect(() => {
    const match = pathname.match(/^\/s\/([a-zA-Z0-9_-]+)/);
    if (match && match[1]) {
      setSearchId(match[1]);
    } else {
      setSearchId(null);
    }
  }, [pathname]);

  const captureScreen = async (): Promise<{ dataUrl: string | null; error: string | null }> => {
    // Attempt 1: document.body with font skip
    try {
      const dataUrl = await toPng(document.body, {
        quality: 0.8,
        pixelRatio: 1,
        skipFonts: true,
        cacheBust: false,
        filter: (node) => {
          if (node instanceof HTMLElement) {
            if (node.classList.contains('report-floating-btn') || node.classList.contains('report-modal-backdrop')) {
              return false;
            }
          }
          return true;
        },
      });
      return { dataUrl, error: null };
    } catch (err: any) {
      console.warn('[ReportIssue] Body screenshot failed, attempting documentElement fallback:', err);
    }

    // Attempt 2: documentElement fallback
    try {
      const dataUrl = await toPng(document.documentElement, {
        quality: 0.7,
        pixelRatio: 1,
        skipFonts: true,
        cacheBust: false,
        filter: (node) => {
          if (node instanceof HTMLElement) {
            if (node.classList.contains('report-floating-btn') || node.classList.contains('report-modal-backdrop')) {
              return false;
            }
          }
          return true;
        },
      });
      return { dataUrl, error: null };
    } catch (err2: any) {
      console.warn('[ReportIssue] Document fallback also failed:', err2);
      return { dataUrl: null, error: err2?.message || 'Canvas export blocked on device' };
    }
  };

  const collectDiagnostics = (): ClientDiagnostics => {
    const win = typeof window !== 'undefined' ? window : null;
    const nav = typeof navigator !== 'undefined' ? (navigator as any) : null;

    // Search state from global window or fallback from inputs
    const globalSearch = (win as any)?.__winnow_current_search__ || {};

    let fallbackQuery = globalSearch.query || '';
    if (!fallbackQuery && typeof document !== 'undefined') {
      const queryInput = document.querySelector('input[type="text"]') as HTMLInputElement | null;
      if (queryInput && queryInput.value) {
        fallbackQuery = queryInput.value;
      }
    }

    const conn = nav?.connection;

    return {
      url: win ? win.location.href : '',
      pathname,
      searchId: searchId || globalSearch.searchId || null,
      query: fallbackQuery || undefined,
      intent: globalSearch.intent || undefined,
      tier: globalSearch.tier || undefined,
      modelId: globalSearch.modelId || undefined,
      searchStatus: globalSearch.searchStatus || undefined,
      errorMessage: globalSearch.errorMessage || undefined,
      activeTab: globalSearch.activeTab || undefined,
      resultsCount: globalSearch.resultsCount,
      candidatesCount: globalSearch.candidatesCount,
      deliberationLogCount: globalSearch.deliberationLogCount,
      viewport: win ? `${win.innerWidth} × ${win.innerHeight}` : 'unknown',
      screen: win ? `${win.screen.width} × ${win.screen.height}` : 'unknown',
      dpr: win ? win.devicePixelRatio || 1 : 1,
      colorDepth: win ? win.screen.colorDepth || 24 : 24,
      orientation: win?.screen?.orientation?.type || (win && win.innerWidth > win.innerHeight ? 'landscape' : 'portrait'),
      network: {
        online: nav ? nav.onLine : true,
        effectiveType: conn?.effectiveType || 'unknown',
        downlink: conn?.downlink,
        rtt: conn?.rtt,
      },
      recentErrors: [...errorBufferRef.current],
      timestamp: new Date().toISOString(),
    };
  };

  const handleTrigger = useCallback(async () => {
    if (isCapturing) return;
    setIsCapturing(true);

    const diag = collectDiagnostics();
    setDiagnostics(diag);

    const { dataUrl, error } = await captureScreen();
    setScreenshot(dataUrl);
    setScreenshotError(error);

    setIsCapturing(false);
    setIsOpen(true);
  }, [isCapturing, pathname, searchId]);

  const handleRetakeScreenshot = async () => {
    setIsCapturing(true);
    const { dataUrl, error } = await captureScreen();
    setScreenshot(dataUrl);
    setScreenshotError(error);
    setIsCapturing(false);
  };

  // Listen for external trigger events (e.g. from header nav links)
  useEffect(() => {
    const handleCustomTrigger = () => {
      handleTrigger();
    };

    window.addEventListener('open-report-issue', handleCustomTrigger);
    return () => {
      window.removeEventListener('open-report-issue', handleCustomTrigger);
    };
  }, [handleTrigger]);

  return (
    <>
      {/* Floating Action Button */}
      <button
        type="button"
        onClick={handleTrigger}
        className="report-floating-btn"
        title="Report an issue or bug with current screen and logs"
        disabled={isCapturing}
      >
        {isCapturing ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
            <span className="spinner" style={{ width: '12px', height: '12px', border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff' }} />
            <span>Capturing Diagnostics...</span>
          </span>
        ) : (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
            </svg>
            <span>Report Issue</span>
          </span>
        )}
      </button>

      {/* Modal Dialog */}
      <ReportIssueModal
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        screenshot={screenshot}
        screenshotError={screenshotError}
        onRetakeScreenshot={handleRetakeScreenshot}
        diagnostics={diagnostics}
        pathname={pathname}
      />
    </>
  );
}
