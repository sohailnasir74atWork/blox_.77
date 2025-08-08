import React from 'react';
import { TouchableOpacity, View, Text } from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';

const StoreItemCard = ({ item, onPress, isDark, styles }) => {
  const titletrimmed = item?.title && item?.title.length > 13 ? item?.title.substring(0, 13) + '...' : item?.title;
  const trimmedNote = item?.note && item?.note.length > 20 ? item?.note.substring(0, 20) + '...' : item?.note;

  return (
    <TouchableOpacity style={styles.itemBox} onPress={() => onPress(item)}>
      {item?.popular && <View style={styles.popularBadge}><Text style={styles.popularText}>Popular</Text></View>}
      {item?.sold && <View style={styles.sold}><Text style={styles.soldText}>Sold: {item?.sold}</Text></View>}
      <Icon name={item?.icon} size={28} color={isDark ? '#ffd700' : '#6A5ACD'} />
      <Text style={styles.itemTitle}>{titletrimmed}</Text>
      <Text style={styles.itemNote}>{trimmedNote}</Text>  
      <Text style={item?.status === 'Available' ? styles.statusAvailable : styles.statusUnAvailable}>
        {item?.status}
      </Text>
    </TouchableOpacity>
  );
};

export default StoreItemCard;
