import { describe, expect, it } from 'vitest';
import {
  boundsForCircle,
  checkPassword,
  classifyListedWebsite,
  computeSignals,
  extractVariables,
  formatDistance,
  haversineMeters,
  isWebsiteOpportunity,
  passesFilters,
  renderEmail,
  renderTemplate,
  sortResults,
  textToHtml,
  type DiscoveryResult,
} from './index';

describe('template rendering', () => {
  it('replaces known variables and applies inline and default fallbacks', () => {
    const r = renderTemplate('Hi {{firstName}}, {{ businessName }} in {{location|town}}', { businessName: 'Cuts' });
    expect(r.output).toBe('Hi there, Cuts in town');
    expect(r.missing).toEqual([]);
  });
  it('reports missing variables without a fallback and leaves unknown ones visible', () => {
    const r = renderTemplate('{{businessName}} {{unknownThing}}', {});
    expect(r.output).toBe(' {{unknownThing}}');
    expect(r.missing).toEqual(['businessName']);
    expect(r.unknown).toEqual(['unknownThing']);
  });
  it('can keep placeholders visible when previewing without a recipient', () => {
    expect(renderTemplate('Hi {{businessName}}', {}, { keepMissing: true }).output).toBe('Hi {{businessName}}');
  });
  it('collapses whitespace in subjects', () => {
    expect(renderEmail('A  {{businessName}}\n idea', 'x', { businessName: 'B' }).subject).toBe('A B idea');
  });
  it('extracts variable names', () => {
    expect(extractVariables('{{a}} {{ b|c }} {{a}}')).toEqual(['a', 'b']);
  });
  it('escapes HTML when converting text emails', () => {
    const html = textToHtml('<script>x</script>\n\nhttps://example.com/a?b=1');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('<a href="https://example.com/a?b=1">');
  });
});

describe('website classification', () => {
  it('never claims "no website" when the field was not requested', () => {
    expect(classifyListedWebsite(null, false).status).toBe('unknown');
  });
  it('distinguishes listed, not listed and social-profile-only', () => {
    expect(classifyListedWebsite(undefined, true).status).toBe('not_listed');
    expect(classifyListedWebsite('https://www.barber.co.za', true)).toMatchObject({ status: 'listed', socialProfileOnly: false, host: 'barber.co.za' });
    expect(classifyListedWebsite('https://m.facebook.com/barber', true)).toMatchObject({ status: 'listed', socialProfileOnly: true });
    expect(classifyListedWebsite('linktr.ee/barber', true).socialProfileOnly).toBe(true);
  });
  it('treats not listed, unavailable and social-only as opportunities', () => {
    expect(isWebsiteOpportunity('not_listed')).toBe(true);
    expect(isWebsiteOpportunity('unavailable')).toBe(true);
    expect(isWebsiteOpportunity('listed', true)).toBe(true);
    expect(isWebsiteOpportunity('listed')).toBe(false);
    expect(isWebsiteOpportunity('detected')).toBe(false);
    expect(isWebsiteOpportunity('unknown')).toBe(false);
  });
});

describe('signals', () => {
  it('computes transparent yes/no signals from listing data', () => {
    expect(computeSignals({ websiteStatus: 'not_listed', rating: 4.5, userRatingCount: 80, hasPhone: true, businessStatus: 'OPERATIONAL' })).toMatchObject({
      noWebsiteListed: true,
      strongRating: true,
      highReviewCount: true,
      hasPhone: true,
      operational: true,
    });
    expect(computeSignals({ websiteStatus: 'listed', rating: 3.9, userRatingCount: 10 })).toMatchObject({ noWebsiteListed: false, strongRating: false, highReviewCount: false });
  });
});

describe('geo', () => {
  it('computes distances and bounding boxes', () => {
    const d = haversineMeters({ lat: -33.9249, lng: 18.4241 }, { lat: -33.9249, lng: 18.5241 });
    expect(d).toBeGreaterThan(9000);
    expect(d).toBeLessThan(9400);
    const b = boundsForCircle({ lat: 0, lng: 0 }, 10_000);
    expect(b.high.latitude).toBeCloseTo(0.0899, 3);
    expect(formatDistance(850)).toBe('850 m');
    expect(formatDistance(12_400)).toBe('12 km');
    expect(formatDistance(1609.344 * 2, 'mi')).toBe('2.0 mi');
  });
});

describe('passwords', () => {
  it('enforces length, letters, numbers and rejects common passwords', () => {
    expect(checkPassword('short1').valid).toBe(false);
    expect(checkPassword('onlyletterslong').valid).toBe(false);
    expect(checkPassword('password1234').valid).toBe(false);
    expect(checkPassword('a-good-passphrase-7').valid).toBe(true);
  });
});

describe('discovery filtering and sorting', () => {
  const base: DiscoveryResult = {
    placeId: 'a', name: 'A', primaryType: null, category: null, types: [], rating: 4.5, userRatingCount: 20, address: null, shortAddress: null, locality: null,
    phone: '1', internationalPhone: null, websiteUri: null, googleMapsUri: null, location: null, businessStatus: 'OPERATIONAL', openNow: true, weekdayHours: null,
    pureServiceArea: false, attributions: [], distanceMeters: 500, websiteStatus: 'not_listed', socialProfileOnly: false, websiteCheck: null, signals: { noWebsiteListed: true }, opportunity: true, matchedQueries: [], prospectId: null,
  };
  const f = { website: 'any' as const, phone: 'any' as const, operationalOnly: true };
  it('filters by website status, rating, reviews, phone and business status', () => {
    expect(passesFilters(base, { ...f, website: 'opportunity' })).toBe(true);
    expect(passesFilters({ ...base, websiteStatus: 'listed', opportunity: false }, { ...f, website: 'opportunity' })).toBe(false);
    expect(passesFilters(base, { ...f, minRating: 4.6 })).toBe(false);
    expect(passesFilters(base, { ...f, maxRating: 4 })).toBe(false);
    expect(passesFilters(base, { ...f, minReviews: 50 })).toBe(false);
    expect(passesFilters({ ...base, phone: null }, { ...f, phone: 'has' })).toBe(false);
    expect(passesFilters({ ...base, businessStatus: 'CLOSED_PERMANENTLY' }, f)).toBe(false);
    expect(passesFilters({ ...base, openNow: false }, { ...f, openNow: true })).toBe(false);
  });
  it('sorts by distance, rating, reviews and signal count', () => {
    const list = [
      { ...base, placeId: 'far', distanceMeters: 5000, rating: 5, userRatingCount: 1, signals: {} },
      { ...base, placeId: 'near', distanceMeters: 100, rating: 3, userRatingCount: 500, signals: { a: true, b: true } as never },
    ];
    expect(sortResults(list, 'distance')[0].placeId).toBe('near');
    expect(sortResults(list, 'rating')[0].placeId).toBe('far');
    expect(sortResults(list, 'reviews')[0].placeId).toBe('near');
    expect(sortResults(list, 'signals')[0].placeId).toBe('near');
  });
});
