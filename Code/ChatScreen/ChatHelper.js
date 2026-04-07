import { Text, Alert } from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import { Linking } from 'react-native';

// ✅ Pre-compile regex patterns for better performance
const URL_REGEX = /^https?:\/\/\S+$/;
const MENTION_REGEX = /^@\w+/;

export const parseMessageText = (text) => {
  // ✅ Safety check: handle null/undefined/empty text
  if (!text || typeof text !== 'string') {
    return '';
  }

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
            Linking.openURL(part).catch(() =>
              Alert.alert('Error', 'Unable to open the link.')
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
            Alert.alert('Copied', `${part.replace('@', '')} has been copied.`);
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
