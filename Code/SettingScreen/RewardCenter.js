import React, { useState, useEffect, useMemo } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Image, Modal } from 'react-native';
import config from '../Helper/Environment';
import { useGlobalState } from '../GlobelStats';
import SignInDrawer from '../Firebase/SigninDrawer';
import { useLocalState } from '../LocalGlobelStats';
import SubscriptionScreen from './OfferWall';
import { get, push, ref, set } from '@react-native-firebase/database';
import { GestureHandlerRootView, TextInput } from 'react-native-gesture-handler';
import { showSuccessMessage, showErrorMessage, showWarningMessage } from '../Helper/MessageHelper';
import RewardedAdComponent from './RewardScreens/RewardedAd';
import UserProfileSection from './RewardScreens/RewardProfile';
import PointsSlotsSection from './RewardScreens/RewardPointSlot';
import CountdownTimer from './RewardScreens/RewardTimer';
import { getStyles } from './RewardScreens/rewardstyle'


const RewardCenterScreen = ({ selectedTheme }) => {
    const { user, appdatabase, isAdmin, theme, updateLocalStateAndDatabase } = useGlobalState();
    const currentUser = user || null;  // Ensures user is properly handled
    const [openSingnin, setOpenSignin] = useState(false);
    const [showOfferWall, setShowofferWall] = useState(false);
    const [isClaimModalVisible, setIsClaimModalVisible] = useState(false);
    const [targetDate, setTargetDate] = useState(null); // Store target date from Firebase
    const [email, setEmail] = useState('');
    const [robloxId, setRobloxId] = useState('');
    const [latestWinner, setLatestWinner] = useState();
    const [prize, setPrize] = useState();
    const [previousWinners, setPreviousWinners] = useState([]);
    const [isAdminModalVisible, setIsAdminModalVisible] = useState(false);
    const [isAdminPrizeModalVisible, setIsAdminPrizeModalVisible] = useState(false);
    const [nextTargetDate, setNextTargetDate] = useState(new Date().toISOString().split('T')[0]);
    const [prizeName, setPrizeName] = useState('');
    const [prizeValue, setPrizeValue] = useState('');
    const [prizeImage, setPrizeImage] = useState('');
    const [winnerName, setWinnerName] = useState('');
    const [winnerId, setWinnerId] = useState('');
    const [winnerPrize, setWinnerPrize] = useState('');
    const [winnerDate, setWinnerDate] = useState(new Date().toISOString().split('T')[0]);
    const isDarkMode = theme === 'dark';
    const styles = useMemo(() => getStyles(isDarkMode, config), [isDarkMode]);
    const [showEnrollOptions, setShowEnrollOptions] = useState(false);
    const [activeSlots, setActiveSlots] = useState(0); // Track number of active slots
    const [userPoints, setUserPoints] = useState(user?.rewardPoints || 0);
    const [isAdsDrawerVisible, setIsAdsDrawerVisible] = useState(false);
    const [isLoading, setIsLoading] = useState(false); // Loader state
    const [winnerAvatar, setWinnerAvatar] = useState(''); // Loader state
    const { locatState } = useLocalState()
    const [hasClaimed, setHasClaimed] = useState(false);



    // 🔥 Trigger Ad Modal
    const handleGetPoints = () => {
        if (!user?.id) {
            setOpenSignin(true); // Ensure user is logged in
        } else {
            setIsAdsDrawerVisible(true);
            // rewarded.load(); // Load the ad
        }
    };

    const [activeTab, setActiveTab] = useState('winners'); // Default tab
    const [leaderboardData, setLeaderboardData] = useState([]); // Mock leaderboard data

    useEffect(() => {
        const fetchLeaderboardData = async () => {
            try {
                const leaderboardRef = ref(appdatabase, 'leader_board');
                const snapshot = await get(leaderboardRef);

                if (!snapshot.exists()) {
                    setLeaderboardData([]);
                    return;
                }

                const leaderboardData = snapshot.val();

                // Ensure leaderboardData is an array and limit to top 10
                if (Array.isArray(leaderboardData)) {
                    setLeaderboardData(leaderboardData.slice(0, 10)); // Get top 10
                } else {
                    // console.error("Unexpected leaderboard data format:", leaderboardData);
                    setLeaderboardData([]);
                }
            } catch (error) {
                console.error("Error fetching leaderboard data:", error);
                setLeaderboardData([]);
            }
        };

        fetchLeaderboardData();
    }, []);



    useEffect(() => {
        const prizeRef = ref(appdatabase, 'prize');

        const fetchPrize = async () => {
            try {
                const snapshot = await get(prizeRef);
                if (snapshot.exists()) {
                    const data = snapshot.val();
                    setPrize(data);
                    if (data.targetDate) {
                        setTargetDate(new Date(data.targetDate)); // Ensure proper date conversion
                    }
                }
            } catch (error) {
                console.error("Error fetching prize:", error);
            }
        };

        // Fetch data once when the component mounts
        fetchPrize();

        // Listen for real-time updates
        const unsubscribe = prizeRef.on('value', (snapshot) => {
            if (snapshot.exists()) {
                const data = snapshot.val();
                setPrize(data);
                if (data.targetDate) {
                    setTargetDate(new Date(data.targetDate));
                }
            }
        });

        // Cleanup function to remove the listener on unmount
        return () => prizeRef.off('value');

    }, [appdatabase]);


    useEffect(() => {
        const fetchWinners = async () => {
            try {
                const winnersRef = ref(appdatabase, 'winners');
                const snapshot = await get(winnersRef);

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
            } catch (error) {
                console.error("Error fetching winners:", error);
            }
        };

        fetchWinners();
    }, [appdatabase]);

    useEffect(() => {
        if (!user?.id) return;

        const enrollRef = ref(appdatabase, `/enrole/${user.id}`);

        const fetchActiveSlots = async () => {
            try {
                const snapshot = await get(enrollRef);
                if (snapshot.exists()) {
                    const activeSlotsCount = Object.values(snapshot.val()).length;
                    setActiveSlots(activeSlotsCount);
                } else {
                    setActiveSlots(0);
                }
            } catch (error) {
                console.error("Error fetching active slots:", error);
            }
        };

        fetchActiveSlots();

        // Re-fetch whenever user enrolls or points change
    }, [user?.id, userPoints, locatState?.isPro]);
    useEffect(() => { if (locatState?.isPro && user.id) { setActiveSlots(2) } }, [locatState?.isPro])

    const handleBuySlot = async () => {
        if (!user || !user.id) {
            showErrorMessage("Error", "You must be logged in to participate!");
            return;
        }

        const userRef = ref(appdatabase, `/users/${user.id}/rewardPoints`);
        const enrollRef = ref(appdatabase, `/enrole/${user.id}`);

        setIsLoading(true); // 🔥 Start loading

        try {
            // 🔴 Fetch latest reward points to avoid stale data
            const pointsSnapshot = await get(userRef);
            const currentPoints = pointsSnapshot.exists() ? pointsSnapshot.val() : 0;

            if (currentPoints < 2500) {
                showErrorMessage("Warning", "You need at least 2500 reward points to buy a slot.");
                setIsLoading(false); // 🛑 Stop loading
                return;
            }

            // 🔴 Fetch current slot count to ensure limit enforcement
            const slotSnapshot = await get(enrollRef);
            const currentSlotCount = slotSnapshot.exists() ? Object.keys(slotSnapshot.val()).length : 0;

            if (currentSlotCount >= 2) {
                showWarningMessage("Warning", "You cannot have more than 2 slots for this prize!");
                setIsLoading(false); // 🛑 Stop loading
                setShowEnrollOptions(false);
                return;
            }

            if (user.isPro) {
                showWarningMessage("Warning", "Pro members already have 2 slots allocated and cannot purchase more.");
                setIsLoading(false); // 🛑 Stop loading
                setShowEnrollOptions(false);
                return;
            }

            // 🔴 Deduct points and update Firebase
            const newPoints = currentPoints - 2500;
            await set(userRef, newPoints);

            // 🔴 Add a new slot under `enrole`
            const slotRef = push(enrollRef);
            await set(slotRef, {
                enrolledAt: new Date().toISOString(),
            });

            // 🔴 Fetch updated slot count to ensure UI sync
            const updatedSlotSnapshot = await get(enrollRef);
            const updatedSlotCount = updatedSlotSnapshot.exists() ? Object.keys(updatedSlotSnapshot.val()).length : 0;

            // ✅ Update local state after Firebase updates
            setUserPoints(newPoints);
            setActiveSlots(updatedSlotCount);

            showSuccessMessage("Success", "You have successfully enrolled in this draw!");

            setShowEnrollOptions(false);
        } catch (error) {
            console.error("Error buying slot:", error);
            showErrorMessage("Error", "Something went wrong!");

            // 🔴 Rollback points in UI if something goes wrong
            const latestPoints = await get(userRef);
            setUserPoints(latestPoints.exists() ? latestPoints.val() : userPoints);
        } finally {
            setIsLoading(false); // 🔥 Stop loading
        }
    };


    useEffect(() => {
        if (!user?.id) return;

        const userRef = ref(appdatabase, `/users/${user.id}/rewardPoints`);

        const syncUserPoints = async () => {
            try {
                const snapshot = await get(userRef);
                if (snapshot.exists()) {
                    setUserPoints(snapshot.val());
                }
            } catch (error) {
                console.error("Error fetching user points:", error);
            }
        };

        syncUserPoints();

        // Listen for real-time changes
        const unsubscribe = userRef.on('value', (snapshot) => {
            if (snapshot.exists()) {
                setUserPoints(snapshot.val());
            }
        });

        return () => userRef.off('value', unsubscribe);
    }, [user?.id]);



    const handleEnrole = () => {
        if (!user || !user.id) {
            showErrorMessage("Error", "You must be logged in to participate!");
            return;
        }
        if (!user.isPro && activeSlots === 2) {
            showWarningMessage("Warning", "You cannot have more than 2 slots for this prize!");
            return
        }


        if (!user.isPro) {
            setShowEnrollOptions(true);
        } else {
            showWarningMessage("Warning", "You cannot have more than 2 slots for this prize!");
        }
    };

    const handleSubmitWinner = async () => {
        if (!winnerName || !winnerId || !winnerPrize || !winnerDate) {
            showErrorMessage("Error", "Please fill in all fields!");
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
                image: winnerAvatar,

            });

            showSuccessMessage("Success", "Winner submitted successfully!");
            setIsAdminModalVisible(false);
            setWinnerName('');
            setWinnerId('');
            setWinnerPrize('');
            setWinnerDate(new Date().toISOString().split('T')[0]);
        } catch (error) {
            console.error("Error submitting winner:", error);
            showErrorMessage("Error", "Something went wrong!");
        }
    };

    const handleLoginSuccess = () => {
        setOpenSignin(false);
    };

    const handleSubmitPrize = async () => {
        if (!nextTargetDate || !prizeName || !prizeValue || !prizeImage) {
            showErrorMessage("Error", "Please fill in all fields!");
            return;
        }

        try {
            // Update Prize Information
            const prizeRef = ref(appdatabase, 'prize');
            await prizeRef.set({
                name: prizeName,
                value: prizeValue,
                image: prizeImage,
                targetDate: nextTargetDate,
            });

            showSuccessMessage("Success", "Prize and Target Date Updated!");

            setIsAdminPrizeModalVisible(false);
            setPrizeName('');
            setPrizeValue('');
            setPrizeImage('');
            setNextTargetDate(new Date().toISOString().split('T')[0]);

        } catch (error) {
            showErrorMessage("Error", "Something went wrong!");
        }
    };


    const handleClaimReward = () => {
        setIsClaimModalVisible(true);
    };

    // Function to submit claim
    const submitClaim = async () => {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/; // Basic email validation regex

        if (!email || !robloxId) {
            showErrorMessage("Error", "Please fill in all fields!");
            return;
        }

        if (!emailRegex.test(email)) {
            showErrorMessage("Invalid Email", "Please enter a valid email address!");
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

            // Show success message
            showSuccessMessage("Success", "Your reward claim has been submitted!");

            // ✅ Close modal and clear fields
            setIsClaimModalVisible(false);
            setEmail('');
            setRobloxId('');

            // ✅ Immediately update UI to show "Claimed"
            setHasClaimed(true);

        } catch (error) {
            showErrorMessage("Error", "Something went wrong!");
        }
    };



    return (
        <GestureHandlerRootView>
            <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>

                {/* User Profile Section */}
                <UserProfileSection
                    user={user}
                    currentUser={currentUser}
                    setOpenSignin={setOpenSignin}
                    latestWinner={latestWinner}
                    handleClaimReward={handleClaimReward}
                    styles={styles}
                    appdatabase={appdatabase}
                    hasClaimed={hasClaimed}
                    setHasClaimed={setHasClaimed}

                />
                <PointsSlotsSection
                    userPoints={userPoints}
                    activeSlots={activeSlots}
                    handleGetPoints={handleGetPoints}
                    styles={styles}
                    handleEnrole={handleEnrole}

                />



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
                <CountdownTimer targetDate={targetDate} styles={styles} />


                {/* Prize Section - Dynamic */}
                {/* Prize Section - Dynamic */}
                <View style={[styles.timerCard, { backgroundColor: config.colors.hasBlockGreen }]}>
                    <Text style={styles.timerTitle}>Prize</Text>
                    {prize?.image ? (
                        <Image source={{ uri: prize.image }} style={styles.prizeImage} />
                    ) : (
                        <Text style={styles.placeholderText}>No prize image available</Text>
                    )}
                    <Text style={styles.timerText}>{prize?.value} {prize?.name}</Text>
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
                            {latestWinner?.image ? (
                                <Image source={{ uri: latestWinner.image }} style={styles.prizeImage} />
                            ) : (
                                <Text style={styles.placeholderText}>No winner image available</Text>
                            )}
                            <Text style={styles.winnerName}>{latestWinner.name}</Text>

                            <Text style={styles.winnerPrize}>Prize: {latestWinner.prize}</Text>
                            <Text style={styles.winnerDate}>Won on {new Date(latestWinner.date).toDateString()}</Text>
                        </>
                    )}
                </View>




                {/* Previous Winners Section */}
                <View style={styles.tabContainer}>
                    {/* Tab Navigation */}
                    <View style={styles.tabHeader}>
                        <TouchableOpacity
                            style={[styles.tabButton, activeTab === 'winners' && styles.activeTab]}
                            onPress={() => setActiveTab('winners')}
                        >
                            <Text style={[styles.tabText, activeTab === 'winners' && styles.activeTabText]}>🏅 Previous Winners</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                            style={[styles.tabButton, activeTab === 'leaderboard' && styles.activeTab]}
                            onPress={() => setActiveTab('leaderboard')}
                        >
                            <Text style={[styles.tabText, activeTab === 'leaderboard' && styles.activeTabText]}>🏆 Leaderboard</Text>
                        </TouchableOpacity>
                    </View>

                    {/* Content */}
                    <View style={styles.tabContent}>
                        {activeTab === 'leaderboard' ? (
                            leaderboardData.length > 0 ? (
                                leaderboardData.map((player, index) => (
                                    <View key={player.id} style={styles.leaderboardCard}>
                                        <View style={styles.leaderboardCardsub}>
                                            <Text style={styles.rankText}>#{index + 1}</Text>
                                            <Image source={{ uri: player.avatar }} style={styles.avatar} />
                                            <Text style={styles.playerName}>{player.displayName}</Text>
                                        </View>
                                        <Text style={styles.playerScore}>{player.rewardPoints} Points</Text>
                                    </View>
                                ))
                            ) : (
                                <View style={styles.placeholder}>
                                    <Text style={styles.placeholderText}>No active slots yet! Be the first 🚀</Text>
                                </View>
                            )
                        ) : (
                            previousWinners.length > 0 ? (
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
                            )
                        )}
                    </View>
                </View>



                <SignInDrawer
                    visible={openSingnin}
                    onClose={handleLoginSuccess}
                    selectedTheme={selectedTheme}
                    message='To participate in rewards you needs to sigin'
                    screen='Reward'
                />
                <SubscriptionScreen visible={showOfferWall} onClose={() => setShowofferWall(false)} track='Reward Center' />
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
                            {/* Winner avatar */}
                            <TextInput
                                style={styles.input}
                                placeholder="Image URL"
                                value={winnerAvatar}
                                onChangeText={setWinnerAvatar}
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
                <Modal visible={showEnrollOptions} transparent animationType="slide">
                    <View style={styles.modalContainer}>
                        <View style={styles.enrollModal}>
                            <Text style={styles.modalTitle}>Choose an Enrollment Option</Text>

                            {/* Go Pro Option */}
                            <TouchableOpacity
                                style={[styles.enrollButton, { backgroundColor: config.colors.primary }]}
                                onPress={() => {
                                    setShowEnrollOptions(false);
                                    setShowofferWall(true); // Open the subscription modal
                                }}
                            >
                                <Text style={styles.enrollButtonText}>Go Pro - Get 2 Slots Every Week</Text>
                            </TouchableOpacity>

                            {/* Buy Slot with Points */}
                            <TouchableOpacity
                                style={[styles.enrollButton, { backgroundColor: config.colors.secondary }]}
                                onPress={handleBuySlot}
                            >
                                <Text style={styles.enrollButtonText}>{isLoading ? "Submitting ..." : 'Buy 1 Slot - 2500 Points'}</Text>
                            </TouchableOpacity>

                            {/* Close Button */}
                            <TouchableOpacity
                                style={styles.closeButton}
                                onPress={() => setShowEnrollOptions(false)}
                            >
                                <Text style={styles.closeText}>Cancel</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                </Modal>
                <RewardedAdComponent
                    user={user}
                    appdatabase={appdatabase}
                    updateLocalStateAndDatabase={updateLocalStateAndDatabase}
                    isAdsDrawerVisible={isAdsDrawerVisible}
                    setIsAdsDrawerVisible={setIsAdsDrawerVisible}
                />
            </ScrollView></GestureHandlerRootView>
    );
};

export default RewardCenterScreen;