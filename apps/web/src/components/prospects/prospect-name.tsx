import { useProspectName } from '@/lib/places';
import { Skeleton } from '@/components/ui';

/** Renders a prospect's name: user-entered if set, otherwise fetched live from Google Maps (never stored). */
export function ProspectName({ placeId, name, className }: { placeId: string | null | undefined; name: string | null | undefined; className?: string }) {
  const { name: display, loading } = useProspectName(placeId, name);
  if (loading) return <Skeleton className="inline-block h-3.5 w-32 align-middle" />;
  return <span className={className}>{display}</span>;
}
