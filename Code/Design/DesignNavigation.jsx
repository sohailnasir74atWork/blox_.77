import React, { useMemo, useState, useCallback } from 'react';
import { Text, StyleSheet } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import config from '../Helper/Environment';
import { useGlobalState } from '../GlobelStats';
import { useHaptic } from '../Helper/HepticFeedBack';

import DesignFeedScreen from './DesignMainScreen';
import PrivateChatScreen from '../ChatScreen/PrivateChat/PrivateChat';
import PrivateChatHeader from '../ChatScreen/PrivateChat/PrivateChatHeader';
import ImageViewerScreen from './componenets/ImageViewer';

const Stack = createNativeStackNavigator();

const HighlightedText = ({ text }) => (
  <Text style={styles.highlightedText}>{text}</Text>
);

export const DesignStack = ({ selectedTheme }) => {
  const [bannedUsers, setBannedUsers] = useState([]);
  const { triggerHapticFeedback } = useHaptic();
  const { theme } = useGlobalState();
  const isDarkMode = theme === 'dark';

  // console.log('dsignnavigator')

  const headerOptions = useMemo(() => ({
    headerStyle: { backgroundColor: selectedTheme.colors.background },
    headerTintColor: selectedTheme.colors.text,
    headerTitleStyle: { fontFamily: 'Lato-Bold', fontSize: 24 },
  }), [selectedTheme]);

  const sharedParams = useMemo(() => ({
    bannedUsers,
    selectedTheme,
  }), [bannedUsers, selectedTheme]);

  const getPrivateChatOptions = useCallback(({ route }) => {
    const { selectedUser, isOnline } = route.params;
    return {
      headerTitle: () => (
        <PrivateChatHeader
          selectedUser={selectedUser}
          isOnline={isOnline}
          selectedTheme={selectedTheme}
          bannedUsers={bannedUsers}
          setBannedUsers={setBannedUsers}
          triggerHapticFeedback={triggerHapticFeedback}
        />
      ),
    };
  }, [selectedTheme, bannedUsers, triggerHapticFeedback]);

  return (
    <Stack.Navigator screenOptions={headerOptions}>
      <Stack.Screen
        name="DesignScreen"
        component={DesignFeedScreen}
        initialParams={sharedParams}
        options={{ headerShown: false, title:'House Hub' }}
      />
      <Stack.Screen
        name="PrivateChatDesign"
        component={PrivateChatScreen}
        initialParams={sharedParams}
        options={getPrivateChatOptions}
      />
      <Stack.Screen
        name="ImageViewerScreen"
        component={ImageViewerScreen}
        options={{ title: 'Image' }}
      />
    </Stack.Navigator>
  );
};

const styles = StyleSheet.create({
  highlightedText: {
    fontFamily: 'Lato-Bold',
    color: config.colors.primary,
  },
});

export default React.memo(DesignStack);
