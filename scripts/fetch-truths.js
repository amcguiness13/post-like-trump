'use strict';

require('dotenv').config({ override: true });

const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const TOKEN = process.argv[2] || process.env.TRUTH_SOCIAL_TOKEN;

if (!TOKEN) {
  console.log(`
Usage: node scripts/fetch-truths.js <bearer-token>
  Or:  set TRUTH_SOCIAL_TOKEN=<token> in .env, then run without argument

How to get your Bearer token:
  1. Log into truthsocial.com in your browser
  2. Open DevTools (F12) → Network tab
  3. Refresh the page
  4. Click any request to truthsocial.com/api/...
  5. Look at the Request Headers → "Authorization"
  6. Copy the value after "Bearer " (the long string)
`);
  process.exit(1);
}

const BASE    = 'https://truthsocial.com';
const ACCOUNT = 'realDonaldTrump';

// ─── DB setup ────────────────────────────────────────────────────────────────

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

// ─── Helpers ─────────────────────────────────────────────────────────────────

function stripHtml(html) {
  return html
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g,  '<')
    .replace(/&gt;/g,  '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function extractTopics(text) {
  const t = text.toLowerCase();
  const topics = new Set();

  if (/fake news|cnn|msnbc|abc news|nbc|media|journalist|lamestream|reporter/.test(t))
    topics.add('media').add('fake news');
  if (/election|vote|ballot|rigged|fraud|stolen|voter id|mail.in/.test(t))
    topics.add('election').add('fraud');
  if (/china|chinese|tariff|trade deal|fentanyl|wuhan/.test(t))
    topics.add('china').add('trade');
  if (/border|illegal|immigration|migrant|wall|mexico/.test(t))
    topics.add('border').add('immigration');
  if (/economy|jobs|unemployment|inflation|stock market|gdp|prices|wages/.test(t))
    topics.add('economy');
  if (/deep state|fbi|doj|cia|weaponized|corrupt|witch hunt|hoax|soros/.test(t))
    topics.add('deep state').add('witch hunt');
  if (/maga|make america|rally|patriot|silent majority/.test(t))
    topics.add('maga').add('rally');
  if (/indictment|prosecut|trial|arraign|lawfare|alvin bragg|jack smith/.test(t))
    topics.add('indictment').add('witch hunt');
  if (/nato|ukraine|russia|putin|middle east|israel|china|foreign/.test(t))
    topics.add('international');
  if (/tremendous|beautiful|greatest|incredible|fantastic|amazing|best ever/.test(t))
    topics.add('personal greatness');
  if (/poll|approval|number|winning|landslide/.test(t))
    topics.add('poll numbers');
  if (/twitter|facebook|social media|censorship|banned|truth social/.test(t))
    topics.add('social media').add('censorship');
  if (/energy|oil|gas|keystone|pipeline|green new deal/.test(t))
    topics.add('energy');
  if (/military|veteran|troop|soldier|war|nato|peace/.test(t))
    topics.add('military');

  return [...topics];
}

async function fetchJSON(url) {
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept:        'application/json',
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function run() {
  // Resolve account ID
  console.log(`\nLooking up @${ACCOUNT}...`);
  const account = await fetchJSON(`${BASE}/api/v1/accounts/lookup?acct=${ACCOUNT}`);
  console.log(`Found: ${account.display_name} (id: ${account.id})`);
  console.log(`Total posts on profile: ${account.statuses_count}\n`);

  let maxId    = null;
  let page     = 0;
  let fetched  = 0;
  let inserted = 0;

  while (true) {
    page++;
    const params = new URLSearchParams({
      limit:             '40',
      exclude_replies:   'true',
      exclude_reblogs:   'true',
      ...(maxId ? { max_id: maxId } : {}),
    });

    let statuses;
    try {
      statuses = await fetchJSON(`${BASE}/api/v1/accounts/${account.id}/statuses?${params}`);
    } catch (err) {
      console.error(`Page ${page} failed: ${err.message}`);
      break;
    }

    if (!statuses.length) {
      console.log('Reached the end of the timeline.');
      break;
    }

    for (const s of statuses) {
      const text = stripHtml(s.content || '');
      if (text.length < 30) continue;

      const topics = extractTopics(text);
      const result = insertStmt.run(text, JSON.stringify(topics), s.created_at ?? null);
      if (result.changes) inserted++;
      fetched++;
    }

    maxId = statuses[statuses.length - 1].id;
    process.stdout.write(`\rPage ${page} — fetched: ${fetched}, inserted: ${inserted} ...`);

    // Be polite to the server
    await new Promise(r => setTimeout(r, 400));
  }

  const total = db.prepare('SELECT COUNT(*) AS n FROM posts').get().n;
  console.log(`\n\nDone!`);
  console.log(`  Posts fetched : ${fetched}`);
  console.log(`  New posts added: ${inserted}`);
  console.log(`  Total in DB   : ${total}\n`);
}

run().catch(err => {
  console.error('\nFatal error:', err.message);
  process.exit(1);
});
