import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  FlatList,
  Image,
  Modal,
  Pressable,
  KeyboardAvoidingView,
} from 'react-native';

export default function EditProfileModal({
  visible,
  onClose,
  newDisplayName,
  setNewDisplayName,
  selectedImage,
  setSelectedImage,
}) {
  const imageOptions = [
    require('../Avtar/display-pic.png'),
    require('../Avtar/eagle.png'),
    require('../Avtar/patch.png'),
    require('../Avtar/pirate1.png'),
  ];

  const handleSave = () => {
    onClose();
    alert('Profile changes saved!');
  };

  return (
    <Modal
      animationType="slide"
      transparent={true}
      visible={visible}
      onRequestClose={onClose}
    >
      <Pressable
        style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' }}
        onPress={onClose}
      />
             <KeyboardAvoidingView
        style={{ flex: 1, justifyContent: 'flex-end' }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={60} // Adjust offset as needed
      >

      <View
        style={{
          backgroundColor: '#fff',
          padding: 20,
          borderTopLeftRadius: 20,
          borderTopRightRadius: 20,
        }}
      >
        <Text style={{ fontSize: 18, fontWeight: '600', marginBottom: 15 }}>
          Edit Profile
        </Text>

        {/* Name Input */}
        <Text style={{ fontSize: 16, marginBottom: 10 }}>Change Display Name</Text>
        <TextInput
          style={{
            backgroundColor: '#f2f2f7',
            padding: 10,
            borderRadius: 5,
            marginBottom: 20,
          }}
          placeholder="Enter new display name"
          value={newDisplayName}
          onChangeText={setNewDisplayName}
        />

        {/* Profile Image Selection */}
        <Text style={{ fontSize: 16, marginBottom: 10 }}>Select Profile Icon</Text>
        <FlatList
          data={imageOptions}
          keyExtractor={(item, index) => index.toString()}
          horizontal
          renderItem={({ item }) => (
            <TouchableOpacity onPress={() => setSelectedImage(item)}>
              <Image
                source={item}
                style={{
                  width: 60,
                  height: 60,
                  borderRadius: 30,
                  marginHorizontal: 10,
                  borderWidth: item === selectedImage ? 2 : 0,
                  borderColor: '#007BFF',
                }}
              />
            </TouchableOpacity>
          )}
        />

        <TouchableOpacity
          style={{
            backgroundColor: '#007BFF',
            padding: 10,
            borderRadius: 5,
            marginTop: 20,
          }}
          onPress={handleSave}
        >
          <Text style={{ color: '#fff', textAlign: 'center' }}>Save Changes</Text>
        </TouchableOpacity>
      </View>
      </KeyboardAvoidingView>

    </Modal>
  );
}
