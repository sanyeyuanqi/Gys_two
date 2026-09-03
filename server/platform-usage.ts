export type UsageChannel = {
  id: number;
  uploaderId: number;
  category: string;
  quota: number;
};

export type UsageProgress = { loaded: number; total: number };

export type PlatformUsageSummary = {
  totalQuota: number;
  channelCount: number;
  platforms: Array<{ category: string; quota: number; channelCount: number; share: number }>;
};

type Request = <T>(path: string, init: { fresh: boolean; signal: AbortSignal }) => Promise<T>;
type Options = {
  signal: AbortSignal;
  fresh?: boolean;
  onProgress?: (progress: UsageProgress) => void;
};
type ChannelPage = {
  items: Array<Record<string, unknown>> | null;
  page: number;
  page_size: number;
  total: number;
};

export class UsageDataError extends Error {
  code: 'invalid' | 'incomplete' | 'changed';
  constructor(code: 'invalid' | 'incomplete' | 'changed') {
    super(code);
    this.code = code;
    this.name = 'UsageDataError';
  }
}

function integer(value: unknown, minimum = 0) {
  const number = typeof value === 'number' || (typeof value === 'string' && value.trim())
    ? Number(value) : NaN;
  if (!Number.isSafeInteger(number) || number < minimum) throw new UsageDataError('invalid');
  return number;
}

export function summarizePlatformUsage(channels: UsageChannel[], uploaderId: number): PlatformUsageSummary {
  integer(uploaderId, 1);
  const platforms = new Map<string, PlatformUsageSummary['platforms'][number]>();
  let totalQuota = 0;
  let channelCount = 0;
  for (const channel of channels) {
    if (channel.uploaderId !== uploaderId) continue;
    const group = platforms.get(channel.category) ?? {
      category: channel.category, quota: 0, channelCount: 0, share: 0,
    };
    // used_quota already includes aggregated keys and regional copies.
    group.quota = integer(group.quota + channel.quota);
    group.channelCount++;
    platforms.set(channel.category, group);
    totalQuota = integer(totalQuota + channel.quota);
    channelCount++;
  }
  return {
    totalQuota,
    channelCount,
    platforms: [...platforms.values()]
      .map(platform => ({ ...platform, share: totalQuota ? platform.quota / totalQuota : 0 }))
      .sort((a, b) => b.quota - a.quota || a.category.localeCompare(b.category)),
  };
}

// Create one loader per authorized backend request, never share across accounts.
export function createPlatformUsageLoader(request: Request) {
  let snapshot: { channels: UsageChannel[]; loadedAt: number } | null = null;
  let revision = 0;

  return async (uploaderId: number, options: Options): Promise<PlatformUsageSummary> => {
    const { signal, onProgress } = options;
    signal.throwIfAborted();
    integer(uploaderId, 1);
    if (!options.fresh && snapshot && Date.now() - snapshot.loadedAt < 30_000) {
      return summarizePlatformUsage(snapshot.channels, uploaderId);
    }
    const currentRevision = ++revision;
    snapshot = null;
    const channels: UsageChannel[] = [];
    const ids = new Set<number>();
    let expectedTotal: number | undefined;
    let pageSize: number | undefined;

    for (let page = 1; ; page++) {
      signal.throwIfAborted();
      const params = new URLSearchParams({ page: String(page), page_size: '500' });
      const data = await request<ChannelPage>(`/api/channels?${params}`, { fresh: true, signal });
      signal.throwIfAborted();
      if (!data || (data.items !== null && !Array.isArray(data.items))) throw new UsageDataError('invalid');
      const total = integer(data.total);
      const size = integer(data.page_size, 1);
      if (integer(data.page, 1) !== page) throw new UsageDataError('incomplete');
      if (expectedTotal !== undefined && (total !== expectedTotal || size !== pageSize)) {
        throw new UsageDataError('changed');
      }
      expectedTotal = total;
      pageSize = size;
      const items = data.items ?? [];
      if (items.length !== Math.min(size, total - channels.length)) throw new UsageDataError('incomplete');
      for (const item of items) {
        if (!item || typeof item !== 'object') throw new UsageDataError('invalid');
        const id = integer(item.id, 1);
        if (ids.has(id)) throw new UsageDataError('changed');
        ids.add(id);
        // Only retain accounting fields, not API keys or other channel secrets.
        channels.push({
          id,
          uploaderId: integer(item.uploader_id),
          category: typeof item.category === 'string' ? item.category.trim() : '',
          quota: integer(item.used_quota),
        });
      }
      onProgress?.({ loaded: channels.length, total });
      if (channels.length === total) break;
    }

    signal.throwIfAborted();
    if (currentRevision === revision) snapshot = { channels, loadedAt: Date.now() };
    return summarizePlatformUsage(channels, uploaderId);
  };
}
