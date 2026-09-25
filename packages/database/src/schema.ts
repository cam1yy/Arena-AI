import { sql } from 'drizzle-orm';
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import type {
  LocationValue,
  NotificationPreferences,
  PlanLimits,
  Signals,
  WorkspaceSettings,
  DiscoveryFilters,
} from '@localy/shared';

/*
 * Data-retention model for Google Maps Platform content
 * -----------------------------------------------------
 * Localy persists only what the Google Maps Platform terms allow:
 *   - Place IDs, indefinitely (prospects.place_id, search_history.place_ids).
 *   - Latitude/longitude from Google, for at most 30 consecutive days
 *     (columns ending in coords_cached_at; the cleanup job clears them).
 * Business names, addresses, phone numbers, ratings, hours and website URLs
 * returned by Google are fetched live for display and never written here.
 * Everything else in these tables is user-created data or Localy's own
 * workflow data (statuses, notes, tags, sent email, analysis flags).
 */

const id = () => uuid('id').primaryKey().defaultRandom();
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());
const ts = (name: string) => timestamp(name, { withTimezone: true });

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

export const users = pgTable(
  'users',
  {
    id: id(),
    email: text('email').notNull(),
    name: text('name').notNull(),
    passwordHash: text('password_hash'),
    emailVerifiedAt: ts('email_verified_at'),
    avatarUrl: text('avatar_url'),
    timezone: text('timezone').notNull().default('UTC'),
    distanceUnit: text('distance_unit').$type<'km' | 'mi'>().notNull().default('km'),
    twoFactorSecretEnc: text('two_factor_secret_enc'),
    twoFactorEnabledAt: ts('two_factor_enabled_at'),
    isPlatformAdmin: boolean('is_platform_admin').notNull().default(false),
    disabledAt: ts('disabled_at'),
    onboardingStep: integer('onboarding_step').notNull().default(1),
    onboardingCompletedAt: ts('onboarding_completed_at'),
    notificationPreferences: jsonb('notification_preferences').$type<NotificationPreferences>(),
    lastLoginAt: ts('last_login_at'),
    isDevData: boolean('is_dev_data').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('users_email_unique').on(sql`lower(${t.email})`)],
);

export const recoveryCodes = pgTable(
  'recovery_codes',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    codeHash: text('code_hash').notNull(),
    usedAt: ts('used_at'),
    createdAt: createdAt(),
  },
  (t) => [index('recovery_codes_user_idx').on(t.userId)],
);

export const oauthAccounts = pgTable(
  'oauth_accounts',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    provider: text('provider').$type<'google' | 'microsoft'>().notNull(),
    providerAccountId: text('provider_account_id').notNull(),
    email: text('email'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('oauth_accounts_provider_unique').on(t.provider, t.providerAccountId),
    index('oauth_accounts_user_idx').on(t.userId),
  ],
);

export const sessions = pgTable(
  'sessions',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    activeWorkspaceId: uuid('active_workspace_id').references(() => workspaces.id, { onDelete: 'set null' }),
    userAgent: text('user_agent'),
    ip: text('ip'),
    twoFactorPending: boolean('two_factor_pending').notNull().default(false),
    adminElevatedUntil: ts('admin_elevated_until'),
    createdAt: createdAt(),
    lastSeenAt: ts('last_seen_at').notNull().defaultNow(),
    expiresAt: ts('expires_at').notNull(),
    revokedAt: ts('revoked_at'),
  },
  (t) => [uniqueIndex('sessions_token_unique').on(t.tokenHash), index('sessions_user_idx').on(t.userId)],
);

export const authTokens = pgTable(
  'auth_tokens',
  {
    id: id(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    type: text('type').$type<'email_verification' | 'password_reset' | 'email_change'>().notNull(),
    tokenHash: text('token_hash').notNull(),
    expiresAt: ts('expires_at').notNull(),
    usedAt: ts('used_at'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('auth_tokens_hash_unique').on(t.tokenHash), index('auth_tokens_user_idx').on(t.userId)],
);

export const oauthStates = pgTable('oauth_states', {
  stateHash: text('state_hash').primaryKey(),
  purpose: text('purpose').$type<'login' | 'gmail' | 'microsoft'>().notNull(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
  workspaceId: uuid('workspace_id'),
  codeVerifier: text('code_verifier').notNull(),
  redirectTo: text('redirect_to'),
  expiresAt: ts('expires_at').notNull(),
  createdAt: createdAt(),
});

// ---------------------------------------------------------------------------
// Workspaces and billing
// ---------------------------------------------------------------------------

export const workspaces = pgTable('workspaces', {
  id: id(),
  name: text('name').notNull(),
  settings: jsonb('settings').$type<Partial<WorkspaceSettings>>().notNull().default({}),
  stripeCustomerId: text('stripe_customer_id'),
  isDevData: boolean('is_dev_data').notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const workspaceMembers = pgTable(
  'workspace_members',
  {
    id: id(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').$type<'owner' | 'admin' | 'member'>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('workspace_members_unique').on(t.workspaceId, t.userId),
    index('workspace_members_user_idx').on(t.userId),
  ],
);

export const workspaceInvitations = pgTable(
  'workspace_invitations',
  {
    id: id(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    role: text('role').$type<'admin' | 'member'>().notNull(),
    tokenHash: text('token_hash').notNull(),
    invitedBy: uuid('invited_by').references(() => users.id, { onDelete: 'set null' }),
    expiresAt: ts('expires_at').notNull(),
    acceptedAt: ts('accepted_at'),
    revokedAt: ts('revoked_at'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('workspace_invitations_token_unique').on(t.tokenHash),
    index('workspace_invitations_ws_idx').on(t.workspaceId),
  ],
);

export const plans = pgTable('plans', {
  key: text('key').primaryKey(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  limits: jsonb('limits').$type<PlanLimits>().notNull(),
  features: jsonb('features').$type<string[]>().notNull().default([]),
  stripePriceId: text('stripe_price_id'),
  sortOrder: integer('sort_order').notNull().default(0),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const subscriptions = pgTable(
  'subscriptions',
  {
    id: id(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    planKey: text('plan_key')
      .notNull()
      .references(() => plans.key),
    status: text('status')
      .$type<'trialing' | 'active' | 'past_due' | 'canceled' | 'incomplete' | 'unpaid' | 'expired'>()
      .notNull(),
    stripeSubscriptionId: text('stripe_subscription_id'),
    stripePriceId: text('stripe_price_id'),
    trialEndsAt: ts('trial_ends_at'),
    currentPeriodStart: ts('current_period_start'),
    currentPeriodEnd: ts('current_period_end'),
    cancelAtPeriodEnd: boolean('cancel_at_period_end').notNull().default(false),
    canceledAt: ts('canceled_at'),
    limitOverrides: jsonb('limit_overrides').$type<Partial<PlanLimits>>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('subscriptions_workspace_unique').on(t.workspaceId),
    uniqueIndex('subscriptions_stripe_unique').on(t.stripeSubscriptionId),
  ],
);

export const stripeEvents = pgTable('stripe_events', {
  id: text('id').primaryKey(),
  type: text('type').notNull(),
  processedAt: ts('processed_at').notNull().defaultNow(),
});

export const usageCounters = pgTable(
  'usage_counters',
  {
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    metric: text('metric').notNull(),
    period: text('period').notNull(),
    count: integer('count').notNull().default(0),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.metric, t.period] })],
);

// ---------------------------------------------------------------------------
// Email integrations
// ---------------------------------------------------------------------------

export const integrations = pgTable(
  'integrations',
  {
    id: id(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    provider: text('provider').$type<'gmail' | 'microsoft' | 'sandbox'>().notNull(),
    email: text('email').notNull(),
    displayName: text('display_name'),
    providerAccountId: text('provider_account_id'),
    status: text('status').$type<'active' | 'error' | 'disconnected'>().notNull().default('active'),
    scopes: text('scopes').array().notNull().default(sql`'{}'::text[]`),
    accessTokenEnc: text('access_token_enc'),
    refreshTokenEnc: text('refresh_token_enc'),
    tokenExpiresAt: ts('token_expires_at'),
    syncCursor: text('sync_cursor'),
    lastSyncedAt: ts('last_synced_at'),
    lastHealthCheckAt: ts('last_health_check_at'),
    lastError: text('last_error'),
    dailySendLimit: integer('daily_send_limit').notNull().default(200),
    isDefault: boolean('is_default').notNull().default(false),
    connectedBy: uuid('connected_by').references(() => users.id, { onDelete: 'set null' }),
    disconnectedAt: ts('disconnected_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('integrations_ws_provider_email_unique').on(t.workspaceId, t.provider, sql`lower(${t.email})`),
    index('integrations_ws_idx').on(t.workspaceId),
  ],
);

// ---------------------------------------------------------------------------
// Prospects
// ---------------------------------------------------------------------------

export const prospects = pgTable(
  'prospects',
  {
    id: id(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    /** Google place ID. Stored indefinitely as permitted by the Places API policies. */
    placeId: text('place_id'),
    source: text('source').$type<'google_places' | 'manual' | 'import' | 'dev_seed'>().notNull(),
    status: text('status')
      .$type<
        | 'new'
        | 'contacted'
        | 'follow_up'
        | 'replied'
        | 'interested'
        | 'not_interested'
        | 'client'
        | 'closed'
        | 'archived'
      >()
      .notNull()
      .default('new'),
    /** User-entered display name. Overrides the live Google listing name. */
    name: text('name'),
    contactFirstName: text('contact_first_name'),
    contactLastName: text('contact_last_name'),
    /** User-entered contact details. Google does not provide email addresses. */
    email: text('email'),
    phone: text('phone'),
    locationLabel: text('location_label'),
    categoryLabel: text('category_label'),
    /** User-entered website for manually created prospects. */
    websiteUrl: text('website_url'),
    /** Localy analysis snapshot: classification only, never the Google-provided URL. */
    websiteStatus: text('website_status')
      .$type<'listed' | 'not_listed' | 'detected' | 'unavailable' | 'unknown'>()
      .notNull()
      .default('unknown'),
    socialProfileOnly: boolean('social_profile_only').notNull().default(false),
    websiteCheckedAt: ts('website_checked_at'),
    websiteHttpStatus: integer('website_http_status'),
    /** Localy analysis snapshot: yes/no signals derived at the last live refresh. */
    signals: jsonb('signals').$type<Signals>().notNull().default({}),
    signalCount: integer('signal_count').notNull().default(0),
    analysisUpdatedAt: ts('analysis_updated_at'),
    discoveredSearchId: uuid('discovered_search_id'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    lastContactedAt: ts('last_contacted_at'),
    lastReplyAt: ts('last_reply_at'),
    unsubscribedAt: ts('unsubscribed_at'),
    archivedAt: ts('archived_at'),
    isDevData: boolean('is_dev_data').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('prospects_ws_place_unique')
      .on(t.workspaceId, t.placeId)
      .where(sql`${t.placeId} is not null`),
    index('prospects_ws_status_idx').on(t.workspaceId, t.status),
    index('prospects_ws_created_idx').on(t.workspaceId, t.createdAt),
    index('prospects_ws_email_idx').on(t.workspaceId, sql`lower(${t.email})`),
  ],
);

export const tags = pgTable(
  'tags',
  {
    id: id(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('tags_ws_name_unique').on(t.workspaceId, sql`lower(${t.name})`)],
);

export const prospectTags = pgTable(
  'prospect_tags',
  {
    prospectId: uuid('prospect_id')
      .notNull()
      .references(() => prospects.id, { onDelete: 'cascade' }),
    tagId: uuid('tag_id')
      .notNull()
      .references(() => tags.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.prospectId, t.tagId] }), index('prospect_tags_tag_idx').on(t.tagId)],
);

export const notes = pgTable(
  'notes',
  {
    id: id(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    prospectId: uuid('prospect_id')
      .notNull()
      .references(() => prospects.id, { onDelete: 'cascade' }),
    authorId: uuid('author_id').references(() => users.id, { onDelete: 'set null' }),
    body: text('body').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('notes_prospect_idx').on(t.prospectId), index('notes_ws_idx').on(t.workspaceId)],
);

export const activities = pgTable(
  'activities',
  {
    id: id(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    prospectId: uuid('prospect_id').references(() => prospects.id, { onDelete: 'cascade' }),
    campaignId: uuid('campaign_id'),
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    type: text('type').notNull(),
    data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
    // clock_timestamp() keeps events recorded in one transaction in order.
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
  },
  (t) => [
    index('activities_ws_created_idx').on(t.workspaceId, t.createdAt),
    index('activities_prospect_idx').on(t.prospectId, t.createdAt),
  ],
);

export const followUps = pgTable(
  'follow_ups',
  {
    id: id(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    prospectId: uuid('prospect_id')
      .notNull()
      .references(() => prospects.id, { onDelete: 'cascade' }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    dueAt: ts('due_at').notNull(),
    note: text('note'),
    status: text('status').$type<'scheduled' | 'done' | 'cancelled'>().notNull().default('scheduled'),
    completedAt: ts('completed_at'),
    notifiedAt: ts('notified_at'),
    createdAt: createdAt(),
  },
  (t) => [index('follow_ups_ws_due_idx').on(t.workspaceId, t.status, t.dueAt), index('follow_ups_prospect_idx').on(t.prospectId)],
);

export const suppressions = pgTable(
  'suppressions',
  {
    id: id(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    reason: text('reason').$type<'unsubscribed' | 'bounced' | 'manual'>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('suppressions_ws_email_unique').on(t.workspaceId, sql`lower(${t.email})`)],
);

// ---------------------------------------------------------------------------
// Templates and campaigns
// ---------------------------------------------------------------------------

export const emailTemplates = pgTable(
  'email_templates',
  {
    id: id(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    subject: text('subject').notNull(),
    body: text('body').notNull(),
    kind: text('kind').$type<'initial' | 'follow_up'>().notNull().default('initial'),
    defaultDelayDays: integer('default_delay_days').notNull().default(3),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    isDevData: boolean('is_dev_data').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('email_templates_ws_idx').on(t.workspaceId)],
);

export const campaigns = pgTable(
  'campaigns',
  {
    id: id(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    kind: text('kind').$type<'standard' | 'quick'>().notNull().default('standard'),
    status: text('status').$type<'draft' | 'scheduled' | 'active' | 'paused' | 'completed'>().notNull().default('draft'),
    integrationId: uuid('integration_id').references(() => integrations.id, { onDelete: 'set null' }),
    senderName: text('sender_name'),
    replyTo: text('reply_to'),
    dailyLimit: integer('daily_limit').notNull().default(40),
    startAt: ts('start_at'),
    timezone: text('timezone').notNull().default('UTC'),
    sendWindowStart: integer('send_window_start').notNull().default(8),
    sendWindowEnd: integer('send_window_end').notNull().default(17),
    sendDays: integer('send_days').array().notNull().default(sql`'{1,2,3,4,5}'::int[]`),
    stopOnReply: boolean('stop_on_reply').notNull().default(true),
    pauseReason: text('pause_reason'),
    lastQueuedAt: ts('last_queued_at'),
    /** Client-supplied key for composer sends, to make "Send" safe to retry. */
    idempotencyKey: text('idempotency_key'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    startedAt: ts('started_at'),
    completedAt: ts('completed_at'),
    isDevData: boolean('is_dev_data').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('campaigns_ws_idx').on(t.workspaceId, t.createdAt),
    index('campaigns_status_idx').on(t.status),
    uniqueIndex('campaigns_idempotency_unique')
      .on(t.workspaceId, t.idempotencyKey)
      .where(sql`${t.idempotencyKey} is not null`),
  ],
);

export const campaignSteps = pgTable(
  'campaign_steps',
  {
    id: id(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    templateId: uuid('template_id').references(() => emailTemplates.id, { onDelete: 'set null' }),
    subject: text('subject').notNull(),
    body: text('body').notNull(),
    waitDays: integer('wait_days').notNull().default(0),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('campaign_steps_position_unique').on(t.campaignId, t.position)],
);

export const emailThreads = pgTable(
  'email_threads',
  {
    id: id(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    integrationId: uuid('integration_id').references(() => integrations.id, { onDelete: 'set null' }),
    prospectId: uuid('prospect_id').references(() => prospects.id, { onDelete: 'cascade' }),
    campaignId: uuid('campaign_id').references(() => campaigns.id, { onDelete: 'set null' }),
    subject: text('subject').notNull(),
    providerThreadId: text('provider_thread_id'),
    status: text('status').$type<'open' | 'archived'>().notNull().default('open'),
    lastMessageAt: ts('last_message_at').notNull().defaultNow(),
    lastDirection: text('last_direction').$type<'outbound' | 'inbound'>().notNull().default('outbound'),
    lastPreview: text('last_preview').notNull().default(''),
    unread: boolean('unread').notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    index('email_threads_ws_last_idx').on(t.workspaceId, t.lastMessageAt),
    uniqueIndex('email_threads_provider_unique')
      .on(t.integrationId, t.providerThreadId)
      .where(sql`${t.providerThreadId} is not null`),
    index('email_threads_prospect_idx').on(t.prospectId),
  ],
);

export const campaignRecipients = pgTable(
  'campaign_recipients',
  {
    id: id(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    prospectId: uuid('prospect_id')
      .notNull()
      .references(() => prospects.id, { onDelete: 'cascade' }),
    status: text('status')
      .$type<
        'pending' | 'in_progress' | 'replied' | 'completed' | 'bounced' | 'failed' | 'unsubscribed' | 'stopped' | 'skipped'
      >()
      .notNull()
      .default('pending'),
    /** Number of steps already sent. The next step to send is steps[currentStep]. */
    currentStep: integer('current_step').notNull().default(0),
    nextSendAt: ts('next_send_at'),
    lastSentAt: ts('last_sent_at'),
    repliedAt: ts('replied_at'),
    stoppedReason: text('stopped_reason'),
    /** Set while a message for the next step is queued, to prevent double queuing. */
    pendingMessageId: uuid('pending_message_id'),
    threadId: uuid('thread_id').references(() => emailThreads.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('campaign_recipients_unique').on(t.campaignId, t.prospectId),
    index('campaign_recipients_due_idx').on(t.campaignId, t.status, t.nextSendAt),
    index('campaign_recipients_prospect_idx').on(t.prospectId),
  ],
);

export const emailMessages = pgTable(
  'email_messages',
  {
    id: id(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    threadId: uuid('thread_id').references(() => emailThreads.id, { onDelete: 'set null' }),
    integrationId: uuid('integration_id').references(() => integrations.id, { onDelete: 'set null' }),
    prospectId: uuid('prospect_id').references(() => prospects.id, { onDelete: 'set null' }),
    campaignId: uuid('campaign_id').references(() => campaigns.id, { onDelete: 'set null' }),
    recipientId: uuid('recipient_id').references(() => campaignRecipients.id, { onDelete: 'set null' }),
    stepPosition: integer('step_position'),
    direction: text('direction').$type<'outbound' | 'inbound'>().notNull(),
    status: text('status')
      .$type<'queued' | 'sending' | 'sent' | 'failed' | 'cancelled' | 'bounced' | 'received'>()
      .notNull(),
    idempotencyKey: text('idempotency_key'),
    messageIdHeader: text('message_id_header'),
    inReplyTo: text('in_reply_to'),
    providerMessageId: text('provider_message_id'),
    fromEmail: text('from_email').notNull(),
    fromName: text('from_name'),
    toEmail: text('to_email').notNull(),
    replyTo: text('reply_to'),
    subject: text('subject').notNull(),
    bodyText: text('body_text').notNull(),
    scheduledFor: ts('scheduled_for'),
    sentAt: ts('sent_at'),
    receivedAt: ts('received_at'),
    attempts: integer('attempts').notNull().default(0),
    error: text('error'),
    isTest: boolean('is_test').notNull().default(false),
    isPositive: boolean('is_positive'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // One live message per idempotency key. Cancelled messages were never sent,
    // so they do not block a replacement (for example after pause and resume).
    uniqueIndex('email_messages_idempotency_unique')
      .on(t.idempotencyKey)
      .where(sql`${t.idempotencyKey} is not null and ${t.status} <> 'cancelled'`),
    uniqueIndex('email_messages_provider_unique')
      .on(t.integrationId, t.providerMessageId)
      .where(sql`${t.providerMessageId} is not null`),
    index('email_messages_ws_created_idx').on(t.workspaceId, t.createdAt),
    index('email_messages_campaign_idx').on(t.campaignId, t.status),
    index('email_messages_thread_idx').on(t.threadId, t.createdAt),
    index('email_messages_prospect_idx').on(t.prospectId),
    index('email_messages_status_idx').on(t.status, t.scheduledFor),
  ],
);

export const emailEvents = pgTable(
  'email_events',
  {
    id: id(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    messageId: uuid('message_id').references(() => emailMessages.id, { onDelete: 'cascade' }),
    campaignId: uuid('campaign_id').references(() => campaigns.id, { onDelete: 'set null' }),
    prospectId: uuid('prospect_id').references(() => prospects.id, { onDelete: 'set null' }),
    type: text('type')
      .$type<'queued' | 'sent' | 'failed' | 'retry' | 'bounced' | 'replied' | 'unsubscribed' | 'cancelled'>()
      .notNull(),
    stepPosition: integer('step_position'),
    data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
  },
  (t) => [
    index('email_events_ws_created_idx').on(t.workspaceId, t.createdAt),
    index('email_events_campaign_idx').on(t.campaignId, t.type),
  ],
);

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

export interface StoredSearchConfig {
  categories: string[];
  keyword?: string | null;
  location: LocationValue;
  radiusMeters: number;
  filters: DiscoveryFilters;
}

export const savedSearches = pgTable(
  'saved_searches',
  {
    id: id(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    config: jsonb('config').$type<StoredSearchConfig>().notNull(),
    coordsCachedAt: ts('coords_cached_at'),
    lastRunAt: ts('last_run_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('saved_searches_ws_idx').on(t.workspaceId)],
);

export const searchHistory = pgTable(
  'search_history',
  {
    id: id(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    categories: text('categories').array().notNull().default(sql`'{}'::text[]`),
    keyword: text('keyword'),
    location: jsonb('location').$type<LocationValue>().notNull(),
    radiusMeters: integer('radius_meters').notNull(),
    filters: jsonb('filters').$type<DiscoveryFilters>().notNull(),
    resultCount: integer('result_count').notNull().default(0),
    opportunityCount: integer('opportunity_count').notNull().default(0),
    /** Place IDs only, which may be stored indefinitely. */
    placeIds: text('place_ids').array().notNull().default(sql`'{}'::text[]`),
    requestsMade: integer('requests_made').notNull().default(0),
    coordsCachedAt: ts('coords_cached_at'),
    createdAt: createdAt(),
  },
  (t) => [index('search_history_ws_created_idx').on(t.workspaceId, t.createdAt)],
);

/**
 * Place IDs returned to a workspace by discovery searches. Place IDs are the
 * only Places API field that may be stored indefinitely. Used for monthly
 * usage metering (unique businesses discovered) and "new since last search".
 */
export const discoveredPlaces = pgTable(
  'discovered_places',
  {
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    placeId: text('place_id').notNull(),
    firstSeenAt: ts('first_seen_at').notNull().defaultNow(),
    lastSeenAt: ts('last_seen_at').notNull().defaultNow(),
    firstSearchId: uuid('first_search_id'),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.placeId] }),
    index('discovered_places_ws_last_idx').on(t.workspaceId, t.lastSeenAt),
    index('discovered_places_ws_first_idx').on(t.workspaceId, t.firstSeenAt),
  ],
);

// ---------------------------------------------------------------------------
// Platform
// ---------------------------------------------------------------------------

export const notifications = pgTable(
  'notifications',
  {
    id: id(),
    workspaceId: uuid('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    title: text('title').notNull(),
    body: text('body'),
    link: text('link'),
    dedupeKey: text('dedupe_key'),
    readAt: ts('read_at'),
    createdAt: createdAt(),
  },
  (t) => [
    index('notifications_user_idx').on(t.userId, t.createdAt),
    uniqueIndex('notifications_dedupe_unique')
      .on(t.userId, t.dedupeKey)
      .where(sql`${t.dedupeKey} is not null`),
  ],
);

export const apiKeys = pgTable(
  'api_keys',
  {
    id: id(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    prefix: text('prefix').notNull(),
    keyHash: text('key_hash').notNull(),
    scope: text('scope').$type<'read' | 'write'>().notNull().default('read'),
    lastUsedAt: ts('last_used_at'),
    revokedAt: ts('revoked_at'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('api_keys_hash_unique').on(t.keyHash), index('api_keys_ws_idx').on(t.workspaceId)],
);

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: id(),
    workspaceId: uuid('workspace_id').references(() => workspaces.id, { onDelete: 'set null' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    actorEmail: text('actor_email'),
    action: text('action').notNull(),
    targetType: text('target_type'),
    targetId: text('target_id'),
    ip: text('ip'),
    userAgent: text('user_agent'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [
    index('audit_logs_ws_created_idx').on(t.workspaceId, t.createdAt),
    index('audit_logs_action_idx').on(t.action, t.createdAt),
    index('audit_logs_user_idx').on(t.userId, t.createdAt),
  ],
);

export const errorLogs = pgTable(
  'error_logs',
  {
    id: id(),
    source: text('source').$type<'api' | 'worker'>().notNull(),
    requestId: text('request_id'),
    route: text('route'),
    method: text('method'),
    statusCode: integer('status_code'),
    code: text('code'),
    message: text('message').notNull(),
    stack: text('stack'),
    context: jsonb('context').$type<Record<string, unknown>>().notNull().default({}),
    workspaceId: uuid('workspace_id'),
    userId: uuid('user_id'),
    createdAt: createdAt(),
  },
  (t) => [index('error_logs_created_idx').on(t.createdAt)],
);

export const externalApiLogs = pgTable(
  'external_api_logs',
  {
    id: id(),
    service: text('service').$type<'places' | 'geocoding' | 'gmail' | 'graph' | 'stripe' | 'ai' | 'oauth' | 'website'>().notNull(),
    operation: text('operation').notNull(),
    ok: boolean('ok').notNull(),
    httpStatus: integer('http_status'),
    errorCode: text('error_code'),
    durationMs: integer('duration_ms').notNull(),
    workspaceId: uuid('workspace_id'),
    createdAt: createdAt(),
  },
  (t) => [index('external_api_logs_service_idx').on(t.service, t.createdAt)],
);

export const systemSettings = pgTable('system_settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').$type<unknown>().notNull(),
  updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
  updatedAt: updatedAt(),
});

export const dailyMetrics = pgTable(
  'daily_metrics',
  {
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    day: date('day').notNull(),
    metrics: jsonb('metrics').$type<Record<string, number>>().notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.day] })],
);

/** Development-only capture of system emails when no SMTP server is configured. */
export const devOutbox = pgTable('dev_outbox', {
  id: id(),
  toEmail: text('to_email').notNull(),
  subject: text('subject').notNull(),
  text: text('text').notNull(),
  createdAt: createdAt(),
});
