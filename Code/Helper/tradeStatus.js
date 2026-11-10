/**
 * tradeStatus.js — Blox Fruits' Win / Fair / Lose rule for the counter offer
 * card (CounterOffer/TradeOfferCard statusFn) and its shared test.
 *
 * Same rule the calculator stamps on posted trades (HomeScreen
 * handleCreateTrade getTradeStatus): fair only when both values are equal.
 *
 * give: value you hand over. get: value you receive.
 */
export const tradeStatus = (give, get) => {
  const g = Number(give) || 0;
  const r = Number(get) || 0;
  if (g <= 0 && r <= 0) return 'fair';
  if (g > r) return 'lose';
  if (g < r) return 'win';
  return 'fair';
};

// The single letter stored on posted trades.
export const STATUS_LETTER = { win: 'w', lose: 'l', fair: 'f' };
