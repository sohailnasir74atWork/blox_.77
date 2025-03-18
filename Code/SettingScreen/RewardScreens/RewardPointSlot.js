import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';

const PointsSlotsSection = ({ userPoints, activeSlots, handleGetPoints, styles, handleEnrole }) => {
    return (
        <View style={styles.pointsContainer}>
            {/* User Points */}
            <View style={styles.pointsBox}>
                <Text style={styles.pointsLabel}>My Points</Text>
                <Text style={styles.pointsValue}>{userPoints}</Text>

                {/* Get Points Button */}
                <TouchableOpacity style={styles.getPointsButton} onPress={handleGetPoints}>
                    <Text style={styles.getPointsText}>Get Points</Text>
                </TouchableOpacity>
            </View>

            {/* User Slots */}
            <View style={styles.pointsBox}>
                <Text style={styles.pointsLabel}>My Slots</Text>
                <Text style={styles.pointsValue}>{activeSlots}</Text>

                {/* Book Slot Button */}
                <TouchableOpacity style={styles.getPointsButton} onPress={handleEnrole}>
                    <Text style={styles.getPointsText}>Book Slot</Text>
                </TouchableOpacity>
            </View>
        </View>
    );
};

export default PointsSlotsSection;
