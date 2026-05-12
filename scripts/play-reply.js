#!/usr/bin/env node
// Fetch all Play Store reviews live, generate smart replies based on content,
// skip already-replied reviews, and optionally post them.
//
// Usage:
//   node scripts/play-reply.js          # dry-run: fetch + print replies
//   node scripts/play-reply.js --post   # fetch + post all unanswered reviews
//
// Requires: .secrets/play-sa-key.json

const fs = require('fs');
const path = require('path');
const { GoogleAuth } = require('google-auth-library');

const PACKAGE = process.env.PLAY_PACKAGE || 'com.bloxfruitevalues';
const KEY_FILE = path.join(__dirname, '..', '.secrets', 'play-sa-key.json');
const PUBLISHER = 'https://androidpublisher.googleapis.com/androidpublisher/v3';
const DRY_RUN = !process.argv.includes('--post');
const APP_NAME = 'Blox Fruit Values Calculator';
const SUPPORT_EMAIL = 'thesolanalabs@gmail.com';

const auth = new GoogleAuth({
  keyFile: KEY_FILE,
  scopes: ['https://www.googleapis.com/auth/androidpublisher'],
});

async function getToken() {
  const client = await auth.getClient();
  const t = await client.getAccessToken();
  return t.token;
}

async function apiCall(url, method = 'GET', body) {
  const t = await getToken();
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}\n${text.slice(0, 600)}`);
  return text ? JSON.parse(text) : null;
}

// Fetch all reviews from Play Store (paginated, max ~7 days history)
async function fetchAllReviews() {
  const all = [];
  let nextToken;
  for (let page = 0; page < 20; page++) {
    const url = `${PUBLISHER}/applications/${PACKAGE}/reviews?maxResults=100${nextToken ? `&token=${nextToken}` : ''}`;
    const resp = await apiCall(url);
    all.push(...(resp.reviews || []));
    nextToken = resp.tokenPagination?.nextPageToken;
    if (!nextToken || (resp.reviews || []).length === 0) break;
  }
  return all;
}

async function postReply(reviewId, replyText) {
  return apiCall(`${PUBLISHER}/applications/${PACKAGE}/reviews/${reviewId}:reply`, 'POST', { replyText });
}

// Detect language from text (simple heuristic — requires 2+ strong signals)
function detectLang(text) {
  if (!text) return 'en';
  const t = text.toLowerCase();

  const esMatches = (t.match(/\b(que|no|para|muy|pero|más|gracias|encanta|aplicación|también|porfavor|hispanohablante|traducciones|buscar|funciona|genial)\b/g) || []).length;
  const ptMatches = (t.match(/\b(não|muito|mas|versão|português|obrigado|aplicativo|problema|também|está|isso|para)\b/g) || []).length;
  const nlMatches = (t.match(/\b(ik|het|een|van|goed|leuk|weer|alles|voor|naar|maar|geweldig|bedankt)\b/g) || []).length;

  const max = Math.max(esMatches, ptMatches, nlMatches);
  if (max < 2) return 'en';
  if (max === esMatches) return 'es';
  if (max === ptMatches) return 'pt';
  if (max === nlMatches) return 'nl';
  return 'en';
}

// Generate a contextual reply that references what the user actually said
function generateReply(review) {
  const userComment = review.comments?.find((c) => c.userComment)?.userComment;
  const stars = userComment?.starRating || 0;
  const text = (userComment?.text || '').trim();
  const lang = detectLang(text);
  const t = text.toLowerCase();

  // --- Spanish ---
  if (lang === 'es') {
    if (stars <= 2) {
      return `Lo sentimos mucho. Por favor escríbenos a ${SUPPORT_EMAIL} con los detalles y lo revisamos de inmediato.`;
    }
    if (stars === 3) {
      if (t.includes('traduccion') || t.includes('traducción') || t.includes('lag') || t.includes('buscar')) {
        return `¡Gracias por el detalle! Las traducciones y el rendimiento en la búsqueda están en nuestra hoja de ruta. Escríbenos a ${SUPPORT_EMAIL} si quieres aportar más ideas.`;
      }
      return `Gracias por la opinión honesta. Cuéntanos qué podemos mejorar — ${SUPPORT_EMAIL}`;
    }
    // 4-5 stars
    if (t.includes('trade') || t.includes('intercambio')) {
      return `¡Qué bueno que te ayuda con tus trades! Eso es exactamente para lo que la hicimos. Gracias por el apoyo.`;
    }
    if (t.includes('traduccion') || t.includes('traducción') || t.includes('hispanohablante')) {
      return `¡Gracias! Tienes razón sobre las traducciones — es algo que tenemos en el radar. ¡Pronto novedades!`;
    }
    return `¡Muchas gracias! Tu apoyo nos motiva a seguir mejorando cada día.`;
  }

  // --- Portuguese ---
  if (lang === 'pt') {
    if (stars <= 2) {
      return `Lamentamos pela experiência. Entre em contato com ${SUPPORT_EMAIL} para que possamos ajudar.`;
    }
    if (t.includes('português') || t.includes('tradução') || t.includes('versão')) {
      return `Obrigado pelo feedback! A tradução completa para português está nos nossos planos. Fique de olho nas próximas atualizações!`;
    }
    return `Obrigado pela avaliação! Continuaremos trabalhando para melhorar cada vez mais.`;
  }

  // --- Dutch ---
  if (lang === 'nl') {
    if (stars <= 2) {
      return `Sorry voor de slechte ervaring. Neem contact op via ${SUPPORT_EMAIL} zodat we kunnen helpen.`;
    }
    return `Bedankt voor je review! Fijn dat je de app leuk vindt — we blijven werken aan verbeteringen.`;
  }

  // --- English ---

  if (stars === 5) {
    // Short/simple reviews
    if (t.length < 15) {
      return `That means a lot — thank you! We're glad you're enjoying the app.`;
    }
    // Mentions chat being active
    if (t.includes('chat')) {
      return `Glad the chat is keeping things lively! That's one of our favourite parts too. Thanks for the kind review!`;
    }
    // Mentions trading / getting a pet
    if (t.includes('dream pet') || t.includes('got my') || t.includes('trade')) {
      return `Love hearing that you found your dream pet through the app — that's exactly what we built it for! Thanks for sharing.`;
    }
    // Mentions the app being useful / value calculator
    if (t.includes('calculat') || t.includes('value') || t.includes('useful')) {
      return `So glad the value calculator is helping! That's the heart of the app. Thanks for using it and for the great review.`;
    }
    // Mentions using it daily / for a long time
    if (t.includes('everyday') || t.includes('every day') || t.includes('last year') || t.includes('been using')) {
      return `Loyal users like you are what keep us going — thank you for sticking with us! We'll keep making it better.`;
    }
    // Mentions mods / community
    if (t.includes('mod') || t.includes('community') || t.includes('people on the app')) {
      return `The community really does make it special! Thanks so much for the kind words — we'll keep working to make it even better.`;
    }
    // Mentions posts / feed / trades page
    if (t.includes('post') || t.includes('feed') || t.includes('page')) {
      return `Really glad all the different sections are useful to you! There's more on the way. Thanks for the detailed review.`;
    }
    // Mentions slow responders
    if (t.includes('respond') || t.includes('never talk') || t.includes('conversation')) {
      return `So happy it's helping you find trades! Slow responders are frustrating — we're working on ways to make connections more reliable. Thanks for the feedback!`;
    }
    // Mentions ratings / rude reviews
    if (t.includes('rating') || t.includes('rude') || t.includes('review')) {
      return `Thank you! We're sorry about unfair ratings on your profile — that's genuinely frustrating and we're looking at better ways to handle it.`;
    }
    // Addicted / free time
    if (t.includes('addict') || t.includes('free time')) {
      return `Ha, we love that it's become part of your free time! Thanks so much — more fun features are on the way.`;
    }
    return `Thank you so much! Reviews like yours mean everything to the team. We'll keep working hard on the app.`;
  }

  if (stars === 4) {
    if (t.includes('scam') || t.includes('fake link') || t.includes('steal')) {
      return `Thanks for flagging this — scam reports help keep the community safe. Please send those usernames to ${SUPPORT_EMAIL} so we can investigate and take action.`;
    }
    if (t.includes('rude') || t.includes('rude ppl') || t.includes('rude people')) {
      return `Thanks for the honest feedback. We're working on better moderation tools to deal with rude users — appreciate you flagging it.`;
    }
    if (t.includes('helpful') || t.includes('adopt me player')) {
      return `Really glad it's been helpful! We're always adding more to make it even more useful for Adopt Me players.`;
    }
    return `Thanks for the 4 stars! Tell us what would make it perfect for you — ${SUPPORT_EMAIL}`;
  }

  if (stars === 3) {
    return `Thanks for the honest review! We'd love to hear more about what we can improve — drop us a line at ${SUPPORT_EMAIL}`;
  }

  // 1-2 stars
  if (t.includes('ban') || t.includes('banned') || t.includes('mod')) {
    return `We're really sorry about that. Unexpected bans are something we take seriously — please email ${SUPPORT_EMAIL} with your username and we'll personally look into what happened.`;
  }
  if (t.includes('boring') || t.includes('bad') || t.includes('suck')) {
    return `Sorry to hear that. We'd genuinely like to understand what went wrong — reach out at ${SUPPORT_EMAIL} and we'll do our best to help.`;
  }
  return `We're sorry about your experience. Please contact us at ${SUPPORT_EMAIL} and we'll make it right.`;
}

async function main() {
  if (!fs.existsSync(KEY_FILE)) {
    console.error(`Service account key missing: ${KEY_FILE}`);
    process.exit(1);
  }

  console.log(`Fetching live reviews for ${PACKAGE}...`);
  let reviews;
  try {
    reviews = await fetchAllReviews();
  } catch (e) {
    console.error(`Failed to fetch reviews: ${e.message}`);
    process.exit(1);
  }
  console.log(`Fetched ${reviews.length} reviews\n`);

  if (DRY_RUN) console.log('DRY RUN — pass --post to submit replies\n');

  let replied = 0;
  let skipped = 0;
  let errors = 0;

  for (const review of reviews) {
    const reviewId = review.reviewId;
    const userComment = review.comments?.find((c) => c.userComment)?.userComment;
    const devComment = review.comments?.find((c) => c.developerComment);
    const stars = userComment?.starRating || 0;
    const text = (userComment?.text || '').trim();
    const author = review.authorName || 'User';

    // Skip if already replied
    if (devComment) {
      console.log(`[SKIP] ${author} (${stars}★) — already replied`);
      skipped++;
      continue;
    }

    // Skip if no review text
    if (!text) {
      console.log(`[SKIP] ${author} (${stars}★) — no text`);
      skipped++;
      continue;
    }

    const reply = generateReply(review);

    console.log(`\n[${stars}★] ${author}`);
    console.log(`  Review: ${text.slice(0, 120)}${text.length > 120 ? '...' : ''}`);
    console.log(`  Reply:  ${reply}`);

    if (!DRY_RUN) {
      try {
        await postReply(reviewId, reply);
        console.log('  => POSTED');
        replied++;
      } catch (e) {
        console.error(`  => ERROR: ${e.message.split('\n')[0]}`);
        errors++;
      }
      await new Promise((r) => setTimeout(r, 600));
    } else {
      replied++;
    }
  }

  console.log(`\n=== Done: ${replied} ${DRY_RUN ? 'ready to post' : 'posted'}, ${skipped} skipped, ${errors} errors ===`);
  if (DRY_RUN && replied > 0) console.log('Run with --post to submit.');
}

main().catch((e) => {
  console.error('FATAL:', e.message);
  process.exit(1);
});
