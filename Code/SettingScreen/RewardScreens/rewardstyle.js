import { StyleSheet } from "react-native";

export const getStyles = (isDarkMode, config) =>
    StyleSheet.create({
        container: {
            flex: 1,
            paddingHorizontal: 10,
            backgroundColor: isDarkMode ? '#121212' : '#f2f2f7',

        },
        sectionTitle: {
            fontSize: 14,
            fontFamily: 'Lato-Bold',
            color: '#333',
            // marginVertical: 10,
            fontFamily: 'Lato-Regular',
            color: isDarkMode ? 'lightgrey' : '#333',

        },

        // User Profile Section
        userSection: {
            flexDirection: 'row',
            alignItems: 'center',
            backgroundColor: isDarkMode ? '' : '#f2f2f7',
            padding: 10,
            borderRadius: 10,
            marginBottom: 10,
        },
        profilePic: {
            width: 40,
            height: 40,
            borderRadius: 20,
            marginRight: 10,
        },
        userName: {
            fontSize: 12,
            fontFamily: 'Lato-Bold',
            lineHeight: 18,
            color: isDarkMode ? 'lightgrey' : '#333',

        },
        userStatus: {
            fontSize: 10,
            color: isDarkMode ? 'lightgrey' : '#333',
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
            padding: 10,
            borderRadius: 10,
            alignItems: 'center',
            marginBottom: 10,
            fontFamily: 'Lato-Regular',

        },
        timerTitle: {
            fontSize: 12,
            fontFamily: 'Lato-Bold',
            color: '#FFF',
        },
        timerText: {
            fontSize: 12,
            fontFamily: 'Lato-Bold',
            color: '#FFF',
            marginVertical: 5,
        },
        timerPrize: {
            fontSize: 12,
            color: '#FFF',
            fontFamily: 'Lato-Regular',

        },

        // Winner Announcement
        winnerCard: {
            backgroundColor: '#FFD700',
            padding: 10,
            borderRadius: 10,
            alignItems: 'center',
            // marginBottom: 20,
        },
        winnerTitle: {
            fontSize: 14,
            fontFamily: 'Lato-Bold',
            color: '#333',
        },
        winnerName: {
            fontSize: 14,
            fontFamily: 'Lato-Bold',
            color: '#000',
            // marginTop: 5,
        },
        winnerPrize: {
            fontSize: 14,
            color: '#555',
            marginTop: 5,
            fontFamily: 'Lato-Regular',

        },
        winnerDate: {
            fontSize: 12,
            color: '#666',
            marginTop: 5,
            fontFamily: 'Lato-Regular',

        },

        // History Section
        historyCard: {
            flexDirection: 'row',
            justifyContent: 'space-between',
            backgroundColor: isDarkMode ?  "#121212" :'#ECF0F1',
            padding: 10,
            borderRadius: 6,
            marginVertical: 5,
            alignItems: 'center'

        },
        historyName: {
            fontSize: 14,
            fontFamily: 'Lato-Bold',
            color: isDarkMode ? 'lightgrey' : '#333',

        },
        historyPrize: {
            fontSize: 12,
            color: isDarkMode ? 'lightgrey' : '#333',
            marginTop: 2,
            fontFamily: 'Lato-Regular',
        },
        historyDate: {
            fontSize: 10,
            color: isDarkMode ? 'lightgrey' : '#333',
            marginTop: 2,
            fontFamily: 'Lato-Regular',

        },
        placeholder: {
            // backgroundColor: '#FFF',
            padding: 10,
            borderRadius: 8,
            marginVertical: 5,
            alignItems: 'center',
            justifyContent: 'center',
        },
        placeholderText: {
            fontSize: 12,
            color: '#777',
            fontFamily: 'Lato-Regular',
            textAlign: 'center',
        },
        guest: {
            fontSize: 12,
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
            padding: 10,
            borderRadius: 10,
            width: '80%',
            alignItems: 'center',
        },
        modalTitle: {
            fontSize: 12,
            fontFamily: 'Lato-Bold',
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
            fontSize: 12,
            fontFamily: 'Lato-Bold',
        },
        closeButton: {
            marginTop: 10,
        },
        closeText: {
            color: '#FF0000',
            fontSize: 12,
        },
        claimButton: {
            backgroundColor: '#FFD700',
            padding: 10,
            borderRadius: 6,
            marginTop: 10,
        },
        claimText: {
            color: '#333',
            fontSize: 10,
            fontFamily: 'Lato-Bold',
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
            fontSize: 12,
            fontFamily: 'Lato-Bold',
        },
        userNameLogout: {
            fontSize: 16,
            fontFamily: 'Lato-Bold',
            color: config.colors.secondary,
            lineHeight: 24
        },
        enrollModal: {
            backgroundColor: "#fff",
            padding: 20,
            borderRadius: 10,
            width: "85%",
            alignItems: "center",
        },
        enrollButton: {
            width: "100%",
            padding: 12,
            borderRadius: 8,
            marginVertical: 8,
            alignItems: "center",
        },
        enrollButtonText: {
            color: "#fff",
            fontSize: 12,
            fontFamily: 'Lato-Bold',
        },
        pointsContainer: {
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            // backgroundColor: isDarkMode ? '#2C3E50' : '#EAECEF', // Dark & Light theme
            // padding: 15,
            borderRadius: 10,
            marginBottom: 10,
        },
        pointsBox: {
            width: '48%', // Ensures even spacing
            backgroundColor: isDarkMode ? '#34495E' : '#CCCCFF', // Dark: darker contrast, Light: White
            borderRadius: 8,
            alignItems: 'center',
            // shadowColor: '#000', // Soft shadow for a lifted effect
            // shadowOpacity: 0.1,
            // shadowRadius: 4,
            // elevation: 3, // For Android shadow
        },

        pointsLabel: {
            fontSize: 12,
            color: isDarkMode ? '#ECF0F1' : '#2C3E50', // Light text for dark mode, Dark text for light mode
            fontFamily: 'Lato-Bold',
            paddingTop: 12,

        },
        pointsValue: {
            fontSize: 14,
            color: isDarkMode ? '#1ABC9C' : '#27AE60', // Greenish values (Different shades for themes)
            fontFamily: 'Lato-Bold',
            marginTop: 5,
            // paddingVertical: 12,

        },
        getPointsButton: {
            marginTop: 8, // Space from text above
            width: '100%', // Full width of the card
            backgroundColor: '#6A5ACD', // iOS Blue button color
            paddingVertical: 12,
            borderBottomRightRadius: 8,
            borderBottomLeftRadius: 8,

            alignItems: 'center', // Center text inside button
        },
        getPointsText: {
            color: 'white',
            fontSize: 12,
            fontFamily: 'Lato-Bold',
        },
        tabContainer: {
            marginVertical: 20,
        },
        tabHeader: {
            flexDirection: 'row',
            justifyContent: 'space-around',
            backgroundColor: '#CCCCFF',
            borderRadius: 8,
            padding: 10,
        },
        tabButton: {
            flex: 1,
            alignItems: 'center',
            paddingVertical: 10,
            borderRadius: 6,
        },
        activeTab: {
            backgroundColor: '#6A5ACD', // Active tab color
        },
        tabText: {
            fontSize: 10,
            fontFamily: 'Lato-Bold',
            color: '#555',
        },
        activeTabText: {
            color: 'white',
        },
        tabContent: {
            backgroundColor: isDarkMode ? '#34495E': '#FFF',
            padding: 10,
            borderRadius: 8,
            marginTop: 10,
            
        },

        // Leaderboard Card
        leaderboardCard: {
            flexDirection: 'row',
            justifyContent: 'space-between',
            backgroundColor: isDarkMode ? '#121212' : '#ECF0F1',
            padding: 10,
            borderRadius: 6,
            marginVertical: 5,
            alignItems: 'center'

        },
        leaderboardCardsub: {
            flexDirection: 'row',
            // justifyContent: 'space-between',
            // backgroundColor: '#ECF0F1',
            // padding: 12,
            // borderRadius: 6,
            // marginVertical: 5,
            justifyContent: 'center',
            alignItems: 'center'
        },
        rankText: {
            fontFamily: 'Lato-Bold',
            color: isDarkMode ? 'white' : '#3498DB',
            paddingRight: 10
        },
        playerName: {
            fontSize: 10,
            fontFamily: 'Lato-Bold',
            color: isDarkMode ? 'white' :'black',
        },
        playerScore: {
            fontSize: 10,
            color: isDarkMode ? 'white' :'#333',
        },
        avatar: {
            height: 30,
            width: 30,
            marginRight: 10,
            borderRadius:15
        }
    });