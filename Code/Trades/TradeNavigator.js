import React, {  useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, Modal, StyleSheet, ScrollView, Image } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
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

const HighlightedText = ({ text }) => {
  return (
    <Text style={styles.highlightedText}>{text}</Text>
  );
};

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
              1. Players can trade <HighlightedText text="up to 4 items" /> per trade.{"\n"}{"\n"}
              2. A maximum of <HighlightedText text="5 trades" /> is allowed every <HighlightedText text="8 hours" />.{"\n"}{"\n"}
              3. <HighlightedText text="Game Passes & Permanent Fruits" /> cannot be traded if the receiver already owns them.{"\n"}{"\n"}
              4. To trade <HighlightedText text="Game Passes & Permanent Fruits" />, they must first be stored by gifting them to yourself.{"\n"}{"\n"}
              5. The total value difference between traded fruits <HighlightedText text="cannot exceed 40%" />, but adding Robux items can increase it to <HighlightedText text="80-100%" />.{"\n"}{"\n"}
              6. Players can store <HighlightedText text="only one of each fruit" /> unless they purchase <HighlightedText text="+1 Fruit Storage (R$ 400)" />.{"\n"}{"\n"}
              7. Once stored in the inventory, <HighlightedText text="fruits cannot be dropped" />.{"\n"}
            </Text>
          </ScrollView>
          <TouchableOpacity
            style={[styles.closeButton, { backgroundColor: config.colors.primary }]}
            onPress={onClose}
          >
            <Text style={[styles.closeButtonText, { color: isDarkMode ? 'white' : 'white' }]}>Close</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
};

export const TradeStack = ({ selectedTheme }) => {
  const [bannedUsers, setBannedUsers] = useState([]);
  const { triggerHapticFeedback } = useHaptic();
  const { t } = useTranslation();
  const [modalVisible, setModalVisible] = useState(false);
  const { theme } = useGlobalState();
  const isDarkMode = theme === 'dark';
  const navigation = useNavigation()


  const headerOptions = useMemo(
    () => ({
      headerStyle: { backgroundColor: selectedTheme.colors.background },
      headerTintColor: selectedTheme.colors.text,
      headerTitleStyle: { fontFamily: 'Lato-Bold', fontSize: 24 },
    }),
    [selectedTheme]
  );

  return (
    <>
      <Stack.Navigator screenOptions={headerOptions}>
        {/* Trade List Screen with Trade Rules Button */}
        <Stack.Screen
          name="TradeScreen"
          component={TradeList}
          initialParams={{ bannedUsers, selectedTheme }}
          options={({ navigation }) => ({
            title: t("tabs.trade"),
            headerRight: () => (
              <View style={{ flexDirection: 'row', }}>
                <TouchableOpacity onPress={() => navigation.navigate('Server')} style={{ marginRight: 5, backgroundColor:config.colors.hasBlockGreen, borderRadius:5, flexDirection:'row', alignItems:'center', paddingHorizontal:5}}>
                  <Image
                    source={
                      isDarkMode
                        ? require('../../assets/roblox.png')
                        : require('../../assets/roblox.png')
                    }
                    style={{
                      width: 20,
                      height:25,
                      // transform: [{ scale: 1.2 }],
                      tintColor: config.colors.white,
                      justifyContent:'center',
                      alignItems:'center'
                    }}
                    resizeMode="contain"
                  />
                  <Text style={{color:'white', fontFamily:'Lato-Bold' }}>Pvt Servers</Text>
                </TouchableOpacity>
          
                <TouchableOpacity onPress={() => setModalVisible(true)} style={{ marginRight: 8 }}>
                  <Icon
                    name="information-circle-outline"
                    size={24}
                    color={config.colors.primary}
                  />
                </TouchableOpacity>
              </View>
            ),
          })}
          
        />

        {/* Private Chat Screen */}
        <Stack.Screen
          name="PrivateChatTrade"
          component={PrivateChatScreen}
          initialParams={{ bannedUsers }}
          options={({ route }) => {
            const { selectedUser, isOnline } = route.params;
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
          component={ServerScreen}
         
        />
      </Stack.Navigator>

      {/* Trade Rules Modal */}
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
  highlightedText: {
    fontFamily: 'Lato-Bold',
    color: config.colors.primary,
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
});

export default TradeStack;
