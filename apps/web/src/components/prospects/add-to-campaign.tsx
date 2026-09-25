import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import type { CampaignStatus } from '@localy/shared';
import { api } from '@/lib/api';
import { useAction, useApi } from '@/lib/query';
import { Button, Dialog, EmptyState, Select } from '@/components/ui';

export function AddToCampaignDialog({ open, onOpenChange, prospectIds, onDone, defaultCampaignId }: { open: boolean; onOpenChange: (o: boolean) => void; prospectIds: string[]; onDone?: () => void; defaultCampaignId?: string | null }) {
  const { data } = useApi<{ campaigns: { id: string; name: string; status: CampaignStatus }[] }>(['campaign-options'], open ? '/api/campaigns/options' : null);
  const [campaignId, setCampaignId] = useState(defaultCampaignId ?? '');
  useEffect(() => {
    if (open && defaultCampaignId) setCampaignId(defaultCampaignId);
  }, [open, defaultCampaignId]);
  const add = useAction(() => api.post<{ added: number; skipped: number }>(`/api/campaigns/${campaignId}/recipients`, { prospectIds }), {
    success: (r) => `Added ${r.added} ${r.added === 1 ? 'prospect' : 'prospects'}${r.skipped ? `. ${r.skipped} already in the campaign or archived.` : '.'}`,
    invalidate: [['campaigns'], ['prospects']],
    onSuccess: () => {
      onOpenChange(false);
      onDone?.();
    },
  });
  const options = data?.campaigns ?? [];
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Add to campaign"
      description={`${prospectIds.length} ${prospectIds.length === 1 ? 'prospect' : 'prospects'} selected.`}
      size="sm"
      footer={
        options.length ? (
          <>
            <Button onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button variant="primary" disabled={!campaignId} loading={add.isPending} onClick={() => add.mutate(undefined)}>
              Add to campaign
            </Button>
          </>
        ) : undefined
      }
    >
      {options.length ? (
        <Select value={campaignId} onChange={(e) => setCampaignId(e.target.value)} aria-label="Campaign">
          <option value="">Choose a campaign</option>
          {options.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} ({c.status})
            </option>
          ))}
        </Select>
      ) : (
        <EmptyState
          compact
          title="No open campaigns"
          description="Create a campaign first, then add prospects to it."
          action={
            <Button variant="primary" asChild>
              <Link to={`/app/campaigns/new?prospects=${prospectIds.join(',')}`}>Create campaign with these prospects</Link>
            </Button>
          }
        />
      )}
    </Dialog>
  );
}
