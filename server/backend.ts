import { getRawDb } from '@/db';
import { CookieJar } from 'tough-cookie';
import { createPlatformUsageLoader, UsageDataError } from './platform-usage';

const UPSTREAM_ORIGIN = 'https://gys.oljuxj.xyz';
const COOKIE_NAME = 'key_system_session';
const DAY = 86_400_000;
const PUBLIC_AUTH = new Set([
  '/api/auth/login-captcha',
  '/api/auth/captcha/slide',
  '/api/auth/captcha/slide/check',
]);
const READ_PATHS = [
  /^\/api\/(dashboard|channels|sub-accounts|apikeys|model-gaps|disable-keywords)$/,
  /^\/api\/channels\/(summary|tags|tag-summary|category-models)$/,
  /^\/api\/channels\/\d+\/(usage|logs|key-usage|sync-detail|test)$/,
  /^\/api\/(stats\/daily|settings\/upload-switch)$/,
];
const WRITE_PATHS: Record<string, RegExp[]> = {
  POST: [
    /^\/api\/channels(?:\/batch|\/sync)?$/,
    /^\/api\/channels\/\d+\/status$/,
    /^\/api\/(apikeys|disable-keywords)$/,
  ],
  PUT: [/^\/api\/channels\/\d+(?:\/status)?$/],
  PATCH: [],
  DELETE: [/^\/api\/(channels|apikeys)\/\d+$/],
};

type SessionRow = {
  token_hash: string;
  upstream_user_id: number | null;
  username: string | null;
  display_name: string | null;
  role: string | null;
  cookies: string;
  authenticated: number;
  created_at: number;
  expires_at: number;
};

type UpstreamOptions = {
  method?: string;
  body?: Record<string, unknown>;
  signal?: AbortSignal | null;
};

type UpstreamResult = {
  response: Response;
  payload: Record<string, unknown>;
};

class BackendError extends Error {
  constructor(
    public status: number,
    message: string,
    public requestId?: string,
  ) {
    super(message);
  }
}

const encoder = new TextEncoder();

async function digest(value: string) {
  const bytes = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
}

function sessionToken(request: Request) {
  const entry = (request.headers.get('cookie') || '')
    .split(';')
    .map((value) => value.trim())
    .find((value) => value.startsWith(`${COOKIE_NAME}=`));
  return entry?.slice(COOKIE_NAME.length + 1) || '';
}

function cookieHeader(request: Request, token: string, age: number) {
  const secure = new URL(request.url).protocol === 'https:';
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${secure ? '; Secure' : ''}`;
}

function checkOrigin(request: Request) {
  if (request.headers.get('sec-fetch-site') === 'cross-site') {
    throw new BackendError(403, '不允许跨站请求');
  }
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return;
  const origin = request.headers.get('origin');
  if (origin && new URL(origin).origin !== new URL(request.url).origin) {
    throw new BackendError(403, '请求来源校验失败');
  }
}

async function readBody(request: Request) {
  if (!request.body) return {} as Record<string, unknown>;
  const contentType = request.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  if (contentType !== 'application/json') throw new BackendError(415, '请使用 JSON 提交数据');
  const text = await request.text();
  if (!text) return {} as Record<string, unknown>;
  if (new Blob([text]).size > 4 * 1024 * 1024) throw new BackendError(413, '提交内容过大');
  try {
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch {
    throw new BackendError(400, '提交内容必须是 JSON 对象');
  }
}

async function getSession(token: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const db = getRawDb();
  const hash = await digest(token);
  const session = await db.prepare(
    'SELECT * FROM upstream_sessions WHERE token_hash = ? AND expires_at > ?',
  ).bind(hash, Date.now()).first<SessionRow>();
  if (!session || session.created_at + 30 * DAY <= Date.now()) return null;
  return session;
}

function validateProfile(profile: Record<string, unknown>) {
  const id = Number(profile.user_id ?? profile.id);
  const username = typeof profile.username === 'string' ? profile.username.trim() : '';
  const displayName = typeof profile.display_name === 'string' && profile.display_name.trim()
    ? profile.display_name.trim()
    : username;
  const role = typeof profile.role === 'string' ? profile.role : '';
  if (!Number.isSafeInteger(id) || id <= 0 || !username || !['admin', 'supplier', 'sub'].includes(role)) {
    throw new BackendError(502, '原 GYS 数据服务返回了无效账号信息');
  }
  return { id, user_id: id, username, display_name: displayName, role };
}

async function createSession(
  profile: Record<string, unknown> | null = null,
  cookies = JSON.stringify(new CookieJar().toJSON()),
) {
  const db = getRawDb();
  const token = randomToken();
  const tokenHash = await digest(token);
  const now = Date.now();
  const authenticated = profile ? 1 : 0;
  const lifetime = authenticated ? 7 * DAY : 10 * 60_000;
  const parsed = profile ? validateProfile(profile) : null;
  await db.prepare('DELETE FROM upstream_sessions WHERE expires_at <= ?').bind(now).run();
  await db.prepare(`
    INSERT INTO upstream_sessions
      (token_hash, upstream_user_id, username, display_name, role, cookies, authenticated, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    tokenHash,
    parsed?.id ?? null,
    parsed?.username ?? null,
    parsed?.display_name ?? null,
    parsed?.role ?? null,
    cookies,
    authenticated,
    now,
    now + lifetime,
  ).run();
  const session = await db.prepare('SELECT * FROM upstream_sessions WHERE token_hash = ?')
    .bind(tokenHash).first<SessionRow>();
  if (!session) throw new BackendError(503, '会话服务暂时不可用');
  return { token, session };
}

async function deleteSession(session: SessionRow | null) {
  if (!session) return;
  await getRawDb().prepare('DELETE FROM upstream_sessions WHERE token_hash = ?')
    .bind(session.token_hash).run();
}

async function touchSession(session: SessionRow) {
  const expiresAt = Math.min(session.created_at + 30 * DAY, Date.now() + 7 * DAY);
  await getRawDb().prepare('UPDATE upstream_sessions SET expires_at = ? WHERE token_hash = ?')
    .bind(expiresAt, session.token_hash).run();
  return Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
}

async function loadCurrentSession(session: SessionRow) {
  return await getRawDb().prepare('SELECT * FROM upstream_sessions WHERE token_hash = ?')
    .bind(session.token_hash).first<SessionRow>() || session;
}

function loadJar(serialized: string) {
  try {
    return CookieJar.fromJSON(JSON.parse(serialized));
  } catch {
    return new CookieJar();
  }
}

function responseCookies(response: Response) {
  const responseHeaders = response.headers as Headers & { getSetCookie?: () => string[] };
  const values = responseHeaders.getSetCookie?.() || [];
  if (values.length) return values;
  const single = response.headers.get('set-cookie');
  return single ? [single] : [];
}

async function upstreamRaw(session: SessionRow, path: string, options: UpstreamOptions = {}): Promise<UpstreamResult> {
  const url = new URL(path, UPSTREAM_ORIGIN);
  if (url.origin !== UPSTREAM_ORIGIN || !url.pathname.startsWith('/api/')) {
    throw new BackendError(400, '无效的数据接口');
  }
  const current = await loadCurrentSession(session);
  const jar = loadJar(current.cookies);
  const headers = new Headers({
    accept: 'application/json',
    origin: UPSTREAM_ORIGIN,
    referer: `${UPSTREAM_ORIGIN}/`,
  });
  const cookie = await jar.getCookieString(url.href);
  if (cookie) headers.set('cookie', cookie);
  if (options.body !== undefined) headers.set('content-type', 'application/json');

  let response: Response;
  try {
    const timeout = AbortSignal.timeout(60_000);
    const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
    response = await fetch(url.href, {
      method: options.method || 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      redirect: 'manual',
      cache: 'no-store',
      signal,
    });
  } catch (error) {
    if (options.signal?.aborted) throw error;
    throw new BackendError(502, '原 GYS 数据服务暂时不可用，请稍后重试');
  }

  const setCookies = responseCookies(response);
  if (setCookies.length) {
    const latest = await loadCurrentSession(session);
    const merged = loadJar(latest.cookies);
    for (const value of setCookies) await merged.setCookie(value, url.href, { ignoreError: true });
    await getRawDb().prepare('UPDATE upstream_sessions SET cookies = ? WHERE token_hash = ?')
      .bind(JSON.stringify(merged.toJSON()), session.token_hash).run();
  }

  const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!payload) throw new BackendError(502, '原 GYS 数据服务返回了无效响应');
  return { response, payload };
}

function unwrap(result: UpstreamResult) {
  const { response, payload } = result;
  const code = Number(payload.code);
  if (!response.ok || payload.success === false || (payload.code !== undefined && code !== 0)) {
    const mapped: Record<number, number> = {
      40001: 400,
      40101: 401,
      40301: 403,
      40401: 404,
      50001: 500,
    };
    throw new BackendError(
      response.ok ? mapped[code] || 400 : response.status,
      typeof payload.message === 'string' ? payload.message : '原 GYS 数据服务请求失败',
      typeof payload.request_id === 'string' ? payload.request_id : undefined,
    );
  }
  return payload.data ?? payload;
}

async function upstreamJson(session: SessionRow, path: string, options: UpstreamOptions = {}) {
  return unwrap(await upstreamRaw(session, path, options));
}

async function authorizedJson(session: SessionRow, path: string, options: UpstreamOptions = {}) {
  let result = await upstreamRaw(session, path, options);
  if (result.response.status !== 401) return unwrap(result);
  try {
    await upstreamJson(session, '/api/auth/refresh', { method: 'POST', body: {}, signal: options.signal });
  } catch (error) {
    if (error instanceof BackendError && [401, 403].includes(error.status)) {
      throw new BackendError(401, '登录状态已失效，请重新登录', error.requestId);
    }
    throw error;
  }
  options.signal?.throwIfAborted();
  result = await upstreamRaw(session, path, options);
  if (result.response.status === 401) throw new BackendError(401, '登录状态已失效，请重新登录');
  return unwrap(result);
}

async function saveProfile(session: SessionRow, profile: Record<string, unknown>) {
  const parsed = validateProfile(profile);
  await getRawDb().prepare(`
    UPDATE upstream_sessions
    SET upstream_user_id = ?, username = ?, display_name = ?, role = ?, authenticated = 1
    WHERE token_hash = ?
  `).bind(parsed.id, parsed.username, parsed.display_name, parsed.role, session.token_hash).run();
  return parsed;
}

function publicProfile(session: SessionRow) {
  if (!session.authenticated || !session.upstream_user_id || !session.username || !session.role) {
    throw new BackendError(401, '请登录原 GYS 账号');
  }
  return {
    id: session.upstream_user_id,
    user_id: session.upstream_user_id,
    username: session.username,
    display_name: session.display_name || session.username,
    role: session.role,
  };
}

function sanitizeData(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeData);
  if (!value || typeof value !== 'object') return value;
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (['key_full', 'access_token', 'refresh_token', 'password', 'password_hash'].includes(key)) continue;
    result[key] = sanitizeData(item);
  }
  return result;
}

async function withinLimit(name: string, maximum: number, windowMs: number) {
  const db = getRawDb();
  const key = await digest(name);
  const now = Date.now();
  const row = await db.prepare('SELECT count, expires_at FROM upstream_rate_limits WHERE name = ?')
    .bind(key).first<{ count: number; expires_at: number }>();
  if (!row || row.expires_at <= now) {
    await db.prepare(`
      INSERT INTO upstream_rate_limits (name, count, expires_at) VALUES (?, 1, ?)
      ON CONFLICT(name) DO UPDATE SET count = 1, expires_at = excluded.expires_at
    `).bind(key, now + windowMs).run();
    return true;
  }
  await db.prepare('UPDATE upstream_rate_limits SET count = count + 1 WHERE name = ?').bind(key).run();
  return row.count + 1 <= maximum;
}

function dollars(value: unknown) {
  return (Number(value || 0) / 500_000).toFixed(4);
}

async function forwardOpenApi(request: Request, requestId: string, headers: Headers) {
  const url = new URL(request.url);
  const path = url.pathname;
  const allowed =
    (path === '/openapi/v1/whoami' && request.method === 'GET') ||
    (path === '/openapi/v1/meta' && request.method === 'GET') ||
    (path === '/openapi/v1/channels' && ['GET', 'POST'].includes(request.method));
  if (!allowed) throw new BackendError(404, '接口不存在');
  const authorization = request.headers.get('authorization');
  if (!authorization?.match(/^Bearer\s+\S+$/i)) throw new BackendError(401, 'API Key 缺失、无效或已停用');
  for (const field of ['user_id', 'supplier_id', 'uploader_id']) {
    if (url.searchParams.has(field)) throw new BackendError(400, '不允许指定数据账号');
  }
  const body = request.method === 'POST' ? await readBody(request) : undefined;
  if (body && ['user_id', 'supplier_id', 'uploader_id', 'role'].some((field) => field in body)) {
    throw new BackendError(400, '不允许指定数据账号');
  }
  let response: Response;
  try {
    response = await fetch(`${UPSTREAM_ORIGIN}${path}${url.search}`, {
      method: request.method,
      headers: {
        accept: 'application/json',
        authorization,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'manual',
      cache: 'no-store',
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(60_000)]),
    });
  } catch {
    throw new BackendError(502, '原 GYS 数据服务暂时不可用，请稍后重试');
  }
  const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!payload) throw new BackendError(502, '原 GYS 数据服务返回了无效响应');
  const data = unwrap({ response, payload });
  return Response.json(
    { success: true, data: sanitizeData(data), request_id: requestId },
    { headers },
  );
}

export async function handleApi(request: Request) {
  const headers = new Headers({
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
    'x-content-type-options': 'nosniff',
  });
  const requestId = crypto.randomUUID();
  const respond = (data: unknown) => Response.json(
    { success: true, data, request_id: requestId },
    { headers },
  );

  try {
    const url = new URL(request.url);
    const path = url.pathname;
    if (path.startsWith('/openapi/v1/')) return await forwardOpenApi(request, requestId, headers);
    checkOrigin(request);

    let token = sessionToken(request);
    let session = await getSession(token);
    const ip = request.headers.get('cf-connecting-ip') || 'unknown';

    if (PUBLIC_AUTH.has(path)) {
      const method = path.endsWith('/check') ? 'POST' : 'GET';
      if (request.method !== method) throw new BackendError(405, '不支持此操作');
      if (!await withinLimit(`public-auth:${ip}`, 120, 60_000)) {
        throw new BackendError(429, '请求过于频繁，请稍后重试');
      }
      if (!session || session.authenticated) {
        ({ token, session } = await createSession());
        headers.set('set-cookie', cookieHeader(request, token, 600));
      }
      const data = await upstreamJson(session, path, {
        method,
        body: method === 'POST' ? await readBody(request) : undefined,
        signal: request.signal,
      });
      return respond(sanitizeData(data));
    }

    if (path === '/api/auth/login' && request.method === 'POST') {
      const body = await readBody(request);
      const username = typeof body.username === 'string' ? body.username.trim() : '';
      const password = typeof body.password === 'string' ? body.password : '';
      if (!username || !password || username.length > 128 || password.length > 4096) {
        throw new BackendError(401, '账号或密码不正确');
      }
      if (!await withinLimit(`login:${ip}:${username.toLowerCase()}`, 10, 5 * 60_000)) {
        throw new BackendError(429, '登录尝试过多，请五分钟后重试');
      }
      if (!session || session.authenticated) ({ token, session } = await createSession());
      let profile: unknown;
      try {
        profile = await upstreamJson(session, '/api/auth/login', {
          method: 'POST',
          body: {
            username,
            password,
            ...(typeof body.captcha_token === 'string' ? { captcha_token: body.captcha_token } : {}),
          },
          signal: request.signal,
        });
      } catch (error) {
        if (error instanceof BackendError && error.status >= 400 && error.status < 500) {
          throw new BackendError(error.status, error.message || '账号、密码或验证码不正确', error.requestId);
        }
        throw error;
      }
      if (!profile || typeof profile !== 'object' || Array.isArray(profile)) {
        throw new BackendError(502, '原 GYS 数据服务返回了无效账号信息');
      }
      const parsed = validateProfile(profile as Record<string, unknown>);
      const latest = await loadCurrentSession(session);
      const oldSession = session;
      ({ token, session } = await createSession(profile as Record<string, unknown>, latest.cookies));
      await deleteSession(oldSession);
      headers.set('set-cookie', cookieHeader(request, token, 7 * 86_400));
      return respond(parsed);
    }

    if (path === '/api/auth/logout' && request.method === 'POST') {
      await deleteSession(session);
      headers.set('set-cookie', cookieHeader(request, '', 0));
      return respond({ message: '已退出登录' });
    }

    if (!session?.authenticated) throw new BackendError(401, '请登录原 GYS 账号');
    headers.set('set-cookie', cookieHeader(request, token, await touchSession(session)));

    if (path === '/api/auth/profile' && request.method === 'GET') {
      const profile = await authorizedJson(session, path, { signal: request.signal });
      if (!profile || typeof profile !== 'object' || Array.isArray(profile)) return respond(publicProfile(session));
      return respond(await saveProfile(session, profile as Record<string, unknown>));
    }

    if (path === '/api/auth/refresh' && request.method === 'POST') {
      await upstreamJson(session, path, { method: 'POST', body: {}, signal: request.signal });
      const profile = await upstreamJson(session, '/api/auth/profile', { signal: request.signal });
      if (!profile || typeof profile !== 'object' || Array.isArray(profile)) return respond(publicProfile(session));
      return respond(await saveProfile(session, profile as Record<string, unknown>));
    }

    if (path === '/api/auth/password' && request.method === 'POST') {
      const body = await readBody(request);
      if (
        typeof body.old_password !== 'string' ||
        typeof body.new_password !== 'string' ||
        body.new_password.length < 6 ||
        body.new_password.length > 4096
      ) throw new BackendError(400, '密码格式不正确');
      return respond(sanitizeData(await authorizedJson(session, path, {
        method: 'POST',
        body,
        signal: request.signal,
      })));
    }

    const usageMatch = path.match(/^\/api\/sub-accounts\/(\d+)\/platform-usage$/);
    if (usageMatch && request.method === 'GET') {
      if (!['supplier', 'admin'].includes(session.role || '')) {
        throw new BackendError(403, '当前账号无权管理子账号');
      }
      const targetId = Number(usageMatch[1]);
      if (!Number.isSafeInteger(targetId) || targetId <= 0) throw new BackendError(404, '子账号不存在');
      const children = await authorizedJson(session, '/api/sub-accounts', { signal: request.signal }) as {
        items?: Array<Record<string, unknown>>;
      } | Array<Record<string, unknown>>;
      const items = Array.isArray(children) ? children : children.items || [];
      const source = items.find((item) => Number(item.id) === targetId);
      if (!source) throw new BackendError(404, '子账号不存在');
      const loader = createPlatformUsageLoader(<T,>(loaderPath: string, init: { signal: AbortSignal }) =>
        authorizedJson(session, loaderPath, { signal: init.signal }) as Promise<T>);
      const summary = await loader(targetId, { signal: request.signal });
      return respond({
        totalAmount: dollars(summary.totalQuota),
        channelCount: summary.channelCount,
        listedAmount: source.used_quota === undefined ? null : dollars(source.used_quota),
        amountsDiffer: source.used_quota !== undefined && Number(source.used_quota) !== summary.totalQuota,
        platforms: summary.platforms.map((item) => ({
          category: item.category,
          channelCount: item.channelCount,
          amount: dollars(item.quota),
          sharePercent: (item.share * 100).toFixed(2),
        })),
      });
    }

    const allowed = request.method === 'GET' ? READ_PATHS : WRITE_PATHS[request.method] || [];
    if (!allowed.some((pattern) => pattern.test(path))) throw new BackendError(404, '接口不存在');
    for (const key of ['user_id', 'supplier_id', 'uploader_id', 'upstream_id']) {
      if (url.searchParams.has(key)) throw new BackendError(400, '不允许指定数据账号');
    }
    const body = ['GET', 'DELETE'].includes(request.method) ? undefined : await readBody(request);
    if (body && ['user_id', 'supplier_id', 'uploader_id', 'role', 'username', 'password'].some((key) => key in body)) {
      throw new BackendError(400, '不允许修改账号归属');
    }
    const data = await authorizedJson(session, `${path}${url.search}`, {
      method: request.method,
      body,
      signal: request.signal,
    }) as Record<string, unknown>;

    if (path === '/api/stats/daily' && data && typeof data === 'object' && !Array.isArray(data)) {
      const days = Array.isArray(data.days) ? data.days as Array<Record<string, unknown>> : [];
      const maxQuota = Math.max(0, ...days.map((day) => Number(day.total_quota ?? day.quota ?? 0)));
      data.average_quota = days.length ? Math.round(Number(data.total_quota || 0) / days.length) : 0;
      data.days = days.map((day) => ({
        ...day,
        share_percent: maxQuota
          ? Math.round(Number(day.total_quota ?? day.quota ?? 0) / maxQuota * 100)
          : 0,
        active_channel_count: Array.isArray(day.channels)
          ? day.channels.filter((channel) => Number((channel as Record<string, unknown>).quota || 0) > 0).length
          : 0,
      }));
    }
    return respond(sanitizeData(data));
  } catch (error) {
    let status = error instanceof BackendError ? error.status : 500;
    let message = error instanceof BackendError ? error.message : '服务暂时不可用，请稍后重试';
    if (error instanceof UsageDataError) {
      status = 502;
      message = {
        invalid: '渠道数据缺少有效的上传用户或额度信息，无法准确统计。',
        incomplete: '渠道分页数据不完整，请刷新重试。',
        changed: '读取期间渠道记录发生变化，请刷新重试。',
      }[error.code];
    }
    if (status === 401 && !new URL(request.url).pathname.startsWith('/openapi/')) {
      headers.set('set-cookie', cookieHeader(request, '', 0));
    }
    return Response.json(
      {
        success: false,
        code: status * 100 + 1,
        message,
        request_id: error instanceof BackendError && error.requestId ? error.requestId : requestId,
      },
      { status, headers },
    );
  }
}
