/** LoadHttpResponse is the fetch reply surface the guarded LOAD path reads. */
export interface LoadHttpResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly headers: { get(name: string): string | null };
  readonly body?: {
    getReader(): {
      read(): Promise<{ done: boolean; value?: Uint8Array }>;
      cancel(): Promise<void>;
    };
  } | null;
  text(): Promise<string>;
}

/** LoadFetch is the fetch signature the guarded LOAD path calls. */
export type LoadFetch = (
  url: string,
  init: { redirect: "manual"; signal: AbortSignal },
) => Promise<LoadHttpResponse>;

/**
 * LoadPolicy governs `LOAD <http(s)://...>`. Remote LOAD is denied unless
 * allowedHosts names the host, so a multi-tenant host never fetches an
 * arbitrary caller-chosen URL. File LOAD is unaffected (it needs the
 * readTextFile option outside Deno).
 */
export interface LoadPolicy {
  /** allowedHosts lists exact hostnames LOAD may fetch. Empty or absent denies all remote LOAD. */
  allowedHosts?: readonly string[];
  /** allowHttp permits plain http for allowed hosts. Defaults to https only. */
  allowHttp?: boolean;
  /** maxBytes caps the response body. Defaults to 5 MiB. */
  maxBytes?: number;
  /** maxQuads caps the parsed document. Defaults to 10000. */
  maxQuads?: number;
  /** timeoutMs bounds each fetch including body reads. Defaults to 5000. */
  timeoutMs?: number;
  /** maxRedirects bounds followed redirects; each hop is re-validated. Defaults to 3. */
  maxRedirects?: number;
  /**
   * resolveHost resolves a hostname to IP addresses so they can be checked
   * against private ranges (DNS-rebinding defense). Optional because the
   * package graph stays free of `node:` imports; pass one on Node/Deno.
   */
  resolveHost?: (hostname: string) => Promise<string[]>;
  /** fetch overrides globalThis.fetch (tests, proxies). */
  fetch?: LoadFetch;
}

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

function isBlockedIpv4(a: number, b: number): boolean {
  return a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 168 || b === 0)) ||
    (a === 198 && (b === 18 || b === 19));
}

/** isBlockedAddress reports loopback, private, link-local, metadata and reserved IP literals. */
export function isBlockedAddress(address: string): boolean {
  const host = address.replace(/^\[|\]$/g, "").toLowerCase();
  const mapped = host.match(/^(?:::ffff:|64:ff9b::)(.+)$/);
  if (mapped) {
    const tail = mapped[1];
    if (IPV4.test(tail)) return isBlockedAddress(tail);
    const hex = tail.split(":");
    if (hex.length !== 2) return true;
    const high = parseInt(hex[0], 16);
    const low = parseInt(hex[1], 16);
    return isBlockedAddress(
      `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`,
    );
  }
  const v4 = host.match(IPV4);
  if (v4) return isBlockedIpv4(Number(v4[1]), Number(v4[2]));
  if (host.includes(":")) {
    return host === "::" || host === "::1" || /^f[cd]/.test(host) ||
      /^fe[89ab]/.test(host) || host.startsWith("ff");
  }
  return false;
}

/** assertLoadAllowed throws unless policy permits fetching url. */
export async function assertLoadAllowed(
  url: string,
  policy: LoadPolicy | undefined,
): Promise<void> {
  const parsed = new URL(url);
  const hostname = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const allowed = (policy?.allowedHosts ?? []).map((h) => h.toLowerCase());
  if (!allowed.includes(hostname)) {
    throw new Error("LOAD of a remote URL is not permitted by policy");
  }
  const httpOk = policy?.allowHttp === true && parsed.protocol === "http:";
  if (parsed.protocol !== "https:" && !httpOk) {
    throw new Error("LOAD of a remote URL requires https");
  }
  if (parsed.username || parsed.password) {
    throw new Error("LOAD of a URL with credentials is not permitted");
  }
  const isLiteral = IPV4.test(hostname) || hostname.includes(":");
  const addresses = isLiteral
    ? [hostname]
    : (await policy?.resolveHost?.(hostname)) ?? [];
  if (addresses.some(isBlockedAddress)) {
    throw new Error("LOAD target resolves to a blocked address");
  }
}
