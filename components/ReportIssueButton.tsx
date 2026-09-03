'use client';

import { useState, useEffect, useCallback } from 'react';
import { usePathname } from 'next/navigation';
import { toPng } from 'html-to-image';
import { ReportIssueModal } from './ReportIssueModal';

export function ReportIssueButton() {
  const pathname = usePathname() || '';
  const [isOpen, setIsOpen] = useState(false);
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const [searchId, setSearchId] = useState<string | null>(null);

  // Extract searchId if on /s/[id] page
  useEffect(() => {
    const match = pathname.match(/^\/s\/([a-zA-Z0-9_-]+)/);
    if (match && match[1]) {
      setSearchId(match[1]);
    } else {
      setSearchId(null);
    }
  }, [pathname]);

  const handleTrigger = useCallback(async () => {
    if (isCapturing) return;
    setIsCapturing(true);

    try {
      // Capture screenshot of the document body before opening the modal
      const dataUrl = await toPng(document.body, {
        quality: 0.8,
        pixelRatio: 1,
        skipFonts: true,
        cacheBust: false,
        filter: (node) => {
          // Exclude floating widgets and modal containers from the capture
          if (node instanceof HTMLElement) {
            if (node.classList.contains('report-floating-btn') || node.classList.contains('report-modal-backdrop')) {
              return false;
            }
          }
          return true;
        },
      });

      setScreenshot(dataUrl);
    } catch (err) {
      console.warn('[ReportIssue] Screenshot capture failed:', err);
      setScreenshot(null);
    } finally {
      setIsCapturing(false);
      setIsOpen(true);
    }
  }, [isCapturing]);

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
            <span>Capturing...</span>
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
        searchId={searchId}
        pathname={pathname}
      />
    </>
  );
}
