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

type SubAccountUsageSummary = {
  totalAmount: string;
  totalPayableAmount?: string;
  listedAmount: string | null;
  amountsDiffer: boolean;
  channelCount: number;
  tagCount: number;
  platformCount: number;
  modelCount: number;
  requestCount: number;
  queryPrefix: string;
  categories: Array<{
    category: string;
    channelCount: number;
    tagCount: number;
    modelCount: number;
    requestCount: number;
    ratePercent?: string;
    amount: string;
    settledAmount?: string;
    payableAmount?: string;
  }>;
  rows: Array<{
    category: string;
    model: string;
    channelCount: number;
    tagCount: number;
    requestCount: number;
    amount: string;
    sharePercent: string;
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

type CategoryRateResponse = {
  userId: number;
  rates: Array<{
    category: string;
    ratePercent: string;
    settledAmount: string;
  }>;
  settlementRecords: SettlementRecord[];
};

type SettlementResponse = {
  settlement: SettlementRecord;
  category: {
    category: string;
    totalAmount: string;
    settledAmount: string;
    outstandingAmount: string;
    ratePercent: string;
    payableAmount: string;
  };
};

type Notice = {
  type: 'ok' | 'warn' | 'error';
  text: string;
};

type AnnouncementItem = {
  id: number;
  title: string;
  content: string;
  published: boolean;
  createdAt: number;
  updatedAt: number;
  publishedAt: number | null;
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
  created_at: number;
  updated_at: number;
};

type AccountKind = 'primary' | 'sub';

type UserMappingListResponse = {
  items: UserMapping[];
  total: number;
};

type Language = 'zh' | 'en';

type TranslationValues = Record<string, string | number>;

const SUPER_ADMIN_USERNAME = 'sanyeAdmin';
const ALL_CHANNEL_FILTER_VALUE = '__gys_all__';

const englishTranslations: Record<string, string> = {
  '上 Key 系统': 'Key Upload System',
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
  '刷新': 'Refresh',
  '提交': 'Submit',
  '操作': 'Actions',
  '查看消耗': 'View Usage',
  '查看 {{name}} 的消耗': 'View usage for {{name}}',
  '结算': 'Settle',
  '为 {{name}} 结算': 'Settle usage for {{name}}',
  '渠道分类结算': 'Channel Category Settlement',
  '正在加载结算数据': 'Loading settlement data',
  '加载结算数据失败': 'Failed to load settlement data',
  '提交结算失败': 'Failed to submit settlement',
  '确认结算': 'Confirm Settlement',
  '结算中...': 'Settling...',
  '结算成功，本次结算金额 ${{amount}}': 'Settlement saved. Amount: ${{amount}}',
  '本次消耗额度': 'Usage to Settle',
  '可结算消耗': 'Available Usage',
  '当前汇率': 'Current Rate',
  '本次结算金额': 'Settlement Amount',
  '结算金额': 'Settlement Amount',
  '结算汇率': 'Settlement Rate',
  '结算后累计': 'Cumulative Settled',
  '请输入有效的结算消耗额度': 'Enter a valid usage amount to settle',
  '结算消耗额度不能超过可结算额度': 'Usage to settle cannot exceed the available amount',
  '本次结算金额 = 消耗额度 × 结算汇率。': 'Settlement amount = usage amount × settlement rate.',
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
  '100% 为原始消耗金额；设置后，“查看消耗”中的分类及模型金额会按此比例计算。': '100% keeps the original usage amount. Category and model amounts in View Usage are multiplied by this rate.',
  '应付 =（总消耗 - 已结算）× 汇率。': 'Payable = (total usage - settled) × rate.',
  '平台模型消耗': 'Platform & Model Usage',
  '消耗总量': 'Total Usage',
  '涉及平台': 'Platforms',
  '模型统计': 'Model Groups',
  '匹配标签': 'Matching Tags',
  '渠道记录': 'Channel Records',
  '请求记录': 'Requests',
  '全部分类': 'All Categories',
  '渠道分类模型消耗': 'Model Usage by Channel Category',
  '渠道分类总消耗': 'Total Usage by Channel Category',
  '总消耗': 'Total Usage',
  '已结算': 'Settled',
  '应付': 'Payable',
  '总应付': 'Total Payable',
  '已结算金额': 'Settled Amount',
  '结算记录': 'Settlement History',
  '暂无结算记录': 'No settlement history',
  '结算时间': 'Settlement Time',
  '变更前': 'Before',
  '变更后': 'After',
  '变更金额': 'Change',
  '保存时汇率': 'Rate at Save',
  '消耗额度': 'Usage Amount',
  '渠道分类': 'Channel Category',
  '涉及分类': 'Categories',
  '未归属模型': 'Unattributed Model',
  '该分类暂无模型消耗': 'No model usage in this category',
  '查询标签前缀：{{prefix}}*': 'Tag prefix: {{prefix}}*',
  '平台': 'Platform',
  '全部模型': 'All Models',
  '加载子账号消耗失败': 'Failed to load sub-account usage',
  '正在按分类读取全部模型消耗': 'Loading model usage by category',
  '正在读取渠道分类总消耗': 'Loading total usage by channel category',
  '该用户暂无匹配标签的渠道消耗': 'No channel usage matches this user’s tags',
  '子账号列表额度为 {{amount}}，与标签查询合计不同。': 'The sub-account list shows {{amount}}, which differs from the tag-based total.',
  '统计口径：标签前缀 {{prefix}}* 仅用于定位用户渠道；分类以原站渠道记录为准，再按实际模型汇总消费日志。': 'Source: the {{prefix}}* tag prefix only locates user channels; categories come from the original channel records, with usage logs grouped by actual model.',
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
  '管理本站用户名与 GYS 用户名的映射关系。': 'Manage mappings between site usernames and GYS usernames.',
  '新增映射': 'Add Mapping',
  '新增用户映射': 'Add User Mapping',
  '编辑用户映射': 'Edit User Mapping',
  '正在加载用户映射': 'Loading user mappings',
  '加载用户映射失败': 'Failed to load user mappings',
  '用户映射创建成功': 'User mapping created successfully',
  '用户映射更新成功': 'User mapping updated successfully',
  '创建用户映射失败': 'Failed to create the user mapping',
  '更新用户映射失败': 'Failed to update the user mapping',
  '暂无用户映射': 'No User Mappings',
  '点击“新增映射”创建第一条用户映射。': 'Click “Add Mapping” to create the first user mapping.',
  '账号类型': 'Account Type',
  '主账号': 'Primary Account',
  '子账号 ID': 'Sub-account ID',
  '子账号 ID 必须为正整数': 'Sub-account ID must be a positive integer',
  '上游用户 ID': 'Upstream User ID',
  '更新时间': 'Updated At',
  '启用映射': 'Enable mapping',
  '启用后，用户可以使用本站用户名登录。': 'When enabled, the user can sign in with the site username.',
  '保存映射': 'Save Mapping',
  '请输入有效的显示名': 'Enter a valid display name',
  '当前账号无权限管理子账号': 'This account cannot manage sub-accounts',
  '管理子账号。': 'Manage sub-accounts.',
  '管理子账号及其平台模型消耗。': 'Manage sub-accounts and their platform/model usage.',
  '正在检查权限': 'Checking permissions',
  '新增子账号': 'Add Sub-account',
  '创建子账号': 'Create Sub-account',
  '创建中...': 'Creating...',
  '子账号创建成功': 'Sub-account created successfully',
  '子账号创建成功；需由超级管理员创建并启用映射后才能登录。': 'Sub-account created. A super administrator must create and enable its mapping before it can sign in.',
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
  '本站用户名': 'Site Username',
  'GYS用户名': 'GYS Username',
  '未映射': 'Not mapped',
  '本站登录用户名': 'Username for this site',
  'GYS登录用户名': 'Username on GYS',
  '本站用户名须为3至64位字母、数字、点、横线或下划线': 'Use 3–64 letters, numbers, dots, hyphens, or underscores',
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
];
const subAccountViewOrder: ViewKey[] = ['model-gaps', 'dashboard', 'upload', 'my-channels', 'daily-stats'];
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
              <button className="ghost-button compact" onClick={clearRange} type="button">
                {t('清除')}
              </button>
            )}
          </div>
          <div className="app-date-picker-action-group">
            <button className="ghost-button compact" onClick={() => setOpen(false)} type="button">
              {t('取消')}
            </button>
            <button
              className="primary-button compact"
              disabled={!draftRange?.from && !draftRange?.to}
              onClick={applyRange}
              type="button"
            >
              {t('确定')}
            </button>
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
  if (!notice) return null;
  return (
    <div className={`notice notice-${notice.type}`}>
      {notice.type === 'ok' ? (
        <CheckCircle2 size={18} />
      ) : (
        <AlertTriangle size={18} />
      )}
      <span>{notice.text}</span>
    </div>
  );
}

function LoginScreen({ onLogin }: { onLogin: (user: UserProfile) => void }) {
  const { language, setLanguage } = useLanguage();
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
          title: '上 Key 系统',
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
          title: 'Key Upload System',
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
      <section className="login-card">
        <div className="login-language-row">
          <div className="login-language-switch" aria-label="Language" role="group">
            <button
              aria-pressed={language === 'zh'}
              className={language === 'zh' ? 'active' : ''}
              onClick={() => setLanguage('zh')}
              type="button"
            >
              中文
            </button>
            <button
              aria-pressed={language === 'en'}
              className={language === 'en' ? 'active' : ''}
              onClick={() => setLanguage('en')}
              type="button"
            >
              English
            </button>
          </div>
        </div>
        <h1>{copy.title}</h1>
        <form onSubmit={submit} className="login-form" noValidate>
          <div className="login-form-item">
            <div className={fieldErrors.username ? 'login-input login-input-error' : 'login-input'}>
              <User size={17} />
              <input
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
            <div className={fieldErrors.password ? 'login-input login-input-error' : 'login-input'}>
              <LockKeyhole size={17} />
              <input
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
          <button className="login-submit-button" disabled={loading} type="submit">
            {loading && <Loader2 className="spin" size={17} />}
            {copy.submit}
          </button>
        </form>
      </section>
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
                {activeAnnouncement?.title || t('公告通知')}
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
                <h2>{activeAnnouncement.title}</h2>
                <time dateTime={new Date(activeAnnouncement.publishedAt || activeAnnouncement.createdAt).toISOString()}>
                  {formatBeijingDateTime(activeAnnouncement.publishedAt || activeAnnouncement.createdAt, language)}
                </time>
              </header>
              <p>{activeAnnouncement.content}</p>
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
              <button className="ghost-button compact" onClick={() => load()} type="button">
                <RefreshCcw size={15} />{t('重试')}
              </button>
            </div>
          ) : items.length ? (
            <div className="announcement-dialog-list">
              {items.map(item => (
                <article className="announcement-dialog-item" key={item.id}>
                  <div className="announcement-dialog-item-heading">
                    <h3>{item.title}</h3>
                    <time dateTime={new Date(item.publishedAt || item.createdAt).toISOString()}>
                      {formatBeijingDateTime(item.publishedAt || item.createdAt, language)}
                    </time>
                  </div>
                  <p className="announcement-dialog-item-content">{item.content}</p>
                </article>
              ))}
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
            <button className="ghost-button compact" onClick={hideForToday} type="button">
              {t('今日关闭')}
            </button>
            <button className="primary-button compact announcement-dismiss-button" onClick={dismissAnnouncement} type="button">
              {t('关闭公告')}
            </button>
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
                <button
                  className="ghost-button"
                  disabled={changingPassword}
                  onClick={() => setPasswordDialogOpen(false)}
                  type="button"
                >
                  {t('取消')}
                </button>
                <button className="primary-button compact" disabled={changingPassword} type="submit">
                  {changingPassword && <Loader2 className="spin" size={16} />}
                  {t('确定')}
                </button>
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
          <button className="ghost-button compact" onClick={() => void load(true)} type="button">
            <RefreshCcw size={15} />
            {t('重新加载')}
          </button>
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
            <div className="upload-category-grid">
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
                          {models.map((model) => (
                            <button
                              className={selectedModels.includes(model) ? 'chip selected' : 'chip'}
                              key={model}
                              onClick={() => toggleModel(model)}
                              type="button"
                            >
                              {model}
                            </button>
                          ))}
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
            <button
              className="primary-button upload-submit-button"
              disabled={submitting || !parsedKeys.length || (mode === 'single' && category === 'aws_a' && !baseUrl.trim())}
              type="submit"
            >
              {submitting ? <Loader2 className="spin" size={17} /> : <UploadCloud size={17} />}
              {standby ? t('入库存') : mode === 'batch' ? t('批量提交') : t('提交密钥')}
            </button>
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
    setLoading(true);
    setNotice(null);

    try {
      if (viewMode === 'group') {
        const groupParams = new URLSearchParams({
          page: String(groupPage),
          page_size: String(pageSize),
        });
        applyCommonFilters(groupParams);
        const summaryParams = new URLSearchParams();
        applyCommonFilters(summaryParams);
        const summaryQuery = summaryParams.toString();
        const [summaryData, tagData, groupData] = await Promise.all([
          api<ChannelSummary>(`/api/channels/summary${summaryQuery ? `?${summaryQuery}` : ''}`, { fresh }),
          api<string[]>('/api/channels/tags', { fresh }),
          api<{ items?: ChannelGroupSummary[]; total?: number; total_groups?: number }>(
            `/api/channels/tag-summary?${groupParams.toString()}`,
            { fresh },
          ),
        ]);
        setSummary(summaryData);
        setTags(tagData);
        setGroups(groupData.items || []);
        setGroupTotal(groupData.total ?? groupData.total_groups ?? groupData.items?.length ?? 0);
      } else {
        const params = new URLSearchParams({ page: String(listPage), page_size: String(pageSize) });
        applyListFilters(params);
        const summaryParams = new URLSearchParams();
        applyListFilters(summaryParams);
        const summaryQuery = summaryParams.toString();
        const [summaryData, tagData, listData] = await Promise.all([
          api<ChannelSummary>(`/api/channels/summary${summaryQuery ? `?${summaryQuery}` : ''}`, { fresh }),
          api<string[]>('/api/channels/tags', { fresh }),
          api<ChannelListData>(`/api/channels?${params.toString()}`, { fresh }),
        ]);
        setSummary(summaryData);
        setTags(tagData);
        setItems(listData.items || []);
        setListTotal(listData.total || 0);
      }
    } catch (error) {
      setNotice({
        type: 'error',
        text: error instanceof Error ? error.message : t('加载渠道失败'),
      });
    } finally {
      setLoading(false);
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
          <strong>{formatQuota(summary.total_quota)}</strong>
        </article>
      </div>

      <div className="my-channels-titlebar">
        <h1>{t('我的渠道')}</h1>
        <div className="my-channels-actions">
          <button className="primary-button compact" disabled={syncing} onClick={syncUsage} type="button">
            <RefreshCcw className={syncing ? 'spin' : ''} size={15} />
            {syncing ? t('同步中...') : t('同步用量')}
          </button>
          <button className="ghost-button compact" disabled={loading} onClick={() => load(true)} type="button">
            <RefreshCcw className={loading ? 'spin' : ''} size={15} />
            {t('刷新')}
          </button>
          <button className="ghost-button compact" onClick={openDisableKeywords} type="button">
            <AlertTriangle size={15} />
            {t('建议禁用词')}
          </button>
        </div>
      </div>

      <div className="my-channel-filters">
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
        <Select
          value={category || ALL_CHANNEL_FILTER_VALUE}
          onValueChange={(value) => {
            setCategory(value && value !== ALL_CHANNEL_FILTER_VALUE ? value : '');
            setGroupPage(1);
            setListPage(1);
            setExpandedTags([]);
            setGroupDetails({});
            setDetailLoading({});
          }}
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
            <Select
              value={status || ALL_CHANNEL_FILTER_VALUE}
              onValueChange={(value) => {
                setStatus(value && value !== ALL_CHANNEL_FILTER_VALUE ? value : '');
                setListPage(1);
              }}
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
            <Select
              value={tag || ALL_CHANNEL_FILTER_VALUE}
              onValueChange={(value) => {
                setTag(value && value !== ALL_CHANNEL_FILTER_VALUE ? value : '');
                setListPage(1);
              }}
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
                          <button className="my-channel-manage-button" onClick={() => manageGroup(group)} type="button">
                            {t('在列表中管理')}
                          </button>
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
                        <button
                          disabled={rowAction?.id === item.id}
                          onClick={() => openChannelTest(item)}
                          type="button"
                        >
                          <Activity size={13} />
                          {t('测试')}
                        </button>
                        {item.status !== 0 && (
                          <button
                            className={item.status === 1 ? '' : 'enable'}
                            disabled={rowAction?.id === item.id}
                            onClick={() => requestChannelStatusChange(item)}
                            type="button"
                          >
                            {rowAction?.id === item.id && rowAction.type === 'status'
                              ? <Loader2 className="spin" size={13} />
                              : item.status === 1 ? <XCircle size={13} /> : <CheckCircle2 size={13} />}
                            {item.status === 1 ? t('停用') : t('启用')}
                          </button>
                        )}
                        {item.status === 0 ? (
                          <Badge tone="neutral">{t('已删除')}</Badge>
                        ) : (
                          <button
                            className="danger"
                            disabled={rowAction?.id === item.id}
                            onClick={() => requestChannelDelete(item)}
                            type="button"
                          >
                            {rowAction?.id === item.id && rowAction.type === 'delete'
                              ? <Loader2 className="spin" size={13} />
                              : <Trash2 size={13} />}
                            {t('删除')}
                          </button>
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
              <button
                className="ghost-button"
                disabled={channelConfirmationBusy}
                onClick={closeChannelConfirmation}
                type="button"
              >
                {t('取消')}
              </button>
              <button
                className={`channel-confirm-submit ${channelConfirmation.type === 'delete' ? 'danger' : ''}`}
                disabled={channelConfirmationBusy}
                onClick={confirmChannelAction}
                type="button"
              >
                {channelConfirmationBusy && <Loader2 className="spin" size={15} />}
                {channelConfirmationBusy ? t('处理中...') : t('确定')}
              </button>
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
                <button
                  className="primary-button channel-test-action"
                  disabled={testLoading || !testModel}
                  onClick={testSelectedModel}
                  type="button"
                >
                  {testLoading && !testProgress && <Loader2 className="spin" size={15} />}
                  {t('测试该模型')}
                </button>
                <button
                  className="ghost-button channel-test-action"
                  disabled={testLoading || !testModels.length}
                  onClick={testAllModels}
                  type="button"
                >
                  {testLoading && testProgress
                    ? <Loader2 className="spin" size={15} />
                    : <Zap size={15} />}
                  {t('测试全部模型（{{count}}）', { count: testModels.length })}
                </button>
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
              <button className="ghost-button" disabled={testLoading} onClick={closeChannelTest} type="button">{t('关闭')}</button>
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
              <button className="primary-button compact" disabled={keywordSaving} type="submit">
                {keywordSaving && <Loader2 className="spin" size={15} />}
                {t('提交')}
              </button>
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
            <button className="text-button" onClick={() => load(true)} type="button">
              <RefreshCcw size={16} />
              {t('刷新')}
            </button>
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
            <button className="primary-button compact" type="submit">
              <Plus size={17} />
              {t('创建密钥')}
            </button>
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
  const [accountKind, setAccountKind] = useState<AccountKind>(
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
      setError(t('本站用户名须为3至64位字母、数字、点、横线或下划线'));
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
      accountKind === 'sub'
      && (!/^[1-9]\d*$/.test(upstreamUserId.trim()) || !Number.isSafeInteger(nextUpstreamUserId))
    ) {
      setError(t('子账号 ID 必须为正整数'));
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
            upstream_user_id: accountKind === 'sub' ? nextUpstreamUserId : null,
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
                {t('管理本站用户名与 GYS 用户名的映射关系。')}
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
                disabled={saving}
                onValueChange={value => {
                  if (value === 'primary' || value === 'sub') {
                    setAccountKind(value);
                    if (value === 'primary') setUpstreamUserId('');
                  }
                }}
                value={accountKind}
              >
                <SelectTrigger aria-label={t('账号类型')} className="user-mapping-select">
                  <SelectValue>{t(accountKind === 'sub' ? '子账号' : '主账号')}</SelectValue>
                </SelectTrigger>
                <SelectContent align="start" alignItemWithTrigger={false}>
                  <SelectItem value="primary">{t('主账号')}</SelectItem>
                  <SelectItem value="sub">{t('子账号')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {accountKind === 'sub' && (
              <label className="user-mapping-field">
                <span>{t('子账号 ID')}</span>
                <input
                  autoComplete="off"
                  disabled={saving}
                  inputMode="numeric"
                  min={1}
                  onChange={event => setUpstreamUserId(event.target.value)}
                  placeholder={t('上游用户 ID')}
                  required
                  step={1}
                  type="number"
                  value={upstreamUserId}
                />
              </label>
            )}
            <label className="user-mapping-field">
              <span>{t('本站用户名')}</span>
              <input
                autoComplete="off"
                autoFocus
                disabled={saving}
                maxLength={64}
                minLength={3}
                onChange={event => setPublicUsername(event.target.value)}
                pattern="[A-Za-z0-9_.-]{3,64}"
                placeholder={t('本站登录用户名')}
                required
                value={publicUsername}
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
            {editing && (
              <div className="user-mapping-status-row">
                <div>
                  <strong id="user-mapping-active-label">{t('启用映射')}</strong>
                  <span id="user-mapping-active-description">{t('启用后，用户可以使用本站用户名登录。')}</span>
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
            <button className="ghost-button" disabled={saving} onClick={onClose} type="button">
              {t('取消')}
            </button>
            <button className="primary-button compact" disabled={saving} type="submit">
              {saving && <Loader2 className="spin" size={16} />}
              {t(saving ? '保存中...' : '保存映射')}
            </button>
          </div>
        </form>
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

  const load = useCallback(async (fresh = false) => {
    setLoading(true);
    setNotice(null);
    try {
      const data = await api<UserMappingListResponse>('/api/user-mappings', { fresh });
      setItems(data.items || []);
    } catch (failure) {
      setNotice({
        type: 'error',
        text: failure instanceof Error ? failure.message : t('加载用户映射失败'),
      });
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

  return (
    <section className="user-mappings-page">
      <PageHeading
        action={(
          <div className="action-row">
            <button className="ghost-button compact" onClick={() => void load(true)} type="button">
              <RefreshCcw size={17} />
              {t('刷新')}
            </button>
            <button className="primary-button compact" onClick={() => setCreateOpen(true)} type="button">
              <Plus size={17} />
              {t('新增映射')}
            </button>
          </div>
        )}
        icon={Users}
        subtitle={t('管理本站用户名与 GYS 用户名的映射关系。')}
        title={t('用户映射')}
      />
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
                  <th>{t('本站用户名')}</th>
                  <th>{t('GYS用户名')}</th>
                  <th>{t('显示名')}</th>
                  <th>{t('账号类型')}</th>
                  <th>{t('状态')}</th>
                  <th>{t('更新时间')}</th>
                  <th>{t('操作')}</th>
                </tr>
              </thead>
              <tbody>
                {items.map(item => (
                  <tr key={item.public_username}>
                    <td><code className="user-mapping-user-id">{item.upstream_user_id ?? '-'}</code></td>
                    <td><strong>{item.public_username}</strong></td>
                    <td><code>{item.upstream_username}</code></td>
                    <td>{item.display_name || '-'}</td>
                    <td>
                      <Badge tone={item.account_kind === 'primary' ? 'blue' : item.account_kind === 'sub' ? 'purple' : 'neutral'}>
                        {item.account_kind === 'primary'
                          ? t('主账号')
                          : item.account_kind === 'sub'
                            ? t('子账号')
                            : item.account_kind}
                      </Badge>
                    </td>
                    <td><Badge tone={item.active ? 'green' : 'red'}>{t(item.active ? '启用' : '停用')}</Badge></td>
                    <td>{formatBeijingDateTime(item.updated_at, language)}</td>
                    <td>
                      <button
                        aria-label={t('编辑 {{name}}', { name: item.public_username })}
                        className="user-mapping-edit-button"
                        onClick={() => setEditingMapping(item)}
                        type="button"
                      >
                        <Pencil size={14} />
                        {t('编辑')}
                      </button>
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
      <PageHeading
        icon={Zap}
        title={t('模型缺口')}
        subtitle={t('当前模型供应缺口。')}
        action={
          <div className="action-row model-gap-actions">
            <button className="ghost-button" onClick={copyReport} type="button">
              <ClipboardCopy size={17} />
              {t('复制通知')}
            </button>
            <button
              className="primary-button compact"
              disabled={loading || refreshing}
              onClick={() => void load(true)}
              type="button"
            >
              <RefreshCcw className={loading || refreshing ? 'spin' : undefined} size={17} />
              {t('刷新')}
            </button>
          </div>
        }
      />
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
    if (!nextTitle || !nextContent || publishing) return;

    setPublishing(true);
    setPublishError('');
    setNotice(null);
    try {
      await api<AnnouncementItem>('/api/announcement-management', {
        method: 'POST',
        body: { title: nextTitle, content: nextContent },
      });
      setTitle('');
      setContent('');
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
      <PageHeading
        icon={Megaphone}
        title={t('公告管理')}
        subtitle={t('发布和管理站内公告。')}
        action={
          <div className="announcement-heading-actions">
            <button className="ghost-button compact" disabled={loading} onClick={() => load(true)} type="button">
              <RefreshCcw className={loading ? 'spin' : ''} size={17} />
              {t('刷新')}
            </button>
            <button
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
            </button>
          </div>
        }
      />
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
            {items.map(item => (
              <article className="announcement-management-item" key={item.id}>
                <header>
                  <h3>{item.title}</h3>
                  <Badge tone={item.published ? 'green' : 'neutral'}>
                    {t(item.published ? '已发布' : '已下架')}
                  </Badge>
                </header>
                <p>{item.content}</p>
                <footer>
                  <div className="announcement-management-actions">
                    <button
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
                    </button>
                    <button
                      className="danger-button compact"
                      disabled={busyId !== null}
                      onClick={() => openDelete(item)}
                      type="button"
                    >
                      <Trash2 size={15} />{t('删除')}
                    </button>
                  </div>
                </footer>
              </article>
            ))}
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
              <DialogDescription>{t('填写公告内容，发布后会显示在顶部通知中。')}</DialogDescription>
            </DialogHeader>
            <DialogClose aria-label={t('关闭')} className="announcement-compose-close" disabled={publishing}>
              <X size={18} />
            </DialogClose>
          </div>
          <form aria-busy={publishing} className="announcement-compose-form" onSubmit={publish}>
            <label>
              <span className="announcement-field-heading">
                <span>{t('公告标题')}</span>
                <small>{title.length}/120 {t('字符')}</small>
              </span>
              <input
                autoFocus
                maxLength={120}
                onChange={event => setTitle(event.target.value)}
                placeholder={t('请输入公告标题')}
                required
                value={title}
              />
            </label>
            <label>
              <span className="announcement-field-heading">
                <span>{t('公告内容')}</span>
                <small>{content.length}/5000 {t('字符')}</small>
              </span>
              <textarea
                maxLength={5000}
                onChange={event => setContent(event.target.value)}
                placeholder={t('请输入公告内容')}
                required
                rows={9}
                value={content}
              />
            </label>
            {publishError && <p className="announcement-publish-error" role="alert">{publishError}</p>}
            <div className="announcement-compose-actions">
              <button
                className="ghost-button compact"
                disabled={publishing}
                onClick={closeCompose}
                type="button"
              >
                {t('取消')}
              </button>
              <button
                className="primary-button compact announcement-publish-button"
                disabled={publishing || !title.trim() || !content.trim()}
                type="submit"
              >
                {publishing ? <Loader2 className="spin" size={16} /> : <Megaphone size={16} />}
                {t(publishing ? '发布中...' : '发布公告')}
              </button>
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
                ? t('确定删除公告“{{title}}”吗？删除后无法恢复。', { title: pendingDelete.title })
                : ''}
            </DialogDescription>
          </DialogHeader>
          {deleteError && <p className="account-dialog-error" role="alert">{deleteError}</p>}
          <div className="announcement-delete-actions">
            <button className="ghost-button compact" disabled={deleting} onClick={() => setPendingDelete(null)} type="button">
              {t('取消')}
            </button>
            <button className="danger-button compact solid" disabled={deleting} onClick={removeAnnouncement} type="button">
              {deleting && <Loader2 className="spin" size={15} />}
              {t(deleting ? '正在删除...' : '删除')}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function SubAccountUsageDialog({
  account,
  onClose,
}: {
  account: SubAccount;
  onClose: () => void;
}) {
  const { language, t } = useLanguage();
  const [attempt, setAttempt] = useState(0);
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<SubAccountUsageSummary | null>(null);
  const [error, setError] = useState('');
  const [categoryFilter, setCategoryFilter] = useState(channelUsageCategories[0]);
  const categoryOptions = useMemo(() => channelUsageCategories.map((category) => ({
    key: category,
    name: categoryLabel(category, language),
    color: dashboardCategoryColor(category),
    stats: summary?.categories.find((item) => item.category === category),
  })), [language, summary]);
  const selectedCategory = categoryOptions.find((category) => category.key === categoryFilter);
  const visibleRows = useMemo(() => {
    if (!summary || !selectedCategory) return summary?.rows || [];
    const categoryTotal = Number(selectedCategory.stats?.amount || 0);
    return summary.rows
      .filter((row) => row.category === selectedCategory.key)
      .map((row) => ({
        ...row,
        sharePercent: categoryTotal > 0
          ? (Number(row.amount) / categoryTotal * 100).toFixed(2)
          : '0.00',
      }));
  }, [selectedCategory, summary]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setSummary(null);
    setError('');
    api<SubAccountUsageSummary>(`/api/sub-accounts/${account.id}/tag-usage`, {
      fresh: true,
      signal: controller.signal,
    })
      .then((value) => {
        if (!controller.signal.aborted) {
          setSummary(value);
        }
      })
      .catch((failure) => {
        if (!controller.signal.aborted) {
          setError(failure instanceof Error ? failure.message : t('加载子账号消耗失败'));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [account.id, attempt, t]);

  return (
    <div
      className="dialog-backdrop sub-account-usage-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      role="presentation"
    >
      <section
        aria-labelledby="sub-account-usage-title"
        aria-modal="true"
        className="sub-account-usage-dialog"
        role="dialog"
      >
        <header className="sub-account-usage-header">
          <div>
            <h2 id="sub-account-usage-title"><BarChart3 size={20} />{t('渠道分类总消耗')}</h2>
          </div>
          <div className="sub-account-usage-tools">
            <button
              aria-label={t('刷新')}
              disabled={loading}
              onClick={() => setAttempt((value) => value + 1)}
              title={t('刷新')}
              type="button"
            >
              <RefreshCcw className={loading ? 'spin' : ''} size={17} />
            </button>
            <button aria-label={t('关闭')} onClick={onClose} title={t('关闭')} type="button"><X size={19} /></button>
          </div>
        </header>
        <div aria-busy={loading} className="sub-account-usage-body">
          {loading ? (
            <div className="sub-account-usage-state" role="status">
              <Loader2 className="spin" size={25} />
              <span>{t('正在读取渠道分类总消耗')}</span>
            </div>
          ) : error ? (
            <div className="sub-account-usage-state error" role="alert">
              <AlertTriangle size={25} />
              <p>{error}</p>
              <button className="ghost-button compact" onClick={() => setAttempt((value) => value + 1)} type="button">
                <RefreshCcw size={15} />{t('重试')}
              </button>
            </div>
          ) : summary && (
            <>
              <p className="sub-account-usage-category-title">{t('渠道分类总消耗')}</p>
              <div className="sub-account-usage-categories" aria-label={t('渠道分类总消耗')} role="group">
                {categoryOptions.map((category) => (
                  <button
                    className={categoryFilter === category.key ? 'active' : ''}
                    key={category.key}
                    onClick={() => setCategoryFilter(category.key)}
                    style={{ '--category-color': category.color } as CSSProperties}
                    type="button"
                  >
                    <span className="sub-account-usage-category-letter">{category.name[0]}</span>
                    <strong>{category.name}</strong>
                    <span className="sub-account-usage-financials">
                      <small className="total">{t('总消耗')} ${category.stats?.amount || '0.0000'}</small>
                      <small className="settled">{t('已结算')} ${category.stats?.settledAmount || '0.0000'}</small>
                      <small className="payable">{t('应付')} ${category.stats?.payableAmount || '0.0000'}</small>
                    </span>
                  </button>
                ))}
              </div>
              {visibleRows.length > 0 && (
                <div className="table-wrap">
                  <table className="sub-account-usage-table">
                    <thead>
                      <tr>
                        <th>{t('渠道分类')}</th>
                        <th>{t('模型')}</th>
                        <th>{t('匹配标签')}</th>
                        <th>{t('渠道记录')}</th>
                        <th>{t('请求记录')}</th>
                        <th>{t('消耗总量')}</th>
                        <th>{t('占比')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleRows.map((row) => (
                        <tr key={`${row.category}-${row.model}`}>
                          <td>{row.category ? categoryLabel(row.category, language) : '-'}</td>
                          <td><code>{row.model || t('未归属模型')}</code></td>
                          <td>{formatInteger(row.tagCount)}</td>
                          <td>{formatInteger(row.channelCount)}</td>
                          <td>{formatInteger(row.requestCount)}</td>
                          <td className="sub-account-usage-amount">${row.amount}</td>
                          <td>
                            <span className="sub-account-usage-share">
                              <i aria-hidden="true"><b style={{ width: `${row.sharePercent}%` }} /></i>
                              {row.sharePercent}%
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
        <footer className="sub-account-usage-footer">
          {summary && (
            <strong className="sub-account-total-payable">
              {t('总应付')}：<span>${summary.totalPayableAmount || '0.0000'}</span>
            </strong>
          )}
          <button className="ghost-button compact" onClick={onClose} type="button">{t('关闭')}</button>
        </footer>
      </section>
    </div>
  );
}

function SubAccountSettlementDialog({
  account,
  onClose,
}: {
  account: SubAccount;
  onClose: () => void;
}) {
  const { language, t } = useLanguage();
  const [attempt, setAttempt] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [summary, setSummary] = useState<SubAccountUsageSummary | null>(null);
  const [records, setRecords] = useState<SettlementRecord[]>([]);
  const [category, setCategory] = useState(channelUsageCategories[0]);
  const [consumptionAmount, setConsumptionAmount] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const categoryStats = useMemo(
    () => summary?.categories.find((item) => item.category === category),
    [category, summary],
  );
  const totalAmount = Number(categoryStats?.amount || 0);
  const settledAmount = Number(categoryStats?.settledAmount || 0);
  const availableAmount = Math.max(0, totalAmount - settledAmount);
  const ratePercent = Number(categoryStats?.ratePercent || 100);
  const settlementAmount = Math.max(0, Number(consumptionAmount) || 0) * ratePercent / 100;
  const visibleRecords = useMemo(
    () => records.filter((record) => record.category === category),
    [category, records],
  );

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    setNotice('');
    Promise.all([
      api<SubAccountUsageSummary>(`/api/sub-accounts/${account.id}/tag-usage`, {
        fresh: true,
        signal: controller.signal,
      }),
      api<CategoryRateResponse>(`/api/sub-accounts/${account.id}/category-rates`, {
        fresh: true,
        signal: controller.signal,
      }),
    ])
      .then(([usage, rateData]) => {
        if (controller.signal.aborted) return;
        setSummary(usage);
        setRecords(rateData.settlementRecords || []);
      })
      .catch((failure) => {
        if (!controller.signal.aborted) {
          setError(failure instanceof Error ? failure.message : t('加载结算数据失败'));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [account.id, attempt, t]);

  useEffect(() => {
    if (!summary) return;
    setConsumptionAmount(availableAmount.toFixed(4));
    setError('');
  }, [availableAmount, category, summary]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const amount = Number(consumptionAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setError(t('请输入有效的结算消耗额度'));
      return;
    }
    if (amount > availableAmount + 0.0000001) {
      setError(t('结算消耗额度不能超过可结算额度'));
      return;
    }
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const result = await api<SettlementResponse>(`/api/sub-accounts/${account.id}/settlements`, {
        method: 'POST',
        body: { category, consumptionAmount },
      });
      setRecords((current) => [result.settlement, ...current]);
      setSummary((current) => {
        if (!current) return current;
        const categories = current.categories.map((item) => item.category === category ? {
          ...item,
          amount: result.category.totalAmount,
          settledAmount: result.category.settledAmount,
          ratePercent: result.category.ratePercent,
          payableAmount: result.category.payableAmount,
        } : item);
        return {
          ...current,
          categories,
          totalPayableAmount: categories.reduce(
            (total, item) => total + Number(item.payableAmount || 0),
            0,
          ).toFixed(4),
        };
      });
      setConsumptionAmount(result.category.outstandingAmount);
      setNotice(t('结算成功，本次结算金额 ${{amount}}', {
        amount: result.settlement.settlementAmount,
      }));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t('提交结算失败'));
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
        aria-labelledby="sub-account-settlement-title"
        aria-modal="true"
        className="account-dialog sub-account-settlement-dialog"
        role="dialog"
      >
        <div className="account-dialog-header sub-account-rate-header">
          <div>
            <h2 id="sub-account-settlement-title"><CheckCircle2 size={20} />{t('渠道分类结算')}</h2>
          </div>
          <div className="sub-account-usage-tools">
            <button
              aria-label={t('刷新')}
              disabled={loading || saving}
              onClick={() => setAttempt((value) => value + 1)}
              title={t('刷新')}
              type="button"
            >
              <RefreshCcw className={loading ? 'spin' : ''} size={17} />
            </button>
            <button aria-label={t('关闭')} disabled={saving} onClick={onClose} title={t('关闭')} type="button">
              <X size={19} />
            </button>
          </div>
        </div>
        {loading ? (
          <div className="sub-account-rate-loading" role="status">
            <Loader2 className="spin" size={22} />{t('正在加载结算数据')}
          </div>
        ) : !summary ? (
          <div className="sub-account-rate-loading error" role="alert">
            <AlertTriangle size={22} />{error || t('加载结算数据失败')}
          </div>
        ) : (
          <form onSubmit={submit}>
            <label className="sub-account-settlement-category">
              <span>{t('渠道分类')}</span>
              <select
                disabled={saving}
                onChange={(event) => {
                  setCategory(event.target.value);
                  setNotice('');
                }}
                value={category}
              >
                {channelUsageCategories.map((item) => (
                  <option key={item} value={item}>{categoryLabel(item, language)}</option>
                ))}
              </select>
            </label>
            <div className="sub-account-settlement-summary">
              <span><small>{t('总消耗')}</small><strong>${categoryStats?.amount || '0.0000'}</strong></span>
              <span><small>{t('已结算')}</small><strong>${categoryStats?.settledAmount || '0.0000'}</strong></span>
              <span><small>{t('可结算消耗')}</small><strong>${availableAmount.toFixed(4)}</strong></span>
              <span><small>{t('当前汇率')}</small><strong>{categoryStats?.ratePercent || '100'}%</strong></span>
            </div>
            <div className="sub-account-settlement-calculation">
              <label>
                <span>{t('本次消耗额度')}</span>
                <span className="sub-account-rate-input prefix">
                  <input
                    disabled={saving || availableAmount <= 0}
                    inputMode="decimal"
                    max={availableAmount.toFixed(4)}
                    min="0.0001"
                    onChange={(event) => setConsumptionAmount(event.target.value)}
                    required
                    step="0.0001"
                    type="number"
                    value={consumptionAmount}
                  />
                  <b>$</b>
                </span>
              </label>
              <span className="sub-account-settlement-result">
                <small>{t('本次结算金额')}</small>
                <strong>${settlementAmount.toFixed(4)}</strong>
              </span>
            </div>
            <p className="sub-account-rate-hint">{t('本次结算金额 = 消耗额度 × 结算汇率。')}</p>
            {notice && <p className="sub-account-settlement-notice" role="status"><CheckCircle2 size={16} />{notice}</p>}
            {error && <p className="account-dialog-error" role="alert">{error}</p>}
            <section className="sub-account-settlement-history">
              <h3>{t('结算记录')}</h3>
              {visibleRecords.length > 0 ? (
                <div className="table-wrap sub-account-settlement-history-table-wrap">
                  <table className="sub-account-settlement-history-table">
                    <thead>
                      <tr>
                        <th>{t('结算时间')}</th>
                        <th>{t('消耗额度')}</th>
                        <th>{t('结算汇率')}</th>
                        <th>{t('结算金额')}</th>
                        <th>{t('结算后累计')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleRecords.map((record) => (
                        <tr key={record.id}>
                          <td>{formatBeijingDateTime(record.createdAt, language)}</td>
                          <td>${record.consumptionAmount}</td>
                          <td>{record.ratePercent}%</td>
                          <td className={Number(record.settlementAmount) < 0 ? 'negative' : 'positive'}>
                            ${record.settlementAmount}
                          </td>
                          <td>${record.settledAmount}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="sub-account-settlement-history-empty">{t('暂无结算记录')}</p>
              )}
            </section>
            <div className="account-dialog-actions">
              <button className="ghost-button" disabled={saving} onClick={onClose} type="button">{t('关闭')}</button>
              <button className="primary-button compact" disabled={saving || availableAmount <= 0} type="submit">
                {saving && <Loader2 className="spin" size={16} />}
                {t(saving ? '结算中...' : '确认结算')}
              </button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}

function SubAccountRateDialog({
  account,
  onClose,
  onSaved,
}: {
  account: SubAccount;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { language, t } = useLanguage();
  const [rates, setRates] = useState<Record<string, string>>(() => Object.fromEntries(
    channelUsageCategories.map((category) => [category, '100']),
  ));
  const [settlementRecords, setSettlementRecords] = useState<CategoryRateResponse['settlementRecords']>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    api<CategoryRateResponse>(`/api/sub-accounts/${account.id}/category-rates`, {
      fresh: true,
      signal: controller.signal,
    })
      .then((value) => {
        if (controller.signal.aborted) return;
        setRates(Object.fromEntries(channelUsageCategories.map((category) => [
          category,
          value.rates.find((item) => item.category === category)?.ratePercent || '100',
        ])));
        setSettlementRecords(value.settlementRecords || []);
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
  }, [account.id, t]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const invalid = channelUsageCategories.some((category) => {
      const value = Number(rates[category]);
      return !Number.isFinite(value) || value < 0 || value > 100000;
    });
    if (invalid) {
      setError(t('汇率须在 0% 至 100000% 之间'));
      return;
    }
    setSaving(true);
    setError('');
    try {
      await api(`/api/sub-accounts/${account.id}/category-rates`, {
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
        className="account-dialog sub-account-rate-dialog"
        role="dialog"
      >
        <div className="account-dialog-header sub-account-rate-header">
          <div>
            <h2 id="sub-account-rate-title"><CircleDollarSign size={20} />{t('渠道分类汇率')}</h2>
            <p>{account.display_name || account.username} · ID {account.id}</p>
          </div>
          <button aria-label={t('关闭')} disabled={saving} onClick={onClose} type="button"><X size={18} /></button>
        </div>
        {loading ? (
          <div className="sub-account-rate-loading" role="status">
            <Loader2 className="spin" size={22} />{t('正在加载汇率')}
          </div>
        ) : (
          <form onSubmit={submit}>
            <p className="sub-account-rate-description">{t('为该用户分别设置每个渠道分类的金额汇率。')}</p>
            <div className="sub-account-rate-grid">
              {channelUsageCategories.map((category) => (
                <div className="sub-account-rate-row" key={category}>
                  <span className="sub-account-rate-name">
                    <strong>{categoryLabel(category, language)}</strong>
                    <small>{category}</small>
                  </span>
                  <label className="sub-account-rate-control">
                    <span>{t('汇率')}</span>
                    <span className="sub-account-rate-input suffix">
                      <input
                        inputMode="decimal"
                        max="100000"
                        min="0"
                        onChange={(event) => setRates((current) => ({
                          ...current,
                          [category]: event.target.value,
                        }))}
                        required
                        step="0.01"
                        type="number"
                        value={rates[category]}
                      />
                      <b>%</b>
                    </span>
                  </label>
                </div>
              ))}
            </div>
            <p className="sub-account-rate-hint">
              {t('100% 为原始消耗金额；设置后，“查看消耗”中的分类及模型金额会按此比例计算。')}
            </p>
            <section className="sub-account-settlement-history">
              <h3>{t('结算记录')}</h3>
              {settlementRecords.length > 0 ? (
                <div className="table-wrap sub-account-settlement-history-table-wrap">
                  <table className="sub-account-settlement-history-table">
                    <thead>
                      <tr>
                        <th>{t('结算时间')}</th>
                        <th>{t('渠道分类')}</th>
                        <th>{t('消耗额度')}</th>
                        <th>{t('结算汇率')}</th>
                        <th>{t('结算金额')}</th>
                        <th>{t('结算后累计')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {settlementRecords.map((record) => {
                        return (
                          <tr key={record.id}>
                            <td>{formatBeijingDateTime(record.createdAt, language)}</td>
                            <td>{categoryLabel(record.category, language)}</td>
                            <td>${record.consumptionAmount}</td>
                            <td>{record.ratePercent}%</td>
                            <td className={Number(record.settlementAmount) < 0 ? 'negative' : 'positive'}>
                              ${record.settlementAmount}
                            </td>
                            <td>${record.settledAmount}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="sub-account-settlement-history-empty">{t('暂无结算记录')}</p>
              )}
            </section>
            {error && <p className="account-dialog-error" role="alert">{error}</p>}
            <div className="account-dialog-actions">
              <button className="ghost-button" disabled={saving} onClick={onClose} type="button">{t('取消')}</button>
              <button className="primary-button compact" disabled={saving} type="submit">
                {saving && <Loader2 className="spin" size={16} />}
                {t(saving ? '保存中...' : '保存汇率')}
              </button>
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
  const [gysUsername, setGysUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleanGysUsername = gysUsername.trim();
    const cleanDisplayName = displayName.trim();
    if (!cleanGysUsername) {
      setError(t('请输入GYS用户名'));
      return;
    }
    if (!/^[A-Za-z0-9_.-]{3,64}$/.test(cleanGysUsername)) {
      setError(t('GYS用户名须为3至64位字母、数字、点、横线或下划线'));
      return;
    }
    if (!cleanDisplayName) {
      setError(t('请输入显示名'));
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
          gys_username: cleanGysUsername,
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
            <span>{t('GYS用户名')}</span>
            <input
              autoComplete="off"
              autoFocus
              maxLength={64}
              minLength={3}
              onChange={event => setGysUsername(event.target.value)}
              pattern="[A-Za-z0-9_.-]{3,64}"
              placeholder={t('GYS登录用户名')}
              required
              value={gysUsername}
            />
          </label>
          <label>
            <span>{t('显示名')}</span>
            <input
              autoComplete="off"
              maxLength={128}
              onChange={event => setDisplayName(event.target.value)}
              placeholder={t('显示名称')}
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
            <button className="ghost-button" disabled={saving} onClick={onClose} type="button">
              {t('取消')}
            </button>
            <button className="primary-button compact" disabled={saving} type="submit">
              {saving && <Loader2 className="spin" size={16} />}
              {t(saving ? '创建中...' : '创建子账号')}
            </button>
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
            <button className="ghost-button" disabled={saving} onClick={onClose} type="button">{t('取消')}</button>
            <button className="primary-button compact" disabled={saving} type="submit">
              {saving && <Loader2 className="spin" size={16} />}
              {t(saving ? '保存中...' : '保存修改')}
            </button>
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
          <button className="ghost-button" disabled={deleting} onClick={onClose} type="button">{t('取消')}</button>
          <button className="channel-confirm-submit danger" disabled={deleting} onClick={remove} type="button">
            {deleting && <Loader2 className="spin" size={15} />}
            {t(deleting ? '正在删除...' : '删除')}
          </button>
        </footer>
      </section>
    </div>
  );
}

function SubAccountsView() {
  const { language, t } = useLanguage();
  const [items, setItems] = useState<SubAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [usageAccount, setUsageAccount] = useState<SubAccount | null>(null);
  const [settlementAccount, setSettlementAccount] = useState<SubAccount | null>(null);
  const [rateAccount, setRateAccount] = useState<SubAccount | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<SubAccount | null>(null);
  const [deletingAccount, setDeletingAccount] = useState<SubAccount | null>(null);

  const load = useCallback(async (fresh = false) => {
    setLoading(true);
    setNotice(null);
    try {
      const data = await api<{ items: SubAccount[] }>('/api/sub-accounts', { fresh });
      setItems(data.items || []);
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
      text: t('子账号创建成功；需由超级管理员创建并启用映射后才能登录。'),
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
    <section>
      <PageHeading
        icon={Users}
        title={t('子账号管理')}
        subtitle={t('管理子账号及其平台模型消耗。')}
        action={
          <div className="action-row">
            <button className="ghost-button compact" onClick={() => load(true)} type="button">
              <RefreshCcw size={17} />
              {t('刷新')}
            </button>
            <button className="primary-button compact" onClick={() => setCreateOpen(true)} type="button">
              <Plus size={17} />
              {t('新增子账号')}
            </button>
          </div>
        }
      />
      <NoticeBanner notice={notice} />
      <div className="panel">
        {loading ? (
          <div className="loading-block">
            <Loader2 className="spin" />
            {t('正在检查权限')}
          </div>
        ) : items.length ? (
          <div className="table-wrap">
            <table className="sub-accounts-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>{t('本站用户名')}</th>
                  <th>{t('GYS用户名')}</th>
                  <th>{t('显示名')}</th>
                  <th>{t('渠道数')}</th>
                  <th>{t('已用额度')}</th>
                  <th>{t('状态')}</th>
                  <th>{t('操作')}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  const publicUsername = subAccountPublicUsername(item);
                  const upstreamUsername = subAccountUpstreamUsername(item);
                  const accountName = item.display_name || publicUsername || upstreamUsername;
                  return (
                  <tr key={item.id}>
                    <td>{item.id}</td>
                    <td>{publicUsername || <Badge>{t('未映射')}</Badge>}</td>
                    <td>{upstreamUsername || '-'}</td>
                    <td>{item.display_name || '-'}</td>
                    <td>{item.channel_count || 0}</td>
                    <td>{formatQuota(item.used_quota)}</td>
                    <td>
                      <Badge tone={item.status === 1 ? 'green' : 'red'}>{statusLabel(item.status, language)}</Badge>
                    </td>
                    <td>
                      <div className="sub-account-row-actions">
                        <button aria-label={t('查看 {{name}} 的消耗', { name: accountName })} onClick={() => setUsageAccount(item)} type="button">
                          <BarChart3 size={14} />{t('查看消耗')}
                        </button>
                        <button aria-label={t('为 {{name}} 结算', { name: accountName })} onClick={() => setSettlementAccount(item)} type="button">
                          <CheckCircle2 size={14} />{t('结算')}
                        </button>
                        <button aria-label={t('为 {{name}} 设置汇率', { name: accountName })} onClick={() => setRateAccount(item)} type="button">
                          <CircleDollarSign size={14} />{t('设置汇率')}
                        </button>
                        <button aria-label={t('编辑 {{name}}', { name: accountName })} onClick={() => setEditingAccount(item)} type="button">
                          <Pencil size={14} />{t('编辑')}
                        </button>
                        <button aria-label={t('删除 {{name}}', { name: accountName })} className="danger" onClick={() => setDeletingAccount(item)} type="button">
                          <Trash2 size={14} />{t('删除')}
                        </button>
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
      {usageAccount && <SubAccountUsageDialog key={usageAccount.id} account={usageAccount} onClose={() => setUsageAccount(null)} />}
      {settlementAccount && (
        <SubAccountSettlementDialog
          key={settlementAccount.id}
          account={settlementAccount}
          onClose={() => setSettlementAccount(null)}
        />
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
  const [authError, setAuthError] = useState(false);
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
    setAuthError(false);
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
    setAuthError(false);
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
          setAuthError(true);
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
          <button className="primary-button compact" type="button" onClick={() => setAuthAttempt((value) => value + 1)}>
            <RefreshCcw size={16} />{t('重试')}
          </button>
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
          <button className="ghost-button compact" type="button" onClick={() => setAuthAttempt((value) => value + 1)}>
            <RefreshCcw size={15} />{t('重试')}
          </button>
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
