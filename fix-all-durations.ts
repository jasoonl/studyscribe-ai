import { getDb } from './server/db';
import { recordings } from './drizzle/schema';
import { eq } from 'drizzle-orm';
import { promises as fs } from 'fs';
import { spawn } from 'child_process';
import path from 'path';

async function getAudioDuration(filePath: string): Promise<number | null> {
  return new Promise((resolve) => {
    try {
      const proc = spawn('ffprobe', [
        '-v', 'error',
        '-show_entries', 'format=duration',
        '-of', 'default=noprint_wrappers=1:nokey=1:noprint_wrappers=1',
        filePath,
      ]);

      let output = '';
      proc.stdout.on('data', (data) => {
        output += data.toString();
      });

      proc.on('close', (code) => {
        if (code === 0) {
          const duration = parseFloat(output.trim());
          resolve(isNaN(duration) ? null : Math.round(duration));
        } else {
          resolve(null);
        }
      });
    } catch (error) {
      resolve(null);
    }
  });
}

async function fixAllDurations() {
  const db = await getDb();
  if (!db) {
    console.error('Database not available');
    process.exit(1);
  }

  try {
    // Get all recordings
    const allRecordings = await db.select().from(recordings);
    console.log(`Found ${allRecordings.length} recordings`);

    let updated = 0;
    for (const rec of allRecordings) {
      // Check if duration is missing
      if (rec.duration === null || rec.duration === 0) {
        // Try to get duration from audio file
        // In a real scenario, we'd fetch the file from storage
        console.log(`Recording ${rec.id}: duration is missing, would need storage access`);
      } else {
        console.log(`Recording ${rec.id}: duration = ${rec.duration}s`);
      }
    }

    console.log(`\n✓ Checked ${allRecordings.length} recordings`);
    console.log(`Note: To set durations, we need access to the audio files in storage.`);
  } catch (error) {
    console.error('Error:', (error as Error).message);
    process.exit(1);
  }
}

fixAllDurations().then(() => process.exit(0));
