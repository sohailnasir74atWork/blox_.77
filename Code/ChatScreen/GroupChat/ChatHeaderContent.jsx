import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { useGlobalState } from '../../GlobelStats';
import config from '../../Helper/Environment';
import { useTranslation } from 'react-i18next';
import ChatRulesModal from './ChatRuleModel';
import OnlineUsersList from './OnlineUsersList';

const ChatHeaderContent = ({
  selectedTheme,
  modalVisibleChatinfo,
  setModalVisibleChatinfo,
  triggerHapticFeedback,
  onlineUsersVisible,
  setOnlineUsersVisible,
}) => {
  const { theme } = useGlobalState();
  const isDarkMode = theme === 'dark';

  return (
    <>
      <View style={{
        flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 10, alignItems: 'center', borderBottomWidth: .3, borderBottomColor: 'lightgrey',
      }}>
        <Text style={{ fontSize: 9, color: isDarkMode ? 'white' : 'black' }}>
          🚫 No Spamming ❌ No Abuse 🛑 Be Civil & Polite 😊
        </Text>
        <TouchableOpacity onPress={() => { setModalVisibleChatinfo(true); triggerHapticFeedback('impactLight'); }}>
          <Icon name="information-circle-outline" size={16} color={config.colors.primary} style={{ marginRight: 10 }} />
        </TouchableOpacity>
      </View>

      <ChatRulesModal
        visible={modalVisibleChatinfo}
        onClose={() => setModalVisibleChatinfo(false)}
        isDarkMode={isDarkMode}
      />
      {onlineUsersVisible !== undefined && setOnlineUsersVisible && (
        <OnlineUsersList
          visible={onlineUsersVisible}
          onClose={() => setOnlineUsersVisible(false)}
          mode="view"
        />
      )}
    </>
  );
};


export default ChatHeaderContent;

