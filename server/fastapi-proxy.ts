const DEFAULT_FASTAPI_ORIGIN = 'http://127.0.0.1:8000';
const FORWARDED_HEADERS = [
  'accept',
  'authorization',
  'content-type',
  'cookie',
  'origin',
  'sec-fetch-site',
] as const;

function errorResponse(message: string, status = 502) {
  return Response.json(
    {
      success: false,
      code: status * 100 + 1,
      message,
      request_id: crypto.randomUUID(),
    },
    {
      status,
      headers: {
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      },
    },
  );
}

function setCookieValues(response: Response) {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  const values = headers.getSetCookie?.() || [];
  if (values.length) return values;
  const value = response.headers.get('set-cookie');
  return value ? [value] : [];
}

export async function proxyFastApi(request: Request) {
  const configured = process.env.GYS_FASTAPI_ORIGIN || DEFAULT_FASTAPI_ORIGIN;
  let backendOrigin: URL;
  try {
    backendOrigin = new URL(configured);
  } catch {
    return errorResponse('服务器暂不可用，请稍后重试');
  }
  if (!['http:', 'https:'].includes(backendOrigin.protocol) || backendOrigin.pathname !== '/') {
    return errorResponse('服务器暂不可用，请稍后重试');
  }

  const source = new URL(request.url);
  const target = new URL(`${source.pathname}${source.search}`, backendOrigin);
  const headers = new Headers();
  for (const name of FORWARDED_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  headers.set('x-gys-public-origin', source.origin);
  headers.set('x-forwarded-host', source.host);
  headers.set('x-forwarded-proto', source.protocol.slice(0, -1));
  const forwardedFor = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for');
  if (forwardedFor) headers.set('x-forwarded-for', forwardedFor.split(',')[0].trim());

  let body: ArrayBuffer | undefined;
  if (!['GET', 'HEAD'].includes(request.method)) {
    const value = await request.arrayBuffer();
    if (value.byteLength) body = value;
  }

  let response: Response;
  try {
    response = await fetch(target, {
      method: request.method,
      headers,
      body,
      redirect: 'manual',
      cache: 'no-store',
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(65_000)]),
    });
  } catch {
    return errorResponse('服务器暂不可用，请稍后重试');
  }

  const responseHeaders = new Headers({
    'cache-control': response.headers.get('cache-control') || 'no-store',
    'content-type': response.headers.get('content-type') || 'application/json; charset=utf-8',
    'x-content-type-options': 'nosniff',
  });
  for (const value of setCookieValues(response)) responseHeaders.append('set-cookie', value);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
  });
}
