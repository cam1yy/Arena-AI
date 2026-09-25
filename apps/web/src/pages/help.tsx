import { Link } from 'react-router';
import { useSession } from '@/lib/session';
import { Kbd } from '@/components/ui';
import { PageBody, PageHeader } from '@/components/app/page';
import { SHORTCUTS } from '@/components/app/shortcuts';

const TOPICS = [
  {
    title: 'Discovering businesses',
    items: [
      ['How does discovery work?', 'Localy searches Google Maps with the official Places API (New) using your categories and keywords, restricted to the area you draw on the map. Each category uses one search request, and "Load more" fetches the next page of up to 20 results per category.'],
      ['What does "No website listed" mean?', 'The Google Maps listing has no website link. The business may still have a website that is not on its listing, so Localy never says a business definitely has no website. "Social profile only" means the only link is a social media or link-in-bio page.'],
      ['What does "Check listed websites" do?', 'For listings that do include a website, Localy makes one lightweight request to each site to see if it responds. It reads no page content. Sites that do not respond are marked "Website unavailable", which can also be an opportunity.'],
      ['Why can\'t I filter by email?', 'Google Maps does not provide email addresses. After saving a prospect, add a contact email you have found yourself, for example by calling the business.'],
      ['Why do names load after the page?', 'Localy is not allowed to store business details from Google Maps, only place IDs. Names and addresses are fetched live each time you view them.'],
    ],
  },
  {
    title: 'Outreach and campaigns',
    items: [
      ['Does Localy send anything automatically?', 'Only after you explicitly start a campaign or confirm a send. Campaigns are created as drafts and show exactly how many emails will go out before you confirm.'],
      ['How are emails sent?', 'Through your own connected Gmail or Outlook mailbox, one individual email per recipient, in the background. Each campaign has a daily limit and sending window, and each mailbox has its own daily cap.'],
      ['How do follow-ups work?', 'Each campaign is a sequence. Follow-ups are sent after the number of days you choose, only if the prospect has not replied. Replies are detected automatically every few minutes and stop the sequence.'],
      ['What if someone unsubscribes?', 'Every email includes an unsubscribe link (unless you turn it off in Settings). Unsubscribed addresses are suppressed across your entire workspace, and any queued emails to them are cancelled.'],
      ['What personalization variables are available?', 'firstName, lastName, businessName, category, location, senderName and agencyName. Add a fallback with a pipe, for example {{firstName|there}}. Values you enter on a prospect take priority over the Google Maps listing.'],
    ],
  },
  {
    title: 'Account and billing',
    items: [
      ['What happens when I reach a plan limit?', 'Localy explains which limit you reached and how much you have used. Nothing you have written is lost. Running campaigns pause with a clear reason when the monthly email limit is reached.'],
      ['How do I cancel?', 'From Billing, choose Cancel subscription. You keep access until the end of the billing period. Your data is kept and you can resubscribe any time.'],
      ['How do I delete my data?', 'Settings, Danger zone lets you delete a workspace or your whole account. Settings, Data and privacy lets you export everything first.'],
    ],
  },
];

export default function Help() {
  const { config } = useSession();
  return (
    <>
      <PageHeader title="Help" description="Answers to common questions about Localy." />
      <PageBody width="narrow" className="space-y-10">
        {TOPICS.map((t) => (
          <section key={t.title}>
            <h2 className="mb-3 text-[15px] font-semibold">{t.title}</h2>
            <div className="divide-y divide-line rounded-lg border border-line bg-panel">
              {t.items.map(([q, a]) => (
                <details key={q} className="group px-4 py-3">
                  <summary className="cursor-pointer list-none text-[13.5px] font-medium marker:hidden">
                    <span className="flex items-center justify-between gap-4">
                      {q}
                      <span className="text-subtle transition-transform group-open:rotate-45">+</span>
                    </span>
                  </summary>
                  <p className="mt-2 text-[13px] leading-relaxed text-muted">{a}</p>
                </details>
              ))}
            </div>
          </section>
        ))}
        <section>
          <h2 className="mb-3 text-[15px] font-semibold">Keyboard shortcuts</h2>
          <ul className="grid gap-2 rounded-lg border border-line bg-panel p-4 sm:grid-cols-2">
            {SHORTCUTS.map((s) => (
              <li key={s.label + s.keys.join()} className="flex items-center justify-between text-[13px]">
                <span className="text-ink-2">{s.label}</span>
                <span className="flex gap-1">{s.keys.map((k) => <Kbd key={k}>{k}</Kbd>)}</span>
              </li>
            ))}
          </ul>
        </section>
        <section className="rounded-lg border border-line bg-panel p-5 text-[13px]">
          <h2 className="font-semibold">Still need help?</h2>
          <p className="mt-1 text-muted">
            Email <a href={`mailto:${config?.supportEmail}`} className="font-medium text-ink hover:underline">{config?.supportEmail}</a>. See also the <Link to="/privacy" className="font-medium text-ink hover:underline">Privacy Policy</Link> and <Link to="/terms" className="font-medium text-ink hover:underline">Terms</Link>.
          </p>
        </section>
      </PageBody>
    </>
  );
}
