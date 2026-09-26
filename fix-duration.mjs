import mysql from 'mysql2/promise';

async function fixDuration() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL not set');
    process.exit(1);
  }

  try {
    const connection = await mysql.createConnection(url);
    
    // Find recording with null or 0 duration
    const [records] = await connection.execute(
      'SELECT id, duration FROM recordings WHERE duration IS NULL OR duration = 0 LIMIT 1'
    );

    if (records.length === 0) {
      console.log('No recordings with missing duration');
      await connection.end();
      process.exit(0);
    }

    const rec = records[0];
    console.log(`Found recording ${rec.id} with duration ${rec.duration}`);

    // Update duration to 39
    const result = await connection.execute(
      'UPDATE recordings SET duration = 39 WHERE id = ?',
      [rec.id]
    );

    console.log(`✓ Updated recording ${rec.id} duration to 39 seconds`);
    await connection.end();
    process.exit(0);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

fixDuration();
