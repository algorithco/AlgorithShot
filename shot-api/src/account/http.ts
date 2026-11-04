import { ApiError, contractError, unavailable } from "../errors.ts";

export interface JsonResponse { body: unknown; headers: Headers }

/** No redirects or unbounded bodies, including chunked and decompressed responses. */
export class AccountHttp {
  readonly timeoutMs: number;
  readonly fetcher: typeof fetch;

  constructor(timeoutMs: number, fetcher: typeof fetch = fetch) {
    this.timeoutMs = timeoutMs;
    this.fetcher = fetcher;
  }

  async json(url: string, init: RequestInit = {}, maxBytes = 64 * 1024): Promise<JsonResponse> {
    try {
      const headers = new Headers(init.headers);
      headers.set("Accept", "application/json");
      const response = await this.fetcher(url, {
        ...init, redirect: "error", signal: AbortSignal.timeout(this.timeoutMs),
        headers,
      });
      if (!response.ok) {
        await response.body?.cancel();
        if (response.status === 401 && headers.has("authorization")) throw new ApiError(401, "reauthentication_required", "Sign in to Algorithco Account again.");
        if (response.status === 403 && headers.has("authorization")) throw new ApiError(403, "account_access_denied", "Account did not authorize this operation.");
        if (response.status === 429) {
          const retry = Number(response.headers.get("retry-after"));
          throw new ApiError(503, "account_rate_limited", "Account is busy. Try again later.", Number.isInteger(retry) && retry > 0 ? Math.min(retry, 3600) : 60);
        }
        if (response.status >= 500) throw unavailable();
        throw contractError();
      }
      if (!/^application\/(?:json|[\w.+-]+\+json)(?:\s*;|$)/i.test(response.headers.get("content-type") ?? "")) {
        await response.body?.cancel();
        throw contractError();
      }
      if (Number(response.headers.get("content-length")) > maxBytes) {
        await response.body?.cancel();
        throw contractError();
      }
      if (!response.body) throw contractError();
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          if (bytes > maxBytes) { await reader.cancel(); throw contractError(); }
          chunks.push(value);
        }
      } finally { reader.releaseLock(); }
      const body: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      return { body, headers: response.headers };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (error instanceof SyntaxError) throw contractError();
      throw unavailable();
    }
  }
}

export function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
