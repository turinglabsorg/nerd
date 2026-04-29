import { posts, comments, users } from "./db.js";
import { config } from "./config.js";

const UA = "nerd-agent/1.0";

async function fetchRedditUser(username) {
  if (!username || username === "[deleted]" || username === "AutoModerator") return null;

  try {
    const url = `https://www.reddit.com/user/${username}/about.json`;
    const res = await fetch(url, { headers: { "User-Agent": UA } });
    if (!res.ok) return null;
    const json = await res.json();
    return json.data;
  } catch {
    return null;
  }
}

function calculateHumanityScore(user, userComments) {
  let score = 50; // Start neutral
  const signals = [];

  if (!user) {
    return { score: 0, signals: ["user deleted or suspended"] };
  }

  // === ACCOUNT AGE ===
  const ageInDays = (Date.now() / 1000 - user.created_utc) / 86400;
  if (ageInDays > 365 * 2) {
    score += 10;
    signals.push(`account age: ${(ageInDays / 365).toFixed(1)}y (+10)`);
  } else if (ageInDays > 365) {
    score += 5;
    signals.push(`account age: ${(ageInDays / 365).toFixed(1)}y (+5)`);
  } else if (ageInDays < 30) {
    score -= 15;
    signals.push(`new account: ${ageInDays.toFixed(0)}d (-15)`);
  } else if (ageInDays < 90) {
    score -= 5;
    signals.push(`young account: ${ageInDays.toFixed(0)}d (-5)`);
  }

  // === KARMA ===
  const totalKarma = (user.link_karma || 0) + (user.comment_karma || 0);
  if (totalKarma > 10000) {
    score += 10;
    signals.push(`high karma: ${totalKarma} (+10)`);
  } else if (totalKarma > 1000) {
    score += 5;
    signals.push(`good karma: ${totalKarma} (+5)`);
  } else if (totalKarma < 10) {
    score -= 10;
    signals.push(`very low karma: ${totalKarma} (-10)`);
  } else if (totalKarma < 100) {
    score -= 3;
    signals.push(`low karma: ${totalKarma} (-3)`);
  }

  // === KARMA RATIO (link vs comment) ===
  if (totalKarma > 100) {
    const commentRatio = (user.comment_karma || 0) / totalKarma;
    if (commentRatio > 0.3 && commentRatio < 0.95) {
      score += 5;
      signals.push(`balanced karma ratio: ${(commentRatio * 100).toFixed(0)}% comment (+5)`);
    } else if (commentRatio < 0.05) {
      score -= 5;
      signals.push(`almost no comment karma (-5)`);
    }
  }

  // === VERIFIED EMAIL ===
  if (user.has_verified_email) {
    score += 5;
    signals.push("verified email (+5)");
  } else {
    score -= 3;
    signals.push("no verified email (-3)");
  }

  // === USERNAME PATTERN ===
  const name = user.name || "";
  // Auto-generated names: Word-Word-Number or Word_Word_Number
  if (/^[A-Z][a-z]+-[A-Z][a-z]+-\d+$/.test(name) ||
      /^[A-Z][a-z]+_[A-Z][a-z]+_\d+$/.test(name) ||
      /^[a-z]+-[a-z]+-[a-z]+\d*$/.test(name)) {
    score -= 8;
    signals.push(`auto-generated username pattern (-8)`);
  }

  // === COMMENT ANALYSIS (from our DB) ===
  if (userComments.length > 0) {
    // Vocabulary diversity
    const allWords = userComments
      .map(c => (c.body || "").toLowerCase().split(/\s+/))
      .flat()
      .filter(w => w.length > 3);
    const uniqueWords = new Set(allWords);
    const vocabRatio = allWords.length > 20
      ? uniqueWords.size / allWords.length
      : 0;

    if (vocabRatio > 0.5) {
      score += 5;
      signals.push(`high vocab diversity: ${(vocabRatio * 100).toFixed(0)}% (+5)`);
    } else if (vocabRatio > 0 && vocabRatio < 0.2) {
      score -= 5;
      signals.push(`low vocab diversity: ${(vocabRatio * 100).toFixed(0)}% (-5)`);
    }

    // Average comment length
    const avgLen = userComments.reduce((sum, c) => sum + (c.body || "").length, 0) / userComments.length;
    if (avgLen > 200) {
      score += 5;
      signals.push(`detailed comments avg ${avgLen.toFixed(0)} chars (+5)`);
    } else if (avgLen < 20) {
      score -= 5;
      signals.push(`very short comments avg ${avgLen.toFixed(0)} chars (-5)`);
    }

    // Score variance (bots tend to have uniform scores)
    if (userComments.length >= 3) {
      const scores = userComments.map(c => c.score || 0);
      const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
      const variance = scores.reduce((sum, s) => sum + Math.pow(s - mean, 2), 0) / scores.length;
      if (variance > 10) {
        score += 3;
        signals.push(`varied comment scores (+3)`);
      } else if (variance < 1 && userComments.length > 5) {
        score -= 3;
        signals.push(`uniform comment scores (-3)`);
      }
    }

    // Comment timing patterns
    if (userComments.length >= 3) {
      const times = userComments
        .map(c => c.createdUtc)
        .filter(Boolean)
        .sort();
      if (times.length >= 3) {
        const gaps = [];
        for (let i = 1; i < times.length; i++) {
          gaps.push(times[i] - times[i - 1]);
        }
        const avgGap = gaps.reduce((a, b) => a + b, 0) / gaps.length;
        const gapVariance = gaps.reduce((sum, g) => sum + Math.pow(g - avgGap, 2), 0) / gaps.length;
        // Very regular posting intervals = bot-like
        if (gapVariance < 100 && gaps.length > 3) {
          score -= 5;
          signals.push(`suspiciously regular posting intervals (-5)`);
        }
      }
    }

    // Repetitive content detection
    if (userComments.length >= 3) {
      const bodies = userComments.map(c => (c.body || "").toLowerCase().trim());
      const uniqueBodies = new Set(bodies);
      if (uniqueBodies.size < bodies.length * 0.7) {
        score -= 10;
        signals.push(`${bodies.length - uniqueBodies.size} duplicate comments (-10)`);
      }
    }
  }

  // Clamp
  score = Math.max(0, Math.min(100, score));

  return { score, signals };
}

export async function checkUsers() {
  // Pull recent comments and dedupe authors in memory — avoids a $group full-scan.
  // Requires index on createdUtc.
  const cutoff = new Date(Date.now() - 60 * 60 * 1000);
  const recentComments = await comments()
    .find({}, { projection: { author: 1 } })
    .sort({ createdUtc: -1 })
    .limit(200)
    .toArray();

  const authorNames = [...new Set(
    recentComments
      .map(c => c.author)
      .filter(a => a && a !== "[deleted]" && a !== "AutoModerator")
  )].slice(0, 50);

  if (authorNames.length === 0) {
    console.log("[users] no users to check");
    return 0;
  }

  // Filter to those not recently checked
  const existingUsers = await users()
    .find({
      username: { $in: authorNames },
      lastChecked: { $gte: cutoff },
    })
    .project({ username: 1 })
    .toArray();

  const recentlyChecked = new Set(existingUsers.map(u => u.username));
  const toCheck = authorNames.filter(a => !recentlyChecked.has(a));

  if (toCheck.length === 0) {
    return 0;
  }

  let checked = 0;

  for (const username of toCheck.slice(0, 30)) {
    // Fetch Reddit profile
    const redditUser = await fetchRedditUser(username);

    // Get all comments by this user from our DB
    const userComments = await comments()
      .find({ author: username })
      .sort({ createdUtc: -1 })
      .limit(50)
      .toArray();

    const { score, signals } = calculateHumanityScore(redditUser, userComments);

    const userData = {
      username,
      humanityScore: score,
      humanitySignals: signals,
      commentCount: userComments.length,
      lastChecked: new Date(),
    };

    if (redditUser) {
      userData.accountAge = redditUser.created_utc;
      userData.linkKarma = redditUser.link_karma;
      userData.commentKarma = redditUser.comment_karma;
      userData.totalKarma = (redditUser.link_karma || 0) + (redditUser.comment_karma || 0);
      userData.hasVerifiedEmail = redditUser.has_verified_email;
      userData.isSuspended = false;
    } else {
      userData.isSuspended = true;
    }

    try {
      await users().updateOne(
        { username },
        { $set: userData },
        { upsert: true }
      );
    } catch (e) {
      if (e.code !== 11000) console.error(`[users] ${username} error:`, e.message);
    }

    const label = score >= 70 ? "HUMAN" : score >= 40 ? "MIXED" : "BOT-LIKE";
    console.log(`[users] u/${username}: ${score}% ${label} (${signals.length} signals)`);
    checked++;

    // Rate limit
    await new Promise(r => setTimeout(r, 2000));
  }

  return checked;
}

// Get humanity stats for a post's commenters
export async function getPostHumanityStats(postRedditId) {
  const postComments = await comments()
    .find({ postRedditId })
    .project({ author: 1 })
    .limit(200)
    .toArray();

  const authorNames = [...new Set(
    postComments
      .map(c => c.author)
      .filter(a => a && a !== "[deleted]" && a !== "AutoModerator")
  )];

  if (authorNames.length === 0) {
    return { total: 0, checked: 0, avgHumanity: 0, botLikely: 0, humans: 0 };
  }

  const userDocs = await users()
    .find({ username: { $in: authorNames } })
    .toArray();

  const checked = userDocs.length;
  const avgHumanity = checked > 0
    ? userDocs.reduce((sum, u) => sum + u.humanityScore, 0) / checked
    : 0;
  const botLikely = userDocs.filter(u => u.humanityScore < 40).length;
  const humans = userDocs.filter(u => u.humanityScore >= 70).length;

  return {
    total: authorNames.length,
    checked,
    avgHumanity: Math.round(avgHumanity),
    botLikely,
    humans,
    mixed: checked - botLikely - humans,
  };
}
