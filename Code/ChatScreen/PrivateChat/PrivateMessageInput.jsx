import React, { useState } from 'react';
import { View, TextInput, TouchableOpacity, Text } from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { getStyles } from '../Style';
import config from '../../Helper/Environment';
import { useGlobalState } from '../../GlobelStats';
import { useTranslation } from 'react-i18next';
import InterstitialAdManager from '../../Ads/IntAd';
import { useLocalState } from '../../LocalGlobelStats';

const PrivateMessageInput = ({ onSend, replyTo, onCancelReply, isBanned }) => {
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [messageCount, setMessageCount] = useState(0);
  const {localState}= useLocalState()

  const { theme } = useGlobalState();
  const isDark = theme === 'dark';
  const { t } = useTranslation();


  const styles = getStyles(isDark);
  const handleSend = async () => {
    const trimmedInput = input.trim();
    if (!trimmedInput || isSending) return;

    setIsSending(true);
    setInput(''); // Clear the input field
    const callbackfunction = () => {
      setIsSending(false)
    };
    setMessageCount(prevCount => {
      const newCount = prevCount + 1;
      if (!localState.isPro && newCount % 5 === 0) {
        // Show ad only if user is NOT pro
        InterstitialAdManager.showAd(callbackfunction);
      } else {
        setIsSending(false);
      }
      return newCount;
    });


    try {
      await onSend(trimmedInput); // Send the message
      if (onCancelReply) onCancelReply(); // Clear reply context if any
    } catch (error) {
      console.error('Error sending message:', error);
    } finally {
      setIsSending(false); // Reset sending state
    }
  };

  return (
    <View style={styles.inputWrapper}>
      {/* Reply Context */}
      {replyTo && (
        <View style={styles.replyContainer}>
          <Text style={styles.replyText}>Replying to: {replyTo.text}</Text>
          <TouchableOpacity onPress={onCancelReply} style={styles.cancelReplyButton}>
            <Icon name="close-circle" size={24} color="#e74c3c" />
          </TouchableOpacity>
        </View>
      )}

      {/* Input Container */}
      <View style={styles.inputContainer}>
        <TextInput
          style={[styles.input, { color: isDark ? '#FFF' : '#000' }]}
          placeholder={t("chat.type_message")}
          placeholderTextColor="#888"
          value={input}
          onChangeText={setInput}
          multiline
          editable={!isBanned} // Disable input if user is banned
        />
        <TouchableOpacity
          style={[
            styles.sendButton,
            {
              backgroundColor: input.trim() && !isSending
                ? '#1E88E5'
                : config.colors.primary,
            },
          ]}
          onPress={handleSend}
          disabled={!input.trim() || isSending}
        >
          <Text style={styles.sendButtonText}>
            {isSending ? t("chat.sending") : t("chat.send")}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

export default PrivateMessageInput;
