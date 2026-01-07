import Filter from 'leo-profanity';

/**
 * Comprehensive Content Moderation Utility
 * Detects: profanity, spam, inappropriate content, links, scams
 */

// ✅ Initialize leo-profanity filter
Filter.loadDictionary('en');

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
  'free fruits',
  'click here',
  'limited time',
  'act now',
  'buy now',
  'discord.gg',
  'discord.com',
  'join discord',
  'add me on discord',
  'telegram',
  'whatsapp',
  'contact me on',
  'dm me',
  'private message me',
  'send me a message',
  'check my profile',
  'visit my profile',
  'follow me',
  'add me',
  'friend me',
  'scam',
  'hack',
  'cheat',
  'exploit',
  'mod menu',
  'free account',
  'selling account',
  'buy account',
  'trade account',
  'account for sale',
  'premium account',
  'unlimited',
  'guaranteed',
  '100% free',
  'no scam',
  'trust me',
  'legit',
  'real deal',
  'best price',
  'cheap',
  'discount',
  'promo code',
  'use code',
  'referral code',
  'invite code',
];

// ✅ Inappropriate content patterns (beyond profanity)
const INAPPROPRIATE_PATTERNS = [
  /p\*rn/i,
  /porn/i,
  /xxx/i,
  /nsfw/i,
  /adult content/i,
  /explicit/i,
  /sexual/i,
  /nude/i,
  /naked/i,
];

// ✅ URL patterns (already covered, but included for completeness)
const URL_PATTERNS = [
  /https?:\/\//i,
  /www\./i,
  /\.(com|net|org|io|co|me|xyz|dev|app|tech|tv|gg|link|click|online|site|website|web|blog|shop|store|buy|sale|deal)/i,
];

/**
 * Check if text contains profanity using leo-profanity
 * @param {string} text - Text to check
 * @returns {boolean} - True if profanity detected
 */
export const containsProfanity = (text) => {
  if (!text || typeof text !== 'string') return false;
  return Filter.check(text);
};

/**
 * Check if text contains spam keywords
 * @param {string} text - Text to check
 * @returns {boolean} - True if spam detected
 */
export const containsSpam = (text) => {
  if (!text || typeof text !== 'string') return false;
  const lowerText = text.toLowerCase();
  return SPAM_KEYWORDS.some(keyword => lowerText.includes(keyword.toLowerCase()));
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
 * Comprehensive content moderation check
 * Checks for: profanity, spam, inappropriate content, links
 * @param {string} text - Text to check
 * @returns {{isValid: boolean, reason?: string}} - Validation result
 */
export const validateContent = (text) => {
  if (!text || typeof text !== 'string') {
    return { isValid: true }; // Empty text is valid
  }

  // Check profanity
  if (containsProfanity(text)) {
    return {
      isValid: false,
      reason: 'Inappropriate language is not allowed.',
    };
  }

  // Check spam keywords
  if (containsSpam(text)) {
    return {
      isValid: false,
      reason: 'Spam content is not allowed.',
    };
  }

  // Check inappropriate patterns
  if (containsInappropriateContent(text)) {
    return {
      isValid: false,
      reason: 'Inappropriate content is not allowed.',
    };
  }

  // Check links
  if (containsLink(text)) {
    return {
      isValid: false,
      reason: 'Links are not allowed in messages.',
    };
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

