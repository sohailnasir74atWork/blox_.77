// SubscriptionScreen.js
import React, { useEffect, useRef } from 'react';
import { handleOpenPaywall } from './PayWall';
import { useLocalState } from '../LocalGlobelStats';

const SubscriptionScreen = ({ visible, onClose, track, showoffer, oneWallOnly }) => {
  const hasOpenedRef = useRef(false);
  const { refreshCustomerInfo } = useLocalState();

  useEffect(() => {
    if (!visible) {
      hasOpenedRef.current = false;
      return;
    }

    if (hasOpenedRef.current) return;
    hasOpenedRef.current = true;

    let cancelled = false;

    (async () => {
      try {
        await handleOpenPaywall(track, showoffer, !!oneWallOnly);
        await refreshCustomerInfo();
      } finally {
        if (!cancelled && typeof onClose === 'function') {
          onClose();
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [visible]);

  return null;
};

export default SubscriptionScreen;
