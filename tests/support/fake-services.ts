/**
 * Test doubles for third-party HTTP APIs (Google Places API (New), Geocoding,
 * Gmail and Microsoft Graph). Used only by the automated test suites, which
 * point the *_BASE_URL environment variables at this server. The product
 * itself never uses these fixtures.
 */
import http from 'node:http';

export interface FakePlace {
  id: string;
  displayName: { text: string };
  formattedAddress: string;
  shortFormattedAddress: string;
  location: { latitude: number; longitude: number };
  primaryType: string;
  primaryTypeDisplayName: { text: string };
  types: string[];
  rating?: number;
  userRatingCount?: number;
  nationalPhoneNumber?: string;
  internationalPhoneNumber?: string;
  websiteUri?: string;
  googleMapsUri: string;
  businessStatus: string;
  addressComponents: { longText: string; shortText: string; types: string[] }[];
}

const place = (id: string, name: string, type: string, label: string, lat: number, lng: number, extra: Partial<FakePlace> = {}): FakePlace => ({
  id,
  displayName: { text: name },
  formattedAddress: `1 Test Road, Sea Point, Cape Town, 8005, South Africa`,
  shortFormattedAddress: `1 Test Road, Sea Point`,
  location: { latitude: lat, longitude: lng },
  primaryType: type,
  primaryTypeDisplayName: { text: label },
  types: [type, 'point_of_interest', 'establishment'],
  googleMapsUri: `https://maps.google.com/?cid=${id}`,
  businessStatus: 'OPERATIONAL',
  addressComponents: [{ longText: 'Sea Point', shortText: 'Sea Point', types: ['sublocality_level_1', 'sublocality'] }],
  ...extra,
});

// Fixture businesses around Cape Town (-33.92, 18.42).
export const FIXTURE_PLACES: FakePlace[] = [
  place('test-place-1', 'Fixture Barbers One', 'barber_shop', 'Barber shop', -33.915, 18.39, { rating: 4.8, userRatingCount: 212, nationalPhoneNumber: '021 555 0001', internationalPhoneNumber: '+27 21 555 0001' }),
  place('test-place-2', 'Fixture Barbers Two', 'barber_shop', 'Barber shop', -33.93, 18.43, { rating: 4.1, userRatingCount: 18, websiteUri: 'https://www.facebook.com/fixture-two' }),
  place('test-place-3', 'Fixture Plumbing Co', 'plumber', 'Plumber', -33.92, 18.41, { rating: 4.6, userRatingCount: 75, websiteUri: 'https://fixture-plumbing.example', nationalPhoneNumber: '021 555 0003' }),
  place('test-place-4', 'Fixture Faraway Barber', 'barber_shop', 'Barber shop', -34.4, 18.9, { rating: 4.9, userRatingCount: 300 }),
  place('test-place-5', 'Fixture Closed Barber', 'barber_shop', 'Barber shop', -33.921, 18.421, { businessStatus: 'CLOSED_PERMANENTLY' }),
];

export interface FakeServer {
  url: string;
  port: number;
  requests: { method: string; path: string; headers: http.IncomingHttpHeaders; body: string }[];
  sentMail: { provider: 'gmail' | 'graph'; raw: string }[];
  close: () => Promise<void>;
  failNext: (status: number, times?: number) => void;
}

export async function startFakeServices(port = 0): Promise<FakeServer> {
  const requests: FakeServer['requests'] = [];
  const sentMail: FakeServer['sentMail'] = [];
  let failures: { status: number; times: number } | null = null;
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      requests.push({ method: req.method ?? 'GET', path: url.pathname, headers: req.headers, body });
      const json = (status: number, data: unknown) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(data));
      };
      if (url.pathname === '/__control/fail') {
        failures = { status: Number(url.searchParams.get('status') ?? 500), times: Number(url.searchParams.get('times') ?? 1) };
        return json(200, { ok: true });
      }
      if (failures && failures.times > 0 && url.pathname.startsWith('/v1/places')) {
        failures.times--;
        return json(failures.status, { error: { status: failures.status === 429 ? 'RESOURCE_EXHAUSTED' : 'UNAVAILABLE', message: 'fake failure' } });
      }
      // Places API (New)
      if (url.pathname === '/v1/places:searchText' && req.method === 'POST') {
        if (req.headers['x-goog-api-key'] !== 'test-server-key') return json(403, { error: { status: 'PERMISSION_DENIED', message: 'bad key' } });
        if (!req.headers['x-goog-fieldmask']) return json(400, { error: { status: 'INVALID_ARGUMENT', message: 'field mask required' } });
        const q = JSON.parse(body || '{}') as { textQuery: string; pageToken?: string };
        const term = q.textQuery.toLowerCase();
        const matches = FIXTURE_PLACES.filter((p) => term.includes('barber') ? p.primaryType === 'barber_shop' : term.includes('plumb') ? p.primaryType === 'plumber' : true);
        if (q.pageToken) return json(200, { places: [] });
        return json(200, { places: matches, ...(term.includes('barber') ? { nextPageToken: 'page-2' } : {}) });
      }
      if (url.pathname === '/v1/places:autocomplete' && req.method === 'POST') {
        return json(200, { suggestions: [{ placePrediction: { placeId: 'loc-cape-town', text: { text: 'Cape Town, South Africa' }, structuredFormat: { mainText: { text: 'Cape Town' }, secondaryText: { text: 'South Africa' } }, types: ['locality'] } }] });
      }
      if (url.pathname.startsWith('/v1/places/') && req.method === 'GET') {
        const id = decodeURIComponent(url.pathname.slice('/v1/places/'.length));
        if (id === 'loc-cape-town') return json(200, { id, displayName: { text: 'Cape Town' }, formattedAddress: 'Cape Town, South Africa', location: { latitude: -33.9249, longitude: 18.4241 }, viewport: { low: { latitude: -34.0, longitude: 18.3 }, high: { latitude: -33.85, longitude: 18.55 } } });
        const p = FIXTURE_PLACES.find((x) => x.id === id);
        return p ? json(200, p) : json(404, { error: { status: 'NOT_FOUND', message: 'not found' } });
      }
      // Geocoding API
      if (url.pathname === '/maps/api/geocode/json') {
        if (url.searchParams.get('latlng')) return json(200, { status: 'OK', results: [{ formatted_address: 'Sea Point, Cape Town, South Africa', place_id: 'geo-sea-point', geometry: { location: { lat: -33.915, lng: 18.39 } }, types: ['sublocality'] }] });
        const address = url.searchParams.get('address') ?? '';
        if (/nowhere/i.test(address)) return json(200, { status: 'ZERO_RESULTS', results: [] });
        return json(200, { status: 'OK', results: [{ formatted_address: `${address}, South Africa`, place_id: 'geo-typed', geometry: { location: { lat: -33.9249, lng: 18.4241 } }, types: ['locality'] }] });
      }
      // Gmail API
      if (url.pathname === '/gmail/v1/users/me/messages/send' && req.method === 'POST') {
        if (req.headers.authorization !== 'Bearer gmail-access-token') return json(401, { error: { code: 401, message: 'Invalid Credentials' } });
        const raw = Buffer.from((JSON.parse(body) as { raw: string }).raw, 'base64url').toString('utf8');
        sentMail.push({ provider: 'gmail', raw });
        return json(200, { id: `gmail-msg-${sentMail.length}`, threadId: 'gmail-thread-1' });
      }
      if (url.pathname === '/gmail/v1/users/me/profile') return json(200, { emailAddress: 'sender@gmail.test' });
      if (url.pathname === '/gmail/v1/users/me/messages' && req.method === 'GET') return json(200, { messages: [] });
      // Microsoft Graph
      if (url.pathname === '/v1.0/me/messages' && req.method === 'POST') {
        sentMail.push({ provider: 'graph', raw: body });
        return json(201, { id: 'graph-draft-1', internetMessageId: '<graph-1@outlook.test>', conversationId: 'graph-conv-1' });
      }
      if (/^\/v1\.0\/me\/messages\/[^/]+\/send$/.test(url.pathname)) {
        res.writeHead(202);
        return res.end();
      }
      // OAuth token endpoint (Google). The code encodes the test identity: "<purpose>:<email>".
      if (url.pathname === '/token' && req.method === 'POST') {
        const form = new URLSearchParams(body);
        if (form.get('grant_type') === 'refresh_token') return json(200, { access_token: 'gmail-access-token', expires_in: 3600 });
        if (!form.get('code_verifier')) return json(400, { error: 'invalid_request', error_description: 'PKCE verifier missing' });
        const [, email = 'oauth.user@gmail.test'] = (form.get('code') ?? '').split(':');
        const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
        const idToken = `${b64({ alg: 'none' })}.${b64({ sub: `sub-${email}`, email, email_verified: true, name: 'OAuth User', aud: 'test-google-client', iss: 'https://accounts.google.com' })}.sig`;
        return json(200, {
          access_token: 'gmail-access-token',
          refresh_token: 'gmail-refresh-token',
          expires_in: 3600,
          scope: 'openid email profile https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly',
          id_token: idToken,
        });
      }
      // Stripe API
      if (url.pathname.startsWith('/v1/prices/')) {
        const id = url.pathname.split('/').pop();
        const amount = id === 'price_pro_test' ? 2900 : id === 'price_agency_test' ? 9900 : null;
        return amount === null ? json(404, { error: { type: 'invalid_request_error', message: 'No such price' } }) : json(200, { id, object: 'price', unit_amount: amount, currency: 'usd', recurring: { interval: 'month' } });
      }
      if (url.pathname === '/v1/customers' && req.method === 'POST') return json(200, { id: `cus_test_${Date.now()}`, object: 'customer' });
      if (url.pathname === '/v1/checkout/sessions' && req.method === 'POST') {
        const form = new URLSearchParams(body);
        return json(200, { id: 'cs_test_1', object: 'checkout.session', url: `https://checkout.stripe.test/${form.get('client_reference_id')}` });
      }
      if (url.pathname === '/v1/billing_portal/sessions' && req.method === 'POST') return json(200, { id: 'bps_1', url: 'https://billing.stripe.test/portal' });
      if (url.pathname.startsWith('/v1/customers/') && req.method === 'GET') return json(200, { id: url.pathname.split('/').pop(), object: 'customer', invoice_settings: { default_payment_method: null } });
      if (url.pathname === '/v1/invoices' && req.method === 'GET') return json(200, { object: 'list', data: [], has_more: false });
      json(404, { error: { message: `no fake for ${req.method} ${url.pathname}` } });
    });
  });
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
  const actual = (server.address() as { port: number }).port;
  return {
    url: `http://127.0.0.1:${actual}`,
    port: actual,
    requests,
    sentMail,
    failNext: (status, times = 1) => (failures = { status, times }),
    close: () => new Promise((r) => server.close(() => r())),
  };
}
