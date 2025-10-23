import React, { useEffect, useState, useMemo } from 'react';
import { KeyboardAvoidingView, Keyboard, Platform } from 'react-native';

const ConditionalKeyboardWrapper = ({
  children,
  style,
  chatscreen = false,
  privatechatscreen = false,
  privateOffset = 220,
  chatOffsetIOS = 70,
  defaultOffset = 110,
}) => {
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const isIOS = Platform.OS === 'ios';

  useEffect(() => {
    const showSub = Keyboard.addListener('keyboardDidShow', () => setKeyboardVisible(true));
    const hideSub = Keyboard.addListener('keyboardDidHide', () => setKeyboardVisible(false));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  const keyboardVerticalOffset = useMemo(() => {
    if (!keyboardVisible) return 0;

    if (privatechatscreen) return privateOffset;
    if (chatscreen) return isIOS ? chatOffsetIOS : 0;
    return defaultOffset;
  }, [keyboardVisible, privatechatscreen, chatscreen, isIOS, privateOffset, chatOffsetIOS, defaultOffset]);

  const behavior = useMemo(() => {
    if (!keyboardVisible) return undefined;
    return isIOS ? 'padding' : 'height';
  }, [keyboardVisible, isIOS]);

  return (
    <KeyboardAvoidingView
      behavior={behavior}
      keyboardVerticalOffset={keyboardVerticalOffset}
      style={style}
    >
      {children}
    </KeyboardAvoidingView>
  );
};

export default ConditionalKeyboardWrapper;
