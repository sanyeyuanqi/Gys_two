import { getRawDb } from '@/db';

const COOKIE_NAME = 'gys_session';
const SESSION_AGE_SECONDS = 7 * 24 * 60 * 60;
const CATEGORIES: Record<string, string[]> = {
  openai: ['gpt-5', 'gpt-5-mini', 'gpt-4.1'],
  anthropic: ['claude-opus-4', 'claude-sonnet-4', 'claude-haiku-3.5'],
  gemini: ['gemini-2.5-pro', 'gemini-2.5-flash'],
  azure: ['gpt-5', 'gpt-4.1'],
  aws: ['claude-sonnet-4', 'claude-haiku-3.5'],
};

type UserRow = {
  id: number;
  username: string;
  display_name: string;
  password_hash: string;
  role: string;
  parent_id: number | null;
  status: number;
  created_at: string;
};

type SessionUser = Pick<UserRow, 'id' | 'username' | 'display_name' | 'role' | 'parent_id' | 'status'>;

class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const encoder = new TextEncoder();
const nowIso = () => new Date().toISOString();
const asInt = (value: string | null, fallback: number, min: number, max: number) => {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= min && number <= max ? number : fallback;
};

async function digest(value: string) {
  const bytes = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function randomToken(prefix = '') {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const token = btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
  return `${prefix}${token}`;
}

function passwordDigest(username: string, password: string) {
  return digest(`gys-v1:${username.toLowerCase()}:${password}`);
}

function publicUser(user: SessionUser) {
  return {
    id: user.id,
    user_id: user.id,
    username: user.username,
    display_name: user.display_name,
    role: user.role,
  };
}

function response(data: unknown, status = 200, headers?: Headers) {
  const finalHeaders = headers || new Headers();
  finalHeaders.set('content-type', 'application/json; charset=utf-8');
  finalHeaders.set('cache-control', 'no-store');
  finalHeaders.set('x-content-type-options', 'nosniff');
  return Response.json({ success: status < 400, data: status < 400 ? data : undefined, message: status >= 400 ? data : undefined }, { status, headers: finalHeaders });
}

async function bodyOf(request: Request) {
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > 1024 * 1024) throw new ApiError(413, '提交内容过大');
  if (!request.body) return {} as Record<string, unknown>;
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new ApiError(415, '请使用 JSON 提交数据');
  const value = await request.json().catch(() => null);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ApiError(400, '提交内容必须是 JSON 对象');
  return value as Record<string, unknown>;
}

function checkOrigin(request: Request) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return;
  if (request.headers.get('sec-fetch-site') === 'cross-site') throw new ApiError(403, '不允许跨站请求');
  const origin = request.headers.get('origin');
  if (origin && new URL(origin).origin !== new URL(request.url).origin) throw new ApiError(403, '请求来源校验失败');
}

function cookieToken(request: Request) {
  const entry = (request.headers.get('cookie') || '').split(';').map((item) => item.trim()).find((item) => item.startsWith(`${COOKIE_NAME}=`));
  return entry?.slice(COOKIE_NAME.length + 1) || '';
}

function setSessionCookie(headers: Headers, request: Request, token: string, age: number) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  headers.set('set-cookie', `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${secure}`);
}

async function audit(userId: number, action: string, detail: string) {
  await getRawDb().prepare('INSERT INTO audit_logs (user_id, action, detail, created_at) VALUES (?, ?, ?, ?)')
    .bind(userId, action, detail, nowIso()).run();
}

async function sessionUser(request: Request): Promise<SessionUser | null> {
  const token = cookieToken(request);
  if (!token) return null;
  const tokenHash = await digest(token);
  const db = getRawDb();
  const user = await db.prepare(`
    SELECT u.id, u.username, u.display_name, u.role, u.parent_id, u.status
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ? AND u.status = 1
  `).bind(tokenHash, Date.now()).first<SessionUser>();
  if (!user) return null;
  await db.prepare('DELETE FROM sessions WHERE expires_at <= ?').bind(Date.now()).run();
  return user;
}

async function requireUser(request: Request) {
  const user = await sessionUser(request);
  if (!user) throw new ApiError(401, '登录状态已失效，请重新登录');
  return user;
}

function accountScope(user: SessionUser) {
  return user.parent_id || user.id;
}

function assertAdmin(user: SessionUser) {
  if (user.role !== 'admin' && user.role !== 'supplier') throw new ApiError(403, '当前账号没有管理权限');
}

async function ensureDemoAdmin(username: string, password: string) {
  if (username.toLowerCase() !== 'admin' || password !== 'admin123') return null;
  const db = getRawDb();
  const createdAt = nowIso();
  const passwordHash = await passwordDigest('admin', 'admin123');
  await db.prepare(`
    INSERT INTO users (username, display_name, password_hash, role, status, created_at)
    VALUES ('admin', '系统管理员', ?, 'admin', 1, ?)
    ON CONFLICT(username) DO NOTHING
  `).bind(passwordHash, createdAt).run();
  const admin = await db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE').bind('admin').first<UserRow>();
  if (!admin) return null;
  await seedDemoData(admin.id);
  return admin;
}

async function seedDemoData(adminId: number) {
  const db = getRawDb();
  const existing = await db.prepare('SELECT COUNT(*) AS count FROM channels WHERE owner_id = ?').bind(adminId).first<{ count: number }>();
  if (Number(existing?.count || 0) > 0) return;
  const createdAt = nowIso();
  const users = [
    ['supplier_demo', '华东供应组'],
    ['supplier_alpha', '北辰渠道组'],
    ['supplier_beta', '云帆供应组'],
  ];
  for (const [username, name] of users) {
    const subPassword = await passwordDigest(username, 'sub123');
    await db.prepare('INSERT INTO users (username, display_name, password_hash, role, parent_id, status, created_at) VALUES (?, ?, ?, ?, ?, 1, ?) ON CONFLICT(username) DO NOTHING')
      .bind(username, name, subPassword, 'sub', adminId, createdAt).run();
  }
  const children = await db.prepare('SELECT id, username FROM users WHERE parent_id = ? ORDER BY id').bind(adminId).all<{ id: number; username: string }>();
  const uploaders = children.results.length ? children.results : [{ id: adminId, username: 'admin' }];
  const seeds = [
    ['openai', '生产主池', 1, 328, 99.2, 0],
    ['anthropic', '企业批次-0901', 1, 276, 97.8, 1],
    ['gemini', '华东弹性池', 1, 194, 96.4, 2],
    ['azure', '备用资源池', 2, 88, 92.1, 5],
    ['aws', '北美临时池', 3, 63, 74.8, 16],
    ['openai', '高优线路', 1, 441, 99.7, 0],
    ['anthropic', '团队专线', 1, 156, 98.5, 1],
    ['gemini', '灰度测试池', 2, 37, 89.4, 7],
  ] as const;
  const statements: D1PreparedStatement[] = [];
  for (let index = 0; index < seeds.length; index++) {
    const [category, tag, status, used, success, errors] = seeds[index];
    const rawKey = `demo-${category}-${index + 1}-sk-example`;
    const uploader = uploaders[index % uploaders.length];
    const hash = await digest(rawKey);
    statements.push(db.prepare(`
      INSERT INTO channels (owner_id, uploader_id, name, category, tag, key_hash, key_masked, status, used_quota, quota, success_rate, req_error, models, remark, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1000, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(owner_id, key_hash) DO NOTHING
    `).bind(adminId, uploader.id, `${category.toUpperCase()}-${String(index + 1).padStart(3, '0')}`, category, tag, hash, `demo-${category.slice(0, 3)}••••${index + 1}`, status, used, success, errors, CATEGORIES[category].join(','), `${uploader.username} 上传`, createdAt, createdAt));
  }
  statements.push(db.prepare('INSERT INTO audit_logs (user_id, action, detail, created_at) VALUES (?, ?, ?, ?)').bind(adminId, 'system.seed', '初始化演示数据', createdAt));
  await db.batch(statements);
}

function channelWhere(user: SessionUser, url: URL) {
  const where = ['c.owner_id = ?'];
  const params: unknown[] = [accountScope(user)];
  if (user.role === 'sub') {
    where.push('c.uploader_id = ?');
    params.push(user.id);
  }
  const status = url.searchParams.get('status');
  const category = url.searchParams.get('category');
  const tag = url.searchParams.get('tag');
  const search = (url.searchParams.get('q') || url.searchParams.get('search') || '').trim();
  if (status && status !== 'all') { where.push('c.status = ?'); params.push(Number(status)); }
  if (category && category !== 'all') { where.push('c.category = ?'); params.push(category); }
  if (tag && tag !== 'all') { where.push('c.tag = ?'); params.push(tag); }
  if (search) {
    where.push('(c.name LIKE ? OR c.tag LIKE ? OR c.key_masked LIKE ? OR c.remark LIKE ?)');
    const value = `%${search.replaceAll('%', '\\%').replaceAll('_', '\\_')}%`;
    params.push(value, value, value, value);
  }
  return { clause: where.join(' AND '), params };
}

async function listChannels(user: SessionUser, url: URL) {
  const db = getRawDb();
  const page = asInt(url.searchParams.get('page'), 1, 1, 100000);
  const pageSize = asInt(url.searchParams.get('page_size'), 20, 1, 500);
  const { clause, params } = channelWhere(user, url);
  const total = await db.prepare(`SELECT COUNT(*) AS count FROM channels c WHERE ${clause}`).bind(...params).first<{ count: number }>();
  const result = await db.prepare(`
    SELECT c.id, c.name, c.category, c.tag, c.key_masked, c.status, c.used_quota, c.quota,
      c.success_rate, c.req_error, c.models, c.remark, c.created_at, c.updated_at,
      c.uploader_id, u.username AS uploader_name, u.display_name AS uploader_display_name
    FROM channels c JOIN users u ON u.id = c.uploader_id
    WHERE ${clause} ORDER BY c.id DESC LIMIT ? OFFSET ?
  `).bind(...params, pageSize, (page - 1) * pageSize).all();
  return { items: result.results, page, page_size: pageSize, total: Number(total?.count || 0) };
}

async function createChannels(user: SessionUser, body: Record<string, unknown>) {
  const db = getRawDb();
  const category = typeof body.category === 'string' ? body.category.trim().toLowerCase() : '';
  const tag = typeof body.tag === 'string' ? body.tag.trim() : '';
  const remark = typeof body.remark === 'string' ? body.remark.trim().slice(0, 240) : '';
  const rawKeys = Array.isArray(body.keys) ? body.keys : typeof body.keys === 'string' ? body.keys.split(/\r?\n/) : typeof body.key === 'string' ? [body.key] : [];
  const keys = [...new Set(rawKeys.map((value) => String(value).trim()).filter(Boolean))].slice(0, 200);
  if (!CATEGORIES[category]) throw new ApiError(400, '请选择有效的渠道分类');
  if (!tag || tag.length > 60) throw new ApiError(400, '请填写 1–60 个字符的标签');
  if (!keys.length) throw new ApiError(400, '请至少填写一条 API Key');
  if (keys.some((key) => key.length < 8 || key.length > 512)) throw new ApiError(400, 'API Key 长度不正确');
  const ownerId = accountScope(user);
  const createdAt = nowIso();
  const statements: D1PreparedStatement[] = [];
  let skipped = 0;
  let nextNumber = Number((await db.prepare('SELECT COALESCE(MAX(id), 0) AS id FROM channels').first<{ id: number }>())?.id || 0) + 1;
  for (const key of keys) {
    const hash = await digest(key);
    const duplicate = await db.prepare('SELECT 1 AS found FROM channels WHERE owner_id = ? AND key_hash = ?').bind(ownerId, hash).first();
    if (duplicate) { skipped++; continue; }
    const masked = key.length <= 12 ? `${key.slice(0, 4)}••••` : `${key.slice(0, 7)}••••${key.slice(-4)}`;
    statements.push(db.prepare(`
      INSERT INTO channels (owner_id, uploader_id, name, category, tag, key_hash, key_masked, status, used_quota, quota, success_rate, req_error, models, remark, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 1000, 100, 0, ?, ?, ?, ?)
    `).bind(ownerId, user.id, `${category.toUpperCase()}-${String(nextNumber++).padStart(3, '0')}`, category, tag, hash, masked, body.standby ? 2 : 1, CATEGORIES[category].join(','), remark, createdAt, createdAt));
  }
  if (statements.length) await db.batch(statements);
  await audit(user.id, 'channel.create', `上传 ${statements.length} 条 ${category} 渠道，跳过 ${skipped} 条重复项`);
  return { total: keys.length, added: statements.length, skipped_dup: skipped, invalid: 0, failed: 0 };
}

async function handleOpenApi(request: Request, url: URL) {
  const token = request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token?.startsWith('gys_')) throw new ApiError(401, 'API Key 缺失或无效');
  const db = getRawDb();
  const tokenHash = await digest(token);
  const key = await db.prepare(`
    SELECT k.id, k.user_id, k.scopes, u.username, u.display_name, u.role, u.parent_id, u.status
    FROM api_keys k JOIN users u ON u.id = k.user_id
    WHERE k.token_hash = ? AND k.status = 1 AND u.status = 1
  `).bind(tokenHash).first<{ id: number; user_id: number; scopes: string; username: string; display_name: string; role: string; parent_id: number | null; status: number }>();
  if (!key) throw new ApiError(401, 'API Key 缺失、无效或已停用');
  const scopes = key.scopes.split(',');
  const user: SessionUser = { id: key.user_id, username: key.username, display_name: key.display_name, role: key.role, parent_id: key.parent_id, status: key.status };
  await db.prepare('UPDATE api_keys SET last_used_at = ? WHERE id = ?').bind(nowIso(), key.id).run();
  if (url.pathname === '/openapi/v1/whoami' && request.method === 'GET') return { ...publicUser(user), scopes: key.scopes };
  if (url.pathname === '/openapi/v1/meta' && request.method === 'GET') {
    if (!scopes.includes('meta:read')) throw new ApiError(403, '当前 Key 缺少 meta:read 权限');
    return { categories: Object.entries(CATEGORIES).map(([category, models]) => ({ category, models })) };
  }
  if (url.pathname === '/openapi/v1/channels' && request.method === 'GET') {
    if (!scopes.includes('channels:read')) throw new ApiError(403, '当前 Key 缺少 channels:read 权限');
    return listChannels(user, url);
  }
  if (url.pathname === '/openapi/v1/channels' && request.method === 'POST') {
    if (!scopes.includes('channels:write')) throw new ApiError(403, '当前 Key 缺少 channels:write 权限');
    return createChannels(user, await bodyOf(request));
  }
  throw new ApiError(404, '接口不存在');
}

async function route(request: Request) {
  const url = new URL(request.url);
  const path = url.pathname;
  const db = getRawDb();
  if (path.startsWith('/openapi/v1/')) return handleOpenApi(request, url);
  checkOrigin(request);

  if (path === '/api/auth/login-captcha' && request.method === 'GET') return { enabled: false };
  if (path === '/api/auth/login' && request.method === 'POST') {
    const body = await bodyOf(request);
    const username = typeof body.username === 'string' ? body.username.trim().slice(0, 80) : '';
    const password = typeof body.password === 'string' ? body.password : '';
    if (!username || !password) throw new ApiError(401, '账号或密码不正确');
    let user = await db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE').bind(username).first<UserRow>();
    if (!user) user = await ensureDemoAdmin(username, password);
    if (!user || user.status !== 1 || user.password_hash !== await passwordDigest(user.username, password)) throw new ApiError(401, '账号或密码不正确');
    const token = randomToken();
    const headers = new Headers();
    setSessionCookie(headers, request, token, SESSION_AGE_SECONDS);
    await db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
      .bind(await digest(token), user.id, Date.now() + SESSION_AGE_SECONDS * 1000, Date.now()).run();
    await audit(user.id, 'auth.login', '登录管理后台');
    return { data: publicUser(user), headers };
  }

  if (path === '/api/auth/logout' && request.method === 'POST') {
    const token = cookieToken(request);
    if (token) await db.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await digest(token)).run();
    const headers = new Headers();
    setSessionCookie(headers, request, '', 0);
    return { data: { message: '已退出登录' }, headers };
  }

  const user = await requireUser(request);
  if ((path === '/api/auth/profile' && request.method === 'GET') || (path === '/api/auth/refresh' && request.method === 'POST')) return publicUser(user);
  if (path === '/api/auth/password' && request.method === 'POST') {
    const body = await bodyOf(request);
    const oldPassword = typeof body.old_password === 'string' ? body.old_password : '';
    const newPassword = typeof body.new_password === 'string' ? body.new_password : '';
    const record = await db.prepare('SELECT password_hash FROM users WHERE id = ?').bind(user.id).first<{ password_hash: string }>();
    if (!record || record.password_hash !== await passwordDigest(user.username, oldPassword)) throw new ApiError(400, '旧密码不正确');
    if (newPassword.length < 6 || newPassword.length > 128) throw new ApiError(400, '新密码长度需为 6–128 位');
    await db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(await passwordDigest(user.username, newPassword), user.id).run();
    await audit(user.id, 'auth.password', '修改登录密码');
    return { message: '密码已修改' };
  }

  if (path === '/api/dashboard' && request.method === 'GET') {
    const scope = accountScope(user);
    const userFilter = user.role === 'sub' ? ' AND uploader_id = ?' : '';
    const params = user.role === 'sub' ? [scope, user.id] : [scope];
    const [summary, categoryRows, attention, supplierCount, logs] = await Promise.all([
      db.prepare(`SELECT COUNT(*) AS total, SUM(CASE WHEN status = 1 THEN 1 ELSE 0 END) AS enabled, SUM(CASE WHEN status != 1 THEN 1 ELSE 0 END) AS disabled, COALESCE(SUM(used_quota), 0) AS quota_used, COALESCE(AVG(success_rate), 0) AS avg_sr FROM channels WHERE owner_id = ?${userFilter}`).bind(...params).first<{ total: number; enabled: number; disabled: number; quota_used: number; avg_sr: number }>(),
      db.prepare(`SELECT category, COUNT(*) AS count FROM channels WHERE owner_id = ?${userFilter} GROUP BY category ORDER BY count DESC`).bind(...params).all(),
      db.prepare(`SELECT id, name, category, tag, status, success_rate, req_error, used_quota FROM channels WHERE owner_id = ?${userFilter} AND (status = 3 OR success_rate < 90) ORDER BY success_rate ASC LIMIT 6`).bind(...params).all(),
      db.prepare('SELECT COUNT(*) AS count FROM users WHERE parent_id = ?').bind(scope).first<{ count: number }>(),
      db.prepare('SELECT action, detail, created_at FROM audit_logs WHERE user_id = ? OR user_id IN (SELECT id FROM users WHERE parent_id = ?) ORDER BY id DESC LIMIT 6').bind(scope, scope).all(),
    ]);
    const totalUsage = Number(summary?.quota_used || 0);
    const trend = Array.from({ length: 7 }, (_, index) => {
      const date = new Date(); date.setDate(date.getDate() - (6 - index));
      const factor = [0.09, 0.12, 0.1, 0.16, 0.14, 0.18, 0.21][index];
      return { date: date.toISOString().slice(5, 10), amount: Math.round(totalUsage * factor) };
    });
    return { channels: summary, categories: categoryRows.results, attention: attention.results, suppliers: Number(supplierCount?.count || 0), trend, logs: logs.results, server_time: nowIso() };
  }

  if (path === '/api/settings/upload-switch' && request.method === 'GET') return { enabled: true, uploadable_categories: Object.keys(CATEGORIES) };
  if (path === '/api/channels/category-models' && request.method === 'GET') {
    const category = url.searchParams.get('category') || '';
    return CATEGORIES[category] || [];
  }
  if (path === '/api/channels' && request.method === 'GET') return listChannels(user, url);
  if ((path === '/api/channels' || path === '/api/channels/batch') && request.method === 'POST') return createChannels(user, await bodyOf(request));
  if (path === '/api/channels/summary' && request.method === 'GET') {
    const scoped = await listChannels(user, new URL('/api/channels?page_size=1', url));
    const result = await db.prepare('SELECT COALESCE(SUM(used_quota), 0) AS total_quota FROM channels WHERE owner_id = ?').bind(accountScope(user)).first<{ total_quota: number }>();
    return { count: scoped.total, total_quota: Number(result?.total_quota || 0) };
  }
  if (path === '/api/channels/tags' && request.method === 'GET') {
    const result = await db.prepare('SELECT DISTINCT tag FROM channels WHERE owner_id = ? ORDER BY tag').bind(accountScope(user)).all<{ tag: string }>();
    return result.results.map((item) => item.tag);
  }
  if (path === '/api/channels/tag-summary' && request.method === 'GET') {
    const result = await db.prepare('SELECT tag, COUNT(*) AS count, SUM(CASE WHEN status = 1 THEN 1 ELSE 0 END) AS enabled, SUM(used_quota) AS used_quota, SUM(quota) AS quota FROM channels WHERE owner_id = ? GROUP BY tag ORDER BY MAX(id) DESC').bind(accountScope(user)).all();
    return { items: result.results, page: 1, page_size: 100, total: result.results.length };
  }
  if (path === '/api/channels/sync' && request.method === 'POST') {
    await audit(user.id, 'channel.sync', '手动同步渠道用量');
    return { message: '用量已同步', synced_at: nowIso() };
  }
  const channelMatch = path.match(/^\/api\/channels\/(\d+)(?:\/(status|test))?$/);
  if (channelMatch) {
    const id = Number(channelMatch[1]);
    const channel = await db.prepare('SELECT id, owner_id, uploader_id, name, category, status, success_rate FROM channels WHERE id = ? AND owner_id = ?').bind(id, accountScope(user)).first<{ id: number; owner_id: number; uploader_id: number; name: string; category: string; status: number; success_rate: number }>();
    if (!channel || (user.role === 'sub' && channel.uploader_id !== user.id)) throw new ApiError(404, '渠道不存在');
    if (channelMatch[2] === 'test' && ['GET', 'POST'].includes(request.method)) {
      const success = channel.status === 1;
      await audit(user.id, 'channel.test', `测试渠道 ${channel.name}`);
      return { success, message: success ? '渠道连接正常' : '渠道当前已停用', latency: success ? 126 + id * 7 % 180 : 0, model: CATEGORIES[channel.category]?.[0] || 'default' };
    }
    if (channelMatch[2] === 'status' && ['PUT', 'PATCH'].includes(request.method)) {
      const body = await bodyOf(request);
      const status = Number(body.status) === 1 ? 1 : 2;
      await db.prepare('UPDATE channels SET status = ?, updated_at = ? WHERE id = ?').bind(status, nowIso(), id).run();
      await audit(user.id, 'channel.status', `${status === 1 ? '启用' : '停用'}渠道 ${channel.name}`);
      return { id, status };
    }
    if (!channelMatch[2] && request.method === 'DELETE') {
      await db.prepare('DELETE FROM channels WHERE id = ?').bind(id).run();
      await audit(user.id, 'channel.delete', `删除渠道 ${channel.name}`);
      return { message: '渠道已删除' };
    }
  }

  if (path === '/api/sub-accounts' && request.method === 'GET') {
    assertAdmin(user);
    const result = await db.prepare(`
      SELECT u.id, u.username, u.display_name, u.status, u.created_at,
        COUNT(c.id) AS channel_count, COALESCE(SUM(c.used_quota), 0) AS used_quota
      FROM users u LEFT JOIN channels c ON c.uploader_id = u.id
      WHERE u.parent_id = ? GROUP BY u.id ORDER BY u.id DESC
    `).bind(accountScope(user)).all();
    return { items: result.results };
  }
  if (path === '/api/sub-accounts' && request.method === 'POST') {
    assertAdmin(user);
    const body = await bodyOf(request);
    const username = typeof body.username === 'string' ? body.username.trim().toLowerCase() : '';
    const displayName = typeof body.display_name === 'string' ? body.display_name.trim() : username;
    const password = typeof body.password === 'string' ? body.password : '';
    if (!/^[a-z0-9_.-]{3,32}$/.test(username)) throw new ApiError(400, '账号需为 3–32 位字母、数字或 ._-');
    if (displayName.length < 2 || displayName.length > 40 || password.length < 6 || password.length > 128) throw new ApiError(400, '名称或密码格式不正确');
    try {
      const result = await db.prepare('INSERT INTO users (username, display_name, password_hash, role, parent_id, status, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)')
        .bind(username, displayName, await passwordDigest(username, password), 'sub', accountScope(user), nowIso()).run();
      await audit(user.id, 'account.create', `创建子账号 ${username}`);
      return { id: result.meta.last_row_id, username, display_name: displayName, status: 1 };
    } catch { throw new ApiError(409, '账号名已存在'); }
  }
  const accountMatch = path.match(/^\/api\/sub-accounts\/(\d+)$/);
  if (accountMatch) {
    assertAdmin(user);
    const id = Number(accountMatch[1]);
    const child = await db.prepare('SELECT id, username, status FROM users WHERE id = ? AND parent_id = ?').bind(id, accountScope(user)).first<{ id: number; username: string; status: number }>();
    if (!child) throw new ApiError(404, '子账号不存在');
    if (['PUT', 'PATCH'].includes(request.method)) {
      const body = await bodyOf(request);
      const status = Number(body.status) === 1 ? 1 : 0;
      await db.prepare('UPDATE users SET status = ? WHERE id = ?').bind(status, id).run();
      if (!status) await db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id).run();
      await audit(user.id, 'account.status', `${status ? '启用' : '停用'}子账号 ${child.username}`);
      return { id, status };
    }
    if (request.method === 'DELETE') {
      await db.prepare('DELETE FROM users WHERE id = ?').bind(id).run();
      await audit(user.id, 'account.delete', `删除子账号 ${child.username}`);
      return { message: '子账号已删除' };
    }
  }

  if (path === '/api/apikeys' && request.method === 'GET') {
    const result = await db.prepare('SELECT id, name, prefix, scopes, status, last_used_at, created_at FROM api_keys WHERE user_id = ? ORDER BY id DESC').bind(user.id).all();
    return result.results;
  }
  if (path === '/api/apikeys' && request.method === 'POST') {
    const body = await bodyOf(request);
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const scopes = typeof body.scopes === 'string' ? body.scopes.split(',').filter(Boolean) : [];
    if (!name || name.length > 60 || !scopes.length || scopes.some((scope) => !['channels:read', 'channels:write', 'meta:read'].includes(scope))) throw new ApiError(400, '名称或权限不正确');
    const key = randomToken('gys_');
    const prefix = `${key.slice(0, 12)}…`;
    const result = await db.prepare('INSERT INTO api_keys (user_id, name, prefix, token_hash, scopes, status, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)')
      .bind(user.id, name, prefix, await digest(key), scopes.join(','), nowIso()).run();
    await audit(user.id, 'apikey.create', `创建开放 API Key：${name}`);
    return { key, item: { id: result.meta.last_row_id, name, prefix, scopes: scopes.join(','), status: 1, created_at: nowIso() } };
  }
  const keyMatch = path.match(/^\/api\/apikeys\/(\d+)$/);
  if (keyMatch && request.method === 'DELETE') {
    await db.prepare('UPDATE api_keys SET status = 0 WHERE id = ? AND user_id = ?').bind(Number(keyMatch[1]), user.id).run();
    await audit(user.id, 'apikey.revoke', `停用开放 API Key #${keyMatch[1]}`);
    return { message: 'API Key 已停用' };
  }

  if (path === '/api/disable-keywords' && request.method === 'GET') {
    const result = await db.prepare('SELECT id, keyword, status FROM disable_keywords WHERE user_id = ? ORDER BY id DESC').bind(accountScope(user)).all();
    return result.results;
  }
  if (path === '/api/disable-keywords' && request.method === 'POST') {
    const body = await bodyOf(request);
    const keyword = typeof body.keyword === 'string' ? body.keyword.trim() : '';
    if (!keyword || keyword.length > 40) throw new ApiError(400, '关键词格式不正确');
    await db.prepare('INSERT INTO disable_keywords (user_id, keyword, status, created_at) VALUES (?, ?, 1, ?) ON CONFLICT(user_id, keyword) DO UPDATE SET status = 1').bind(accountScope(user), keyword, nowIso()).run();
    return { keyword, status: 1 };
  }

  if (path === '/api/stats/daily' && request.method === 'GET') {
    const result = await db.prepare('SELECT id, name AS channel_name, category, used_quota FROM channels WHERE owner_id = ? ORDER BY used_quota DESC').bind(accountScope(user)).all<{ id: number; channel_name: string; category: string; used_quota: number }>();
    const total = result.results.reduce((sum, item) => sum + Number(item.used_quota || 0), 0);
    const days = Array.from({ length: 14 }, (_, index) => {
      const date = new Date(); date.setDate(date.getDate() - (13 - index));
      const ratio = 0.035 + (index % 5) * 0.012;
      const quota = Math.round(total * ratio);
      return { date: date.toISOString().slice(0, 10), quota, total_quota: quota, usd: quota, channels: result.results.slice(0, 4).map((item) => ({ id: item.id, channel_name: item.channel_name, category: item.category, quota: Math.round(item.used_quota * ratio) })) };
    });
    return { days, start: days[0].date, end: days.at(-1)?.date, total_quota: days.reduce((sum, day) => sum + day.quota, 0) };
  }
  if (path === '/api/model-gaps' && request.method === 'GET') {
    return Object.entries(CATEGORIES).flatMap(([platform, models], platformIndex) => models.slice(0, 2).map((model, index) => ({ platform_type: platform, platform_type_name: platform.toUpperCase(), model_name: model, gap_rpm: (platformIndex + 1) * 120 + index * 45, gap_tpm_est: (platformIndex + 1) * 180000 + index * 40000 })));
  }

  throw new ApiError(404, '接口不存在');
}

export async function handleApi(request: Request) {
  try {
    const result = await route(request);
    if (result && typeof result === 'object' && 'headers' in result && 'data' in result) {
      const wrapped = result as { data: unknown; headers: Headers };
      return response(wrapped.data, 200, wrapped.headers);
    }
    return response(result);
  } catch (error) {
    if (!(error instanceof ApiError)) console.error('GYS API error', error);
    const status = error instanceof ApiError ? error.status : 500;
    const message = error instanceof ApiError ? error.message : '服务暂时不可用，请稍后重试';
    const headers = new Headers();
    if (status === 401) setSessionCookie(headers, request, '', 0);
    return response(message, status, headers);
  }
}
