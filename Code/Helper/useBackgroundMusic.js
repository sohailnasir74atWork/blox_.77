import { useEffect, useRef } from 'react';
import { AppState, Platform } from 'react-native';
import Sound from 'react-native-sound';

// Enable playback in silence mode (iOS)
Sound.setCategory('Playback', true);

/**
 * Custom hook to play background music in a loop
 * @param {string} audioPath - Path to the audio file (e.g., require('../assets/audio.mp3'))
 * @param {boolean} enabled - Whether music should be playing
 * @param {number} volume - Volume level (0.0 to 1.0), default 0.5
 */
export const useBackgroundMusic = (audioPath, enabled = true, volume = 0.5) => {
  const soundRef = useRef(null);
  const isPlayingRef = useRef(false);
  const appStateRef = useRef(AppState.currentState);

  useEffect(() => {
    if (!audioPath || !enabled) {
      // Clean up if disabled
      if (soundRef.current) {
        soundRef.current.stop();
        soundRef.current.release();
        soundRef.current = null;
        isPlayingRef.current = false;
      }
      return;
    }

    // Validate audioPath is a string (for iOS/Android) or valid require result
    if (typeof audioPath !== 'string' && typeof audioPath !== 'number') {
      console.error('Invalid audioPath type. Expected string or number (require result), got:', typeof audioPath);
      return;
    }

    // Initialize sound
    // react-native-sound constructor: new Sound(path, basePath, callback)
    // For iOS: string filename with extension, use Sound.MAIN_BUNDLE
    // For Android: string filename without extension, use Sound.MAIN_BUNDLE
    // For remote URLs: use URL string without basePath
    
    const isRemoteUrl = typeof audioPath === 'string' && (audioPath.startsWith('http://') || audioPath.startsWith('https://'));
    
    const sound = isRemoteUrl
      ? new Sound(audioPath, (error) => {
          if (error) {
            console.error('Failed to load sound:', error);
            return;
          }

          // Set volume
          sound.setVolume(volume);
          
          // Set number of loops (-1 = infinite loop)
          sound.setNumberOfLoops(-1);
          
          soundRef.current = sound;
          
          // Start playing
          sound.play((playError) => {
            if (playError) {
              console.error('Failed to play sound:', playError);
            } else {
              isPlayingRef.current = true;
            }
          });
        })
      : new Sound(audioPath, Sound.MAIN_BUNDLE, (error) => {
          // iOS and Android: string filename with Sound.MAIN_BUNDLE
          // iOS expects filename with extension (e.g., 'audio.mp3')
          // Android expects filename without extension (e.g., 'audio')
          if (error) {
            console.error('Failed to load sound:', error);
            // On iOS, this usually means the file isn't in the Xcode bundle
            // The file needs to be added to Xcode project and "Copy Bundle Resources"
            if (Platform.OS === 'ios') {
              console.warn('iOS: Make sure audio.mp3 is added to Xcode project under "Copy Bundle Resources"');
            } else if (Platform.OS === 'android') {
              console.warn('Android: Make sure audio.mp3 is in android/app/src/main/res/raw/audio.mp3');
              console.warn('Android: File should be referenced as "audio" (without extension) in code');
              console.warn('Android: After adding file, rebuild the app: cd android && ./gradlew clean && cd .. && npm run android');
            }
            return;
          }

          // Set volume
          sound.setVolume(volume);
          
          // Set number of loops (-1 = infinite loop)
          sound.setNumberOfLoops(-1);
          
          soundRef.current = sound;
          
          // Start playing
          sound.play((playError) => {
            if (playError) {
              console.error('Failed to play sound:', playError);
            } else {
              isPlayingRef.current = true;
            }
          });
        });

    // Handle app state changes (pause when app goes to background, resume when foreground)
    const subscription = AppState.addEventListener('change', (nextAppState) => {
      if (
        appStateRef.current.match(/inactive|background/) &&
        nextAppState === 'active'
      ) {
        // App has come to the foreground
        if (soundRef.current && !isPlayingRef.current) {
          soundRef.current.play((playError) => {
            if (playError) {
              console.error('Failed to resume sound:', playError);
            } else {
              isPlayingRef.current = true;
            }
          });
        }
      } else if (nextAppState.match(/inactive|background/)) {
        // App has gone to the background
        if (soundRef.current && isPlayingRef.current) {
          soundRef.current.pause();
          isPlayingRef.current = false;
        }
      }
      appStateRef.current = nextAppState;
    });

    // Cleanup function
    return () => {
      subscription?.remove();
      if (soundRef.current) {
        soundRef.current.stop();
        soundRef.current.release();
        soundRef.current = null;
        isPlayingRef.current = false;
      }
    };
  }, [audioPath, enabled, volume]);

  // Update volume when it changes
  useEffect(() => {
    if (soundRef.current && enabled) {
      soundRef.current.setVolume(volume);
    }
  }, [volume, enabled]);

  return {
    isPlaying: isPlayingRef.current,
    play: () => {
      if (soundRef.current && !isPlayingRef.current) {
        soundRef.current.play();
        isPlayingRef.current = true;
      }
    },
    pause: () => {
      if (soundRef.current && isPlayingRef.current) {
        soundRef.current.pause();
        isPlayingRef.current = false;
      }
    },
    stop: () => {
      if (soundRef.current) {
        soundRef.current.stop();
        isPlayingRef.current = false;
      }
    },
  };
};

