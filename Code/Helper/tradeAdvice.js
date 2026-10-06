/**
 * tradeAdvice.js — the guide line under a trade, written for the taker.
 * Ported from adoptme-jan7.
 *
 * The totals already show the value gap, so the guide never turns it into
 * "skip it" or "ask for more". It says what is good about what they'd get:
 * how often traders ask for it (last 24 h of trade posts) and whether its
 * value is climbing. Pure: no React, no storage.
 */

import { itemKey } from './analyticsDataHelper';

// Within 5% of the bigger side, either way, reads as an even trade.
const FAIR_BAND = 0.05;

// Signed gap as a fraction of the bigger side: + you get more, - you give more.
const valueGap = (give, get) => {
  const g = Number(give) || 0;
  const r = Number(get) || 0;
  const big = Math.max(g, r);
  return big > 0 ? (r - g) / big : 0;
};

const nameOf = (item) => String(item?.name || item?.Name || '').trim();
const typeOf = (item) => item?.type || item?.Type || 'n';
const labelOf = (item) => (typeOf(item) === 'p' ? `${nameOf(item)} (P)` : nameOf(item));

// The analytics file lists the top 20 wanted items of the last 24 h; the
// 20th usually has 30-60 asks, the top few 150-250.
const STRONG_DEMAND = 8;
const STEADY_DEMAND = 6;
const MANY_ASKS = 100;
const SOME_ASKS = 25;

// Best first. Within a tier, the item with the bigger number wins.
const highlightsFor = (item, maps) => {
  const key = itemKey(nameOf(item), typeOf(item));
  const name = labelOf(item);
  const demand = maps.demandMap?.[key];
  const asks = Number(maps.marketMap?.[key]?.wanted) || 0;
  const hot = maps.hotMap?.[key];
  const out = [];
  if (asks >= MANY_ASKS) out.push({ tier: 5, n: asks, key: 'asked_for', params: { name, count: asks } });
  if (hot?.pct > 0) out.push({ tier: 3, n: hot.pct, key: 'get_rising', params: { name, pct: hot.pct } });
  if (asks >= SOME_ASKS) out.push({ tier: 2, n: asks, key: 'asked_for', params: { name, count: asks } });
  if (demand?.score >= STEADY_DEMAND) out.push({ tier: 1, n: demand.score, key: 'steady_demand', params: { name, score: demand.score } });
  return out;
};

/**
 * Used by the trade feed (the viewer gives the poster's wants and gets the
 * poster's has) and the calculator (ME gives, YOU gets).
 *
 * give / receive: arrays of items ({ name, type } or { Name, Type }).
 * giveTotal / getTotal: the value totals shown for each side.
 * maps: { demandMap, marketMap, hotMap } from fetchAnalyticsData().
 * Returns { tone: 'good' | 'popular' | 'close', reason, extra, demand } or
 * null when there is nothing good to say about the taker's side.
 */
export const tradeHighlight = ({ give = [], receive = [], giveTotal = 0, getTotal = 0, maps = {} }) => {
  const getItems = receive.filter(Boolean);
  if (!give.filter(Boolean).length || !getItems.length) return null;
  const gv = Number(giveTotal) || 0;
  const tv = Number(getTotal) || 0;
  if (gv <= 0 && tv <= 0) return null;

  const ranked = getItems
    .flatMap((item) => highlightsFor(item, maps || {}))
    .sort((a, b) => b.tier - a.tier || b.n - a.n);
  const best = ranked[0];
  // asked_for and steady_demand both say "people ask for it": the second line
  // needs another item or another kind of fact (rising value).
  const family = (h) => (h.key === 'steady_demand' ? 'asked_for' : h.key);
  const next = best && ranked.find((h) => h.params.name !== best.params.name || family(h) !== family(best));
  const demand = getItems.reduce((top, item) => {
    const score = maps?.demandMap?.[itemKey(nameOf(item), typeOf(item))]?.score || 0;
    return Math.max(top, score);
  }, 0);
  const reason = best ? { key: best.key, params: best.params } : null;
  const extra = next ? { key: next.key, params: next.params } : null;
  const shownDemand = demand >= STEADY_DEMAND ? demand : null;
  const out = (tone, r) => ({ tone, reason: r, extra, demand: shownDemand });

  const gap = valueGap(gv, tv);
  if (gap > FAIR_BAND) return out('good', reason || { key: 'value_win', params: { pct: Math.round(gap * 100) } });
  const popular = best && (best.tier >= 2 || demand >= STRONG_DEMAND);
  if (popular) return out('popular', reason);
  if (gap >= -FAIR_BAND) return out('close', reason || { key: 'value_fair', params: {} });
  if (reason) return out('close', reason);
  return null;
};

export const TONE_STYLE = {
  good: { icon: 'thumbs-up-outline', color: '#10B981' },
  popular: { icon: 'flame-outline', color: '#8B5CF6' },
  close: { icon: 'swap-horizontal-outline', color: '#F59E0B' },
};
