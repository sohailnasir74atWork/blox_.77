// Blox Fruits glue for the shared counter offer code (Code/CounterOffer/,
// identical across Adopt Me / Blox / MM2). Blox has no variant flags: a
// Permanent fruit is its own catalogue row, Type 'p' (offer items keep it in
// `type`). These are the game specifics the shared files take as parameters.
//
// ── Why status changes are reply messages (same model as MM2) ─────────────
// Blox's live guards (supabase 034 guard_chat_message_update + 055
// guard_private_message_edit) let only a message's SENDER change it, so the
// receiver cannot update the offer row. Instead every status change, by
// either side, is a small new message whose `fruits` jsonb holds an OBJECT
//   { kind: 'trade_offer_status', offerStatus: { offerId, msgId, action } }
// plus a readable `text` ("✅ Accepted the counter offer"). The card's status
// is the fold of those replies over the offer (foldOfferStatuses): one event
// log, both phones reach the same answer (earliest valid action wins a race),
// no database change. Older builds map a non-array `fruits` to [] and read
// only the text.
import {
  isTradeOffer,
  canApplyOfferAction,
  applyOfferAction,
  OFFER_ACTION,
} from '../CounterOffer/counterOffer';

export const OFFER_STATUS_KIND = 'trade_offer_status';

const formatFruitName = (name) => String(name || '').replace(/^\+/, '').replace(/\s+/g, '-');

/** "Perm" in the text fallback / grouping key, nothing for a normal fruit. */
export const bloxVariantText = (item) => ((item?.type || item?.Type) === 'p' ? 'Perm' : '');

/** Gold "P" chip on a Permanent tile, the colour the calculator uses for it. */
export const bloxVariantBadge = (item) => ((item?.type || item?.Type) === 'p' ? { label: 'P', color: '#c48f00' } : null);

/** Same icon paths as the calculator and the feed. */
export const bloxOfferImageUrl = (item) => {
  const name = item?.name || item?.Name;
  if (!name) return '';
  const folder = (item?.type || item?.Type) === 'p' ? '2024/08' : '2024/09';
  return `https://bloxfruitscalc.com/wp-content/uploads/${folder}/${formatFruitName(name)}_Icon.webp`;
};

/** Calculator's compact value format (1.2K / 3.4M / 5.6B). */
export const bloxFormatValue = (value) => {
  const v = Number(value) || 0;
  if (v >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(1)}B`;
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  return v.toLocaleString();
};

// ── Status replies ─────────────────────────────────────────────────────────
const ACTIONS = new Set(Object.values(OFFER_ACTION));

export const isOfferStatusReply = (x) =>
  !!x && typeof x === 'object' && !Array.isArray(x)
  && typeof x.offerId === 'string' && ACTIONS.has(x.action);

export const buildOfferStatusReply = ({ offerId, msgId, action }) => ({
  offerId: String(offerId),
  msgId: msgId != null ? String(msgId) : null,
  action,
});

/** What a status reply stores in private_messages.fruits. */
export const offerStatusRow = (offerStatus) => ({ kind: OFFER_STATUS_KIND, offerStatus });

/** The reply carried by a row's `fruits`, or null (row mapper). */
export const offerStatusFromRow = (fruits) => (
  !!fruits && typeof fruits === 'object' && !Array.isArray(fruits)
  && fruits.kind === OFFER_STATUS_KIND && isOfferStatusReply(fruits.offerStatus)
    ? fruits.offerStatus
    : null
);

const REPLY_TEXT = {
  [OFFER_ACTION.ACCEPT]: ['reply_accept', '✅ Accepted the counter offer'],
  [OFFER_ACTION.DECLINE]: ['reply_decline', '❌ Declined the counter offer'],
  [OFFER_ACTION.CANCEL]: ['reply_cancel', '↩️ Cancelled the counter offer'],
  [OFFER_ACTION.COMPLETE]: ['reply_complete', '🤝 Marked the trade as completed'],
  [OFFER_ACTION.FAIL]: ['reply_fail', "⚠️ Marked the trade as didn't happen"],
};

/** The status reply's text, in the given t's language. */
export const offerStatusReplyText = (action, t) => {
  const [key, fallback] = REPLY_TEXT[action] || REPLY_TEXT[OFFER_ACTION.ACCEPT];
  return t(`counter_offer.${key}`, { defaultValue: fallback });
};

/**
 * Apply every status reply to its offer. `messages` is the screen's list in
 * any order; returns the same array when nothing changes, otherwise the same
 * row objects except offer rows whose status moved (new objects with the
 * folded `tradeOffer`). Replies are taken oldest first; one that is not valid
 * for the state at that moment (a race, a stale screen) is ignored.
 */
export const foldOfferStatuses = (messages) => {
  if (!Array.isArray(messages) || messages.length === 0) return messages;
  const offers = new Map(); // offerId -> { msg, state }
  messages.forEach((m) => {
    if (m && isTradeOffer(m.tradeOffer) && m.tradeOffer.id) {
      offers.set(String(m.tradeOffer.id), { msg: m, state: m.tradeOffer });
    }
  });
  if (offers.size === 0) return messages;

  const events = messages
    .filter((m) => m && isOfferStatusReply(m.offerStatus) && offers.has(m.offerStatus.offerId))
    .sort((a, b) => ((a.timestamp || 0) - (b.timestamp || 0)) || String(a.id).localeCompare(String(b.id)));
  if (events.length === 0) return messages;

  events.forEach((ev) => {
    const o = offers.get(ev.offerStatus.offerId);
    const viewerIsSender = ev.senderId === o.msg.senderId;
    if (canApplyOfferAction(o.state, ev.offerStatus.action, viewerIsSender)) {
      o.state = applyOfferAction(o.state, ev.offerStatus.action, ev.senderId || null, ev.timestamp || 0);
    }
  });

  let changed = false;
  const out = messages.map((m) => {
    if (!m || !isTradeOffer(m.tradeOffer)) return m;
    const o = offers.get(String(m.tradeOffer.id));
    if (!o || o.msg !== m || o.state === m.tradeOffer) return m;
    changed = true;
    return { ...m, tradeOffer: o.state };
  });
  return changed ? out : messages;
};
