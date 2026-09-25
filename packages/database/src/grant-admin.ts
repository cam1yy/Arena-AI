/**
 * Grants or revokes platform administrator access. There is intentionally no
 * UI for this; it must be run by someone with database access.
 *
 *   npm run admin:grant -- someone@example.com
 *   npm run admin:grant -- someone@example.com --revoke
 */
import { sql } from 'drizzle-orm';
import { closeDb, getDb } from './client';
import { users } from './schema';

async function main() {
  const email = process.argv[2];
  const revoke = process.argv.includes('--revoke');
  if (!email) {
    console.error('Usage: npm run admin:grant -- <email> [--revoke]');
    process.exit(1);
  }
  const res = await getDb()
    .update(users)
    .set({ isPlatformAdmin: !revoke })
    .where(sql`lower(${users.email}) = ${email.toLowerCase()}`)
    .returning({ id: users.id });
  console.log(res.length ? `${revoke ? 'Revoked' : 'Granted'} platform admin for ${email}.` : `No user found with email ${email}.`);
  await closeDb();
}

main().catch(async (err) => {
  console.error(err);
  await closeDb();
  process.exit(1);
});
