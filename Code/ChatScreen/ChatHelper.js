import { Text, Alert } from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import { Linking } from 'react-native';

export const parseMessageText = (text) => {
  return text.split(/(\s+)/).map((part, index) => {
    // ✅ Check if part is a URL (starts with http:// or https://)
    if (/^https?:\/\/\S+$/.test(part)) {
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
    if (/^@\w+/.test(part)) {
      return (
        <Text
          key={`mention-${index}`}
          style={{ color: '#007BFF', fontFamily: 'Lato-Bold' }}
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
