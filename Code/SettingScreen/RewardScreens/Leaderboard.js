import React from 'react';
import { View, Text, Image } from 'react-native';

const Leaderboard = ({ leaderboardData, styles }) => {
    return (
        <View style={styles.tabContent}>
            {leaderboardData.length > 0 ? (
                leaderboardData.map((player, index) => (
                    <View key={player.id} style={styles.leaderboardCard}>
                        <View style={styles.leaderboardCardsub}>
                            <Text style={styles.rankText}>#{index + 1}</Text>
                            <Image source={{ uri: player.avatar }} style={styles.avatar} />
                            <Text style={styles.playerName}>{player.name}</Text>
                        </View>
                        <Text style={styles.playerScore}>{player.slots} Slots</Text>
                    </View>
                ))
            ) : (
                <View style={styles.placeholder}>
                    <Text style={styles.placeholderText}>No active slots yet! Be the first 🚀</Text>
                </View>
            )}
        </View>
    );
};

export default Leaderboard;
