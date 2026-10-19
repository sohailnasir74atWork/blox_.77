// Word filter (Code/Helper/wordFilterCore.js + ContentModeration.js).
// The remote list is mocked; the SQL twin is tested by
// scripts/word-filter/test049.mjs on PGlite.
import fs from 'fs';
import path from 'path';

let mockRemote = null;
jest.mock('i18next', () => ({ t: (key) => key }));
jest.mock('../Code/Helper/wordBlocklistCache', () => ({
  getRemoteWordList: () => mockRemote,
  refreshWordList: () => Promise.resolve(mockRemote),
}));

const core = require('../Code/Helper/wordFilterCore');
const {
  validateContent,
  validateUsername,
  containsSlur,
  containsProfanity,
  findBlockedTerms,
} = require('../Code/Helper/ContentModeration');

const bundled = core.buildMatcher(core.BUNDLED);
const slur = (t) => core.firstHitKind(t, bundled, ['slur']) === 'slur';

describe('functions copy', () => {
  it('functions/wordFilterCore.js is byte-identical to the app copy', () => {
    const a = fs.readFileSync(path.join(__dirname, '../Code/Helper/wordFilterCore.js'), 'utf8');
    const b = fs.readFileSync(path.join(__dirname, '../functions/wordFilterCore.js'), 'utf8');
    expect(b).toBe(a);
  });
});

// normalize() without the run pieces it appends after the last '|'.
const words = (t) => {
  const n = core.normalize(t);
  return core.tokenize(t).s.length ? n.slice(0, n.lastIndexOf('|')) : n;
};

describe('normalize', () => {
  it.each([
    ['N1GG3R', ' nigger '],
    ['n.i.g.g.e.r', ' nigger '],
    ['n-i-g-g-e-r', ' nigger '],
    ['n i g g e r', ' nigger '],
    ['ｎｉｇｇｅｒ', ' nigger '],
    ['𝓷𝓲𝓰𝓰𝓮𝓻', ' nigger '],
    ['n​i‍g⁠g﻿e­r', ' nigger '],
    ['nіggеr', ' nigger '], // Cyrillic і, е
    ['ΝΙGGΕR', ' nigger '], // Greek Ν Ι Ε
    ['ɴɪɢɢᴇʀ', ' nigger '], // small capitals
    ['a$$', ' ass '],
    ['@ss', ' ass '],
    ['455 robux', ' 455 robux '], // numbers stay numbers
    ['Hello,   World!', ' hello world '],
    ['big_dick', ' bigdick | big dick '],
  ])('%j -> %j', (input, out) => {
    expect(words(input)).toBe(out);
  });

  it('adds the pieces of a spaced-letter run', () => {
    expect(core.normalize('u r a f a g')).toContain(' fag ');
  });
});

describe('blocks evasions', () => {
  it.each([
    'nigger', 'NIGGER', 'n1gg3r', 'nigger lol', 'niggggggger', 'nnniiigggeeerrr',
    'n i g g e r', 'n.i.g.g.e.r', 'n-i-g-g-e-r', 'n_i_g_g_e_r', 'n*i*g*g*e*r', 'ｎｉｇｇｅｒ', '𝓷𝓲𝓰𝓰𝓮𝓻',
    'n​igger', 'nіggеr', 'Ｎ 1 g g 3 r', 'you niggas', 'sandnigger',
    'fag', 'FAG!', 'f@g', 'fags', 'f a g', 'you are a f a g', 'u r a f a g', 'faggot', 'f4gg0t', 'faggots',
    'retard', 'ur a retard', 'r3t4rd', 'retarded', 'retards',
    'chink', 'ch1nk', 'chinks', 'spic', 'sp1c', 'kike', 'k1ke', 'coon', 'c00n', 'paki', 'tranny', 'tr4nny',
    'porch monkey', 'ching chong', 'ching-chong', 'heil hitler', 'sieg heil', 'dyke', 'homo',
    'maricón', 'MARICONES', 'viado', 'v1ad0', 'bougnoule', 'nègre', 'Neger', 'Kanake',
    'Schwuchtel', 'Kümmeltürke', 'пидор', 'ПИДОРАС', 'пидорасы', 'педик', 'хохол', 'жид', 'черножопый',
    'bencong', 'tàu khựa', 'TAU KHUA', 'زنجي', 'زِنْجِي', 'زنـــجي', 'khawal',
  ])('%j', (text) => {
    expect(slur(text)).toBe(true);
  });
});

describe('no false positives (Scunthorpe)', () => {
  it.each([
    'spicy food', 'Spice fruit for sale', 'homework', 'homie', 'Pakistan', 'raccoon', 'cocoon', 'Scunthorpe',
    'assassin', 'classic trade', 'grape', 'therapist', 'analyst', 'cumulus', 'document', 'Essex', 'titan',
    'shitake', 'Dickens', 'peacock', 'cocktail', 'Niger', 'Nigeria', 'snigger', 'sniggering', 'niggardly',
    'enviado', 'enviada agora', 'je suis en retard', 'il est en retard, désolé', 'pas de retard', 'retardant',
    'педикюр', 'жидкий', 'спидометр', 'gig', 'chinese', 'spaced out', 'a b c d e f g', 'i am a b c',
    'kkkkkk', 'cabello negro', 'trade 4 5 6 7', '1v1 me 50k', '455k leopard',
    'Dragon for Leopard + Dough?', 'w/l?', 'gg ez', 'fair trade', 'Mammoth', 'Buddha', 'Kitsune',
    'T-Rex', 'Portal', 'Rumble', 'Spike', 'Shadow', 'Venom', 'Control', 'Spirit', 'Gravity',
  ])('%j', (text) => {
    expect(slur(text)).toBe(false);
  });
});

describe('ContentModeration', () => {
  afterEach(() => { mockRemote = null; });

  it('reports slurs with the slur reason, profanity with the old one', () => {
    expect(validateContent('you n1gg3r')).toEqual({ isValid: false, reason: 'app.word_filter.slur' });
    expect(validateContent('fuck this')).toEqual({ isValid: false, reason: 'app.content_moderation.profanity' });
    expect(validateContent('fuck!')).toEqual({ isValid: false, reason: 'app.content_moderation.profanity' });
    expect(validateContent('trading leopard, any offers?')).toEqual({ isValid: true });
    expect(validateContent('you n1gg3r', { skipAll: true })).toEqual({ isValid: true });
  });

  it('keeps the old checks (spam, NSFW, links)', () => {
    expect(validateContent('free robux here').reason).toBe('app.content_moderation.spam');
    expect(validateContent('explicit pics').reason).toBe('app.content_moderation.inappropriate');
    expect(validateContent('visit example.com').reason).toBe('app.content_moderation.links');
    expect(validateContent('visit example.com', { skipLinkCheck: true }).isValid).toBe(true);
  });

  it('still blocks everything leo-profanity blocked', () => {
    for (const w of ['boobs', 'bitch', 'cunt', 'twat', 'wank', 'xxx', 'sucks']) {
      expect(containsProfanity(w)).toBe(true);
    }
  });

  it('merges the remote list and drops terms a moderator turned off', () => {
    expect(containsSlur('you xyzzy')).toBe(false);
    expect(containsSlur('retard')).toBe(true);
    expect(containsProfanity('negro')).toBe(true); // leo-profanity word
    mockRemote = {
      v: 7,
      terms: [['xyzzy', 'slur', 'word'], ['plugh', 'spam', 'auto'], ['spicy', 'allow', 'word']],
      off: ['retard', 'negro', 'exploit'],
    };
    expect(containsSlur('you xyzzy')).toBe(true);
    expect(containsSlur('retard')).toBe(false);
    expect(containsSlur('retarded')).toBe(true);
    expect(containsProfanity('negro')).toBe(false);
    expect(validateContent('plugh').reason).toBe('app.content_moderation.spam');
    expect(validateContent('new exploit found').isValid).toBe(true); // spam keyword turned off
    expect(findBlockedTerms('you xyzzy and n1gga').slur.sort()).toEqual(['nigga', 'xyzzy']);
  });

  it('usernames: slurs and offensive words only', () => {
    expect(validateUsername('xXn1gg3rXx')).toEqual({ isValid: false, reason: 'app.word_filter.username_not_allowed' });
    expect(validateUsername('Fuck_You').isValid).toBe(false);
    expect(validateUsername('kys').isValid).toBe(false);
    for (const ok of ['SpicyTrader', 'LinkMaster', 'GiveawayKing', 'BloxGod99', 'xXSlayerXx', 'Assassin', 'Mr. Peacock']) {
      expect(validateUsername(ok)).toEqual({ isValid: true });
    }
  });
});

describe('maskText', () => {
  it('masks only the words that make the hit', () => {
    expect(core.maskText('you are a n1gg3r lol', bundled).masked).toBe('you are a ****** lol');
    expect(core.maskText('u r a f a g', bundled).masked).toBe('u r a *** *** ***');
    expect(core.maskText('look: n.i.g.g.e.r!', bundled).masked).toBe('look: ************');
    expect(core.maskText('je suis en retard', bundled)).toBeNull();
    expect(core.maskText('clean text', bundled)).toBeNull();
    const r = core.maskText('Spic\nand  coon', bundled);
    expect(r.masked).toBe('****\nand  ****');
    expect(r.terms.sort()).toEqual(['coon', 'spic']);
  });
});

describe('patterns', () => {
  it('short terms are whole-word, long ones match inside words', () => {
    expect(core.termPattern('spic', 'auto', 'slur')).toBe(' s+p+i+c+(?:e?s)?(?= )');
    expect(core.termPattern('nigger', 'auto', 'slur')).toBe('n+i+g{2,}e+r+');
    expect(core.termPattern('kill yourself', 'auto', 'offensive')).toBe(' k+i+[li]{2,} y+o+u+r+s+e+[li]+f+(?:e?s)?(?= )');
    expect(core.termPattern('88', 'auto', 'slur')).toBe(' 8{2}(?= )');
    expect(core.termPattern('!!!', 'auto', 'slur')).toBeNull();
  });

  it('a long message is still fast', () => {
    const text = 'trading my leopard and dough for kitsune, any offers? '.repeat(10);
    const t0 = Date.now();
    for (let i = 0; i < 50; i++) validateContent(text + i);
    expect((Date.now() - t0) / 50).toBeLessThan(25);
  });
});
