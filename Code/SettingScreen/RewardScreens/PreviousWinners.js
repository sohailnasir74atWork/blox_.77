import React from 'react';
import { View, Text } from 'react-native';

const PreviousWinners = ({ latestWinner, previousWinners, styles }) => {
    return (
        <>
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

            {/* Previous Winners List */}
            <View style={styles.tabContent}>
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
            </View>
        </>
    );
};

export default PreviousWinners;
