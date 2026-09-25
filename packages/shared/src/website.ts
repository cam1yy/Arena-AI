import type { WebsiteStatus } from './constants';

/**
 * Hosts that indicate a social profile or link aggregator rather than a
 * dedicated business website. A listing that only links to one of these is
 * surfaced as a potential opportunity, but is still reported as "listed".
 */
export const SOCIAL_PROFILE_HOSTS = [
  'facebook.com',
  'fb.com',
  'fb.me',
  'instagram.com',
  'twitter.com',
  'x.com',
  'tiktok.com',
  'linkedin.com',
  'youtube.com',
  'linktr.ee',
  'linkin.bio',
  'wa.me',
  'whatsapp.com',
  'yelp.com',
  'business.site',
  'g.page',
  'sites.google.com',
  'booksy.com',
  'fresha.com',
  'square.site',
];

export interface WebsiteClassification {
  status: WebsiteStatus;
  url: string | null;
  host: string | null;
  socialProfileOnly: boolean;
}

export function hostOf(url: string): string | null {
  try {
    const u = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`);
    return u.hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Classify the website field returned by the Places API.
 * `fieldRequested` must be true only when the websiteUri field was part of
 * the field mask and the request succeeded; otherwise the result is unknown.
 */
export function classifyListedWebsite(websiteUri: string | null | undefined, fieldRequested: boolean): WebsiteClassification {
  if (!fieldRequested) return { status: 'unknown', url: null, host: null, socialProfileOnly: false };
  const url = websiteUri?.trim() || null;
  if (!url) return { status: 'not_listed', url: null, host: null, socialProfileOnly: false };
  const host = hostOf(url);
  const socialProfileOnly = host
    ? SOCIAL_PROFILE_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))
    : false;
  return { status: 'listed', url, host, socialProfileOnly };
}

/** Whether a website status represents a potential website opportunity. */
export function isWebsiteOpportunity(status: WebsiteStatus, socialProfileOnly = false): boolean {
  return status === 'not_listed' || status === 'unavailable' || socialProfileOnly;
}
