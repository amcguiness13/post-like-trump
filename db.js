'use strict';

const { DatabaseSync } = require('node:sqlite');
const path  = require('path');
const posts = require('./data/trump_posts.json');

const db = new DatabaseSync(path.join(__dirname, 'trump_posts.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS posts (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    text      TEXT    NOT NULL UNIQUE,
    topics    TEXT,
    post_date TEXT,
    added_at  DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS leaderboard (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT    NOT NULL,
    score      INTEGER NOT NULL,
    post_text  TEXT    NOT NULL,
    topic      TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// Seed the database on first run
const rowCount = db.prepare('SELECT COUNT(*) AS n FROM posts').get().n;
if (rowCount === 0) {
  const insert = db.prepare(
    'INSERT OR IGNORE INTO posts (text, topics, post_date) VALUES (?, ?, ?)'
  );
  db.exec('BEGIN');
  try {
    for (const p of posts) {
      insert.run(p.text, JSON.stringify(p.topics ?? []), p.date ?? null);
    }
    db.exec('COMMIT');
    console.log(`Seeded ${posts.length} Trump posts into database`);
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

const STOP_WORDS = new Set([
  'the','a','an','and','or','but','in','on','at','to','for','of','with','by',
  'is','are','was','were','be','been','have','has','had','will','would','could',
  'should','that','this','these','those','it','we','they','their','them','our',
  'your','my','his','her','not','no','so','if','as','from','very','just','also',
  'about','what','when','where','who','how','some','there','than','then','now',
  'only','even','more','most','such','after','before','over','out','all','can',
  'do','does','did','may','might','any','its','into','up','which','much','i',
]);

function extractKeywords(text) {
  return [...new Set(
    text.toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 3 && !STOP_WORDS.has(w))
  )].slice(0, 8);
}

// Returns a small curated set of posts that anchor the judge to Trump's signature traits.
// These are always included in the prompt regardless of the submission topic.
function getSignaturePosts() {
  const queries = [
    // Sign-off: "President DJT"
    `SELECT text FROM posts WHERE text LIKE '%President DJT%' ORDER BY RANDOM() LIMIT 3`,
    // Sign-off: title variants
    `SELECT text FROM posts WHERE text LIKE '%45th President%' OR text LIKE '%47th President%' ORDER BY RANDOM() LIMIT 2`,
    // Ellipsis + exclamation heavy
    `SELECT text FROM posts WHERE text LIKE '%...%' AND text LIKE '%!!!%' ORDER BY RANDOM() LIMIT 2`,
    // Third-person self-reference
    `SELECT text FROM posts WHERE (text LIKE '%President Trump%' OR text LIKE '%Donald Trump%') AND length(text) > 100 ORDER BY RANDOM() LIMIT 2`,
    // Stacked superlatives
    `SELECT text FROM posts WHERE text LIKE '%GREATEST%' AND text LIKE '%EVER%' ORDER BY RANDOM() LIMIT 1`,
  ];

  const seen = new Set();
  const results = [];
  for (const q of queries) {
    for (const row of db.prepare(q).all()) {
      if (!seen.has(row.text)) {
        seen.add(row.text);
        results.push(row);
      }
    }
  }
  return results;
}

// Returns up to `limit` posts relevant to the given text via keyword LIKE matching,
// with a random-sample fallback.
function getRelevantPosts(postText, limit = 15) {
  const keywords = extractKeywords(postText);

  if (keywords.length > 0) {
    // Build a query: text LIKE '%kw1%' OR text LIKE '%kw2%' ...
    const clauses = keywords.map(() => 'text LIKE ?').join(' OR ');
    const params  = keywords.map(kw => `%${kw}%`);

    const rows = db.prepare(
      `SELECT text FROM posts WHERE ${clauses} ORDER BY RANDOM() LIMIT ?`
    ).all(...params, limit);

    if (rows.length >= Math.min(5, limit)) return rows;
  }

  return db.prepare('SELECT text FROM posts ORDER BY RANDOM() LIMIT ?').all(limit);
}

const CHEAT_THRESHOLD = 0.82; // Jaccard similarity above this = plagiarism

function normalizeForSimilarity(text) {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function jaccardSimilarity(a, b) {
  const wordsA = new Set(normalizeForSimilarity(a).split(' ').filter(w => w.length > 3));
  const wordsB = new Set(normalizeForSimilarity(b).split(' ').filter(w => w.length > 3));
  if (wordsA.size === 0 || wordsB.size === 0) return 0;
  const shared = [...wordsA].filter(w => wordsB.has(w)).length;
  const union  = new Set([...wordsA, ...wordsB]).size;
  return shared / union;
}

// Returns the matching DB post text if the submission is plagiarised, otherwise null.
function findDuplicate(postText) {
  const norm  = normalizeForSimilarity(postText);
  // Use words with 6+ chars — long enough to be distinctive, no punctuation issues
  const words = norm.split(' ').filter(w => w.length >= 6);
  if (words.length < 3) return null;

  // Query with 3 spread-out words to maximise recall without false positives
  const picks = [
    words[Math.floor(words.length * 0.2)],
    words[Math.floor(words.length * 0.5)],
    words[Math.floor(words.length * 0.8)],
  ];

  const seen = new Map();
  for (const word of picks) {
    const rows = db.prepare(
      `SELECT text FROM posts WHERE lower(text) LIKE ? LIMIT 15`
    ).all(`%${word}%`);
    for (const row of rows) seen.set(row.text, row.text);
  }

  for (const text of seen.values()) {
    if (jaccardSimilarity(postText, text) >= CHEAT_THRESHOLD) return text;
  }
  return null;
}

function addPost(text, topics = [], postDate = null) {
  return db.prepare(
    'INSERT OR IGNORE INTO posts (text, topics, post_date) VALUES (?, ?, ?)'
  ).run(text, JSON.stringify(topics), postDate);
}

function getAllPosts(limit = 100, offset = 0) {
  return db.prepare(
    'SELECT * FROM posts ORDER BY added_at DESC LIMIT ? OFFSET ?'
  ).all(limit, offset);
}

function getStats() {
  return {
    total_posts: db.prepare('SELECT COUNT(*) AS n FROM posts').get().n,
  };
}

function getLeaderboard() {
  return db.prepare(`
    SELECT id, name, score, post_text, topic, created_at
    FROM leaderboard
    ORDER BY score DESC, created_at ASC
    LIMIT 10
  `).all();
}

function addLeaderboardEntry(name, score, postText, topic) {
  return db.prepare(
    'INSERT INTO leaderboard (name, score, post_text, topic) VALUES (?, ?, ?, ?)'
  ).run(name, score, postText, topic || null);
}

module.exports = { getSignaturePosts, getRelevantPosts, findDuplicate, addPost, getAllPosts, getStats, getLeaderboard, addLeaderboardEntry };
