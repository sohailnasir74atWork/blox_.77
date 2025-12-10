import React from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  View,
  Dimensions,
} from 'react-native';
import ValueScreen from '../../ValuesScreen/ValueScreen';
import { useGlobalState } from '../../GlobelStats';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

const PetModal = ({ fromChat, visible, selectedFruits, setSelectedFruits , fromSetting, ownedPets, setOwnedPets, wishlistPets, setWishlistPets, onClose, owned, }) => {

  const {theme} = useGlobalState()
  const isDark = theme == 'dark'
  return (

    <Modal
      transparent
      animationType="slide"   // uses RN default slide animation
      visible={visible}
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        {/* Background – tap to close */}
        <Pressable style={styles.backdrop} onPress={onClose} />

        {/* Bottom drawer */}
        <View style={[styles.drawer, {backgroundColor: !isDark ? 'white' : 'black'}]}>
          <ValueScreen fromChat={fromChat} selectedFruits={selectedFruits} setSelectedFruits={setSelectedFruits} onRequestClose={onClose} fromSetting={fromSetting} owned={owned} ownedPets={ownedPets} setOwnedPets={setOwnedPets} wishlistPets={wishlistPets} setWishlistPets={setWishlistPets}/>
        </View>
      </View>
    </Modal>
  );
};

export default PetModal;

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end', // drawer from bottom
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  drawer: {
    height: 500,
    // backgroundColor: '#fff',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingBottom: 16,
    paddingTop: 8,
    paddingHorizontal: 12,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: -2 },
    elevation: 10,
  },
});
