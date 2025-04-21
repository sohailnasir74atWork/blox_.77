import React, { useState } from 'react';
import { View, TextInput, TouchableOpacity, Text } from 'react-native';
import { getStyles } from './../Style';
import Icon from 'react-native-vector-icons/Ionicons';
import config from '../../Helper/Environment';
import { useHaptic } from '../../Helper/HepticFeedBack';
import { useTranslation } from 'react-i18next';
import { useLocalState } from '../../LocalGlobelStats';
import InterstitialAdManager from '../../Ads/IntAd';
const MessageInput = ({
  input,
  setInput,
  handleSendMessage,
  selectedTheme,
  replyTo,
  onCancelReply,
}) => {
  const styles = getStyles(selectedTheme.colors.text === 'white');
  const [isSending, setIsSending] = useState(false);
  const { triggerHapticFeedback } = useHaptic();
  const [messageCount, setMessageCount] = useState(0);
  const { t } = useTranslation();
  const {localState} = useLocalState()
  const handleSend = async () => {
    triggerHapticFeedback('impactLight');
    const trimmedInput = input.trim();
    if (!trimmedInput || isSending) return; // Prevent empty messages or multiple sends
    setIsSending(true);

    const callbackfunction = () => {
      setIsSending(false)
    };
  
    try {
      await handleSendMessage(replyTo, trimmedInput);
      setInput('');
      if (onCancelReply) onCancelReply();
  
      // Increment message count
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
    } catch (error) {
      console.error('Error sending message:', error);
      setIsSending(false);
    }
  };
  
  return (
    <View style={styles.inputWrapper}>
      {/* Reply context UI */}
      {replyTo && (
        <View style={styles.replyContainer}>
          <Text style={styles.replyText}>
            {t("chat.replying_to")}: {replyTo.text}
          </Text>
          <TouchableOpacity onPress={onCancelReply} style={styles.cancelReplyButton}>
            <Icon name="close-circle" size={24} color="#e74c3c" />
          </TouchableOpacity>
        </View>
      )}

      <View style={styles.inputContainer}>
        <TextInput
          style={[styles.input, { color: selectedTheme.colors.text }]}
          placeholder={t("chat.type_message")}
          placeholderTextColor="#888"
          value={input}
          onChangeText={setInput}
          multiline
        />
        <TouchableOpacity
          style={[
            styles.sendButton,
            { backgroundColor: input.trim() && !isSending ? '#1E88E5' : config.colors.primary },
          ]}
          onPress={handleSend}
          disabled={!input.trim() || isSending}
        >
          <Text style={styles.sendButtonText}>{isSending ? t("chat.sending") : t("chat.send")}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

export default MessageInput;
