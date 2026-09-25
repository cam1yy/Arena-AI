export const PROSPECT_STATUSES = [
  'new',
  'contacted',
  'follow_up',
  'replied',
  'interested',
  'not_interested',
  'client',
  'closed',
  'archived',
] as const;
export type ProspectStatus = (typeof PROSPECT_STATUSES)[number];

export const PROSPECT_STATUS_LABELS: Record<ProspectStatus, string> = {
  new: 'New',
  contacted: 'Contacted',
  follow_up: 'Follow-up',
  replied: 'Replied',
  interested: 'Interested',
  not_interested: 'Not interested',
  client: 'Client',
  closed: 'Closed',
  archived: 'Archived',
};

export const CAMPAIGN_STATUSES = ['draft', 'scheduled', 'active', 'paused', 'completed'] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];
export const CAMPAIGN_STATUS_LABELS: Record<CampaignStatus, string> = {
  draft: 'Draft',
  scheduled: 'Scheduled',
  active: 'Active',
  paused: 'Paused',
  completed: 'Completed',
};

export const RECIPIENT_STATUSES = [
  'pending',
  'in_progress',
  'replied',
  'completed',
  'bounced',
  'failed',
  'unsubscribed',
  'stopped',
  'skipped',
] as const;
export type RecipientStatus = (typeof RECIPIENT_STATUSES)[number];
export const RECIPIENT_STATUS_LABELS: Record<RecipientStatus, string> = {
  pending: 'Pending',
  in_progress: 'In sequence',
  replied: 'Replied',
  completed: 'Sequence complete',
  bounced: 'Bounced',
  failed: 'Failed',
  unsubscribed: 'Unsubscribed',
  stopped: 'Stopped',
  skipped: 'Skipped',
};

export const MESSAGE_STATUSES = ['queued', 'sending', 'sent', 'failed', 'cancelled', 'bounced', 'received'] as const;
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];

export const WEBSITE_STATUSES = ['listed', 'not_listed', 'detected', 'unavailable', 'unknown'] as const;
export type WebsiteStatus = (typeof WEBSITE_STATUSES)[number];
export const WEBSITE_STATUS_LABELS: Record<WebsiteStatus, string> = {
  listed: 'Website listed',
  not_listed: 'No website listed',
  detected: 'Website detected',
  unavailable: 'Website unavailable',
  unknown: 'Unknown',
};
export const WEBSITE_STATUS_DESCRIPTIONS: Record<WebsiteStatus, string> = {
  listed: 'The Google Maps listing includes a website link. It has not been checked.',
  not_listed:
    'The Google Maps listing does not include a website link. The business may still have a website that is not listed.',
  detected: 'The listed website responded successfully when Localy checked it.',
  unavailable: 'The listed website did not respond successfully when Localy checked it.',
  unknown: 'Website information was not available for this business.',
};

export const WEBSITE_FILTERS = ['any', 'opportunity', 'not_listed', 'listed', 'unknown'] as const;
export type WebsiteFilter = (typeof WEBSITE_FILTERS)[number];
export const WEBSITE_FILTER_LABELS: Record<WebsiteFilter, string> = {
  any: 'Any website status',
  opportunity: 'Potential website opportunity',
  not_listed: 'Website not listed',
  listed: 'Website listed',
  unknown: 'Unknown',
};

export const ROLES = ['owner', 'admin', 'member'] as const;
export type Role = (typeof ROLES)[number];
export const ROLE_LABELS: Record<Role, string> = { owner: 'Owner', admin: 'Admin', member: 'Member' };

export const PLAN_KEYS = ['trial', 'pro', 'agency'] as const;
export type PlanKey = (typeof PLAN_KEYS)[number];

export const SUBSCRIPTION_STATUSES = [
  'trialing',
  'active',
  'past_due',
  'canceled',
  'incomplete',
  'unpaid',
  'expired',
] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export const USAGE_METRICS = [
  'businesses_discovered',
  'places_requests',
  'emails_sent',
  'prospects',
  'active_campaigns',
  'mailboxes',
  'seats',
] as const;
export type UsageMetric = (typeof USAGE_METRICS)[number];
export const USAGE_METRIC_LABELS: Record<UsageMetric, string> = {
  businesses_discovered: 'Businesses discovered this month',
  places_requests: 'Places API requests this month',
  emails_sent: 'Emails sent this month',
  prospects: 'Saved prospects',
  active_campaigns: 'Active campaigns',
  mailboxes: 'Connected mailboxes',
  seats: 'Workspace members',
};
/** Metrics that reset every calendar month. The rest are point-in-time counts. */
export const MONTHLY_METRICS: UsageMetric[] = ['businesses_discovered', 'places_requests', 'emails_sent'];

export interface PlanLimits {
  businesses_discovered: number;
  places_requests: number;
  emails_sent: number;
  prospects: number;
  active_campaigns: number;
  mailboxes: number;
  seats: number;
}

export const INTEGRATION_PROVIDERS = ['gmail', 'microsoft', 'sandbox'] as const;
export type IntegrationProvider = (typeof INTEGRATION_PROVIDERS)[number];
export const INTEGRATION_PROVIDER_LABELS: Record<IntegrationProvider, string> = {
  gmail: 'Gmail',
  microsoft: 'Microsoft Outlook',
  sandbox: 'Development sandbox',
};
export const INTEGRATION_STATUSES = ['active', 'error', 'disconnected'] as const;
export type IntegrationStatus = (typeof INTEGRATION_STATUSES)[number];

export const NOTIFICATION_TYPES = [
  'reply',
  'campaign_completed',
  'follow_up_due',
  'integration_disconnected',
  'usage_warning',
  'payment_issue',
  'system',
  'discovery',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const NOTIFICATION_PREFERENCE_KEYS = ['campaign_completed', 'replies', 'follow_ups', 'usage_limits'] as const;
export type NotificationPreferenceKey = (typeof NOTIFICATION_PREFERENCE_KEYS)[number];
export type NotificationPreferences = Record<NotificationPreferenceKey, { inApp: boolean; email: boolean }>;
export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  campaign_completed: { inApp: true, email: true },
  replies: { inApp: true, email: true },
  follow_ups: { inApp: true, email: false },
  usage_limits: { inApp: true, email: true },
};

export const ACTIVITY_TYPES = [
  'business_discovered',
  'prospect_created',
  'status_changed',
  'note_added',
  'tag_added',
  'tag_removed',
  'added_to_campaign',
  'removed_from_campaign',
  'email_sent',
  'email_failed',
  'email_bounced',
  'reply_received',
  'follow_up_scheduled',
  'follow_up_completed',
  'follow_up_cancelled',
  'sequence_stopped',
  'unsubscribed',
  'contact_updated',
  'campaign_started',
  'campaign_paused',
  'campaign_resumed',
  'campaign_completed',
  'discovery_search',
] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export const FOLLOW_UP_TYPES = ['sequence', 'manual'] as const;
export type FollowUpType = (typeof FOLLOW_UP_TYPES)[number];
export const FOLLOW_UP_STATUSES = ['scheduled', 'done', 'sent', 'cancelled'] as const;
export type FollowUpStatus = (typeof FOLLOW_UP_STATUSES)[number];

export const USE_CASES = [
  { id: 'web_design', label: 'Web design' },
  { id: 'web_development', label: 'Web development' },
  { id: 'marketing', label: 'Marketing' },
  { id: 'freelancing', label: 'Freelancing' },
  { id: 'agency', label: 'Agency' },
  { id: 'other', label: 'Other' },
] as const;
export type UseCase = (typeof USE_CASES)[number]['id'];

export const RADIUS_PRESETS_KM = [5, 10, 25, 50] as const;
export const MAX_RADIUS_METERS = 50_000;
export const MIN_RADIUS_METERS = 500;

export const DISTANCE_UNITS = ['km', 'mi'] as const;
export type DistanceUnit = (typeof DISTANCE_UNITS)[number];

export const GOOGLE_MAPS_RANKING_EXPLAINER =
  'When searching for businesses or places near a location, Google Maps will show local results. Several factors, primarily relevance, distance and prominence, are combined to help find the best results for a search.';
export const GOOGLE_MAPS_RANKING_URL =
  'https://support.google.com/maps/answer/3092445?&ref_topic=3092444#zippy=%2Cwithin-google-maps%2Cother-google-products';
