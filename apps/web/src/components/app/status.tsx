import type { CampaignStatus, ProspectStatus, WebsiteStatus } from '@localy/shared';
import { CAMPAIGN_STATUS_LABELS, PROSPECT_STATUS_LABELS, WEBSITE_STATUS_DESCRIPTIONS, WEBSITE_STATUS_LABELS } from '@localy/shared';
import { Badge, Tooltip } from '@/components/ui';

const PROSPECT_TONES: Record<ProspectStatus, Parameters<typeof Badge>[0]['tone']> = {
  new: 'outline',
  contacted: 'neutral',
  follow_up: 'warning',
  replied: 'info',
  interested: 'positive',
  not_interested: 'neutral',
  client: 'solid',
  closed: 'neutral',
  archived: 'neutral',
};

export function ProspectStatusBadge({ status }: { status: ProspectStatus }) {
  return (
    <Badge tone={PROSPECT_TONES[status]} dot={status === 'interested' || status === 'replied'} className={status === 'archived' || status === 'closed' || status === 'not_interested' ? 'text-muted' : undefined}>
      {PROSPECT_STATUS_LABELS[status]}
    </Badge>
  );
}

const CAMPAIGN_TONES: Record<CampaignStatus, Parameters<typeof Badge>[0]['tone']> = {
  draft: 'outline',
  scheduled: 'info',
  active: 'positive',
  paused: 'warning',
  completed: 'neutral',
};

export function CampaignStatusBadge({ status }: { status: CampaignStatus }) {
  return (
    <Badge tone={CAMPAIGN_TONES[status]} dot={status === 'active'}>
      {CAMPAIGN_STATUS_LABELS[status]}
    </Badge>
  );
}

export function WebsiteStatusBadge({ status, socialOnly, compact }: { status: WebsiteStatus; socialOnly?: boolean; compact?: boolean }) {
  const tone = status === 'not_listed' || status === 'unavailable' ? 'warning' : status === 'detected' || status === 'listed' ? 'neutral' : 'outline';
  const label = socialOnly && status === 'listed' ? 'Social profile only' : WEBSITE_STATUS_LABELS[status];
  const description = socialOnly && status === 'listed' ? 'The only link listed is a social media or link-in-bio page, not a dedicated website.' : WEBSITE_STATUS_DESCRIPTIONS[status];
  return (
    <Tooltip content={description}>
      <span className="inline-flex">
        <Badge tone={socialOnly && status === 'listed' ? 'warning' : tone} className={compact ? 'px-1' : undefined}>
          {label}
        </Badge>
      </span>
    </Tooltip>
  );
}
