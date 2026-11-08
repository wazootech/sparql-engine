import {
  assertLoadAllowed,
  type LoadFetch,
  type LoadHttpResponse,
  type LoadPolicy,
} from "@/evaluator/load-policy.ts";

const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;

const globalFetch: LoadFetch = (url, init) =>
  fetch(url, init) as unknown as Promise<LoadHttpResponse>;

function tooLarge(): Error {
  return new Error("LOAD response exceeds the size limit");
}

/** readCapped reads a body as text, aborting once maxBytes is exceeded. */
async function readCapped(
  response: LoadHttpResponse,
  maxBytes: number,
): Promise<string> {
  const declared = Number(response.headers.get("content-length"));
  if (declared > maxBytes) throw tooLarge();
  const reader = response.body?.getReader();
  if (!reader) {
    const text = await response.text();
    if (text.length > maxBytes) throw tooLarge();
    return text;
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value?.length ?? 0;
    if (total > maxBytes) {
      await reader.cancel();
      throw tooLarge();
    }
    if (value) chunks.push(value);
  }
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder().decode(joined);
}

/**
 * fetchRemoteDocument fetches a LOAD source under policy: every hop (the
 * first request and each redirect) is re-validated, redirects are bounded,
 * and time and size are capped. text is null for a non-2xx reply.
 */
export async function fetchRemoteDocument(
  sourceIri: string,
  policy: LoadPolicy | undefined,
): Promise<{ status: number; text: string | null }> {
  const doFetch = policy?.fetch ?? globalFetch;
  const maxBytes = policy?.maxBytes ?? DEFAULT_MAX_BYTES;
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error("LOAD timed out")),
    policy?.timeoutMs ?? 5000,
  );
  try {
    let url = sourceIri;
    for (let hop = 0; hop <= (policy?.maxRedirects ?? 3); hop++) {
      await assertLoadAllowed(url, policy);
      const response = await doFetch(url, {
        redirect: "manual",
        signal: controller.signal,
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) throw new Error("LOAD redirect without a location");
        url = new URL(location, url).href;
        continue;
      }
      if (!response.ok) return { status: response.status, text: null };
      const text = await readCapped(response, maxBytes);
      return { status: response.status, text };
    }
    throw new Error("LOAD followed too many redirects");
  } finally {
    clearTimeout(timer);
  }
}
