import React, { useState, useEffect, useMemo } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, Image, Modal, Platform } from 'react-native';
import config from '../Helper/Environment';
import { useGlobalState } from '../GlobelStats';
import SignInDrawer from '../Firebase/SigninDrawer';
import { useLocalState } from '../LocalGlobelStats';
import SubscriptionScreen from './OfferWall';
import { ref } from '@react-native-firebase/database';
import { GestureHandlerRootView, TextInput } from 'react-native-gesture-handler';
import  { showMessage } from 'react-native-flash-message';
import Icon from 'react-native-vector-icons/Ionicons';


// Countdown Timer
// const targetDate = new Date();
// targetDate.setMonth(targetDate.getMonth() + 1);
// targetDate.setDate(1);
// targetDate.setHours(0, 0, 0, 0);

const RewardCenterScreen = ({ selectedTheme }) => {
    const [countdown, setCountdown] = useState('');
    const { user, appdatabase, isAdmin } = useGlobalState();
    const currentUser = user || null;  // Ensures user is properly handled
    const [openSingnin, setOpenSignin] = useState(false);
    const [showOfferWall, setShowofferWall] = useState(false);
    const { localState } = useLocalState()
    const [isClaimModalVisible, setIsClaimModalVisible] = useState(false);
    const [targetDate, setTargetDate] = useState(null); // Store target date from Firebase
    const [email, setEmail] = useState('');
    const [robloxId, setRobloxId] = useState('');
    const [latestWinner, setLatestWinner] = useState();

    const [prize, setPrize] = useState({
        name: 'Robux',
        value: '1000',
        image: 'https://bloxfruitsvalues.com/_next/image?url=%2F_next%2Fstatic%2Fmedia%2FRobux.8647bbaa.webp&w=48&q=75',
    });
    const [previousWinners, setPreviousWinners] = useState([]);
    const [isAdminModalVisible, setIsAdminModalVisible] = useState(false);
    const [isAdminPrizeModalVisible, setIsAdminPrizeModalVisible] = useState(false);
    const [nextTargetDate, setNextTargetDate] = useState(new Date().toISOString().split('T')[0]); // Default Today
    const [prizeName, setPrizeName] = useState('');
    const [prizeValue, setPrizeValue] = useState('');
    const [prizeImage, setPrizeImage] = useState('');
    const [winnerName, setWinnerName] = useState('');
    const [winnerId, setWinnerId] = useState('');
    const [winnerPrize, setWinnerPrize] = useState('');
    const [winnerDate, setWinnerDate] = useState(new Date().toISOString().split('T')[0]);

    const handleSubmitWinner = async () => {
        if (!winnerName || !winnerId || !winnerPrize || !winnerDate) {
            // alert("All fields are required!");
            showMessage({
                message: 'Error',
                description: 'All fileds are required',
                type: "danger",
            });
            return;
        }

        try {
            // Save the winner to Firebase
            const winnerRef = ref(appdatabase, `winners/${winnerId}`);
            await winnerRef.set({
                id: winnerId,
                name: winnerName,
                prize: winnerPrize,
                date: winnerDate,
            });

            // alert("Winner submitted successfully!");
            showMessage({
                message: 'Success',
                description: 'Winner submitted successfully!',
                type: "success",
            });
            setIsAdminModalVisible(false);
            setWinnerName('');
            setWinnerId('');
            setWinnerPrize('');
            setWinnerDate(new Date().toISOString().split('T')[0]);
        } catch (error) {
            console.error("Error submitting winner:", error);
            // alert("Something went wrong!");
            showMessage({
                message: 'Error',
                description: '"Something went wrong!',
                type: "danger",
            });
        }
    };

    const handleSubmitPrize = async () => {
        // if (!nextTargetDate || !prizeName || !prizeValue || !prizeImage) {
        //     showMessage({
        //         message: 'Error',
        //         description: 'All fields are required!',
        //         type: "danger",
        //     });
        //     return;
        // }

        try {
            // Update Prize Information
            const prizeRef = ref(appdatabase, 'prize');
            await prizeRef.set({
                name: prizeName,
                value: prizeValue,
                image: prizeImage,
                targetDate: nextTargetDate,
            });

            showMessage({
                message: 'Success',
                description: 'Prize and Target Date Updated!',
                type: "success",
            });

            setIsAdminPrizeModalVisible(false);
            setPrizeName('');
            setPrizeValue('');
            setPrizeImage('');
            setNextTargetDate(new Date().toISOString().split('T')[0]);

        } catch (error) {
            showMessage({
                message: 'Error',
                description: 'Something went wrong!',
                type: "danger",
            });
        }
    };


    const handleEnrole = () => {
        if (!localState.isPro) {
            setShowofferWall(true)
        } else
            console.log('user is pro')
    }
    const handleClaimReward = () => {
        setIsClaimModalVisible(true);
    };

    // Function to submit claim
    const submitClaim = async () => {
        if (!email || !robloxId) {
            // Alert.alert('Error', 'Please fill all fields!');
            showMessage({
                message: 'Error',
                description: 'Please fill all fields!',
                type: "danger",
            });
            return;
        }

        try {
            // Save data to Firebase under 'rewards'
            await appdatabase.ref(`reward/${user?.id}`).set({
                email,
                robloxId,
                prize: latestWinner.prize,
                date: new Date().toISOString(),
            });

            // Alert.alert('Success', 'Your reward claim has been submitted!');
            showMessage({
                message: 'Success',
                description: 'Your reward claim has been submitted!',
                type: "success",
            });
            setIsClaimModalVisible(false);
            setEmail('');
            setRobloxId('');
        } catch (error) {
            showMessage({
                message: 'Error',
                description: '"Something went wrong!',
                type: "danger",
            });
        }
    };


    useEffect(() => {
        if (!targetDate) return;

        const interval = setInterval(() => {
            const now = new Date();
            const timeDiff = targetDate - now;

            if (timeDiff > 0) {
                const days = Math.floor(timeDiff / (1000 * 60 * 60 * 24));
                const hours = Math.floor((timeDiff / (1000 * 60 * 60)) % 24);
                const minutes = Math.floor((timeDiff / (1000 * 60)) % 60);
                const seconds = Math.floor((timeDiff / 1000) % 60);

                // Ensure two-digit formatting for all values
                const formatNumber = (num) => String(num).padStart(2, '0');

                setCountdown(`${formatNumber(days)} : ${formatNumber(hours)} : ${formatNumber(minutes)} : ${formatNumber(seconds)} Hrs`);
            } else {
                setCountdown('Announcing soon...');
            }
        }, 1000);

        return () => clearInterval(interval);
    }, [targetDate]); // Runs whenever targetDate updates

    useEffect(() => {
        const prizeRef = ref(appdatabase, 'prize');

        prizeRef.on('value', (snapshot) => {
            if (snapshot.exists()) {
                const data = snapshot.val();
                setPrize(data);
                if (data.targetDate) {
                    setTargetDate(new Date(data.targetDate)); // Convert to Date object
                }
            }
        });

        return () => prizeRef.off(); // Cleanup listener on unmount
    }, [appdatabase]);


    useEffect(() => {
        const prizeRef = ref(appdatabase, 'prize');

        const fetchPrize = async () => {
            try {
                prizeRef.on('value', (snapshot) => {
                    if (snapshot.exists()) {
                        setPrize(snapshot.val());
                    }
                });
            } catch (error) {
                console.error("Error fetching prize:", error);
            }
        };

        fetchPrize();

        return () => prizeRef.off(); // Cleanup on unmount
    }, [appdatabase]);

    console.log(user.id, Platform.OS)

    useEffect(() => {
        const winnersRef = ref(appdatabase, 'winners');

        const fetchWinners = async () => {
            try {
                winnersRef.on('value', (snapshot) => {
                    if (snapshot.exists()) {
                        const data = snapshot.val();
                        const winnersArray = Object.keys(data).map((key) => ({
                            id: key,
                            ...data[key],
                        }));

                        winnersArray.sort((a, b) => new Date(b.date) - new Date(a.date));

                        // Update latest winner and previous winners
                        if (winnersArray.length > 0) {
                            setLatestWinner(winnersArray[0]); // Most recent winner
                            setPreviousWinners(winnersArray.slice(1)); // Others
                        }
                    }
                });
            } catch (error) {
                console.error("Error fetching winners:", error);
            }
        };

        fetchWinners();
        return () => winnersRef.off();
    }, [appdatabase]);
    useEffect(() => {
        const prizeRef = ref(appdatabase, 'prize');

        prizeRef.on('value', (snapshot) => {
            if (snapshot.exists()) {
                const data = snapshot.val();
                setPrize(data);
                if (data.nextTargetDate) {
                    setNextTargetDate(data.nextTargetDate);
                }
            }
        });

        return () => prizeRef.off();
    }, [appdatabase]);


console.log(currentUser)

    return (
        <GestureHandlerRootView>
            <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>

                {/* User Profile Section */}
                <View style={styles.userSection}>
    <Image
        source={{ uri: currentUser?.avatar || 'https://bloxfruitscalc.com/wp-content/uploads/2025/placeholder.png' }}
        style={styles.profilePic}
    />
    <TouchableOpacity style={{ flex: 1 }} disabled={currentUser.id !== null} onPress={() => setOpenSignin(true)}>
        <Text style={currentUser?.id ? styles.userName : styles.userNameLogout}>
            {currentUser?.id ? currentUser?.displayName || 'Anonymous' : 'Login / Register'}
            {currentUser?.id && localState.isPro && (
                <Icon name="checkmark-done-circle" size={16} color={config.colors.hasBlockGreen} />
            )}
        </Text>
        <Text style={styles.userStatus}>
            {!currentUser?.id
                ? 'Login to participate'
                : localState.isPro
                ? 'Pro Member'
                : 'Enroll & Win 1000 Roblox Every Month'}
        </Text>
    </TouchableOpacity>

    {!currentUser || !currentUser.id ? (
       <></>
    ) : latestWinner?.id === currentUser?.id ? (
        <TouchableOpacity style={styles.claimButton} onPress={handleClaimReward}>
            <Text style={styles.claimText}>Claim Reward</Text>
        </TouchableOpacity>
    ) : (
        <TouchableOpacity
            style={[
                styles.participateButton,
                { backgroundColor: localState.isPro ? config.colors.hasBlockGreen : config.colors.wantBlockRed }
            ]}
            onPress={handleEnrole}
        >
            <Text style={styles.participateText}>{localState.isPro ? 'Enrolled' : 'Enroll'}</Text>
        </TouchableOpacity>
    )}
</View>

                {isAdmin && (
                    <TouchableOpacity style={styles.adminButton} onPress={() => setIsAdminModalVisible(true)}>
                        <Text style={styles.adminText}>Submit Winner</Text>
                    </TouchableOpacity>
                )}
                {isAdmin && (
                    <TouchableOpacity style={styles.adminButton} onPress={() => setIsAdminPrizeModalVisible(true)}>
                        <Text style={styles.adminText}>Edit Prize & Target Date</Text>
                    </TouchableOpacity>
                )}

                {/* Prize Countdown */}
                <View style={styles.timerCard}>
                    <Text style={styles.timerTitle}>Next Prize in:</Text>
                    <Text style={[styles.timerText, { fontSize: 24, lineHeight: 32 }]}>{countdown || 'COMING SOON'}</Text>
                </View>

                {/* Prize Section - Dynamic */}
                {/* Prize Section - Dynamic */}
                <View style={[styles.timerCard, { backgroundColor: config.colors.hasBlockGreen }]}>
                    <Text style={styles.timerTitle}>Prize</Text>
                    {prize.image ? (
                        <Image source={{ uri: prize.image }} style={styles.prizeImage} />
                    ) : (
                        <Text style={styles.placeholderText}>No prize image available</Text>
                    )}
                    <Text style={styles.timerText}>{prize.value} {prize.name}</Text>
                </View>


                {/* Winner Announcement */}
                {/* Winner Announcement */}
                <View style={styles.winnerCard}>
                    <Text style={styles.winnerTitle}>🏆 Last Winner!</Text>
                    {!latestWinner ? (
                        <View style={styles.placeholder}>
                            <Text style={styles.placeholderText}>No winner yet! Be the first to win 🏆</Text>
                        </View>
                    ) : (
                        <>
                            <Text style={styles.winnerName}>{latestWinner.name}</Text>
                            <Text style={styles.winnerPrize}>{latestWinner.prize}</Text>
                            <Text style={styles.winnerDate}>Won on {new Date(latestWinner.date).toDateString()}</Text>
                        </>
                    )}
                </View>




                {/* Previous Winners Section */}
                <Text style={styles.sectionTitle}>🏅 Previous Winners</Text>
                {previousWinners.length > 0 ? (
                    previousWinners.map((winner) => (
                        <View key={winner.id} style={styles.historyCard}>
                            <View>
                                <Text style={styles.historyName}>{winner.name}</Text>
                                <Text style={styles.historyDate}>{new Date(winner.date).toDateString()}</Text>
                            </View>
                            <Text style={styles.historyPrize}>{winner.prize}</Text>
                        </View>
                    ))
                ) : (
                    <View style={styles.placeholder}>
                        <Text style={styles.placeholderText}>No winners yet! Participate and be the first to win 🏆</Text>
                    </View>
                )}

                <SignInDrawer
                    visible={openSingnin}
                    onClose={() => setOpenSignin(false)}
                    selectedTheme={selectedTheme}
                    message='To participate in rewards you needs to sigin'
                />
                <SubscriptionScreen visible={showOfferWall} onClose={() => setShowofferWall(false)} />
                {/* Claim Reward Modal */}
                <Modal visible={isClaimModalVisible} transparent animationType="slide">
                    <View style={styles.modalContainer}>
                        <View style={styles.modalContent}>
                            <Text style={styles.modalTitle}>Claim Your Reward</Text>

                            {/* Email Input */}
                            <TextInput
                                style={styles.input}
                                placeholder="Enter Your Email"
                                keyboardType="email-address"
                                value={email}
                                onChangeText={setEmail}
                            />

                            {/* Roblox ID Input */}
                            <TextInput
                                style={styles.input}
                                placeholder="Enter Your Roblox ID"
                                value={robloxId}
                                onChangeText={setRobloxId}
                            />

                            {/* Submit Button */}
                            <TouchableOpacity style={styles.submitButton} onPress={submitClaim}>
                                <Text style={styles.submitText}>Submit</Text>
                            </TouchableOpacity>

                            {/* Close Button */}
                            <TouchableOpacity style={styles.closeButton} onPress={() => setIsClaimModalVisible(false)}>
                                <Text style={styles.closeText}>Close</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                </Modal>
                {/* Admin Winner Submission Modal */}
                <Modal visible={isAdminModalVisible} transparent animationType="slide">
                    <View style={styles.modalContainer}>
                        <View style={styles.modalContent}>
                            <Text style={styles.modalTitle}>Submit Winner</Text>

                            {/* Winner Name */}
                            <TextInput
                                style={styles.input}
                                placeholder="Winner Roblux ID"
                                value={winnerName}
                                onChangeText={setWinnerName}
                            />

                            {/* Winner ID */}
                            <TextInput
                                style={styles.input}
                                placeholder="Winner ID"
                                value={winnerId}
                                onChangeText={setWinnerId}
                            />

                            {/* Winner Prize */}
                            <TextInput
                                style={styles.input}
                                placeholder="Prize (e.g., 1000 Robux)"
                                value={winnerPrize}
                                onChangeText={setWinnerPrize}
                            />

                            {/* Winner Date */}
                            <TextInput
                                style={styles.input}
                                placeholder="Date (YYYY-MM-DD)"
                                value={winnerDate}
                                onChangeText={setWinnerDate}
                            />

                            {/* Submit Button */}
                            <TouchableOpacity style={styles.submitButton} onPress={handleSubmitWinner}>
                                <Text style={styles.submitText}>Submit</Text>
                            </TouchableOpacity>

                            {/* Close Button */}
                            <TouchableOpacity style={styles.closeButton} onPress={() => setIsAdminModalVisible(false)}>
                                <Text style={styles.closeText}>Close</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                </Modal>
                {/* Admin Prize & Target Date Modal */}
                <Modal visible={isAdminPrizeModalVisible} transparent animationType="slide">
                    <View style={styles.modalContainer}>
                        <View style={styles.modalContent}>
                            <Text style={styles.modalTitle}>Set Prize & Target Date</Text>

                            {/* Target Date Input */}
                            <TextInput
                                style={styles.input}
                                placeholder="Target Date (YYYY-MM-DD)"
                                value={nextTargetDate}
                                onChangeText={setNextTargetDate}
                            />

                            {/* Prize Name Input */}
                            <TextInput
                                style={styles.input}
                                placeholder="Prize Name (e.g., Robux)"
                                value={prizeName}
                                onChangeText={setPrizeName}
                            />

                            {/* Prize Value Input */}
                            <TextInput
                                style={styles.input}
                                placeholder="Prize Value (e.g., 1000)"
                                keyboardType="numeric"
                                value={prizeValue}
                                onChangeText={setPrizeValue}
                            />

                            {/* Prize Image URL Input */}
                            <TextInput
                                style={styles.input}
                                placeholder="Prize Image URL"
                                value={prizeImage}
                                onChangeText={setPrizeImage}
                            />

                            {/* Submit Button */}
                            <TouchableOpacity style={styles.submitButton} onPress={handleSubmitPrize}>
                                <Text style={styles.submitText}>Submit</Text>
                            </TouchableOpacity>

                            {/* Close Button */}
                            <TouchableOpacity style={styles.closeButton} onPress={() => setIsAdminPrizeModalVisible(false)}>
                                <Text style={styles.closeText}>Close</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                </Modal>





            </ScrollView></GestureHandlerRootView>
    );
};

// Styles
const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#F5F5F5',
        padding: 14,
    },
    sectionTitle: {
        fontSize: 16,
        fontFamily: 'Lato-Bold',
        color: '#333',
        // marginVertical: 10,
        fontFamily: 'Lato-Regular',
    },

    // User Profile Section
    userSection: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#FFF',
        padding: 15,
        borderRadius: 10,
        marginBottom: 20,
    },
    profilePic: {
        width: 40,
        height: 40,
        borderRadius: 20,
        marginRight: 10,
    },
    userName: {
        fontSize: 14,
        fontFamily: 'Lato-Bold',
        // color: '#333',
    },
    userStatus: {
        fontSize: 10,
        color: '#777',
        fontFamily: 'Lato-Regular',

    },
    participateButton: {
        backgroundColor: '#FF4500',
        paddingVertical: 8,
        paddingHorizontal: 15,
        borderRadius: 6,
    },
    participateText: {
        color: '#FFF',
        fontSize: 12,
        fontFamily: 'Lato-Bold',
    },

    // Countdown Timer
    timerCard: {
        backgroundColor: '#007AFF',
        padding: 14,
        borderRadius: 10,
        alignItems: 'center',
        marginBottom: 10,
        fontFamily: 'Lato-Regular',

    },
    timerTitle: {
        fontSize: 16,
        fontFamily: 'Lato-Bold',
        color: '#FFF',
    },
    timerText: {
        fontSize: 14,
        fontFamily: 'Lato-Bold',
        color: '#FFF',
        marginVertical: 5,
    },
    timerPrize: {
        fontSize: 14,
        color: '#FFF',
        fontFamily: 'Lato-Regular',

    },

    // Winner Announcement
    winnerCard: {
        backgroundColor: '#FFD700',
        padding: 14,
        borderRadius: 10,
        alignItems: 'center',
        marginBottom: 20,
    },
    winnerTitle: {
        fontSize: 16,
        fontFamily: 'Lato-Bold',
        color: '#333',
    },
    winnerName: {
        fontSize: 16,
        fontFamily: 'Lato-Bold',
        color: '#000',
        marginTop: 5,
    },
    winnerPrize: {
        fontSize: 16,
        color: '#555',
        marginTop: 5,
        fontFamily: 'Lato-Regular',

    },
    winnerDate: {
        fontSize: 14,
        color: '#666',
        marginTop: 5,
        fontFamily: 'Lato-Regular',

    },

    // History Section
    historyCard: {
        backgroundColor: '#FFF',
        padding: 15,
        borderRadius: 8,
        marginVertical: 5,
        flexDirection: 'row',
        justifyContent: 'space-between'
    },
    historyName: {
        fontSize: 16,
        fontFamily: 'Lato-Bold',
        color: '#333',
    },
    historyPrize: {
        fontSize: 14,
        color: '#555',
        marginTop: 2,
        fontFamily: 'Lato-Regular',
    },
    historyDate: {
        fontSize: 12,
        color: '#777',
        marginTop: 2,
        fontFamily: 'Lato-Regular',

    },
    placeholder: {
        // backgroundColor: '#FFF',
        padding: 15,
        borderRadius: 8,
        marginVertical: 5,
        alignItems: 'center',
        justifyContent: 'center',
    },
    placeholderText: {
        fontSize: 14,
        color: '#777',
        fontFamily: 'Lato-Regular',
        textAlign: 'center',
    },
    guest: {
        fontSize: 14,
        fontFamily: 'Lato-Bold',
        color: config.colors.secondary,
        lineHeight: 24
    },
    prizeImage: {
        width: 40,
        height: 40,
        borderRadius: 10,
        marginVertical: 5,
    },
    modalContainer: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.5)',
        justifyContent: 'center',
        alignItems: 'center',
    },
    modalContent: {
        backgroundColor: '#FFF',
        padding: 20,
        borderRadius: 10,
        width: '80%',
        alignItems: 'center',
    },
    modalTitle: {
        fontSize: 14,
        fontWeight: 'bold',
        marginBottom: 10,
    },
    input: {
        width: '100%',
        padding: 10,
        borderWidth: 1,
        borderColor: '#DDD',
        borderRadius: 5,
        marginBottom: 10,
    },
    submitButton: {
        backgroundColor: '#28A745',
        paddingVertical: 10,
        paddingHorizontal: 20,
        borderRadius: 5,
    },
    submitText: {
        color: '#FFF',
        fontSize: 14,
        fontWeight: 'bold',
    },
    closeButton: {
        marginTop: 10,
    },
    closeText: {
        color: '#FF0000',
        fontSize: 14,
    },
    claimButton: {
        backgroundColor: '#FFD700',
        padding: 10,
        borderRadius: 6,
        marginTop: 10,
    },
    claimText: {
        color: '#333',
        fontSize: 12,
        fontWeight: 'bold',
    },
    adminButton: {
        backgroundColor: '#FF4500',
        padding: 10,
        borderRadius: 6,
        marginVertical: 10,
        alignItems: 'center',
    },
    adminText: {
        color: '#FFF',
        fontSize: 14,
        fontWeight: 'bold',
    },
    userNameLogout: {
        fontSize: 18,
        fontFamily:'Lato-Bold',
        color: config.colors.secondary,
        lineHeight:24
      },


});

export default RewardCenterScreen;