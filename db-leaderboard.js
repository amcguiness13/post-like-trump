'use strict';

const { createClient } = require('@libsql/client');

const db = createClient({
  url:       process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

async function initLeaderboard() {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS leaderboard (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT    NOT NULL,
      score      INTEGER NOT NULL,
      post_text  TEXT    NOT NULL,
      topic      TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

async function getLeaderboard() {
  const result = await db.execute(`
    SELECT id, name, score, post_text, topic, created_at
    FROM leaderboard
    ORDER BY score DESC, created_at ASC
    LIMIT 10
  `);
  return result.rows;
}

async function addLeaderboardEntry(name, score, postText, topic) {
  await db.execute({
    sql:  'INSERT INTO leaderboard (name, score, post_text, topic) VALUES (?, ?, ?, ?)',
    args: [name, score, postText, topic || null],
  });
  // Enforce top-10 cap — delete anything outside the best 10
  await db.execute(`
    DELETE FROM leaderboard
    WHERE id NOT IN (
      SELECT id FROM leaderboard ORDER BY score DESC, created_at ASC LIMIT 10
    )
  `);
}

module.exports = { initLeaderboard, getLeaderboard, addLeaderboardEntry };
