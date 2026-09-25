import { useNavigate } from 'react-router';
import { Bell, CheckCheck } from 'lucide-react';
import type { NotificationItem } from '@localy/shared';
import { api } from '@/lib/api';
import { useAction, useApi } from '@/lib/query';
import { cn, timeAgo } from '@/lib/utils';
import { Button, EmptyState, Popover, PopoverContent, PopoverTrigger, Skeleton } from '@/components/ui';

export function NotificationBell() {
  const navigate = useNavigate();
  const { data, isLoading } = useApi<{ notifications: NotificationItem[]; unread: number }>(['notifications'], '/api/notifications', { refetchInterval: 45_000 });
  const markRead = useAction((ids: string[] | 'all') => api.post('/api/notifications/read', { ids }), { invalidate: [['notifications'], ['me']], silentError: true });
  const unread = data?.unread ?? 0;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'} className="relative">
          <Bell />
          {unread > 0 && <span className="tabular absolute right-1.5 top-1.5 flex h-[15px] min-w-[15px] items-center justify-center rounded-full bg-ink px-1 text-[9.5px] font-semibold text-white">{unread > 9 ? '9+' : unread}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[360px] p-0">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <span className="text-[13.5px] font-semibold">Notifications</span>
          {unread > 0 && (
            <Button size="xs" variant="ghost" leftIcon={<CheckCheck />} onClick={() => markRead.mutate('all')}>
              Mark all read
            </Button>
          )}
        </div>
        <div className="max-h-[400px] overflow-y-auto">
          {isLoading ? (
            <div className="space-y-3 p-4">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
            </div>
          ) : !data?.notifications.length ? (
            <EmptyState compact title="You're all caught up" description="Replies, completed campaigns and follow-up reminders will appear here." />
          ) : (
            <ul className="divide-y divide-line">
              {data.notifications.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    className={cn('flex w-full gap-3 px-4 py-3 text-left transition-colors hover:bg-hover/60', !n.readAt && 'bg-wash/50')}
                    onClick={() => {
                      if (!n.readAt) markRead.mutate([n.id]);
                      if (n.link) navigate(n.link);
                    }}
                  >
                    <span className={cn('mt-1.5 size-1.5 shrink-0 rounded-full', n.readAt ? 'bg-transparent' : 'bg-ink')} aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-medium text-ink">{n.title}</span>
                      {n.body && <span className="mt-0.5 line-clamp-2 block text-[12.5px] text-muted">{n.body}</span>}
                      <span className="mt-1 block text-[11.5px] text-subtle">{timeAgo(n.createdAt)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
