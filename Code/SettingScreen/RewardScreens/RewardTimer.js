import React, { useState, useEffect } from 'react';
import { View, Text } from 'react-native';

const CountdownTimer = ({ targetDate, styles }) => {
    const [countdown, setCountdown] = useState('');

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

    return (
        <View style={styles.timerCard}>
            <Text style={styles.timerTitle}>Next Prize in:</Text>
            <Text style={[styles.timerText, { fontSize: 20, lineHeight: 32 }]}>{countdown || 'COMING SOON'}</Text>
        </View>
    );
};

export default CountdownTimer;
