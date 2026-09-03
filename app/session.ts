type Fetcher = (path: string, init?: RequestInit) => Promise<Response>;

type ErrorEnvelope = { success?: boolean; code?: number | string; message?: string };

export class SessionExpiredError extends Error {
  readonly status = 401;

  constructor(message = '登录状态已失效，请重新登录') {
    super(message);
    this.name = 'SessionExpiredError';
  }
}

export class SessionRefreshError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'SessionRefreshError';
  }
}

function isPublicAuthRequest(path: string) {
  const pathname = path.split('?')[0];
  return ['/api/auth/login', '/api/auth/login-captcha', '/api/auth/refresh', '/api/auth/logout'].includes(pathname)
    || pathname.startsWith('/api/auth/captcha/');
}

async function readEnvelope(response: Response): Promise<ErrorEnvelope | null> {
  try {
    const value = await response.clone().json();
    return value && typeof value === 'object' ? value : null;
  } catch {
    return null;
  }
}

function waitForRefresh(promise: Promise<void>, signal?: AbortSignal | null) {
  if (!signal) return promise;
  signal.throwIfAborted();
  return new Promise<void>((resolve, reject) => {
    const abort = () => { cleanup(); reject(signal.reason); };
    const cleanup = () => signal.removeEventListener('abort', abort);
    signal.addEventListener('abort', abort, { once: true });
    promise.then(() => { cleanup(); resolve(); }, (error) => { cleanup(); reject(error); });
  });
}

export function createSessionClient(fetcher: Fetcher = (path, init) => fetch(path, init)) {
  let refreshPromise: Promise<void> | null = null;
  let refreshController: AbortController | null = null;
  let sessionVersion = 0;
  let refreshVersion = 0;
  let expired = false;

  function assertCurrent(version: number, signal?: AbortSignal | null) {
    signal?.throwIfAborted();
    if (version !== sessionVersion) throw new DOMException('Session changed', 'AbortError');
  }

  function refreshSession() {
    if (refreshPromise) return refreshPromise;
    const version = sessionVersion;
    const controller = new AbortController();
    refreshController = controller;
    const timeout = setTimeout(() => controller.abort(new DOMException('Refresh timed out', 'TimeoutError')), 30_000);
    const request = (async () => {
      try {
        const response = await fetcher('/api/auth/refresh', {
          method: 'POST',
          credentials: 'include',
          cache: 'no-store',
          signal: controller.signal,
        });
        assertCurrent(version, controller.signal);
        const payload = await readEnvelope(response);
        assertCurrent(version, controller.signal);
        if (response.status === 401 || response.status === 403) {
          expired = true;
          throw new SessionExpiredError(payload?.message || undefined);
        }
        if (!response.ok || (response.status !== 204 && !payload)
          || payload?.success === false || (payload?.code !== undefined && Number(payload.code) !== 0)) {
          throw new SessionRefreshError(payload?.message || '登录状态暂时无法续期，请稍后重试', response.status);
        }
        refreshVersion += 1;
      } finally {
        clearTimeout(timeout);
        if (refreshController === controller) refreshController = null;
      }
    })();
    refreshPromise = request;
    const clear = () => { if (refreshPromise === request) refreshPromise = null; };
    void request.then(clear, clear);
    return request;
  }

  return {
    reset() {
      sessionVersion += 1;
      refreshVersion = 0;
      expired = false;
      refreshController?.abort();
      refreshController = null;
      refreshPromise = null;
    },

    async fetch(path: string, init: RequestInit = {}) {
      const version = sessionVersion;
      const startedRefreshVersion = refreshVersion;
      assertCurrent(version, init.signal);
      const options: RequestInit = { ...init, credentials: 'include', cache: 'no-store' };
      const response = await fetcher(path, options);
      assertCurrent(version, init.signal);
      if (response.status !== 401 || isPublicAuthRequest(path)) return response;
      if (expired) throw new SessionExpiredError();

      // Concurrent requests share a refresh; a late 401 from the old cookie only needs a retry.
      if (startedRefreshVersion === refreshVersion) {
        await waitForRefresh(refreshSession(), init.signal);
      }
      assertCurrent(version, init.signal);
      const retry = await fetcher(path, options);
      assertCurrent(version, init.signal);
      if (retry.status !== 401) return retry;

      // A channel/API-key 401 is not proof that the user's login session has expired.
      const profile = path.split('?')[0] === '/api/auth/profile'
        ? retry
        : await fetcher('/api/auth/profile', { credentials: 'include', cache: 'no-store', signal: init.signal });
      assertCurrent(version, init.signal);
      if (profile.status === 401) {
        const payload = await readEnvelope(profile);
        assertCurrent(version, init.signal);
        expired = true;
        throw new SessionExpiredError(payload?.message || undefined);
      }
      return retry;
    },
  };
}

export const sessionClient = createSessionClient();
