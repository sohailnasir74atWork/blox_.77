import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, Modal, ScrollView, Image, StyleSheet } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useHeaderHeight } from '@react-navigation/elements';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import LinearGradient from 'react-native-linear-gradient';

import TradeList from './Trades';
import { useHaptic } from '../Helper/HepticFeedBack';
import PrivateChatScreen from '../ChatScreen/PrivateChat/PrivateChat';
import PrivateChatHeader from '../ChatScreen/PrivateChat/PrivateChatHeader';
import { useTranslation } from 'react-i18next';
import Icon from 'react-native-vector-icons/Ionicons';
import config from '../Helper/Environment';
import { useGlobalState } from '../GlobelStats';
import ServerScreen from './Server';
import { useNavigation } from '@react-navigation/native';

const Stack = createNativeStackNavigator();

const TradeRulesModal = ({ visible, onClose }) => {
  const { theme } = useGlobalState();
  const isDarkMode = theme === 'dark';

  return (
    <Modal transparent animationType="fade" visible={visible} onRequestClose={onClose}>
      <View style={styles.modalBackground}>
        <View style={[styles.modalContainer, { backgroundColor: isDarkMode ? '#222' : 'white' }]}>
          <View style={styles.modalHeader}>
            <Text style={[styles.modalTitle, { color: isDarkMode ? 'white' : 'black' }]}>
              Trade Rules
            </Text>
            <TouchableOpacity onPress={onClose}>
              <Icon name="close-circle" size={28} color={isDarkMode ? '#bbb' : '#333'} />
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false}>
            <Text style={[styles.modalText, { color: isDarkMode ? '#ccc' : '#333' }]}>
              <Text style={{ fontFamily: 'Lato-Bold' }}>Grow a Garden</Text> does not have an official in-game trading system.{"\n\n"}
              All trades are user-arranged and happen outside the game, so please be cautious.{"\n\n"}
              <Text style={{ fontFamily: 'Lato-Bold' }}>✅ How to Trade:</Text>{"\n"}
              • Use the Grow a Garden Values & Trade App to check item values and create trade offers.{"\n"}
              • Share offers with other players directly through the app or in-game chat.{"\n\n"}
              <Text style={{ fontFamily: 'Lato-Bold' }}>❌ Avoid Scams:</Text>{"\n"}
              • Never give pets or items first without full agreement.{"\n"}
              • Avoid deals that seem too good to be true.{"\n"}
              • Do not share your Roblox password or personal info.{"\n\n"}
              Stay safe. Trade smart.{"\n"}
              <Text style={{ fontStyle: 'italic' }}>We are not responsible for lost items.</Text>
            </Text>
          </ScrollView>

          <TouchableOpacity
            style={[styles.closeButton, { backgroundColor: config.colors.primary }]}
            onPress={onClose}
          >
            <Text style={[styles.closeButtonText, { color: 'white' }]}>Close</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
};

// HOC to wrap screens with a gradient background under header
function withHeaderGradient(Wrapped) {
  return function HeaderGradientScreen(props) {
    const headerHeight = useHeaderHeight();
    const insets = useSafeAreaInsets();
    const topHeight = 110

    return (
      <View style={{ flex: 1 }}>
        {!config.isNoman && (
          <LinearGradient
            colors={['#4c669f', '#3b5998', '#192f5d']}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              height: topHeight,
            }}
            pointerEvents="none"
          />
        )}
        <View style={{ height: topHeight }} />
        <Wrapped {...props} />
      </View>
    );
  };
}

const TradeListScreen = withHeaderGradient(TradeList);
const ServerScreenWithHeader = withHeaderGradient(ServerScreen);
const pvtchatScreenWithHeader = withHeaderGradient(PrivateChatScreen);

export const TradeStack = ({ selectedTheme }) => {
  const [bannedUsers, setBannedUsers] = useState([]);
  const { triggerHapticFeedback } = useHaptic();
  const { t } = useTranslation();
  const [modalVisible, setModalVisible] = useState(false);
  const { theme } = useGlobalState();
  const navigation = useNavigation();

  const headerOptions = useMemo(
    () => ({
      headerTransparent: true,
      headerStyle: { backgroundColor: 'transparent' },
      headerTintColor: !config.isNoman ? 'white'  :  selectedTheme.colors.Text,
      headerTitleStyle: { fontFamily: 'Lato-Bold', fontSize: 24, color: !config.isNoman ? 'white'  :selectedTheme.colors.Text },
    
    }),
    []
  );

  return (
    <>
      <Stack.Navigator screenOptions={headerOptions}>
        <Stack.Screen
          name="TradeScreen"
          component={TradeListScreen}
          initialParams={{ bannedUsers, selectedTheme }}
          options={({ navigation }) => ({
            title: 'Trading Feed',
            headerTitleAlign:config.isNoman ? 'left' : 'center',
            headerRight: config.isNoman ? () => (
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <TouchableOpacity
                  onPress={() => navigation.navigate('Server')}
                  style={{
                    marginRight: 6,
                    backgroundColor: config.colors.hasBlockGreen,
                    borderRadius: 6,
                    flexDirection: 'row',
                    alignItems: 'center',
                    paddingHorizontal: 8,
                    paddingVertical: 4,
                  }}
                >
                  <Image
                    source={require('../../assets/roblox.png')}
                    style={{ width: 20, height: 25, tintColor: 'white' }}
                    resizeMode="contain"
                  />
                  <Text style={{ color: 'white', fontFamily: 'Lato-Bold', marginLeft: 6 }}>
                    Pvt Servers
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity onPress={() => setModalVisible(true)} style={{ marginRight: 8 }}>
                  <Icon name="information-circle-outline" size={24} color={!config.isNoman ? 'white'  :selectedTheme.colors.Text} />
                </TouchableOpacity>
              </View>
            ) : null,
          })}
        />

        <Stack.Screen
          name="PrivateChatTrade"
          component={pvtchatScreenWithHeader}
          initialParams={{ bannedUsers }}
          options={({ route }) => {
            const { selectedUser, isOnline } = route.params || {};
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

        <Stack.Screen
          name="Server"
          component={ServerScreenWithHeader}
          options={{ title: 'Private Servers' }}
          initialParams={{ selectedTheme }}
        />
      </Stack.Navigator>

      <TradeRulesModal visible={modalVisible} onClose={() => setModalVisible(false)} />
    </>
  );
};

const styles = StyleSheet.create({
  modalBackground: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  modalContainer: {
    width: '98%',
    maxHeight: '90%',
    padding: 20,
    borderRadius: 15,
    alignItems: 'center',
    elevation: 10,
  },
  modalHeader: {
    flexDirection: 'row',
    width: '100%',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  modalTitle: {
    fontSize: 20,
    fontFamily: 'Lato-Bold',
  },
  modalText: {
    fontSize: 14,
    textAlign: 'left',
    fontFamily: 'Lato-Regular',
    lineHeight: 24,
  },
  closeButton: {
    width: '100%',
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  closeButtonText: {
    fontSize: 16,
    fontFamily: 'Lato-Bold',
  },
  highlightedText: {
    fontFamily: 'Lato-Bold',
    color: config.colors.primary,
  },
});

export default TradeStack;
