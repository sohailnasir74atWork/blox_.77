import React, { useEffect, useRef, forwardRef, useImperativeHandle } from 'react';
import { AppState } from 'react-native';
import LottieView from 'lottie-react-native';

/**
 * SafeLottieView.js
 * A drop-in replacement for LottieView that automatically pauses the animation
 * when the app goes into the background (inactive/background state).
 * 
 * This prevents the React Native "UI thread stall" bug where unpaused Lottie
 * animations queue up thousands of dropped frames in memory while the app is backgrounded,
 * causing the app to freeze completely when returning to the foreground.
 */
const SafeLottieView = forwardRef(({ autoPlay, ...props }, ref) => {
  const lottieRef = useRef(null);
  const appState = useRef(AppState.currentState);

  // Expose Lottie methods to parent (if they passed a ref)
  useImperativeHandle(ref, () => ({
    play: (...args) => lottieRef.current?.play(...args),
    reset: () => lottieRef.current?.reset(),
    pause: () => lottieRef.current?.pause(),
    resume: () => lottieRef.current?.resume(),
  }));

  useEffect(() => {
    const subscription = AppState.addEventListener('change', nextAppState => {
      if (
        appState.current.match(/inactive|background/) &&
        nextAppState === 'active'
      ) {
        // App has come to the foreground!
        if (autoPlay) {
          lottieRef.current?.play();
        }
      } else if (
        appState.current === 'active' &&
        nextAppState.match(/inactive|background/)
      ) {
        // App has gone to the background! Pause to prevent memory/frame queuing leak
        lottieRef.current?.pause();
      }

      appState.current = nextAppState;
    });

    return () => {
      subscription.remove();
    };
  }, [autoPlay]);

  return (
    <LottieView
      ref={lottieRef}
      autoPlay={autoPlay}
      {...props}
    />
  );
});

export default React.memo(SafeLottieView);
