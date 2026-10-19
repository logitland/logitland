// Subscriber destinations are SSRF inputs (OWASP). The relay checks the URL, then resolves the host
// itself and refuses private, loopback, link-local, metadata and other non-public addresses, on
// registration, on the challenge and before every delivery attempt.
//
// LIMITATION (hosting.md "Unknown"): this is a DNS preflight. Workers fetch() does not let the relay pin
// the connection to the address it checked, so a rebinding host could still answer differently between
// the check and the connection. Connection-time enforcement needs verification or a controlled egress,
// which is a group decision. Redirects are never followed.

export interface Resolver {
  /** All A and AAAA answers for a hostname. */
  resolve(hostname: string): Promise<string[]>;
}

export class DestinationRefused extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'DestinationRefused';
  }
}

const ALLOWED_PORTS = new Set(['', '443', '8443']);
const BLOCKED_SUFFIXES = ['.localhost', '.local', '.internal', '.intranet', '.lan', '.home.arpa', '.corp', '.test', '.invalid', '.example'];

const isOrUnder = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`);

export function checkUrl(raw: string, blockedHosts: string[] = []): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new DestinationRefused('Not a valid URL');
  }
  if (url.protocol !== 'https:') throw new DestinationRefused('Destinations must use HTTPS');
  if (url.username || url.password) throw new DestinationRefused('Destinations can’t contain credentials');
  if (!ALLOWED_PORTS.has(url.port)) throw new DestinationRefused('Use port 443 or 8443');
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (host.startsWith('[') || /^\d+(\.\d+){3}$/.test(host) || host.includes(':')) throw new DestinationRefused('Use a hostname, not an IP address');
  if (!host.includes('.') || host === 'localhost' || BLOCKED_SUFFIXES.some((s) => host.endsWith(s))) throw new DestinationRefused('That hostname isn’t public');
  if (blockedHosts.some((b) => isOrUnder(host, b.trim().toLowerCase()))) throw new DestinationRefused('That host belongs to Logitland');
  // One spelling per host, so a trailing dot can't dodge per-host rate limits.
  url.hostname = host;
  url.hash = '';
  return url;
}

export async function preflightDestination(raw: string, resolver: Resolver, blockedHosts: string[] = []): Promise<URL> {
  const url = checkUrl(raw, blockedHosts);
  const addresses = await resolver.resolve(url.hostname);
  if (!addresses.length) throw new DestinationRefused('The hostname doesn’t resolve');
  // The message deliberately leaves out the address: it is internal network information.
  if (addresses.some((a) => !isPublicAddress(a))) throw new DestinationRefused('The hostname resolves to a non-public address');
  return url;
}

export function isPublicAddress(addr: string): boolean {
  if (addr.includes(':')) return isPublicV6(addr);
  const p = addr.split('.').map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b] = p as [number, number, number, number];
  if (a === 0 || a === 10 || a === 127) return false;
  if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT
  if (a === 169 && b === 254) return false; // link-local, cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 192 && b === 0 && (p[2] === 0 || p[2] === 2)) return false; // IETF protocol assignments, TEST-NET-1
  if (a === 198 && (b === 18 || b === 19)) return false; // benchmarking
  if (a === 198 && b === 51 && p[2] === 100) return false; // TEST-NET-2
  if (a === 203 && b === 0 && p[2] === 113) return false; // TEST-NET-3
  if (a >= 224) return false; // multicast, reserved, broadcast
  return true;
}

function expandV6(addr: string): number[] | null {
  const a = addr.toLowerCase().split('%')[0]!;
  const parts = a.split('::');
  if (parts.length > 2) return null;
  const head = parts[0] ? parts[0].split(':') : [];
  const tail = parts.length === 2 && parts[1] ? parts[1].split(':') : [];
  const missing = 8 - head.length - tail.length;
  if (parts.length === 1 ? head.length !== 8 : missing < 1) return null;
  const groups = [...head, ...Array<string>(parts.length === 2 ? missing : 0).fill('0'), ...tail].map((g) => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : Number.NaN));
  return groups.some(Number.isNaN) ? null : groups;
}

function isPublicV6(addr: string): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(addr);
  if (mapped) return isPublicAddress(mapped[1]!); // IPv4-mapped: judge the embedded address
  if (addr.includes('.')) return false; // other embedded-IPv4 forms are never needed for a webhook
  const g = expandV6(addr);
  if (!g) return false;
  if (g.every((x) => x === 0)) return false; // ::
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return false; // ::1
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) return isPublicAddress(`${g[6]! >> 8}.${g[6]! & 255}.${g[7]! >> 8}.${g[7]! & 255}`);
  const first = g[0]!;
  if ((first & 0xfe00) === 0xfc00) return false; // unique local fc00::/7
  if ((first & 0xffc0) === 0xfe80) return false; // link-local fe80::/10
  if ((first & 0xff00) === 0xff00) return false; // multicast
  if (first === 0x2001 && g[1] === 0x0db8) return false; // documentation
  if (first === 0x0064 && g[1] === 0xff9b) return false; // NAT64 can reach internal IPv4
  if (first === 0x2002) return false; // 6to4 embeds arbitrary IPv4
  return (first & 0xe000) === 0x2000; // global unicast 2000::/3
}

const LOOKUP_FAILED = 'The hostname couldn’t be looked up right now. Try again shortly.';

/**
 * DNS over HTTPS (JSON API) through Cloudflare's resolver. A lookup that errors (SERVFAIL, REFUSED, a bad
 * HTTP answer, a timeout) fails the whole resolution: treating it as "no addresses" would let a host hide a
 * private AAAA record behind a failing lookup.
 */
export function dohResolver(fetcher: typeof fetch = fetch, endpoint = 'https://cloudflare-dns.com/dns-query'): Resolver {
  return {
    async resolve(hostname) {
      const ask = async (type: 'A' | 'AAAA') => {
        let data: { Status?: number; Answer?: { type: number; data: string }[] };
        try {
          const res = await fetcher(`${endpoint}?${new URLSearchParams({ name: hostname, type })}`, {
            headers: { accept: 'application/dns-json' },
            signal: AbortSignal.timeout(3000),
          });
          if (!res.ok) throw new Error('DNS over HTTPS answered with an error');
          data = (await res.json()) as typeof data;
        } catch {
          throw new DestinationRefused(LOOKUP_FAILED);
        }
        // RCODE 0 is NOERROR; 3 is NXDOMAIN, which is an empty answer ("doesn't resolve"), not a failed lookup.
        if (data.Status !== 0 && data.Status !== 3) throw new DestinationRefused(LOOKUP_FAILED);
        const want = type === 'A' ? 1 : 28;
        return (data.Answer ?? []).filter((a) => a.type === want).map((a) => a.data);
      };
      const [a, aaaa] = await Promise.all([ask('A'), ask('AAAA')]);
      return [...a, ...aaaa];
    },
  };
}
