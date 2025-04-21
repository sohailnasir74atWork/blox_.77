import React, { useEffect } from 'react';
import { View, Text, TouchableOpacity, Image } from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { get, ref } from '@react-native-firebase/database';
import config from '../../Helper/Environment';

const UserProfileSection = ({ 
    user, 
    currentUser, 
    setOpenSignin, 
    handleClaimReward, 
    latestWinner, 
    styles,
    hasClaimed, 
    setHasClaimed,
    appdatabase // 🔥 Pass Firebase database instance
}) => {

    useEffect(() => {
        const checkClaimStatus = async () => {
            if (!currentUser?.id) return;

            try {
                const claimRef = ref(appdatabase, `/reward/${currentUser.id}`);
                const snapshot = await get(claimRef);
                setHasClaimed(snapshot.exists()); // 🔥 Update state if reward has been claimed
            } catch (error) {
                console.error("Error checking claim status:", error);
            }
        };

        checkClaimStatus();
    }, [currentUser?.id, appdatabase]); // ✅ Runs when user logs in or database updates

    return (
        <View style={styles.userSection}>
            <Image
                source={{ uri: currentUser?.avatar || 'https://bloxfruitscalc.com/wp-content/uploads/2025/placeholder.png' }}
                style={styles.profilePic}
            />
            
            <TouchableOpacity 
                style={{ flex: 1 }} 
                disabled={currentUser?.id !== null} 
                onPress={() => setOpenSignin(true)}
            >
                <Text style={currentUser?.id ? styles.userName : styles.userNameLogout}>
                    {currentUser?.id ? currentUser?.displayName || 'Anonymous' : 'Login / Register'}
                    {currentUser?.id && user.isPro && (
                        <Icon name="checkmark-done-circle" size={16} color={config.colors.hasBlockGreen} />
                    )}
                </Text>
                <Text style={styles.userStatus}>
                    {!currentUser?.id
                        ? 'Login to participate'
                        : user.isPro
                            ? 'Pro Member'
                            : 'Enroll & Win Prize'}
                </Text>
            </TouchableOpacity>

            {/* If user is not logged in, show nothing */}
            {!currentUser || !currentUser.id ? (
                <></>
            ) : latestWinner?.id === currentUser?.id ? (
                // If user is the latest winner, show "Claim Reward" or "Claimed" based on status
                <TouchableOpacity 
    style={[styles.claimButton]} 
    onPress={async () => {
        const success = await handleClaimReward();
        if (success) setHasClaimed(true); // ✅ Immediately update UI
    }} 
    disabled={hasClaimed} // 🔥 Disable button if claimed
>
    <Text style={styles.claimText}>{hasClaimed ? "In Process" : "Claim Reward"}</Text>
</TouchableOpacity>

            ) : (
                // If user is Pro, show "Auto Enrolled"
                user.isPro && (
                    <View style={[styles.participateButton, { backgroundColor: config.colors.hasBlockGreen, opacity:.5 }]}>
                        <Text style={styles.participateText}>Auto Enrolled</Text>
                    </View>
                )
            )}
        </View>
    );
};

export default UserProfileSection;
