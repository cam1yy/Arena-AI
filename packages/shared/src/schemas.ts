import { z } from 'zod';
import {
  CAMPAIGN_STATUSES,
  DISTANCE_UNITS,
  MAX_RADIUS_METERS,
  MIN_RADIUS_METERS,
  PROSPECT_STATUSES,
  ROLES,
  USE_CASES,
  WEBSITE_FILTERS,
  WEBSITE_STATUSES,
} from './constants';
import { PASSWORD_MAX_LENGTH } from './password';
import { SIGNAL_KEYS } from './signals';

const trimmed = (max: number) => z.string().trim().max(max);
const optionalTrimmed = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v === undefined ? undefined : v === null || v === '' ? null : v));

export const emailSchema = z.string().trim().toLowerCase().email('Enter a valid email address').max(254);

export const signUpSchema = z.object({
  name: trimmed(100).min(1, 'Enter your name'),
  email: emailSchema,
  password: z.string().min(1, 'Enter a password').max(PASSWORD_MAX_LENGTH),
  workspaceName: trimmed(100).min(1, 'Enter a company or workspace name'),
});

export const signInSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Enter your password').max(PASSWORD_MAX_LENGTH),
});

export const locationSchema = z.object({
  label: trimmed(200).min(1),
  placeId: z.string().trim().max(300).optional().nullable(),
  lat: z.number().min(-90).max(90).optional().nullable(),
  lng: z.number().min(-180).max(180).optional().nullable(),
  source: z.enum(['google', 'pin', 'device']).default('google'),
  resolvedAt: z.string().optional().nullable(),
});
export type LocationValue = z.infer<typeof locationSchema>;

export const discoveryFiltersSchema = z.object({
  minRating: z.number().min(0).max(5).optional().nullable(),
  maxRating: z.number().min(0).max(5).optional().nullable(),
  minReviews: z.number().int().min(0).max(100000).optional().nullable(),
  openNow: z.boolean().optional().nullable(),
  website: z.enum(WEBSITE_FILTERS).default('any'),
  phone: z.enum(['any', 'has', 'none']).default('any'),
  operationalOnly: z.boolean().default(true),
});
export type DiscoveryFilters = z.infer<typeof discoveryFiltersSchema>;

export const discoverySearchSchema = z.object({
  categories: z.array(trimmed(80).min(1)).max(5).default([]),
  keyword: trimmed(120).optional().nullable(),
  location: locationSchema,
  radiusMeters: z.number().int().min(MIN_RADIUS_METERS).max(MAX_RADIUS_METERS),
  filters: discoveryFiltersSchema.default({ website: 'any', phone: 'any', operationalOnly: true }),
  pageTokens: z.record(z.string(), z.string()).optional().nullable(),
  searchId: z.string().uuid().optional().nullable(),
  savedSearchId: z.string().uuid().optional().nullable(),
});
export type DiscoverySearchInput = z.infer<typeof discoverySearchSchema>;

export const savedSearchSchema = z.object({
  name: trimmed(120).min(1, 'Name your search'),
  config: z.object({
    categories: z.array(trimmed(80)).max(5),
    keyword: trimmed(120).optional().nullable(),
    location: locationSchema,
    radiusMeters: z.number().int().min(MIN_RADIUS_METERS).max(MAX_RADIUS_METERS),
    filters: discoveryFiltersSchema,
  }),
});

export const saveProspectsSchema = z.object({
  searchId: z.string().uuid().optional().nullable(),
  businesses: z
    .array(
      z.object({
        placeId: z.string().trim().min(1).max(300),
        // Localy's own analysis from the search results (derived flags, not Google content).
        websiteStatus: z.enum(WEBSITE_STATUSES).default('unknown'),
        socialProfileOnly: z.boolean().default(false),
        signals: z.partialRecord(z.enum(SIGNAL_KEYS), z.boolean()).default({}),
      }),
    )
    .min(1)
    .max(100),
  tagIds: z.array(z.string().uuid()).max(20).optional(),
});

export const prospectContactSchema = z.object({
  name: optionalTrimmed(200),
  contactFirstName: optionalTrimmed(100),
  contactLastName: optionalTrimmed(100),
  email: z
    .union([emailSchema, z.literal(''), z.null()])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === '' || v === null ? null : v)),
  phone: optionalTrimmed(50),
  locationLabel: optionalTrimmed(120),
  categoryLabel: optionalTrimmed(120),
  websiteUrl: optionalTrimmed(500),
});

export const createProspectSchema = prospectContactSchema.extend({
  name: trimmed(200).min(1, 'Enter a business name'),
  status: z.enum(PROSPECT_STATUSES).optional(),
  tagIds: z.array(z.string().uuid()).max(20).optional(),
  note: trimmed(5000).optional(),
});

export const updateProspectSchema = prospectContactSchema.extend({
  status: z.enum(PROSPECT_STATUSES).optional(),
});

export const prospectListQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  /** Comma-separated prospect IDs (for example the composer's recipients). */
  ids: z
    .string()
    .max(40_000)
    .optional()
    .transform((v) => (v ? v.split(',').filter((x) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 500) : undefined)),
  status: z.enum([...PROSPECT_STATUSES, 'active', 'all']).optional(),
  tagId: z.string().uuid().optional(),
  website: z.enum(['any', ...WEBSITE_STATUSES, 'opportunity']).optional(),
  hasEmail: z.enum(['any', 'yes', 'no']).optional(),
  campaignId: z.string().uuid().optional(),
  signal: z.enum(SIGNAL_KEYS).optional(),
  sort: z
    .enum(['created_desc', 'created_asc', 'name_asc', 'updated_desc', 'last_contacted_desc', 'signals_desc', ...SIGNAL_KEYS])
    .optional(),
  page: z.coerce.number().int().min(1).max(10000).default(1),
  // Up to 500 when loading an explicit ID list; lists are otherwise paginated at 100.
  pageSize: z.coerce.number().int().min(1).max(500).default(50),
});

export const bulkProspectSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(500),
  action: z.enum(['status', 'add_tag', 'remove_tag', 'archive', 'delete', 'add_to_campaign']),
  status: z.enum(PROSPECT_STATUSES).optional(),
  tagId: z.string().uuid().optional(),
  tagName: trimmed(40).optional(),
  campaignId: z.string().uuid().optional(),
});

export const noteSchema = z.object({ body: trimmed(5000).min(1, 'Write a note') });
export const tagSchema = z.object({ name: trimmed(40).min(1, 'Name the tag') });

export const templateSchema = z.object({
  name: trimmed(120).min(1, 'Name the template'),
  subject: trimmed(300).min(1, 'Add a subject'),
  body: trimmed(20000).min(1, 'Write the message'),
  kind: z.enum(['initial', 'follow_up']).default('initial'),
  defaultDelayDays: z.number().int().min(0).max(60).default(3),
});

export const campaignStepSchema = z.object({
  id: z.string().uuid().optional(),
  templateId: z.string().uuid().optional().nullable(),
  subject: trimmed(300).min(1, 'Each step needs a subject'),
  body: trimmed(20000).min(1, 'Each step needs a message'),
  waitDays: z.number().int().min(0).max(60),
  enabled: z.boolean().default(true),
});

export const campaignSchema = z.object({
  name: trimmed(120).min(1, 'Name the campaign'),
  integrationId: z.string().uuid().optional().nullable(),
  senderName: optionalTrimmed(100),
  replyTo: z
    .union([emailSchema, z.literal(''), z.null()])
    .optional()
    .transform((v) => (v === '' ? null : v)),
  dailyLimit: z.number().int().min(1).max(2000).default(40),
  startAt: z.string().datetime({ offset: true }).optional().nullable(),
  timezone: z.string().trim().max(64).default('UTC'),
  sendWindowStart: z.number().int().min(0).max(23).default(8),
  sendWindowEnd: z.number().int().min(1).max(24).default(17),
  sendDays: z.array(z.number().int().min(1).max(7)).min(1).default([1, 2, 3, 4, 5]),
  stopOnReply: z.boolean().default(true),
  steps: z.array(campaignStepSchema).min(1, 'Add at least one email').max(8),
  prospectIds: z.array(z.string().uuid()).max(5000).optional(),
});

export const campaignStatusActionSchema = z.object({
  action: z.enum(['start', 'pause', 'resume', 'complete']),
});

export const composeSchema = z.object({
  prospectIds: z.array(z.string().uuid()).min(1).max(500),
  integrationId: z.string().uuid(),
  subject: trimmed(300).min(1, 'Add a subject'),
  body: trimmed(20000).min(1, 'Write the message'),
  scheduledFor: z.string().datetime({ offset: true }).optional().nullable(),
  followUps: z
    .array(z.object({ subject: trimmed(300).min(1), body: trimmed(20000).min(1), waitDays: z.number().int().min(1).max(60) }))
    .max(5)
    .default([]),
  idempotencyKey: z.string().trim().min(8).max(120),
  campaignName: optionalTrimmed(120),
});

export const testEmailSchema = z.object({
  integrationId: z.string().uuid(),
  to: emailSchema.optional(),
  subject: trimmed(300).min(1),
  body: trimmed(20000).min(1),
  prospectId: z.string().uuid().optional().nullable(),
});

export const replySchema = z.object({
  body: trimmed(20000).min(1, 'Write a reply'),
});

export const followUpSchema = z.object({
  prospectId: z.string().uuid(),
  dueAt: z.string().datetime({ offset: true }),
  note: trimmed(1000).optional().nullable(),
});

export const onboardingSchema = z.object({
  step: z.number().int().min(1).max(6),
  useCase: z.enum(USE_CASES.map((u) => u.id) as [string, ...string[]]).optional().nullable(),
  business: z
    .object({
      agencyName: trimmed(120).optional().nullable(),
      website: trimmed(300).optional().nullable(),
      industry: trimmed(120).optional().nullable(),
      location: trimmed(200).optional().nullable(),
      senderName: trimmed(100).optional().nullable(),
    })
    .optional(),
  targets: z
    .object({
      categories: z.array(trimmed(80)).max(20),
      locations: z.array(locationSchema).max(10),
      minRating: z.number().min(0).max(5).nullable(),
      maxRating: z.number().min(0).max(5).nullable(),
      websiteFilter: z.enum(WEBSITE_FILTERS),
      radiusMeters: z.number().int().min(MIN_RADIUS_METERS).max(MAX_RADIUS_METERS),
    })
    .optional(),
  complete: z.boolean().optional(),
});

export const profileSchema = z.object({
  name: trimmed(100).min(1, 'Enter your name'),
  timezone: trimmed(64).min(1),
  distanceUnit: z.enum(DISTANCE_UNITS).optional(),
});

export const workspaceSettingsSchema = z.object({
  name: trimmed(100).min(1).optional(),
  agencyName: optionalTrimmed(120),
  website: optionalTrimmed(300),
  industry: optionalTrimmed(120),
  businessLocation: optionalTrimmed(200),
  defaultSenderName: optionalTrimmed(100),
  defaultReplyTo: z
    .union([emailSchema, z.literal(''), z.null()])
    .optional()
    .transform((v) => (v === '' ? null : v)),
  signature: optionalTrimmed(2000),
  postalAddress: optionalTrimmed(300),
  includeUnsubscribeFooter: z.boolean().optional(),
  defaultLocation: locationSchema.optional().nullable(),
  defaultRadiusMeters: z.number().int().min(MIN_RADIUS_METERS).max(MAX_RADIUS_METERS).optional(),
  defaultCategories: z.array(trimmed(80)).max(20).optional(),
  minRating: z.number().min(0).max(5).optional().nullable(),
  maxRating: z.number().min(0).max(5).optional().nullable(),
  websiteFilter: z.enum(WEBSITE_FILTERS).optional(),
  distanceUnit: z.enum(DISTANCE_UNITS).optional(),
});

export const inviteSchema = z.object({ email: emailSchema, role: z.enum(ROLES).exclude(['owner']) });
export const memberRoleSchema = z.object({ role: z.enum(ROLES) });

export const changePasswordSchema = z.object({
  currentPassword: z.string().max(PASSWORD_MAX_LENGTH).optional(),
  newPassword: z.string().min(1).max(PASSWORD_MAX_LENGTH),
});

export const apiKeySchema = z.object({
  name: trimmed(80).min(1, 'Name the key'),
  scope: z.enum(['read', 'write']).default('read'),
});

export const campaignStatusSchema = z.enum(CAMPAIGN_STATUSES);

export const aiRequestSchema = z.object({
  task: z.enum(['draft', 'rewrite', 'subjects', 'summarize_notes', 'pitch_ideas']),
  prospectId: z.string().uuid().optional().nullable(),
  subject: trimmed(300).optional().nullable(),
  body: trimmed(20000).optional().nullable(),
  instructions: trimmed(1000).optional().nullable(),
  tone: z.enum(['friendly', 'professional', 'concise']).optional().nullable(),
});
