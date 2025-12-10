import React, { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Keyboard, Platform } from 'react-native';

const ConditionalKeyboardWrapper = ({ children, style, chatscreen = false, privatechatscreen=false }) => {
  const [keyboardVisible, setKeyboardVisible] = useState(false);

  useEffect(() => {
    const showSubscription = Keyboard.addListener('keyboardDidShow', () => {
      setKeyboardVisible(true);
    });
    const hideSubscription = Keyboard.addListener('keyboardDidHide', () => {
      setKeyboardVisible(false);
    });

    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, []);

  const verticalOffset = privatechatscreen && keyboardVisible
  ? 120
  : chatscreen
    ? Platform.OS === 'ios'
      ? 70
      : keyboardVisible
        ? 0
        : 0
    : 110;


  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={verticalOffset}
      style={style}
    >
      {children}
    </KeyboardAvoidingView>
  );
};

export default ConditionalKeyboardWrapper;
