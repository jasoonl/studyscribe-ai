import mysql from 'mysql2/promise';

const conn = await mysql.createConnection(process.env.DATABASE_URL);

const statements = [
  `CREATE TABLE IF NOT EXISTS \`studyGuides\` (
    \`id\` int AUTO_INCREMENT NOT NULL,
    \`recordingId\` int NOT NULL,
    \`userId\` int NOT NULL,
    \`title\` varchar(255) NOT NULL,
    \`content\` text NOT NULL,
    \`keyPoints\` json,
    \`status\` enum('generating','completed','failed') DEFAULT 'generating',
    \`generatedAt\` timestamp NULL,
    \`createdAt\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    \`updatedAt\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY(\`id\`)
  )`,
  `CREATE TABLE IF NOT EXISTS \`quizzes\` (
    \`id\` int AUTO_INCREMENT NOT NULL,
    \`recordingId\` int NOT NULL,
    \`userId\` int NOT NULL,
    \`title\` varchar(255) NOT NULL,
    \`description\` text,
    \`questions\` json,
    \`status\` enum('generating','completed','failed') DEFAULT 'generating',
    \`generatedAt\` timestamp NULL,
    \`createdAt\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    \`updatedAt\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY(\`id\`)
  )`,
  `CREATE TABLE IF NOT EXISTS \`quizAttempts\` (
    \`id\` int AUTO_INCREMENT NOT NULL,
    \`quizId\` int NOT NULL,
    \`userId\` int NOT NULL,
    \`answers\` json,
    \`score\` int,
    \`completedAt\` timestamp NULL,
    \`createdAt\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(\`id\`)
  )`,
];

for (const sql of statements) {
  const tableName = sql.match(/CREATE TABLE IF NOT EXISTS `(\w+)`/)?.[1];
  try {
    await conn.execute(sql);
    console.log(`✓ Created table: ${tableName}`);
  } catch (err) {
    console.error(`✗ Failed to create ${tableName}:`, err.message);
  }
}

await conn.end();
console.log('Migration complete!');
