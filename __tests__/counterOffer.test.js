import {
  OFFER_ACTION,
  OFFER_STATUS,
  applyOfferAction,
  buildTradeOffer,
  canApplyOfferAction,
  groupOfferItems,
  isTradeOffer,
  mirrorTradeForCounter,
  offerActionsFor,
  offerFallbackText,
  receiverVerdict,
  requestCounterOffer,
  subscribeCounterRequest,
  takeCounterRequest,
} from '../Code/CounterOffer/counterOffer';
import { tradeStatus } from '../Code/Helper/tradeStatus';

// t stand-in: fills {{vars}} into the defaultValue.
const t = (_key, opts = {}) =>
  String(opts.defaultValue || '').replace(/\{\{(\w+)\}\}/g, (_, k) => String(opts[k] ?? ''));

const pet = (name, extra = {}) => ({ name, type: 'pets', image: `/p/${name}.png`, selectedValue: 10, ...extra });

describe('counterOffer', () => {
  test('mirror swaps the poster sides for the viewer', () => {
    const trade = { hasItems: [pet('A')], wantsItems: [pet('B'), null] };
    const m = mirrorTradeForCounter(trade);
    expect(m.give.map((i) => i.name)).toEqual(['B']);
    expect(m.get.map((i) => i.name)).toEqual(['A']);
  });

  test('buildTradeOffer keeps variants, values and totals', () => {
    const offer = buildTradeOffer({
      id: 'x1', tradeId: 't1',
      give: [pet('Frost Dragon', { valueType: 'n', isFly: true, isRide: true, selectedValue: 5 }), null],
      get: [pet('Shadow Dragon', { selectedValue: 7 })],
      valueSource: 'elvebredd', valueUnit: 'shark', now: 1,
    });
    expect(isTradeOffer(offer)).toBe(true);
    expect(offer.status).toBe(OFFER_STATUS.PENDING);
    expect(offer.give[0]).toMatchObject({ name: 'Frost Dragon', valueType: 'n', isFly: true, isRide: true, value: 5 });
    expect(offer.giveTotal).toBe(5);
    expect(offer.getTotal).toBe(7);
    expect(isTradeOffer([offer])).toBe(false);
  });

  test('status machine', () => {
    const offer = buildTradeOffer({ id: 'x', give: [pet('A')], get: [pet('B')] });
    expect(offerActionsFor(offer, true)).toEqual([OFFER_ACTION.CANCEL]);
    expect(offerActionsFor(offer, false)).toEqual([OFFER_ACTION.DECLINE, OFFER_ACTION.ACCEPT]);
    expect(canApplyOfferAction(offer, OFFER_ACTION.ACCEPT, true)).toBe(false);
    const accepted = applyOfferAction(offer, OFFER_ACTION.ACCEPT, 'u2', 5);
    expect(accepted).toMatchObject({ status: OFFER_STATUS.ACCEPTED, statusBy: 'u2', statusAt: 5 });
    expect(offerActionsFor(accepted, true)).toEqual([OFFER_ACTION.FAIL, OFFER_ACTION.COMPLETE]);
    const done = applyOfferAction(accepted, OFFER_ACTION.COMPLETE, 'u1');
    expect(offerActionsFor(done, false)).toEqual([]);
  });

  test('verdict is for the receiver', () => {
    // Sender gives 5, asks 10: the receiver gives 10 for 5 → lose.
    const offer = buildTradeOffer({ id: 'x', give: [pet('A', { selectedValue: 5 })], get: [pet('B', { selectedValue: 10 })] });
    expect(receiverVerdict(offer, tradeStatus)).toEqual({ status: 'lose', diff: -5 });
  });

  test('fallback text has no dots (server link filter) and groups duplicates', () => {
    const offer = buildTradeOffer({
      id: 'x',
      give: [pet('Mr. Pumpkin'), pet('Mr. Pumpkin'), pet('Bat', { valueType: 'm', isFly: true })],
      get: [],
    });
    const text = offerFallbackText(offer, t);
    expect(text).toContain('Mr Pumpkin x2');
    expect(text).toContain('MF Bat');
    expect(text).toContain('I want: nothing');
    expect(text).not.toMatch(/\.[a-z]/i);
    expect(groupOfferItems(offer.give)).toHaveLength(2);
  });

  test('request hand-off is taken once', () => {
    const seen = [];
    const off = subscribeCounterRequest((r) => seen.push(r.trade.id));
    requestCounterOffer({ trade: { id: 't9' }, poster: { senderId: 'p' } });
    off();
    expect(seen).toEqual(['t9']);
    expect(takeCounterRequest().trade.id).toBe('t9');
    expect(takeCounterRequest()).toBeNull();
  });
});
