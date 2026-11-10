// Counter offer + trade status (2026-11-05, features LOG "Counter offer").
//
// A viewer taps "Counter" on someone's feed trade, the calculator opens with
// that trade mirrored (Me gives = what the poster wants, You give = what the
// poster offers), they edit it and "Send counter offer" posts ONE DM message
// carrying both sides. The two people then move it through
//   pending → accepted ("Trading") → completed | failed
//   pending → declined (receiver) | cancelled (sender)
// by updating that same message. No new tables, no functions, no extra reads.
//
// SHARED FILE: identical in Adopt Me, Blox and MM2. Nothing here imports app
// code; game specifics (variant flags, how a variant reads in text) come in as
// parameters (variantOf / variantText; defaults are Adopt Me's).
//
// Port (Blox / MM2): copy Code/CounterOffer/ as is, then wire five places the
// way Adopt Me does — feed card (requestCounterOffer + navigate to the
// calculator tab), the tab host (subscribeCounterRequest → calculator view),
// the calculator (take request, mirror, re-price, banner, buildTradeOffer →
// navigate to the trade DM with params.pendingOffer), the private-message
// backend (tradeOffer in the row mapper + updatePrivateMessageOffer) and the
// chat screen / message list (send pendingOffer once, render TradeOfferCard,
// status via compare-and-set). Strings live under `counter_offer.*`.
//
// ── Where the offer lives ──────────────────────────────────────────────────
// private_messages.fruits (jsonb). A normal message stores an ARRAY of pets
// there; a trade offer stores an OBJECT { kind: 'trade_offer', ... }. Every
// app version maps a non-array `fruits` to [] (fromPrivateMessageRow), so an
// old build renders only the message `text`, which carries a readable fallback
// built by offerFallbackText. The push preview reads `text` too.

export const TRADE_OFFER_KIND = 'trade_offer';
export const TRADE_OFFER_VERSION = 1;
export const MAX_OFFER_ITEMS_PER_SIDE = 18;

export const OFFER_STATUS = {
  PENDING: 'pending',
  ACCEPTED: 'accepted', // shown as "Trading"
  DECLINED: 'declined',
  CANCELLED: 'cancelled',
  COMPLETED: 'completed',
  FAILED: 'failed',
};

// Viewer actions → the status they set.
export const OFFER_ACTION = {
  ACCEPT: 'accept',
  DECLINE: 'decline',
  CANCEL: 'cancel',
  COMPLETE: 'complete',
  FAIL: 'fail',
};

const ACTION_STATUS = {
  [OFFER_ACTION.ACCEPT]: OFFER_STATUS.ACCEPTED,
  [OFFER_ACTION.DECLINE]: OFFER_STATUS.DECLINED,
  [OFFER_ACTION.CANCEL]: OFFER_STATUS.CANCELLED,
  [OFFER_ACTION.COMPLETE]: OFFER_STATUS.COMPLETED,
  [OFFER_ACTION.FAIL]: OFFER_STATUS.FAILED,
};

// ── Feed → calculator hand-off ─────────────────────────────────────────────
// The feed and the calculator live in different tabs, and the calculator tab
// mounts lazily, so the request waits here until the calculator takes it.
let pendingRequest = null;
const requestListeners = new Set();
const sentListeners = new Set();

/** Feed: "Counter" pressed. `poster` is the chat's selectedUser shape. */
export const requestCounterOffer = ({ trade, poster }) => {
  pendingRequest = { trade, poster, at: Date.now() };
  requestListeners.forEach((fn) => { try { fn(pendingRequest); } catch (e) { /* listener bug must not block others */ } });
};

/** Calculator: take (and clear) the waiting request, or null. */
export const takeCounterRequest = () => {
  const req = pendingRequest;
  pendingRequest = null;
  return req;
};

export const subscribeCounterRequest = (fn) => {
  requestListeners.add(fn);
  return () => { requestListeners.delete(fn); };
};

/** Chat: the offer message landed, so the calculator can leave counter mode. */
export const notifyCounterSent = (offerId) => {
  sentListeners.forEach((fn) => { try { fn(offerId); } catch (e) { /* see above */ } });
};

export const subscribeCounterSent = (fn) => {
  sentListeners.add(fn);
  return () => { sentListeners.delete(fn); };
};

/**
 * The poster's trade seen from the viewer's chair: the viewer gives what the
 * poster wants and gets what the poster has.
 */
export const mirrorTradeForCounter = (trade) => ({
  give: Array.isArray(trade?.wantsItems) ? trade.wantsItems.filter(Boolean) : [],
  get: Array.isArray(trade?.hasItems) ? trade.hasItems.filter(Boolean) : [],
});

// ── Payload ────────────────────────────────────────────────────────────────

/** Adopt Me variants. Blox / MM2 pass their own. */
export const adoptMeVariantOf = (item) => ({
  valueType: item?.valueType || 'd',
  isFly: !!item?.isFly,
  isRide: !!item?.isRide,
});

/** "NFR" / "M" / "" — how an Adopt Me variant prefixes a name in text. */
export const adoptMeVariantText = (item) => {
  const vt = String(item?.valueType || 'd').toLowerCase();
  return `${vt === 'n' ? 'N' : vt === 'm' ? 'M' : ''}${item?.isFly ? 'F' : ''}${item?.isRide ? 'R' : ''}`;
};

const toOfferItem = (item, variantOf) => ({
  id: item?.id ?? null,
  name: String(item?.name || item?.Name || ''),
  type: item?.type || item?.Type || null,
  ...variantOf(item),
  value: Number(item?.selectedValue ?? item?.value) || 0,
  // ggImage: Adopt Me GG-only rows carry absolute art there (valueSources).
  image: item?.image || item?.ggImage || '',
});

const sumValues = (items) => items.reduce((acc, it) => acc + (Number(it.value) || 0), 0);

/**
 * Build the message payload. `give` / `get` are from the SENDER's side:
 * give = what the sender hands over, get = what the sender asks for.
 */
// `get` is read off the args object, not destructured with a default:
// Hermes (hermesc in the release build) rejects `{ get = [] }` as a pattern.
export const buildTradeOffer = (args) => {
  const get = args.get || [];
  return buildTradeOfferFrom({ ...args, wants: get });
};

const buildTradeOfferFrom = ({
  id,
  tradeId = null,
  give = [],
  wants = [],
  valueSource = null,
  valueUnit = null,
  variantOf = adoptMeVariantOf,
  now = Date.now(),
}) => {
  const g = give.filter(Boolean).slice(0, MAX_OFFER_ITEMS_PER_SIDE).map((i) => toOfferItem(i, variantOf));
  const w = wants.filter(Boolean).slice(0, MAX_OFFER_ITEMS_PER_SIDE).map((i) => toOfferItem(i, variantOf));
  return {
    kind: TRADE_OFFER_KIND,
    v: TRADE_OFFER_VERSION,
    id,
    tradeId,
    status: OFFER_STATUS.PENDING,
    statusBy: null,
    statusAt: null,
    give: g,
    get: w,
    giveTotal: sumValues(g),
    getTotal: sumValues(w),
    valueSource,
    valueUnit,
    createdAt: now,
  };
};

export const isTradeOffer = (x) =>
  !!x && typeof x === 'object' && !Array.isArray(x)
  && x.kind === TRADE_OFFER_KIND
  && Array.isArray(x.give) && Array.isArray(x.get);

// ── Status ─────────────────────────────────────────────────────────────────

/** Which buttons the viewer gets, in display order (primary last). */
export const offerActionsFor = (offer, viewerIsSender) => {
  switch (offer?.status) {
    case OFFER_STATUS.PENDING:
      return viewerIsSender ? [OFFER_ACTION.CANCEL] : [OFFER_ACTION.DECLINE, OFFER_ACTION.ACCEPT];
    case OFFER_STATUS.ACCEPTED:
      return [OFFER_ACTION.FAIL, OFFER_ACTION.COMPLETE];
    default:
      return [];
  }
};

export const canApplyOfferAction = (offer, action, viewerIsSender) =>
  isTradeOffer(offer) && offerActionsFor(offer, viewerIsSender).includes(action);

export const applyOfferAction = (offer, action, uid, now = Date.now()) => ({
  ...offer,
  status: ACTION_STATUS[action] || offer.status,
  statusBy: uid || null,
  statusAt: now,
});

export const isFinalStatus = (status) =>
  status === OFFER_STATUS.DECLINED || status === OFFER_STATUS.CANCELLED
  || status === OFFER_STATUS.COMPLETED || status === OFFER_STATUS.FAILED;

/**
 * Win / fair / lose for the RECEIVER, who gives `get` and receives `give`.
 * `statusFn(give, get)` is the app's own tradeStatus helper.
 */
export const receiverVerdict = (offer, statusFn) => {
  const give = Number(offer?.getTotal) || 0;
  const get = Number(offer?.giveTotal) || 0;
  return { status: statusFn(give, get), diff: get - give };
};

// ── Text fallback (old app versions, push preview, copy) ───────────────────

// The server's link filter treats a dot followed by letters (".co", ".me") as
// a link, so names lose their dots here. Only the fallback text is affected.
const safeName = (name) => String(name || '').replace(/\./g, '').trim();

const listForText = (items, variantText, maxNames = 6) => {
  const counts = new Map();
  items.forEach((it) => {
    const v = variantText(it);
    const label = `${v ? `${v} ` : ''}${safeName(it.name)}`;
    counts.set(label, (counts.get(label) || 0) + 1);
  });
  const labels = [...counts.entries()].map(([label, n]) => (n > 1 ? `${label} x${n}` : label));
  const shown = labels.slice(0, maxNames).join(', ');
  return labels.length > maxNames ? `${shown} +${labels.length - maxNames}` : shown;
};

/** One line every app version can show, written from the sender's side. */
export const offerFallbackText = (offer, t, variantText = adoptMeVariantText) => {
  const nothing = t('counter_offer.nothing', { defaultValue: 'nothing' });
  const give = offer.give.length ? listForText(offer.give, variantText) : nothing;
  const get = offer.get.length ? listForText(offer.get, variantText) : nothing;
  return t('counter_offer.fallback_text', {
    give,
    get,
    defaultValue: '🔁 Counter offer · I give: {{give}} · I want: {{get}} · Update the app to answer',
  });
};

/** Groups identical items (same name + variant) for compact display. */
export const groupOfferItems = (items, variantText = adoptMeVariantText) => {
  const out = [];
  const byKey = new Map();
  (items || []).forEach((it) => {
    const key = `${String(it?.name || '').toLowerCase()}|${it?.type || ''}|${variantText(it)}`;
    const hit = byKey.get(key);
    if (hit) hit.count += 1;
    else {
      const row = { item: it, count: 1, key };
      byKey.set(key, row);
      out.push(row);
    }
  });
  return out;
};
