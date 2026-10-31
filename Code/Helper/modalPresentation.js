/**
 * modalPresentation.js
 *
 * iOS-safe sequencing for React Native <Modal>.
 *
 * A <Modal> on iOS is not a view in the React tree — RCTModalHostView presents
 * a real UIViewController. UIKit allows one presentation per controller at a
 * time and the call is asynchronous, so presenting B while A is still
 * animating out is refused:
 *
 *   Attempt to present <RCTModalHostViewController> on <...> which is already
 *   presenting <...>
 *
 * React keeps believing B is visible, and the user is left with a transparent
 * controller on top swallowing every touch — the app looks frozen even though
 * the JS thread is still running fine.
 *
 * Android has no such constraint, so nothing here delays anything there.
 */

import { useCallback, useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import { noteModalTransition } from '../Ads/adVisibility';

// onDismiss is the real "A has finished dismissing" signal, but it is iOS-only
// and never arrives when a modal is unmounted rather than hidden. Without a
// fallback the second modal would simply never open — worse than the freeze
// this fixes. Comfortably past the ~300ms dismiss animation.
const HANDOFF_FALLBACK_MS = 700;

/**
 * Tell the ad layer that this modal is animating, so a full-screen ad is not
 * presented from a controller that is mid-transition (the ad would silently
 * fail to appear while the JS side had already marked it consumed).
 *
 * Call with the same expression used for the modal's `visible` prop.
 */
export const useModalTransition = (visible) => {
  const previous = useRef(visible);

  useEffect(() => {
    if (previous.current === visible) return;
    previous.current = visible;
    noteModalTransition();
  }, [visible]);
};

/**
 * Close one modal and open another without the two presentations colliding.
 *
 *   const { handoff, onDismiss } = useModalHandoff();
 *   ...
 *   handoff(() => closeDrawer(), () => setShowReasonModal(true));
 *   ...
 *   <Modal visible={drawerVisible} onDismiss={onDismiss}> ... </Modal>
 *
 * `onDismiss` must be wired to the modal being CLOSED. It is safe to leave it
 * attached permanently: with nothing pending it is a no-op.
 */
export const useModalHandoff = () => {
  const pending = useRef(null);
  const fallback = useRef(null);

  const clearFallback = useCallback(() => {
    if (fallback.current) {
      clearTimeout(fallback.current);
      fallback.current = null;
    }
  }, []);

  const flush = useCallback(() => {
    clearFallback();
    const next = pending.current;
    pending.current = null;
    if (next) next();
  }, [clearFallback]);

  useEffect(() => clearFallback, [clearFallback]);

  const handoff = useCallback((close, open) => {
    if (typeof close === 'function') close();
    if (typeof open !== 'function') return;

    // Android presents modals as plain views — no controller to collide with.
    if (Platform.OS !== 'ios') {
      open();
      return;
    }

    noteModalTransition();

    // A second handoff before the first resolved (two rapid taps) replaces it.
    // Running the earlier one now would present it mid-transition — the very
    // collision this exists to avoid — and the latest tap is what the user
    // actually asked for.
    pending.current = open;
    clearFallback();
    fallback.current = setTimeout(flush, HANDOFF_FALLBACK_MS);
  }, [clearFallback, flush]);

  return { handoff, onDismiss: flush };
};
