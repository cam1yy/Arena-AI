/**
 * DEVELOPMENT-ONLY SEED DATA.
 *
 * Creates an example workspace so the product can be explored locally. Every
 * seeded row is flagged with is_dev_data = true, and prospects use the
 * `dev_seed` source with obviously fictional details. The script refuses to
 * run when NODE_ENV=production. Seeded prospects have no Google place IDs.
 *
 *   npm run db:seed
 */
import { eq, sql } from 'drizzle-orm';
import { hash } from '@node-rs/argon2';
import { DEFAULT_FOLLOW_UP_TEMPLATES, DEFAULT_TEMPLATE, computeSignals, countPositiveSignals, renderEmail } from '@localy/shared';
import { closeDb, getDb } from './client';
import { ensurePlans } from './plans';
import {
  activities,
  campaignRecipients,
  campaignSteps,
  campaigns,
  emailEvents,
  emailMessages,
  emailTemplates,
  emailThreads,
  integrations,
  notes,
  notifications,
  prospectTags,
  prospects,
  savedSearches,
  subscriptions,
  tags,
  usageCounters,
  users,
  workspaceMembers,
  workspaces,
} from './schema';

const DEV_EMAIL = 'demo@localy.dev';
const DEV_PASSWORD = 'localy-demo-2026';

async function main() {
  if (process.env.NODE_ENV === 'production') {
    console.error('Refusing to seed development data with NODE_ENV=production.');
    process.exit(1);
  }
  const db = getDb();
  await ensurePlans(db);
  const existing = await db.select().from(users).where(sql`lower(${users.email}) = ${DEV_EMAIL}`);
  if (existing.length) {
    console.log(`Development data already exists. Sign in with ${DEV_EMAIL} / ${DEV_PASSWORD}`);
    await closeDb();
    return;
  }
  const passwordHash = await hash(DEV_PASSWORD, { memoryCost: 19456, timeCost: 2, parallelism: 1 });
  await db.transaction(async (tx) => {
    const [user] = await tx
      .insert(users)
      .values({
        email: DEV_EMAIL,
        name: 'Demo User',
        passwordHash,
        emailVerifiedAt: new Date(),
        timezone: 'Africa/Johannesburg',
        onboardingStep: 6,
        onboardingCompletedAt: new Date(),
        isDevData: true,
      })
      .returning();
    const [ws] = await tx
      .insert(workspaces)
      .values({
        name: 'Demo Studio (development data)',
        isDevData: true,
        settings: {
          agencyName: 'Demo Studio',
          defaultSenderName: 'Demo User',
          businessLocation: 'Cape Town',
          industry: 'Web design',
          useCase: 'web_design',
          defaultCategories: ['barbers', 'plumbers'],
          defaultRadiusMeters: 10_000,
          websiteFilter: 'opportunity',
          postalAddress: '1 Example Street, Cape Town, 8001 (development data)',
          defaultLocation: { label: 'Cape Town, South Africa', placeId: null, lat: -33.9249, lng: 18.4241, source: 'pin', resolvedAt: null },
        },
      })
      .returning();
    await tx.insert(workspaceMembers).values({ workspaceId: ws.id, userId: user.id, role: 'owner' });
    await tx.insert(subscriptions).values({ workspaceId: ws.id, planKey: 'trial', status: 'trialing', trialEndsAt: new Date(Date.now() + 14 * 86_400_000) });

    const [initial] = await tx
      .insert(emailTemplates)
      .values({ workspaceId: ws.id, name: DEFAULT_TEMPLATE.name, subject: DEFAULT_TEMPLATE.subject, body: DEFAULT_TEMPLATE.body, kind: 'initial', createdBy: user.id, isDevData: true })
      .returning();
    const followTemplates = await tx
      .insert(emailTemplates)
      .values(DEFAULT_FOLLOW_UP_TEMPLATES.map((t) => ({ workspaceId: ws.id, name: t.name, subject: t.subject, body: t.body, kind: 'follow_up' as const, defaultDelayDays: t.delayDays, createdBy: user.id, isDevData: true })))
      .returning();
    await tx.insert(emailTemplates).values({
      workspaceId: ws.id,
      name: 'Restaurant menu site',
      subject: 'An online menu for {{businessName}}',
      body: `Hi {{firstName}},\n\nI was looking for restaurants in {{location}} and came across {{businessName}}. I couldn't find a website listed with your menu and opening hours.\n\nI build simple, fast websites for restaurants, including an online menu that is easy to update. Would you like me to put together a free example for {{businessName}}?\n\nBest,\n{{senderName}}`,
      kind: 'initial',
      createdBy: user.id,
      isDevData: true,
    });

    const [integration] = await tx
      .insert(integrations)
      .values({ workspaceId: ws.id, provider: 'sandbox', email: DEV_EMAIL, displayName: 'Demo User', providerAccountId: `sandbox:${DEV_EMAIL}`, scopes: ['sandbox.send', 'sandbox.read'], status: 'active', isDefault: true, dailySendLimit: 500, connectedBy: user.id })
      .returning();

    const tagNames = ['Restaurant', 'High value', 'No website', 'Interested', 'Follow-up'];
    const tagRows = await tx.insert(tags).values(tagNames.map((name) => ({ workspaceId: ws.id, name }))).returning();
    const tagId = (n: string) => tagRows.find((t) => t.name === n)!.id;

    const samples = [
      { name: 'Example Harbour Barbers', first: 'Sam', category: 'barber', location: 'Sea Point', email: 'sam@harbour-barbers.example', phone: '+27 21 555 0101', status: 'new' as const, website: 'not_listed' as const, rating: 4.7, reviews: 128, tags: ['No website', 'High value'] },
      { name: 'Example Kloof Plumbing', first: 'Thandi', category: 'plumber', location: 'Gardens', email: 'thandi@kloof-plumbing.example', phone: '+27 21 555 0102', status: 'contacted' as const, website: 'not_listed' as const, rating: 4.5, reviews: 64, tags: ['No website'] },
      { name: 'Example Bo-Kaap Bakery', first: 'Yusuf', category: 'bakery', location: 'Bo-Kaap', email: 'hello@bokaap-bakery.example', phone: '+27 21 555 0103', status: 'interested' as const, website: 'not_listed' as const, rating: 4.8, reviews: 211, tags: ['Interested', 'High value'] },
      { name: 'Example Woodstock Auto Repair', first: null, category: 'auto repair', location: 'Woodstock', email: null, phone: '+27 21 555 0104', status: 'new' as const, website: 'unknown' as const, rating: 4.1, reviews: 22, tags: [] },
      { name: 'Example Observatory Cafe', first: 'Lerato', category: 'cafe', location: 'Observatory', email: 'lerato@obs-cafe.example', phone: null, status: 'replied' as const, website: 'not_listed' as const, rating: 4.4, reviews: 87, tags: ['Restaurant', 'Follow-up'] },
      { name: 'Example Green Point Gym', first: 'Chris', category: 'gym', location: 'Green Point', email: 'chris@gp-gym.example', phone: '+27 21 555 0106', status: 'new' as const, website: 'listed' as const, rating: 4.2, reviews: 45, tags: [] },
    ];
    const created: (typeof prospects.$inferSelect)[] = [];
    for (const s of samples) {
      const signals = computeSignals({ websiteStatus: s.website, rating: s.rating, userRatingCount: s.reviews, hasPhone: Boolean(s.phone), hasEmail: Boolean(s.email), businessStatus: 'OPERATIONAL' });
      const [p] = await tx
        .insert(prospects)
        .values({
          workspaceId: ws.id,
          source: 'dev_seed',
          status: s.status,
          name: s.name,
          contactFirstName: s.first,
          email: s.email,
          phone: s.phone,
          locationLabel: s.location,
          categoryLabel: s.category,
          websiteStatus: s.website,
          signals,
          signalCount: countPositiveSignals(signals),
          analysisUpdatedAt: new Date(),
          createdBy: user.id,
          isDevData: true,
        })
        .returning();
      created.push(p);
      for (const t of s.tags) await tx.insert(prospectTags).values({ prospectId: p.id, tagId: tagId(t) });
      await tx.insert(activities).values({ workspaceId: ws.id, prospectId: p.id, actorId: user.id, type: 'prospect_created', data: { source: 'dev_seed' } });
    }
    await tx.insert(notes).values([
      { workspaceId: ws.id, prospectId: created[2].id, authorId: user.id, body: 'Owner seems interested. Wants an online order form for weekend specials.' },
      { workspaceId: ws.id, prospectId: created[4].id, authorId: user.id, body: 'Needs a menu website. Follow up next Tuesday.' },
    ]);

    const [campaign] = await tx
      .insert(campaigns)
      .values({ workspaceId: ws.id, name: 'Cape Town web outreach (development data)', status: 'draft', integrationId: integration.id, senderName: 'Demo User', dailyLimit: 30, timezone: 'Africa/Johannesburg', createdBy: user.id, isDevData: true })
      .returning();
    await tx.insert(campaignSteps).values([
      { campaignId: campaign.id, position: 0, templateId: initial.id, subject: initial.subject, body: initial.body, waitDays: 0 },
      { campaignId: campaign.id, position: 1, templateId: followTemplates[0].id, subject: followTemplates[0].subject, body: followTemplates[0].body, waitDays: 3 },
      { campaignId: campaign.id, position: 2, templateId: followTemplates[1].id, subject: followTemplates[1].subject, body: followTemplates[1].body, waitDays: 4 },
    ]);
    await tx.insert(campaignRecipients).values([created[0], created[3], created[5]].map((p) => ({ workspaceId: ws.id, campaignId: campaign.id, prospectId: p.id })));

    // A completed intro campaign with real message history, so every screen
    // (dashboard, inbox, campaigns, analytics) shows consistent numbers.
    const daysAgo = (d: number, h = 0) => new Date(Date.now() - d * 86_400_000 - h * 3_600_000);
    const sentAt = daysAgo(3, 2);
    const [intro] = await tx
      .insert(campaigns)
      .values({ workspaceId: ws.id, name: 'Southern suburbs intro (development data)', status: 'completed', integrationId: integration.id, senderName: 'Demo User', dailyLimit: 30, timezone: 'Africa/Johannesburg', createdBy: user.id, isDevData: true, startedAt: sentAt, completedAt: daysAgo(1) })
      .returning();
    await tx.insert(campaignSteps).values({ campaignId: intro.id, position: 0, templateId: initial.id, subject: initial.subject, body: initial.body, waitDays: 0 });
    await tx.insert(activities).values({ workspaceId: ws.id, campaignId: intro.id, actorId: user.id, type: 'campaign_started', data: { campaignName: intro.name }, createdAt: sentAt });
    const byName = (n: string) => created.find((c) => c.name === n)!;
    const outreach = [
      { p: byName('Example Kloof Plumbing'), reply: null as null | { at: Date; body: string } },
      {
        p: byName('Example Observatory Cafe'),
        reply: { at: daysAgo(1, 3), body: 'Hi Demo,\n\nThanks for reaching out. We have been meaning to get a proper website with our menu and opening hours. Could you send a quick example of what you had in mind?\n\nLerato' },
      },
      {
        p: byName('Example Bo-Kaap Bakery'),
        reply: { at: daysAgo(2, 5), body: 'Hello,\n\nYes, we would be interested. We take most orders over the phone at the moment, so an online order form for our weekend specials would be great.\n\nYusuf' },
      },
    ];
    for (const o of outreach) {
      const email = renderEmail(initial.subject, initial.body, {
        firstName: o.p.contactFirstName,
        businessName: o.p.name,
        location: o.p.locationLabel,
        category: o.p.categoryLabel,
        senderName: 'Demo User',
        agencyName: 'Demo Studio',
      });
      const [rec] = await tx
        .insert(campaignRecipients)
        .values({ workspaceId: ws.id, campaignId: intro.id, prospectId: o.p.id, status: o.reply ? 'replied' : 'completed', currentStep: 1, lastSentAt: sentAt, repliedAt: o.reply?.at ?? null })
        .returning();
      const [thread] = await tx
        .insert(emailThreads)
        .values({
          workspaceId: ws.id,
          integrationId: integration.id,
          prospectId: o.p.id,
          campaignId: intro.id,
          subject: email.subject,
          providerThreadId: `sandbox-thread-seed-${rec.id}`,
          lastMessageAt: o.reply?.at ?? sentAt,
          lastDirection: o.reply ? 'inbound' : 'outbound',
          lastPreview: (o.reply?.body ?? email.body).slice(0, 160),
          unread: o.p.status === 'replied',
        })
        .returning();
      await tx.update(campaignRecipients).set({ threadId: thread.id }).where(eq(campaignRecipients.id, rec.id));
      const [out] = await tx
        .insert(emailMessages)
        .values({
          workspaceId: ws.id,
          threadId: thread.id,
          integrationId: integration.id,
          prospectId: o.p.id,
          campaignId: intro.id,
          recipientId: rec.id,
          stepPosition: 0,
          direction: 'outbound',
          status: 'sent',
          idempotencyKey: `campaign:${rec.id}:0`,
          messageIdHeader: `<seed-${rec.id}@localy.dev>`,
          providerMessageId: `sandbox-seed-${rec.id}`,
          fromEmail: DEV_EMAIL,
          fromName: 'Demo User',
          toEmail: o.p.email!,
          subject: email.subject,
          bodyText: email.body,
          sentAt,
          attempts: 1,
          createdBy: user.id,
          createdAt: sentAt,
        })
        .returning();
      await tx.insert(emailEvents).values({ workspaceId: ws.id, messageId: out.id, campaignId: intro.id, prospectId: o.p.id, type: 'sent', stepPosition: 0, createdAt: sentAt });
      await tx.insert(activities).values([
        { workspaceId: ws.id, prospectId: o.p.id, campaignId: intro.id, actorId: user.id, type: 'added_to_campaign', data: { campaignName: intro.name }, createdAt: daysAgo(3, 3) },
        { workspaceId: ws.id, prospectId: o.p.id, campaignId: intro.id, type: 'email_sent', data: { subject: email.subject, step: 1, messageId: out.id }, createdAt: sentAt },
      ]);
      if (o.reply) {
        const [inbound] = await tx
          .insert(emailMessages)
          .values({
            workspaceId: ws.id,
            threadId: thread.id,
            integrationId: integration.id,
            prospectId: o.p.id,
            campaignId: intro.id,
            direction: 'inbound',
            status: 'received',
            providerMessageId: `sandbox-seed-in-${rec.id}`,
            messageIdHeader: `<seed-in-${rec.id}@example.test>`,
            inReplyTo: `<seed-${rec.id}@localy.dev>`,
            fromEmail: o.p.email!,
            fromName: o.p.contactFirstName,
            toEmail: DEV_EMAIL,
            subject: `Re: ${email.subject}`,
            bodyText: o.reply.body,
            receivedAt: o.reply.at,
            createdAt: o.reply.at,
          })
          .returning();
        await tx.insert(emailEvents).values({ workspaceId: ws.id, messageId: inbound.id, campaignId: intro.id, prospectId: o.p.id, type: 'replied', createdAt: o.reply.at });
        await tx.insert(activities).values({ workspaceId: ws.id, prospectId: o.p.id, campaignId: intro.id, type: 'reply_received', data: { subject: `Re: ${email.subject}`, messageId: inbound.id }, createdAt: o.reply.at });
      }
      await tx.update(prospects).set({ lastContactedAt: sentAt, lastReplyAt: o.reply?.at ?? null }).where(eq(prospects.id, o.p.id));
    }
    await tx.insert(activities).values({ workspaceId: ws.id, campaignId: intro.id, type: 'campaign_completed', data: { campaignName: intro.name }, createdAt: daysAgo(1) });
    const now = new Date();
    const period = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    await tx.insert(usageCounters).values({ workspaceId: ws.id, metric: 'emails_sent', period, count: outreach.length });
    await tx.insert(notifications).values({
      workspaceId: ws.id,
      userId: user.id,
      type: 'reply',
      title: 'New reply from Example Observatory Cafe',
      body: outreach[1].reply!.body.slice(0, 180),
      link: '/app/inbox',
    });

    await tx.insert(savedSearches).values({
      workspaceId: ws.id,
      createdBy: user.id,
      name: 'Local barbers, Cape Town',
      config: { categories: ['barbers'], keyword: null, location: { label: 'Cape Town, South Africa', placeId: null, lat: -33.9249, lng: 18.4241, source: 'pin', resolvedAt: null }, radiusMeters: 10_000, filters: { website: 'not_listed', phone: 'any', operationalOnly: true } },
    });
    await tx.insert(notifications).values({
      workspaceId: ws.id,
      userId: user.id,
      type: 'system',
      title: 'Welcome to the Localy development workspace',
      body: 'This workspace contains example data for local development only.',
      link: '/app',
    });
  });
  console.log('Development data created.');
  console.log(`Sign in with ${DEV_EMAIL} / ${DEV_PASSWORD}`);
  await closeDb();
}

main().catch(async (err) => {
  console.error(err);
  await closeDb();
  process.exit(1);
});

