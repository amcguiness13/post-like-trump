'use strict';

// Imports all Trump Truth Social posts from the Hugging Face dataset
// (chrissoria/trump-truth-social — 32,815 posts, no login required)
//
// Usage: node scripts/import-hf.js
// Re-run any time to resume — progress is saved and duplicates are skipped.

const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs   = require('fs');

const DATASET       = 'chrissoria/trump-truth-social';
const API_BASE      = 'https://datasets-server.huggingface.co/rows';
const BATCH         = 100;
const TOTAL         = 32815;
const PROGRESS_FILE = path.join(__dirname, '.import-progress');
const BATCH_DELAY   = 600;   // ms between successful batches
const MAX_RETRIES   = 6;     // retries per batch on 429/5xx

// ─── DB ──────────────────────────────────────────────────────────────────────

const db = new DatabaseSync(path.join(__dirname, '..', 'trump_posts.db'));

db.exec(`CREATE TABLE IF NOT EXISTS posts (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  text      TEXT    NOT NULL UNIQUE,
  topics    TEXT,
  post_date TEXT,
  added_at  DATETIME DEFAULT CURRENT_TIMESTAMP
)`);

const insertStmt = db.prepare(
  'INSERT OR IGNORE INTO posts (text, topics, post_date) VALUES (?, ?, ?)'
);

// ─── Topic tagging ────────────────────────────────────────────────────────────

function extractTopics(text) {
  const t = text.toLowerCase();
  const topics = new Set();
  if (/fake news|cnn|msnbc|media|journalist|lamestream|failing/.test(t))     topics.add('media').add('fake news');
  if (/election|vote|ballot|rigged|fraud|stolen|voter id|mail.in/.test(t))   topics.add('election').add('fraud');
  if (/china|chinese|tariff|trade deal|fentanyl|wuhan/.test(t))              topics.add('china').add('trade');
  if (/border|illegal|immigration|migrant|wall|mexico/.test(t))              topics.add('border').add('immigration');
  if (/economy|jobs|unemployment|inflation|stock market|gdp|prices/.test(t)) topics.add('economy');
  if (/deep state|fbi|doj|cia|weaponized|corrupt|witch hunt|hoax/.test(t))  topics.add('deep state').add('witch hunt');
  if (/maga|make america|rally|patriot/.test(t))                             topics.add('maga').add('rally');
  if (/indictment|prosecut|lawfare|alvin bragg|jack smith/.test(t))          topics.add('indictment').add('witch hunt');
  if (/nato|ukraine|russia|putin|israel|middle east/.test(t))                topics.add('international');
  if (/tremendous|beautiful|greatest|incredible|best ever/.test(t))          topics.add('personal greatness');
  if (/poll|approval|winning|landslide/.test(t))                             topics.add('poll numbers');
  if (/twitter|facebook|social media|censored|banned|truth social/.test(t))  topics.add('social media').add('censorship');
  if (/energy|oil|gas|keystone|pipeline/.test(t))                            topics.add('energy');
  if (/military|veteran|troop|soldier/.test(t))                              topics.add('military');
  if (/net worth|billion|property|mar.a.lago|trump tower/.test(t))           topics.add('net worth').add('wealth');
  return [...topics];
}

// ─── Fetch with retry + exponential backoff ───────────────────────────────────

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchBatch(offset) {
  const url = `${API_BASE}?dataset=${encodeURIComponent(DATASET)}&config=default&split=train&offset=${offset}&limit=${BATCH}`;
  let delay = 5000;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });

    if (res.ok) return res.json();

    if (res.status === 429 || res.status >= 500) {
      // Honour Retry-After header if present
      const retryAfter = parseInt(res.headers.get('retry-after') || '0', 10);
      const wait = retryAfter > 0 ? retryAfter * 1000 : delay;
      process.stdout.write(`\n  Rate limited — waiting ${Math.round(wait / 1000)}s (attempt ${attempt}/${MAX_RETRIES})...`);
      await sleep(wait);
      delay = Math.min(delay * 2, 60000); // cap at 60s
      continue;
    }

    throw new Error(`HTTP ${res.status} at offset ${offset}`);
  }

  throw new Error(`Max retries exceeded at offset ${offset}`);
}

// ─── Progress helpers ─────────────────────────────────────────────────────────

function loadProgress() {
  try { return parseInt(fs.readFileSync(PROGRESS_FILE, 'utf8'), 10) || 0; }
  catch { return 0; }
}

function saveProgress(offset) {
  fs.writeFileSync(PROGRESS_FILE, String(offset));
}

function clearProgress() {
  try { fs.unlinkSync(PROGRESS_FILE); } catch {}
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function run() {
  const startOffset = loadProgress();
  let offset   = startOffset;
  let inserted = 0;
  let skipped  = 0;

  console.log(`\nImporting Trump Truth Social posts from Hugging Face`);
  console.log(`Dataset  : ${DATASET}`);
  console.log(`Resuming : offset ${offset.toLocaleString()} / ~${TOTAL.toLocaleString()}\n`);

  while (offset < TOTAL) {
    let data;
    try {
      data = await fetchBatch(offset);
    } catch (err) {
      saveProgress(offset);
      console.error(`\n\nStopped at offset ${offset}: ${err.message}`);
      console.log(`Progress saved — re-run to continue.\n`);
      process.exit(1);
    }

    if (!data.rows?.length) break;

    db.exec('BEGIN');
    for (const { row } of data.rows) {
      const text = (row.text || '').trim();
      if (text.length < 30) { skipped++; continue; }
      const topics = extractTopics(text);
      const result = insertStmt.run(text, JSON.stringify(topics), row.date ?? null);
      if (result.changes) inserted++; else skipped++;
    }
    db.exec('COMMIT');

    offset += data.rows.length;
    saveProgress(offset);

    const pct = Math.min(100, Math.round((offset / TOTAL) * 100));
    process.stdout.write(`\r[${pct}%] ${offset.toLocaleString()} / ~${TOTAL.toLocaleString()} — ${inserted.toLocaleString()} inserted`);

    await sleep(BATCH_DELAY);
  }

  clearProgress();

  const total = db.prepare('SELECT COUNT(*) AS n FROM posts').get().n;
  console.log(`\n\nDone!`);
  console.log(`  Inserted : ${inserted.toLocaleString()} new posts`);
  console.log(`  Skipped  : ${skipped.toLocaleString()} (duplicates / too short)`);
  console.log(`  Total DB : ${total.toLocaleString()} posts\n`);
}

run().catch(err => {
  console.error('\nFatal:', err.message);
  process.exit(1);
});
