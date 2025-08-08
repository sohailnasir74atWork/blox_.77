import React, { useEffect } from 'react';
import { View, Text, TouchableOpacity, Image, StyleSheet, useColorScheme } from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { get, ref } from '@react-native-firebase/database';
import config from '../../Helper/Environment';
import StyledDisplayName from '../Store/NameDisplayReUser';
import { useLocalState } from '../../LocalGlobelStats';
import { useGlobalState } from '../../GlobelStats';

const UserProfileSection = ({
  user,
  currentUser,
  setOpenSignin,
  setHasClaimed,
  appdatabase, // Firebase database instance
}) => {
  const {theme} = useGlobalState()  
  const isDarkMode = theme === 'dark'
  const styles = getStyles(isDarkMode);
  const {localState} = useLocalState()

  useEffect(() => {
    const checkClaimStatus = async () => {
      if (!currentUser?.id) return;

      try {
        const claimRef = ref(appdatabase, `/reward/${currentUser.id}`);
        const snapshot = await get(claimRef);
        setHasClaimed(snapshot.exists());
      } catch (error) {
        console.error('Error checking claim status:', error);
      }
    };

    checkClaimStatus();
  }, [currentUser?.id, appdatabase]);

  // console.log(currentUser, 'cu')

  return (
    <View style={styles.userSection}>
      <Image
        source={{
          uri:
            currentUser?.avatar ||
            'https://bloxfruitscalc.com/wp-content/uploads/2025/placeholder.png',
        }}
        style={styles.profilePic}
      />

      <TouchableOpacity
        style={{ flex: 1 }}
        disabled={currentUser?.id !== null}
        onPress={() => setOpenSignin(true)}
      >
        {currentUser.id  &&
        <StyledDisplayName
        user={currentUser}
        localState={localState}
        displayName={currentUser?.displayName || currentUser?.displayname || 'Guest'}
        fontSize={16}
        lineHeight={16}
        marginVertical={1}
      />}
    

{!currentUser?.id  && <Text style={styles.userNameLogout}>
          {'Login / Register'}{' '}
         
        </Text>}
        <Text style={styles.userStatus}>
          {!currentUser?.id
            ? 'Login to participate'
            : user?.isPro
            ? 'Pro Member'
            : 'Free Member'}
        </Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.claimButton} disabled={true}>
        <Text style={styles.claimText}>{user?.coins || 0}</Text>
        <Image source={require('../../../assets/money-bag.png')} style={{ width: 15, height: 15, marginLeft:5 }} />
      </TouchableOpacity>
    </View>
  );
};

const getStyles = (isDarkMode) =>
  StyleSheet.create({
    userSection: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: isDarkMode ? '#2c3e50' : '#f2f2f7',
      padding: 10,
      borderRadius: 10,
      marginBottom: 10,
    },
    profilePic: {
      width: 50,
      height: 50,
      borderRadius: 25,
      marginRight: 10,
      borderWidth: 1,
      borderColor: '#ccc',
    },
    userName: {
      fontSize: 16,
      fontWeight: 'bold',
      color: isDarkMode ? '#fff' : '#000',
    },
    userNameLogout: {
      fontSize: 16,
      fontWeight: 'bold',
      color: '#007BFF',
    },
    userStatus: {
      fontSize: 13,
      color: isDarkMode ? '#ccc' : '#555',
    },
    claimButton: {
      backgroundColor: '#6A5ACD',
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 8,
      marginLeft: 10,
      flexDirection:'row',
      // justifyContent:'center',
      alignItems:'center'
    },
    claimText: {
      color: '#fff',
      fontWeight: 'bold',
      fontSize: 13,
    },
  });

export default UserProfileSection;
