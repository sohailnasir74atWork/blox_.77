import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { useGlobalState } from '../GlobelStats';
import { useLocalState } from '../LocalGlobelStats';
import Clipboard from '@react-native-clipboard/clipboard';
import { useHaptic } from '../Helper/HepticFeedBack';
import { t } from 'i18next';
import { showSuccessMessage } from '../Helper/MessageHelper';
import { mixpanel } from '../AppHelper/MixPenel';
import config from '../Helper/Environment';

const CodesScreen = () => {
  const { theme } = useGlobalState();
  const { localState } = useLocalState();
  const isDarkMode = theme === 'dark';
  const { triggerHapticFeedback } = useHaptic();
  const [codesData, setCodesData] = useState([]);

  useEffect(() => {
    if (localState.codes) {
      try {
        const parsedCodes = typeof localState.codes === 'string'
          ? JSON.parse(localState.codes)
          : localState.codes;

        if (typeof parsedCodes !== 'object' || parsedCodes === null) {
          throw new Error('Parsed codes is not a valid object');
        }

        const extractedCodes = Object.values(parsedCodes);
        setCodesData(extractedCodes.length > 0 ? extractedCodes : []);
      } catch (error) {
        console.error("Error parsing codes:", error);
        setCodesData([]);
      }
    }
  }, [localState.codes]);

  const normalizedCodes =
    Array.isArray(codesData) && codesData.length === 1 && Array.isArray(codesData[0])
      ? codesData[0]
      : codesData;

  const copyToClipboard = (code) => {
    triggerHapticFeedback('impactLight');
    Clipboard.setString(code);
    showSuccessMessage(t("value.copy"), t("value.copy_success"));
    mixpanel.track("Code Copy", { Code: code });
  };

  const renderCodeItem = ({ item }) => (
    <View style={[styles.codeItem, { backgroundColor: isDarkMode ? '#1e293b' : '#fff' }]}>
      <View style={styles.codeHeader}>
        <Icon name="gift-outline" size={20} color={config.colors.primary} />
        <Text style={[styles.codeText, { color: isDarkMode ? '#fff' : '#000' }]}>
          {item.code}
        </Text>
      </View>
      <Text style={[styles.rewardText, { color: isDarkMode ? '#aaa' : '#666' }]}>
        {item.reward}
      </Text>
      <TouchableOpacity
        onPress={() => copyToClipboard(item.code)}
        style={styles.copyButton}
        activeOpacity={0.7}
      >
        <Icon name="copy-outline" size={16} color="#fff" />
        <Text style={styles.copyButtonText}>{t("value.copy") || "Copy"}</Text>
      </TouchableOpacity>
    </View>
  );

  const renderEmptyState = () => (
    <View style={styles.emptyContainer}>
      <Icon name="code-slash-outline" size={60} color={isDarkMode ? '#555' : '#ccc'} />
      <Text style={[styles.emptyText, { color: isDarkMode ? '#888' : '#666' }]}>
        No codes available
      </Text>
    </View>
  );

  return (
    <View style={[styles.container, { backgroundColor: isDarkMode ? '#0f172a' : '#f5f5f5' }]}>
      <FlatList
        data={normalizedCodes}
        keyExtractor={(item, index) => index.toString()}
        renderItem={renderCodeItem}
        contentContainerStyle={styles.listContainer}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={renderEmptyState}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  listContainer: {
    padding: 12,
    paddingBottom: 40,
    flexGrow: 1,
  },
  codeItem: {
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
  },
  codeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  codeText: {
    fontSize: 16,
    fontWeight: 'bold',
    marginLeft: 10,
  },
  rewardText: {
    fontSize: 14,

    marginBottom: 12,
    marginLeft: 30,
  },
  copyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: config.colors.primary,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignSelf: 'flex-start',
    marginLeft: 30,
  },
  copyButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
    marginLeft: 6,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: 60,
  },
  emptyText: {
    fontSize: 16,

    marginTop: 12,
  },
});

export default CodesScreen;
