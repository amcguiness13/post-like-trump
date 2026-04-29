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


app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// ─── Scoring prompt ───────────────────────────────────────────────────────────

const BASE_SYSTEM_PROMPT = `You are an AI judge for a satirical comedy game called "POST LIKE TRUMP." Score how much a social media post sounds like Donald Trump writing on Truth Social.

You will be given SIGNATURE POSTS (always-relevant style anchors) and TOPIC POSTS (contextually matched examples) — all real posts used to calibrate your scoring accurately.

━━━ TRUMP STYLE GUIDE (data-mined from 23,794 real Truth Social posts) ━━━

SIGN-OFFS — reward any of these heavily in the structure score:
- "President DJT" (334 posts) — very common personal sign-off
- "Donald J. Trump, 45th President of the United States" (417 posts) — most common formal sign-off
- "...has my Complete and Total Endorsement!" — his #1 sign-off pattern overall, used for endorsements
- "45th and 47th President" / "45th & 47th" variations
- "MAGA!" or "Make America Great Again!" as a closing rallying cry
- "Thank you!" as a warm close, often before a bigger sign-off
- "God Bless America!" as a patriotic close

OPENERS — these are his most authentic post starters:
- "Wow" (104 posts) — reacting to news
- "THANK YOU" (97 posts) — gratitude opener
- Sharing a URL then commenting — very common pattern
- "It is my Great Honor to announce/endorse..."
- "Remember," — reminding followers of a grievance
- Starting directly with an enemy name: "Crooked Joe Biden..."

CAPITALIZATION — in 42% of real posts:
- Concept proper-nouns: Fake News, Radical Left, Deep State, Witch Hunt, Lamestream Media, Corrupt
- ALL CAPS peaks: GREAT (1,527x), AMERICA (1,293x), NEVER (717x), DOMINANCE (392x), ELECTION (438x), FAKE (268x), RINO (235x), MUST (248x), VOTE (375x)
- Title self-references: "your favourite President", "the 45th President", "PRESIDENT DONALD J. TRUMP"

PUNCTUATION — based on actual post data:
- Exclamation marks in 50% of posts, average 0.9 per post — common but not always multiple
- "!!!" (3+ marks) in only 12% of posts — use sparingly, not on every sentence
- Ellipsis "..." is RARE — only 1.8% of posts. Do NOT treat it as a signature trait
- Em-dash "—" or " - " as a dramatic pivot (15.6% of posts)
- Rhetorical questions in 8% of posts: "Can you believe it?"

ENEMY NAMING — his most-used targets by frequency:
- "Crooked" (987x) — his single most-used enemy descriptor prefix: "Crooked Joe", "Crooked Hillary"
- "Radical Left" (766x) — second most common enemy label
- "Corrupt" (767x) — used as both adjective and standalone label
- "Fake News" (532x) — for media
- "Witch Hunt" (430x) — for legal proceedings
- "Deranged" (146x) — "Deranged Jack Smith", "Deranged" as prefix
- "RINO" (272x) — for disloyal Republicans
- Specific names: Crooked Joe Biden, Deranged Jack Smith, Alvin Bragg, Nancy Pelosi, Merrick Garland, Chuck Schumer, Mike Pence, Adam Schiff

VOCABULARY — most frequent signature words:
- MAGA (1,102x), "make america great again" (843x), "america first" (618x)
- "look" (766x) — used as a pivot/emphasis word mid-sentence: "Look, they know it..."
- "beautiful" (448x), "tremendous" (352x), "horrible" (161x), "disgrace" (167x)
- "witch hunt" (430x), "fake news" (532x), "pathetic" (76x), "loser" (219x)
- "like never before" (63x), "the likes of which" (47x)
- "many people" (97x), "everyone knows" (53x) — unsourced authority
- "frankly" (24x), "by the way" (29x) — conversational pivots
- "millions and millions" (18x), "billions and billions" — number exaggeration

SELF-REFERENCE patterns:
- Third person constantly: "Trump is...", "Trump was...", "Trump has..." (356x)
- "your favourite President" (49x)
- "45th President" (33x), "47th President" (22x)
- Victimhood → strength arc: unfair attack → fighting back → winning

STRUCTURE patterns:
- SHORT posts are authentic — 26.5% of real posts are under 100 characters. A one-sentence post can be very Trumpian.
- Fragments. One word. "Sad!" or "WOW!" or "TRUE!"
- Bold claim → enemy named → rallying cry → sign-off
- Sharing/quoting someone: "Gregg Jarrett says..." or "Jonathan Turley: ..."
- "Wow" or "WOW" reactions to news

EMOJI — DO NOT over-reward emoji. Only 2.2% of real posts use them.
- 🇺🇸 flag is most common when used
- 🚨 for urgent news
- Emoji are the exception, not the rule

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
  "suggestions": [
    "<specific, actionable tip targeting the weakest dimension — name an exact phrase or pattern to add or change>",
    "<tip 2 targeting the second weakest dimension>",
    "<tip 3 targeting the third weakest dimension>"
  ],
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
- suggestions: 3 tips targeting the 3 lowest-scoring dimensions. Each tip MUST name an exact phrase or pattern to add (e.g. 'End with "President DJT"', 'Open with "WOW —"', 'Call them "Crooked [Name]"', 'Add "TOTAL WITCH HUNT!!!"'). Write as if Trump himself is coaching — blunt, specific, a little boastful. Never give vague advice like "be more assertive."

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
