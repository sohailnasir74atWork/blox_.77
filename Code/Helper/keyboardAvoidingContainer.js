import React from 'react';
import { KeyboardAvoidingView, View, Platform } from 'react-native';

const ConditionalKeyboardWrapper = ({ children, style, chatscreen }) => {
  return Platform.OS === 'ios' ? (
    <KeyboardAvoidingView
      behavior="padding"
      style={ style} // Combine default and passed styles
      keyboardVerticalOffset={chatscreen && 110 }
    >
      {children}
    </KeyboardAvoidingView>
  ) : (
    <View style={ style}>{children}</View>
  );
};

export default ConditionalKeyboardWrapper;
