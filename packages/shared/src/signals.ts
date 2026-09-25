import type { WebsiteStatus } from './constants';
import { isWebsiteOpportunity } from './website';

/**
 * Transparent prioritization signals. Localy never produces an opaque score.
 * Each signal is a yes/no fact derived from data the user can see, with a
 * plain-language explanation, so users can sort and filter by whichever
 * factors matter to them.
 */
export const SIGNAL_KEYS = [
  'noWebsiteListed',
  'socialProfileOnly',
  'websiteUnavailable',
  'strongRating',
  'highReviewCount',
  'hasPhone',
  'hasEmail',
  'operational',
] as const;
export type SignalKey = (typeof SIGNAL_KEYS)[number];
export type Signals = Partial<Record<SignalKey, boolean>>;

export const SIGNAL_THRESHOLDS = {
  strongRating: 4.3,
  highReviewCount: 50,
};

export const SIGNAL_DEFINITIONS: Record<SignalKey, { label: string; description: string }> = {
  noWebsiteListed: {
    label: 'No website listed',
    description: 'The Google Maps listing does not include a website link.',
  },
  socialProfileOnly: {
    label: 'Social profile only',
    description: 'The only link listed is a social media or link-in-bio page, not a dedicated website.',
  },
  websiteUnavailable: {
    label: 'Website unavailable',
    description: 'A website is listed but did not respond when Localy checked it.',
  },
  strongRating: {
    label: 'Strong rating',
    description: `Average Google rating of ${SIGNAL_THRESHOLDS.strongRating} or higher. Established businesses with happy customers often value a professional web presence.`,
  },
  highReviewCount: {
    label: 'High review count',
    description: `${SIGNAL_THRESHOLDS.highReviewCount} or more Google reviews, which suggests an active customer base.`,
  },
  hasPhone: {
    label: 'Phone listed',
    description: 'A phone number is listed, so you can call to introduce yourself or confirm an email address.',
  },
  hasEmail: {
    label: 'Email on file',
    description: 'You have added a contact email address for this prospect.',
  },
  operational: {
    label: 'Operational',
    description: 'The listing is marked as operational (not temporarily or permanently closed).',
  },
};

export interface SignalInput {
  websiteStatus: WebsiteStatus;
  socialProfileOnly?: boolean;
  rating?: number | null;
  userRatingCount?: number | null;
  hasPhone?: boolean | null;
  hasEmail?: boolean | null;
  businessStatus?: string | null;
}

export function computeSignals(input: SignalInput): Signals {
  const signals: Signals = {
    noWebsiteListed: input.websiteStatus === 'not_listed',
    socialProfileOnly: Boolean(input.socialProfileOnly),
    websiteUnavailable: input.websiteStatus === 'unavailable',
  };
  if (input.rating !== undefined) signals.strongRating = (input.rating ?? 0) >= SIGNAL_THRESHOLDS.strongRating;
  if (input.userRatingCount !== undefined)
    signals.highReviewCount = (input.userRatingCount ?? 0) >= SIGNAL_THRESHOLDS.highReviewCount;
  if (input.hasPhone !== undefined && input.hasPhone !== null) signals.hasPhone = input.hasPhone;
  if (input.hasEmail !== undefined && input.hasEmail !== null) signals.hasEmail = input.hasEmail;
  if (input.businessStatus !== undefined)
    signals.operational = !input.businessStatus || input.businessStatus === 'OPERATIONAL';
  return signals;
}

export function countPositiveSignals(signals: Signals): number {
  return SIGNAL_KEYS.filter((k) => signals[k]).length;
}

export function isOpportunity(websiteStatus: WebsiteStatus, signals: Signals): boolean {
  return isWebsiteOpportunity(websiteStatus, Boolean(signals.socialProfileOnly));
}
