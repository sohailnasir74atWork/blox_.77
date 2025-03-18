import React, { useState } from 'react';
import { TouchableOpacity } from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import RewardRulesModal from '../RewardRulesModel';
import { useGlobalState } from '../../GlobelStats';

export const RewardCenterOptions = ({ navigation }) => {
  const [modalVisible, setModalVisible] = useState(false);
  const { theme } = useGlobalState();
  const isDarkMode = theme === 'dark';

  return {
    title: "Reward Center",
    headerStyle: { backgroundColor: isDarkMode ? '#111' : '#f5f5f5' },
    headerTintColor: isDarkMode ? 'white' : 'black',
    headerRight: () => (
      <TouchableOpacity onPress={() => setModalVisible(true)} style={{ marginRight: 16 }}>
        <Icon name="information-circle-outline" size={24} color={isDarkMode ? 'white' : 'black'} />
      </TouchableOpacity>
    ),
    // Render the modal separately, not inside `children`
    headerShown: true,
    children: (
      <RewardRulesModal visible={modalVisible} onClose={() => setModalVisible(false)} />
    ),
  };
};
