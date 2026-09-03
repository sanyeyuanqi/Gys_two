'use client';

import {
  Activity, AlertTriangle, ArrowRight, Boxes, Braces, CheckCircle2, ChevronRight,
  CircleDollarSign, Clipboard, CloudUpload, Copy, Database, Gauge, KeyRound, LayoutDashboard,
  Loader2, LockKeyhole, LogOut, Menu, MoreHorizontal, Plus, RefreshCcw, Search, Settings,
  ShieldCheck, Sparkles, TestTube2, Trash2, UserPlus, UserRound, Users, X, Zap,
  type LucideIcon,
} from 'lucide-react';
import { type ReactNode, type SyntheticEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';

type Profile = { id: number; username: string; display_name: string; role: string };
type PageKey = 'dashboard' | 'upload' | 'channels' | 'accounts' | 'api';
type Notice = { type: 'ok' | 'error'; text: string } | null;
type DashboardData = {
  channels: { total: number; enabled: number; disabled: number; quota_used: number; avg_sr: number };
  categories: Array<{ category: string; count: number }>;
  attention: Array<{ id: number; name: string; category: string; tag: string; status: number; success_rate: number; req_error: number; used_quota: number }>;
  suppliers: number;
  trend: Array<{ date: string; amount: number }>;
  logs: Array<{ action: string; detail: string; created_at: string }>;
};
type Channel = {
  id: number; name: string; category: string; tag: string; key_masked: string; status: number;
  used_quota: number; quota: number; success_rate: number; req_error: number; models: string;
  remark: string; created_at: string; uploader_name: string; uploader_display_name: string;
};
type ChannelPage = { items: Channel[]; page: number; page_size: number; total: number };
type Account = { id: number; username: string; display_name: string; status: number; channel_count: number; used_quota: number; created_at: string };
type ApiKey = { id: number; name: string; prefix: string; scopes: string; status: number; created_at: string; last_used_at?: string | null };

type ModelTool = {
  name: string;
  title?: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: { readOnlyHint?: boolean; untrustedContentHint?: boolean };
  execute(input: unknown): Promise<unknown>;
};

declare global {
  interface Document {
    modelContext?: { registerTool(tool: ModelTool, options?: { signal?: AbortSignal }): void | Promise<void> };
  }
}

const categoryLabel: Record<string, string> = {
  openai: 'OpenAI', anthropic: 'Anthropic', gemini: 'Gemini', azure: 'Azure OpenAI', aws: 'AWS Bedrock',
};
const categoryTone: Record<string, string> = {
  openai: 'tone-blue', anthropic: 'tone-orange', gemini: 'tone-purple', azure: 'tone-cyan', aws: 'tone-yellow',
};
const navigation: Array<{ key: PageKey; label: string; hint: string; icon: LucideIcon }> = [
  { key: 'dashboard', label: '控制台', hint: '全局概览', icon: LayoutDashboard },
  { key: 'upload', label: '上传密钥', hint: '单个或批量', icon: CloudUpload },
  { key: 'channels', label: '渠道管理', hint: '状态与消耗', icon: Boxes },
  { key: 'accounts', label: '子账号', hint: '供应商成员', icon: Users },
  { key: 'api', label: '开放 API', hint: '集成与权限', icon: Braces },
];

async function api<T>(path: string, init: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const result = await fetch(path, {
    method: init.method || 'GET', credentials: 'include', signal: init.signal,
    headers: init.body === undefined ? undefined : { 'content-type': 'application/json' },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const payload = await result.json().catch(() => null) as { success?: boolean; data?: T; message?: string } | null;
  if (!result.ok || !payload?.success) throw new Error(payload?.message || `请求失败（${result.status}）`);
  return payload.data as T;
}

const money = (value: number) => `¥${Number(value || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dateText = (value?: string | null) => value ? new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(value)) : '暂无';
const statusText = (status: number) => status === 1 ? '启用' : status === 3 ? '自动停用' : '停用';

function LoadingScreen() {
  return <main className="boot-screen"><span className="brand-mark"><KeyRound size={24} /></span><Loader2 className="spin" size={22} /><p>正在连接 GYS 管理后台</p></main>;
}

function Login({ onLogin }: { onLogin: (profile: Profile) => void }) {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('admin123');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const submit = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault(); setLoading(true); setError('');
    try { onLogin(await api<Profile>('/api/auth/login', { method: 'POST', body: { username, password } })); }
    catch (failure) { setError(failure instanceof Error ? failure.message : '登录失败'); }
    finally { setLoading(false); }
  };
  return (
    <main className="login-shell">
      <section className="login-story" aria-label="GYS 系统介绍">
        <div className="brand-lockup"><span className="brand-mark"><KeyRound size={24} /></span><span>GYS</span></div>
        <div className="story-copy">
          <span className="eyebrow"><Sparkles size={14} /> SUPPLIER OPERATIONS</span>
          <h1>把每一把密钥，<br />变成清晰可控的渠道。</h1>
          <p>统一管理供应商、API 密钥、渠道状态与消费数据，让交付、排障和结算都更简单。</p>
        </div>
        <div className="feature-row"><span><Activity size={17} /> 实时状态</span><span><ShieldCheck size={17} /> 权限隔离</span><span><LockKeyhole size={17} /> 安全存储</span></div>
      </section>
      <section className="login-panel">
        <Card className="login-card"><CardContent className="p-0">
          <div className="mobile-brand"><span className="brand-mark"><KeyRound size={22} /></span> GYS</div>
          <div className="login-heading"><p className="eyebrow">WELCOME BACK</p><h2>登录管理后台</h2><p>使用你的 GYS 账号继续</p></div>
          <form className="login-form" onSubmit={submit}>
            <div className="field-group"><Label htmlFor="username">账号</Label><div className="input-with-icon"><UserRound size={18} /><Input id="username" autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} /></div></div>
            <div className="field-group"><Label htmlFor="password">密码</Label><div className="input-with-icon"><LockKeyhole size={18} /><Input id="password" autoComplete="current-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} /></div></div>
            {error && <p className="form-error"><AlertTriangle size={15} />{error}</p>}
            <Button className="login-button" type="submit" disabled={loading}>{loading ? <Loader2 className="spin" /> : <>进入系统 <ArrowRight size={17} /></>}</Button>
          </form>
          <div className="demo-note"><span>演示账号</span><code>admin / admin123</code></div>
        </CardContent></Card>
        <p className="login-footnote">GYS · 独立部署的供应商渠道管理系统</p>
      </section>
    </main>
  );
}

function PageHeading({ eyebrow, title, description, actions }: { eyebrow: string; title: string; description: string; actions?: ReactNode }) {
  return <header className="page-heading"><div><span>{eyebrow}</span><h1>{title}</h1><p>{description}</p></div>{actions && <div className="heading-actions">{actions}</div>}</header>;
}

function EmptyState({ icon: Icon = Database, title, text }: { icon?: LucideIcon; title: string; text: string }) {
  return <div className="empty-state"><span><Icon size={24} /></span><h3>{title}</h3><p>{text}</p></div>;
}

function Dashboard({ go }: { go: (page: PageKey) => void }) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(async () => { setError(''); try { setData(await api('/api/dashboard')); } catch (failure) { setError((failure as Error).message); } }, []);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);
  if (!data) return <section>{error ? <EmptyState icon={AlertTriangle} title="控制台加载失败" text={error} /> : <div className="content-loading"><Loader2 className="spin" />正在汇总数据</div>}</section>;
  const maxTrend = Math.max(...data.trend.map((item) => item.amount), 1);
  const maxCategory = Math.max(...data.categories.map((item) => item.count), 1);
  return <section>
    <PageHeading eyebrow="OVERVIEW" title="运营控制台" description="查看渠道健康度、供应商规模和近期消费趋势。" actions={<Button variant="outline" onClick={load}><RefreshCcw />刷新</Button>} />
    <div className="metric-grid">
      <MetricCard icon={Boxes} label="渠道总数" value={String(data.channels.total)} hint={`${data.channels.enabled} 条运行中`} tone="blue" />
      <MetricCard icon={CircleDollarSign} label="累计消耗" value={money(data.channels.quota_used)} hint="全部可见渠道" tone="cyan" />
      <MetricCard icon={Gauge} label="平均成功率" value={`${data.channels.avg_sr.toFixed(1)}%`} hint={data.channels.avg_sr >= 95 ? '整体表现优秀' : '建议关注低分渠道'} tone="purple" />
      <MetricCard icon={Users} label="供应商子账号" value={String(data.suppliers)} hint="权限独立管理" tone="orange" />
    </div>
    <div className="dashboard-grid">
      <Card className="panel trend-panel"><CardHeader><CardTitle>近 7 日消费趋势</CardTitle><span className="panel-kicker">USAGE TREND</span></CardHeader><CardContent>
        <div className="trend-chart" aria-label="近 7 日消费柱状图">{data.trend.map((item) => <div className="trend-column" key={item.date}><span className="trend-value">{item.amount}</span><div className="trend-bar-wrap"><i style={{ height: `${Math.max(12, item.amount / maxTrend * 100)}%` }} /></div><small>{item.date}</small></div>)}</div>
      </CardContent></Card>
      <Card className="panel category-panel"><CardHeader><CardTitle>分类分布</CardTitle><span className="panel-kicker">PLATFORMS</span></CardHeader><CardContent className="category-list">{data.categories.map((item) => <div className="category-row" key={item.category}><div><span className={`category-dot ${categoryTone[item.category] || ''}`} />{categoryLabel[item.category] || item.category}<b>{item.count}</b></div><Progress value={item.count / maxCategory * 100} /></div>)}</CardContent></Card>
    </div>
    <div className="dashboard-grid lower-grid">
      <Card className="panel attention-panel"><CardHeader><div><CardTitle>需要关注</CardTitle><p>成功率偏低或已自动停用的渠道</p></div><Button variant="ghost" size="sm" onClick={() => go('channels')}>全部渠道 <ChevronRight /></Button></CardHeader><CardContent>{data.attention.length ? <Table><TableHeader><TableRow><TableHead>渠道</TableHead><TableHead>平台</TableHead><TableHead>成功率</TableHead><TableHead>状态</TableHead></TableRow></TableHeader><TableBody>{data.attention.map((item) => <TableRow key={item.id}><TableCell><strong>{item.name}</strong><small>{item.tag}</small></TableCell><TableCell><CategoryBadge category={item.category} /></TableCell><TableCell><span className={item.success_rate < 80 ? 'danger-text' : 'warning-text'}>{item.success_rate.toFixed(1)}%</span></TableCell><TableCell><StatusBadge status={item.status} /></TableCell></TableRow>)}</TableBody></Table> : <EmptyState icon={CheckCircle2} title="渠道运行良好" text="当前没有需要处理的异常渠道。" />}</CardContent></Card>
      <Card className="panel activity-panel"><CardHeader><CardTitle>最近动态</CardTitle><span className="panel-kicker">ACTIVITY</span></CardHeader><CardContent><div className="activity-list">{data.logs.map((item, index) => <div className="activity-item" key={`${item.created_at}-${index}`}><span className="activity-mark"><Zap size={14} /></span><div><strong>{item.detail}</strong><small>{dateText(item.created_at)}</small></div></div>)}</div></CardContent></Card>
    </div>
  </section>;
}

function MetricCard({ icon: Icon, label, value, hint, tone }: { icon: LucideIcon; label: string; value: string; hint: string; tone: string }) {
  return <Card className={`metric-card metric-${tone}`}><CardContent><div className="metric-top"><span className="metric-icon"><Icon size={20} /></span><Activity size={17} /></div><p>{label}</p><strong>{value}</strong><small>{hint}</small></CardContent></Card>;
}

function CategoryBadge({ category }: { category: string }) { return <span className={`category-badge ${categoryTone[category] || ''}`}>{categoryLabel[category] || category}</span>; }
function StatusBadge({ status }: { status: number }) { return <Badge className={`status-badge status-${status}`} variant="outline"><span />{statusText(status)}</Badge>; }

function UploadView({ done }: { done: () => void }) {
  const [mode, setMode] = useState('batch');
  const [category, setCategory] = useState('openai');
  const [tag, setTag] = useState('');
  const [keys, setKeys] = useState('');
  const [remark, setRemark] = useState('');
  const [standby, setStandby] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const keyCount = useMemo(() => new Set(keys.split(/\r?\n/).map((item) => item.trim()).filter(Boolean)).size, [keys]);
  const submit = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault(); setSubmitting(true); setResult(null);
    try {
      const payload = await api<{ added: number; skipped_dup: number }>('/api/channels/batch', { method: 'POST', body: { category, tag, keys: mode === 'single' ? keys.split(/\r?\n/)[0] : keys, remark, standby } });
      setResult({ ok: true, text: `已新增 ${payload.added} 条渠道${payload.skipped_dup ? `，跳过 ${payload.skipped_dup} 条重复密钥` : ''}` });
      setKeys(''); setTag(''); window.dispatchEvent(new Event('gys:channels-changed'));
    } catch (failure) { setResult({ ok: false, text: (failure as Error).message }); }
    finally { setSubmitting(false); }
  };
  return <section>
    <PageHeading eyebrow="INGEST" title="上传 API 密钥" description="选择平台并提交密钥，系统会自动去重、建渠并纳入监控。" actions={<Button variant="outline" onClick={done}><Boxes />查看渠道</Button>} />
    <div className="upload-layout">
      <Card className="panel upload-card"><CardContent>
        <Tabs value={mode} onValueChange={(value) => setMode(String(value))}>
          <TabsList className="upload-tabs"><TabsTrigger value="batch">批量上传</TabsTrigger><TabsTrigger value="single">单个上传</TabsTrigger></TabsList>
          <TabsContent value="batch"><p className="tab-note">每行粘贴一条密钥，最多一次提交 200 条。</p></TabsContent>
          <TabsContent value="single"><p className="tab-note">适合单条验证和补充渠道。</p></TabsContent>
        </Tabs>
        <form className="upload-form" onSubmit={submit}>
          <div className="form-grid"><div className="field-group"><span className="control-label">渠道平台</span><Select value={category} onValueChange={(value) => setCategory(String(value))}><SelectTrigger className="wide-control" aria-label="渠道平台"><SelectValue /></SelectTrigger><SelectContent>{Object.keys(categoryLabel).map((key) => <SelectItem key={key} value={key}>{categoryLabel[key]}</SelectItem>)}</SelectContent></Select></div><div className="field-group"><Label htmlFor="tag">标签 / 批次</Label><Input id="tag" value={tag} maxLength={60} onChange={(event) => setTag(event.target.value)} placeholder="例如：华东客户-0904" /></div></div>
          <div className="field-group"><div className="label-line"><Label htmlFor="keys">{mode === 'batch' ? '密钥列表' : 'API Key'}</Label><span>{keyCount} 条可提交</span></div><Textarea id="keys" className="key-textarea" value={keys} onChange={(event) => setKeys(event.target.value)} placeholder={mode === 'batch' ? 'sk-...\nsk-...\nsk-...' : 'sk-...'} rows={mode === 'batch' ? 9 : 4} /></div>
          <div className="field-group"><Label htmlFor="remark">备注（可选）</Label><Input id="remark" value={remark} maxLength={240} onChange={(event) => setRemark(event.target.value)} placeholder="记录来源、结算方式或负责人" /></div>
          <div className="switch-line"><Switch aria-label="加入备用库存" checked={standby} onCheckedChange={setStandby} /><span><strong>加入备用库存</strong><small>保存密钥但暂不启用渠道</small></span></div>
          {result && <p className={`result-banner ${result.ok ? 'ok' : 'error'}`}>{result.ok ? <CheckCircle2 /> : <AlertTriangle />}{result.text}</p>}
          <Button className="primary-action" type="submit" disabled={submitting || !keyCount || !tag}>{submitting ? <><Loader2 className="spin" />正在安全写入</> : <><CloudUpload />{mode === 'batch' ? '批量提交' : '创建渠道'}</>}</Button>
        </form>
      </CardContent></Card>
      <aside className="upload-aside"><Card className="dark-tip"><CardContent><span><ShieldCheck /></span><h3>密钥不会回显</h3><p>后台只保存密钥指纹和脱敏展示值，列表与开放 API 均无法读取完整密钥。</p></CardContent></Card><Card className="panel steps-card"><CardContent><h3>提交后会发生什么</h3>{['检查格式并自动去重', '按平台生成可用模型范围', standby ? '进入备用库存等待启用' : '创建渠道并开始监控'].map((item, index) => <div key={item}><span>{index + 1}</span><p>{item}</p></div>)}</CardContent></Card></aside>
    </div>
  </section>;
}

function ChannelsView() {
  const [data, setData] = useState<ChannelPage | null>(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [category, setCategory] = useState('all');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [deleteItem, setDeleteItem] = useState<Channel | null>(null);
  const load = useCallback(async () => {
    setLoading(true); setMessage('');
    try { setData(await api(`/api/channels?page=1&page_size=100&q=${encodeURIComponent(search)}&status=${status}&category=${category}`)); }
    catch (failure) { setMessage((failure as Error).message); }
    finally { setLoading(false); }
  }, [search, status, category]);
  useEffect(() => { const timer = setTimeout(() => void load(), 180); const listener = () => void load(); window.addEventListener('gys:channels-changed', listener); return () => { clearTimeout(timer); window.removeEventListener('gys:channels-changed', listener); }; }, [load]);
  const setChannelStatus = async (item: Channel, enabled: boolean) => { try { await api(`/api/channels/${item.id}/status`, { method: 'PUT', body: { status: enabled ? 1 : 2 } }); await load(); } catch (failure) { setMessage((failure as Error).message); } };
  const testChannel = async (item: Channel) => { setMessage('正在测试真实链路…'); try { const result = await api<{ success: boolean; message: string; latency: number }>(`/api/channels/${item.id}/test`, { method: 'POST', body: {} }); setMessage(`${result.message}${result.success ? `，延迟 ${result.latency} ms` : ''}`); } catch (failure) { setMessage((failure as Error).message); } };
  const remove = async () => { if (!deleteItem) return; try { await api(`/api/channels/${deleteItem.id}`, { method: 'DELETE' }); setDeleteItem(null); await load(); } catch (failure) { setMessage((failure as Error).message); } };
  return <section>
    <PageHeading eyebrow="CHANNELS" title="渠道管理" description="查询渠道、同步消耗，并处理停用或异常线路。" actions={<Button variant="outline" onClick={load} disabled={loading}><RefreshCcw className={loading ? 'spin' : ''} />刷新数据</Button>} />
    <Card className="panel data-panel"><CardHeader className="filter-bar"><div className="search-box"><Search /><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索渠道、标签、密钥或备注" /></div><Select value={category} onValueChange={(value) => setCategory(String(value))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">全部平台</SelectItem>{Object.keys(categoryLabel).map((key) => <SelectItem key={key} value={key}>{categoryLabel[key]}</SelectItem>)}</SelectContent></Select><Select value={status} onValueChange={(value) => setStatus(String(value))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">全部状态</SelectItem><SelectItem value="1">启用</SelectItem><SelectItem value="2">停用</SelectItem><SelectItem value="3">自动停用</SelectItem></SelectContent></Select></CardHeader>
      {message && <div className="inline-message"><Activity />{message}<button onClick={() => setMessage('')} aria-label="关闭提示"><X /></button></div>}
      <CardContent className="table-content">{data?.items.length ? <><Table><TableHeader><TableRow><TableHead>渠道</TableHead><TableHead>平台 / 标签</TableHead><TableHead>密钥</TableHead><TableHead>消耗 / 额度</TableHead><TableHead>成功率</TableHead><TableHead>状态</TableHead><TableHead className="right-cell">操作</TableHead></TableRow></TableHeader><TableBody>{data.items.map((item) => <TableRow key={item.id}><TableCell><strong>{item.name}</strong><small>{item.uploader_display_name || item.uploader_name}</small></TableCell><TableCell><CategoryBadge category={item.category} /><small>{item.tag}</small></TableCell><TableCell><code>{item.key_masked}</code><small>{item.remark || '无备注'}</small></TableCell><TableCell><strong>{money(item.used_quota)}</strong><small>额度 {money(item.quota)}</small></TableCell><TableCell><span className={item.success_rate < 80 ? 'danger-text' : item.success_rate < 95 ? 'warning-text' : 'success-text'}>{item.success_rate.toFixed(1)}%</span><small>{item.req_error} 次错误</small></TableCell><TableCell><div className="status-switch"><Switch checked={item.status === 1} onCheckedChange={(checked) => void setChannelStatus(item, checked)} /><StatusBadge status={item.status} /></div></TableCell><TableCell className="right-cell"><div className="row-actions"><Button size="icon-sm" variant="ghost" title="测试渠道" onClick={() => void testChannel(item)}><TestTube2 /></Button><DropdownMenu><DropdownMenuTrigger render={<Button size="icon-sm" variant="ghost" />}><MoreHorizontal /></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuLabel>渠道操作</DropdownMenuLabel><DropdownMenuItem onClick={() => void testChannel(item)}><Activity />连接测试</DropdownMenuItem><DropdownMenuSeparator /><DropdownMenuItem variant="destructive" onClick={() => setDeleteItem(item)}><Trash2 />删除渠道</DropdownMenuItem></DropdownMenuContent></DropdownMenu></div></TableCell></TableRow>)}</TableBody></Table><div className="table-footer"><span>共 {data.total} 条渠道</span><span>显示最近 {data.items.length} 条</span></div></> : loading ? <div className="content-loading"><Loader2 className="spin" />加载渠道数据</div> : <EmptyState icon={Boxes} title="还没有渠道" text="上传 API 密钥后，渠道会显示在这里。" />}</CardContent>
    </Card>
    <AlertDialog open={Boolean(deleteItem)} onOpenChange={(open) => !open && setDeleteItem(null)}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>删除 {deleteItem?.name}？</AlertDialogTitle><AlertDialogDescription>删除后无法恢复。该渠道的密钥指纹、状态和统计记录会一并移除。</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>取消</AlertDialogCancel><AlertDialogAction className="danger-button" onClick={() => void remove()}>确认删除</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </section>;
}

function AccountsView() {
  const [items, setItems] = useState<Account[]>([]);
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const load = useCallback(async () => { try { const result = await api<{ items: Account[] }>('/api/sub-accounts'); setItems(result.items); } catch (failure) { setMessage((failure as Error).message); } }, []);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);
  const create = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    try { await api('/api/sub-accounts', { method: 'POST', body: { username: form.get('username'), display_name: form.get('display_name'), password: form.get('password') } }); setOpen(false); await load(); }
    catch (failure) { setMessage((failure as Error).message); }
  };
  const toggle = async (item: Account, checked: boolean) => { try { await api(`/api/sub-accounts/${item.id}`, { method: 'PUT', body: { status: checked ? 1 : 0 } }); await load(); } catch (failure) { setMessage((failure as Error).message); } };
  return <section>
    <PageHeading eyebrow="ACCESS" title="子账号管理" description="为供应商团队分配独立账号，每个成员只看自己的渠道。" actions={<Button onClick={() => setOpen(true)}><UserPlus />新建子账号</Button>} />
    {message && <div className="inline-message"><AlertTriangle />{message}<button aria-label="关闭提示" onClick={() => setMessage('')}><X /></button></div>}
    <div className="account-summary"><Card className="summary-card"><CardContent><span><Users /></span><div><p>账号总数</p><strong>{items.length}</strong></div></CardContent></Card><Card className="summary-card"><CardContent><span><CheckCircle2 /></span><div><p>启用账号</p><strong>{items.filter((item) => item.status === 1).length}</strong></div></CardContent></Card><Card className="summary-card"><CardContent><span><CircleDollarSign /></span><div><p>子账号累计消耗</p><strong>{money(items.reduce((sum, item) => sum + Number(item.used_quota || 0), 0))}</strong></div></CardContent></Card></div>
    <Card className="panel data-panel"><CardContent className="table-content">{items.length ? <Table><TableHeader><TableRow><TableHead>成员</TableHead><TableHead>登录账号</TableHead><TableHead>渠道数</TableHead><TableHead>累计消耗</TableHead><TableHead>创建时间</TableHead><TableHead>启用</TableHead></TableRow></TableHeader><TableBody>{items.map((item) => <TableRow key={item.id}><TableCell><div className="member-cell"><span>{item.display_name.slice(0, 1)}</span><strong>{item.display_name}</strong></div></TableCell><TableCell><code>{item.username}</code></TableCell><TableCell>{item.channel_count || 0}</TableCell><TableCell>{money(item.used_quota)}</TableCell><TableCell>{dateText(item.created_at)}</TableCell><TableCell><Switch checked={item.status === 1} onCheckedChange={(checked) => void toggle(item, checked)} /></TableCell></TableRow>)}</TableBody></Table> : <EmptyState icon={Users} title="暂无子账号" text="创建子账号后即可分配独立的密钥和渠道。" />}</CardContent></Card>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="form-dialog"><DialogHeader><DialogTitle>新建供应商子账号</DialogTitle><DialogDescription>子账号登录后只能管理自己上传的渠道。</DialogDescription></DialogHeader><form onSubmit={create}><div className="dialog-fields"><div className="field-group"><Label htmlFor="display_name">显示名称</Label><Input id="display_name" name="display_name" required minLength={2} placeholder="例如：华南渠道组" /></div><div className="field-group"><Label htmlFor="account_username">登录账号</Label><Input id="account_username" name="username" required minLength={3} placeholder="supplier_south" /></div><div className="field-group"><Label htmlFor="account_password">初始密码</Label><Input id="account_password" name="password" type="password" required minLength={6} placeholder="至少 6 位" /></div></div><DialogFooter><Button type="button" variant="outline" onClick={() => setOpen(false)}>取消</Button><Button type="submit">创建账号</Button></DialogFooter></form></DialogContent></Dialog>
  </section>;
}

function ApiView() {
  const [items, setItems] = useState<ApiKey[]>([]);
  const [open, setOpen] = useState(false);
  const [newKey, setNewKey] = useState('');
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState(['channels:read', 'meta:read']);
  const [message, setMessage] = useState('');
  const load = useCallback(async () => { try { setItems(await api('/api/apikeys')); } catch (failure) { setMessage((failure as Error).message); } }, []);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);
  const create = async () => { try { const result = await api<{ key: string }>('/api/apikeys', { method: 'POST', body: { name, scopes: scopes.join(',') } }); setNewKey(result.key); setOpen(false); setName(''); await load(); } catch (failure) { setMessage((failure as Error).message); } };
  const revoke = async (item: ApiKey) => { try { await api(`/api/apikeys/${item.id}`, { method: 'DELETE' }); await load(); } catch (failure) { setMessage((failure as Error).message); } };
  const toggleScope = (scope: string, checked: boolean) => setScopes((current) => checked ? [...new Set([...current, scope])] : current.filter((item) => item !== scope));
  return <section>
    <PageHeading eyebrow="DEVELOPER" title="开放 API" description="创建最小权限密钥，把渠道上传和查询接入你的业务流程。" actions={<Button onClick={() => setOpen(true)}><Plus />创建 API Key</Button>} />
    {message && <div className="inline-message"><AlertTriangle />{message}<button aria-label="关闭提示" onClick={() => setMessage('')}><X /></button></div>}
    <div className="api-layout"><Card className="panel api-doc"><CardHeader><div><CardTitle>快速接入</CardTitle><p>Base URL 与网页地址相同</p></div><Badge variant="secondary">REST · JSON</Badge></CardHeader><CardContent><div className="endpoint-list"><Endpoint method="GET" path="/openapi/v1/whoami" text="验证密钥身份" /><Endpoint method="GET" path="/openapi/v1/meta" text="读取平台与模型" /><Endpoint method="GET" path="/openapi/v1/channels" text="分页查询渠道" /><Endpoint method="POST" path="/openapi/v1/channels" text="批量上传密钥" /></div><div className="code-block"><div><span>请求示例</span><Button size="icon-sm" variant="ghost" onClick={() => void navigator.clipboard.writeText(`curl -H "Authorization: Bearer YOUR_KEY" ${location.origin}/openapi/v1/channels`)}><Copy /></Button></div><code>curl -H &quot;Authorization: Bearer YOUR_KEY&quot; \<br />&nbsp;&nbsp;{typeof location !== 'undefined' ? location.origin : ''}/openapi/v1/channels</code></div></CardContent></Card>
      <Card className="panel key-list-card"><CardHeader><CardTitle>我的 API Keys</CardTitle><span className="panel-kicker">{items.filter((item) => item.status === 1).length} ACTIVE</span></CardHeader><CardContent>{items.length ? <div className="key-list">{items.map((item) => <div className="key-item" key={item.id}><span className="key-icon"><KeyRound /></span><div><strong>{item.name}</strong><code>{item.prefix}</code><small>{item.scopes.split(',').join(' · ')}</small></div><div><StatusBadge status={item.status ? 1 : 2} />{item.status === 1 && <Button size="icon-sm" variant="ghost" title="停用" onClick={() => void revoke(item)}><Trash2 /></Button>}</div></div>)}</div> : <EmptyState icon={KeyRound} title="暂无 API Key" text="创建一个密钥开始接入。" />}</CardContent></Card></div>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="form-dialog"><DialogHeader><DialogTitle>创建开放 API Key</DialogTitle><DialogDescription>密钥只会完整显示一次，请妥善保存。</DialogDescription></DialogHeader><div className="dialog-fields"><div className="field-group"><Label htmlFor="key_name">名称</Label><Input id="key_name" value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：自动上传脚本" /></div><div className="field-group"><span className="control-label">权限范围</span><div className="scope-list">{[['channels:read', '读取渠道'], ['channels:write', '上传渠道'], ['meta:read', '读取平台配置']].map(([scope, label]) => <div key={scope}><Checkbox aria-label={label} checked={scopes.includes(scope)} onCheckedChange={(checked) => toggleScope(scope, checked)} /><span><strong>{label}</strong><code>{scope}</code></span></div>)}</div></div></div><DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>取消</Button><Button onClick={() => void create()} disabled={!name || !scopes.length}>生成密钥</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={Boolean(newKey)} onOpenChange={(state) => !state && setNewKey('')}><DialogContent className="key-dialog"><DialogHeader><DialogTitle>API Key 已创建</DialogTitle><DialogDescription>关闭后将无法再次查看完整内容。</DialogDescription></DialogHeader><div className="secret-key"><code>{newKey}</code><Button size="icon-sm" variant="ghost" onClick={() => void navigator.clipboard.writeText(newKey)}><Clipboard /></Button></div><DialogFooter><Button onClick={() => setNewKey('')}>我已安全保存</Button></DialogFooter></DialogContent></Dialog>
  </section>;
}

function Endpoint({ method, path, text }: { method: string; path: string; text: string }) { return <div className="endpoint"><span className={method === 'POST' ? 'post' : ''}>{method}</span><code>{path}</code><p>{text}</p></div>; }

function AppShell({ profile, onLogout }: { profile: Profile; onLogout: () => void }) {
  const [page, setPage] = useState<PageKey>('dashboard');
  const [mobileOpen, setMobileOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const current = navigation.find((item) => item.key === page)!;
  const changePage = (next: PageKey) => { setPage(next); setMobileOpen(false); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  const logout = async () => { await api('/api/auth/logout', { method: 'POST', body: {} }).catch(() => undefined); onLogout(); };
  const changePassword = async (event: SyntheticEvent<HTMLFormElement>) => { event.preventDefault(); const form = new FormData(event.currentTarget); try { await api('/api/auth/password', { method: 'POST', body: { old_password: form.get('old'), new_password: form.get('next') } }); setPasswordOpen(false); setNotice({ type: 'ok', text: '密码已修改' }); } catch (failure) { setNotice({ type: 'error', text: (failure as Error).message }); } };

  useEffect(() => {
    const context = document.modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    const register = async () => {
      await context.registerTool({ name: 'list_gys_channels', title: '查询 GYS 渠道', description: '按关键词、平台或状态查询当前账号可见的 GYS 渠道。', inputSchema: { type: 'object', properties: { search: { type: 'string' }, category: { type: 'string', enum: ['all', ...Object.keys(categoryLabel)] }, status: { type: 'string', enum: ['all', '1', '2', '3'] } }, additionalProperties: false }, annotations: { readOnlyHint: true, untrustedContentHint: false }, async execute(input) { const value = (input || {}) as Record<string, string>; return api(`/api/channels?page_size=100&q=${encodeURIComponent(value.search || '')}&category=${value.category || 'all'}&status=${value.status || 'all'}`); } }, { signal: lifecycle.signal });
      await context.registerTool({ name: 'create_gys_channels', title: '上传 GYS 密钥', description: '提交一组 API 密钥并创建渠道；该操作会写入后台数据库。', inputSchema: { type: 'object', properties: { category: { type: 'string', enum: Object.keys(categoryLabel) }, tag: { type: 'string' }, keys: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 200 }, remark: { type: 'string' }, standby: { type: 'boolean' } }, required: ['category', 'tag', 'keys'], additionalProperties: false }, annotations: { readOnlyHint: false, untrustedContentHint: false }, async execute(input) { const value = input as Record<string, unknown>; const result = await api('/api/channels/batch', { method: 'POST', body: value }); window.dispatchEvent(new Event('gys:channels-changed')); return result; } }, { signal: lifecycle.signal });
    };
    void register().catch(() => undefined);
    return () => lifecycle.abort();
  }, []);

  return <div className="app-shell">
    <aside className={`sidebar ${mobileOpen ? 'open' : ''}`}><div className="sidebar-brand"><span className="brand-mark"><KeyRound /></span><div><strong>GYS</strong><small>供应商系统</small></div><button aria-label="关闭菜单" className="mobile-close" onClick={() => setMobileOpen(false)}><X /></button></div><nav>{navigation.map((item) => { const Icon = item.icon; return <button key={item.key} className={page === item.key ? 'active' : ''} onClick={() => changePage(item.key)}><span><Icon /></span><div><strong>{item.label}</strong><small>{item.hint}</small></div>{page === item.key && <i />}</button>; })}</nav><div className="sidebar-status"><span><Activity /></span><div><strong>后台服务正常</strong><small>数据库已连接</small></div><i /></div></aside>
    {mobileOpen && <button className="sidebar-scrim" aria-label="关闭菜单" onClick={() => setMobileOpen(false)} />}
    <div className="main-area"><header className="topbar"><div><Button aria-label="打开菜单" variant="ghost" size="icon" className="menu-button" onClick={() => setMobileOpen(true)}><Menu /></Button><span className="topbar-icon"><current.icon /></span><div><strong>{current.label}</strong><small>{current.hint}</small></div></div><div className="topbar-actions"><span className="live-pill"><i />系统在线</span><DropdownMenu><DropdownMenuTrigger render={<button aria-label="账号菜单" className="profile-button" />}><span>{profile.display_name.slice(0, 1)}</span><div><strong>{profile.display_name}</strong><small>{profile.role === 'admin' ? '管理员' : '供应商'}</small></div><ChevronRight /></DropdownMenuTrigger><DropdownMenuContent align="end" className="profile-menu"><DropdownMenuLabel>{profile.username}</DropdownMenuLabel><DropdownMenuItem onClick={() => setPasswordOpen(true)}><Settings />修改密码</DropdownMenuItem><DropdownMenuSeparator /><DropdownMenuItem variant="destructive" onClick={() => void logout()}><LogOut />退出登录</DropdownMenuItem></DropdownMenuContent></DropdownMenu></div></header><main className="workspace">{notice && <div className={`notice ${notice.type}`}><span>{notice.type === 'ok' ? <CheckCircle2 /> : <AlertTriangle />}{notice.text}</span><button aria-label="关闭提示" onClick={() => setNotice(null)}><X /></button></div>}{page === 'dashboard' && <Dashboard go={changePage} />}{page === 'upload' && <UploadView done={() => changePage('channels')} />}{page === 'channels' && <ChannelsView />}{page === 'accounts' && <AccountsView />}{page === 'api' && <ApiView />}</main></div>
    <Dialog open={passwordOpen} onOpenChange={setPasswordOpen}><DialogContent className="form-dialog"><DialogHeader><DialogTitle>修改登录密码</DialogTitle><DialogDescription>修改后请使用新密码登录。</DialogDescription></DialogHeader><form onSubmit={changePassword}><div className="dialog-fields"><div className="field-group"><Label htmlFor="old_password">当前密码</Label><Input id="old_password" name="old" type="password" required /></div><div className="field-group"><Label htmlFor="new_password">新密码</Label><Input id="new_password" name="next" type="password" minLength={6} required /></div></div><DialogFooter><Button type="button" variant="outline" onClick={() => setPasswordOpen(false)}>取消</Button><Button type="submit">保存修改</Button></DialogFooter></form></DialogContent></Dialog>
  </div>;
}

export default function GysApp() {
  const [profile, setProfile] = useState<Profile | null | undefined>(undefined);
  useEffect(() => { const controller = new AbortController(); api<Profile>('/api/auth/profile', { signal: controller.signal }).then(setProfile).catch(() => setProfile(null)); return () => controller.abort(); }, []);
  if (profile === undefined) return <LoadingScreen />;
  if (!profile) return <Login onLogin={setProfile} />;
  return <AppShell profile={profile} onLogout={() => setProfile(null)} />;
}
