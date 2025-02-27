import React, { useEffect, useMemo, useState } from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { onValue, ref } from '@react-native-firebase/database';
import TradeList from './Trades';
import { useGlobalState } from '../GlobelStats'; // Adjust import path
import { useHaptic } from '../Helper/HepticFeedBack'; // Adjust import path
import PrivateChatScreen from '../ChatScreen/PrivateChat/PrivateChat';
import PrivateChatHeader from '../ChatScreen/PrivateChat/PrivateChatHeader';
import { useTranslation } from 'react-i18next';

const Stack = createNativeStackNavigator();

export const TradeStack = ({ selectedTheme }) => {
  // const { user, appdatabase } = useGlobalState();
  const [bannedUsers, setBannedUsers] = useState([]);
  const { triggerHapticFeedback } = useHaptic();
  const {t} = useTranslation()

  // useEffect(() => {
  //   if (!user?.id) return;

  //   // const db = getDatabase();
  //   const bannedRef = ref(appdatabase, `bannedUsers/${user.id}`);
  //   const unsubscribe = onValue(
  //     bannedRef,
  //     (snapshot) => {
  //       const data = snapshot.val() || {};
  //       const bannedUsersList = Object.entries(data).map(([id, details]) => ({
  //         id,
  //         displayName: details?.displayName || 'Anonymous',
  //         avatar: details?.avatar || '',
  //       }));
  //       setBannedUsers(bannedUsersList);
  //     },
  //     (error) => console.error('Error fetching banned users:', error)
  //   );

  //   return () => unsubscribe(); // Cleanup listener on unmount
  // }, [user?.id]);

  // Memoized header options for performance
  const headerOptions = useMemo(
    () => ({
      headerStyle: { backgroundColor: selectedTheme.colors.background },
      headerTintColor: selectedTheme.colors.text,
      headerTitleStyle: { fontFamily: 'Lato-Bold', fontSize: 24 },
    }),
    [selectedTheme]
  );

  return (
    <Stack.Navigator screenOptions={headerOptions}>
      {/* Trade List Screen */}
      <Stack.Screen
        name="TradeScreen"
        component={TradeList}
        initialParams={{ bannedUsers, selectedTheme }}

        options={{ title: t("tabs.trade") }}
      />

      {/* Private Chat Screen */}
      <Stack.Screen
        name="PrivateChatTrade"
        component={PrivateChatScreen}
        initialParams={{ bannedUsers }}
        options={({ route }) => {
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
        }}
      />
    </Stack.Navigator>
  );
};
