/**
 * Shared fetch wrapper for calls to the backend API.
 *
 * The problem this solves: a plain `fetch()` throws the same generic
 * "NetworkError when attempting to fetch resource" for very different
 * root causes — the backend being down, CORS/connection issues, a 401
 * because the session expired, a 403 because of RBAC, a 404, or a real
 * 500. Every page was independently (and inconsistently) guessing at
 * which one it was. This centralizes that into one place.
 */

export class ApiError extends Error {
  /** HTTP status code, or 0 if the request never reached the server at all. */
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/**
 * Calls `fetcher(url, init)` (typically AuthContext's authFetch) and
 * returns the parsed JSON body on success. Throws ApiError with a clear,
 * user-presentable message on any failure — network-level, auth, or a
 * structured {error: "..."} body from the backend.
 */
export async function apiFetch<T = any>(
  fetcher: (input: string, init?: RequestInit) => Promise<Response>,
  url: string,
  init?: RequestInit
): Promise<T> {
  let response: Response;

  try {
    response = await fetcher(url, init);
  } catch {
    // fetch() itself threw — the request never got a response at all.
    // This is what a stale/unpublished port, a crashed backend
    // container, or a DNS/connection failure looks like.
    throw new ApiError(
      "Could not reach the server. Check that the backend is running and reachable.",
      0
    );
  }

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const message = body.error || describeStatus(response.status);
    throw new ApiError(message, response.status);
  }

  // Some endpoints (e.g. DELETE) return a body with no meaningful JSON,
  // but most return JSON — try, and fall back to null if there's nothing.
  return response.json().catch(() => null as T);
}

function describeStatus(status: number): string {
  switch (status) {
    case 401:
      return "Your session has expired. Please log in again.";
    case 403:
      return "You don't have permission to do that.";
    case 404:
      return "That item could not be found.";
    case 500:
    case 502:
    case 503:
      return "The server ran into a problem. Please try again.";
    default:
      return `Request failed (${status}).`;
  }
}
