'use strict';

require('dotenv').config({ override: true });

const express = require('express');
const cors    = require('cors');
const path    = require('path');
const db      = require('./db');

const app  = express();
const PORT = process.env.PORT || 3000;

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('ERROR: ANTHROPIC_API_KEY is not set. Create a .env file with your key.');
  process.exit(1);
}

const keyPreview = process.env.ANTHROPIC_API_KEY;
console.log(`API key loaded — length: ${keyPreview.length}, starts: ${keyPreview.slice(0,10)}, ends: ${keyPreview.slice(-6)}`);

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// ─── Scoring prompt ───────────────────────────────────────────────────────────

const BASE_SYSTEM_PROMPT = `You are an AI judge for a satirical comedy game called "POST LIKE TRUMP." Score how much a social media post sounds like Donald Trump writing on Truth Social.

You will be given SIGNATURE POSTS (always-relevant style anchors) and TOPIC POSTS (contextually matched examples) — all real posts used to calibrate your scoring accurately.

━━━ TRUMP STYLE GUIDE (extracted from 23,000 real posts) ━━━

SIGN-OFFS (reward these highly for structure score):
- "President DJT" — his single most common sign-off, used constantly
- "Donald J. Trump, 45th President of the United States"
- "45th & 47th President" variations
- "MAGA!" or "Make America Great Again!" as a closing rallying cry
- "Thank you!" as a soft close before a bigger sign-off

CAPITALIZATION patterns:
- Proper-noun treatment of concepts: Fake News, Radical Left, Deep State, Witch Hunt, Mainstream Media, Lamestream Media, Silent Majority
- ALL CAPS emotional peaks: NEVER, ALWAYS, TOTAL DISASTER, RIGGED, WITCH HUNT, NO COLLUSION
- Capitalising titles possessively: "your favourite President", "the 45th President"

PUNCTUATION patterns:
- Ellipsis "..." for dramatic pause and trailing thoughts mid-sentence
- Multiple exclamation marks "!!!" — rarely just one
- Em-dash or double-dash "—" as a dramatic pivot
- Run-on sentences joined with commas instead of full stops

VOCABULARY patterns:
- Stacked superlatives: "the GREATEST, most BEAUTIFUL thing ever built"
- Number exaggeration: "MILLIONS AND MILLIONS", "BILLIONS AND BILLIONS"
- Unsourced authority: "Many people are saying...", "Everyone knows..."
- Core Trumpisms: tremendous, beautiful, perfect, total disaster, fake, nasty, very unfair, sad, loser, witch hunt, rigged, hoax, corrupt, radical, strong, weak, winning

SELF-REFERENCE patterns:
- Third person: "Nobody has done more than Trump", "Trump is the only one who can fix it"
- Title reminders: "your favourite President", "the 45th and 47th President"
- Victimhood pivot to strength: attacked → fighting back → winning

STRUCTURE patterns:
- Short punchy fragments. Sometimes just one word. "Sad!" or "True!"
- Stream-of-consciousness pivots with no transition
- Bold claim → fake evidence cite → enemy named → rallying cry → sign-off
- Rhetorical questions: "Can you believe it? Can you believe what they're doing?"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Return ONLY raw valid JSON — no markdown code fences, no commentary:

{
  "vocabulary": <integer 0-100>,
  "capitalization": <integer 0-100>,
  "punctuation": <integer 0-100>,
  "self_reference": <integer 0-100>,
  "enemy_framing": <integer 0-100>,
  "grievance_tone": <integer 0-100>,
  "call_to_action": <integer 0-100>,
  "structure": <integer 0-100>,
  "overall_score": <integer 0-100, must equal the mathematical average of the 8 scores above>,
  "feedback": "<2-3 sentences of satirical, specific feedback — what landed and what missed. Call out specific phrases that were or weren't Trumpian>",
  "breaking_news": {
    "headline": "<ALL CAPS cable news headline treating the post as a real-world event that just happened>",
    "body": "<2-3 sentences of breathless cable news anchor copy, treating the post content as breaking reality>",
    "ticker": [
      "<stock market update tied to the post's topic>",
      "<celebrity reaction or status update>",
      "<absurd world consequence directly caused by the post>",
      "<completely unrelated absurdist news item>"
    ]
  }
}

Scoring criteria:
- vocabulary: Trumpian superlatives, simple repetitive words, core Trumpisms from the style guide above
- capitalization: ALL CAPS bursts, proper-noun capitalisation of concepts, title self-references
- punctuation: "...", "!!!", em-dashes, run-ons — reward all of these
- self_reference: I/me/my/Trump, third-person self-reference, title reminders, victimhood-to-strength arc
- enemy_framing: named enemies, "radical left", "crooked", "sleepy", "failing", "loser", "nasty"
- grievance_tone: "rigged", "witch hunt", "very unfair", "they're coming after me", victimhood
- call_to_action: MAGA cries, "Vote!", "SAVE AMERICA", "we will WIN!", patriotic appeals
- structure: fragments, pivots, rhetorical questions, sign-offs (especially "President DJT") — reward heavily

A post ending with "President DJT" is a STRONG structure signal and should score 80+ on structure alone.
overall_score MUST equal the exact integer average of all 8 dimension scores.
This is for satire and comedy. Be funny and specific in feedback. Stay in the cable news universe for breaking_news.`;

function buildSystemPrompt(signaturePosts, topicPosts) {
  const sigBlock = signaturePosts.length
    ? '\n\nSIGNATURE POSTS (always-relevant style anchors — study these carefully):\n' +
      signaturePosts.map((p, i) => `${i + 1}. "${p.text}"`).join('\n')
    : '';
  const topBlock = topicPosts.length
    ? '\n\nTOPIC POSTS (matched to the submission topic):\n' +
      topicPosts.map((p, i) => `${i + 1}. "${p.text}"`).join('\n')
    : '';
  return BASE_SYSTEM_PROMPT + sigBlock + topBlock;
}

// ─── Routes ───────────────────────────────────────────────────────────────────

const CHEATER_MESSAGES = [
  "CAUGHT! You copied MY post - the GREATEST post ever written - word for word! That's called PLAGIARISM, folks! Even Sleepy Joe knows you can't do that! You get a BIG FAT ZERO. Nobody steals from Trump. NOBODY! SAD!",
  "TOTAL FRAUD ALERT! I wrote that post! Beautiful post, perfect post - many people said it was the best post ever! And you STOLE IT like a common criminal! Just like they tried to steal the election! DISQUALIFIED! Get out!",
  "CHEATER! I know my own words better than anyone - I'm very smart, probably a genius - and those are MY words! You thought you could fool the Trump system? WRONG! You're as fake as CNN! Zero points. ZERO!",
  "Oh, look at this - a THIEF! Took my post straight from Truth Social and thought nobody would notice! I notice EVERYTHING. I have the best memory, perhaps ever! This is a WITCH HUNT against honest players! You're DONE!",
  "SCAMMER ALERT! That's MY post! I built those words from scratch, beautiful words, the best words! And you just COPIED them like a total loser! Even the Radical Left doesn't cheat this badly! No score for you. PATHETIC!",
];

// Score a post
app.post('/api/score', async (req, res) => {
  const { postText } = req.body;
  if (!postText?.trim()) {
    return res.status(400).json({ error: 'postText is required' });
  }

  // Plagiarism check — compare against the knowledge base
  const duplicate = db.findDuplicate(postText.trim());
  if (duplicate) {
    const msg = CHEATER_MESSAGES[Math.floor(Math.random() * CHEATER_MESSAGES.length)];
    return res.json({ cheater: true, message: msg });
  }

  const signaturePosts = db.getSignaturePosts();
  const topicPosts     = db.getRelevantPosts(postText, 12);
  const systemPrompt   = buildSystemPrompt(signaturePosts, topicPosts);

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method:  'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      'claude-sonnet-4-6',
        max_tokens: 1024,
        system:     systemPrompt,
        messages:   [{
          role:    'user',
          content: `Score this Truth Social post and generate a breaking news outcome: '${postText}'`,
        }],
      }),
    });

    if (!response.ok) {
      const txt = await response.text().catch(() => '');
      console.error('Anthropic API error:', txt.slice(0, 400));
      return res.status(502).json({ error: `Anthropic API returned ${response.status}` });
    }

    const data = await response.json();
    let raw = data.content[0].text.trim();

    if (raw.startsWith('```')) {
      raw = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
    }

    res.json(JSON.parse(raw));
  } catch (err) {
    console.error('Score error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Database stats
app.get('/api/stats', (_req, res) => {
  res.json(db.getStats());
});

// List posts (for admin/review)
app.get('/api/posts', (req, res) => {
  const limit  = Math.min(parseInt(req.query.limit  || '50',  10), 200);
  const offset = parseInt(req.query.offset || '0', 10);
  res.json(db.getAllPosts(limit, offset));
});

// Add a new post to the knowledge base
app.post('/api/posts', (req, res) => {
  const { text, topics, post_date } = req.body;
  if (!text?.trim()) {
    return res.status(400).json({ error: 'text is required' });
  }
  try {
    const result = db.addPost(text.trim(), topics || [], post_date || null);
    res.json({ inserted: result.changes === 1, id: result.lastInsertRowid });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  const stats = db.getStats();
  console.log(`\n🇺🇸  POST LIKE TRUMP server running → http://localhost:${PORT}`);
  console.log(`   Trump posts in knowledge base: ${stats.total_posts}`);
  console.log(`   Press Ctrl+C to stop\n`);
});
