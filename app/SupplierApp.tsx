'use client';

import {
  Activity,
  AlertTriangle,
  BarChart3,
  Bell,
  BookOpen,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  ClipboardCopy,
  Database,
  Eye,
  EyeOff,
  FileKey2,
  Gauge,
  Info,
  Languages,
  Loader2,
  LockKeyhole,
  LogOut,
  Menu,
  Megaphone,
  Pencil,
  Plus,
  RefreshCcw,
  Search,
  ShieldCheck,
  Tag,
  Trash2,
  UploadCloud,
  User,
  Users,
  X,
  XCircle,
  Zap,
} from 'lucide-react';
import type { ComponentType, CSSProperties, FormEvent, ReactNode } from 'react';
import { Fragment, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { enUS, zhCN } from 'date-fns/locale';
import type { DateRange } from 'react-day-picker';
import { Calendar } from '@/components/ui/calendar';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import {
  AlertDialog, AlertDialogTrigger, AlertDialogContent, AlertDialogHeader,
  AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from '@/components/ui/alert-dialog';
import { ActionButton } from '@/components/ui/action-button';
import LoginCaptcha from './LoginCaptcha';
import { SessionExpiredError, sessionClient } from './session';

type ApiEnvelope<T> = {
  code?: number | string;
  success?: boolean;
  data?: T;
  message?: string;
  request_id?: string;
};

type ApiRequestInit = Omit<RequestInit, 'body'> & {
  fresh?: boolean;
  body?: BodyInit | Record<string, unknown> | null;
};

type UserRole = 'super_admin' | 'admin' | 'supplier' | 'sub';

type AuthSource = 'local' | 'upstream';

type UserProfile = {
  id: number;
  user_id: number;
  username: string;
  display_name?: string;
  role: UserRole;
  auth_source: AuthSource;
};

type DashboardData = {
  attention?: ChannelItem[] | null;
  categories?: Array<{
    category: string;
    count: number;
  }> | null;
  channels?: {
    total?: number;
    enabled?: number;
    disabled?: number;
    auto_disabled?: number;
    quota_used?: number;
    scored?: number;
    good?: number;
    warn?: number;
    bad?: number;
    avg_sr?: number | null;
    last_scored?: string | null;
  };
  display_name?: string;
  instances?: {
    enabled?: number;
    total?: number;
  };
  role?: string;
  scheduler?: {
    enabled?: boolean;
    window_minutes?: number;
  };
  server_time?: string;
  suppliers?: number;
};

type ChannelItem = {
  id: number;
  name?: string;
  channel_name?: string;
  supplier_name?: string;
  category?: string;
  type?: number;
  tag?: string;
  remark?: string;
  key?: string;
  key_masked?: string;
  status?: number;
  used_quota?: number;
  quota?: number;
  created_at?: string;
  updated_at?: string;
  success_rate?: number;
  req_error?: number;
  models?: string;
};

type ChannelTestResult = {
  success?: boolean;
  message?: string;
  model?: string;
  latency?: number;
  instance_id?: number | string;
  instance_name?: string;
  key?: string;
};

type ChannelListData = {
  items: ChannelItem[];
  page: number;
  page_size: number;
  total: number;
};

type ChannelSummary = {
  count: number;
  total_quota: number;
  categories?: Array<{
    category: string;
    quota?: number;
    alive_rows?: number;
  }>;
};

type ChannelGroupSummary = {
  tag?: string;
  count?: number;
  key_count?: number;
  submitted?: number;
  added?: number;
  skipped_dup?: number;
  invalid?: number;
  failed?: number;
  enabled?: number;
  used_quota?: number;
  quota?: number;
};

type DisableKeyword = {
  id?: number | string;
  keyword: string;
  status?: string | number | boolean;
};

type UploadSwitch = {
  enabled: boolean;
  uploadable_categories?: string[];
};

type ApiKeyItem = {
  id: number;
  name: string;
  prefix: string;
  scopes: string;
  status: number;
  last_used_at?: string | null;
  created_at?: string;
};

type ModelGap = {
  channel_type?: number;
  gap_rpm: number;
  gap_tpm_est: number;
  model_name: string;
  platform_type?: string;
  platform_type_name: string;
};

type DailyStats = {
  days?: Array<{
    date: string;
    quota?: number;
    total_quota?: number;
    usd?: number;
    share_percent?: number;
    active_channel_count?: number;
    channels?: Array<{
      id?: number | string;
      channel_name?: string;
      category?: string;
      quota?: number;
    }>;
  }>;
  start?: string;
  end?: string;
  total_quota?: number;
  average_quota?: number;
};

type SubAccount = {
  id: number;
  username: string;
  original_username?: string;
  upstream_username?: string;
  public_username?: string | null;
  mapping_active?: boolean | null;
  mapping_display_name?: string | null;
  display_name?: string;
  channel_count?: number;
  used_quota?: number;
  status?: number;
};

function subAccountUpstreamUsername(account: SubAccount) {
  return account.upstream_username || account.original_username || account.username;
}

function subAccountPublicUsername(account: SubAccount) {
  if ('public_username' in account) return account.public_username || null;
  return account.original_username ? account.username : null;
}

type SubAccountSettlementSummary = {
  available: boolean;
  refreshedAt: number | null;
  categories: Array<{
    category: string;
    ratePercent: string;
    amount: string;
    settledAmount: string;
    payableAmount: string;
  }>;
};

type SettlementRecord = {
  id: number;
  category: string;
  previousAmount: string;
  settledAmount: string;
  changeAmount: string;
  consumptionAmount: string;
  ratePercent: string;
  settlementAmount: string;
  createdAt: number;
};

type SettlementTransaction = {
  id: string;
  createdAt: number;
  legacy: boolean;
  payer: { id: number; source: string; username: string; displayName: string } | null;
  payee: { id: number; source: string; username: string; displayName: string } | null;
  items: SettlementRecord[];
  totalConsumptionAmount: string;
  totalSettlementAmount: string;
};

type CategoryRateResponse = {
  userId: number;
  rates: Array<{
    category: string;
    ratePercent: string;
    settledAmount: string;
  }>;
  settlementRecords: SettlementRecord[];
  settlementTransactions: SettlementTransaction[];
};

type BatchSettlementResponse = {
  settlements: SettlementRecord[];
  settlementSummary: SubAccountSettlementSummary;
  totalSettlementAmount: string;
};

type Notice = {
  type: 'ok' | 'warn' | 'error';
  text: string;
};

type AnnouncementItem = {
  id: number;
  title: string;
  content: string;
  titleZh?: string | null;
  contentZh?: string | null;
  titleEn?: string | null;
  contentEn?: string | null;
  published: boolean;
  createdAt: number;
  updatedAt: number;
  publishedAt: number | null;
};

type AnnouncementCreatePayload = {
  titleZh: string;
  contentZh: string;
  titleEn: string;
  contentEn: string;
};

type AnnouncementListResponse = {
  items: AnnouncementItem[];
  total: number;
};

type UserMapping = {
  public_username: string;
  upstream_username: string;
  display_name: string;
  account_kind: 'primary' | 'sub' | string;
  upstream_user_id: number | null;
  active: boolean;
  can_sync: boolean;
  sync_enabled: boolean;
  data_synced_at: number | null;
  parent_upstream_user_id?: number | null;
  parent_gys_username?: string | null;
  created_at: number;
  updated_at: number;
};


type UserMappingListResponse = {
  items: UserMapping[];
  total: number;
};

type UserChannelUsageSnapshot = {
  available: boolean;
  userId: number | null;
  publicUsername: string;
  channelCount: number;
  totalQuota: string;
  totalAmount: string;
  refreshedAt: number | null;
  categories: Array<{
    category: string;
    ratePercent: string;
    quota: string;
    amount: string;
    settledAmount: string;
    outstandingAmount: string;
    channelCount: number;
    aliveChannelCount: number;
  }>;
};

type Language = 'zh' | 'en';

type TranslationValues = Record<string, string | number>;

const SUPER_ADMIN_USERNAME = 'sanyeAdmin';
const ALL_CHANNEL_FILTER_VALUE = '__gys_all__';

const englishTranslations: Record<string, string> = {
  '最多 ${{amount}}': 'Max ${{amount}}',
  '{{category}}：消耗额度不能超过剩余额度 ${{amount}}': '{{category}}: consumption cannot exceed the remaining ${{amount}}',
  '该账号存在结算历史，禁止删除': 'This account has settlement history and cannot be deleted',
  '查看结算': 'View Settlements',
  '查看 {{name}} 的结算记录': 'View settlements for {{name}}',
  '每页10笔交易': '10 transactions per page',
  '显示最近100笔交易': 'Showing the latest 100 transactions',
  '交易编号': 'Transaction ID',
  '历史记录': 'Legacy record',
  '本次交易结算总金额': 'Transaction settlement total',
  '旧记录未保存交易编号，按原记录单独展示。': 'Older records have no transaction ID and are shown individually.',
  '同步': 'Sync',
  '同步失败': 'Sync failed',
  '知道了': 'OK',
  '全选': 'Select all',
  '选择': 'Select',
  '确认结算': 'Confirm Settlement',
  '结算成功': 'Settlement saved',
  '总消费（$）': 'Total consumption ($)',
  '已结算（$）': 'Settled ($)',
  '应结算（$）': 'Amount due ($)',
  '应支付（USDT）': 'Payable (USDT)',
  'PushKey系统': 'PushKey System',
  '控制台': 'Dashboard',
  '渠道运行状态、消费额度与健康度概览。': 'Channel status, usage, and health overview.',
  '上传密钥': 'Upload Keys',
  '我的渠道': 'My Channels',
  '开放 API': 'Open API',
  '子账号管理': 'Sub-accounts',
  '消费快照': 'Usage Snapshot',
  '模型缺口': 'Model Gaps',
  '打开菜单': 'Open menu',
  '关闭菜单': 'Close menu',
  '语言切换': 'Language switch',
  '修改密码': 'Change Password',
  '退出中...': 'Logging out...',
  '退出登录': 'Log Out',
  '旧密码': 'Current Password',
  '新密码': 'New Password',
  '确认新密码': 'Confirm New Password',
  '取消': 'Cancel',
  '确定': 'Confirm',
  '清除': 'Clear',
  '关闭': 'Close',
  '查看全部': 'View all',
  '刷新': 'Refresh',
  '提交': 'Submit',
  '操作': 'Actions',
  '结算': 'Settle',
  '为 {{name}} 结算': 'Settle usage for {{name}}',
  '渠道分类结算': 'Channel Category Settlement',
  '正在加载结算数据': 'Loading settlement data',
  '加载结算数据失败': 'Failed to load settlement data',
  '提交结算失败': 'Failed to submit settlement',
  '批量结算（{{count}}）': 'Settle Selected ({{count}})',
  '结算中...': 'Settling...',
  '批量结算成功，共 {{count}} 个分类，结算金额 ${{amount}}': 'Batch settlement saved for {{count}} categories. Amount: ${{amount}}',
  '请选择结算分类': 'Select categories to settle',
  '已选择 {{count}} 个分类': '{{count}} categories selected',
  '请选择至少一个可结算分类': 'Select at least one category with available usage',
  '选择全部可结算': 'Select all available',
  '清空选择': 'Clear selection',
  '本次结算明细': 'Settlement Details',
  '已选分类': 'Selected Categories',
  '暂无可结算分类': 'No categories are available to settle',
  '可结算 ${{amount}} · 汇率 {{rate}}%': 'Available ${{amount}} · Rate {{rate}}%',
  '本次消耗额度': 'Usage to Settle',
  '可结算消耗': 'Available Usage',
  '本次结算金额': 'Settlement Amount',
  '结算金额': 'Settlement Amount',
  '结算汇率': 'Settlement Rate',
  '结算后累计': 'Cumulative Settled',
  '请输入有效的结算消耗额度': 'Enter a valid usage amount to settle',
  '结算消耗额度不能超过可结算额度': 'Usage to settle cannot exceed the available amount',
  '本次结算金额 = 各分类消耗额度 × 对应结算汇率之和。': 'Settlement amount is the sum of each category usage multiplied by its rate.',
  '设置汇率': 'Set Rates',
  '汇率': 'Rate',
  '为 {{name}} 设置汇率': 'Set rates for {{name}}',
  '渠道分类汇率': 'Channel Category Rates',
  '渠道分类汇率与结算': 'Channel Rates & Settlement',
  '为该用户分别设置每个渠道分类的金额汇率。': 'Set an amount rate for each channel category for this user.',
  '为该用户分别设置每个渠道分类的汇率与已结算金额。': 'Set the rate and settled amount for each channel category for this user.',
  '汇率保存成功': 'Rates saved successfully',
  '加载汇率失败': 'Failed to load rates',
  '保存汇率失败': 'Failed to save rates',
  '正在加载汇率': 'Loading rates',
  '保存汇率': 'Save Rates',
  '汇率须在 0% 至 100000% 之间': 'Rates must be between 0% and 100000%',
  '已结算金额须为大于或等于 0 的数字': 'Settled amounts must be numbers greater than or equal to 0',
  '100% 为原始消耗金额；结算金额会按此比例计算。': '100% keeps the original usage amount. Settlement amounts use this rate.',
  '全部分类': 'All Categories',
  '选择分类': 'Select Category',
  '选择状态': 'Select Status',
  '选择标签': 'Select Tag',
  '请选择一个筛选项': 'Choose a filter option',
  '总消耗': 'Total Usage',
  '{{category}} · 总消耗：${{amount}}': '{{category}} · Total usage: ${{amount}}',
  '已结算': 'Settled',
  '已结算金额': 'Settled Amount',
  '结算历史': 'Settlement History',
  '查看当前账户的结算交易与分类明细。': 'View settlement transactions and category details for your account.',
  '第 {{page}} 页': 'Page {{page}}',
  '结算详情': 'Settlement details',
  '查看支付渠道详情': 'View payment channel details',
  '查看详情': 'View details',
  '删除结算': 'Delete settlement',
  '删除并恢复额度': 'Delete and restore usage',
  '删除后，本笔消耗额度将退回待结算，其他结算记录保持不变。': 'This transaction’s usage will become available for settlement again. Other transactions remain unchanged.',
  '删除结算失败': 'Failed to delete settlement',
  '付款人': 'Payer',
  '收款人': 'Payee',
  '未记录': 'Not recorded',
  '结算记录': 'Settlement History',
  '暂无结算记录': 'No settlement history',
  '结算时间': 'Settlement Time',
  '变更前': 'Before',
  '变更后': 'After',
  '变更金额': 'Change',
  '保存时汇率': 'Rate at Save',
  '消耗额度': 'Usage Amount',
  '渠道分类': 'Channel Category',
  '平台': 'Platform',
  '全部模型': 'All Models',
  '状态': 'Status',
  '分类': 'Category',
  '备注': 'Note',
  '创建时间': 'Created At',
  '新密码至少 6 位。': 'The new password must be at least 6 characters.',
  '两次输入的密码不一致。': 'The two passwords do not match.',
  '修改密码失败，请稍后重试。': 'Unable to change the password. Please try again later.',
  '正在验证登录状态': 'Checking sign-in status',
  '暂时无法验证登录状态，请重试': 'Unable to verify your sign-in status right now. Please retry.',
  '重试': 'Retry',
  '管理员': 'Administrator',
  '供应商': 'Supplier',
  '子账号': 'Sub-account',
  '用户': 'User',
  '启用': 'Enabled',
  '停用': 'Disabled',
  '禁用': 'Disabled',
  '自动禁用': 'Auto-disabled',
  '已删除': 'Deleted',
  '未知': 'Unknown',
  '夜深了': 'Good evening',
  '上午好': 'Good morning',
  '中午好': 'Good afternoon',
  '下午好': 'Good afternoon',
  '晚上好': 'Good evening',
  '欢迎回来': 'Welcome back',
  '暂无': 'N/A',
  '暂无数据': 'No data',
  '暂无记录': 'No records',
  '暂无可显示的记录。': 'No records available.',
  '正在加载控制台': 'Loading dashboard',
  '加载控制台失败': 'Unable to load dashboard',
  '重新加载': 'Reload',
  '累计消耗': 'Total Usage',
  '平均成功率': 'Average Success Rate',
  '启用中': 'Enabled',
  '成功率健康度': 'Success-rate Health',
  '已评估 {{count}} 个': '{{count}} evaluated',
  '优秀 ≥95%': 'Excellent ≥95%',
  '良好 80-95%': 'Good 80-95%',
  '偏低 <80%': 'Low <80%',
  '渠道概况': 'Channel Overview',
  '分类分布': 'Category Distribution',
  '需关注渠道（成功率偏低 / 自动禁用）': 'Channels Needing Attention (low success rate / auto-disabled)',
  '全部': 'All',
  '渠道': 'Channel',
  '标签': 'Tag',
  '成功率': 'Success Rate',
  '近窗口错误': 'Recent Errors',
  '处理': 'Manage',
  '一切正常，没有需要关注的渠道': 'Everything looks good. No channels need attention.',
  '快捷入口': 'Quick Access',
  '上传 API 密钥': 'Upload API Keys',
  '系统维护中，暂停上传。已上传渠道的查询、消费统计不受影响。': 'Uploads are temporarily paused for maintenance. Existing channel queries and usage statistics are unaffected.',
  '选择分类并粘贴密钥即可提交。标签 / 分组由系统自动生成，系统随后创建渠道、归入分组并完成上线。各上游实例可单独限制接收的分类；上传页仅隐藏当前无人接收的分类。': 'Choose a category and paste a key to submit. The tag / group is generated automatically, then the channel is created, grouped, and brought online. Categories with no available upstream receiver are hidden.',
  '标签 / 分组由后端自动生成': 'The tag / group is generated by the backend',
  '页面显示预生成标签，提交时由后端按中国北京时间生成最终标签。格式：“用户ID-category-HHmmss”。': 'The page shows a generated-tag preview. On submission, the backend creates the final tag in China Standard Time using “userID-category-HHmmss”.',
  '批量上传': 'Batch Upload',
  '单个上传': 'Single Upload',
  '选择渠道分类': 'Choose a channel category',
  '选择密钥对应的服务渠道': 'Choose the service provider for these keys',
  '填写密钥': 'Enter keys',
  '批量粘贴密钥，系统会自动去重': 'Paste multiple keys; duplicates are removed automatically',
  '填写当前渠道所需的密钥信息': 'Enter the key details required by this channel',
  '上传设置': 'Upload settings',
  '确认自动标签与可选配置': 'Review the generated tag and optional settings',
  '自动生成标签': 'Generated tag',
  '高级选项': 'Advanced options',
  '可选': 'Optional',
  '模型范围 · 号况 · 备注 · 代理': 'Models · account status · note · proxy',
  '已识别 {{count}} 条': '{{count}} detected',
  '等待输入密钥': 'Waiting for keys',
  '已准备 {{count}} 条密钥': '{{count}} keys ready',
  '提交后自动创建渠道并上线': 'Channels will be created and brought online after submission',
  '提交后进入库存，暂不上线': 'Keys will be added to inventory and kept offline',
  '（可选）': '(optional)',
  '每行一个密钥': 'One key per line',
  '标签 / 分组（后端生成）': 'Tag / Group (generated by backend)',
  '高级选项（模型范围 · RPM · 号况 · 备注 · 代理，默认全部模型）': 'Advanced options (models, RPM, account status, note, proxy; all models by default)',
  '可用模型范围': 'Available Models',
  '已选 {{selected}}/{{total}}': '{{selected}}/{{total}} selected',
  '该分类暂未返回模型范围，默认使用全部模型。': 'No model range was returned for this category. All models will be used by default.',
  '入库存（备用，暂不上线）': 'Add to standby inventory (not online)',
  '备注（可选）': 'Note (optional)',
  '写一行 = 全部共用；也可一行一个，与密钥逐行对应': 'One line applies to all keys, or enter one line per key',
  '代理 SOCKS5/HTTP（可选）': 'SOCKS5/HTTP Proxy (optional)',
  '入库存': 'Add to Inventory',
  '批量提交': 'Submit Batch',
  '提交密钥': 'Submit Key',
  '密钥列表（一行一个，自动去重）': 'Key List (one per line, automatically deduplicated)',
  '可上传 {{count}} 条': '{{count}} keys ready',
  '请填写该渠道的 API Key。': 'Enter the API key for this channel.',
  '密钥': 'Key',
  '请输入至少一条密钥。': 'Enter at least one key.',
  '请输入 Base URL。': 'Enter the Base URL.',
  '提交完成：{{success}}/{{total}} 成功。': 'Submitted: {{success}}/{{total}} succeeded.',
  '提交失败': 'Submission failed',
  '成功': 'Success',
  '失败': 'Failed',
  '渠道总数': 'Total Channels',
  '总消耗（全部渠道）': 'Total Usage (all channels)',
  '加载渠道失败': 'Failed to load channels',
  '加载批次明细失败': 'Failed to load batch details',
  '同步用量任务已提交。': 'The usage sync task has been submitted.',
  '同步用量失败': 'Failed to sync usage',
  '加载建议禁用词失败': 'Failed to load suggested keywords',
  '添加禁用词失败': 'Failed to add the keyword',
  '请选择模型': 'Select a model',
  '测试失败': 'Test failed',
  '该渠道没有可测试的模型': 'This channel has no models available for testing',
  '确定启用该渠道？': 'Enable this channel?',
  '确定停用该渠道？': 'Disable this channel?',
  '确认启用渠道': 'Enable Channel',
  '确认停用渠道': 'Disable Channel',
  '确认删除渠道': 'Delete Channel',
  '处理中...': 'Processing...',
  '渠道已启用': 'Channel enabled',
  '渠道已停用': 'Channel disabled',
  '启用渠道失败': 'Failed to enable the channel',
  '停用渠道失败': 'Failed to disable the channel',
  '确定删除？将同步用量并禁用上游渠道，删除后不可恢复。': 'Delete this channel? Usage will be synchronized and the upstream channel will be disabled. This action cannot be undone.',
  '删除成功': 'Deleted successfully',
  '删除渠道失败': 'Failed to delete the channel',
  '同步中...': 'Syncing...',
  '同步用量': 'Sync Usage',
  '同步用量成功': 'Usage synced successfully',
  '暂无已同步的消耗数据，请点击“同步用量”。': 'No synced usage data is available. Select Sync Usage to update it.',
  '建议禁用词': 'Suggest Keywords',
  '分组视图': 'Group View',
  '列表视图': 'List View',
  '筛选:': 'Filter:',
  '创建起': 'Created From',
  '创建止': 'Created To',
  '全部状态': 'All Statuses',
  '全部标签': 'All Tags',
  '搜索 ID / 渠道名 / 备注 / Key': 'Search ID / channel / note / key',
  '正在加载渠道': 'Loading channels',
  '展开': 'Expand',
  '标签 / 分组（批次）': 'Tag / Group (Batch)',
  'Key 数量': 'Key Count',
  '上传去向(最近一次)': 'Upload Result (latest)',
  '启用 / 停用': 'Enabled / Disabled',
  '该批已用额度($)': 'Batch Usage ($)',
  '未分组': 'Ungrouped',
  '提交 {{count}}': 'Submitted {{count}}',
  '新增 {{count}}': 'Added {{count}}',
  '重复 {{count}}': 'Duplicate {{count}}',
  '无效 {{count}}': 'Invalid {{count}}',
  '失败 {{count}}': 'Failed {{count}}',
  '{{count}} 启用': '{{count}} enabled',
  '{{count}} 停用': '{{count}} disabled',
  '在列表中管理': 'Manage in List',
  '正在加载明细': 'Loading details',
  '渠道名称': 'Channel Name',
  '已用额度($)': 'Used Quota ($)',
  '暂无渠道明细。': 'No channel details.',
  '暂无批次': 'No Batches',
  '这个账号当前没有渠道分组数据。': 'This account has no grouped channel data.',
  '已用额度': 'Used Quota',
  '测试': 'Test',
  '删除': 'Delete',
  '暂无渠道': 'No Channels',
  '暂无渠道，上传后会显示在这里。': 'No channels yet. Uploaded channels will appear here.',
  '共 {{count}} 个批次': '{{count}} batches',
  '共 {{count}} 条': '{{count}} items',
  '上一页': 'Previous page',
  '下一页': 'Next page',
  '向前跳转 5 页': 'Jump back 5 pages',
  '向后跳转 5 页': 'Jump forward 5 pages',
  '每页数量': 'Items per page',
  '{{count}} 条/页': '{{count}} / page',
  '测试渠道 - {{name}}': 'Test Channel - {{name}}',
  '测试方式': 'Test Mode',
  '经 New API（真实链路）': 'Via New API (real route)',
  '直连官方（验证密钥本身）': 'Direct Official Test (verify key)',
  '不经过 New API，直接用渠道原始密钥请求官方，验证密钥本身是否有效，可自定义发送内容。': 'Send the original channel key directly to the official endpoint without New API to verify the key itself. Custom content is supported.',
  '经 New API 用该渠道的 Key 向所选模型发探测请求，反映客户真实可用性（含分组/重定向配置）。': 'Send a probe through New API with this channel key to test real customer availability, including grouping and redirect settings.',
  'AWS Bedrock 直连只验证密钥(AK/SK)本身。真实模型 id 由 New API 转换，直连可能报「模型 id 无效」，但这不代表密钥坏了——已自动按「密钥有效」判定；若显示 403「该账号未开通此模型」则是真不可用，需在 AWS 控制台开通该模型访问后重新上线。测实际可用性请切到「经 New API」。': 'AWS Bedrock direct mode only verifies the AK/SK credentials. New API converts the actual model ID, so a direct test may report an invalid model ID without indicating a bad key. A 403 stating that the model is not enabled is a real failure; enable model access in AWS and bring the channel online again. Use New API mode to test real availability.',
  '自定义发送内容（留空=随机友好语：hi! / 你好~ / ping）': 'Custom content (leave blank for a random greeting: hi! / hello / ping)',
  '选择要测试的模型': 'Select a model to test',
  '测试该模型': 'Test This Model',
  '测试全部模型（{{count}}）': 'Test All Models ({{count}})',
  '测试进度 {{done}}/{{total}}': 'Test progress {{done}}/{{total}}',
  '可用 {{count}}': '{{count}} available',
  '共 {{count}} 项': '{{count}} results',
  '模型': 'Model',
  '实例': 'Instance',
  '结果': 'Result',
  '耗时': 'Latency',
  '信息': 'Information',
  '可用': 'Available',
  '选择模型后点击上方按钮开始测试': 'Select a model, then use the button above to start testing.',
  '建议自动禁用关键词': 'Suggest Auto-disable Keywords',
  '如果你发现某种上游报错代表 key 已经死了（如欠费、被封号），可把报错里的特征片段提交给我们。管理员审核通过后，健康体检命中该片段就会自动下架对应渠道。': 'If an upstream error indicates that a key is dead, such as depleted credit or suspension, submit a distinctive fragment. Once approved, health checks will automatically take matching channels offline.',
  '例如 Your credit balance is too low': 'Example: Your credit balance is too low',
  '正在加载': 'Loading',
  '已生效': 'Approved',
  '待审核': 'Pending',
  '已拒绝': 'Rejected',
  '暂无建议禁用词': 'No suggested keywords',
  '管理本系统的 Bearer API Key。': 'Manage Bearer API keys for this system.',
  'API 密钥': 'API Keys',
  '最近使用：{{date}}': 'Last used: {{date}}',
  '暂无 API Key': 'No API Keys',
  '可以在右侧创建新的开放 API Key。': 'Create a new Open API key on the right.',
  '创建 API Key': 'Create API Key',
  '名称': 'Name',
  '创建密钥': 'Create Key',
  '接口规范': 'API Specification',
  '验证密钥 whoami': 'Verify Key (whoami)',
  '获取分类 meta': 'Get Category Metadata',
  '批量上传 apikey': 'Batch Upload API Keys',
  '分页查询渠道': 'List Channels with Pagination',
  '支持分类与 key 格式': 'Supported Categories and Key Formats',
  '说明': 'Description',
  'key 格式': 'Key Format',
  '错误码': 'Error Codes',
  '复制': 'Copy',
  '区间总消费额度': 'Total Usage Quota',
  '区间总消费(约合美元)': 'Total Usage (USD est.)',
  '日均消费额度': 'Average Daily Usage',
  '每日消费快照': 'Daily Usage Snapshot',
  '开始日期': 'Start date',
  '结束日期': 'End date',
  '选择日期范围': 'Select date range',
  '选择开始和结束日期': 'Choose a start and end date',
  '刷新今日实时': 'Refresh Today',
  '日期': 'Date',
  '当日消费额度': 'Daily Usage Quota',
  '约合美元': 'USD est.',
  '占比': 'Share',
  '涉及渠道数': 'Channels',
  '正在加载快照': 'Loading snapshots',
  '消费额度': 'Usage Quota',
  '暂无涉及渠道。': 'No channels for this date.',
  '加载每日消费快照失败。': 'Failed to load daily usage snapshots.',
  '加载模型缺口失败': 'Failed to load model gaps',
  '模型缺口提醒': 'Model Gap Alert',
  '已复制缺口通知。': 'Model gap notice copied.',
  '当前模型供应缺口。': 'Current model supply gaps.',
  '复制通知': 'Copy Notice',
  '通知': 'Notifications',
  '公告通知': 'Announcements',
  '今日关闭': 'Hide for Today',
  '关闭公告': 'Dismiss Announcement',
  '暂无公告': 'No announcements',
  '有新公告时将在这里显示。': 'New announcements will appear here.',
  '公告管理': 'Announcement Management',
  '发布和管理站内公告。': 'Publish and manage site announcements.',
  '添加公告': 'Add Announcement',
  '填写公告内容，发布后会显示在顶部通知中。': 'Enter the announcement details. Published announcements will appear in the top notification center.',
  '分别填写中文和英文公告，用户将看到与当前语言一致的内容。': 'Enter both Chinese and English versions. Users will see the version matching their current language.',
  '中文版本': 'Chinese Version',
  '英文版本': 'English Version',
  '中文标题': 'Chinese Title',
  '请输入中文公告标题': 'Enter the Chinese announcement title',
  '中文内容': 'Chinese Content',
  '请输入中文公告内容': 'Enter the Chinese announcement content',
  '英文标题': 'English Title',
  '请输入英文公告标题': 'Enter the English announcement title',
  '英文内容': 'English Content',
  '请输入英文公告内容': 'Enter the English announcement content',
  '发布公告': 'Publish Announcement',
  '公告标题': 'Announcement Title',
  '请输入公告标题': 'Enter an announcement title',
  '公告内容': 'Announcement Content',
  '请输入公告内容': 'Enter the announcement content',
  '发布中...': 'Publishing...',
  '公告发布成功': 'Announcement published successfully',
  '发布公告失败': 'Failed to publish the announcement',
  '加载公告失败': 'Failed to load announcements',
  '正在加载公告': 'Loading announcements',
  '管理现有公告': 'Manage Announcements',
  '已发布': 'Published',
  '已下架': 'Unpublished',
  '下架': 'Unpublish',
  '重新发布': 'Republish',
  '公告已下架': 'Announcement unpublished',
  '公告已重新发布': 'Announcement republished',
  '更新公告状态失败': 'Failed to update the announcement status',
  '删除公告': 'Delete Announcement',
  '确定删除公告“{{title}}”吗？删除后无法恢复。': 'Delete announcement “{{title}}”? This action cannot be undone.',
  '公告已删除': 'Announcement deleted',
  '删除公告失败': 'Failed to delete the announcement',
  '暂无公告记录': 'No announcement records',
  '发布第一条公告后会显示在这里。': 'Your first announcement will appear here after publishing.',
  '字符': 'characters',
  '正在加载模型缺口': 'Loading model gaps',
  '平台类型': 'Platform Type',
  'RPM 缺口': 'RPM Gap',
  'TPM 估算': 'Estimated TPM',
  '暂无缺口': 'No Gaps',
  '目前没有模型缺口提醒。': 'There are currently no model gap alerts.',
  '用户映射': 'User Mappings',
  '管理用户名与 GYS 用户名的映射关系。': 'Manage mappings between usernames and GYS usernames.',
  '新增映射': 'Add Mapping',
  '新增用户映射': 'Add User Mapping',
  '编辑用户映射': 'Edit User Mapping',
  '正在加载用户映射': 'Loading user mappings',
  '加载用户映射失败': 'Failed to load user mappings',
  '用户映射创建成功': 'User mapping created successfully',
  '用户映射更新成功': 'User mapping updated successfully',
  '用户映射删除成功': 'User mapping deleted successfully',
  '删除用户映射失败': 'Failed to delete the user mapping',
  '确认删除用户映射': 'Delete User Mapping',
  '确定删除用户映射“{{name}}”吗？': 'Delete user mapping “{{name}}”?',
  '删除后，该用户将退出本站且无法登录，直到重新创建映射。GYS 上游账号将保留。': 'This user will be signed out and cannot sign in until a mapping is recreated. The GYS account will be retained.',
  '创建用户映射失败': 'Failed to create the user mapping',
  '更新用户映射失败': 'Failed to update the user mapping',
  '查看分类消耗': 'View Category Usage',
  '查看 {{name}} 的分类消耗': 'View category usage for {{name}}',
  '用户分类消耗': 'User Category Usage',
  '渠道分类消耗明细': 'Channel Category Usage Details',
  '分类明细': 'Category Details',
  '共 {{count}} 个分类': '{{count}} categories total',
  '正在读取用户分类消耗': 'Loading user category usage',
  '加载用户分类消耗失败': 'Failed to load user category usage',
  '该用户尚未同步消耗数据': 'No usage data has been synced for this user yet',
  '用户登录后系统会自动同步。': 'Usage will sync automatically after the user signs in.',
  '最近同步': 'Last Synced',
  '分类数量': 'Category Count',
  '渠道数量': 'Channel Count',
  '启用渠道': 'Active Channels',
  '总消耗额度': 'Total Usage Quota',
  '从上游同步并更新数据库': 'Sync from upstream and update the database',
  '暂无用户映射': 'No User Mappings',
  '点击“新增映射”创建第一条用户映射。': 'Click “Add Mapping” to create the first user mapping.',
  '账号类型': 'Account Type',
  '账号ID': 'Account ID',
  '账号ID必须为正整数': 'Account ID must be a positive integer',
  '选择账号类型，填写对应的 GYS 用户 ID。': 'Select the account type and enter its GYS user ID.',
  '子账号 ID': 'Sub-account ID',
  '子账号 ID 必须为正整数': 'Sub-account ID must be a positive integer',
  '更新时间': 'Updated At',
  '数据同步时间': 'Data synced at',
  '本站用户名': 'Local username',
  '本站显示名': 'Local display name',
  '请输入本站显示名': 'Enter a local display name',
  '请输入本站用户名': 'Enter a local username',
  '本站用户名须为3至64位字母、数字、点、横线或下划线': 'Use 3–64 letters, numbers, dots, hyphens, or underscores for the local username',
  '启用同步': 'Enable sync',
  '禁用同步': 'Disable sync',
  '已启用同步': 'Sync enabled',
  '已禁用同步': 'Sync disabled',
  '所属GYS用户名': 'Parent GYS username',
  '已同步到用户映射，已有映射信息已保留': 'Synced to user mappings. Existing mapping details were preserved.',
  '同步用户映射失败': 'Failed to sync user mapping',
  '启用映射': 'Enable mapping',
  '启用后，用户可以使用用户名登录。': 'When enabled, the user can sign in with the username.',
  '保存映射': 'Save Mapping',
  '请输入有效的显示名': 'Enter a valid display name',
  '当前账号无权限管理子账号': 'This account cannot manage sub-accounts',
  '管理子账号及分类汇率。': 'Manage sub-accounts and category rates.',
  '正在检查权限': 'Checking permissions',
  '新增子账号': 'Add Sub-account',
  '创建子账号': 'Create Sub-account',
  '创建中...': 'Creating...',
  '子账号创建成功': 'Sub-account created successfully',
  '子账号创建成功，可使用 GYS 用户名和密码登录本站。': 'Sub-account created. Sign in using its GYS username and password.',
  '编辑': 'Edit',
  '编辑子账号': 'Edit Sub-account',
  '保存修改': 'Save Changes',
  '保存中...': 'Saving...',
  '子账号修改成功': 'Sub-account updated successfully',
  '编辑子账号失败': 'Failed to update the sub-account',
  '新密码（可选）': 'New Password (optional)',
  '留空则不修改密码': 'Leave blank to keep the current password',
  '启用账号': 'Enable account',
  '确认删除子账号': 'Delete Sub-account',
  '确定删除子账号“{{name}}”吗？删除后无法恢复。': 'Delete sub-account “{{name}}”? This action cannot be undone.',
  '正在删除...': 'Deleting...',
  '子账号删除成功': 'Sub-account deleted successfully',
  '删除子账号失败': 'Failed to delete the sub-account',
  '编辑 {{name}}': 'Edit {{name}}',
  '删除 {{name}}': 'Delete {{name}}',
  '请输入用户名': 'Enter a username',
  '请输入GYS用户名': 'Enter a GYS username',
  'GYS用户名': 'GYS Username',
  '未映射': 'Not mapped',
  'GYS登录用户名': 'Username on GYS',
  '用户名须为3至64位字母、数字、点、横线或下划线': 'Use 3–64 letters, numbers, dots, hyphens, or underscores',
  'GYS用户名须为3至64位字母、数字、点、横线或下划线': 'Use 3–64 letters, numbers, dots, hyphens, or underscores for the GYS username',
  '请输入显示名': 'Enter a display name',
  '登录用户名': 'Login username',
  '显示名称': 'Display name',
  '密码': 'Password',
  '密码至少8位，须含字母、数字和特殊字符': 'Use at least 8 characters with a letter, number, and special character',
  '显示密码': 'Show password',
  '隐藏密码': 'Hide password',
  '用户名': 'Username',
  '显示名': 'Display Name',
  '渠道数': 'Channels',
  '不可管理子账号': 'Sub-account Management Unavailable',
  '当前账号没有管理子账号的权限。': 'This account cannot manage sub-accounts.',
  '暂无子账号': 'No Sub-accounts',
  '点击“新增子账号”创建第一个子账号。': 'Click “Add Sub-account” to create the first sub-account.',
  '新 API Key': 'New API Key',
  '加载 API Key 失败': 'Failed to load API keys',
  '创建成功：{{key}}': 'Created successfully: {{key}}',
  '创建成功，明文仅会显示一次。': 'Created successfully. The plaintext key is shown only once.',
  '创建失败': 'Creation failed',
  '查询渠道': 'Read Channels',
  '读取分类': 'Read Categories',
  '请求参数错误 / 分类不支持 / tag 重复': 'Invalid parameters / unsupported category / duplicate tag',
  'API Key 缺失、无效或停用': 'API key is missing, invalid, or disabled',
  '当前 Key 缺少所需权限 scope': 'This key does not have the required scope',
  '资源不存在': 'Resource not found',
  '服务端错误': 'Server error',
  'Claude 官方': 'Claude Official',
  'GPT 官方': 'GPT Official',
  '展开 {{date}} 的渠道明细': 'Expand channel details for {{date}}',
};

type LanguageContextValue = {
  language: Language;
  setLanguage: (language: Language) => void;
  t: (text: string, values?: TranslationValues) => string;
};

const LanguageContext = createContext<LanguageContextValue | null>(null);

function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>('zh');

  useEffect(() => {
    try {
      const storedLanguage = window.localStorage.getItem('supplier.lang') === 'en' ? 'en' : 'zh';
      setLanguageState(storedLanguage);
      document.documentElement.lang = storedLanguage === 'en' ? 'en' : 'zh-CN';
    } catch {
      // Language persistence is optional.
    }
  }, []);

  const setLanguage = useCallback((nextLanguage: Language) => {
    setLanguageState(nextLanguage);
    document.documentElement.lang = nextLanguage === 'en' ? 'en' : 'zh-CN';
    try {
      window.localStorage.setItem('supplier.lang', nextLanguage);
    } catch {
      // Language persistence is optional.
    }
  }, []);

  const t = useCallback(
    (text: string, values: TranslationValues = {}) => {
      const template = language === 'en' ? englishTranslations[text] || text : text;
      return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => String(values[key] ?? ''));
    },
    [language],
  );

  const value = useMemo(() => ({ language, setLanguage, t }), [language, setLanguage, t]);
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

function useLanguage() {
  const value = useContext(LanguageContext);
  if (!value) throw new Error('useLanguage must be used inside LanguageProvider');
  return value;
}

type ViewKey =
  | 'dashboard'
  | 'upload'
  | 'my-channels'
  | 'api-access'
  | 'sub-accounts'
  | 'daily-stats'
  | 'settlement-history'
  | 'announcements'
  | 'user-mappings'
  | 'model-gaps';

const categoryLabels: Record<string, string> = {
  aws: 'AWS Bedrock',
  aws_a: 'Claude on AWS',
  anthropic: 'Anthropic 官方',
  anthropic_small: 'Anthropic 小额',
  anthropic_test: 'Anthropic 测试小额',
  anthropic_ent: 'Anthropic 参数覆盖',
  openai: 'OpenAI',
  azure: 'Azure OpenAI',
  azure_claude: 'Azure Claude',
  ai_studio: 'Google AI Studio',
  vertexai: 'Vertex AI Gemini',
  vertexai_claude: 'Vertex AI Claude',
  openrouter: 'OpenRouter',
  ocrarouter: 'Ocrarouter Claude',
  opencode: 'OpenCode Claude',
  cloudflare: 'Cloudflare Claude',
};

const categoryLabelsEn: Record<string, string> = {
  aws: 'AWS Bedrock',
  aws_a: 'Claude on AWS',
  anthropic: 'Anthropic Official',
  anthropic_small: 'Anthropic Small',
  anthropic_test: 'Anthropic Test Small',
  anthropic_ent: 'Anthropic Parameter Override',
  openai: 'OpenAI',
  azure: 'Azure OpenAI',
  azure_claude: 'Azure Claude',
  ai_studio: 'Google AI Studio',
  vertexai: 'Vertex AI Gemini',
  vertexai_claude: 'Vertex AI Claude',
  openrouter: 'OpenRouter',
  ocrarouter: 'Ocrarouter Claude',
  opencode: 'OpenCode Claude',
  cloudflare: 'Cloudflare Claude',
};

function categoryLabel(category: string, language: Language) {
  return (language === 'en' ? categoryLabelsEn : categoryLabels)[category] || category;
}

const keyFormatHints: Record<string, string> = {
  aws: 'AccessKeyID|SecretAccessKey',
  aws_a: '单个 API Key + base_url',
  anthropic: 'sk-ant-...',
  anthropic_small: 'sk-ant-...',
  anthropic_test: 'sk-ant-...',
  anthropic_ent: 'sk-ant-oat01-...',
  openai: 'sk-...',
  azure: 'Resource|ApiKey|ApiVersion',
  azure_claude: 'Resource|ApiKey|ApiVersion',
  ai_studio: '单个 API Key',
  vertexai: 'GCP 服务账号 JSON 或 Vertex API Key',
  vertexai_claude: 'GCP 服务账号 JSON 或 Vertex API Key',
  openrouter: 'sk-or-...',
  opencode: '单个 API Key',
  cloudflare: '单个 API Key',
};

const keyFormatHintsEn: Record<string, string> = {
  aws: 'AccessKeyID|SecretAccessKey',
  aws_a: 'Single API key + base_url',
  anthropic: 'sk-ant-...',
  anthropic_small: 'sk-ant-...',
  anthropic_test: 'sk-ant-...',
  anthropic_ent: 'sk-ant-oat01-...',
  openai: 'sk-...',
  azure: 'Resource|ApiKey|ApiVersion',
  azure_claude: 'Resource|ApiKey|ApiVersion',
  ai_studio: 'Single API key',
  vertexai: 'GCP service-account JSON or Vertex API key',
  vertexai_claude: 'GCP service-account JSON or Vertex API key',
  openrouter: 'sk-or-...',
  opencode: 'Single API key',
  cloudflare: 'Single API key',
};

const singleUploadHints: Record<string, string> = {
  aws: 'Key 格式：AccessKey|SecretKey（AK/SK 模式，Region 可省略，系统自动探测）；或直接填一个 Bedrock API Key（API Key 模式，不带 |）。两种可混传，无需 Base URL',
  aws_a: 'AWS Claude 新版：填写 API Key 与 Base URL；Base URL 必须为 https://<租户>.api.aws，请勿填写占位地址。',
  anthropic: '只需填写 API Key（sk-ant-...），无需 Base URL。',
  anthropic_small: '填写小额官方 Key（sk-ant-...），无需 Base URL，请勿与普通 Anthropic Key 混用。',
  anthropic_test: '填写测试小额官方 Key（sk-ant-...），无需 Base URL，请与官方及小额分类分开上传。',
  anthropic_ent: '填写 Anthropic 参数覆盖 Key（sk-ant-oat01-...），无需 Base URL。',
  openai: '只需填写 API Key（sk-...），使用官方接口，无需 Base URL。',
  azure: '格式：Resource|ApiKey|ApiVersion，系统将自动拼接 https://{resource}.openai.azure.com。',
  azure_claude: 'Azure Claude 格式：Resource|ApiKey|ApiVersion，系统将自动拼接服务地址。',
  ai_studio: '只需填写 Gemini API Key（AIza...），使用 Google AI Studio 官方接口，无需 Base URL。',
  vertexai: '填写 GCP 服务账号 JSON 或 Vertex API Key，无需 Base URL。',
  vertexai_claude: '填写 GCP 服务账号 JSON 或 Vertex API Key，无需 Base URL。',
  openrouter: '填写 OpenRouter API Key（sk-or-v1-...），使用官方接口，无需 Base URL。',
  ocrarouter: '填写 Ocrarouter API Key，使用官方接口，无需 Base URL。',
  opencode: '填写 OpenCode API Key，使用官方接口，无需 Base URL。',
  cloudflare: '格式：API-Token|AccountID，使用 Cloudflare 官方接口，无需 Base URL。',
};

const singleUploadHintsEn: Record<string, string> = {
  aws: 'Key format: AccessKey|SecretKey (AK/SK; Region optional and auto-detected), or a single Bedrock API key without |. Both formats may be mixed. No Base URL is required.',
  aws_a: 'AWS Claude new: enter an API key and Base URL. The Base URL must be https://<tenant>.api.aws and cannot be a placeholder.',
  anthropic: 'Enter an API key (sk-ant-...). No Base URL is required.',
  anthropic_small: 'Enter a small official key (sk-ant-...). Do not mix it with regular Anthropic keys.',
  anthropic_test: 'Enter a test-small official key (sk-ant-...) and upload it separately from official and small categories.',
  anthropic_ent: 'Enter an Anthropic parameter-override key (sk-ant-oat01-...). No Base URL is required.',
  openai: 'Enter an API key (sk-...) for the official endpoint. No Base URL is required.',
  azure: 'Format: Resource|ApiKey|ApiVersion. The endpoint https://{resource}.openai.azure.com is generated automatically.',
  azure_claude: 'Azure Claude format: Resource|ApiKey|ApiVersion. The service endpoint is generated automatically.',
  ai_studio: 'Enter a Gemini API key (AIza...) for the official Google AI Studio endpoint.',
  vertexai: 'Enter a GCP service-account JSON or Vertex API key. No Base URL is required.',
  vertexai_claude: 'Enter a GCP service-account JSON or Vertex API key. No Base URL is required.',
  openrouter: 'Enter an OpenRouter API key (sk-or-v1-...) for the official endpoint.',
  ocrarouter: 'Enter an Ocrarouter API key for the official endpoint.',
  opencode: 'Enter an OpenCode API key for the official endpoint.',
  cloudflare: 'Format: API-Token|AccountID for the official Cloudflare endpoint.',
};

const uploadCategoryCards: Array<{
  key: string;
  name: string;
  provider: string;
  color: string;
  categories: string[];
}> = [
  { key: 'aws', name: 'AWS', provider: 'Amazon Bedrock', color: '#ff9900', categories: ['aws', 'aws_a'] },
  { key: 'anthropic', name: 'Anthropic', provider: 'Claude 官方', color: '#d97757', categories: ['anthropic', 'anthropic_small', 'anthropic_test', 'anthropic_ent'] },
  { key: 'openai', name: 'OpenAI', provider: 'GPT 官方', color: '#10a37f', categories: ['openai'] },
  { key: 'azure', name: 'Azure', provider: 'Microsoft Azure', color: '#0078d4', categories: ['azure', 'azure_claude'] },
  { key: 'google', name: 'Google', provider: 'Gemini / Vertex', color: '#4285f4', categories: ['ai_studio', 'vertexai', 'vertexai_claude'] },
  { key: 'openrouter', name: 'OpenRouter', provider: 'OpenRouter Claude', color: '#6467f2', categories: ['openrouter'] },
  { key: 'opencode', name: 'OpenCode', provider: 'OpenCode Claude', color: '#111827', categories: ['opencode'] },
];

const hiddenUploadCategories = new Set(['cloudflare']);

const channelUsageCategories = [
  'aws',
  'aws_a',
  'anthropic',
  'anthropic_small',
  'anthropic_test',
  'anthropic_ent',
  'openai',
  'azure',
  'azure_claude',
  'ai_studio',
  'vertexai',
  'vertexai_claude',
  'openrouter',
  'opencode',
];

const uploadCategoryVariants: Record<string, string> = {
  aws: 'Bedrock 密钥',
  aws_a: 'Claude 代理 (api.aws) · 新版',
  anthropic: '官方 API',
  anthropic_small: '小额官方',
  anthropic_test: '测试小额',
  anthropic_ent: '参数覆盖',
  openai: '官方 API',
  azure: 'Azure OpenAI · GPT',
  azure_claude: 'Azure · Claude',
  ai_studio: 'AI Studio · Gemini',
  vertexai: 'Vertex AI · Gemini',
  vertexai_claude: 'Vertex AI · Claude',
  openrouter: 'OpenRouter · Claude',
  opencode: 'OpenCode Claude',
  cloudflare: 'Cloudflare Claude',
};

const uploadCategoryVariantsEn: Record<string, string> = {
  aws: 'Bedrock Key',
  aws_a: 'Claude Proxy (api.aws) · New',
  anthropic: 'Official API',
  anthropic_small: 'Small Official',
  anthropic_test: 'Test Small',
  anthropic_ent: 'Parameter Override',
  openai: 'Official API',
  azure: 'Azure OpenAI · GPT',
  azure_claude: 'Azure · Claude',
  ai_studio: 'AI Studio · Gemini',
  vertexai: 'Vertex AI · Gemini',
  vertexai_claude: 'Vertex AI · Claude',
  openrouter: 'OpenRouter · Claude',
  ocrarouter: 'Ocrarouter · Claude',
  opencode: 'OpenCode Claude',
  cloudflare: 'Cloudflare Claude',
};

const scopeOptions = [
  { value: 'channels:write', label: '上传密钥' },
  { value: 'channels:read', label: '查询渠道' },
  { value: 'meta:read', label: '读取分类' },
];

const navItems: Array<{
  key: ViewKey;
  label: string;
  icon: ComponentType<{ size?: number; strokeWidth?: number }>;
}> = [
  { key: 'model-gaps', label: '模型缺口', icon: Zap },
  { key: 'dashboard', label: '控制台', icon: Gauge },
  { key: 'upload', label: '上传密钥', icon: UploadCloud },
  { key: 'my-channels', label: '我的渠道', icon: FileKey2 },
  { key: 'api-access', label: '开放 API', icon: BookOpen },
  { key: 'sub-accounts', label: '子账号管理', icon: Users },
  { key: 'daily-stats', label: '消费快照', icon: BarChart3 },
  { key: 'settlement-history', label: '结算历史', icon: CircleDollarSign },
  { key: 'announcements', label: '公告管理', icon: Megaphone },
  { key: 'user-mappings', label: '用户映射', icon: Users },
];

const supplierViewOrder: ViewKey[] = [
  'model-gaps',
  'dashboard',
  'upload',
  'my-channels',
  'sub-accounts',
  'daily-stats',
  'settlement-history',
];
const subAccountViewOrder: ViewKey[] = ['model-gaps', 'dashboard', 'upload', 'my-channels', 'daily-stats', 'settlement-history'];
const superAdminViewOrder: ViewKey[] = ['user-mappings', 'announcements', 'model-gaps'];

function isSuperAdmin(user: UserProfile) {
  return user.auth_source === 'local'
    && user.role === 'super_admin'
    && user.username.trim().toLowerCase() === SUPER_ADMIN_USERNAME.toLowerCase();
}

function allowedViewKeys(user: UserProfile): ViewKey[] {
  if (isSuperAdmin(user)) return superAdminViewOrder;
  if (user.auth_source !== 'upstream') return [];
  const baseViews = user.role === 'sub'
    ? subAccountViewOrder
    : user.role === 'admin' || user.role === 'supplier'
      ? supplierViewOrder
      : [];
  return baseViews;
}

function canAccessView(user: UserProfile, view: ViewKey) {
  return allowedViewKeys(user).includes(view);
}

function navigationItemsForUser(user: UserProfile) {
  return allowedViewKeys(user).map((key) => navItems.find((item) => item.key === key)!);
}

function defaultViewForUser(user: UserProfile): ViewKey {
  return isSuperAdmin(user) ? 'user-mappings' : 'dashboard';
}

const openApiErrors = [
  ['0', '成功'],
  ['40001', '请求参数错误 / 分类不支持 / tag 重复'],
  ['40101', 'API Key 缺失、无效或停用'],
  ['40301', '当前 Key 缺少所需权限 scope'],
  ['40401', '资源不存在'],
  ['50001', '服务端错误'],
];

const API_CACHE_TTL = 12_000;
const MODEL_GAPS_REFRESH_INTERVAL_MS = 3 * 60_000;
const CHANNEL_SUMMARY_REFRESH_INTERVAL_MS = 3 * 60_000;
const apiCache = new Map<string, { expiresAt: number; value: unknown }>();
const pendingApiRequests = new Map<string, Promise<unknown>>();
const USER_CACHE_KEY = 'gys:profile:v3';
const AUTH_MESSAGE_KEY = 'gys:auth-message';
let authRedirectPending = false;
let apiCacheVersion = 0;

const apiCodeMessages: Record<number, string> = {
  40001: '请求参数错误',
  40101: 'API Key 缺失、无效或已停用',
  40301: '当前 Key 缺少所需权限',
  40401: '资源不存在',
  50001: '服务器内部错误',
};

const apiCodeStatuses: Record<number, number> = {
  0: 200,
  40001: 400,
  40101: 401,
  40301: 403,
  40401: 404,
  50001: 500,
};

class ApiRequestError extends Error {
  code?: number;
  status: number;
  requestId?: string;

  constructor(message: string, status: number, code?: number, requestId?: string) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = code;
    this.requestId = requestId;
  }
}

function normalizeApiCode(code: ApiEnvelope<unknown>['code']) {
  if (typeof code === 'number' && Number.isFinite(code)) return code;
  if (typeof code === 'string' && code.trim()) {
    const parsed = Number(code);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function getApiErrorMessage(payload: ApiEnvelope<unknown>, status: number, code?: number) {
  const message = typeof payload.message === 'string' ? payload.message.trim() : '';
  if (message) return message;
  if (code && apiCodeMessages[code]) return apiCodeMessages[code];
  if (status === 401) return '登录状态已失效，请重新登录';
  if (status === 403) return '当前账号没有操作权限';
  if (status === 404) return '请求的资源不存在';
  if (status >= 500) return '服务器内部错误';
  return `请求失败：${status}`;
}

function redirectToLogin(path: string, message: string) {
  if (typeof window === 'undefined' || path.startsWith('/api/auth/login') || authRedirectPending) return;

  clearCachedUser();
  apiCache.clear();
  pendingApiRequests.clear();
  apiCacheVersion += 1;

  if (window.location.pathname === '/login') return;

  try {
    sessionStorage.setItem(AUTH_MESSAGE_KEY, message);
  } catch {
    // The redirect still works when browser storage is unavailable.
  }

  authRedirectPending = true;
  window.location.replace('/login');
}

function takeAuthMessage() {
  if (typeof window === 'undefined') return '';

  try {
    const message = sessionStorage.getItem(AUTH_MESSAGE_KEY) || '';
    sessionStorage.removeItem(AUTH_MESSAGE_KEY);
    return message;
  } catch {
    return '';
  }
}

function statusLabel(status?: number, language: Language = 'zh') {
  if (status === 1) return language === 'en' ? 'Enabled' : '启用';
  if (status === 2) return language === 'en' ? 'Disabled' : '禁用';
  if (status === 3) return language === 'en' ? 'Auto-disabled' : '自动禁用';
  if (status === 0) return language === 'en' ? 'Deleted' : '已删除';
  return language === 'en' ? 'Unknown' : '未知';
}

type PaginationItem = number | 'backward' | 'forward';

function createPaginationItems(currentPage: number, pageCount: number): PaginationItem[] {
  if (pageCount <= 7) {
    return Array.from({ length: pageCount }, (_, index) => index + 1);
  }

  const buffer = 2;
  let left = Math.max(1, currentPage - buffer);
  let right = Math.min(pageCount, currentPage + buffer);

  if (currentPage <= buffer + 2) {
    left = 1;
    right = 1 + buffer * 2;
  } else if (currentPage >= pageCount - buffer - 1) {
    left = pageCount - buffer * 2;
    right = pageCount;
  }

  const items: PaginationItem[] = [];
  if (left > 1) {
    items.push(1);
    if (left > 2) items.push('backward');
  }

  for (let page = left; page <= right; page += 1) {
    items.push(page);
  }

  if (right < pageCount) {
    if (right < pageCount - 1) items.push('forward');
    items.push(pageCount);
  }

  return items;
}

function formatQuota(value?: number, digits = 4) {
  return `$${((value || 0) / 500000).toFixed(digits)}`;
}

function formatInteger(value?: number) {
  return Number(value || 0).toLocaleString('zh-CN');
}

function formatNumericText(value?: string | number) {
  const raw = String(value ?? '0').trim();
  if (!/^\d+(?:\.\d+)?$/.test(raw)) return '0';
  const [whole, fraction = ''] = raw.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const cleanFraction = fraction.replace(/0+$/, '');
  return cleanFraction ? `${grouped}.${cleanFraction}` : grouped;
}

function formatDollarText(value?: string | number) {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount)) return '0.00';
  return amount.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatDate(value?: string | null, language: Language = 'zh') {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString(language === 'en' ? 'en-US' : 'zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatBeijingDateTime(value: number, language: Language = 'zh') {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString(language === 'en' ? 'en-US' : 'zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

function parseDateInputValue(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new Date(`${value}T12:00:00+08:00`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function formatDateInputValue(date: Date) {
  return beijingDayKey(date);
}

function formatDateInputLabel(value: string) {
  return value ? value.replaceAll('-', '/') : '-';
}

type AppDateRange = {
  start: string;
  end: string;
};

function AppDateRangePicker({
  value,
  onChange,
  startPlaceholder,
  endPlaceholder,
  clearable = false,
  align = 'end',
}: {
  value: AppDateRange;
  onChange: (nextRange: AppDateRange) => void;
  startPlaceholder?: string;
  endPlaceholder?: string;
  clearable?: boolean;
  align?: 'start' | 'center' | 'end';
}) {
  const { language, t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [draftRange, setDraftRange] = useState<DateRange | undefined>();
  const startLabel = value.start ? formatDateInputLabel(value.start) : startPlaceholder || t('开始日期');
  const endLabel = value.end ? formatDateInputLabel(value.end) : endPlaceholder || t('结束日期');

  function changeOpen(nextOpen: boolean) {
    if (nextOpen) {
      const from = parseDateInputValue(value.start);
      const to = parseDateInputValue(value.end);
      setDraftRange(from || to ? { from, to } : undefined);
    }
    setOpen(nextOpen);
  }

  function applyRange() {
    const from = draftRange?.from || draftRange?.to;
    const to = draftRange?.to || draftRange?.from;
    if (!from || !to) return;
    onChange({
      start: formatDateInputValue(from),
      end: formatDateInputValue(to),
    });
    setOpen(false);
  }

  function clearRange() {
    setDraftRange(undefined);
    onChange({ start: '', end: '' });
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={changeOpen}>
      <PopoverTrigger
        aria-label={`${t('开始日期')} ${startLabel}，${t('结束日期')} ${endLabel}`}
        className="app-date-range"
        type="button"
      >
        <CalendarDays aria-hidden="true" className="app-date-range-calendar-icon" size={15} />
        <span className="app-date-range-values">
          {value.start ? (
            <time dateTime={value.start}>{startLabel}</time>
          ) : (
            <span className="app-date-range-placeholder">{startLabel}</span>
          )}
          <span className="app-date-range-separator">→</span>
          {value.end ? (
            <time dateTime={value.end}>{endLabel}</time>
          ) : (
            <span className="app-date-range-placeholder">{endLabel}</span>
          )}
        </span>
        <ChevronDown aria-hidden="true" className="app-date-range-chevron" size={14} />
      </PopoverTrigger>
      <PopoverContent align={align} className="app-date-picker-popover" sideOffset={8}>
        <div className="app-date-picker-header">
          <PopoverTitle>{t('选择日期范围')}</PopoverTitle>
          <PopoverDescription>{t('选择开始和结束日期')}</PopoverDescription>
        </div>
        <Calendar
          className="app-range-calendar"
          defaultMonth={draftRange?.to || draftRange?.from}
          locale={language === 'en' ? enUS : zhCN}
          mode="range"
          numberOfMonths={1}
          onSelect={(nextRange) => setDraftRange(nextRange)}
          selected={draftRange}
          timeZone="Asia/Shanghai"
          weekStartsOn={1}
        />
        <div className="app-date-picker-actions">
          <div>
            {clearable && (
              <ActionButton className="ghost-button compact" onClick={clearRange} type="button">
                {t('清除')}
              </ActionButton>
            )}
          </div>
          <div className="app-date-picker-action-group">
            <ActionButton className="ghost-button compact" onClick={() => setOpen(false)} type="button">
              {t('取消')}
            </ActionButton>
            <ActionButton
              className="primary-button compact"
              disabled={!draftRange?.from && !draftRange?.to}
              onClick={applyRange}
              type="button"
            >
              {t('确定')}
            </ActionButton>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function buildUploadTagPreview(userId: number, category: string, timestamp: number) {
  const beijingDate = new Date(timestamp + 8 * 60 * 60 * 1_000);
  const time = [beijingDate.getUTCHours(), beijingDate.getUTCMinutes(), beijingDate.getUTCSeconds()]
    .map((value) => String(value).padStart(2, '0'))
    .join('');
  return `${userId}-${category}-${time}`;
}

function viewFromPath(pathname: string): ViewKey {
  const key = pathname.replace(/^\/+/, '').split('/')[0] as ViewKey;
  return navItems.some((item) => item.key === key) ? key : 'dashboard';
}

function normalizeUserProfile(value: unknown): UserProfile | null {
  if (!value || typeof value !== 'object') return null;
  const profile = value as Record<string, unknown>;
  const userId = Number(profile.user_id ?? profile.id);
  const username = typeof profile.username === 'string' ? profile.username.trim() : '';
  const displayName = typeof profile.display_name === 'string' ? profile.display_name.trim() : '';
  const role = profile.role;
  const authSource = profile.auth_source;
  if (
    !Number.isInteger(userId)
    || userId <= 0
    || !username
    || !['super_admin', 'admin', 'supplier', 'sub'].includes(String(role))
    || !['local', 'upstream'].includes(String(authSource))
    || ((role === 'super_admin') !== (authSource === 'local'))
  ) {
    return null;
  }
  return {
    id: userId,
    user_id: userId,
    username,
    display_name: displayName || username,
    role: role as UserRole,
    auth_source: authSource as AuthSource,
  };
}

function requireUserProfile(value: unknown) {
  const profile = normalizeUserProfile(value);
  if (!profile) throw new Error('Invalid profile response');
  return profile;
}

function readCachedUser(): UserProfile | null {
  if (typeof window === 'undefined') return null;

  try {
    const value = sessionStorage.getItem(USER_CACHE_KEY);
    return value ? normalizeUserProfile(JSON.parse(value)) : null;
  } catch {
    return null;
  }
}

function cacheUser(user: UserProfile) {
  if (typeof window === 'undefined') return;

  try {
    sessionStorage.setItem(USER_CACHE_KEY, JSON.stringify(user));
  } catch {
    // Storage can be unavailable in private browsing modes.
  }
}

function clearCachedUser() {
  if (typeof window === 'undefined') return;

  try {
    sessionStorage.removeItem(USER_CACHE_KEY);
  } catch {
    // Nothing else is needed when browser storage is unavailable.
  }
}

async function api<T>(path: string, init: ApiRequestInit = {}): Promise<T> {
  const { fresh = false, ...requestInit } = init;
  const method = (requestInit.method || 'GET').toUpperCase();
  const cacheKey = `${method}:${path}`;
  const cacheable = method === 'GET' && !path.startsWith('/api/auth/');
  const cacheVersion = apiCacheVersion;
  const cached = cacheable && !fresh ? apiCache.get(cacheKey) : undefined;

  if (cached && cached.expiresAt > Date.now()) {
    return cached.value as T;
  }

  if (cacheable && !fresh) {
    const pending = pendingApiRequests.get(cacheKey);
    if (pending) return pending as Promise<T>;
  }

  const request = (async () => {
    const headers = new Headers(requestInit.headers);
    let body = requestInit.body;

    if (
      body &&
      typeof body !== 'string' &&
      !(body instanceof FormData) &&
      !(body instanceof URLSearchParams) &&
      !(body instanceof Blob)
    ) {
      headers.set('content-type', 'application/json');
      body = JSON.stringify(body);
    }

    let response: Response;
    try {
      response = await sessionClient.fetch(path, {
        ...requestInit,
        body: body as BodyInit | null | undefined,
        headers,
      });
    } catch (error) {
      if (error instanceof SessionExpiredError) redirectToLogin(path, error.message);
      throw error;
    }
    const contentType = response.headers.get('content-type') || '';
    let payload: ApiEnvelope<T>;

    if (contentType.includes('application/json')) {
      try {
        const parsed = await response.json();
        payload = parsed && typeof parsed === 'object'
          ? (parsed as ApiEnvelope<T>)
          : ({ data: parsed as T, success: response.ok } as ApiEnvelope<T>);
      } catch {
        payload = { success: response.ok };
      }
    } else {
      payload = { data: (await response.text()) as T, success: response.ok };
    }

    const code = normalizeApiCode(payload.code);
    const status = !response.ok || code === undefined ? response.status : (apiCodeStatuses[code] ?? response.status);
    const message = getApiErrorMessage(payload, status, code);

    if (
      !response.ok ||
      payload.success === false ||
      (code !== undefined && code !== 0)
    ) {
      throw new ApiRequestError(message, status, code, payload.request_id);
    }

    let data = (payload.data ?? payload) as T;
    if (
      code === 0 &&
      payload.data !== undefined &&
      data &&
      typeof data === 'object' &&
      !Array.isArray(data)
    ) {
      const objectData = data as Record<string, unknown>;
      data = {
        ...objectData,
        message: objectData.message ?? payload.message,
        request_id: objectData.request_id ?? payload.request_id,
      } as T;
    }
    if (cacheable && cacheVersion === apiCacheVersion) {
      apiCache.set(cacheKey, { expiresAt: Date.now() + API_CACHE_TTL, value: data });
    } else if (!cacheable && cacheVersion === apiCacheVersion) {
      apiCache.clear();
    }
    return data;
  })();

  if (cacheable && !fresh) {
    pendingApiRequests.set(cacheKey, request);
  }

  try {
    return await request;
  } finally {
    if (pendingApiRequests.get(cacheKey) === request) pendingApiRequests.delete(cacheKey);
  }
}

function Badge({
  tone = 'neutral',
  children,
}: {
  tone?: 'neutral' | 'green' | 'blue' | 'orange' | 'red' | 'purple';
  children: ReactNode;
}) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

function EmptyState({
  title,
  description,
}: {
  title?: string;
  description?: string;
}) {
  const { t } = useLanguage();

  return (
    <div className="empty-state">
      <Database size={28} />
      <strong>{t(title || '暂无数据')}</strong>
      <span>{t(description || '暂无可显示的记录。')}</span>
    </div>
  );
}

function NoticeBanner({ notice }: { notice: Notice | null }) {
  const { t } = useLanguage();
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    setVisible(Boolean(notice));
    if (!notice) return;
    const timer = window.setTimeout(() => setVisible(false), notice.type === 'ok' ? 4000 : 8000);
    return () => window.clearTimeout(timer);
  }, [notice]);
  if (!notice || !visible || typeof document === 'undefined') return null;
  return createPortal(
    <div className={`notice notice-${notice.type} app-notice-toast`} role={notice.type === 'error' ? 'alert' : 'status'}>
      {notice.type === 'ok' ? <CheckCircle2 size={20} /> : <AlertTriangle size={20} />}
      <span>{notice.text}</span>
      <button type="button" aria-label={t('关闭')} onClick={() => setVisible(false)}><X size={16} /></button>
    </div>,
    document.body,
  );
}

function LoginScreen({ onLogin }: { onLogin: (user: UserProfile) => void }) {
  const { language, setLanguage, t } = useLanguage();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({ username: '', password: '' });
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [captchaOpen, setCaptchaOpen] = useState(false);
  const credentialsRef = useRef<{ username: string; password: string } | null>(null);
  const submittingRef = useRef(false);
  const loginControllerRef = useRef<AbortController | null>(null);

  const copy =
    language === 'zh'
      ? {
          brand: 'PushKey系统',
          accentKicker: 'PUSHKEY CONSOLE',
          accentTitle: '渠道、密钥与用量',
          accentNote: '致力于研制最顶级的大模型',
          accentTags: ['渠道管理', '密钥上传', '用量查看'],
          accentMetrics: [
            ['渠道', '集中管理'],
            ['密钥', '统一入口'],
            ['用量', '清晰可见'],
          ],
          username: '用户名',
          password: '密码',
          usernameRequired: '请输入用户名',
          passwordRequired: '请输入密码',
          submit: '登 录',
          failed: '登录失败',
          showPassword: '显示密码',
          hidePassword: '隐藏密码',
          captchaConfigFailed: '无法获取登录验证配置，请重试',
        }
      : {
          brand: 'PushKey System',
          accentKicker: 'PUSHKEY CONSOLE',
          accentTitle: 'Channels, keys, and usage',
          accentNote: 'Committed to developing world-class large language models.',
          accentTags: ['Channels', 'Key upload', 'Usage'],
          accentMetrics: [
            ['Channels', 'Centralized'],
            ['Keys', 'One entry'],
            ['Usage', 'Clear view'],
          ],
          username: 'Username',
          password: 'Password',
          usernameRequired: 'Please enter your username',
          passwordRequired: 'Please enter your password',
          submit: 'Log in',
          failed: 'Login failed',
          showPassword: 'Show password',
          hidePassword: 'Hide password',
          captchaConfigFailed: 'Unable to load login verification settings. Please try again.',
        };

  useEffect(() => {
    const authMessage = takeAuthMessage();
    if (authMessage) setNotice({ type: 'error', text: authMessage });
    return () => {
      credentialsRef.current = null;
      loginControllerRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (!notice) return;

    const timeout = window.setTimeout(() => setNotice(null), 4_000);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submittingRef.current || captchaOpen) return;
    const nextErrors = {
      username: username.trim() ? '' : copy.usernameRequired,
      password: password ? '' : copy.passwordRequired,
    };
    setFieldErrors(nextErrors);
    if (nextErrors.username || nextErrors.password) return;

    submittingRef.current = true;
    setLoading(true);
    setNotice(null);
    const credentials = { username: username.trim(), password };
    const isLocalSuperAdminLogin = credentials.username.toLowerCase() === SUPER_ADMIN_USERNAME.toLowerCase();
    const controller = new AbortController();
    loginControllerRef.current = controller;
    try {
      if (!isLocalSuperAdminLogin) {
        const config = await api<{ enabled: boolean }>('/api/auth/login-captcha', {
          fresh: true,
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        if (typeof config?.enabled !== 'boolean') throw new Error(copy.captchaConfigFailed);
        if (config.enabled) {
          credentialsRef.current = credentials;
          setCaptchaOpen(true);
          return;
        }
      }
      const user = requireUserProfile(await api<unknown>('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(credentials),
        signal: controller.signal,
      }));
      if (!controller.signal.aborted) onLogin(user);
    } catch (error) {
      if (controller.signal.aborted) return;
      setNotice({
        type: 'error',
        text: error instanceof Error ? error.message : copy.failed,
      });
    } finally {
      submittingRef.current = false;
      setLoading(false);
    }
  }

  return (
    <main className="login-shell">
      {notice && (
        <div className="login-toast" role="alert">
          <XCircle size={16} />
          <span>{notice.text}</span>
        </div>
      )}
      <div className="login-utility-bar">
        <button
          aria-label={t('语言切换')}
          className="topbar-round-button login-translation-button"
          onClick={() => setLanguage(language === 'zh' ? 'en' : 'zh')}
          title={t('语言切换')}
          type="button"
        >
          <Languages aria-hidden="true" size={19} />
        </button>
        <AnnouncementCenter userKey="public:login" />
      </div>
      <div className="login-ambient-copy" aria-hidden="true">
        <span>{copy.accentKicker}</span>
        <strong>{copy.accentTitle}</strong>
        <p>{copy.accentNote}</p>
        <div>
          {copy.accentTags.map((tag) => <small key={tag}>{tag}</small>)}
        </div>
      </div>
      <div className="login-ambient-metrics" aria-hidden="true">
        {copy.accentMetrics.map(([label, value]) => (
          <span key={label}>
            <small>{label}</small>
            <strong>{value}</strong>
          </span>
        ))}
      </div>
      <div className="login-ambient-stack" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <div className="login-ambient-orbit" aria-hidden="true"><span /></div>
      <div className="login-layout">
        <section className="login-card">
          <header className="login-card-header">
            <div className="login-brand">{copy.brand}</div>
          </header>
          <form onSubmit={submit} className="login-form" noValidate>
            <div className="login-form-item">
              <label className="login-field-label" htmlFor="login-username">{copy.username}</label>
              <div className={fieldErrors.username ? 'login-input login-input-error' : 'login-input'}>
                <User size={17} />
                <input
                  id="login-username"
                  aria-invalid={Boolean(fieldErrors.username)}
                  aria-label={copy.username}
                  value={username}
                  onChange={(event) => {
                    setUsername(event.target.value);
                    if (fieldErrors.username) setFieldErrors((current) => ({ ...current, username: '' }));
                  }}
                  placeholder={copy.username}
                  autoComplete="username"
                />
              </div>
              {fieldErrors.username && <span className="login-field-error">{fieldErrors.username}</span>}
            </div>
            <div className="login-form-item">
              <label className="login-field-label" htmlFor="login-password">{copy.password}</label>
              <div className={fieldErrors.password ? 'login-input login-input-error' : 'login-input'}>
                <LockKeyhole size={17} />
                <input
                  id="login-password"
                  aria-invalid={Boolean(fieldErrors.password)}
                  aria-label={copy.password}
                  value={password}
                  onChange={(event) => {
                    setPassword(event.target.value);
                    if (fieldErrors.password) setFieldErrors((current) => ({ ...current, password: '' }));
                  }}
                  placeholder={copy.password}
                  autoComplete="current-password"
                  type={showPassword ? 'text' : 'password'}
                />
                <button
                  aria-label={showPassword ? copy.hidePassword : copy.showPassword}
                  className="login-password-toggle"
                  onClick={() => setShowPassword((current) => !current)}
                  onMouseDown={(event) => event.preventDefault()}
                  type="button"
                >
                  {showPassword ? <Eye size={15} /> : <EyeOff size={15} />}
                </button>
              </div>
              {fieldErrors.password && <span className="login-field-error">{fieldErrors.password}</span>}
            </div>
            <ActionButton className="login-submit-button" disabled={loading} type="submit">
              {loading && <Loader2 className="spin" size={17} />}
              {copy.submit}
            </ActionButton>
          </form>
        </section>
      </div>
      {captchaOpen && (
        <LoginCaptcha
          language={language}
          request={api}
          onClose={() => {
            credentialsRef.current = null;
            setCaptchaOpen(false);
          }}
          onVerified={async (token, signal) => {
            const credentials = credentialsRef.current;
            if (!credentials || signal.aborted) return;
            const user = requireUserProfile(await api<unknown>('/api/auth/login', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ ...credentials, captcha_token: token }),
              signal,
            }));
            if (signal.aborted) return;
            credentialsRef.current = null;
            setCaptchaOpen(false);
            onLogin(user);
          }}
        />
      )}
    </main>
  );
}

function beijingDayKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function announcementVersion(item: AnnouncementItem) {
  return `${item.id}:${item.publishedAt || item.updatedAt}`;
}

function localizedAnnouncement(item: AnnouncementItem, language: Language) {
  const titleZh = item.titleZh?.trim() || item.title.trim();
  const contentZh = item.contentZh?.trim() || item.content.trim();
  const titleEn = item.titleEn?.trim() || '';
  const contentEn = item.contentEn?.trim() || '';
  if (language === 'en' && titleEn && contentEn) {
    return { title: titleEn, content: contentEn };
  }
  return { title: titleZh, content: contentZh };
}

function announcementPosition(item: AnnouncementItem) {
  return {
    publishedAt: item.publishedAt || item.updatedAt,
    id: item.id,
  };
}

function AnnouncementCenter({ userKey }: { userKey: string }) {
  const { language, t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'list' | 'notice'>('list');
  const [items, setItems] = useState<AnnouncementItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const checkedVersionRef = useRef('');
  const storageUserKey = encodeURIComponent(`uid:${userKey.trim().toLowerCase()}`);
  const snoozeStorageKey = `gys:announcement:snooze:${storageUserKey}`;
  const seenStorageKey = `gys:announcement:seen:${storageUserKey}`;
  const activeAnnouncement = items[0] || null;
  const activeAnnouncementCopy = activeAnnouncement
    ? localizedAnnouncement(activeAnnouncement, language)
    : null;

  const load = useCallback(async (signal?: AbortSignal, showAutomatically = false) => {
    setLoading(true);
    setError('');
    try {
      const data = await api<AnnouncementListResponse>('/api/announcements', {
        fresh: true,
        signal,
      });
      if (signal?.aborted) return;
      const nextItems = data.items || [];
      setItems(nextItems);

      const latest = nextItems[0];
      if (!showAutomatically || !latest) return;
      const version = announcementVersion(latest);
      if (checkedVersionRef.current === version) return;
      checkedVersionRef.current = version;

      let snoozedToday = false;
      let seen = false;
      try {
        const snoozed = JSON.parse(window.localStorage.getItem(snoozeStorageKey) || 'null') as {
          day?: string;
          version?: string;
        } | null;
        snoozedToday = snoozed?.day === beijingDayKey() && snoozed?.version === version;

        const storedPosition = JSON.parse(window.localStorage.getItem(seenStorageKey) || 'null') as {
          publishedAt?: number;
          id?: number;
        } | null;
        const latestPosition = announcementPosition(latest);
        const seenPublishedAt = Number(storedPosition?.publishedAt);
        const seenId = Number(storedPosition?.id);
        seen = Number.isFinite(seenPublishedAt) && Number.isFinite(seenId) && (
          latestPosition.publishedAt < seenPublishedAt
          || (latestPosition.publishedAt === seenPublishedAt && latestPosition.id <= seenId)
        );
      } catch {
        snoozedToday = false;
        seen = false;
      }

      if (!snoozedToday && !seen) {
        setMode('notice');
        setOpen(true);
      }
    } catch (failure) {
      if (!signal?.aborted) {
        setError(failure instanceof Error ? failure.message : t('加载公告失败'));
      }
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [seenStorageKey, snoozeStorageKey, t]);

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal, true);
    return () => controller.abort();
  }, [load]);

  useEffect(() => {
    function refreshAnnouncements() {
      checkedVersionRef.current = '';
      load(undefined, true);
    }
    window.addEventListener('gys:announcements-changed', refreshAnnouncements);
    return () => window.removeEventListener('gys:announcements-changed', refreshAnnouncements);
  }, [load]);

  function hideForToday() {
    if (activeAnnouncement) {
      try {
        window.localStorage.setItem(snoozeStorageKey, JSON.stringify({
          day: beijingDayKey(),
          version: announcementVersion(activeAnnouncement),
        }));
      } catch {
        // Closing the dialog still works when browser storage is unavailable.
      }
    }
    setOpen(false);
  }

  function rememberSeen(item: AnnouncementItem) {
    try {
      window.localStorage.setItem(seenStorageKey, JSON.stringify(announcementPosition(item)));
    } catch {
      // Closing the dialog still works when browser storage is unavailable.
    }
  }

  function dismissAnnouncement() {
    if (activeAnnouncement) rememberSeen(activeAnnouncement);
    setOpen(false);
  }

  return (
    <Dialog
      onOpenChange={nextOpen => {
        if (!nextOpen && mode === 'notice' && activeAnnouncement) {
          rememberSeen(activeAnnouncement);
        }
        setOpen(nextOpen);
        if (!nextOpen) setError('');
      }}
      open={open}
    >
      <DialogTrigger
        aria-label={t('公告通知')}
        className="topbar-round-button announcement-button"
        onClick={() => {
          setMode('list');
          load();
        }}
        title={t('公告通知')}
      >
        <Bell aria-hidden="true" className="announcement-button-icon" />
      </DialogTrigger>
      <DialogContent
        className={`announcement-dialog ${mode === 'notice' ? 'announcement-dialog-featured' : ''}`}
        showCloseButton={false}
      >
        <DialogHeader className="announcement-dialog-header">
          {mode === 'list' && (
            <span className="announcement-dialog-heading-icon" aria-hidden="true">
              <Bell size={19} />
            </span>
          )}
          <div>
            <DialogTitle className="announcement-dialog-title">
              {t(mode === 'notice' ? '通知' : '公告通知')}
            </DialogTitle>
            {mode === 'list' && (
              <DialogDescription className="announcement-dialog-description">
                {t('有新公告时将在这里显示。')}
              </DialogDescription>
            )}
            {mode === 'notice' && (
              <DialogDescription className="sr-only">
                {activeAnnouncementCopy?.title || t('公告通知')}
              </DialogDescription>
            )}
          </div>
        </DialogHeader>
        <DialogClose aria-label={t(mode === 'notice' ? '关闭公告' : '关闭')} className="announcement-dialog-close">
          <X size={18} />
        </DialogClose>
        <div className={`announcement-dialog-body ${mode === 'notice' ? 'announcement-featured-body' : ''}`}>
          {mode === 'notice' && activeAnnouncement ? (
            <article className="announcement-featured-article">
              <header>
                <h2>{activeAnnouncementCopy?.title}</h2>
                <time dateTime={new Date(activeAnnouncement.publishedAt || activeAnnouncement.createdAt).toISOString()}>
                  {formatBeijingDateTime(activeAnnouncement.publishedAt || activeAnnouncement.createdAt, language)}
                </time>
              </header>
              <p>{activeAnnouncementCopy?.content}</p>
            </article>
          ) : loading ? (
            <div className="announcement-dialog-loading">
              <Loader2 className="spin" size={22} />
              <span>{t('正在加载公告')}</span>
            </div>
          ) : error ? (
            <div className="announcement-dialog-error" role="alert">
              <AlertTriangle size={22} />
              <strong>{t('加载公告失败')}</strong>
              <p>{error}</p>
              <ActionButton className="ghost-button compact" onClick={() => load()} type="button">
                <RefreshCcw size={15} />{t('重试')}
              </ActionButton>
            </div>
          ) : items.length ? (
            <div className="announcement-dialog-list">
              {items.map(item => {
                const itemCopy = localizedAnnouncement(item, language);
                return (
                  <article className="announcement-dialog-item" key={item.id}>
                    <div className="announcement-dialog-item-heading">
                      <h3>{itemCopy.title}</h3>
                      <time dateTime={new Date(item.publishedAt || item.createdAt).toISOString()}>
                        {formatBeijingDateTime(item.publishedAt || item.createdAt, language)}
                      </time>
                    </div>
                    <p className="announcement-dialog-item-content">{itemCopy.content}</p>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="announcement-empty">
              <span className="announcement-empty-icon" aria-hidden="true">
                <Bell size={22} />
              </span>
              <strong>{t('暂无公告')}</strong>
              <p>{t('有新公告时将在这里显示。')}</p>
            </div>
          )}
        </div>
        {mode === 'notice' && activeAnnouncement && (
          <footer className="announcement-featured-actions">
            <ActionButton className="ghost-button compact" onClick={hideForToday} type="button">
              {t('今日关闭')}
            </ActionButton>
            <ActionButton className="primary-button compact announcement-dismiss-button" onClick={dismissAnnouncement} type="button">
              {t('关闭公告')}
            </ActionButton>
          </footer>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Shell({
  user,
  activeView,
  setActiveView,
  onLogout,
  isLoggingOut,
  children,
}: {
  user: UserProfile;
  activeView: ViewKey;
  setActiveView: (view: ViewKey) => void;
  onLogout: () => void;
  isLoggingOut: boolean;
  children: ReactNode;
}) {
  const { language, setLanguage, t } = useLanguage();
  const [menuOpen, setMenuOpen] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false);
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);
  const accountMenuRef = useRef<HTMLDivElement>(null);
  const visibleNavItems = navigationItemsForUser(user);

  useEffect(() => {
    if (!accountMenuOpen) return;

    function closeMenu(event: MouseEvent) {
      if (!accountMenuRef.current?.contains(event.target as Node)) {
        setAccountMenuOpen(false);
      }
    }

    document.addEventListener('mousedown', closeMenu);
    return () => document.removeEventListener('mousedown', closeMenu);
  }, [accountMenuOpen]);

  function navigate(view: ViewKey) {
    if (!canAccessView(user, view)) return;
    setActiveView(view);
    setMenuOpen(false);
    window.history.pushState({}, '', `/${view}`);
  }

  function openPasswordDialog() {
    setAccountMenuOpen(false);
    setPasswordError('');
    setOldPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setPasswordDialogOpen(true);
  }

  async function changePassword(event: FormEvent) {
    event.preventDefault();
    setPasswordError('');

    if (newPassword.length < 6) {
      setPasswordError(t('新密码至少 6 位。'));
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError(t('两次输入的密码不一致。'));
      return;
    }

    setChangingPassword(true);
    try {
      await api('/api/auth/password', {
        method: 'POST',
        body: { old_password: oldPassword, new_password: newPassword },
      });
      setPasswordDialogOpen(false);
      window.setTimeout(onLogout, 800);
    } catch (error) {
      setPasswordError(error instanceof Error ? error.message : t('修改密码失败，请稍后重试。'));
    } finally {
      setChangingPassword(false);
    }
  }

  return (
    <main className="app-shell">
      <aside className={`sidebar ${menuOpen ? 'sidebar-open' : ''}`}>
        <nav>
          {visibleNavItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.key}
                className={activeView === item.key ? 'active' : ''}
                onClick={() => navigate(item.key)}
                type="button"
              >
                <Icon size={18} />
                <span>{t(item.label)}</span>
              </button>
            );
          })}
        </nav>
      </aside>

      <section className="content-shell">
        <header className="topbar">
          <button
            className="icon-button mobile-only"
            onClick={() => setMenuOpen(true)}
            aria-label={t('打开菜单')}
            type="button"
          >
            <Menu size={20} />
          </button>
          <div className="topbar-spacer" />
          <div className="topbar-tools">
            <div className="topbar-action-buttons">
              <AnnouncementCenter userKey={`${user.auth_source}:${user.user_id}:${user.username}`} />
              <button
                aria-label={t('语言切换')}
                className="topbar-round-button language-toggle-button"
                onClick={() => setLanguage(language === 'zh' ? 'en' : 'zh')}
                title={t('语言切换')}
                type="button"
              >
                <svg
                  aria-hidden="true"
                  className="language-toggle-icon"
                  fill="none"
                  viewBox="0 0 32 32"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <rect className="language-toggle-icon-tile" height="17" rx="4.5" width="17" x="12" y="11" />
                  <rect className="language-toggle-icon-tile" height="17" rx="4.5" width="17" x="3" y="3" />
                  <text className="language-toggle-icon-letter language-toggle-icon-letter-a" textAnchor="middle" x="11.5" y="16.2">
                    A
                  </text>
                  <text className="language-toggle-icon-letter language-toggle-icon-letter-zh" textAnchor="middle" x="20.5" y="24.5">
                    文
                  </text>
                  <path
                    className="language-toggle-icon-spark"
                    d="M25.5 1.5c.45 2.25 1.75 3.55 4 4-2.25.45-3.55 1.75-4 4-.45-2.25-1.75-3.55-4-4 2.25-.45 3.55-1.75 4-4Z"
                  />
                  <path
                    className="language-toggle-icon-spark"
                    d="M5.5 22c.35 1.75 1.35 2.75 3.1 3.1-1.75.35-2.75 1.35-3.1 3.1-.35-1.75-1.35-2.75-3.1-3.1 1.75-.35 2.75-1.35 3.1-3.1Z"
                  />
                </svg>
                <span className="sr-only">{t('语言切换')}</span>
              </button>
            </div>
            <div className="account-menu" ref={accountMenuRef}>
              <button
                className="account-trigger"
                aria-expanded={accountMenuOpen}
                aria-haspopup="menu"
                onClick={() => setAccountMenuOpen((open) => !open)}
                type="button"
              >
                <span>{user.display_name || user.username}</span>
              </button>
              {accountMenuOpen && (
                <div className="account-dropdown" role="menu">
                  <button onClick={openPasswordDialog} role="menuitem" type="button">
                    <LockKeyhole size={16} />
                    <span>{t('修改密码')}</span>
                  </button>
                  <div className="account-menu-divider" />
                  <button
                    disabled={isLoggingOut}
                    onClick={onLogout}
                    role="menuitem"
                    type="button"
                  >
                    {isLoggingOut ? <Loader2 className="spin" size={16} /> : <LogOut size={16} />}
                    <span>{isLoggingOut ? t('退出中...') : t('退出登录')}</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>
        <div className="page-pad">{children}</div>
      </section>

      {menuOpen && (
        <button
          className="scrim"
          onClick={() => setMenuOpen(false)}
          aria-label={t('关闭菜单')}
          type="button"
        >
          <X size={22} />
        </button>
      )}

      {passwordDialogOpen && (
        <div className="dialog-backdrop" role="presentation">
          <section
            aria-labelledby="change-password-title"
            aria-modal="true"
            className="account-dialog"
            role="dialog"
          >
            <div className="account-dialog-header">
              <h2 id="change-password-title">{t('修改密码')}</h2>
              <button aria-label={t('关闭')} onClick={() => setPasswordDialogOpen(false)} type="button">
                <X size={18} />
              </button>
            </div>
            <form onSubmit={changePassword}>
              <label>
                <span>{t('旧密码')}</span>
                <input
                  autoComplete="current-password"
                  onChange={(event) => setOldPassword(event.target.value)}
                  required
                  type="password"
                  value={oldPassword}
                />
              </label>
              <label>
                <span>{t('新密码')}</span>
                <input
                  autoComplete="new-password"
                  onChange={(event) => setNewPassword(event.target.value)}
                  required
                  type="password"
                  value={newPassword}
                />
              </label>
              <label>
                <span>{t('确认新密码')}</span>
                <input
                  autoComplete="new-password"
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  required
                  type="password"
                  value={confirmPassword}
                />
              </label>
              {passwordError && <p className="account-dialog-error">{passwordError}</p>}
              <div className="account-dialog-actions">
                <ActionButton
                  className="ghost-button"
                  disabled={changingPassword}
                  onClick={() => setPasswordDialogOpen(false)}
                  type="button"
                >
                  {t('取消')}
                </ActionButton>
                <ActionButton className="primary-button compact" disabled={changingPassword} type="submit">
                  {changingPassword && <Loader2 className="spin" size={16} />}
                  {t('确定')}
                </ActionButton>
              </div>
            </form>
          </section>
        </div>
      )}
    </main>
  );
}

function DashboardView({ setView }: { setView: (view: ViewKey) => void }) {
  const { language, t } = useLanguage();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<Notice | null>(null);
  const channels = data?.channels || {};
  const healthRate = channels.avg_sr;
  const healthPercent = healthRate == null || healthRate < 0
    ? 0
    : Math.min(100, Math.round(healthRate * 1000) / 10);
  const healthColor = dashboardHealthColor(healthRate);
  const notScored = Math.max(0, (channels.total || 0) - (channels.scored || 0));
  const load = useCallback(async (fresh = false) => {
    setLoading(true);
    setNotice(null);
    try {
      setData(await api<DashboardData>('/api/dashboard', { fresh }));
    } catch (error) {
      setData(null);
      setNotice({
        type: 'error',
        text: error instanceof Error ? error.message : t('加载控制台失败'),
      });
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="dashboard-page">
      <NoticeBanner notice={data ? notice : null} />
      <header className="dashboard-page-heading">
        <span className="dashboard-page-heading-icon" aria-hidden="true">
          <Gauge size={22} />
        </span>
        <div>
          <h1>{t('控制台')}</h1>
          <p>{t('渠道运行状态、消费额度与健康度概览。')}</p>
        </div>
      </header>
      {loading ? (
        <div className="dashboard-skeleton" aria-label={t('正在加载控制台')}>
          {Array.from({ length: 7 }, (_, index) => <span key={index} />)}
        </div>
      ) : data ? (
        <>
          <div className="dashboard-stat-grid">
            <StatCard
              icon={FileKey2}
              label={t('我的渠道')}
              value={formatInteger(channels.total)}
              color="#1677ff"
              onClick={() => setView('my-channels')}
            />
            <StatCard
              icon={CircleDollarSign}
              label={t('累计消耗')}
              value={formatQuota(channels.quota_used, 2)}
              color="#13c2c2"
            />
            <StatCard
              icon={ShieldCheck}
              label={t('平均成功率')}
              value={channels.avg_sr == null ? t('暂无') : `${(channels.avg_sr * 100).toFixed(1)}%`}
              color={healthColor}
            />
            <StatCard
              icon={Zap}
              label={t('启用中')}
              value={formatInteger(channels.enabled)}
              color="#52c41a"
            />
          </div>

          <div className="dashboard-overview-grid">
            <article className="dashboard-card dashboard-health-card">
              <header className="dashboard-card-header">
                <h2><Activity size={17} /> {t('成功率健康度')}</h2>
                <span>{t('已评估 {{count}} 个', { count: formatInteger(channels.scored) })}</span>
              </header>
              <div className="dashboard-card-body dashboard-health-body">
                <div
                  className="dashboard-health-gauge"
                  style={{
                    '--dashboard-health-color': healthColor,
                    '--dashboard-health-sweep': `${healthPercent}%`,
                  } as CSSProperties}
                >
                  <span>{healthRate == null || healthRate < 0 ? t('暂无数据') : `${healthPercent}%`}</span>
                </div>
                <div className="dashboard-health-rows">
                  <HealthBar color="#52c41a" count={channels.good || 0} label={t('优秀 ≥95%')} total={channels.scored || 0} />
                  <HealthBar color="#faad14" count={channels.warn || 0} label={t('良好 80-95%')} total={channels.scored || 0} />
                  <HealthBar color="#ff4d4f" count={channels.bad || 0} label={t('偏低 <80%')} total={channels.scored || 0} />
                  <HealthBar color="#bfbfbf" count={notScored} label={t('暂无数据')} total={channels.total || 0} />
                </div>
              </div>
            </article>

            <article className="dashboard-card dashboard-channel-overview">
              <header className="dashboard-card-header"><h2><BarChart3 size={17} /> {t('渠道概况')}</h2></header>
              <div className="dashboard-card-body">
                <div className="dashboard-status-strip">
                  <span className="enabled"><small>{t('启用')}</small><strong>{formatInteger(channels.enabled)}</strong></span>
                  <span className="disabled"><small>{t('停用')}</small><strong>{formatInteger(channels.disabled)}</strong></span>
                  <span className="auto-disabled"><small>{t('自动禁用')}</small><strong>{formatInteger(channels.auto_disabled)}</strong></span>
                </div>
                <div className="dashboard-category-title">{t('分类分布')}</div>
                <div className="dashboard-category-list">
                  {data?.categories?.length ? data.categories.map((item) => {
                    const color = dashboardCategoryColor(item.category);
                    return (
                      <span key={item.category} style={{ backgroundColor: `${color}14`, color }}>
                        {categoryLabel(item.category, language)} · {formatInteger(item.count)}
                      </span>
                    );
                  }) : (
                    <span className="empty">
                      <Database size={15} />
                      {t('暂无数据')}
                    </span>
                  )}
                </div>
              </div>
            </article>
          </div>

          <article className="dashboard-card dashboard-attention-card">
            <header className="dashboard-card-header">
              <h2><AlertTriangle size={16} /> {t('需关注渠道（成功率偏低 / 自动禁用）')}</h2>
              <button onClick={() => setView('my-channels')} type="button">{t('全部')} <ChevronRight size={14} /></button>
            </header>
            <div className="dashboard-attention-body">
              {data?.attention?.length ? (
                <div className="dashboard-attention-table-wrap">
                  <table className="dashboard-attention-table">
                    <thead>
                      <tr>
                        <th>{t('渠道')}</th>
                        <th>{t('标签')}</th>
                        <th>{t('成功率')}</th>
                        <th>{t('近窗口错误')}</th>
                        <th aria-label={t('操作')} />
                      </tr>
                    </thead>
                    <tbody>
                      {data.attention.map((item) => (
                        <tr key={item.id}>
                          <td>{item.channel_name || item.name || ''}</td>
                          <td>{item.tag ? <span className="dashboard-attention-tag">{item.tag}</span> : '-'}</td>
                          <td><span className="dashboard-attention-rate">{((item.success_rate ?? 0) * 100).toFixed(1)}%</span></td>
                          <td>{formatInteger(item.req_error)}</td>
                          <td><button onClick={() => setView('my-channels')} type="button">{t('处理')} <ChevronRight size={13} /></button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="dashboard-attention-empty">
                  <span><CheckCircle2 size={24} /></span>
                  <span>{t('一切正常，没有需要关注的渠道')}</span>
                </div>
              )}
            </div>
          </article>

        </>
      ) : (
        <div className="dashboard-load-error" role="alert">
          <span aria-hidden="true"><AlertTriangle size={22} /></span>
          <div>
            <strong>{t('加载控制台失败')}</strong>
            <p>{notice?.text || t('加载控制台失败')}</p>
          </div>
          <ActionButton className="ghost-button compact" onClick={() => void load(true)} type="button">
            <RefreshCcw size={15} />
            {t('重新加载')}
          </ActionButton>
        </div>
      )}
    </section>
  );
}

function dashboardHealthColor(rate?: number | null) {
  if (rate == null || rate < 0) return '#bfbfbf';
  if (rate >= 0.95) return '#52c41a';
  if (rate >= 0.8) return '#faad14';
  return '#ff4d4f';
}

function dashboardCategoryColor(category: string) {
  return uploadCategoryCards.find((card) => card.categories.some((item) => item === category))?.color || '#8c8c8c';
}

function StatCard({
  icon: Icon,
  label,
  value,
  color,
  onClick,
}: {
  icon: ComponentType<{ size?: number }>;
  label: string;
  value: string;
  color: string;
  onClick?: () => void;
}) {
  const style = {
    '--dashboard-stat-color': color,
    '--dashboard-stat-soft': `${color}14`,
  } as CSSProperties;
  const content = (
    <>
      <span className="dashboard-stat-icon">
        <Icon size={22} />
      </span>
      <span className="dashboard-stat-copy">
        <small>{label}</small>
        <strong>{value}</strong>
      </span>
    </>
  );

  if (onClick) {
    return (
      <button className="dashboard-stat-card interactive" onClick={onClick} style={style} type="button">
        {content}
        <ChevronRight className="dashboard-stat-arrow" size={16} />
      </button>
    );
  }

  return <div className="dashboard-stat-card" style={style}>{content}</div>;
}

function HealthBar({
  color,
  count,
  label,
  total,
}: {
  color: string;
  count: number;
  label: string;
  total: number;
}) {
  const percent = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div className="dashboard-health-row">
      <i style={{ backgroundColor: color }} />
      <span>{label}</span>
      <div><b style={{ backgroundColor: color, width: `${percent}%` }} /></div>
      <strong>{formatInteger(count)}</strong>
    </div>
  );
}

function PageHeading({
  icon: Icon,
  title,
  subtitle,
  action,
}: {
  icon: ComponentType<{ size?: number }>;
  title: string;
  subtitle: string;
  action?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div className="heading-icon">
        <Icon size={24} />
      </div>
      <div>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      {action && <div className="heading-action">{action}</div>}
    </div>
  );
}

function UploadView({ userId }: { userId: number }) {
  const { language, t } = useLanguage();
  const [mode, setMode] = useState<'batch' | 'single'>('batch');
  const [switchData, setSwitchData] = useState<UploadSwitch | null>(null);
  const [category, setCategory] = useState('aws');
  const [models, setModels] = useState<string[]>([]);
  const [selectedModels, setSelectedModels] = useState<string[]>([]);
  const [tagTimestamp, setTagTimestamp] = useState(() => Date.now());
  const [keys, setKeys] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [remark, setRemark] = useState('');
  const [proxy, setProxy] = useState('');
  const [standby, setStandby] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [showAllMobileCategories, setShowAllMobileCategories] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [results, setResults] = useState<Array<Record<string, unknown>>>([]);

  const categories = (switchData?.uploadable_categories?.length
    ? switchData.uploadable_categories
    : Object.keys(categoryLabels))
    .filter((item) => !hiddenUploadCategories.has(item));
  const visibleCategoryCards = useMemo(() => {
    const available = new Set(categories);
    return uploadCategoryCards
      .map((card) => ({
        ...card,
        categories: card.categories.filter((item) => available.has(item)),
      }))
      .filter((card) => card.categories.length > 0);
  }, [categories]);
  const activeCategoryCard =
    visibleCategoryCards.find((card) => card.categories.includes(category)) || visibleCategoryCards[0];
  const tagPreview = useMemo(
    () => buildUploadTagPreview(userId, category, tagTimestamp),
    [category, tagTimestamp, userId],
  );
  const parsedKeys = useMemo(
    () =>
      keys
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean),
    [keys],
  );
  const uploadItems = useMemo(
    () =>
      parsedKeys.map((line) => {
        if (category !== 'aws_a') {
          return { key: line, base_url: '', remark: '', proxy: '' };
        }

        const [key = '', baseUrl = ''] = line.split(/[,\s]+/).filter(Boolean);
        return { key, base_url: baseUrl, remark: '', proxy: '' };
      }),
    [category, parsedKeys],
  );

  useEffect(() => {
    setTagTimestamp(Date.now());
    const timer = window.setInterval(() => setTagTimestamp(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [category]);

  useEffect(() => {
    api<UploadSwitch>('/api/settings/upload-switch')
      .then((data) => {
        setSwitchData(data);
        const availableCategories = (data.uploadable_categories || [])
          .filter((item) => !hiddenUploadCategories.has(item));
        setCategory((current) =>
          availableCategories.length && !availableCategories.includes(current)
            ? availableCategories[0]
            : current,
        );
      })
      .catch((error) => {
        setSwitchData({ enabled: true });
        setNotice({
          type: 'error',
          text: error instanceof Error ? error.message : t('加载上传设置失败'),
        });
      });
  }, [t]);

  useEffect(() => {
    api<{ category: string; models: string[] }>(
      `/api/channels/category-models?category=${encodeURIComponent(category)}`,
    )
      .then((data) => {
        setModels(data.models || []);
        setSelectedModels(data.models || []);
      })
      .catch((error) => {
        setModels([]);
        setSelectedModels([]);
        setNotice({
          type: 'error',
          text: error instanceof Error ? error.message : t('加载模型列表失败'),
        });
      });
  }, [category, t]);

  useEffect(() => {
    if (!notice) return;

    const timeout = window.setTimeout(() => setNotice(null), 5_000);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  function toggleModel(model: string) {
    setSelectedModels((current) =>
      current.includes(model)
        ? current.filter((item) => item !== model)
        : [...current, model],
    );
  }

  function selectCategoryCard(card: (typeof visibleCategoryCards)[number]) {
    if (!card.categories.includes(category)) {
      setCategory(card.categories[0]);
      setBaseUrl('');
    }
  }

  const keyListPlaceholder =
    category === 'aws'
      ? language === 'en'
        ? 'AKIxxx1|secret1\nAKIxxx2|secret2   (Region optional and auto-detected; AK|SK|Region is also supported)'
        : 'AKIxxx1|secret1\nAKIxxx2|secret2   （Region 可省略，系统自动探测；也可写 AK|SK|Region）'
      : category === 'aws_a'
        ? 'sk-ant-xxx1,https://a.api.aws\nsk-ant-xxx2,https://b.api.aws'
        : `${(language === 'en' ? keyFormatHintsEn : keyFormatHints)[category] || 'API Key'}\n${language === 'en' ? 'One key per line; duplicates are removed automatically' : '每行一个密钥，系统自动去重'}`;
  const keyInfo =
    category === 'aws'
      ? (language === 'en' ? singleUploadHintsEn.aws : 'Key 格式： AccessKey|SecretKey（AK/SK 模式，Region 可省略，系统自动探测）；或直接填一个 Bedrock API Key（API Key 模式，不带 |）。两种可混传，无需 Base URL')
      : language === 'en'
        ? `Key format: ${keyFormatHintsEn[category] || 'API Key'}. Enter one key per line; duplicates are removed automatically.`
        : `Key 格式：${keyFormatHints[category] || 'API Key'}。每行一个密钥，系统自动去重。`;
  const singleUsesTextarea = category === 'aws' || category === 'azure' || category === 'azure_claude' || category === 'cloudflare';
  const singleKeyLabel = singleUsesTextarea ? t('密钥') : 'API Key';
  const singleKeyPlaceholder =
    category === 'aws'
      ? 'AccessKey|SecretKey|Region'
      : category === 'azure' || category === 'azure_claude'
        ? 'citoai-xxx|ApiKey|2025-04-01-preview'
        : category === 'cloudflare'
          ? 'API-Token|AccountID'
          : category === 'openai'
            ? 'sk-...'
            : category === 'openrouter'
              ? 'sk-or-v1-...'
              : category === 'ocrarouter' || category === 'opencode'
                ? 'API Key'
                : 'sk-ant-xxxxx';

  async function submit(event: FormEvent) {
    event.preventDefault();
    setNotice(null);
    setResults([]);

    if (!parsedKeys.length) {
      setNotice({ type: 'warn', text: t('请输入至少一条密钥。') });
      return;
    }

    if (mode === 'single' && category === 'aws_a' && !baseUrl.trim()) {
      setNotice({ type: 'warn', text: t('请输入 Base URL。') });
      return;
    }

    setSubmitting(true);
    try {
      const body =
        mode === 'batch'
          ? {
              category,
              items: uploadItems,
              models: selectedModels,
              standby,
              remark: remark.trim(),
              proxy: proxy.trim(),
            }
          : {
              category,
              key: keys.trim(),
              base_url: category === 'aws_a' ? baseUrl.trim() : '',
              models: selectedModels,
              standby,
              remark: remark.trim(),
              proxy: proxy.trim(),
            };
      const path = mode === 'batch' ? '/api/channels/batch' : '/api/channels';
      const data = await api<{
        results?: Array<Record<string, unknown>>;
        total?: number;
        success?: number;
      }>(path, { method: 'POST', body });
      setNotice({
        type: 'ok',
        text: t('提交完成：{{success}}/{{total}} 成功。', {
          success: data.success ?? 0,
          total: data.total ?? parsedKeys.length,
        }),
      });
      setResults(data.results || []);
    } catch (error) {
      const message = error instanceof Error ? error.message : t('提交失败');
      setNotice({
        type: 'error',
        text: message,
      });
    } finally {
      setSubmitting(false);
    }
  }

  if (switchData && !switchData.enabled) {
    return (
      <section className="upload-page">
        <h2>{t('上传 API 密钥')}</h2>
        <div className="upload-disabled">
          <NoticeBanner
            notice={{
              type: 'error',
              text: t('系统维护中，暂停上传。已上传渠道的查询、消费统计不受影响。'),
            }}
          />
        </div>
      </section>
    );
  }

  return (
    <section className="upload-page">
      {notice && (
        <div className={`upload-toast upload-toast-${notice.type}`} role="alert">
          {notice.type === 'ok' ? <CheckCircle2 size={16} /> : notice.type === 'error' ? <XCircle size={16} /> : <AlertTriangle size={16} />}
          <span>{notice.text}</span>
        </div>
      )}
      <div className="upload-page-header">
        <div className="upload-page-title">
          <span className="upload-page-title-icon" aria-hidden="true">
            <UploadCloud size={22} />
          </span>
          <div>
            <h2>{t('上传 API 密钥')}</h2>
            <p className="upload-intro">
              {t('选择分类并粘贴密钥即可提交。标签 / 分组由系统自动生成，系统随后创建渠道、归入分组并完成上线。各上游实例可单独限制接收的分类；上传页仅隐藏当前无人接收的分类。')}
            </p>
          </div>
        </div>
      </div>

      <div className="upload-workspace">
        <form className={`upload-workspace-form upload-workspace-form-${mode}`} onSubmit={submit}>
          <section className="upload-panel upload-category-section">
            <div className="upload-section-heading">
              <div className="upload-section-copy">
                <span className="upload-step-index">1</span>
                <div>
                  <h3>{t('选择渠道分类')}</h3>
                  <p>{t('选择密钥对应的服务渠道')}</p>
                </div>
              </div>
              <span className="upload-current-category">{categoryLabel(category, language)}</span>
            </div>
            <div
              className={`upload-category-grid${showAllMobileCategories ? ' is-expanded' : ''}`}
              id="upload-category-grid"
            >
              {visibleCategoryCards.map((card) => {
                const isActive = card.categories.includes(category);
                return (
                  <button
                    className={isActive ? 'upload-category-card active' : 'upload-category-card'}
                    key={card.key}
                    onClick={() => selectCategoryCard(card)}
                    aria-pressed={isActive}
                    style={{ '--category-color': card.color } as CSSProperties}
                    type="button"
                  >
                    <span className="upload-category-letter">{card.name[0]}</span>
                    <strong>{card.name}</strong>
                    <small>{t(card.provider)}</small>
                  </button>
                );
              })}
            </div>

            {visibleCategoryCards.length > 2 && !showAllMobileCategories && (
              <ActionButton
                aria-controls="upload-category-grid"
                aria-expanded="false"
                className="ghost-button compact upload-category-show-all"
                onClick={() => setShowAllMobileCategories(true)}
                type="button"
              >
                {t('查看全部')}
                <ChevronDown aria-hidden="true" size={15} />
              </ActionButton>
            )}

            {activeCategoryCard && activeCategoryCard.categories.length > 1 && (
              <div className="upload-category-variants">
                {activeCategoryCard.categories.map((item) => (
                  <button
                    className={category === item ? 'active' : ''}
                    key={item}
                    onClick={() => {
                      setCategory(item);
                      setBaseUrl('');
                    }}
                    aria-pressed={category === item}
                    type="button"
                  >
                    {(language === 'en' ? uploadCategoryVariantsEn : uploadCategoryVariants)[item] || categoryLabel(item, language)}
                  </button>
                ))}
              </div>
            )}
          </section>

          <aside className="upload-panel upload-settings-panel">
            <div className="upload-section-heading">
              <div className="upload-section-copy">
                <span className="upload-step-index">2</span>
                <div>
                  <h3>{t('上传设置')}</h3>
                  <p>{t('确认自动标签与可选配置')}</p>
                </div>
              </div>
            </div>

            <div className="upload-tag-field">
              <span>{t('自动生成标签')}</span>
              <output className="upload-tag-output" aria-label={t('标签 / 分组（后端生成）')}>
                <Tag aria-hidden="true" size={15} />
                <code>{tagPreview}</code>
              </output>
            </div>

            <Dialog
              disablePointerDismissal
              onOpenChange={(nextOpen, eventDetails) => {
                if (!nextOpen && eventDetails.reason !== 'close-press') {
                  eventDetails.cancel();
                  return;
                }
                setAdvanced(nextOpen);
              }}
              open={advanced}
            >
              <DialogTrigger className="upload-advanced-toggle" type="button">
                <span className="upload-advanced-copy">
                  <strong>{t('高级选项')}</strong>
                  <small>{t('模型范围 · 号况 · 备注 · 代理')}</small>
                </span>
                <span className="upload-advanced-optional">{t('可选')}</span>
              </DialogTrigger>
              <DialogContent className="upload-advanced-dialog" showCloseButton={false}>
                <div className="upload-advanced-dialog-header">
                  <DialogHeader>
                    <DialogTitle>{t('高级选项')}</DialogTitle>
                    <DialogDescription>{t('模型范围 · 号况 · 备注 · 代理')}</DialogDescription>
                  </DialogHeader>
                  <DialogClose aria-label={t('关闭')} className="upload-advanced-dialog-close">
                    <X size={18} />
                  </DialogClose>
                </div>
                <div className="upload-advanced-dialog-body">
                  <div className="upload-advanced-content" id="upload-advanced-settings">
                    <div className="model-picker">
                      <div>
                        <strong>{t('可用模型范围')}</strong>
                        <span>
                          {t('已选 {{selected}}/{{total}}', { selected: selectedModels.length, total: models.length || 0 })}
                        </span>
                      </div>
                      {models.length ? (
                        <div className="chip-grid">
                          {models.map((model) => {
                            const isSelected = selectedModels.includes(model);
                            return (
                              <button
                                aria-pressed={isSelected}
                                className={isSelected ? 'chip selected' : 'chip'}
                                key={model}
                                onClick={() => toggleModel(model)}
                                type="button"
                              >
                                <span className="upload-model-name">{model}</span>
                                {isSelected && <CheckCircle2 aria-hidden="true" className="upload-model-check" size={14} />}
                              </button>
                            );
                          })}
                        </div>
                      ) : (
                        <span className="muted">{t('该分类暂未返回模型范围，默认使用全部模型。')}</span>
                      )}
                    </div>
                    <label className="check-row">
                      <input checked={standby} onChange={(event) => setStandby(event.target.checked)} type="checkbox" />
                      <span>{t('入库存（备用，暂不上线）')}</span>
                    </label>
                    <label>
                      <span>{t('备注（可选）')}</span>
                      <textarea
                        value={remark}
                        onChange={(event) => setRemark(event.target.value)}
                        rows={3}
                        placeholder={t('写一行 = 全部共用；也可一行一个，与密钥逐行对应')}
                      />
                    </label>
                    <label>
                      <span>{t('代理 SOCKS5/HTTP（可选）')}</span>
                      <textarea
                        value={proxy}
                        onChange={(event) => setProxy(event.target.value)}
                        rows={3}
                        placeholder="socks5://user:pass@host:port"
                      />
                    </label>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          </aside>

          <section className="upload-panel upload-input-panel">
            <div className="upload-section-heading">
              <div className="upload-section-copy">
                <span className="upload-step-index">3</span>
                <div>
                  <div className="upload-input-title-row">
                    <h3>{t('填写密钥')}</h3>
                    {mode === 'batch' && (
                      <span className="upload-recognized-count">
                        {t('已识别 {{count}} 条', { count: parsedKeys.length })}
                      </span>
                    )}
                  </div>
                  <p>
                    {mode === 'batch'
                      ? t('批量粘贴密钥，系统会自动去重')
                      : t('填写当前渠道所需的密钥信息')}
                  </p>
                </div>
              </div>
              <div className="upload-tabs" role="tablist">
                <button
                  aria-selected={mode === 'batch'}
                  className={mode === 'batch' ? 'active' : ''}
                  onClick={() => setMode('batch')}
                  role="tab"
                  type="button"
                >
                  {t('批量上传')}
                </button>
                <button
                  aria-selected={mode === 'single'}
                  className={mode === 'single' ? 'active' : ''}
                  onClick={() => setMode('single')}
                  role="tab"
                  type="button"
                >
                  {t('单个上传')}
                </button>
              </div>
            </div>

            {mode === 'batch' && (
              <>
                <div className="upload-key-info">
                  <Info size={18} />
                  <div>
                    <strong>{t('每行一个密钥')}</strong>
                    <p>{keyInfo}</p>
                  </div>
                </div>
                <label className="upload-key-list-field">
                  <textarea
                    aria-label={t('密钥列表（一行一个，自动去重）')}
                    value={keys}
                    onChange={(event) => setKeys(event.target.value)}
                    placeholder={keyListPlaceholder}
                    rows={14}
                  />
                </label>
              </>
            )}

            {mode === 'single' && (
              <>
                <div className="upload-single-key-info">
                  <Info size={15} />
                  <span>{(language === 'en' ? singleUploadHintsEn : singleUploadHints)[category] || t('请填写该渠道的 API Key。')}</span>
                </div>
                <label className="upload-single-key-field">
                  <span>{singleKeyLabel}</span>
                  {singleUsesTextarea ? (
                    <textarea
                      value={keys}
                      onChange={(event) => setKeys(event.target.value)}
                      placeholder={singleKeyPlaceholder}
                      rows={2}
                    />
                  ) : (
                    <input
                      autoComplete="off"
                      value={keys}
                      onChange={(event) => setKeys(event.target.value)}
                      placeholder={singleKeyPlaceholder}
                      type="password"
                    />
                  )}
                </label>
                {category === 'aws_a' && (
                  <label className="upload-single-key-field upload-single-base-url">
                    <span>Base URL</span>
                    <input
                      autoComplete="off"
                      value={baseUrl}
                      onChange={(event) => setBaseUrl(event.target.value)}
                      placeholder="https://abcd1234.api.aws"
                      type="url"
                    />
                  </label>
                )}
              </>
            )}
          </section>

          <footer className="upload-submit-bar">
            <ActionButton
              className="primary-button upload-submit-button"
              disabled={submitting || !parsedKeys.length || (mode === 'single' && category === 'aws_a' && !baseUrl.trim())}
              type="submit"
            >
              {submitting ? <Loader2 className="spin" size={17} /> : <UploadCloud size={17} />}
              {standby ? t('入库存') : mode === 'batch' ? t('批量提交') : t('提交密钥')}
            </ActionButton>
          </footer>
        </form>

        {results.length > 0 && (
          <div className="result-list">
            {results.slice(0, 20).map((row, index) => (
              <div key={`${index}-${String(row.key || '')}`} className="result-row">
                <span>#{String(row.index ?? index + 1)}</span>
                <code>{String(row.key || row.channel_id || '-')}</code>
                <Badge tone={row.success ? 'green' : 'red'}>{row.success ? t('成功') : t('失败')}</Badge>
                <small>{String(row.message || '')}</small>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function MyChannelsView() {
  const { language, t } = useLanguage();
  const [viewMode, setViewMode] = useState<'group' | 'list'>('list');
  const [items, setItems] = useState<ChannelItem[]>([]);
  const [groups, setGroups] = useState<ChannelGroupSummary[]>([]);
  const [summary, setSummary] = useState<ChannelSummary>({ count: 0, total_quota: 0 });
  const [tags, setTags] = useState<string[]>([]);
  const [category, setCategory] = useState('');
  const [status, setStatus] = useState('');
  const [tag, setTag] = useState('');
  const [mobileFilterKind, setMobileFilterKind] = useState<'category' | 'status' | 'tag'>('category');
  const [mobileFilterOpen, setMobileFilterOpen] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [groupPage, setGroupPage] = useState(1);
  const [listPage, setListPage] = useState(1);
  const [groupTotal, setGroupTotal] = useState(0);
  const [listTotal, setListTotal] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  const [dateRange, setDateRange] = useState({ from: '', to: '' });
  const [expandedTags, setExpandedTags] = useState<string[]>([]);
  const [groupDetails, setGroupDetails] = useState<Record<string, ChannelItem[]>>({});
  const [detailLoading, setDetailLoading] = useState<Record<string, boolean>>({});
  const [syncing, setSyncing] = useState(false);
  const [keywordsOpen, setKeywordsOpen] = useState(false);
  const [disableKeywords, setDisableKeywords] = useState<DisableKeyword[]>([]);
  const [newKeyword, setNewKeyword] = useState('');
  const [keywordsLoading, setKeywordsLoading] = useState(false);
  const [keywordSaving, setKeywordSaving] = useState(false);
  const [rowAction, setRowAction] = useState<{ id: number; type: 'status' | 'delete' } | null>(null);
  const [channelConfirmation, setChannelConfirmation] = useState<{
    item: ChannelItem;
    type: 'status' | 'delete';
    nextStatus?: number;
  } | null>(null);
  const [testChannelItem, setTestChannelItem] = useState<ChannelItem | null>(null);
  const [testMode, setTestMode] = useState<'newapi' | 'direct'>('direct');
  const [testContent, setTestContent] = useState('');
  const [testModels, setTestModels] = useState<string[]>([]);
  const [testModel, setTestModel] = useState('');
  const [testLoading, setTestLoading] = useState(false);
  const [testResults, setTestResults] = useState<ChannelTestResult[]>([]);
  const [testProgress, setTestProgress] = useState<{ done: number; total: number } | null>(null);
  const [testError, setTestError] = useState('');
  const [testToast, setTestToast] = useState<{ id: number; text: string } | null>(null);
  const loadRequestId = useRef(0);

  const categoryOptions = useMemo(() => {
    const available = (summary.categories || [])
      .map((item) => item.category?.trim())
      .filter((item): item is string => !!item);
    return Array.from(new Set(available.length ? available : Object.keys(categoryLabels)));
  }, [summary.categories]);

  const applyDateRange = useCallback((params: URLSearchParams) => {
    if (dateRange.from) params.set('created_from', dateRange.from);
    if (dateRange.to) params.set('created_to', dateRange.to);
  }, [dateRange.from, dateRange.to]);

  const applyCommonFilters = useCallback((params: URLSearchParams) => {
    if (category) params.set('category', category);
    applyDateRange(params);
  }, [applyDateRange, category]);

  const applyListFilters = useCallback((params: URLSearchParams) => {
    applyCommonFilters(params);
    if (status) params.set('status', status);
    if (tag) params.set('tag', tag);
    if (keyword.trim()) params.set('keyword', keyword.trim());
  }, [applyCommonFilters, keyword, status, tag]);

  const load = useCallback(async (fresh = false) => {
    const requestId = ++loadRequestId.current;
    setLoading(true);
    setNotice(null);

    try {
      if (viewMode === 'group') {
        const groupParams = new URLSearchParams({
          page: String(groupPage),
          page_size: String(pageSize),
        });
        applyCommonFilters(groupParams);
        const [summaryData, tagData, groupData] = await Promise.all([
          api<ChannelSummary>('/api/channels/summary', { fresh: true }),
          api<string[]>('/api/channels/tags', { fresh }),
          api<{ items?: ChannelGroupSummary[]; total?: number; total_groups?: number }>(
            `/api/channels/tag-summary?${groupParams.toString()}`,
            { fresh: true },
          ),
        ]);
        if (requestId !== loadRequestId.current) return;
        setSummary(summaryData);
        setTags(tagData);
        setGroups(groupData.items || []);
        setGroupTotal(groupData.total ?? groupData.total_groups ?? groupData.items?.length ?? 0);
      } else {
        const params = new URLSearchParams({ page: String(listPage), page_size: String(pageSize) });
        applyListFilters(params);
        const [summaryData, tagData, listData] = await Promise.all([
          api<ChannelSummary>('/api/channels/summary', { fresh: true }),
          api<string[]>('/api/channels/tags', { fresh }),
          api<ChannelListData>(`/api/channels?${params.toString()}`, { fresh: true }),
        ]);
        if (requestId !== loadRequestId.current) return;
        setSummary(summaryData);
        setTags(tagData);
        setItems(listData.items || []);
        setListTotal(listData.total || 0);
      }
    } catch (error) {
      if (requestId !== loadRequestId.current) return;
      setNotice({
        type: 'error',
        text: error instanceof Error ? error.message : t('加载渠道失败'),
      });
    } finally {
      if (requestId === loadRequestId.current) setLoading(false);
    }
  }, [applyCommonFilters, applyListFilters, groupPage, listPage, pageSize, t, viewMode]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!testToast) return;
    const timeout = window.setTimeout(() => setTestToast(null), 3000);
    return () => window.clearTimeout(timeout);
  }, [testToast]);

  useEffect(() => {
    const mobileViewport = window.matchMedia('(max-width: 760px)');
    const closeMobileFilterOnWideScreen = (event: MediaQueryListEvent) => {
      if (!event.matches) setMobileFilterOpen(false);
    };
    mobileViewport.addEventListener('change', closeMobileFilterOnWideScreen);
    return () => mobileViewport.removeEventListener('change', closeMobileFilterOnWideScreen);
  }, []);

  const pageCount = Math.max(1, Math.ceil((viewMode === 'group' ? groupTotal : listTotal) / pageSize));
  const currentPage = viewMode === 'group' ? groupPage : listPage;
  const paginationItems = useMemo(
    () => createPaginationItems(currentPage, pageCount),
    [currentPage, pageCount],
  );
  const testSuccessCount = testResults.filter((result) => result.success).length;
  const testHasMultipleInstances = testResults.some((result) => result.instance_id)
    && new Set(testResults.map((result) => result.instance_id)).size > 1;
  const channelConfirmationBusy = !!channelConfirmation
    && rowAction?.id === channelConfirmation.item.id;
  const mobileFilterTitle = mobileFilterKind === 'category'
    ? t('选择分类')
    : mobileFilterKind === 'status'
      ? t('选择状态')
      : t('选择标签');
  const mobileFilterValue = mobileFilterKind === 'category'
    ? category
    : mobileFilterKind === 'status'
      ? status
      : tag;
  const mobileFilterOptions = mobileFilterKind === 'category'
    ? [
        { value: '', label: t('全部分类') },
        ...categoryOptions.map((item) => ({ value: item, label: categoryLabel(item, language) })),
      ]
    : mobileFilterKind === 'status'
      ? [
          { value: '', label: t('全部状态') },
          { value: '1', label: t('启用') },
          { value: '2', label: t('禁用') },
          { value: '3', label: t('自动禁用') },
        ]
      : [
          { value: '', label: t('全部标签') },
          ...tags.map((item) => ({ value: item, label: item })),
        ];

  function changeView(nextView: 'group' | 'list') {
    if (nextView === viewMode) return;
    setViewMode(nextView);
    setNotice(null);
  }

  function updateDateRange(nextRange: AppDateRange) {
    setDateRange({ from: nextRange.start, to: nextRange.end });
    setGroupPage(1);
    setListPage(1);
  }

  function changeCategoryFilter(value: string | null) {
    setCategory(value && value !== ALL_CHANNEL_FILTER_VALUE ? value : '');
    setGroupPage(1);
    setListPage(1);
    setExpandedTags([]);
    setGroupDetails({});
    setDetailLoading({});
  }

  function changeStatusFilter(value: string | null) {
    setStatus(value && value !== ALL_CHANNEL_FILTER_VALUE ? value : '');
    setListPage(1);
  }

  function changeTagFilter(value: string | null) {
    setTag(value && value !== ALL_CHANNEL_FILTER_VALUE ? value : '');
    setListPage(1);
  }

  function applyMobileFilter(value: string) {
    if (mobileFilterKind === 'category') changeCategoryFilter(value);
    else if (mobileFilterKind === 'status') changeStatusFilter(value);
    else changeTagFilter(value);
    setMobileFilterOpen(false);
  }

  function openMobileFilter(kind: 'category' | 'status' | 'tag') {
    setMobileFilterKind(kind);
    setMobileFilterOpen(true);
  }

  function changePage(nextPage: number) {
    const bounded = Math.max(1, Math.min(pageCount, nextPage));
    if (viewMode === 'group') setGroupPage(bounded);
    else setListPage(bounded);
  }

  function changePageSize(nextSize: number) {
    setPageSize(nextSize);
    setGroupPage(1);
    setListPage(1);
  }

  async function toggleGroup(group: ChannelGroupSummary) {
    const key = `${category || ALL_CHANNEL_FILTER_VALUE}:${group.tag || '__untagged__'}`;
    const expanded = expandedTags.includes(key);
    setExpandedTags((current) => (expanded ? current.filter((item) => item !== key) : [...current, key]));
    if (expanded || groupDetails[key] || detailLoading[key]) return;

    setDetailLoading((current) => ({ ...current, [key]: true }));
    try {
      const params = new URLSearchParams({ page: '1', page_size: '500' });
      if (group.tag) params.set('tag', group.tag);
      else params.set('untagged', 'true');
      applyCommonFilters(params);
      const result = await api<ChannelListData>(`/api/channels?${params.toString()}`, { fresh: true });
      setGroupDetails((current) => ({ ...current, [key]: result.items || [] }));
    } catch (error) {
      setExpandedTags((current) => current.filter((item) => item !== key));
      setNotice({
        type: 'error',
        text: error instanceof Error ? error.message : t('加载批次明细失败'),
      });
    } finally {
      setDetailLoading((current) => ({ ...current, [key]: false }));
    }
  }

  async function syncUsage() {
    setSyncing(true);
    setNotice(null);
    try {
      const result = await api<{ message?: string }>('/api/channels/sync', { method: 'POST' });
      setNotice({ type: 'ok', text: result.message || t('同步用量任务已提交。') });
      await load(true);
    } catch (error) {
      setNotice({
        type: 'error',
        text: error instanceof Error ? error.message : t('同步用量失败'),
      });
    } finally {
      setSyncing(false);
    }
  }

  async function openDisableKeywords() {
    setKeywordsOpen(true);
    setKeywordsLoading(true);
    try {
      const result = await api<DisableKeyword[] | { items?: DisableKeyword[] }>('/api/disable-keywords', { fresh: true });
      setDisableKeywords(Array.isArray(result) ? result : result.items || []);
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : t('加载建议禁用词失败') });
    } finally {
      setKeywordsLoading(false);
    }
  }

  async function addDisableKeyword(event: FormEvent) {
    event.preventDefault();
    const value = newKeyword.trim();
    if (!value) return;
    setKeywordSaving(true);
    try {
      await api('/api/disable-keywords', { method: 'POST', body: { keyword: value } });
      setNewKeyword('');
      await openDisableKeywords();
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : t('添加禁用词失败') });
    } finally {
      setKeywordSaving(false);
    }
  }

  function manageGroup(group: ChannelGroupSummary) {
    setTag(group.tag || '');
    setKeyword('');
    setListPage(1);
    setViewMode('list');
  }

  function openChannelTest(item: ChannelItem) {
    const models = (item.models || '')
      .split(',')
      .map((model) => model.trim())
      .filter(Boolean);

    setTestChannelItem(item);
    setTestMode('direct');
    setTestContent('');
    setTestModels(models);
    setTestModel(models[0] || '');
    setTestResults([]);
    setTestProgress(null);
    setTestError('');
    setTestToast(null);
  }

  function closeChannelTest() {
    if (testLoading) return;
    setTestChannelItem(null);
  }

  function changeTestMode(mode: 'newapi' | 'direct') {
    setTestMode(mode);
    setTestResults([]);
    setTestProgress(null);
    setTestError('');
  }

  async function runChannelModelTest(model: string) {
    if (!testChannelItem) return [];

    const params = new URLSearchParams({ model, mode: testMode });
    if (testMode === 'direct' && testContent.trim()) {
      params.set('content', testContent.trim());
    }
    const response = await api<ChannelTestResult[]>(
      `/api/channels/${testChannelItem.id}/test?${params.toString()}`,
      { fresh: true },
    );
    const results = Array.isArray(response) ? response : [];
    return results.map((result, index) => ({
      ...result,
      model,
      key: `${model}@${result.instance_id || index}`,
    }));
  }

  async function testSelectedModel() {
    if (!testModel) {
      setTestError(t('请选择模型'));
      return;
    }

    setTestLoading(true);
    setTestResults([]);
    setTestProgress(null);
    setTestError('');
    try {
      setTestResults(await runChannelModelTest(testModel));
    } catch (error) {
      setTestToast({
        id: Date.now(),
        text: error instanceof Error ? error.message : t('测试失败'),
      });
    } finally {
      setTestLoading(false);
    }
  }

  async function testAllModels() {
    if (!testModels.length) {
      setTestError(t('该渠道没有可测试的模型'));
      return;
    }

    setTestLoading(true);
    setTestResults([]);
    setTestError('');
    setTestProgress({ done: 0, total: testModels.length });

    const queue = [...testModels];
    const collected: ChannelTestResult[] = [];
    let completed = 0;
    const worker = async () => {
      while (queue.length) {
        const model = queue.shift();
        if (!model) continue;
        try {
          collected.push(...await runChannelModelTest(model));
        } catch (error) {
          collected.push({
            model,
            success: false,
            message: error instanceof Error ? error.message : t('失败'),
            latency: 0,
            key: `${model}@err`,
          });
        }
        completed += 1;
        setTestResults([...collected]);
        setTestProgress({ done: completed, total: testModels.length });
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(3, testModels.length) }, () => worker()),
    );
    setTestLoading(false);
  }

  function requestChannelStatusChange(item: ChannelItem) {
    setChannelConfirmation({
      item,
      type: 'status',
      nextStatus: item.status === 1 ? 2 : 1,
    });
  }

  function requestChannelDelete(item: ChannelItem) {
    setChannelConfirmation({ item, type: 'delete' });
  }

  function closeChannelConfirmation() {
    if (channelConfirmationBusy) return;
    setChannelConfirmation(null);
  }

  async function changeChannelStatus(item: ChannelItem, nextStatus: number) {
    const actionLabel = nextStatus === 1 ? '启用' : '停用';

    setRowAction({ id: item.id, type: 'status' });
    setNotice(null);
    try {
      await api(`/api/channels/${item.id}/status`, {
        method: 'POST',
        body: { status: nextStatus },
      });
      setItems((current) => current.map((channel) => (
        channel.id === item.id ? { ...channel, status: nextStatus } : channel
      )));
      setNotice({ type: 'ok', text: t(`渠道已${actionLabel}`) });
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : t(`${actionLabel}渠道失败`) });
    } finally {
      setRowAction(null);
      setChannelConfirmation(null);
    }
  }

  async function deleteChannel(item: ChannelItem) {
    setRowAction({ id: item.id, type: 'delete' });
    setNotice(null);
    try {
      await api(`/api/channels/${item.id}`, { method: 'DELETE' });
      setNotice({ type: 'ok', text: t('删除成功') });
      await load(true);
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : t('删除渠道失败') });
    } finally {
      setRowAction(null);
      setChannelConfirmation(null);
    }
  }

  function confirmChannelAction() {
    if (!channelConfirmation || channelConfirmationBusy) return;
    if (channelConfirmation.type === 'delete') {
      void deleteChannel(channelConfirmation.item);
      return;
    }

    void changeChannelStatus(
      channelConfirmation.item,
      channelConfirmation.nextStatus ?? 1,
    );
  }

  return (
    <section className="my-channels-page">
      {testToast && (
        <div className="upload-toast upload-toast-error channel-test-toast" key={testToast.id} role="alert">
          <XCircle size={16} />
          <span>{testToast.text}</span>
        </div>
      )}
      <NoticeBanner notice={notice} />
      <div className="my-channel-summary-grid">
        <article className="my-channel-summary-card">
          <span>{t('渠道总数')}</span>
          <strong>{formatInteger(summary.count)}</strong>
        </article>
        <article className="my-channel-summary-card">
          <span>{t('总消耗（全部渠道）')}</span>
          <strong>{formatQuota(summary.total_quota, 2)}</strong>
        </article>
      </div>

      <div className="my-channels-titlebar">
        <h1>{t('我的渠道')}</h1>
        <div className="my-channels-actions">
          <ActionButton className="primary-button compact" disabled={syncing} onClick={syncUsage} type="button">
            <RefreshCcw className={syncing ? 'spin' : ''} size={15} />
            {syncing ? t('同步中...') : t('同步用量')}
          </ActionButton>
          <ActionButton className="ghost-button compact" disabled={loading} onClick={() => load(true)} type="button">
            <RefreshCcw className={loading ? 'spin' : ''} size={15} />
            {t('刷新')}
          </ActionButton>
          <ActionButton className="ghost-button compact" onClick={openDisableKeywords} type="button">
            <AlertTriangle size={15} />
            {t('建议禁用词')}
          </ActionButton>
        </div>
      </div>

      <div className={`my-channel-filters ${viewMode === 'list' ? 'is-list-view' : 'is-group-view'}`}>
        <div className="my-channel-view-switch" role="tablist" aria-label={t('我的渠道')}>
          <button className={viewMode === 'group' ? 'active' : ''} onClick={() => changeView('group')} type="button">
              {t('分组视图')}
            </button>
          <button className={viewMode === 'list' ? 'active' : ''} onClick={() => changeView('list')} type="button">
              {t('列表视图')}
          </button>
        </div>
        <span className="my-channel-filter-label">{t('筛选:')}</span>
        <AppDateRangePicker
          align="start"
          clearable
          endPlaceholder={t('创建止')}
          onChange={updateDateRange}
          startPlaceholder={t('创建起')}
          value={{ start: dateRange.from, end: dateRange.to }}
        />
        <button
          aria-expanded={mobileFilterOpen && mobileFilterKind === 'category'}
          aria-haspopup="dialog"
          aria-label={t('选择分类')}
          className="my-channel-mobile-filter-button"
          onClick={() => openMobileFilter('category')}
          type="button"
        >
          <span>{category ? categoryLabel(category, language) : t('全部分类')}</span>
          <ChevronRight aria-hidden="true" size={14} />
        </button>
        <Select
          value={category || ALL_CHANNEL_FILTER_VALUE}
          onValueChange={changeCategoryFilter}
        >
          <SelectTrigger aria-label={t('分类')} className="my-channel-filter-select">
            <SelectValue>{category ? categoryLabel(category, language) : t('全部分类')}</SelectValue>
          </SelectTrigger>
          <SelectContent align="start" alignItemWithTrigger={false} className="my-channel-filter-select-content">
            <SelectItem value={ALL_CHANNEL_FILTER_VALUE}>{t('全部分类')}</SelectItem>
            {categoryOptions.map((item) => (
              <SelectItem key={item} value={item}>{categoryLabel(item, language)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {viewMode === 'list' && (
          <>
            <button
              aria-expanded={mobileFilterOpen && mobileFilterKind === 'status'}
              aria-haspopup="dialog"
              aria-label={t('选择状态')}
              className="my-channel-mobile-filter-button"
              onClick={() => openMobileFilter('status')}
              type="button"
            >
              <span>
                {status === '1'
                  ? t('启用')
                  : status === '2'
                    ? t('禁用')
                    : status === '3'
                      ? t('自动禁用')
                      : t('全部状态')}
              </span>
              <ChevronRight aria-hidden="true" size={14} />
            </button>
            <Select
              value={status || ALL_CHANNEL_FILTER_VALUE}
              onValueChange={changeStatusFilter}
            >
              <SelectTrigger aria-label={t('状态')} className="my-channel-filter-select">
                <SelectValue>
                  {status === '1'
                    ? t('启用')
                    : status === '2'
                      ? t('禁用')
                      : status === '3'
                        ? t('自动禁用')
                        : t('全部状态')}
                </SelectValue>
              </SelectTrigger>
              <SelectContent align="start" alignItemWithTrigger={false} className="my-channel-filter-select-content">
                <SelectItem value={ALL_CHANNEL_FILTER_VALUE}>{t('全部状态')}</SelectItem>
                <SelectItem value="1">{t('启用')}</SelectItem>
                <SelectItem value="2">{t('禁用')}</SelectItem>
                <SelectItem value="3">{t('自动禁用')}</SelectItem>
              </SelectContent>
            </Select>
            <button
              aria-expanded={mobileFilterOpen && mobileFilterKind === 'tag'}
              aria-haspopup="dialog"
              aria-label={t('选择标签')}
              className="my-channel-mobile-filter-button"
              onClick={() => openMobileFilter('tag')}
              type="button"
            >
              <span>{tag || t('全部标签')}</span>
              <ChevronRight aria-hidden="true" size={14} />
            </button>
            <Select
              value={tag || ALL_CHANNEL_FILTER_VALUE}
              onValueChange={changeTagFilter}
            >
              <SelectTrigger aria-label={t('标签')} className="my-channel-filter-select my-channel-tag-filter-select">
                <SelectValue>{tag || t('全部标签')}</SelectValue>
              </SelectTrigger>
              <SelectContent align="start" alignItemWithTrigger={false} className="my-channel-filter-select-content my-channel-tag-filter-content">
                <SelectItem value={ALL_CHANNEL_FILTER_VALUE}>{t('全部标签')}</SelectItem>
                {tags.map((item) => (
                  <SelectItem key={item} value={item}>
                    {item}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="search-box my-channel-search-box">
              <Search size={15} />
              <input
                value={keyword}
                onChange={(event) => setKeyword(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    setListPage(1);
                    load(true);
                  }
                }}
                placeholder={t('搜索 ID / 渠道名 / 备注 / Key')}
              />
            </div>
          </>
        )}
      </div>

      <Dialog
        onOpenChange={setMobileFilterOpen}
        open={mobileFilterOpen}
      >
        <DialogContent className="my-channel-mobile-filter-dialog" showCloseButton={false}>
          <div className="my-channel-mobile-filter-dialog-header">
            <DialogHeader>
              <DialogTitle>{mobileFilterTitle}</DialogTitle>
              <DialogDescription className="sr-only">{t('请选择一个筛选项')}</DialogDescription>
            </DialogHeader>
            <DialogClose aria-label={t('关闭')} className="my-channel-mobile-filter-dialog-close">
              <X size={18} />
            </DialogClose>
          </div>
          <div className="my-channel-mobile-filter-options">
            {mobileFilterOptions.map((option) => {
              const selected = option.value === mobileFilterValue;
              return (
                <button
                  aria-pressed={selected}
                  className={selected ? 'selected' : ''}
                  key={option.value || ALL_CHANNEL_FILTER_VALUE}
                  onClick={() => applyMobileFilter(option.value)}
                  type="button"
                >
                  <span>{option.label}</span>
                  {selected && <CheckCircle2 aria-hidden="true" size={18} />}
                </button>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>

      <div className="my-channel-table-wrap">
        {loading ? (
          <div className="loading-block my-channel-loading">
            <Loader2 className="spin" />
            {t('正在加载渠道')}
          </div>
        ) : viewMode === 'group' ? (
          groups.length ? (
            <table className="my-channel-table">
              <thead>
                <tr>
                  <th className="my-channel-expand-heading" aria-label={t('展开')} />
                  <th>{t('标签 / 分组（批次）')}</th>
                  <th>{t('Key 数量')}</th>
                  <th>{t('上传去向(最近一次)')}</th>
                  <th>{t('启用 / 停用')}</th>
                  <th>{t('该批已用额度($)')}</th>
                  <th>{t('操作')}</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((group, index) => {
                  const key = `${category || ALL_CHANNEL_FILTER_VALUE}:${group.tag || '__untagged__'}`;
                  const expanded = expandedTags.includes(key);
                  const enabled = Number(group.enabled || 0);
                  const total = Number(group.count || group.key_count || 0);
                  const disabled = Math.max(0, total - enabled);
                  return (
                    <Fragment key={`${key}-${index}`}>
                      <tr>
                        <td className="my-channel-expand-cell">
                          <button
                            aria-expanded={expanded}
                            aria-label={`${t('展开')} ${group.tag || t('未分组')}`}
                            className={expanded ? 'expanded' : ''}
                            onClick={() => toggleGroup(group)}
                            type="button"
                          >
                            <ChevronRight size={16} />
                          </button>
                        </td>
                        <td><span className="my-channel-tag">{group.tag || t('未分组')}</span></td>
                        <td className="my-channel-key-count">{formatInteger(group.key_count || group.count || 0)}</td>
                        <td>
                          <div className="my-channel-upload-result">
                            <span className="submitted">{t('提交 {{count}}', { count: formatInteger(group.submitted || 0) })}</span>
                            <span className="added">{t('新增 {{count}}', { count: formatInteger(group.added || 0) })}</span>
                            {!!group.skipped_dup && <span className="neutral">{t('重复 {{count}}', { count: formatInteger(group.skipped_dup) })}</span>}
                            {!!group.invalid && <span className="warning">{t('无效 {{count}}', { count: formatInteger(group.invalid) })}</span>}
                            {!!group.failed && <span className="failed">{t('失败 {{count}}', { count: formatInteger(group.failed) })}</span>}
                          </div>
                        </td>
                        <td>
                          <div className="my-channel-status-pair">
                            <span className="enabled">{t('{{count}} 启用', { count: formatInteger(enabled) })}</span>
                            <span>{t('{{count}} 停用', { count: formatInteger(disabled) })}</span>
                          </div>
                        </td>
                        <td>{formatQuota(group.used_quota || group.quota)}</td>
                        <td>
                          <ActionButton className="my-channel-manage-button" onClick={() => manageGroup(group)} type="button">
                            {t('在列表中管理')}
                          </ActionButton>
                        </td>
                      </tr>
                      {expanded && (
                        <tr className="my-channel-detail-row">
                          <td colSpan={7}>
                            {detailLoading[key] ? (
                              <div className="my-channel-detail-loading"><Loader2 className="spin" size={16} /> {t('正在加载明细')}</div>
                            ) : groupDetails[key]?.length ? (
                              <table className="my-channel-detail-table">
                                <thead>
                                  <tr>
                                    <th>ID</th>
                                    <th>{t('渠道名称')}</th>
                                    <th>{t('分类')}</th>
                                    <th>Key</th>
                                    <th>{t('备注')}</th>
                                    <th>{t('状态')}</th>
                                    <th>{t('已用额度($)')}</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {groupDetails[key].map((item) => (
                                    <tr key={item.id}>
                                      <td>{item.id}</td>
                                      <td>{item.channel_name || item.name || '-'}</td>
                                      <td>{categoryLabel(item.category || '', language) || item.type || '-'}</td>
                                      <td><code>{item.key_masked || item.key || '-'}</code></td>
                                      <td>{item.remark || '-'}</td>
                                      <td><Badge tone={item.status === 1 ? 'green' : item.status === 3 ? 'orange' : 'red'}>{statusLabel(item.status, language)}</Badge></td>
                                      <td>{formatQuota(item.used_quota || item.quota)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            ) : (
                              <span className="my-channel-detail-empty">{t('暂无渠道明细。')}</span>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <EmptyState title={t('暂无批次')} description={t('这个账号当前没有渠道分组数据。')} />
          )
        ) : items.length ? (
          <table className="my-channel-table my-channel-list-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>{t('渠道名称')}</th>
                  <th>{t('分类')}</th>
                  <th>{t('标签')}</th>
                  <th>Key</th>
                  <th>{t('已用额度')}</th>
                  <th>{t('状态')}</th>
                  <th>{t('创建时间')}</th>
                  <th>{t('操作')}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td>{item.id}</td>
                    <td>{item.channel_name || item.name || '-'}</td>
                    <td>
                      <Badge tone="purple">{categoryLabel(item.category || '', language) || item.type || '-'}</Badge>
                    </td>
                    <td>{item.tag || '-'}</td>
                    <td>
                      <code>{item.key_masked || item.key || '-'}</code>
                    </td>
                    <td>{formatQuota(item.used_quota || item.quota)}</td>
                    <td>
                      <Badge tone={item.status === 1 ? 'green' : item.status === 3 ? 'orange' : 'red'}>
                        {statusLabel(item.status, language)}
                      </Badge>
                    </td>
                    <td>{formatDate(item.created_at, language)}</td>
                    <td className="my-channel-row-actions-cell">
                      <div className="my-channel-row-actions">
                        <ActionButton
                          disabled={rowAction?.id === item.id}
                          onClick={() => openChannelTest(item)}
                          type="button"
                        >
                          <Activity size={13} />
                          {t('测试')}
                        </ActionButton>
                        {item.status !== 0 && (
                          <ActionButton
                            className={item.status === 1 ? '' : 'enable'}
                            disabled={rowAction?.id === item.id}
                            onClick={() => requestChannelStatusChange(item)}
                            type="button"
                          >
                            {rowAction?.id === item.id && rowAction.type === 'status'
                              ? <Loader2 className="spin" size={13} />
                              : item.status === 1 ? <XCircle size={13} /> : <CheckCircle2 size={13} />}
                            {item.status === 1 ? t('停用') : t('启用')}
                          </ActionButton>
                        )}
                        {item.status === 0 ? (
                          <Badge tone="neutral">{t('已删除')}</Badge>
                        ) : (
                          <ActionButton
                            className="danger"
                            disabled={rowAction?.id === item.id}
                            onClick={() => requestChannelDelete(item)}
                            type="button"
                          >
                            {rowAction?.id === item.id && rowAction.type === 'delete'
                              ? <Loader2 className="spin" size={13} />
                              : <Trash2 size={13} />}
                            {t('删除')}
                          </ActionButton>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
        ) : (
          <EmptyState title={t('暂无渠道')} description={t('暂无渠道，上传后会显示在这里。')} />
        )}
      </div>

      {!loading && (viewMode === 'group' ? groups.length > 0 : items.length > 0) && (
        <div className="my-channel-pagination">
          <span>{viewMode === 'group'
            ? t('共 {{count}} 个批次', { count: groupTotal })
            : t('共 {{count}} 条', { count: listTotal })}</span>
          <div className="my-channel-pagination-controls">
            <button className="pagination-arrow" aria-label={t('上一页')} disabled={currentPage <= 1} onClick={() => changePage(currentPage - 1)} type="button">
              <ChevronLeft size={16} />
            </button>
            {paginationItems.map((item) =>
              typeof item === 'number' ? (
                <button
                  aria-current={item === currentPage ? 'page' : undefined}
                  className={`pagination-page ${item === currentPage ? 'current' : ''}`}
                  key={item}
                  onClick={() => changePage(item)}
                  type="button"
                >
                  {item}
                </button>
              ) : (
                <button
                  aria-label={t(item === 'backward' ? '向前跳转 5 页' : '向后跳转 5 页')}
                  className="pagination-ellipsis"
                  key={item}
                  onClick={() => changePage(currentPage + (item === 'backward' ? -5 : 5))}
                  type="button"
                >
                  ...
                </button>
              ),
            )}
            <button className="pagination-arrow" aria-label={t('下一页')} disabled={currentPage >= pageCount} onClick={() => changePage(currentPage + 1)} type="button">
              <ChevronRight size={16} />
            </button>
            <select aria-label={t('每页数量')} onChange={(event) => changePageSize(Number(event.target.value))} value={pageSize}>
              <option value={20}>{t('{{count}} 条/页', { count: 20 })}</option>
              <option value={50}>{t('{{count}} 条/页', { count: 50 })}</option>
              <option value={100}>{t('{{count}} 条/页', { count: 100 })}</option>
            </select>
          </div>
        </div>
      )}

      {channelConfirmation && (
        <div
          className="dialog-backdrop channel-confirm-backdrop"
          onMouseDown={closeChannelConfirmation}
          role="presentation"
        >
          <section
            aria-labelledby="channel-confirm-title"
            aria-modal="true"
            className={`channel-confirm-dialog ${channelConfirmation.type} ${
              channelConfirmation.type === 'status'
                ? channelConfirmation.nextStatus === 1 ? 'enable' : 'disable'
                : ''
            }`}
            onMouseDown={(event) => event.stopPropagation()}
            role="dialog"
          >
            <header className="channel-confirm-header">
              <span className="channel-confirm-icon" aria-hidden="true">
                {channelConfirmation.type === 'delete'
                  ? <Trash2 size={19} />
                  : channelConfirmation.nextStatus === 1
                    ? <CheckCircle2 size={19} />
                    : <AlertTriangle size={19} />}
              </span>
              <div className="channel-confirm-heading">
                <h2 id="channel-confirm-title">
                  {channelConfirmation.type === 'delete'
                    ? t('确认删除渠道')
                    : channelConfirmation.nextStatus === 1
                      ? t('确认启用渠道')
                      : t('确认停用渠道')}
                </h2>
              </div>
              <button
                aria-label={t('关闭')}
                className="channel-confirm-close"
                disabled={channelConfirmationBusy}
                onClick={closeChannelConfirmation}
                type="button"
              >
                <X size={18} />
              </button>
            </header>

            <div className="channel-confirm-body">
              <p>
                {channelConfirmation.type === 'delete'
                  ? t('确定删除？将同步用量并禁用上游渠道，删除后不可恢复。')
                  : channelConfirmation.nextStatus === 1
                    ? t('确定启用该渠道？')
                    : t('确定停用该渠道？')}
              </p>
              <div className="channel-confirm-target">
                <span>{t('渠道')}</span>
                <strong>
                  {channelConfirmation.item.channel_name
                    || channelConfirmation.item.name
                    || `#${channelConfirmation.item.id}`}
                </strong>
                <code>ID {channelConfirmation.item.id}</code>
              </div>
            </div>

            <footer className="channel-confirm-footer">
              <ActionButton
                className="ghost-button"
                disabled={channelConfirmationBusy}
                onClick={closeChannelConfirmation}
                type="button"
              >
                {t('取消')}
              </ActionButton>
              <ActionButton
                className={`channel-confirm-submit ${channelConfirmation.type === 'delete' ? 'danger' : ''}`}
                disabled={channelConfirmationBusy}
                onClick={confirmChannelAction}
                type="button"
              >
                {channelConfirmationBusy && <Loader2 className="spin" size={15} />}
                {channelConfirmationBusy ? t('处理中...') : t('确定')}
              </ActionButton>
            </footer>
          </section>
        </div>
      )}

      {testChannelItem && (
        <div
          className="dialog-backdrop channel-test-backdrop"
          onMouseDown={closeChannelTest}
          role="presentation"
        >
          <section
            aria-labelledby="channel-test-title"
            aria-modal="true"
            className="channel-test-dialog"
            onMouseDown={(event) => event.stopPropagation()}
            role="dialog"
          >
            <header className="channel-test-header">
              <h2 id="channel-test-title">
                <Zap size={17} />
                <span>{t('测试渠道 - {{name}}', { name: testChannelItem.channel_name || testChannelItem.name || '' })}</span>
              </h2>
              <button
                aria-label={t('关闭')}
                className="channel-test-close"
                disabled={testLoading}
                onClick={closeChannelTest}
                type="button"
              >
                <X size={18} />
              </button>
            </header>

            <div className="channel-test-body">
              <div className="channel-test-mode-switch" role="group" aria-label={t('测试方式')}>
                <button
                  className={testMode === 'newapi' ? 'active' : ''}
                  disabled={testLoading}
                  onClick={() => changeTestMode('newapi')}
                  type="button"
                >
                  {t('经 New API（真实链路）')}
                </button>
                <button
                  className={testMode === 'direct' ? 'active' : ''}
                  disabled={testLoading}
                  onClick={() => changeTestMode('direct')}
                  type="button"
                >
                  {t('直连官方（验证密钥本身）')}
                </button>
              </div>

              <div className="channel-test-alert info">
                <Info size={16} />
                <span>
                  {testMode === 'direct'
                    ? t('不经过 New API，直接用渠道原始密钥请求官方，验证密钥本身是否有效，可自定义发送内容。')
                    : t('经 New API 用该渠道的 Key 向所选模型发探测请求，反映客户真实可用性（含分组/重定向配置）。')}
                </span>
              </div>

              {testMode === 'direct' && testChannelItem.category === 'aws' && (
                <div className="channel-test-alert warning">
                  <AlertTriangle size={16} />
                  <span>{t('AWS Bedrock 直连只验证密钥(AK/SK)本身。真实模型 id 由 New API 转换，直连可能报「模型 id 无效」，但这不代表密钥坏了——已自动按「密钥有效」判定；若显示 403「该账号未开通此模型」则是真不可用，需在 AWS 控制台开通该模型访问后重新上线。测实际可用性请切到「经 New API」。')}</span>
                </div>
              )}

              {testMode === 'direct' && (
                <input
                  className="channel-test-content-input"
                  disabled={testLoading}
                  maxLength={200}
                  onChange={(event) => setTestContent(event.target.value)}
                  placeholder={t('自定义发送内容（留空=随机友好语：hi! / 你好~ / ping）')}
                  value={testContent}
                />
              )}

              <div className="channel-test-controls">
                <select
                  aria-label={t('选择要测试的模型')}
                  disabled={testLoading || !testModels.length}
                  onChange={(event) => setTestModel(event.target.value)}
                  value={testModel}
                >
                  {!testModels.length && <option value="">{t('选择要测试的模型')}</option>}
                  {testModels.map((model) => <option key={model} value={model}>{model}</option>)}
                </select>
                <ActionButton
                  className="primary-button channel-test-action"
                  disabled={testLoading || !testModel}
                  onClick={testSelectedModel}
                  type="button"
                >
                  {testLoading && !testProgress && <Loader2 className="spin" size={15} />}
                  {t('测试该模型')}
                </ActionButton>
                <ActionButton
                  className="ghost-button channel-test-action"
                  disabled={testLoading || !testModels.length}
                  onClick={testAllModels}
                  type="button"
                >
                  {testLoading && testProgress
                    ? <Loader2 className="spin" size={15} />
                    : <Zap size={15} />}
                  {t('测试全部模型（{{count}}）', { count: testModels.length })}
                </ActionButton>
              </div>

              {testError && (
                <div className="channel-test-error" role="alert">
                  <XCircle size={15} />
                  <span>{testError}</span>
                </div>
              )}

              {testProgress && (
                <div className="channel-test-progress" aria-label={t('测试进度 {{done}}/{{total}}', { done: testProgress.done, total: testProgress.total })}>
                  <div><span style={{ width: `${Math.round((testProgress.done / testProgress.total) * 100)}%` }} /></div>
                  <strong>{testProgress.done}/{testProgress.total}</strong>
                </div>
              )}

              {testResults.length > 0 && (
                <div className="channel-test-summary">
                  <span className="success">{t('可用 {{count}}', { count: testSuccessCount })}</span>
                  <span className="failed">{t('失败 {{count}}', { count: testResults.length - testSuccessCount })}</span>
                  <small>{t('共 {{count}} 项', { count: testResults.length })}</small>
                </div>
              )}

              <div className="channel-test-table-wrap">
                <table className="channel-test-table">
                  <thead>
                    <tr>
                      <th>{t('模型')}</th>
                      {testHasMultipleInstances && <th className="instance">{t('实例')}</th>}
                      <th className="result">{t('结果')}</th>
                      <th className="latency">{t('耗时')}</th>
                      <th>{t('信息')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {testResults.length ? testResults.map((result, index) => (
                      <tr key={result.key || `${result.model || 'model'}-${index}`}>
                        <td title={result.model}>{result.model || '-'}</td>
                        {testHasMultipleInstances && <td>{result.instance_name || '-'}</td>}
                        <td>
                          <span className={`channel-test-result ${result.success ? 'success' : 'failed'}`}>
                            {result.success ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
                            {result.success ? t('可用') : t('失败')}
                          </span>
                        </td>
                        <td>{result.latency ? `${Number(result.latency).toFixed(2)}s` : '-'}</td>
                        <td className="message" title={result.message}>{result.message || '-'}</td>
                      </tr>
                    )) : (
                      <tr className="channel-test-empty-row">
                        <td colSpan={testHasMultipleInstances ? 5 : 4}>{t('选择模型后点击上方按钮开始测试')}</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <footer className="channel-test-footer">
              <ActionButton className="ghost-button" disabled={testLoading} onClick={closeChannelTest} type="button">{t('关闭')}</ActionButton>
            </footer>
          </section>
        </div>
      )}

      {keywordsOpen && (
        <div className="dialog-backdrop" role="presentation" onMouseDown={() => setKeywordsOpen(false)}>
          <section className="keyword-dialog" role="dialog" aria-modal="true" aria-label={t('建议禁用词')} onMouseDown={(event) => event.stopPropagation()}>
            <div className="keyword-dialog-header">
              <h2>{t('建议自动禁用关键词')}</h2>
              <button className="icon-button" aria-label={t('关闭')} onClick={() => setKeywordsOpen(false)} type="button"><X size={18} /></button>
            </div>
            <div className="keyword-dialog-alert">
              <Info size={16} />
              <span>{t('如果你发现某种上游报错代表 key 已经死了（如欠费、被封号），可把报错里的特征片段提交给我们。管理员审核通过后，健康体检命中该片段就会自动下架对应渠道。')}</span>
            </div>
            <form className="keyword-dialog-form" onSubmit={addDisableKeyword}>
              <input
                maxLength={256}
                value={newKeyword}
                onChange={(event) => setNewKeyword(event.target.value)}
                placeholder={t('例如 Your credit balance is too low')}
              />
              <ActionButton className="primary-button compact" disabled={keywordSaving} type="submit">
                {keywordSaving && <Loader2 className="spin" size={15} />}
                {t('提交')}
              </ActionButton>
            </form>
            <div className="keyword-dialog-list">
              {keywordsLoading ? (
                <div className="my-channel-detail-loading"><Loader2 className="spin" size={16} /> {t('正在加载')}</div>
              ) : disableKeywords.length ? (
                disableKeywords.map((item, index) => {
                  const status = String(item.status || '');
                  const label = status === 'approved' ? t('已生效') : status === 'pending' ? t('待审核') : status === 'rejected' ? t('已拒绝') : status || '-';
                  return (
                    <div className="keyword-dialog-row" key={String(item.id || `${item.keyword}-${index}`)}>
                      <code>{item.keyword}</code>
                      <span className={`keyword-status ${status}`}>{label}</span>
                    </div>
                  );
                })
              ) : (
                <span className="keyword-empty">{t('暂无建议禁用词')}</span>
              )}
            </div>
          </section>
        </div>
      )}
    </section>
  );
}

function ApiAccessView() {
  const { language, t } = useLanguage();
  const [keys, setKeys] = useState<ApiKeyItem[]>([]);
  const [name, setName] = useState('新 API Key');
  const [scopes, setScopes] = useState(scopeOptions.map((scope) => scope.value));
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  const load = useCallback(async (fresh = false) => {
    setLoading(true);
    try {
      setKeys(await api<ApiKeyItem[]>('/api/apikeys', { fresh }));
    } catch (error) {
      setNotice({
        type: 'error',
        text: error instanceof Error ? error.message : t('加载 API Key 失败'),
      });
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    setName((current) =>
      current === '新 API Key' || current === 'New API Key' ? t('新 API Key') : current,
    );
  }, [language, t]);

  async function createKey(event: FormEvent) {
    event.preventDefault();
    setNotice(null);
    try {
      const data = await api<{ key?: string; item?: ApiKeyItem }>('/api/apikeys', {
        method: 'POST',
        body: { name: name.trim(), scopes: scopes.join(',') },
      });
      setNotice({
        type: 'ok',
        text: data.key
          ? t('创建成功：{{key}}', { key: data.key })
          : t('创建成功，明文仅会显示一次。'),
      });
      await load();
    } catch (error) {
      setNotice({
        type: 'error',
        text: error instanceof Error ? error.message : t('创建失败'),
      });
    }
  }

  function toggleScope(scope: string) {
    setScopes((current) =>
      current.includes(scope)
        ? current.filter((item) => item !== scope)
        : [...current, scope],
    );
  }

  return (
    <section>
      <PageHeading icon={BookOpen} title={t('开放 API')} subtitle={t('管理本系统的 Bearer API Key。')} />
      <NoticeBanner notice={notice} />
      <div className="two-column api-layout">
        <article className="panel">
          <div className="panel-title">
            <h2>{t('API 密钥')}</h2>
            <ActionButton className="text-button" onClick={() => load(true)} type="button">
              <RefreshCcw size={16} />
              {t('刷新')}
            </ActionButton>
          </div>
          {loading ? (
            <div className="loading-block">
              <Loader2 className="spin" />
              {t('正在加载')}
            </div>
          ) : keys.length ? (
            <div className="key-list">
              {keys.map((item) => (
                <div className="key-card" key={item.id}>
                  <div>
                    <strong>{item.name}</strong>
                    <code>{item.prefix}</code>
                  </div>
                  <div className="key-meta">
                    <Badge tone={item.status === 1 ? 'green' : 'red'}>{item.status === 1 ? t('启用') : t('停用')}</Badge>
                    <span>{item.scopes}</span>
                    <span>{t('最近使用：{{date}}', { date: formatDate(item.last_used_at, language) })}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState title={t('暂无 API Key')} description={t('可以在右侧创建新的开放 API Key。')} />
          )}
        </article>
        <article className="panel">
          <div className="panel-title">
            <h2>{t('创建 API Key')}</h2>
          </div>
          <form className="form-stack" onSubmit={createKey}>
            <label>
              <span>{t('名称')}</span>
              <input value={name} onChange={(event) => setName(event.target.value)} />
            </label>
            <div className="scope-grid">
              {scopeOptions.map((scope) => (
                <button
                  key={scope.value}
                  className={scopes.includes(scope.value) ? 'scope selected' : 'scope'}
                  onClick={() => toggleScope(scope.value)}
                  type="button"
                >
                  <CheckCircle2 size={16} />
                  {t(scope.label)}
                </button>
              ))}
            </div>
            <ActionButton className="primary-button compact" type="submit">
              <Plus size={17} />
              {t('创建密钥')}
            </ActionButton>
          </form>
        </article>
      </div>

      <article className="panel docs-panel">
        <div className="panel-title">
          <h2>{t('接口规范')}</h2>
          <Badge tone="blue">Base URL /openapi/v1</Badge>
        </div>
        <div className="docs-grid">
          <DocBlock title={t('验证密钥 whoami')} code="GET /openapi/v1/whoami" />
          <DocBlock title={t('获取分类 meta')} code="GET /openapi/v1/meta" />
          <DocBlock title={t('批量上传 apikey')} code="POST /openapi/v1/channels" />
          <DocBlock title={t('分页查询渠道')} code="GET /openapi/v1/channels?page=1&page_size=50" />
        </div>
        <h3>{t('支持分类与 key 格式')}</h3>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t('分类')}</th>
                <th>{t('说明')}</th>
                <th>{t('key 格式')}</th>
              </tr>
            </thead>
            <tbody>
              {Object.keys(categoryLabels).slice(0, 12).map((key) => (
                <tr key={key}>
                  <td>
                    <code>{key}</code>
                  </td>
                  <td>{categoryLabel(key, language)}</td>
                  <td>{(language === 'en' ? keyFormatHintsEn : keyFormatHints)[key]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <h3>{t('错误码')}</h3>
        <div className="error-grid">
          {openApiErrors.map(([code, text]) => (
            <div key={code}>
              <code>{code}</code>
              <span>{t(text)}</span>
            </div>
          ))}
        </div>
      </article>
    </section>
  );
}

function DocBlock({ title, code }: { title: string; code: string }) {
  const { t } = useLanguage();

  async function copy() {
    await navigator.clipboard.writeText(code).catch(() => undefined);
  }

  return (
    <div className="doc-block">
      <span>{title}</span>
      <code>{code}</code>
      <button className="icon-button" onClick={copy} type="button" aria-label={t('复制')}>
        <ClipboardCopy size={16} />
      </button>
    </div>
  );
}

function DailyStatsView() {
  const { language, t } = useLanguage();
  const [stats, setStats] = useState<DailyStats | null>(null);
  const [loadingKind, setLoadingKind] = useState<'initial' | 'refresh' | 'realtime' | null>('initial');
  const [error, setError] = useState('');
  const [expandedDates, setExpandedDates] = useState<string[]>([]);
  const [range, setRange] = useState(() => {
    const end = parseDateInputValue(beijingDayKey()) || new Date();
    const start = new Date(end.getTime() - 6 * 24 * 60 * 60 * 1_000);
    return { start: formatDateInputValue(start), end: formatDateInputValue(end) };
  });

  const loading = loadingKind !== null;

  const load = useCallback(async (
    fresh = false,
    kind: 'initial' | 'refresh' | 'realtime' = 'initial',
  ) => {
    setLoadingKind(kind);
    setError('');
    try {
      const params = new URLSearchParams({ start: range.start, end: range.end });
      if (fresh) params.set('refresh', 'true');
      const nextStats = await api<DailyStats>(`/api/stats/daily?${params.toString()}`, { fresh: true });
      setStats(nextStats);
      setExpandedDates([]);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : t('加载每日消费快照失败。'));
    } finally {
      setLoadingKind(null);
    }
  }, [range.end, range.start, t]);

  useEffect(() => {
    load();
  }, [load]);

  const totalQuota = stats?.total_quota || 0;
  const averageQuota = stats?.average_quota || 0;

  function toggleExpanded(date: string) {
    setExpandedDates((current) => (current.includes(date) ? current.filter((item) => item !== date) : [...current, date]));
  }

  return (
    <section className="daily-stats-page">
      <div className="daily-summary-grid">
        <article className="daily-summary-card">
          <span>{t('区间总消费额度')}</span>
          <strong>{formatInteger(totalQuota)}</strong>
        </article>
        <article className="daily-summary-card">
          <span>{t('区间总消费(约合美元)')}</span>
          <strong>{formatQuota(totalQuota)}</strong>
        </article>
        <article className="daily-summary-card">
          <span>{t('日均消费额度')}</span>
          <strong>{formatInteger(averageQuota)}</strong>
        </article>
      </div>

      {error && <div className="daily-error" role="alert">{error}</div>}

      <div className="daily-stats-toolbar">
        <h1>{t('每日消费快照')}</h1>
        <div className="daily-stats-actions">
          <AppDateRangePicker onChange={setRange} value={range} />
          <button
            className={`daily-refresh-button ${loadingKind === 'refresh' ? 'is-loading' : ''}`}
            disabled={loading}
            onClick={() => load(false, 'refresh')}
            type="button"
          >
            <RefreshCcw className={loadingKind === 'refresh' ? 'spin' : ''} size={15} />
            {t('刷新')}
          </button>
          <button
            className={`daily-realtime-button ${loadingKind === 'realtime' ? 'is-loading' : ''}`}
            disabled={loading}
            onClick={() => load(true, 'realtime')}
            type="button"
          >
            <RefreshCcw className={loadingKind === 'realtime' ? 'spin' : ''} size={15} />
            {t('刷新今日实时')}
          </button>
        </div>
      </div>

      <div className="daily-table-wrap">
        <table className="daily-table">
          <thead>
            <tr>
              <th className="daily-expand-heading" aria-label={t('展开')} />
              <th>{t('日期')}</th>
              <th>{t('当日消费额度')}</th>
              <th>{t('约合美元')}</th>
              <th>{t('占比')}</th>
              <th>{t('涉及渠道数')}</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td className="daily-table-empty" colSpan={6}>
                  <Loader2 className="spin" size={22} />
                  {t('正在加载快照')}
                </td>
              </tr>
            ) : stats?.days?.length ? (
              stats.days.map((day) => {
                const quota = day.total_quota || day.quota || 0;
                const share = day.share_percent || 0;
                const expanded = expandedDates.includes(day.date);
                return (
                  <Fragment key={day.date}>
                    <tr>
                      <td className="daily-expand-cell">
                        <button
                          aria-expanded={expanded}
                          aria-label={t('展开 {{date}} 的渠道明细', { date: day.date })}
                          className={expanded ? 'expanded' : ''}
                          disabled={!day.channels?.length}
                          onClick={() => toggleExpanded(day.date)}
                          type="button"
                        >
                          <ChevronRight size={16} />
                        </button>
                      </td>
                      <td><strong>{day.date}</strong></td>
                      <td className={quota > 0 ? 'daily-quota' : ''}>{formatInteger(quota)}</td>
                      <td>{formatQuota(quota)}</td>
                      <td>
                        <span className="daily-share-track"><span style={{ width: `${share}%` }} /></span>
                      </td>
                      <td>{day.active_channel_count || 0}</td>
                    </tr>
                    {expanded && (
                      <tr className="daily-detail-row">
                        <td colSpan={6}>
                          {day.channels?.length ? (
                            <table className="daily-channel-table">
                              <thead>
                                <tr>
                                  <th>{t('渠道名称')}</th>
                                  <th>{t('分类')}</th>
                                  <th>{t('消费额度')}</th>
                                  <th>{t('约合美元')}</th>
                                </tr>
                              </thead>
                              <tbody>
                                {[...day.channels]
                                  .sort((left, right) => (right.quota || 0) - (left.quota || 0))
                                  .map((channel, index) => (
                                    <tr key={channel.id || `${channel.channel_name}-${index}`}>
                                      <td>{channel.channel_name || '-'}</td>
                                      <td>{categoryLabel(channel.category || '', language) || '-'}</td>
                                      <td className={channel.quota ? 'daily-quota' : ''}>{formatInteger(channel.quota || 0)}</td>
                                      <td>{formatQuota(channel.quota || 0)}</td>
                                    </tr>
                                  ))}
                              </tbody>
                            </table>
                          ) : (
                            <span className="daily-detail-empty">{t('暂无涉及渠道。')}</span>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })
            ) : (
              <tr>
                <td className="daily-table-empty" colSpan={6}>
                  <Database size={28} />
                  <span>{t('暂无数据')}</span>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function UserMappingDialog({
  mapping,
  onClose,
  onSaved,
}: {
  mapping: UserMapping | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { t } = useLanguage();
  const editing = mapping !== null;
  const [publicUsername, setPublicUsername] = useState(mapping?.public_username || '');
  const [upstreamUsername, setUpstreamUsername] = useState(mapping?.upstream_username || '');
  const [displayName, setDisplayName] = useState(mapping?.display_name || '');
  const [accountKind, setAccountKind] = useState<'primary' | 'sub'>(
    mapping?.account_kind === 'sub' ? 'sub' : 'primary',
  );
  const [upstreamUserId, setUpstreamUserId] = useState(
    mapping?.upstream_user_id?.toString() || '',
  );
  const [active, setActive] = useState(mapping?.active ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const nextPublicUsername = publicUsername.trim();
    const nextUpstreamUsername = upstreamUsername.trim();
    const nextDisplayName = displayName.trim();
    if (!/^[A-Za-z0-9_.-]{3,64}$/.test(nextPublicUsername)) {
      setError(t('用户名须为3至64位字母、数字、点、横线或下划线'));
      return;
    }
    if (!/^[A-Za-z0-9_.-]{3,64}$/.test(nextUpstreamUsername)) {
      setError(t('GYS用户名须为3至64位字母、数字、点、横线或下划线'));
      return;
    }
    if (!nextDisplayName || nextDisplayName.length > 128) {
      setError(t('请输入有效的显示名'));
      return;
    }
    const nextUpstreamUserId = Number(upstreamUserId.trim());
    if (
      !/^[1-9]\d*$/.test(upstreamUserId.trim()) || !Number.isSafeInteger(nextUpstreamUserId)
    ) {
      setError(t('账号ID必须为正整数'));
      return;
    }

    setSaving(true);
    setError('');
    try {
      await api(
        editing
          ? `/api/user-mappings/${encodeURIComponent(mapping.public_username)}`
          : '/api/user-mappings',
        {
          method: editing ? 'PUT' : 'POST',
          body: {
            public_username: nextPublicUsername,
            upstream_username: nextUpstreamUsername,
            display_name: nextDisplayName,
            account_kind: accountKind,
            upstream_user_id: nextUpstreamUserId,
            ...(editing ? { active } : {}),
          },
        },
      );
      await onSaved();
    } catch (failure) {
      setError(failure instanceof Error
        ? failure.message
        : t(editing ? '更新用户映射失败' : '创建用户映射失败'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      disablePointerDismissal={saving}
      onOpenChange={(nextOpen, eventDetails) => {
        if (!nextOpen && saving) {
          eventDetails.cancel();
          return;
        }
        if (!nextOpen) onClose();
      }}
      open
    >
      <DialogContent className="account-dialog user-mapping-dialog" showCloseButton={false}>
        <div className="account-dialog-header user-mapping-dialog-header">
          <div className="user-mapping-dialog-heading">
            <span aria-hidden="true" className="user-mapping-dialog-icon">
              <Users size={19} />
            </span>
            <DialogHeader>
              <DialogTitle>{t(editing ? '编辑用户映射' : '新增用户映射')}</DialogTitle>
              <DialogDescription>
                {t('管理用户名与 GYS 用户名的映射关系。')}
              </DialogDescription>
            </DialogHeader>
          </div>
          <DialogClose aria-label={t('关闭')} disabled={saving} type="button">
            <X size={18} />
          </DialogClose>
        </div>
        <form aria-busy={saving} className="user-mapping-dialog-form" onSubmit={submit}>
          <div className="user-mapping-dialog-body">
            <div className="user-mapping-field">
              <span>{t('账号类型')}</span>
              <Select
                disabled={saving || editing}
                value={accountKind}
                onValueChange={value => {
                  if (value === 'primary' || value === 'sub') setAccountKind(value);
                }}
              >
                <SelectTrigger aria-label={t('账号类型')} className="user-mapping-select">
                  <SelectValue>{t(accountKind === 'sub' ? '子账号' : '管理员')}</SelectValue>
                </SelectTrigger>
                <SelectContent
                  align="start"
                  alignItemWithTrigger={false}
                  sideOffset={6}
                  className="user-mapping-select-content"
                  positionerClassName="user-mapping-select-positioner"
                >
                  <SelectItem value="primary">{t('管理员')}</SelectItem>
                  <SelectItem value="sub">{t('子账号')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <p className="muted">{t('选择账号类型，填写对应的 GYS 用户 ID。')}</p>
            <label className="user-mapping-field">
              <span>{t('用户名')}</span>
              <input
                autoComplete="off"
                autoFocus
                disabled={saving}
                maxLength={64}
                minLength={3}
                onChange={event => setPublicUsername(event.target.value)}
                pattern="[A-Za-z0-9_.-]{3,64}"
                placeholder={t('用户名')}
                required
                value={publicUsername}
              />
            </label>
            <label className="user-mapping-field">
              <span>{t('显示名')}</span>
              <input
                autoComplete="off"
                disabled={saving}
                maxLength={128}
                onChange={event => setDisplayName(event.target.value)}
                placeholder={t('显示名称')}
                required
                value={displayName}
              />
            </label>
            <label className="user-mapping-field">
              <span>{t('账号ID')}</span>
              <input
                autoComplete="off"
                disabled={saving}
                inputMode="numeric"
                min={1}
                max={Number.MAX_SAFE_INTEGER}
                onChange={event => setUpstreamUserId(event.target.value)}
                placeholder="ID"
                required
                step={1}
                type="number"
                value={upstreamUserId}
              />
            </label>
            <label className="user-mapping-field">
              <span>{t('GYS用户名')}</span>
              <input
                autoComplete="off"
                disabled={saving}
                maxLength={64}
                minLength={3}
                onChange={event => setUpstreamUsername(event.target.value)}
                pattern="[A-Za-z0-9_.-]{3,64}"
                placeholder={t('GYS登录用户名')}
                required
                value={upstreamUsername}
              />
            </label>
            {editing && (
              <div className="user-mapping-status-row">
                <div>
                  <strong id="user-mapping-active-label">{t('启用映射')}</strong>
                  <span id="user-mapping-active-description">{t('启用后，用户可以使用用户名登录。')}</span>
                </div>
                <Switch
                  aria-describedby="user-mapping-active-description"
                  aria-labelledby="user-mapping-active-label"
                  checked={active}
                  disabled={saving}
                  onCheckedChange={nextActive => setActive(nextActive)}
                />
              </div>
            )}
            {error && <p className="account-dialog-error" role="alert">{error}</p>}
          </div>
          <div className="account-dialog-actions user-mapping-dialog-actions">
            <ActionButton className="ghost-button" disabled={saving} onClick={onClose} type="button">
              {t('取消')}
            </ActionButton>
            <ActionButton className="primary-button compact" disabled={saving} type="submit">
              {saving && <Loader2 className="spin" size={16} />}
              {t(saving ? '保存中...' : '保存映射')}
            </ActionButton>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function UserMappingUsageDialog({
  mapping,
  onClose,
}: {
  mapping: Pick<UserMapping, 'public_username' | 'upstream_user_id'>;
  onClose: () => void;
}) {
  const { language, t } = useLanguage();
  const [attempt, setAttempt] = useState(0);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [snapshot, setSnapshot] = useState<UserChannelUsageSnapshot | null>(null);
  const [error, setError] = useState('');
  const [syncError, setSyncError] = useState('');
  const [settlingItems, setSettlingItems] = useState<UserChannelUsageSnapshot['categories'] | null>(null);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const selectableItems = (snapshot?.categories || []).filter(item => Number(item.outstandingAmount) >= 1);
  const selectedItems = selectableItems.filter(item => selectedCategories.includes(item.category));
  const hasSnapshotRef = useRef(false);
  const loadedMappingRef = useRef('');
  const requestVersionRef = useRef(0);
  const syncingRef = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    const isNewMapping = loadedMappingRef.current !== mapping.public_username;
    if (isNewMapping) {
      loadedMappingRef.current = mapping.public_username;
      hasSnapshotRef.current = false;
      setSnapshot(null);
    }
    const requestVersion = ++requestVersionRef.current;
    if (!hasSnapshotRef.current) setLoading(true);
    setError('');
    api<UserChannelUsageSnapshot>(
      `/api/user-mappings/${encodeURIComponent(mapping.public_username)}/channel-usage`,
      { fresh: true, signal: controller.signal },
    )
      .then((value) => {
        if (!controller.signal.aborted && requestVersion === requestVersionRef.current) {
          hasSnapshotRef.current = true;
          setSnapshot(value);
        }
      })
      .catch((failure) => {
        if (
          !controller.signal.aborted
          && requestVersion === requestVersionRef.current
          && !hasSnapshotRef.current
        ) {
          setError(failure instanceof Error ? failure.message : t('加载用户分类消耗失败'));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted && requestVersion === requestVersionRef.current) {
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [attempt, mapping.public_username, t]);

  useEffect(() => {
    const timer = window.setInterval(
      () => {
        if (!syncingRef.current) setAttempt(value => value + 1);
      },
      CHANNEL_SUMMARY_REFRESH_INTERVAL_MS,
    );
    return () => window.clearInterval(timer);
  }, [mapping.public_username]);

  async function syncUsage() {
    if (syncingRef.current) return;
    const requestVersion = ++requestVersionRef.current;
    syncingRef.current = true;
    setSyncing(true);
    setSyncError('');
    try {
      const value = await api<UserChannelUsageSnapshot>(
        `/api/user-mappings/${encodeURIComponent(mapping.public_username)}/channel-usage`,
        { method: 'POST' },
      );
      if (requestVersion === requestVersionRef.current) {
        hasSnapshotRef.current = true;
        setSnapshot(value);
        setError('');
      }
    } catch (failure) {
      if (requestVersion === requestVersionRef.current) {
        setSyncError(failure instanceof Error ? failure.message : t('同步用量失败'));
      }
    } finally {
      syncingRef.current = false;
      setSyncing(false);
    }
  }

  return (
    <Dialog onOpenChange={(open) => { if (!open) onClose(); }} open>
      <DialogContent className="user-usage-dialog" showCloseButton={false}>
        <div className="user-usage-dialog-header">
          <div className="user-usage-dialog-heading">
            <span aria-hidden="true" className="user-usage-dialog-icon"><BarChart3 size={19} /></span>
            <DialogHeader>
              <DialogTitle>{t('用户分类消耗')}</DialogTitle>
              <DialogDescription>{mapping.public_username}</DialogDescription>
            </DialogHeader>
          </div>
          <DialogClose aria-label={t('关闭')} className="user-usage-close" type="button">
            <X size={18} />
          </DialogClose>
        </div>

        <div aria-busy={loading} className="user-usage-dialog-body">
          {loading ? (
            <div className="user-usage-state" role="status">
              <Loader2 className="spin" size={25} />
              <span>{t('正在读取用户分类消耗')}</span>
            </div>
          ) : error ? (
            <div className="user-usage-state error" role="alert">
              <AlertTriangle size={25} />
              <p>{error}</p>
              <ActionButton className="ghost-button compact" onClick={() => setAttempt(value => value + 1)} type="button">
                <RefreshCcw size={15} />{t('重试')}
              </ActionButton>
            </div>
          ) : !snapshot?.available ? (
            <div className="user-usage-state" role="status">
              <Database size={28} />
              <strong>{t('该用户尚未同步消耗数据')}</strong>
              <span>{t('用户登录后系统会自动同步。')}</span>
            </div>
          ) : (
            <>
              <section aria-label={t('用户分类消耗')} className="user-usage-overview">
                <div className="user-usage-primary-metric">
                  <span>{t('约合美元')}</span>
                  <strong>${formatDollarText(snapshot.totalAmount)}</strong>
                  <p>
                    <span>{t('总消耗额度')}</span>
                    <b>{formatNumericText(snapshot.totalQuota)}</b>
                  </p>
                </div>
                <dl className="user-usage-counts">
                  <div><dt>{t('渠道总数')}</dt><dd>{formatInteger(snapshot.channelCount)}</dd></div>
                  <div><dt>{t('分类数量')}</dt><dd>{formatInteger(snapshot.categories.length)}</dd></div>
                </dl>
              </section>
              <div className="user-usage-details-heading">
                <strong>{t('分类明细')}</strong>
                <ActionButton className="primary-button compact" type="button" disabled={!selectedItems.length || syncing}
                  onClick={() => setSettlingItems(selectedItems)}>
                  {t('批量结算（{{count}}）', { count: selectedItems.length })}
                </ActionButton>
                <span>{t('共 {{count}} 个分类', { count: snapshot.categories.length })}</span>
              </div>
              <div
                aria-label={t('渠道分类消耗明细')}
                className="table-wrap user-usage-table-wrap"
                role="region"
                tabIndex={0}
              >
                <table className="user-usage-table">
                  <caption className="sr-only">{t('渠道分类消耗明细')}</caption>
                  <thead>
                    <tr>
                      <th scope="col" className="user-usage-selection">
                        <input type="checkbox" aria-label={t('全选')}
                          checked={selectableItems.length > 0 && selectedItems.length === selectableItems.length}
                          ref={node => { if (node) node.indeterminate = selectedItems.length > 0 && selectedItems.length < selectableItems.length; }}
                          disabled={!selectableItems.length}
                          onChange={event => setSelectedCategories(event.target.checked ? selectableItems.map(item => item.category) : [])} />
                      </th>
                      <th scope="col">{t('渠道分类')}</th>
                      <th scope="col" className="user-usage-rate">{t('汇率')}</th>
                      <th scope="col">{t('总消费（$）')}</th>
                      <th scope="col">{t('已结算（$）')}</th>
                      <th scope="col">{t('应结算（$）')}</th>
                      <th scope="col">{t('应支付（USDT）')}</th>
                      <th scope="col">{t('操作')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {snapshot.categories.length ? snapshot.categories.map(item => {
                      const amountDue = item.settledAmount == null ? null : Number(item.amount) - Number(item.settledAmount);
                      const payable = amountDue == null || item.ratePercent == null ? null : amountDue * Number(item.ratePercent) / 100;
                      return (
                        <tr key={item.category}>
                          <td className="user-usage-selection">
                            <input type="checkbox" aria-label={`${t('选择')} ${categoryLabel(item.category, language)}`}
                              checked={selectedItems.some(selected => selected.category === item.category)}
                              disabled={!(Number(item.outstandingAmount) >= 1)}
                              onChange={event => setSelectedCategories(current => event.target.checked
                                ? [...new Set([...current, item.category])] : current.filter(category => category !== item.category))} />
                          </td>
                          <th scope="row"><strong>{categoryLabel(item.category, language)}</strong></th>
                          <td className="user-usage-rate">{item.ratePercent == null ? '—' : `${formatNumericText(item.ratePercent)}%`}</td>
                          <td className="user-usage-amount">${formatDollarText(item.amount)}</td>
                          <td className="user-usage-amount">{item.settledAmount == null ? '—' : `$${formatDollarText(item.settledAmount)}`}</td>
                          <td className="user-usage-amount">{amountDue == null ? '—' : `$${formatDollarText(String(amountDue))}`}</td>
                          <td className="user-usage-amount">{payable == null ? '—' : formatDollarText(String(payable))}</td>
                          <td>
                            <ActionButton className="user-usage-settle-button" type="button"
                              disabled={!(Number(item.outstandingAmount) >= 1)}
                              onClick={() => setSettlingItems([item])}>
                              <CircleDollarSign size={15} aria-hidden="true" />{t('结算')}
                            </ActionButton>
                          </td>
                        </tr>
                      );
                    }) : (
                      <tr><td className="daily-table-empty" colSpan={8}>{t('暂无数据')}</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>

        <div className="user-usage-dialog-footer">
          <div className="user-usage-footer-status">
            {snapshot?.refreshedAt ? (
              <time dateTime={new Date(snapshot.refreshedAt).toISOString()}>
                {t('最近同步')}：{formatBeijingDateTime(snapshot.refreshedAt, language)}
              </time>
            ) : (
              <span>{t('该用户尚未同步消耗数据')}</span>
            )}
          </div>
          <ActionButton
            className="ghost-button compact"
            disabled={loading || syncing}
            onClick={() => void syncUsage()}
            title={t('从上游同步并更新数据库')}
            type="button"
          >
            <RefreshCcw className={syncing ? 'spin' : undefined} size={15} />
            {t(syncing ? '同步中...' : '同步')}
          </ActionButton>
        </div>
      </DialogContent>
      {syncError && (
        <Dialog open onOpenChange={open => { if (!open) setSyncError(''); }}>
          <DialogContent className="user-usage-error-dialog" showCloseButton={false}
            overlayProps={{ forceRender: true, className: 'user-usage-error-overlay' }}>
            <DialogHeader>
              <DialogTitle><AlertTriangle size={22} />{t('同步失败')}</DialogTitle>
              <DialogDescription>{syncError}</DialogDescription>
            </DialogHeader>
            <div className="action-row">
              <ActionButton className="primary-button compact" type="button" onClick={() => setSyncError('')}>
                {t('知道了')}
              </ActionButton>
            </div>
          </DialogContent>
        </Dialog>
      )}
      {settlingItems && (
        <MappingSettlementDialog
          mapping={mapping}
          items={settlingItems}
          onClose={() => setSettlingItems(null)}
          onSaved={categories => {
            setSnapshot(current => current ? {
              ...current,
              categories: current.categories.map(item => {
                const category = categories.find(category => category.category === item.category);
                return category ? { ...item, settledAmount: category.settledAmount, outstandingAmount: category.outstandingAmount, ratePercent: category.ratePercent } : item;
              }),
            } : current);
            setSettlingItems(null);
            setSelectedCategories([]);
            setAttempt(value => value + 1);
          }}
        />
      )}
    </Dialog>
  );
}

function wholeSettlementAmount(value: string): string {
  return (value.split('.')[0] || '0').replace(/^0+(?=\d)/, '');
}

function constrainSettlementAmount(value: string, maximum: string, previous: string): string {
  const text = value.trim();
  if (!text) return '';
  if (!/^\d+(\.\d*)?$/.test(text)) return previous;
  const integer = wholeSettlementAmount(text);
  const limit = wholeSettlementAmount(maximum);
  return BigInt(integer) > BigInt(limit) ? limit : integer;
}

function MappingSettlementDialog({ mapping, items, onClose, onSaved }: {
  mapping: Pick<UserMapping, 'public_username' | 'upstream_user_id'>;
  items: UserChannelUsageSnapshot['categories'];
  onClose: () => void;
  onSaved: (categories: Array<{ category: string; settledAmount: string; outstandingAmount: string; ratePercent: string }>) => void;
}) {
  const { language, t } = useLanguage();
  const [amounts, setAmounts] = useState<Record<string, string>>(() => Object.fromEntries(items.map(item => [item.category, wholeSettlementAmount(item.outstandingAmount)])));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    if (!items.length) return;
    for (const item of items) {
      const text = (amounts[item.category] || '').trim();
      if (!/^\d+$/.test(text) || Number(text) <= 0) {
        setError(`${categoryLabel(item.category, language)}：${t('请输入有效的结算消耗额度')}`);
        return;
      }
      if (BigInt(text) > BigInt(wholeSettlementAmount(item.outstandingAmount))) {
        setError(t('{{category}}：消耗额度不能超过剩余额度 ${{amount}}', {
          category: categoryLabel(item.category, language), amount: formatNumericText(wholeSettlementAmount(item.outstandingAmount)),
        }));
        return;
      }
    }
    setSaving(true);
    setError('');
    try {
      const result = await api<BatchSettlementResponse>(
        `/api/user-mappings/${encodeURIComponent(mapping.public_username)}/settlements`,
        { method: 'POST', body: { items: items.map(item => ({ category: item.category, consumptionAmount: amounts[item.category] })) } },
      );
      onSaved(result.settlementSummary.categories.map(category => ({
        ...category,
        outstandingAmount: Math.max(0, Number(category.amount) - Number(category.settledAmount)).toFixed(4),
      })));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t('提交结算失败'));
    } finally {
      setSaving(false);
    }
  }
  return (
    <Dialog open disablePointerDismissal={saving} onOpenChange={(open, details) => {
      if (!open && saving) { details.cancel(); return; }
      if (!open) onClose();
    }}>
      <DialogContent
        className="account-dialog mapping-settlement-dialog"
        showCloseButton={false}
        overlayProps={{ forceRender: true, className: 'mapping-settlement-overlay' }}
      >
        <DialogHeader>
          <DialogTitle>{t('确认结算')}</DialogTitle>
          <DialogDescription>{mapping.public_username} · {t('已选择 {{count}} 个分类', { count: items.length })}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} noValidate>
          <div className="mapping-settlement-items">
          {items.map(item => (
          <div className="mapping-settlement-fields" key={item.category}>
          <div className="mapping-settlement-type">
            <span>{t('类型')}</span>
            <strong>{categoryLabel(item.category, language)}</strong>
          </div>
          <label>
            <span className="mapping-settlement-amount-heading">
              <span>{t('消耗额度')}（$）</span>
              <span className="mapping-settlement-limit">{t('最多 ${{amount}}', { amount: formatNumericText(wholeSettlementAmount(item.outstandingAmount)) })}</span>
            </span>
            <input type="text" inputMode="numeric"
              required value={amounts[item.category]} disabled={saving}
              onChange={event => {
                const value = event.target.value;
                setError('');
                setAmounts(current => ({ ...current,
                  [item.category]: constrainSettlementAmount(value, item.outstandingAmount, current[item.category]),
                }));
              }} />
          </label>
          <p className="mapping-settlement-rate"><span>{t('汇率')}</span><strong>{item.ratePercent}%</strong></p>
          <p className="mapping-settlement-channel-total">{t('结算金额')}：<strong>${formatDollarText(String((Number(amounts[item.category]) || 0) * Number(item.ratePercent) / 100))}</strong></p>
          </div>
          ))}
          </div>
          <div className="mapping-settlement-total">
            <span>{t('本次交易结算总金额')}</span>
            <strong>${formatDollarText(String(items.reduce((total, item) => total + (Number(amounts[item.category]) || 0) * Number(item.ratePercent) / 100, 0)))}</strong>
          </div>
          <NoticeBanner notice={error ? { type: 'error', text: error } : null} />
          <div className="account-dialog-actions">
            <ActionButton className="ghost-button" type="button" disabled={saving} onClick={onClose}>{t('取消')}</ActionButton>
            <ActionButton className="primary-button compact" type="submit" disabled={saving}>
              {saving && <Loader2 className="spin" size={15} />}{t(saving ? '保存中...' : '确认结算')}
            </ActionButton>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeleteUserMappingDialog({ mapping, onClose, onDeleted }: {
  mapping: UserMapping;
  onClose: () => void;
  onDeleted: () => Promise<void>;
}) {
  const { t } = useLanguage();
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');

  async function remove() {
    if (deleting) return;
    setDeleting(true);
    setError('');
    try {
      await api(`/api/user-mappings/${encodeURIComponent(mapping.public_username)}`, { method: 'DELETE' });
      await onDeleted();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t('删除用户映射失败'));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Dialog open onOpenChange={open => { if (!open && !deleting) onClose(); }}>
      <DialogContent showCloseButton={false} className="channel-confirm-dialog delete user-mapping-delete-dialog">
        <header className="channel-confirm-header">
          <span className="channel-confirm-icon" aria-hidden="true"><Trash2 size={19} /></span>
          <div className="channel-confirm-heading"><DialogTitle>{t('确认删除用户映射')}</DialogTitle></div>
          <button aria-label={t('关闭')} className="channel-confirm-close" disabled={deleting} onClick={onClose} type="button"><X size={18} /></button>
        </header>
        <div className="channel-confirm-body">
          <p>{t('确定删除用户映射“{{name}}”吗？', { name: mapping.public_username })}</p>
          <DialogDescription>{t('删除后，该用户将退出本站且无法登录，直到重新创建映射。GYS 上游账号将保留。')}</DialogDescription>
          {error && <p className="account-dialog-error" role="alert">{error}</p>}
        </div>
        <footer className="channel-confirm-footer">
          <ActionButton className="ghost-button" disabled={deleting} onClick={onClose} type="button">{t('取消')}</ActionButton>
          <ActionButton className="channel-confirm-submit danger" disabled={deleting} onClick={() => void remove()} type="button">
            {deleting && <Loader2 className="spin" size={15} />}
            {t(deleting ? '正在删除...' : '删除')}
          </ActionButton>
        </footer>
      </DialogContent>
    </Dialog>
  );
}

function SettlementTransactionList({ transactions, onDelete }: {
  transactions: SettlementTransaction[];
  onDelete?: (transaction: SettlementTransaction) => Promise<void>;
}) {
  const { language, t } = useLanguage();
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const deletingRef = useRef(false);
  async function remove(transaction: SettlementTransaction) {
    if (!onDelete || deletingRef.current) return;
    deletingRef.current = true;
    setDeleting(true);
    setDeleteError('');
    try {
      await onDelete(transaction);
      setConfirmId(null);
    } catch (failure) {
      setDeleteError(failure instanceof Error ? failure.message : t('删除结算失败'));
    } finally {
      deletingRef.current = false;
      setDeleting(false);
    }
  }
  return (
    <div className="table-wrap settlement-transactions-wrap" role="region" aria-label={t('结算记录')} tabIndex={0}>
      <table className="settlement-transactions-table">
        <thead><tr>
          <th scope="col">{t('交易编号')}</th>
          <th scope="col">{t('付款人')}</th>
          <th scope="col">{t('收款人')}</th>
          <th scope="col">{t('结算金额')}（USD）</th>
          <th scope="col">{t('操作')}</th>
        </tr></thead>
        <tbody>{transactions.map(transaction => (
          <tr key={transaction.id}>
            <td><code className="settlement-table-id">{transaction.id}</code></td>
            <td><strong>{transaction.payer?.username || t('未记录')}</strong>
              {transaction.payer?.displayName && transaction.payer.displayName !== transaction.payer.username && <small>{transaction.payer.displayName}</small>}
            </td>
            <td><strong>{transaction.payee?.username || t('未记录')}</strong>
              {transaction.payee?.displayName && transaction.payee.displayName !== transaction.payee.username && <small>{transaction.payee.displayName}</small>}
            </td>
            <td className="settlement-table-amount">${formatNumericText(transaction.totalSettlementAmount)}</td>
            <td><div className="settlement-table-actions">
              <Dialog>
                <DialogTrigger disabled={deleting} render={<ActionButton className="ghost-button compact" type="button" />}>
                  <Eye size={15} />{t('查看详情')}
                </DialogTrigger>
                <DialogContent className="user-usage-dialog mapping-settlements-dialog settlement-details-dialog" showCloseButton={false} overlayProps={{ forceRender: true, className: 'settlement-details-overlay' }}>
                  <div className="user-usage-dialog-header">
                    <DialogHeader>
                      <DialogTitle>{t('查看支付渠道详情')}</DialogTitle>
                      <DialogDescription>{t('交易编号')}：{transaction.id}</DialogDescription>
                    </DialogHeader>
                    <DialogClose aria-label={t('关闭')} className="user-usage-close" type="button"><X size={18} /></DialogClose>
                  </div>
                  <div className="user-usage-dialog-body">
                    <section className="settlement-transaction-card">
                  <div className="table-wrap" role="region" aria-label={`${t('交易编号')} ${transaction.id}`} tabIndex={0}>
                    <table className="mapping-settlements-table">
                      <thead><tr>
                        <th>{t('渠道分类')}</th><th>{t('消耗额度')}（$）</th>
                        <th>{t('结算汇率')}</th><th>{t('结算金额')}（$）</th>
                      </tr></thead>
                      <tbody>{transaction.items.map(record => (
                        <tr key={record.id}>
                          <td>{categoryLabel(record.category, language)}</td>
                          <td>${formatNumericText(record.consumptionAmount)}</td>
                          <td>{formatNumericText(record.ratePercent)}%</td>
                          <td className="mapping-settlement-record-amount">${formatNumericText(record.settlementAmount)}</td>
                        </tr>
                      ))}</tbody>
                    </table>
                  </div>

                    </section>
                  </div>
                </DialogContent>
              </Dialog>
              {onDelete && (
                    <AlertDialog open={confirmId === transaction.id} onOpenChange={open => {
                      if (deletingRef.current) return;
                      setConfirmId(open ? transaction.id : null);
                      setDeleteError('');
                    }}>
                      <AlertDialogTrigger disabled={deleting} render={<ActionButton className="ghost-button compact settlement-delete-button" type="button" />}>
                        <Trash2 size={15} />{t('删除结算')}
                      </AlertDialogTrigger>
                      <AlertDialogContent className="settlement-delete-dialog" overlayProps={{ forceRender: true, className: 'settlement-delete-overlay' }}>
                        <AlertDialogHeader>
                          <AlertDialogTitle>{t('删除结算')}</AlertDialogTitle>
                          <AlertDialogDescription>{t('删除后，本笔消耗额度将退回待结算，其他结算记录保持不变。')}</AlertDialogDescription>
                        </AlertDialogHeader>
                        <div className="settlement-delete-summary">
                          <span>{formatBeijingDateTime(transaction.createdAt, language)}</span>
                          <strong>${formatNumericText(transaction.totalSettlementAmount)}</strong>
                        </div>
                        {deleteError && <p role="alert" className="settlement-delete-error">{deleteError}</p>}
                        <AlertDialogFooter>
                          <AlertDialogCancel autoFocus disabled={deleting}>{t('取消')}</AlertDialogCancel>
                          <AlertDialogAction variant="destructive" disabled={deleting} onClick={() => void remove(transaction)}>
                            {deleting && <Loader2 size={15} className="spin" />}{t('确定')}
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>

              )}
            </div></td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

function SettlementHistoryView() {
  const { t } = useLanguage();
  const [transactions, setTransactions] = useState<SettlementTransaction[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    api<{ items: SettlementTransaction[]; hasMore: boolean }>(`/api/settlement-history?page=${page}`, {
      fresh: true, signal: controller.signal,
    }).then(data => {
      if (!controller.signal.aborted) {
        setTransactions(data.items);
        setHasMore(data.hasMore);
      }
    }).catch(failure => {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : t('加载结算数据失败'));
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [page, attempt, t]);
  return (
    <section className="settlement-history-page" aria-busy={loading}>
      <div className="daily-stats-toolbar">
        <div><h1>{t('结算历史')}</h1><p>{t('查看当前账户的结算交易与分类明细。')}</p></div>
        <ActionButton className="ghost-button compact" type="button" disabled={loading} onClick={() => setAttempt(value => value + 1)}>
          <RefreshCcw size={15} className={loading ? 'spin' : undefined} />{t('刷新')}
        </ActionButton>
      </div>
      {loading ? (
        <div className="user-usage-state" role="status"><Loader2 className="spin" size={24} />{t('正在加载结算数据')}</div>
      ) : error ? (
        <div className="user-usage-state error" role="alert"><AlertTriangle size={24} /><p>{error}</p>
          <ActionButton className="ghost-button compact" type="button" onClick={() => setAttempt(value => value + 1)}>{t('重试')}</ActionButton>
        </div>
      ) : transactions.length ? <SettlementTransactionList transactions={transactions} /> : (
        <div className="user-usage-state"><Database size={26} /><span>{t('暂无结算记录')}</span></div>
      )}
      <div className="settlement-history-pagination">
        <ActionButton className="ghost-button compact" type="button" disabled={loading || page <= 1} onClick={() => setPage(value => value - 1)}>{t('上一页')}</ActionButton>
        <span>{t('第 {{page}} 页', { page })}</span>
        <ActionButton className="ghost-button compact" type="button" disabled={loading || !!error || !hasMore} onClick={() => setPage(value => value + 1)}>{t('下一页')}</ActionButton>
      </div>
    </section>
  );
}

function UserMappingSettlementsDialog({ mapping, onClose }: {
  mapping: Pick<UserMapping, 'public_username' | 'upstream_user_id'>;
  onClose: () => void;
}) {
  const { t } = useLanguage();
  const [transactions, setTransactions] = useState<SettlementTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    api<{ items: SettlementTransaction[]; hasMore: boolean }>(`/api/user-mappings/${encodeURIComponent(mapping.public_username)}/settlements?page=${page}`, {
      fresh: true, signal: controller.signal,
    }).then(data => {
      if (!controller.signal.aborted) {
        setTransactions(data.items);
        setHasMore(data.hasMore);
        if (!data.items.length && page > 1) setPage(value => value - 1);
      }
    }).catch(failure => {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : t('加载结算数据失败'));
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [mapping.public_username, page, attempt, t]);
  return (
    <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent className="user-usage-dialog mapping-settlements-dialog" showCloseButton={false}>
        <div className="user-usage-dialog-header">
          <DialogHeader>
            <DialogTitle>{t('查看结算')}</DialogTitle>
            <DialogDescription>{mapping.public_username} · ID {mapping.upstream_user_id ?? '-'}</DialogDescription>
          </DialogHeader>
          <DialogClose aria-label={t('关闭')} className="user-usage-close" type="button"><X size={18} /></DialogClose>
        </div>
        <div className="user-usage-dialog-body" aria-busy={loading}>
          {loading ? (
            <div className="user-usage-state" role="status"><Loader2 className="spin" size={24} />{t('正在加载结算数据')}</div>
          ) : error ? (
            <div className="user-usage-state error" role="alert">
              <AlertTriangle size={24} /><p>{error}</p>
              <ActionButton className="ghost-button compact" type="button" onClick={() => setAttempt(value => value + 1)}>{t('重试')}</ActionButton>
            </div>
          ) : transactions.length ? (
            <SettlementTransactionList transactions={transactions} onDelete={async transaction => {
              await api(`/api/user-mappings/${encodeURIComponent(mapping.public_username)}/settlements/${encodeURIComponent(transaction.id)}`, { method: 'DELETE' });
              setTransactions(current => current.filter(item => item.id !== transaction.id));
              if (transactions.length === 1 && page > 1) setPage(value => value - 1);
              else setAttempt(value => value + 1);
            }} />
          ) : <div className="user-usage-state"><Database size={26} /><span>{t('暂无结算记录')}</span></div>}
        </div>
        <div className="user-usage-dialog-footer">
          <span className="user-usage-footer-status">{t('每页10笔交易')}</span>
          <div className="settlement-dialog-pagination">
            <ActionButton className="ghost-button compact" type="button" disabled={loading || page <= 1} onClick={() => setPage(value => value - 1)}>{t('上一页')}</ActionButton>
            <span>{t('第 {{page}} 页', { page })}</span>
            <ActionButton className="ghost-button compact" type="button" disabled={loading || !!error || !hasMore} onClick={() => setPage(value => value + 1)}>{t('下一页')}</ActionButton>
          </div>
          <ActionButton className="ghost-button compact" type="button" disabled={loading} onClick={() => setAttempt(value => value + 1)}>
            <RefreshCcw size={15} className={loading ? 'spin' : undefined} />{t('刷新')}
          </ActionButton>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function UserMappingsView() {
  const { language, t } = useLanguage();
  const [items, setItems] = useState<UserMapping[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editingMapping, setEditingMapping] = useState<UserMapping | null>(null);
  const [usageMapping, setUsageMapping] = useState<UserMapping | null>(null);
  const [deletingMapping, setDeletingMapping] = useState<UserMapping | null>(null);
  const [rateMapping, setRateMapping] = useState<UserMapping | null>(null);
  const [settlementMapping, setSettlementMapping] = useState<UserMapping | null>(null);
  const [togglingSync, setTogglingSync] = useState<string | null>(null);
  async function toggleSync(mapping: UserMapping) {
    if (togglingSync) return;
    setTogglingSync(mapping.public_username);
    try {
      const result = await api<{ sync_enabled: boolean }>(`/api/user-mappings/${mapping.public_username}/sync-setting`, {
        method: 'PUT', body: { enabled: !mapping.sync_enabled },
      });
      setItems(current => current.map(item => item.public_username === mapping.public_username ? { ...item, sync_enabled: result.sync_enabled } : item));
      setNotice({ type: 'ok', text: t(result.sync_enabled ? '已启用同步' : '已禁用同步') });
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : t('操作失败') });
    } finally { setTogglingSync(null); }
  }

  const load = useCallback(async (fresh = false) => {
    setLoading(true);
    setNotice(null);
    try {
      const data = await api<UserMappingListResponse>('/api/user-mappings', { fresh });
      setItems(data.items || []);
      return true;
    } catch (failure) {
      setNotice({
        type: 'error',
        text: failure instanceof Error ? failure.message : t('加载用户映射失败'),
      });
      return false;
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleCreated() {
    setCreateOpen(false);
    await load(true);
    setNotice({ type: 'ok', text: t('用户映射创建成功') });
  }

  async function handleUpdated() {
    setEditingMapping(null);
    await load(true);
    setNotice({ type: 'ok', text: t('用户映射更新成功') });
  }

  async function handleDeleted() {
    setDeletingMapping(null);
    setItems(current => current.filter(item => item.public_username !== deletingMapping?.public_username));
    if (await load(true)) {
      setNotice({ type: 'ok', text: t('用户映射删除成功') });
    }
  }

  return (
    <section className="user-mappings-page">
      <div className="user-mappings-toolbar">
        <ActionButton className="ghost-button compact" onClick={() => void load(true)} type="button">
          <RefreshCcw size={17} />{t('刷新')}
        </ActionButton>
        <ActionButton className="primary-button compact" onClick={() => setCreateOpen(true)} type="button">
          <Plus size={17} />{t('新增映射')}
        </ActionButton>
      </div>
      <NoticeBanner notice={notice} />
      <div className="panel user-mappings-panel">
        {loading ? (
          <div className="loading-block">
            <Loader2 className="spin" />
            {t('正在加载用户映射')}
          </div>
        ) : items.length ? (
          <div className="table-wrap">
            <table className="user-mappings-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>{t('用户名')}</th>
                  <th>{t('显示名')}</th>
                  <th>{t('GYS用户名')}</th>
                  <th>{t('所属GYS用户名')}</th>
                  <th>{t('账号类型')}</th>
                  <th>{t('状态')}</th>
                  <th>{t('更新时间')}</th>
                  <th>{t('同步')}</th>
                  <th>{t('数据同步时间')}</th>
                  <th>{t('操作')}</th>
                </tr>
              </thead>
              <tbody>
                {items.map(item => (
                  <tr key={item.public_username}>
                    <td><code className="user-mapping-user-id">{item.upstream_user_id ?? '-'}</code></td>
                    <td><strong>{item.public_username}</strong></td>
                    <td>{item.display_name || '-'}</td>
                    <td><code>{item.upstream_username}</code></td>
                    <td>{item.account_kind === 'sub' && item.parent_gys_username
                      ? <code title={`ID ${item.parent_upstream_user_id}`}>{item.parent_gys_username}</code> : '—'}</td>
                    <td>
                      <Badge tone={item.account_kind === 'primary' ? 'blue' : item.account_kind === 'sub' ? 'purple' : 'neutral'}>
                        {item.account_kind === 'primary'
                          ? t('管理员')
                          : item.account_kind === 'sub'
                            ? t('子账号')
                            : item.account_kind}
                      </Badge>
                    </td>
                    <td><Badge tone={item.active ? 'green' : 'red'}>{t(item.active ? '启用' : '停用')}</Badge></td>
                    <td>{formatBeijingDateTime(item.updated_at, language)}</td>
                    <td><Badge tone={item.can_sync ? 'green' : 'neutral'}>{item.can_sync ? 'Yes' : 'No'}</Badge></td>
                    <td>{item.data_synced_at ? formatBeijingDateTime(item.data_synced_at, language) : '—'}</td>
                    <td>
                      <div className="user-mapping-actions">
                        {item.account_kind === 'primary' && <ActionButton className="user-mapping-edit-button" type="button"
                          disabled={togglingSync !== null} onClick={() => void toggleSync(item)}>
                          <RefreshCcw size={14} />{t(item.sync_enabled ? '禁用同步' : '启用同步')}
                        </ActionButton>}
                        <ActionButton
                          aria-label={t('查看 {{name}} 的结算记录', { name: item.public_username })}
                          className="user-mapping-edit-button"
                          onClick={() => setSettlementMapping(item)}
                          type="button"
                        >
                          <Eye size={14} />{t('查看结算')}
                        </ActionButton>
                        <ActionButton
                          aria-label={t('为 {{name}} 设置汇率', { name: item.public_username })}
                          className="user-mapping-edit-button"
                          onClick={() => setRateMapping(item)}
                          type="button"
                        >
                          <CircleDollarSign size={14} />
                          {t('设置汇率')}
                        </ActionButton>
                        <ActionButton
                          aria-label={t('查看 {{name}} 的分类消耗', { name: item.public_username })}
                          className="user-mapping-usage-button"
                          onClick={() => setUsageMapping(item)}
                          type="button"
                        >
                          <BarChart3 size={14} />
                          {t('查看分类消耗')}
                        </ActionButton>
                        <ActionButton
                          aria-label={t('编辑 {{name}}', { name: item.public_username })}
                          className="user-mapping-edit-button"
                          onClick={() => setEditingMapping(item)}
                          type="button"
                        >
                          <Pencil size={14} />
                          {t('编辑')}
                        </ActionButton>
                        <ActionButton
                          aria-label={t('删除 {{name}}', { name: item.public_username })}
                          className="user-mapping-delete-button"
                          onClick={() => setDeletingMapping(item)}
                          type="button"
                        >
                          <Trash2 size={14} />
                          {t('删除')}
                        </ActionButton>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title={t('暂无用户映射')} description={t('点击“新增映射”创建第一条用户映射。')} />
        )}
      </div>
      {createOpen && (
        <UserMappingDialog mapping={null} onClose={() => setCreateOpen(false)} onSaved={handleCreated} />
      )}
      {editingMapping && (
        <UserMappingDialog
          key={editingMapping.public_username}
          mapping={editingMapping}
          onClose={() => setEditingMapping(null)}
          onSaved={handleUpdated}
        />
      )}
      {usageMapping && (
        <UserMappingUsageDialog
          key={usageMapping.public_username}
          mapping={usageMapping}
          onClose={() => setUsageMapping(null)}
        />
      )}
      {deletingMapping && (
        <DeleteUserMappingDialog
          mapping={deletingMapping}
          onClose={() => setDeletingMapping(null)}
          onDeleted={handleDeleted}
        />
      )}
      {rateMapping && (
        <SubAccountRateDialog
          key={rateMapping.public_username}
          account={{ id: rateMapping.upstream_user_id, username: rateMapping.public_username, display_name: rateMapping.display_name }}
          endpoint={`/api/user-mappings/${encodeURIComponent(rateMapping.public_username)}/category-rates`}
          onClose={() => setRateMapping(null)}
          onSaved={() => {
            setRateMapping(null);
            setNotice({ type: 'ok', text: t('汇率保存成功') });
          }}
        />
      )}
      {settlementMapping && (
        <UserMappingSettlementsDialog
          key={settlementMapping.public_username}
          mapping={settlementMapping}
          onClose={() => setSettlementMapping(null)}
        />
      )}
    </section>
  );
}

function ModelGapsView() {
  const { t } = useLanguage();
  const [items, setItems] = useState<ModelGap[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [copyToast, setCopyToast] = useState<Notice | null>(null);
  const mountedRef = useRef(false);
  const inFlightRef = useRef<Promise<void> | null>(null);
  const requestControllerRef = useRef<AbortController | null>(null);

  const load = useCallback((background = false) => {
    if (inFlightRef.current) return inFlightRef.current;

    const controller = new AbortController();
    requestControllerRef.current = controller;
    if (mountedRef.current) {
      if (background) setRefreshing(true);
      else setLoading(true);
      setNotice(null);
    }

    const request = (async () => {
      try {
        const nextItems = await api<ModelGap[]>('/api/model-gaps?refresh=true', {
          fresh: true,
          signal: controller.signal,
        });
        if (mountedRef.current && !controller.signal.aborted) setItems(nextItems);
      } catch (error) {
        if (!mountedRef.current || controller.signal.aborted) return;
        setNotice({
          type: 'error',
          text: error instanceof Error ? error.message : t('加载模型缺口失败'),
        });
      } finally {
        if (requestControllerRef.current !== controller) return;
        inFlightRef.current = null;
        requestControllerRef.current = null;
        if (mountedRef.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    })();
    inFlightRef.current = request;
    return request;
  }, [t]);

  async function copyReport() {
    const report = [
      t('模型缺口提醒'),
      ...items.map(
        (item) =>
          `${item.platform_type_name} ${item.model_name}: RPM ${formatInteger(item.gap_rpm)}, TPM ${formatInteger(item.gap_tpm_est)}`,
      ),
    ].join('\n');
    await navigator.clipboard.writeText(report).catch(() => undefined);
    setCopyToast({ type: 'ok', text: t('已复制缺口通知。') });
  }

  useEffect(() => {
    mountedRef.current = true;
    void load(false);
    const timer = window.setInterval(() => {
      void load(true);
    }, MODEL_GAPS_REFRESH_INTERVAL_MS);
    return () => {
      mountedRef.current = false;
      window.clearInterval(timer);
      const controller = requestControllerRef.current;
      requestControllerRef.current = null;
      inFlightRef.current = null;
      controller?.abort();
    };
  }, [load]);

  useEffect(() => {
    if (!copyToast) return;
    const timer = window.setTimeout(() => setCopyToast(null), 2600);
    return () => window.clearTimeout(timer);
  }, [copyToast]);

  return (
    <section>
      {copyToast && (
        <div className={`upload-toast upload-toast-${copyToast.type} model-gap-toast`} role="status">
          <CheckCircle2 size={17} />
          <span>{copyToast.text}</span>
        </div>
      )}
      <div className="page-actions-toolbar">
            <ActionButton className="ghost-button" onClick={copyReport} type="button">
              <ClipboardCopy size={17} />
              {t('复制通知')}
            </ActionButton>
            <ActionButton
              className="primary-button compact"
              disabled={loading || refreshing}
              onClick={() => void load(true)}
              type="button"
            >
              <RefreshCcw className={loading || refreshing ? 'spin' : undefined} size={17} />
              {t('刷新')}
            </ActionButton>
          </div>
      <NoticeBanner notice={notice} />
      <div className="panel">
        {loading ? (
          <div className="loading-block">
            <Loader2 className="spin" />
            {t('正在加载模型缺口')}
          </div>
        ) : items.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t('平台类型')}</th>
                  <th>{t('模型')}</th>
                  <th>{t('RPM 缺口')}</th>
                  <th>{t('TPM 估算')}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={`${item.platform_type}-${item.model_name}`}>
                    <td>
                      <Badge tone={item.platform_type_name.toLowerCase().includes('aws') ? 'orange' : 'purple'}>
                        {item.platform_type_name}
                      </Badge>
                    </td>
                    <td>
                      <code>{item.model_name}</code>
                    </td>
                    <td>
                      <strong>{formatInteger(item.gap_rpm)}</strong>
                    </td>
                    <td>{formatInteger(item.gap_tpm_est)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title={t('暂无缺口')} description={t('目前没有模型缺口提醒。')} />
        )}
      </div>
    </section>
  );
}

function AnnouncementManagementView() {
  const { language, t } = useLanguage();
  const [items, setItems] = useState<AnnouncementItem[]>([]);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [titleEn, setTitleEn] = useState('');
  const [contentEn, setContentEn] = useState('');
  const [composeOpen, setComposeOpen] = useState(false);
  const [publishError, setPublishError] = useState('');
  const [loading, setLoading] = useState(true);
  const [publishing, setPublishing] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [pendingDelete, setPendingDelete] = useState<AnnouncementItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [notice, setNotice] = useState<Notice | null>(null);
  const composeTriggerRef = useRef<HTMLButtonElement>(null);

  const load = useCallback(async (fresh = false) => {
    setLoading(true);
    setNotice(null);
    try {
      const data = await api<AnnouncementListResponse>('/api/announcement-management', { fresh });
      setItems(data.items || []);
    } catch (failure) {
      setNotice({
        type: 'error',
        text: failure instanceof Error ? failure.message : t('加载公告失败'),
      });
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(
      () => setNotice(null),
      notice.type === 'error' ? 5_000 : 2_800,
    );
    return () => window.clearTimeout(timer);
  }, [notice]);

  async function publish(event: FormEvent) {
    event.preventDefault();
    const nextTitle = title.trim();
    const nextContent = content.trim();
    const nextTitleEn = titleEn.trim();
    const nextContentEn = contentEn.trim();
    if (!nextTitle || !nextContent || !nextTitleEn || !nextContentEn || publishing) return;

    setPublishing(true);
    setPublishError('');
    setNotice(null);
    try {
      const payload: AnnouncementCreatePayload = {
        titleZh: nextTitle,
        contentZh: nextContent,
        titleEn: nextTitleEn,
        contentEn: nextContentEn,
      };
      await api<AnnouncementItem>('/api/announcement-management', {
        method: 'POST',
        body: payload,
      });
      setTitle('');
      setContent('');
      setTitleEn('');
      setContentEn('');
      await load(true);
      closeCompose();
      setNotice({ type: 'ok', text: t('公告发布成功') });
      window.dispatchEvent(new Event('gys:announcements-changed'));
    } catch (failure) {
      setPublishError(failure instanceof Error ? failure.message : t('发布公告失败'));
    } finally {
      setPublishing(false);
    }
  }

  async function togglePublished(item: AnnouncementItem) {
    if (busyId !== null) return;
    setBusyId(item.id);
    setNotice(null);
    try {
      await api<AnnouncementItem>(`/api/announcement-management/${item.id}`, {
        method: 'PATCH',
        body: { published: !item.published },
      });
      await load(true);
      setNotice({
        type: 'ok',
        text: t(item.published ? '公告已下架' : '公告已重新发布'),
      });
    } catch (failure) {
      setNotice({
        type: 'error',
        text: failure instanceof Error ? failure.message : t('更新公告状态失败'),
      });
    } finally {
      setBusyId(null);
    }
  }

  function openDelete(item: AnnouncementItem) {
    setDeleteError('');
    setPendingDelete(item);
  }

  function closeCompose() {
    setPublishError('');
    setComposeOpen(false);
    window.setTimeout(() => composeTriggerRef.current?.focus(), 0);
  }

  async function removeAnnouncement() {
    if (!pendingDelete || deleting) return;
    setDeleting(true);
    setDeleteError('');
    try {
      await api(`/api/announcement-management/${pendingDelete.id}`, { method: 'DELETE' });
      setPendingDelete(null);
      await load(true);
      setNotice({ type: 'ok', text: t('公告已删除') });
    } catch (failure) {
      setDeleteError(failure instanceof Error ? failure.message : t('删除公告失败'));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <section className="announcement-management-page">
      {notice && (
        <div
          className={`upload-toast upload-toast-${notice.type} announcement-management-toast`}
          role={notice.type === 'error' ? 'alert' : 'status'}
        >
          {notice.type === 'ok' ? (
            <CheckCircle2 size={17} />
          ) : notice.type === 'error' ? (
            <XCircle size={17} />
          ) : (
            <AlertTriangle size={17} />
          )}
          <span>{notice.text}</span>
        </div>
      )}
      <div className="page-actions-toolbar">
            <ActionButton className="ghost-button compact" disabled={loading} onClick={() => load(true)} type="button">
              <RefreshCcw className={loading ? 'spin' : ''} size={17} />
              {t('刷新')}
            </ActionButton>
            <ActionButton
              className="primary-button compact"
              onClick={() => {
                setPublishError('');
                setComposeOpen(true);
              }}
              ref={composeTriggerRef}
              type="button"
            >
              <Plus size={16} />
              {t('添加公告')}
            </ActionButton>
          </div>
      <section className="panel announcement-list-panel">
        <div className="panel-title">
          <h2>{t('管理现有公告')}</h2>
          {!loading && <Badge tone="blue">{items.length}</Badge>}
        </div>
        {loading ? (
          <div className="loading-block announcement-management-loading">
            <Loader2 className="spin" />
            {t('正在加载公告')}
          </div>
        ) : items.length ? (
          <div className="announcement-management-list">
            {items.map(item => {
              const itemCopy = localizedAnnouncement(item, language);
              return (
                <article className="announcement-management-item" key={item.id}>
                  <header>
                    <h3>{itemCopy.title}</h3>
                    <Badge tone={item.published ? 'green' : 'neutral'}>
                      {t(item.published ? '已发布' : '已下架')}
                    </Badge>
                  </header>
                  <p>{itemCopy.content}</p>
                  <footer>
                    <div className="announcement-management-actions">
                      <ActionButton
                        className="ghost-button compact"
                        disabled={busyId !== null}
                        onClick={() => togglePublished(item)}
                        type="button"
                      >
                        {busyId === item.id ? (
                          <Loader2 className="spin" size={15} />
                        ) : item.published ? (
                          <EyeOff size={15} />
                        ) : (
                          <Eye size={15} />
                        )}
                        {t(item.published ? '下架' : '重新发布')}
                      </ActionButton>
                      <ActionButton
                        className="danger-button compact"
                        disabled={busyId !== null}
                        onClick={() => openDelete(item)}
                        type="button"
                      >
                        <Trash2 size={15} />{t('删除')}
                      </ActionButton>
                    </div>
                  </footer>
                </article>
              );
            })}
          </div>
        ) : (
          <EmptyState
            title={t('暂无公告记录')}
            description={t('发布第一条公告后会显示在这里。')}
          />
        )}
      </section>

      <Dialog
        onOpenChange={nextOpen => {
          if (publishing && !nextOpen) return;
          setComposeOpen(nextOpen);
          if (!nextOpen) {
            setPublishError('');
            window.setTimeout(() => composeTriggerRef.current?.focus(), 0);
          }
        }}
        open={composeOpen}
      >
        <DialogContent className="announcement-compose-dialog" showCloseButton={false}>
          <div className="announcement-compose-dialog-header">
            <DialogHeader>
              <DialogTitle>{t('添加公告')}</DialogTitle>
              <DialogDescription>{t('分别填写中文和英文公告，用户将看到与当前语言一致的内容。')}</DialogDescription>
            </DialogHeader>
            <DialogClose aria-label={t('关闭')} className="announcement-compose-close" disabled={publishing}>
              <X size={18} />
            </DialogClose>
          </div>
          <form aria-busy={publishing} className="announcement-compose-form" onSubmit={publish}>
            <div className="announcement-language-grid">
              <fieldset className="announcement-language-panel">
                <legend>{t('中文版本')}</legend>
                <label>
                  <span className="announcement-field-heading">
                    <span>{t('中文标题')}</span>
                    <small>{title.length}/120 {t('字符')}</small>
                  </span>
                  <input
                    autoFocus
                    maxLength={120}
                    onChange={event => setTitle(event.target.value)}
                    placeholder={t('请输入中文公告标题')}
                    required
                    value={title}
                  />
                </label>
                <label>
                  <span className="announcement-field-heading">
                    <span>{t('中文内容')}</span>
                    <small>{content.length}/5000 {t('字符')}</small>
                  </span>
                  <textarea
                    maxLength={5000}
                    onChange={event => setContent(event.target.value)}
                    placeholder={t('请输入中文公告内容')}
                    required
                    rows={7}
                    value={content}
                  />
                </label>
              </fieldset>
              <fieldset className="announcement-language-panel">
                <legend>{t('英文版本')}</legend>
                <label>
                  <span className="announcement-field-heading">
                    <span>{t('英文标题')}</span>
                    <small>{titleEn.length}/120 {t('字符')}</small>
                  </span>
                  <input
                    maxLength={120}
                    onChange={event => setTitleEn(event.target.value)}
                    placeholder={t('请输入英文公告标题')}
                    required
                    value={titleEn}
                  />
                </label>
                <label>
                  <span className="announcement-field-heading">
                    <span>{t('英文内容')}</span>
                    <small>{contentEn.length}/5000 {t('字符')}</small>
                  </span>
                  <textarea
                    maxLength={5000}
                    onChange={event => setContentEn(event.target.value)}
                    placeholder={t('请输入英文公告内容')}
                    required
                    rows={7}
                    value={contentEn}
                  />
                </label>
              </fieldset>
            </div>
            {publishError && <p className="announcement-publish-error" role="alert">{publishError}</p>}
            <div className="announcement-compose-actions">
              <ActionButton
                className="ghost-button compact"
                disabled={publishing}
                onClick={closeCompose}
                type="button"
              >
                {t('取消')}
              </ActionButton>
              <ActionButton
                className="primary-button compact announcement-publish-button"
                disabled={publishing || !title.trim() || !content.trim() || !titleEn.trim() || !contentEn.trim()}
                type="submit"
              >
                {publishing ? <Loader2 className="spin" size={16} /> : <Megaphone size={16} />}
                {t(publishing ? '发布中...' : '发布公告')}
              </ActionButton>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        onOpenChange={nextOpen => {
          if (!nextOpen && !deleting) {
            setPendingDelete(null);
            setDeleteError('');
          }
        }}
        open={Boolean(pendingDelete)}
      >
        <DialogContent className="announcement-delete-dialog" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>{t('删除公告')}</DialogTitle>
            <DialogDescription>
              {pendingDelete
                ? t('确定删除公告“{{title}}”吗？删除后无法恢复。', {
                    title: localizedAnnouncement(pendingDelete, language).title,
                  })
                : ''}
            </DialogDescription>
          </DialogHeader>
          {deleteError && <p className="account-dialog-error" role="alert">{deleteError}</p>}
          <div className="announcement-delete-actions">
            <ActionButton className="ghost-button compact" disabled={deleting} onClick={() => setPendingDelete(null)} type="button">
              {t('取消')}
            </ActionButton>
            <ActionButton className="danger-button compact solid" disabled={deleting} onClick={removeAnnouncement} type="button">
              {deleting && <Loader2 className="spin" size={15} />}
              {t(deleting ? '正在删除...' : '删除')}
            </ActionButton>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function SubAccountRateDialog({
  account,
  endpoint = `/api/sub-accounts/${account.id}/category-rates`,
  onClose,
  onSaved,
}: {
  account: { id: number | null; username: string; display_name?: string };
  endpoint?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { language, t } = useLanguage();
  const [rates, setRates] = useState<Record<string, string>>(() => Object.fromEntries(
    channelUsageCategories.map((category) => [category, '100']),
  ));
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setLoaded(false);
    setError('');
    api<CategoryRateResponse>(endpoint, {
      fresh: true,
      signal: controller.signal,
    })
      .then((value) => {
        if (controller.signal.aborted) return;
        setRates(Object.fromEntries(channelUsageCategories.map((category) => [
          category,
          value.rates.find((item) => item.category === category)?.ratePercent || '100',
        ])));
        setLoaded(true);
      })
      .catch((failure) => {
        if (!controller.signal.aborted) {
          setError(failure instanceof Error ? failure.message : t('加载汇率失败'));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [endpoint, t]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || !loaded) return;
    const invalid = channelUsageCategories.some((category) => {
      const value = Number(rates[category]);
      return !rates[category].trim() || !Number.isFinite(value) || value < 0 || value > 100000;
    });
    if (invalid) {
      setError(t('汇率须在 0% 至 100000% 之间'));
      return;
    }
    setSaving(true);
    setError('');
    try {
      await api(endpoint, {
        method: 'PUT',
        body: { rates },
      });
      onSaved();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t('保存汇率失败'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) onClose();
      }}
      role="presentation"
    >
      <section
        aria-labelledby="sub-account-rate-title"
        aria-modal="true"
        className="account-dialog sub-account-rate-dialog compact-rate-dialog"
        role="dialog"
      >
        <div className="account-dialog-header sub-account-rate-header">
          <div>
            <h2 id="sub-account-rate-title"><CircleDollarSign size={20} />{t('渠道分类汇率')}</h2>
            <p>{account.display_name || account.username} · ID {account.id ?? '-'}</p>
          </div>
          <button aria-label={t('关闭')} disabled={saving} onClick={onClose} type="button"><X size={18} /></button>
        </div>
        {loading ? (
          <div className="sub-account-rate-loading" role="status">
            <Loader2 className="spin" size={22} />{t('正在加载汇率')}
          </div>
        ) : (
          <form onSubmit={submit}>
            <div className="compact-rate-grid">
              {channelUsageCategories.map(category => (
                <label className="compact-rate-card" key={category}>
                  <span className="compact-rate-card-title">{categoryLabel(category, language)}</span>
                  <span className="sub-account-rate-input suffix">
                    <input
                      aria-label={`${categoryLabel(category, language)} ${t('汇率')}`}
                      inputMode="decimal"
                      max="100000"
                      min="0"
                      disabled={saving || !loaded}
                      onChange={event => setRates(current => ({ ...current, [category]: event.target.value }))}
                      required
                      step="0.01"
                      type="number"
                      value={rates[category]}
                    />
                    <b>%</b>
                  </span>
                </label>
              ))}
            </div>
            <p className="sub-account-rate-hint">
              {t('100% 为原始消耗金额；结算金额会按此比例计算。')}
            </p>
            {error && <p className="account-dialog-error" role="alert">{error}</p>}
            <div className="account-dialog-actions">
              <ActionButton className="ghost-button" disabled={saving} onClick={onClose} type="button">{t('取消')}</ActionButton>
              <ActionButton className="primary-button compact" disabled={saving || !loaded} type="submit">
                {saving && <Loader2 className="spin" size={16} />}
                {t(saving ? '保存中...' : '保存汇率')}
              </ActionButton>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}

function isStrongSubAccountPassword(password: string) {
  return password.length >= 8
    && /[A-Za-z]/.test(password)
    && /\d/.test(password)
    && /[^A-Za-z0-9]/.test(password);
}

function CreateSubAccountDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => Promise<void>;
}) {
  const { t } = useLanguage();
  const [publicUsername, setPublicUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleanPublicUsername = publicUsername.trim();
    const cleanDisplayName = displayName.trim();
    if (!cleanPublicUsername) {
      setError(t('请输入本站用户名'));
      return;
    }
    if (!/^[A-Za-z0-9_.-]{3,64}$/.test(cleanPublicUsername)) {
      setError(t('本站用户名须为3至64位字母、数字、点、横线或下划线'));
      return;
    }
    if (!cleanDisplayName) {
      setError(t('请输入本站显示名'));
      return;
    }
    if (!isStrongSubAccountPassword(password)) {
      setError(t('密码至少8位，须含字母、数字和特殊字符'));
      return;
    }
    setSaving(true);
    setError('');
    try {
      await api('/api/sub-accounts', {
        method: 'POST',
        body: {
          public_username: cleanPublicUsername,
          display_name: cleanDisplayName,
          password,
        },
      });
      await onCreated();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t('创建失败'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onMouseDown={event => {
        if (event.target === event.currentTarget && !saving) onClose();
      }}
    >
      <section
        aria-labelledby="create-sub-account-title"
        aria-modal="true"
        className="account-dialog sub-account-dialog"
        role="dialog"
      >
        <div className="account-dialog-header">
          <h2 id="create-sub-account-title">{t('新增子账号')}</h2>
          <button aria-label={t('关闭')} disabled={saving} onClick={onClose} type="button">
            <X size={18} />
          </button>
        </div>
        <form onSubmit={submit}>
          <label>
            <span>{t('本站用户名')}</span>
            <input
              autoComplete="off"
              autoFocus
              maxLength={64}
              minLength={3}
              onChange={event => setPublicUsername(event.target.value)}
              pattern="[A-Za-z0-9_.-]{3,64}"
              placeholder={t('本站用户名')}
              required
              value={publicUsername}
            />
          </label>
          <label>
            <span>{t('本站显示名')}</span>
            <input
              autoComplete="off"
              maxLength={128}
              onChange={event => setDisplayName(event.target.value)}
              placeholder={t('本站显示名')}
              required
              value={displayName}
            />
          </label>
          <label>
            <span>{t('密码')}</span>
            <span className="password-input-wrap">
              <input
                autoComplete="new-password"
                maxLength={4096}
                minLength={8}
                onChange={event => setPassword(event.target.value)}
                placeholder={t('密码至少8位，须含字母、数字和特殊字符')}
                required
                type={showPassword ? 'text' : 'password'}
                value={password}
              />
              <button
                aria-label={t(showPassword ? '隐藏密码' : '显示密码')}
                onClick={() => setShowPassword(value => !value)}
                type="button"
              >
                {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            </span>
          </label>
          {error && <p className="account-dialog-error" role="alert">{error}</p>}
          <div className="account-dialog-actions">
            <ActionButton className="ghost-button" disabled={saving} onClick={onClose} type="button">
              {t('取消')}
            </ActionButton>
            <ActionButton className="primary-button compact" disabled={saving} type="submit">
              {saving && <Loader2 className="spin" size={16} />}
              {t(saving ? '创建中...' : '创建子账号')}
            </ActionButton>
          </div>
        </form>
      </section>
    </div>
  );
}

function EditSubAccountDialog({
  account,
  onClose,
  onUpdated,
}: {
  account: SubAccount;
  onClose: () => void;
  onUpdated: () => Promise<void>;
}) {
  const { t } = useLanguage();
  const upstreamUsername = subAccountUpstreamUsername(account);
  const [displayName, setDisplayName] = useState(account.display_name || upstreamUsername);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [enabled, setEnabled] = useState(account.status === 1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleanDisplayName = displayName.trim();
    if (!cleanDisplayName) {
      setError(t('请输入显示名'));
      return;
    }
    if (password && !isStrongSubAccountPassword(password)) {
      setError(t('密码至少8位，须含字母、数字和特殊字符'));
      return;
    }
    setSaving(true);
    setError('');
    try {
      await api(`/api/sub-accounts/${account.id}`, {
        method: 'PUT',
        body: {
          display_name: cleanDisplayName,
          status: enabled ? 1 : 0,
          ...(password ? { password } : {}),
        },
      });
      await onUpdated();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t('编辑子账号失败'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onMouseDown={event => {
        if (event.target === event.currentTarget && !saving) onClose();
      }}
    >
      <section aria-labelledby="edit-sub-account-title" aria-modal="true" className="account-dialog sub-account-dialog" role="dialog">
        <div className="account-dialog-header">
          <h2 id="edit-sub-account-title">{t('编辑子账号')}</h2>
          <button aria-label={t('关闭')} disabled={saving} onClick={onClose} type="button"><X size={18} /></button>
        </div>
        <form onSubmit={submit}>
          <label>
            <span>{t('GYS用户名')}</span>
            <input disabled value={upstreamUsername || '-'} />
          </label>
          <label>
            <span>{t('显示名')}</span>
            <input
              autoFocus
              maxLength={128}
              onChange={event => setDisplayName(event.target.value)}
              required
              value={displayName}
            />
          </label>
          <label>
            <span>{t('新密码（可选）')}</span>
            <span className="password-input-wrap">
              <input
                autoComplete="new-password"
                maxLength={4096}
                onChange={event => setPassword(event.target.value)}
                placeholder={t('留空则不修改密码')}
                type={showPassword ? 'text' : 'password'}
                value={password}
              />
              <button
                aria-label={t(showPassword ? '隐藏密码' : '显示密码')}
                onClick={() => setShowPassword(value => !value)}
                type="button"
              >
                {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            </span>
          </label>
          <label className="sub-account-status-control">
            <input checked={enabled} onChange={event => setEnabled(event.target.checked)} type="checkbox" />
            <span>{t('启用账号')}</span>
          </label>
          {error && <p className="account-dialog-error" role="alert">{error}</p>}
          <div className="account-dialog-actions">
            <ActionButton className="ghost-button" disabled={saving} onClick={onClose} type="button">{t('取消')}</ActionButton>
            <ActionButton className="primary-button compact" disabled={saving} type="submit">
              {saving && <Loader2 className="spin" size={16} />}
              {t(saving ? '保存中...' : '保存修改')}
            </ActionButton>
          </div>
        </form>
      </section>
    </div>
  );
}

function DeleteSubAccountDialog({
  account,
  onClose,
  onDeleted,
}: {
  account: SubAccount;
  onClose: () => void;
  onDeleted: () => Promise<void>;
}) {
  const { t } = useLanguage();
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');

  async function remove() {
    setDeleting(true);
    setError('');
    try {
      await api(`/api/sub-accounts/${account.id}`, { method: 'DELETE' });
      await onDeleted();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t('删除子账号失败'));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div
      className="dialog-backdrop channel-confirm-backdrop"
      onMouseDown={event => {
        if (event.target === event.currentTarget && !deleting) onClose();
      }}
      role="presentation"
    >
      <section aria-labelledby="delete-sub-account-title" aria-modal="true" className="channel-confirm-dialog delete" role="dialog">
        <header className="channel-confirm-header">
          <span className="channel-confirm-icon" aria-hidden="true"><Trash2 size={19} /></span>
          <div className="channel-confirm-heading"><h2 id="delete-sub-account-title">{t('确认删除子账号')}</h2></div>
          <button aria-label={t('关闭')} className="channel-confirm-close" disabled={deleting} onClick={onClose} type="button"><X size={18} /></button>
        </header>
        <div className="channel-confirm-body">
          <p>{t('确定删除子账号“{{name}}”吗？删除后无法恢复。', { name: account.display_name || account.username })}</p>
          <div className="channel-confirm-target">
            <span>{t('GYS用户名')}</span>
            <strong>{subAccountUpstreamUsername(account)}</strong>
            <code>ID {account.id}</code>
          </div>
          {error && <p className="account-dialog-error" role="alert">{error}</p>}
        </div>
        <footer className="channel-confirm-footer">
          <ActionButton className="ghost-button" disabled={deleting} onClick={onClose} type="button">{t('取消')}</ActionButton>
          <ActionButton className="channel-confirm-submit danger" disabled={deleting} onClick={remove} type="button">
            {deleting && <Loader2 className="spin" size={15} />}
            {t(deleting ? '正在删除...' : '删除')}
          </ActionButton>
        </footer>
      </section>
    </div>
  );
}

function BatchSubAccountsDialog({ accounts, action, onClose, onSuccess }: {
  accounts: SubAccount[];
  action: 'sync' | 'delete';
  onClose: () => void;
  onSuccess: (id: number, updated?: SubAccount) => void;
}) {
  const { t } = useLanguage();
  const [running, setRunning] = useState(false);
  const [finished, setFinished] = useState(false);
  const [results, setResults] = useState<Array<{ id: number; text: string; ok: boolean }>>([]);
  const started = useRef(false);
  async function run() {
    if (started.current) return;
    started.current = true;
    setRunning(true);
    for (const account of accounts) {
      try {
        const updated = await api<SubAccount>(action === 'sync'
          ? `/api/sub-accounts/${account.id}/mapping/sync` : `/api/sub-accounts/${account.id}`,
        { method: action === 'sync' ? 'POST' : 'DELETE' });
        onSuccess(account.id, action === 'sync' ? updated : undefined);
        setResults(current => [...current, { id: account.id, text: t(action === 'sync' ? '同步成功' : '删除成功'), ok: true }]);
      } catch (error) {
        setResults(current => [...current, { id: account.id, text: error instanceof Error ? error.message : t('操作失败'), ok: false }]);
        if (error instanceof SessionExpiredError) break;
      }
    }
    setRunning(false);
    setFinished(true);
  }
  return <Dialog open disablePointerDismissal={running} onOpenChange={(open, details) => {
    if (!open && running) { details.cancel(); return; }
    if (!open) onClose();
  }}>
    <DialogContent className="account-dialog" showCloseButton={!running}>
      <DialogHeader>
        <DialogTitle>{t(action === 'sync' ? '批量同步' : '批量删除')}（{accounts.length}）</DialogTitle>
        <DialogDescription>{t(action === 'sync'
          ? '同步所选子账号到用户映射，重复 ID 将提示已在表中。'
          : '将删除所选子账号，删除后无法恢复。有结算历史的账号将保留。')}</DialogDescription>
      </DialogHeader>
      <div className="batch-sub-account-results">
        {accounts.map(account => {
          const result = results.find(item => item.id === account.id);
          return <div key={account.id}>
            <span>{subAccountUpstreamUsername(account)} · ID {account.id}</span>
            <span className={result && !result.ok ? 'batch-sub-account-error' : undefined}>
              {result?.text || t(finished ? '未执行' : '待处理')}
            </span>
          </div>;
        })}
      </div>
      {(running || finished) && <p>{t('处理进度')}：{results.length} / {accounts.length} · {t('成功')} {results.filter(item => item.ok).length}</p>}
      <div className="account-dialog-actions">
        <ActionButton className="ghost-button" type="button" disabled={running} onClick={onClose}>{t(finished ? '关闭' : '取消')}</ActionButton>
        {!finished && <ActionButton className="primary-button" type="button" disabled={running} onClick={() => void run()}>
          {running && <Loader2 size={16} className="spin" />}{t(running ? '处理中...' : action === 'sync' ? '开始同步' : '确认删除')}
        </ActionButton>}
      </div>
    </DialogContent>
  </Dialog>;
}

function SubAccountsView() {
  const { language, t } = useLanguage();
  const [items, setItems] = useState<SubAccount[]>([]);
  const [financeAccount, setFinanceAccount] = useState<{ public_username: string; upstream_user_id: number; view: 'usage' | 'settlements' } | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [rateAccount, setRateAccount] = useState<SubAccount | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<SubAccount | null>(null);
  const [deletingAccount, setDeletingAccount] = useState<SubAccount | null>(null);
  const [syncingId, setSyncingId] = useState<number | null>(null);
  const [syncEnabled, setSyncEnabled] = useState(false);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [batch, setBatch] = useState<{ action: 'sync' | 'delete'; accounts: SubAccount[] } | null>(null);
  const selectedAccounts = items.filter(item => selectedIds.includes(item.id));

  async function syncMapping(account: SubAccount) {
    if (syncingId !== null) return;
    setSyncingId(account.id);
    setNotice(null);
    try {
      const updated = await api<SubAccount>(`/api/sub-accounts/${account.id}/mapping/sync`, { method: 'POST' });
      setItems(current => current.map(item => item.id === account.id ? updated : item));
      setNotice({ type: 'ok', text: t('已同步到用户映射，已有映射信息已保留') });
    } catch (error) {
      setNotice({ type: 'warn', text: error instanceof Error ? error.message : t('同步用户映射失败') });
    } finally {
      setSyncingId(null);
    }
  }

  const load = useCallback(async (fresh = false) => {
    setLoading(true);
    setNotice(null);
    try {
      const data = await api<{ items: SubAccount[]; sync_enabled: boolean }>('/api/sub-accounts', { fresh });
      setItems(data.items || []);
      setSyncEnabled(data.sync_enabled === true);
      setSelectedIds(current => current.filter(id => (data.items || []).some(item => item.id === id)));
    } catch (error) {
      setNotice({
        type: 'warn',
        text: error instanceof Error ? error.message : t('当前账号无权限管理子账号'),
      });
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleCreated() {
    setCreateOpen(false);
    await load(true);
    setNotice({
      type: 'ok',
      text: t('子账号创建成功，可使用 GYS 用户名和密码登录本站。'),
    });
  }

  async function handleUpdated() {
    setEditingAccount(null);
    await load(true);
    setNotice({ type: 'ok', text: t('子账号修改成功') });
  }

  async function handleDeleted() {
    setDeletingAccount(null);
    await load(true);
    setNotice({ type: 'ok', text: t('子账号删除成功') });
  }

  function handleRatesSaved() {
    setRateAccount(null);
    setNotice({ type: 'ok', text: t('汇率保存成功') });
  }

  return (
    <section className="sub-accounts-page">
      <PageHeading
        icon={Users}
        title={t('子账号管理')}
        subtitle={t('管理子账号及分类汇率。')}
        action={
          <div className="action-row">
            {syncEnabled && <ActionButton className="ghost-button compact" disabled={loading || syncingId !== null || !selectedAccounts.length} type="button"
              onClick={() => setBatch({ action: 'sync', accounts: selectedAccounts })}>
              <RefreshCcw size={17} />{t('批量同步')}（{selectedAccounts.length}）
            </ActionButton>}
            <ActionButton className="ghost-button compact" disabled={loading || syncingId !== null || !selectedAccounts.length} type="button"
              onClick={() => setBatch({ action: 'delete', accounts: selectedAccounts })}>
              <Trash2 size={17} />{t('批量删除')}（{selectedAccounts.length}）
            </ActionButton>
            <ActionButton className="ghost-button compact" onClick={() => load(true)} type="button">
              <RefreshCcw size={17} />
              {t('刷新')}
            </ActionButton>
            <ActionButton className="primary-button compact" onClick={() => setCreateOpen(true)} type="button">
              <Plus size={17} />
              {t('新增子账号')}
            </ActionButton>
          </div>
        }
      />
      <NoticeBanner notice={notice} />
      <div className="panel sub-accounts-panel">
        {loading ? (
          <div className="loading-block">
            <Loader2 className="spin" />
            {t('正在检查权限')}
          </div>
        ) : items.length ? (
          <div className="table-wrap sub-accounts-scroll" role="region" aria-label={t('子账号管理')} tabIndex={0}>
            <table className={`sub-accounts-table ${syncEnabled ? 'has-upstream-column' : ''}`}>
              <colgroup>
                <col style={{ width: 48 }} /><col style={{ width: 76 }} />
                <col style={{ width: 180 }} />
                {syncEnabled && <col style={{ width: 180 }} />}
                <col style={{ width: 180 }} /><col style={{ width: 96 }} />
                <col style={{ width: 160 }} /><col style={{ width: 96 }} />
                <col style={{ width: syncEnabled ? 570 : 500 }} />
              </colgroup>
              <thead>
                <tr>
                  <th><input type="checkbox" aria-label={t('全选')} checked={items.length > 0 && selectedAccounts.length === items.length}
                    ref={node => { if (node) node.indeterminate = selectedAccounts.length > 0 && selectedAccounts.length < items.length; }}
                    onChange={event => setSelectedIds(event.target.checked ? items.map(item => item.id) : [])} /></th>
                  <th>ID</th>
                  <th>{t('本站用户名')}</th>
                  {syncEnabled && <th>{t('GYS用户名')}</th>}
                  <th>{t('显示名')}</th>
                  <th className="sub-account-count">{t('渠道数')}</th>
                  <th className="sub-account-quota">{t('已用额度')}</th>
                  <th className="sub-account-status">{t('状态')}</th>
                  <th>{t('操作')}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  const publicUsername = subAccountPublicUsername(item);
                  const upstreamUsername = subAccountUpstreamUsername(item);
                  const accountName = item.display_name || publicUsername || upstreamUsername;
                  return (
                  <tr key={item.id} data-selected={selectedIds.includes(item.id) || undefined}>
                    <td><input type="checkbox" aria-label={`${t('选择')} ${accountName}`} checked={selectedIds.includes(item.id)}
                      onChange={event => setSelectedIds(current => event.target.checked ? [...new Set([...current, item.id])] : current.filter(id => id !== item.id))} /></td>
                    <td><span className="sub-account-id">{item.id}</span></td>
                    <td className="sub-account-name">{publicUsername || <Badge>{t('未映射')}</Badge>}</td>
                    {syncEnabled && <td>{upstreamUsername || '-'}</td>}
                    <td>{item.mapping_display_name || item.display_name || '-'}</td>
                    <td className="sub-account-count"><span>{formatInteger(item.channel_count)}</span></td>
                    <td className="sub-account-quota">${formatNumericText(formatQuota(item.used_quota).slice(1))}</td>
                    <td className="sub-account-status">
                      <Badge tone={item.status === 1 ? 'green' : 'red'}>{statusLabel(item.status, language)}</Badge>
                    </td>
                    <td>
                      <div className="sub-account-row-actions">
                        {syncEnabled && <ActionButton disabled={syncingId !== null} onClick={() => void syncMapping(item)} type="button">
                          <RefreshCcw className={syncingId === item.id ? 'spin' : undefined} size={14} />
                          {t(syncingId === item.id ? '同步中...' : '同步')}
                        </ActionButton>}
                        <ActionButton className="finance-action" disabled={!publicUsername} onClick={() => { if (publicUsername) setFinanceAccount({ public_username: publicUsername, upstream_user_id: item.id, view: 'usage' }); }} type="button">
                          <BarChart3 size={14} />{t('查看分类消耗')}
                        </ActionButton>
                        <ActionButton className="finance-action" disabled={!publicUsername} onClick={() => { if (publicUsername) setFinanceAccount({ public_username: publicUsername, upstream_user_id: item.id, view: 'settlements' }); }} type="button">
                          <Eye size={14} />{t('查看结算')}
                        </ActionButton>
                        <ActionButton aria-label={t('为 {{name}} 设置汇率', { name: accountName })} onClick={() => setRateAccount(item)} type="button">
                          <CircleDollarSign size={14} />{t('设置汇率')}
                        </ActionButton>
                        <ActionButton aria-label={t('编辑 {{name}}', { name: accountName })} onClick={() => setEditingAccount(item)} type="button">
                          <Pencil size={14} />{t('编辑')}
                        </ActionButton>
                        <ActionButton aria-label={t('删除 {{name}}', { name: accountName })} className="danger" onClick={() => setDeletingAccount(item)} type="button">
                          <Trash2 size={14} />{t('删除')}
                        </ActionButton>
                      </div>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title={t('暂无子账号')} description={t('点击“新增子账号”创建第一个子账号。')} />
        )}
      </div>
      {batch && <BatchSubAccountsDialog accounts={batch.accounts} action={batch.action} onClose={() => setBatch(null)}
        onSuccess={(id, updated) => {
          setItems(current => updated ? current.map(item => item.id === id ? updated : item) : current.filter(item => item.id !== id));
          setSelectedIds(current => current.filter(value => value !== id));
        }} />}
      {financeAccount?.view === 'usage' && (
        <UserMappingUsageDialog key={financeAccount.upstream_user_id} mapping={financeAccount} onClose={() => setFinanceAccount(null)} />
      )}
      {financeAccount?.view === 'settlements' && (
        <UserMappingSettlementsDialog key={financeAccount.upstream_user_id} mapping={financeAccount} onClose={() => setFinanceAccount(null)} />
      )}
      {rateAccount && (
        <SubAccountRateDialog
          key={rateAccount.id}
          account={rateAccount}
          onClose={() => setRateAccount(null)}
          onSaved={handleRatesSaved}
        />
      )}
      {createOpen && <CreateSubAccountDialog onClose={() => setCreateOpen(false)} onCreated={handleCreated} />}
      {editingAccount && <EditSubAccountDialog key={editingAccount.id} account={editingAccount} onClose={() => setEditingAccount(null)} onUpdated={handleUpdated} />}
      {deletingAccount && <DeleteSubAccountDialog key={deletingAccount.id} account={deletingAccount} onClose={() => setDeletingAccount(null)} onDeleted={handleDeleted} />}
    </section>
  );
}

function ViewRenderer({
  view,
  setView,
  user,
}: {
  view: ViewKey;
  setView: (view: ViewKey) => void;
  user: UserProfile;
}) {
  if (!canAccessView(user, view)) return null;
  if (view === 'dashboard') return <DashboardView setView={setView} />;
  if (view === 'upload') return <UploadView userId={user.user_id} />;
  if (view === 'my-channels') return <MyChannelsView />;
  if (view === 'api-access') return <ApiAccessView />;
  if (view === 'sub-accounts') return <SubAccountsView />;
  if (view === 'daily-stats') return <DailyStatsView />;
  if (view === 'settlement-history') return <SettlementHistoryView key={user.user_id} />;
  if (view === 'model-gaps') return <ModelGapsView />;
  if (view === 'announcements') return <AnnouncementManagementView />;
  if (view === 'user-mappings') return <UserMappingsView />;
  return null;
}

function SupplierApplication() {
  const { t } = useLanguage();
  const [user, setUser] = useState<UserProfile | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [activeView, setActiveView] = useState<ViewKey>('dashboard');
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authAttempt, setAuthAttempt] = useState(0);
  const [profileVerified, setProfileVerified] = useState(false);
  const authVersionRef = useRef(0);

  function resetSession() {
    authVersionRef.current += 1;
    sessionClient.reset();
    apiCacheVersion += 1;
    apiCache.clear();
    pendingApiRequests.clear();
    authRedirectPending = false;
    setAuthError(null);
    setProfileVerified(false);
  }

  useEffect(() => {
    setActiveView(viewFromPath(window.location.pathname));
    const onPop = () => setActiveView(viewFromPath(window.location.pathname));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const version = authVersionRef.current;
    const isCurrent = () => !controller.signal.aborted && version === authVersionRef.current;
    setAuthError(null);
    setProfileVerified(false);
    setAuthLoading(true);
    const cachedUser = readCachedUser();
    setUser(cachedUser);

    api<unknown>('/api/auth/profile', { fresh: true, signal: controller.signal })
      .then((profileValue) => {
        if (!isCurrent()) return;
        const nextUser = requireUserProfile(profileValue);
        cacheUser(nextUser);
        setUser(nextUser);
        setProfileVerified(true);
      })
      .catch((error) => {
        if (!isCurrent() || authRedirectPending) return;
        setProfileVerified(false);
        setUser(null);
        if (error instanceof SessionExpiredError) {
          clearCachedUser();
        } else {
          setAuthError(error instanceof ApiRequestError
            ? `${error.message} (HTTP ${error.status})${error.requestId ? ` · ${error.requestId}` : ''}`
            : error instanceof Error && error.message !== 'Invalid profile response'
              ? error.message
              : t('原 GYS 数据服务返回了无效账号信息'));
        }
      })
      .finally(() => {
        if (isCurrent() && !authRedirectPending) setAuthLoading(false);
      });
    return () => controller.abort();
  }, [authAttempt]);

  useEffect(() => {
    if (!user || !profileVerified) return;
    const nextView = canAccessView(user, activeView) ? activeView : defaultViewForUser(user);
    if (nextView !== activeView) setActiveView(nextView);
    if (window.location.pathname !== `/${nextView}`) {
      window.history.replaceState({}, '', `/${nextView}`);
    }
  }, [activeView, profileVerified, user]);

  async function logout() {
    if (isLoggingOut) return;

    resetSession();
    setIsLoggingOut(true);
    try {
      await api('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
      clearCachedUser();
      setUser(null);
      setProfileVerified(false);
      setAuthLoading(false);
      window.history.pushState({}, '', '/login');
    } finally {
      setIsLoggingOut(false);
    }
  }

  if (authLoading) {
    return (
      <main className="loading-screen">
        <Loader2 className="spin" size={30} />
        <span>{t('正在验证登录状态')}</span>
      </main>
    );
  }

  if (!user || !profileVerified) {
    if (authError) {
      return (
        <main className="loading-screen" role="alert">
          <AlertTriangle size={30} />
          <span>{t('暂时无法验证登录状态，请重试')}</span>
          <p className="auth-error-details">{t(authError)}</p>
          <ActionButton className="primary-button compact" type="button" onClick={() => setAuthAttempt((value) => value + 1)}>
            <RefreshCcw size={16} />{t('重试')}
          </ActionButton>
        </main>
      );
    }
    return (
      <LoginScreen
        onLogin={(nextUser) => {
          resetSession();
          cacheUser(nextUser);
          setUser(nextUser);
          setProfileVerified(true);
          const nextView = defaultViewForUser(nextUser);
          setActiveView(nextView);
          window.history.pushState({}, '', `/${nextView}`);
        }}
      />
    );
  }

  const effectiveView = canAccessView(user, activeView) ? activeView : defaultViewForUser(user);

  return (
    <Shell
      user={user}
      activeView={effectiveView}
      setActiveView={setActiveView}
      onLogout={logout}
      isLoggingOut={isLoggingOut}
    >
      {authError && (
        <div className="session-retry-notice" role="alert">
          <AlertTriangle size={18} />
          <span>{t('暂时无法验证登录状态，请重试')}</span>
          <span className="auth-error-details">{t(authError)}</span>
          <ActionButton className="ghost-button compact" type="button" onClick={() => setAuthAttempt((value) => value + 1)}>
            <RefreshCcw size={15} />{t('重试')}
          </ActionButton>
        </div>
      )}
      <ViewRenderer
        view={effectiveView}
        user={user}
        setView={(view) => {
          if (!canAccessView(user, view)) return;
          setActiveView(view);
          window.history.pushState({}, '', `/${view}`);
        }}
      />
    </Shell>
  );
}

export default function SupplierApp() {
  return (
    <LanguageProvider>
      <SupplierApplication />
    </LanguageProvider>
  );
}
