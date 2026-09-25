import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useSession } from '@/lib/session';
import { Button, Switch } from '@/components/ui';
import { Logo } from '@/components/app/logo';

const UPDATED = 'September 23, 2026';

function Layout({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-canvas">
      <header className="border-b border-line">
        <div className="mx-auto flex h-16 max-w-[760px] items-center justify-between px-5">
          <Link to="/" aria-label="Localy home"><Logo /></Link>
          <nav className="flex gap-4 text-[13px] text-muted">
            <Link to="/privacy" className="hover:text-ink">Privacy</Link>
            <Link to="/terms" className="hover:text-ink">Terms</Link>
            <Link to="/cookies" className="hover:text-ink">Cookies</Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-[760px] px-5 py-12">
        <h1 className="text-[30px] font-semibold tracking-[-0.03em]">{title}</h1>
        <p className="mt-2 text-[13px] text-muted">Last updated {UPDATED}</p>
        <div className="mt-8 space-y-6 text-[14.5px] leading-relaxed text-ink-2 [&_h2]:mt-10 [&_h2]:text-[17px] [&_h2]:font-semibold [&_h2]:text-ink [&_li]:ml-5 [&_li]:list-disc [&_ul]:space-y-1.5">{children}</div>
      </main>
    </div>
  );
}

function Privacy() {
  const { config } = useSession();
  return (
    <Layout title="Privacy Policy">
      <p>This policy explains what information Localy collects, how it is used, and the choices you have. Localy is a tool for finding local businesses and managing outreach to them.</p>
      <h2>Information you provide</h2>
      <ul>
        <li>Account details: your name, email address, a securely hashed password (Argon2id), timezone and preferences.</li>
        <li>Workspace content: prospects you save, contact details you enter, notes, tags, templates, campaigns and settings.</li>
        <li>Billing details are handled by Stripe. Localy stores your Stripe customer and subscription identifiers, not your card number.</li>
      </ul>
      <h2>Connected email accounts</h2>
      <p>When you connect Gmail or Microsoft Outlook, you authorize Localy through OAuth to send email on your behalf and to read messages so replies and bounces can be matched to your outreach. Localy never receives your email password. Access tokens are encrypted with AES-256-GCM. Messages unrelated to your outreach are ignored and not stored. You can disconnect at any time in Localy or revoke access from your Google or Microsoft account.</p>
      <p>Localy's use and transfer of information received from Google APIs adheres to the Google API Services User Data Policy, including the Limited Use requirements.</p>
      <h2>Google Maps Platform</h2>
      <p>Business discovery uses Google Maps Platform APIs. By using discovery features you are also bound by the <a className="underline" href="https://maps.google.com/help/terms_maps/" target="_blank" rel="noopener noreferrer">Google Maps/Google Earth Additional Terms of Service</a> and the <a className="underline" href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer">Google Privacy Policy</a>. In line with Google's terms, Localy stores only Google place IDs and, for at most 30 days, search coordinates. Business details are retrieved live and not stored.</p>
      <h2>How we use information</h2>
      <ul>
        <li>To provide the service: search, prospect management, sending and tracking your outreach.</li>
        <li>To secure accounts: session management, audit logs, rate limiting and abuse prevention.</li>
        <li>To send service email such as verification, password resets and notifications you choose.</li>
      </ul>
      <p>We do not sell personal information and do not use your workspace content to train AI models. If you enable optional AI assistance, the relevant text is sent to the configured AI provider only when you request a suggestion.</p>
      <h2>Recipients of your outreach</h2>
      <p>You are responsible for having a lawful basis to contact the businesses you email and for complying with anti-spam laws. Localy helps by including unsubscribe links and honoring opt-outs across your workspace. Anyone who receives an email sent through Localy can unsubscribe using the link in the message.</p>
      <h2>Retention and deletion</h2>
      <p>Workspace data is kept while your account is active. You can export your data and delete your workspace or account at any time from Settings. Deletion removes your data from our active systems immediately; encrypted backups age out within 30 days.</p>
      <h2>Contact</h2>
      <p>Questions about privacy: <a className="underline" href={`mailto:${config?.supportEmail}`}>{config?.supportEmail}</a>.</p>
    </Layout>
  );
}

function Terms() {
  return (
    <Layout title="Terms of Service">
      <p>By creating an account or using Localy you agree to these terms.</p>
      <h2>Your account</h2>
      <p>You must provide accurate information and keep your credentials secure. You are responsible for activity in your workspaces, including actions by members you invite.</p>
      <h2>Acceptable use</h2>
      <ul>
        <li>Send outreach that is honest, relevant and compliant with applicable laws, including CAN-SPAM, GDPR, POPIA, CASL and similar regulations where your recipients are located.</li>
        <li>Do not send bulk unsolicited email in violation of law or your email provider's policies, and do not attempt to bypass sending limits.</li>
        <li>Do not scrape, resell or build databases from Google Maps content obtained through Localy.</li>
        <li>Do not misuse the service, interfere with its operation, or access other customers' data.</li>
      </ul>
      <h2>Third-party services</h2>
      <p>Discovery features use Google Maps Platform. Your use of those features is subject to the <a className="underline" href="https://maps.google.com/help/terms_maps/" target="_blank" rel="noopener noreferrer">Google Maps/Google Earth Additional Terms of Service</a>. Sending uses your connected Google or Microsoft account and is subject to their terms. Payments are processed by Stripe.</p>
      <h2>Subscriptions</h2>
      <p>Paid plans renew automatically until canceled. Plan limits are shown in Billing. You can cancel at any time and keep access until the end of the paid period. Fees are non-refundable except where required by law.</p>
      <h2>Data</h2>
      <p>You own the content you create. We process it only to provide the service, as described in the Privacy Policy.</p>
      <h2>Disclaimers</h2>
      <p>Localy reports information as provided by third-party sources and does not guarantee its accuracy, including whether a business has a website. The service is provided "as is" without warranties to the extent permitted by law.</p>
      <h2>Liability</h2>
      <p>To the extent permitted by law, Localy's total liability is limited to the amount you paid in the 12 months before the claim.</p>
      <h2>Changes</h2>
      <p>We may update these terms and will notify you of material changes in the app or by email.</p>
    </Layout>
  );
}

function Cookies() {
  const [functional, setFunctional] = useState(() => localStorage.getItem('localy.cookies.functional') !== 'off');
  useEffect(() => {
    localStorage.setItem('localy.cookies.functional', functional ? 'on' : 'off');
    if (!functional) localStorage.removeItem('localy.composer.draft');
  }, [functional]);
  return (
    <Layout title="Cookie Policy">
      <p>Localy uses a minimal set of cookies and local storage. We do not use advertising or cross-site tracking cookies, and we do not track email opens.</p>
      <h2>Strictly necessary</h2>
      <p>The <code>localy_session</code> cookie keeps you signed in. It is HttpOnly, secure in production, and expires after 30 days or when you sign out. It cannot be disabled because the app does not work without it.</p>
      <h2>Functional storage</h2>
      <div className="flex items-start justify-between gap-6 rounded-lg border border-line bg-panel p-4">
        <p className="text-[13.5px]">Local storage in your browser to save unsent composer drafts so you don't lose work. Stored only on your device.</p>
        <Switch checked={functional} onCheckedChange={setFunctional} label="Functional storage" />
      </div>
      <h2>Google Maps</h2>
      <p>When the interactive map loads, Google may set cookies as described in the Google Privacy Policy.</p>
      <Button asChild className="mt-4"><Link to="/">Back to Localy</Link></Button>
    </Layout>
  );
}

export default function Legal({ doc }: { doc: 'privacy' | 'terms' | 'cookies' }) {
  return doc === 'privacy' ? <Privacy /> : doc === 'terms' ? <Terms /> : <Cookies />;
}
