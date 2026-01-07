import React, { useEffect, useRef } from 'react';
import { KeyboardAvoidingView, Keyboard, Platform, Animated, Easing } from 'react-native';

const ConditionalKeyboardWrapper = ({ children, style, chatscreen = false, privatechatscreen = false }) => {
  const keyboardHeight = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Use 'will' events on iOS for smoother animations (fires before animation starts)
    // Use 'did' events on Android (standard for Android)
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const showSubscription = Keyboard.addListener(showEvent, (e) => {
      const height = e.endCoordinates?.height || 0;
      Animated.timing(keyboardHeight, {
        toValue: height,
        duration: Platform.OS === 'ios' ? (e?.duration || 200) : 200,
        easing: Easing.out(Easing.ease),
        useNativeDriver: false,
      }).start();
    });

    const hideSubscription = Keyboard.addListener(hideEvent, (e) => {
      Animated.timing(keyboardHeight, {
        toValue: 0,
        duration: Platform.OS === 'ios' ? (e?.duration || 200) : 200,
        easing: Easing.out(Easing.ease),
        useNativeDriver: false,
      }).start();
    });

    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, [keyboardHeight]);

  // ✅ For chat and private chat screens: use KeyboardAvoidingView with padding behavior
  // This ensures the input sits right on top of the keyboard without extra space
  if (chatscreen || privatechatscreen) {
    if (Platform.OS === 'ios') {
      return (
        <KeyboardAvoidingView
          behavior="padding"
          style={style}
          keyboardVerticalOffset={100}
        >
          {children}
        </KeyboardAvoidingView>
      );
    }
    
    return (
      <KeyboardAvoidingView
        behavior="padding"
        style={style}
        enabled={true}
        keyboardVerticalOffset={115}
      >
        {children}
      </KeyboardAvoidingView>
    );
  }

  // ✅ For all other screens, use default KeyboardAvoidingView behavior (no custom offset)
  if (Platform.OS === 'ios') {
    return (
      <KeyboardAvoidingView
        behavior="padding"
        style={style}
      >
        {children}
      </KeyboardAvoidingView>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior="padding"
      style={style}
      enabled={true}
    >
      {children}
    </KeyboardAvoidingView>
  );
};

export default ConditionalKeyboardWrapper;
