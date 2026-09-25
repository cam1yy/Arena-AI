import { describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret, signUnsubscribeToken, verifyUnsubscribeToken } from './crypto';
import { can } from './permissions';
import { isWithinSendWindow, localTimeParts, startOfLocalDay } from './services/sending';
import { buildQueries } from './services/discovery';
import { __test as websiteCheck } from './google/website-check';
import { stripQuotedText, isBounceSender, parseAddress } from '@localy/email';

describe('credential encryption', () => {
  it('round-trips with AES-256-GCM and detects tampering', () => {
    const enc = encryptSecret('refresh-token-value');
    expect(enc.startsWith('v1.')).toBe(true);
    expect(enc).not.toContain('refresh-token-value');
    expect(decryptSecret(enc)).toBe('refresh-token-value');
    const parts = enc.split('.');
    parts[3] = Buffer.from('tampered').toString('base64url');
    expect(() => decryptSecret(parts.join('.'))).toThrow();
    expect(encryptSecret('x')).not.toBe(encryptSecret('x'));
  });
});

describe('unsubscribe tokens', () => {
  it('encodes workspace, prospect and email, and rejects forgeries', () => {
    const t = signUnsubscribeToken('11111111-2222-3333-4444-555555555555', 'Owner@Shop.test', null);
    expect(verifyUnsubscribeToken(t)).toEqual({ workspaceId: '11111111-2222-3333-4444-555555555555', prospectId: null, email: 'owner@shop.test' });
    expect(verifyUnsubscribeToken(t.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A')))).toBeNull();
    expect(t.length).toBeLessThan(110);
  });
});

describe('permissions', () => {
  it('limits sensitive actions to owners and admins', () => {
    expect(can('member', 'prospects.write')).toBe(true);
    expect(can('member', 'billing.manage')).toBe(false);
    expect(can('member', 'members.manage')).toBe(false);
    expect(can('admin', 'billing.manage')).toBe(true);
    expect(can('admin', 'workspace.delete')).toBe(false);
    expect(can('owner', 'workspace.delete')).toBe(true);
  });
});

describe('sending windows', () => {
  it('computes local time and windows in the campaign timezone', () => {
    const d = new Date('2026-09-23T06:30:00Z'); // Wednesday, 08:30 in Johannesburg (UTC+2)
    expect(localTimeParts(d, 'Africa/Johannesburg')).toEqual({ hour: 8, weekday: 3 });
    expect(isWithinSendWindow({ timezone: 'Africa/Johannesburg', sendWindowStart: 8, sendWindowEnd: 17, sendDays: [1, 2, 3, 4, 5] }, d)).toBe(true);
    expect(isWithinSendWindow({ timezone: 'UTC', sendWindowStart: 8, sendWindowEnd: 17, sendDays: [1, 2, 3, 4, 5] }, d)).toBe(false);
    expect(isWithinSendWindow({ timezone: 'Africa/Johannesburg', sendWindowStart: 8, sendWindowEnd: 17, sendDays: [6, 7] }, d)).toBe(false);
    expect(startOfLocalDay('Africa/Johannesburg', d).toISOString()).toBe('2026-09-22T22:00:00.000Z');
  });
});

describe('discovery queries', () => {
  it('builds one query per category, combining keywords, capped at five', () => {
    expect(buildQueries({ categories: ['barbers', 'plumbers'], keyword: null })).toEqual(['barbers', 'plumbers']);
    expect(buildQueries({ categories: ['barbers'], keyword: 'mobile' })).toEqual(['mobile barbers']);
    expect(buildQueries({ categories: [], keyword: 'vegan bakery' })).toEqual(['vegan bakery']);
    expect(buildQueries({ categories: ['a', 'b', 'c', 'd', 'e', 'f'], keyword: null })).toHaveLength(5);
  });
});

describe('website checks', () => {
  it('refuses private and non-http targets (SSRF protection)', () => {
    expect(websiteCheck.isPrivateAddress('10.0.0.1')).toBe(true);
    expect(websiteCheck.isPrivateAddress('169.254.169.254')).toBe(true);
    expect(websiteCheck.isPrivateAddress('192.168.1.1')).toBe(true);
    expect(websiteCheck.isPrivateAddress('::1')).toBe(true);
    expect(websiteCheck.isPrivateAddress('8.8.8.8')).toBe(false);
    expect(websiteCheck.validateUrl('http://localhost/admin')).toBeNull();
    expect(websiteCheck.validateUrl('ftp://example.com')).toBeNull();
    expect(websiteCheck.validateUrl('http://127.0.0.1')).toBeNull();
    expect(websiteCheck.validateUrl('https://user:pass@example.com')).toBeNull();
    expect(websiteCheck.validateUrl('example.com')?.hostname).toBe('example.com');
  });
});

describe('email parsing', () => {
  it('strips quoted history from replies and detects bounces', () => {
    expect(stripQuotedText('Sounds good!\n\nOn Mon, Sep 22, Alex wrote:\n> Hi there')).toBe('Sounds good!');
    expect(stripQuotedText('Yes\n> quoted\nThanks')).toBe('Yes\nThanks');
    expect(isBounceSender('mailer-daemon@googlemail.com', 'Delivery Status Notification (Failure)')).toBe(true);
    expect(isBounceSender('sam@shop.test', 'Re: A website idea')).toBe(false);
    expect(parseAddress('"Sam Jacobs" <Sam@Shop.test>')).toEqual({ email: 'sam@shop.test', name: 'Sam Jacobs' });
  });
});
