import type {
  CampaignStatus,
  IntegrationProvider,
  IntegrationStatus,
  MessageStatus,
  NotificationType,
  PlanKey,
  PlanLimits,
  ProspectStatus,
  RecipientStatus,
  Role,
  SubscriptionStatus,
  UsageMetric,
  WebsiteStatus,
} from './constants';
import type { Signals } from './signals';
import type { LocationValue, DiscoveryFilters } from './schemas';

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
    requestId?: string;
  };
}

export interface PublicConfig {
  appName: string;
  environment: 'development' | 'test' | 'production';
  mapsBrowserKey: string | null;
  mapsMapId: string | null;
  features: {
    places: boolean;
    maps: boolean;
    googleSignIn: boolean;
    gmail: boolean;
    microsoft: boolean;
    stripe: boolean;
    ai: boolean;
    devSandbox: boolean;
    devMail: boolean;
  };
  supportEmail: string;
  announcement: { message: string; level: 'info' | 'warning' } | null;
  signupsEnabled: boolean;
}

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  avatarUrl: string | null;
  timezone: string;
  distanceUnit: 'km' | 'mi';
  twoFactorEnabled: boolean;
  hasPassword: boolean;
  isPlatformAdmin: boolean;
  onboardingStep: number;
  onboardingCompleted: boolean;
  createdAt: string;
}

export interface WorkspaceSummary {
  id: string;
  name: string;
  role: Role;
}

export interface WorkspaceSettings {
  agencyName: string | null;
  website: string | null;
  industry: string | null;
  businessLocation: string | null;
  defaultSenderName: string | null;
  defaultReplyTo: string | null;
  signature: string | null;
  postalAddress: string | null;
  includeUnsubscribeFooter: boolean;
  useCase: string | null;
  defaultLocation: LocationValue | null;
  preferredLocations: LocationValue[];
  defaultRadiusMeters: number;
  defaultCategories: string[];
  minRating: number | null;
  maxRating: number | null;
  websiteFilter: 'any' | 'opportunity' | 'not_listed' | 'listed' | 'unknown';
  distanceUnit: 'km' | 'mi';
}

export interface BillingState {
  planKey: PlanKey;
  planName: string;
  status: SubscriptionStatus;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  canUseFeatures: boolean;
  readOnlyReason: string | null;
}

export interface MeResponse {
  user: SessionUser;
  workspace: WorkspaceSummary & { settings: WorkspaceSettings };
  workspaces: WorkspaceSummary[];
  billing: BillingState;
  unreadNotifications: number;
}

export interface UsageItem {
  metric: UsageMetric;
  label: string;
  used: number;
  limit: number;
  monthly: boolean;
  percent: number;
  /** Approaching a monthly limit or the prospect limit (80% or more). */
  warning: boolean;
  /** Monthly limit used up, or a capacity limit exceeded (for example after a downgrade). */
  exceeded: boolean;
  /** A capacity limit (mailboxes, seats, campaigns, prospects) is fully used. Adding more requires an upgrade. */
  atCapacity: boolean;
}

export interface PlanView {
  key: PlanKey;
  name: string;
  description: string;
  limits: PlanLimits;
  features: string[];
  price: { amount: number; currency: string; interval: string } | null;
  purchasable: boolean;
}

/** A business as returned live from Google Places. Never persisted by Localy. */
export interface PlaceResult {
  placeId: string;
  name: string | null;
  primaryType: string | null;
  category: string | null;
  types: string[];
  rating: number | null;
  userRatingCount: number | null;
  address: string | null;
  shortAddress: string | null;
  locality: string | null;
  phone: string | null;
  internationalPhone: string | null;
  websiteUri: string | null;
  googleMapsUri: string | null;
  location: { lat: number; lng: number } | null;
  businessStatus: string | null;
  openNow: boolean | null;
  weekdayHours: string[] | null;
  pureServiceArea: boolean;
  attributions: { provider: string; providerUri?: string }[];
}

export interface DiscoveryResult extends PlaceResult {
  distanceMeters: number | null;
  websiteStatus: WebsiteStatus;
  socialProfileOnly: boolean;
  websiteCheck: { status: 'detected' | 'unavailable'; httpStatus: number | null; checkedAt: string } | null;
  signals: Signals;
  opportunity: boolean;
  matchedQueries: string[];
  prospectId: string | null;
}

export interface DiscoveryResponse {
  searchId: string;
  results: DiscoveryResult[];
  pageTokens: Record<string, string>;
  hasMore: boolean;
  excludedOutsideRadius: number;
  requestsMade: number;
  usage: { discovered: UsageItem; requests: UsageItem };
  limitNotice: string | null;
}

/** Live Google Maps details for a saved prospect. Fetched on demand, never stored. */
export interface LiveSummary {
  name: string | null;
  address: string | null;
  shortAddress: string | null;
  locality: string | null;
  category: string | null;
  businessStatus: string | null;
  googleMapsUri: string | null;
}

export interface ProspectListItem {
  id: string;
  placeId: string | null;
  source: 'google_places' | 'manual' | 'import' | 'dev_seed';
  status: ProspectStatus;
  name: string | null;
  displayName: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  locationLabel: string | null;
  categoryLabel: string | null;
  websiteStatus: WebsiteStatus;
  socialProfileOnly: boolean;
  signals: Signals;
  tags: { id: string; name: string }[];
  lastContactedAt: string | null;
  nextFollowUpAt: string | null;
  unsubscribed: boolean;
  createdAt: string;
  updatedAt: string;
  live: PlaceResult | null;
  liveError: string | null;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ActivityItem {
  id: string;
  type: string;
  data: Record<string, unknown>;
  prospectId: string | null;
  campaignId: string | null;
  actor: { id: string; name: string } | null;
  createdAt: string;
  summary: string;
}

export interface TemplateItem {
  id: string;
  name: string;
  subject: string;
  body: string;
  kind: 'initial' | 'follow_up';
  defaultDelayDays: number;
  createdAt: string;
  updatedAt: string;
  usageCount: number;
}

export interface CampaignStepItem {
  id: string;
  position: number;
  templateId: string | null;
  subject: string;
  body: string;
  waitDays: number;
  enabled: boolean;
}

export interface CampaignStats {
  recipients: number;
  pending: number;
  queued: number;
  sent: number;
  delivered: number;
  replies: number;
  positiveReplies: number;
  followUpsSent: number;
  unsubscribed: number;
  bounced: number;
  failed: number;
}

export interface CampaignItem {
  id: string;
  name: string;
  status: CampaignStatus;
  integration: { id: string; email: string; provider: IntegrationProvider; status: IntegrationStatus } | null;
  senderName: string | null;
  replyTo: string | null;
  dailyLimit: number;
  startAt: string | null;
  timezone: string;
  sendWindowStart: number;
  sendWindowEnd: number;
  sendDays: number[];
  stopOnReply: boolean;
  steps: CampaignStepItem[];
  stats: CampaignStats;
  pauseReason: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface RecipientItem {
  id: string;
  prospectId: string;
  placeId: string | null;
  prospectName: string;
  email: string | null;
  status: RecipientStatus;
  currentStep: number;
  nextSendAt: string | null;
  lastSentAt: string | null;
  repliedAt: string | null;
  stoppedReason: string | null;
  issues: string[];
}

export interface IntegrationItem {
  id: string;
  provider: IntegrationProvider;
  email: string;
  displayName: string | null;
  status: IntegrationStatus;
  scopes: string[];
  lastError: string | null;
  lastSyncedAt: string | null;
  lastHealthCheckAt: string | null;
  dailySendLimit: number;
  sentToday: number;
  isDefault: boolean;
  connectedBy: { id: string; name: string } | null;
  createdAt: string;
}

export interface MessageItem {
  id: string;
  direction: 'outbound' | 'inbound';
  status: MessageStatus;
  fromEmail: string;
  fromName: string | null;
  toEmail: string;
  subject: string;
  bodyText: string;
  sentAt: string | null;
  receivedAt: string | null;
  scheduledFor: string | null;
  error: string | null;
  campaignId: string | null;
  stepPosition: number | null;
  isTest: boolean;
  createdAt: string;
}

export interface ThreadItem {
  id: string;
  prospectId: string | null;
  placeId: string | null;
  prospectName: string;
  prospectStatus: ProspectStatus | null;
  subject: string;
  lastMessageAt: string;
  lastMessagePreview: string;
  lastDirection: 'outbound' | 'inbound';
  status: 'open' | 'archived';
  unread: boolean;
  campaignId: string | null;
  campaignName: string | null;
  integrationProvider: IntegrationProvider | null;
  messageCount: number;
}

export interface NotificationItem {
  id: string;
  type: NotificationType;
  title: string;
  body: string | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface SavedSearchItem {
  id: string;
  name: string;
  config: {
    categories: string[];
    keyword?: string | null;
    location: LocationValue;
    radiusMeters: number;
    filters: DiscoveryFilters;
  };
  lastRunAt: string | null;
  createdAt: string;
}

export interface SearchHistoryItem {
  id: string;
  label: string;
  categories: string[];
  keyword: string | null;
  location: LocationValue;
  radiusMeters: number;
  filters: DiscoveryFilters;
  resultCount: number;
  opportunityCount: number;
  createdAt: string;
  user: { id: string; name: string } | null;
}

export interface FollowUpItem {
  id: string;
  kind: 'reminder' | 'sequence';
  prospectId: string;
  placeId: string | null;
  prospectName: string;
  campaignId: string | null;
  campaignName: string | null;
  dueAt: string;
  note: string | null;
  stepPosition: number | null;
  status: string;
}
