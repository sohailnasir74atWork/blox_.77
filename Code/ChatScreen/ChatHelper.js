import { Text, Alert } from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import { Linking } from 'react-native';
import i18next from 'i18next';

// ✅ Pre-compile regex patterns for better performance
// http(s):// and bare www. links
const URL_REGEX = /^(?:https?:\/\/|www\.)\S+$/;
const MENTION_REGEX = /^@\w+/;

// Longest message the inputs accept (group + DM TextInput maxLength).
export const MAX_MESSAGE_LENGTH = 1000;
// Longest text a bubble or reply preview draws. Stored messages of 100k-1.6M
// chars (no cap before 2026-10-22) froze every phone that opened the chat:
// Android measures the whole string before drawing it.
export const MAX_DISPLAY_LENGTH = 2000;

// Cut at MAX_DISPLAY_LENGTH without splitting an emoji's surrogate pair.
export const capMessageText = (text) => {
  if (typeof text !== 'string' || text.length <= MAX_DISPLAY_LENGTH) return text;
  let end = MAX_DISPLAY_LENGTH;
  const code = text.charCodeAt(end - 1);
  if (code >= 0xd800 && code <= 0xdbff) end -= 1;
  return text.slice(0, end) + '…';
};

export const parseMessageText = (rawText) => {
  // ✅ Safety check: handle null/undefined/empty text
  if (!rawText || typeof rawText !== 'string') {
    return '';
  }
  const text = capMessageText(rawText);

  // ✅ Early return for empty strings
  if (text.trim().length === 0) {
    return text;
  }

  return text.split(/(\s+)/).map((part, index) => {
    // ✅ Check if part is a URL (starts with http:// or https://)
    if (URL_REGEX.test(part)) {
      return (
        <Text
          key={`link-${index}`}
          style={{ color: '#1E90FF', textDecorationLine: 'underline' }}
          onPress={() =>
            Linking.openURL(part.startsWith('www.') ? `https://${part}` : part).catch(() =>
              Alert.alert(i18next.t('chat.error'), i18next.t('chat.chat_helper.link_open_error'))
            )
          }
        >
          {part}
        </Text>
      );
    }

    // ✅ Check if part is a mention (starts with @username)
    if (MENTION_REGEX.test(part)) {
      return (
        <Text
          key={`mention-${index}`}
          style={{ color: '#007BFF', fontWeight: 'bold' }}
          onPress={() => {
            Clipboard.setString(part.replace('@', '')); // Copy without '@'
            Alert.alert(i18next.t('chat.chat_helper.copied'), i18next.t('chat.chat_helper.name_copied', { name: part.replace('@', '') }));
          }}
        >
          {part}
        </Text>
      );
    }

    // ✅ Return normal text
    return part;
  });
};
