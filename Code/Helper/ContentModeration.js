import Filter from 'leo-profanity';
import i18next from 'i18next';
import { buildMatcher, firstHitKind, matchedTerms, termKey, BUNDLED } from './wordFilterCore';
import { getRemoteWordList, refreshWordList } from './wordBlocklistCache';

/**
 * Comprehensive Content Moderation Utility
 * Detects: slurs, profanity, spam, inappropriate content, links, scams
 *
 * Slurs and profanity go through the word filter (wordFilterCore.js):
 * bundled list + leo-profanity's English words + the moderators' remote list
 * (supabase/049, cached by wordBlocklistCache.js), matched after
 * normalisation (leetspeak, look-alike letters, spacing, repeats). The server
 * rejects the same slurs in chat (049 trigger) and masks them in posts,
 * comments and statuses (functions/wordFilterContent.js).
 */

// ✅ Initialize leo-profanity filter
Filter.loadDictionary('en');

// leo-profanity words that normalise into something much broader than the
// original token ('s&m' -> 'sm').
const LEO_SKIP = new Set(['s&m']);

// ✅ Custom spam/scam keywords and phrases
const SPAM_KEYWORDS = [
  // Spam/Scam phrases
  'subscribe my channel',
  'subscribe to my channel',
  'subscribe to channel',
  'check out my channel',
  'visit my channel',
  'free giveaway',
  'free give away',
  'give away',
  'giveaway',
  'free robux',
  'free gems',
  'click here',
  'limited time',
  'act now',
  'discord.gg',
  'discord.com',
  'join discord',
  'add me on discord',



  'friend me',
  'exploit',
  'mod menu',
  'free account',
  'selling account',
  'buy account',
  'trade account',
  'account for sale',
  'guaranteed',
  '100% free',

  'real deal',
  'best price',
  'promo code',
  'use code',
  'referral code',
  'invite code',
];

// ✅ Inappropriate content patterns (beyond profanity)
const INAPPROPRIATE_PATTERNS = [
  // Core porn/NSFW signals (incl. light obfuscation)
  /p\W*o\W*r\W*n/i,
  /p\*rn/i,
  /\bxxx\b/i,
  /\bnsfw\b/i,
  /\badult\s*content\b/i,
  /\bexplicit\b/i,
  /\bsex(?:ual|y|ually)?\b/i,
  /\berotic(?:a)?\b/i,
  /\bhard\s*core\b/i,
  /\bsoft\s*core\b/i,

  // Nudity
  /\bnude(?:s)?\b/i,
  /\bnaked\b/i,
  /\bnudity\b/i,

  // Breasts / chest
  /\bboob(?:s|ies)?\b/i,
  /\bbreast(?:s)?\b/i,
  /\btit(?:s|ties|ty)?\b/i,
  /\bcleavage\b/i,
  /\bnipple(?:s)?\b/i,
  /\bareolae?\b/i,

  // Penis terms
  /\bpenis\b/i,
  /\bdick\b/i,
  /\bcock\b/i,
  /\bschlong\b/i,
  /\bwang\b/i,

  // Vulva/vagina terms (note: some are strong slurs; include only if you truly want them blocked)
  /\bvagina\b/i,
  /\bclit\b/i,
  /\blabia\b/i,
  /\bpuss(?:y|ies)\b/i,
  /\bcunt\b/i,

  // Butt / anus
  /\bbutt\b/i,
  /\bbooty\b/i,
  /\bass(?:hole)?\b/i,
  /\banus\b/i,

  // Sex acts
  /\banal\b/i,
  /\boral\b/i,
  /\bblow\s*job\b/i,
  /\bhand\s*job\b/i,
  /\brim\s*job\b/i,
  /\bfellatio\b/i,
  /\bcunnilingus\b/i,

  // Masturbation / fluids
  /\bmasturbat(?:e|es|ed|ing|ion)\b/i,
  /\bjerk\s*off\b/i,
  /\borgasm(?:s|ic)?\b/i,
  /\bcum(?:shot|ming)?\b/i,
  /\bejaculat(?:e|es|ed|ing|ion)\b/i,

  // Kink / fetish
  /\bbdsm\b/i,
  /\bkink(?:y)?\b/i,
  /\bfetish(?:es)?\b/i,
];


// ✅ Allowlisted link domains — these are permitted even when general links
// are blocked (e.g. sharing a YouTube clip or TikTok in chat).
const ALLOWED_LINK_PATTERNS = [
  /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com|youtu\.be)\//i,
  /(?:https?:\/\/)?(?:www\.)?tiktok\.com\//i,
  /(?:https?:\/\/)?vm\.tiktok\.com\//i,
];

// ✅ URL patterns (already covered, but included for completeness)
const URL_PATTERNS = [
  /https?:\/\//i,
  /www\./i,
  /\.(com|net|org|io|co|me|xyz|dev|app|tech|tv|gg|link|click|online|site|website|web|blog|shop|store|buy|sale|deal)/i,
];

// ── Word filter matcher ──
// Rebuilt only when the remote list version changes. Terms a moderator
// turned off (`off`) are dropped from the bundled lists too.
let matcher = null;
let matcherVersion;
let spamKeywords = SPAM_KEYWORDS;

const getMatcher = () => {
  refreshWordList(); // rate-limited, fire and forget
  const remote = getRemoteWordList();
  const version = remote ? remote.v : null;
  if (matcher && matcherVersion === version) return matcher;
  const off = new Set((remote?.off || []).map(termKey));
  const entries = [];
  const keep = (e) => { if (!off.has(termKey(e.term))) entries.push(e); };
  BUNDLED.forEach(keep);
  Filter.list().forEach((w) => { if (!LEO_SKIP.has(w)) keep({ term: w, kind: 'offensive', mode: 'word' }); });
  for (const [term, kind, mode] of remote?.terms || []) entries.push({ term, kind, mode });
  matcher = buildMatcher(entries);
  matcherVersion = version;
  spamKeywords = off.size ? SPAM_KEYWORDS.filter((k) => !off.has(termKey(k))) : SPAM_KEYWORDS;
  return matcher;
};

// For the staff Word filter tab: fetch the list now (after an edit).
export const refreshWordFilter = () => refreshWordList({ force: true });

/**
 * Check if text contains a slur (word filter, kind 'slur')
 * @param {string} text - Text to check
 * @returns {boolean} - True if a slur is detected
 */
export const containsSlur = (text) => {
  if (!text || typeof text !== 'string') return false;
  return firstHitKind(text, getMatcher(), ['slur']) !== null;
};

/**
 * Check if text contains profanity (slurs or offensive words)
 * @param {string} text - Text to check
 * @returns {boolean} - True if profanity detected
 */
export const containsProfanity = (text) => {
  if (!text || typeof text !== 'string') return false;
  return firstHitKind(text, getMatcher(), ['slur', 'offensive']) !== null;
};

const hasSpamKeyword = (text) => {
  const lowerText = text.toLowerCase();
  return spamKeywords.some(keyword => lowerText.includes(keyword.toLowerCase()));
};

/**
 * Check if text contains spam keywords
 * @param {string} text - Text to check
 * @returns {boolean} - True if spam detected
 */
export const containsSpam = (text) => {
  if (!text || typeof text !== 'string') return false;
  const m = getMatcher();
  return hasSpamKeyword(text) || firstHitKind(text, m, ['spam']) !== null;
};

/**
 * Which list terms the text hits, per kind (staff tester / debugging).
 * @param {string} text - Text to check
 * @returns {{slur: string[], offensive: string[], spam: string[]}}
 */
export const findBlockedTerms = (text) => {
  const m = getMatcher();
  const out = { slur: [], offensive: [], spam: [] };
  if (!text || typeof text !== 'string') return out;
  for (const k of Object.keys(out)) out[k] = matchedTerms(text, m, k);
  return out;
};

/**
 * Check if text contains inappropriate patterns
 * @param {string} text - Text to check
 * @returns {boolean} - True if inappropriate content detected
 */
export const containsInappropriateContent = (text) => {
  if (!text || typeof text !== 'string') return false;
  return INAPPROPRIATE_PATTERNS.some(pattern => pattern.test(text));
};

/**
 * Check if text contains URLs/links
 * @param {string} text - Text to check
 * @returns {boolean} - True if URL detected
 */
export const containsLink = (text) => {
  if (!text || typeof text !== 'string') return false;
  return URL_PATTERNS.some(pattern => pattern.test(text));
};

/**
 * Check if text contains ONLY allowlisted links (YouTube / TikTok).
 * @param {string} text - Text to check
 * @returns {boolean} - True if an allowlisted link is present
 */
export const isAllowedLink = (text) => {
  if (!text || typeof text !== 'string') return false;
  return ALLOWED_LINK_PATTERNS.some(pattern => pattern.test(text));
};

/**
 * Comprehensive content moderation check
 * Checks for: slurs, profanity, spam, inappropriate content, links
 * @param {string} text - Text to check
 * @param {{skipLinkCheck?: boolean, skipAll?: boolean}} [options] - Options
 *   - skipLinkCheck: bypass only the link check (e.g. an allowlisted link)
 *   - skipAll: bypass every check (used for admins / full moderators)
 * @returns {{isValid: boolean, reason?: string}} - Validation result
 */
export const validateContent = (text, options = {}) => {
  if (!text || typeof text !== 'string') {
    return { isValid: true }; // Empty text is valid
  }

  // Full bypass — admins / full moderators can post anything.
  if (options.skipAll) {
    return { isValid: true };
  }

  // Word filter: slurs, then profanity, then remote spam terms (one pass)
  const hit = firstHitKind(text, getMatcher(), ['slur', 'offensive', 'spam']);
  if (hit === 'slur') {
    return {
      isValid: false,
      reason: i18next.t('app.word_filter.slur'),
    };
  }
  if (hit === 'offensive') {
    return {
      isValid: false,
      reason: i18next.t('app.content_moderation.profanity'),
    };
  }

  // Check spam keywords
  if (hit === 'spam' || hasSpamKeyword(text)) {
    return {
      isValid: false,
      reason: i18next.t('app.content_moderation.spam'),
    };
  }

  // Check inappropriate patterns
  if (containsInappropriateContent(text)) {
    return {
      isValid: false,
      reason: i18next.t('app.content_moderation.inappropriate'),
    };
  }

  // Check links (skipped for admins/mods, or when only allowlisted links present)
  if (!options.skipLinkCheck && containsLink(text)) {
    return {
      isValid: false,
      reason: i18next.t('app.content_moderation.links'),
    };
  }

  return { isValid: true };
};

/**
 * Username check: slurs and offensive words only (no spam / link / NSFW
 * pattern checks, so names like "LinkMaster" or "GiveawayKing" stay fine).
 * The server refuses the same in claim_username (049, USERNAME_NOT_ALLOWED).
 * @param {string} name - Display name to check
 * @returns {{isValid: boolean, reason?: string}} - Validation result
 */
export const validateUsername = (name) => {
  if (!name || typeof name !== 'string') return { isValid: true };
  if (firstHitKind(name, getMatcher(), ['slur', 'offensive'])) {
    return { isValid: false, reason: i18next.t('app.word_filter.username_not_allowed') };
  }
  return { isValid: true };
};

/**
 * Get detailed violation information (for admin/debugging)
 * @param {string} text - Text to check
 * @returns {object} - Detailed violation info
 */
export const getContentViolations = (text) => {
  if (!text || typeof text !== 'string') {
    return {
      hasViolations: false,
      violations: [],
    };
  }

  const violations = [];

  if (containsSlur(text)) {
    violations.push('slur');
  }
  if (containsProfanity(text)) {
    violations.push('profanity');
  }
  if (containsSpam(text)) {
    violations.push('spam');
  }
  if (containsInappropriateContent(text)) {
    violations.push('inappropriate_content');
  }
  if (containsLink(text)) {
    violations.push('link');
  }

  return {
    hasViolations: violations.length > 0,
    violations,
  };
};

/**
 * Clean profanity from text (replace with asterisks)
 * @param {string} text - Text to clean
 * @returns {string} - Cleaned text
 */
export const cleanProfanity = (text) => {
  if (!text || typeof text !== 'string') return text;
  return Filter.clean(text);
};

