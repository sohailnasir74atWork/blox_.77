import {  useCallback } from 'react';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { BackHandler } from 'react-native';
import database from '@react-native-firebase/database';

const clearActiveChat = async (userId) => {
  try {
    await database().ref(`/activeChats/${userId}`).remove();
  } catch (error) {
    console.error(`Failed to clear active chat for user ${userId}:`, error);
  }
};

export const useActiveChatHandler = (userId, chatId) => {
  const navigation = useNavigation();

  // Memoized function to set active chat
  const setActiveChat = useCallback(async () => {
    try {
      await database().ref(`/activeChats/${userId}`).update({ chatId });
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

      BackHandler.addEventListener('hardwareBackPress', onBackPress);

      return () => {
        clearActiveChat(userId);
        BackHandler.removeEventListener('hardwareBackPress', onBackPress);
      };
    }, [setActiveChat, onBackPress, userId])
  );
};
