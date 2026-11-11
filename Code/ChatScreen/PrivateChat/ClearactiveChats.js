import {  useCallback } from 'react';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { BackHandler } from 'react-native';
import { getDatabase, ref, remove, update } from '@react-native-firebase/database';

const clearActiveChat = async (userId) => {
  try {
    const db = getDatabase();
    await remove(ref(db, `/activeChats/${userId}`));
  } catch (error) {
    console.error(`Failed to clear active chat for user ${userId}:`, error);
  }
};

export const useActiveChatHandler = (userId, chatId) => {
  const navigation = useNavigation();

  // Memoized function to set active chat
  const setActiveChat = useCallback(async () => {
    try {
      const db = getDatabase();
      await update(ref(db, `/activeChats/${userId}`), { chatId });
    } catch (error) {
      console.error(`Failed to set active chat for user ${userId}:`, error);
    }
  }, [userId, chatId]);

  // Memoized back handler
  const onBackPress = useCallback(() => {
    clearActiveChat(userId);
    navigation.goBack();
    return true; // Prevent default back press behavior
  }, [userId, navigation]);

  useFocusEffect(
    useCallback(() => {
      setActiveChat();

      // RN 0.87 has no BackHandler.removeEventListener; remove through the
      // subscription, or every focus stacks another back handler.
      const backSub = BackHandler.addEventListener('hardwareBackPress', onBackPress);

      return () => {
        clearActiveChat(userId);
        backSub.remove();
      };
    }, [setActiveChat, onBackPress, userId])
  );
};
