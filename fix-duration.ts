import { getDb } from './server/db';
import { recordings } from './drizzle/schema';
import { eq, or, isNull } from 'drizzle-orm';

async function fixDuration() {
  const db = await getDb();
  if (!db) {
    console.error('Database not available');
    process.exit(1);
  }

  const recs = await db.select().from(recordings)
    .where(or(isNull(recordings.duration), eq(recordings.duration, 0)))
    .limit(1);

  if (recs.length === 0) {
    console.log('No recordings with missing duration');
    process.exit(0);
  }

  const rec = recs[0];
  console.log(`Found recording ${rec.id} with duration ${rec.duration}`);

  await db.update(recordings).set({ duration: 39 }).where(eq(recordings.id, rec.id));
  console.log(`✓ Updated recording ${rec.id} duration to 39 seconds`);
  process.exit(0);
}

fixDuration().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
