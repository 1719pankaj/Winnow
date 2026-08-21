import net from 'net';

const TRACKING_PARAMS = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'fbclid',
  'gclid',
  'ref',
  'ref_src',
  'mc_cid',
  'mc_eid',
  '_ga',
  'igshid',
  'si',
]);

const MEANINGFUL_PARAMS = new Set(['v', 'p', 'id', 'q', 'article', 'post']);

/**
 * Normalises and canonicalises URLs per Section 6.2 of Winnow spec.
 */
export function canonicalizeUrl(urlStr: string): string {
  try {
    const parsed = new URL(urlStr);

    // 1. Lowercase scheme & host; strip www.
    let host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    let pathname = parsed.pathname;

    // 2. Strip trailing slash unless it's just root
    if (pathname.length > 1 && pathname.endsWith('/')) {
      pathname = pathname.slice(0, -1);
    }

    // 3. Clean search params (remove tracking, keep meaningful)
    const cleanedParams = new URLSearchParams();
    parsed.searchParams.forEach((val, key) => {
      const lowerKey = key.toLowerCase();
      if (!TRACKING_PARAMS.has(lowerKey)) {
        cleanedParams.append(key, val);
      }
    });

    cleanedParams.sort();
    const queryString = cleanedParams.toString() ? `?${cleanedParams.toString()}` : '';

    // 4. Fragments: strip unless pathname is empty and fragment is deep link
    let hash = '';
    if (pathname === '/' && parsed.hash && parsed.hash.length > 1) {
      hash = parsed.hash;
    }

    // 5. Force https for canonical key comparison
    return `https://${host}${pathname}${queryString}${hash}`;
  } catch {
    return urlStr.trim().toLowerCase();
  }
}

/**
 * Extracts registrable domain from URL for diversity caps and blocklists.
 */
export function extractDomain(urlStr: string): string {
  try {
    const u = new URL(urlStr);
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    return host;
  } catch {
    return 'unknown';
  }
}

/**
 * Normalises titles for near-duplicate deduplication (Section 6.2).
 */
export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\w\s]/g, '') // remove punctuation
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * SSRF Guard (Section 6.4): Checks if a host is private, loopback, link-local, or reserved.
 */
export function isPrivateOrReservedIp(ip: string): boolean {
  if (!net.isIP(ip)) return false;

  // IPv4 checks
  if (net.isIPv4(ip)) {
    const parts = ip.split('.').map(Number);
    if (parts[0] === 127) return true; // loopback
    if (parts[0] === 10) return true; // 10.0.0.0/8
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true; // 172.16.0.0/12
    if (parts[0] === 192 && parts[1] === 168) return true; // 192.168.0.0/16
    if (parts[0] === 169 && parts[1] === 254) return true; // link-local 169.254.0.0/16
    if (parts[0] === 0 || parts[0] >= 224) return true; // reserved/multicast
  }

  // IPv6 checks
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    if (lower === '::1' || lower === '::') return true;
    if (lower.startsWith('fe80:')) return true; // link-local
    if (lower.startsWith('fc00:') || lower.startsWith('fd00:')) return true; // unique local
  }

  return false;
}
