// PayWall.js
import Purchases from 'react-native-purchases';
import RevenueCatUI from 'react-native-purchases-ui';
import { mixpanel } from '../AppHelper/MixPenel';

const ENTITLEMENT_ID = 'pro';

const userHasEntitlement = async () => {
  try {
    const customerInfo = await Purchases.getCustomerInfo();
    return !!customerInfo.entitlements.active?.[ENTITLEMENT_ID];
  } catch (e) {
    return false;
  }
};

const openAndCheck = async (offering, offeringId, source, showoffer) => {
  if (!offering) {
    console.warn('Offering not found:', offeringId);
    return false;
  }

  // ✅ 1) Paywall shown
  mixpanel.track('paywall_presented', {
    source: source || 'unknown',
    offeringId,
    flow: showoffer ? 'two_step' : 'single',
  });

  await RevenueCatUI.presentPaywall({ offering });

  const hasEntitlement = await userHasEntitlement();

  // ✅ 2) Purchase success OR dismissed
  if (hasEntitlement) {
    mixpanel.track('purchase_completed', {
      source: source || 'unknown',
      offeringId,
      entitlement: ENTITLEMENT_ID,
      flow: showoffer ? 'two_step' : 'single',
    });
  } else {
    mixpanel.track('paywall_dismissed', {
      source: source || 'unknown',
      offeringId,
      flow: showoffer ? 'two_step' : 'single',
    });
  }

  return hasEntitlement;
};

// ✅ added: forceSecondOnly
export const handleOpenPaywall = async (source, showoffer, forceSecondOnly = false) => {
  try {
    const offerings = await Purchases.getOfferings();
    const all = offerings.all || {};

    const simpleOffering = all['default'];
    const secondOffering = all['paywallrc'];

    // ✅ Firebase flag ON: only show 2nd wall
    if (forceSecondOnly) {
      if (secondOffering) {
        await openAndCheck(secondOffering, 'paywallrc', source, false);
      } else if (simpleOffering) {
        // fallback safety
        await openAndCheck(simpleOffering, 'default', source, false);
      }
      return;
    }

    // ✅ your original logic untouched
    if (showoffer) {
      const boughtOnFirst = await openAndCheck(
        simpleOffering,
        'default',
        source,
        showoffer
      );

      if (!boughtOnFirst && secondOffering) {
        await openAndCheck(
          secondOffering,
          'paywallrc',
          source,
          showoffer
        );
      }
    } else {
      const offering = simpleOffering || secondOffering;
      const offeringId = secondOffering ? 'paywallrc' : 'default';

      await openAndCheck(offering, offeringId, source, showoffer);
    }
  } catch (e) {
    console.log('Error showing paywall', e);

    mixpanel.track('paywall_error', {
      source: source || 'unknown',
      message: String(e?.message || e),
    });
  }
};
