import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';
import * as cheerio from 'cheerio';
import { ExtractionMethod } from './types';

export interface ExtractionResult {
  text: string;
  charCount: number;
  method: ExtractionMethod;
  truncated: boolean;
}

/**
 * Resilient content extraction ladder per Section 6.4 of Winnow spec:
 * 1. Readability (via lightweight linkedom DOM)
 * 2. If < 200 chars -> Cheerio raw text + whitespace collapse
 * 3. If < 200 chars -> snippet_only
 */
export function extractContent(
  html: string,
  maxChars = 6000
): ExtractionResult {
  if (!html || html.trim().length === 0) {
    return { text: '', charCount: 0, method: 'snippet_only', truncated: false };
  }

  // 1. Try Readability with LinkeDOM
  try {
    const { document } = parseHTML(html);
    const reader = new Readability(document as any, {
      charThreshold: 100,
    });
    const article = reader.parse();

    if (article && article.textContent && article.textContent.trim().length >= 200) {
      const cleanText = collapseWhitespace(article.textContent);
      const isTruncated = cleanText.length > maxChars;
      const truncatedText = cleanText.slice(0, maxChars);

      return {
        text: truncatedText,
        charCount: truncatedText.length,
        method: 'readability',
        truncated: isTruncated,
      };
    }
  } catch (err) {
    // Readability failed, move to next rung in ladder
  }

  // 2. Fallback: Cheerio text extraction with boilerplate removal
  try {
    const $ = cheerio.load(html);

    // Strip scripts, styles, navs, footers, headers, ads
    $('script, style, noscript, nav, footer, header, svg, iframe, form, [role="navigation"], [role="banner"], [role="contentinfo"], .nav, .footer, .header, .sidebar, .ad, .advertisement').remove();

    const rawText = $('body').text() || $.text();
    const cleanText = collapseWhitespace(rawText);

    if (cleanText.length >= 200) {
      const isTruncated = cleanText.length > maxChars;
      const truncatedText = cleanText.slice(0, maxChars);

      return {
        text: truncatedText,
        charCount: truncatedText.length,
        method: 'cheerio',
        truncated: isTruncated,
      };
    }
  } catch (err) {
    // Cheerio failed
  }

  // 3. Fallback to snippet_only
  return {
    text: '',
    charCount: 0,
    method: 'snippet_only',
    truncated: false,
  };
}

/**
 * Normalises whitespace in extracted text: collapses runs of 3+ newlines to 2,
 * and collapses multiple horizontal spaces to single space.
 */
export function collapseWhitespace(text: string): string {
  return text
    .replace(/[^\S\r\n]+/g, ' ') // horizontal whitespace
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n') // collapse multiple newlines
    .trim();
}
