import React, { useState, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Dimensions,
  StatusBar,
} from 'react-native';

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

const MONTH_EMOJIS = [
  '⛄', '💝', '🌷', '🌸', '🌻', '☀️',
  '🏖️', '🌅', '🍂', '🎃', '🍁', '🎄',
];

const currentYear = new Date().getFullYear();

const ACCENT = '#8B5CF6';
const ACCENT_LIGHT = '#8B5CF620';
const PINK = '#EC4899';

const StepDots = ({ current, total }) => (
  <View style={dotStyles.row}>
    {Array.from({ length: total }, (_, i) => (
      <View
        key={i}
        style={[
          dotStyles.dot,
          i === current && dotStyles.dotActive,
          i < current && dotStyles.dotDone,
        ]}
      />
    ))}
  </View>
);

const dotStyles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'center', gap: 8, marginBottom: 16 },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#E5E7EB' },
  dotActive: { backgroundColor: ACCENT, width: 28, borderRadius: 5 },
  dotDone: { backgroundColor: PINK },
});

const OptionGrid = ({ items, selected, onSelect, isDarkMode, columns = 4 }) => {
  const bg = isDarkMode ? '#2D2640' : '#F5F3FF';
  const textColor = isDarkMode ? '#E8E0F0' : '#4B3B6B';

  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {items.map((item) => {
        const isActive = item.value === selected;
        return (
          <TouchableOpacity
            key={item.value}
            onPress={() => onSelect(item.value)}
            activeOpacity={0.6}
            style={[
              gridStyles.item,
              {
                backgroundColor: isActive ? ACCENT : bg,
                borderColor: isActive ? ACCENT : 'transparent',
                width: `${Math.floor(100 / columns) - 2}%`,
              },
            ]}
          >
            {item.emoji && (
              <Text style={gridStyles.emoji}>{item.emoji}</Text>
            )}
            <Text
              style={[
                gridStyles.itemText,
                { color: isActive ? '#FFF' : textColor },
              ]}
              numberOfLines={1}
            >
              {item.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
};

const gridStyles = StyleSheet.create({
  item: {
    paddingVertical: 12,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
  },
  emoji: { fontSize: 16, marginBottom: 2 },
  itemText: { fontSize: 15, fontWeight: '700' },
});

// `subtitle` / `onCancel` are optional: the mandatory DOB gate uses neither;
// the email opt-in flow passes both so the user can back out.
const DateOfBirthModal = ({ visible, onSubmit, isDarkMode, subtitle, onCancel }) => {
  const [month, setMonth] = useState(null);
  const [day, setDay] = useState(null);
  const [year, setYear] = useState(null);
  const [error, setError] = useState('');
  const [step, setStep] = useState(0);

  const bgColor = isDarkMode ? '#1A1527' : '#FFFFFF';
  const textColor = isDarkMode ? '#F3EEFF' : '#1F1235';
  const subColor = isDarkMode ? '#A89CC8' : '#7C6D9B';

  const daysInMonth = useMemo(() => {
    if (!month || !year) return 31;
    return new Date(year, month, 0).getDate();
  }, [month, year]);

  const yearItems = useMemo(() => {
    const arr = [];
    for (let y = currentYear; y >= 1940; y--) arr.push({ label: String(y), value: y });
    return arr;
  }, []);

  const monthItems = useMemo(() =>
    MONTHS.map((m, i) => ({ label: m, value: i + 1, emoji: MONTH_EMOJIS[i] }))
  , []);

  const dayItems = useMemo(() => {
    const arr = [];
    for (let d = 1; d <= daysInMonth; d++) arr.push({ label: String(d), value: d });
    return arr;
  }, [daysInMonth]);

  const handleSelectYear = useCallback((y) => {
    setYear(y);
    setError('');
    setStep(1);
  }, []);

  const handleSelectMonth = useCallback((m) => {
    setMonth(m);
    setDay(null);
    setError('');
    setStep(2);
  }, []);

  const handleSelectDay = useCallback((d) => {
    setDay(d);
    setError('');
  }, []);

  const handleSubmit = () => {
    setError('');

    if (!year || !month || !day) {
      setError('Pick your full birthday first!');
      return;
    }

    const dobDate = new Date(year, month - 1, day);
    const now = new Date();

    if (dobDate > now) {
      setError("That date hasn't happened yet!");
      return;
    }

    const ageMs = now - dobDate;
    const ageYears = ageMs / (1000 * 60 * 60 * 24 * 365.25);

    if (ageYears < 4) {
      setError('Please enter a valid date of birth.');
      return;
    }

    const dobString = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    onSubmit(dobString);
  };

  const stepTitles = [
    'What year were you born?',
    'What month?',
    'And what day?',
  ];

  if (!visible) return null;

  return (
    <View style={styles.overlay}>
        <View style={[styles.card, { backgroundColor: bgColor }]}>

          <Text style={styles.icon}>🎂</Text>
          <Text style={[styles.title, { color: textColor }]}>When's your birthday?</Text>
          <Text style={[styles.subtitle, { color: subColor }]}>
            {subtitle || 'We need this to keep everyone safe. You only do this once!'}
          </Text>

          <StepDots current={step} total={3} />

          {/* Summary chips */}
          {(year || month || day) && (
            <View style={styles.summaryRow}>
              {year != null && (
                <TouchableOpacity
                  onPress={() => setStep(0)}
                  style={[styles.chip, step === 0 && styles.chipActive, { backgroundColor: isDarkMode ? '#2D2640' : '#F5F3FF' }]}
                >
                  <Text style={[styles.chipText, { color: step === 0 ? ACCENT : textColor }]}>{year}</Text>
                </TouchableOpacity>
              )}
              {month != null && (
                <TouchableOpacity
                  onPress={() => setStep(1)}
                  style={[styles.chip, step === 1 && styles.chipActive, { backgroundColor: isDarkMode ? '#2D2640' : '#F5F3FF' }]}
                >
                  <Text style={[styles.chipText, { color: step === 1 ? ACCENT : textColor }]}>
                    {MONTH_EMOJIS[month - 1]} {MONTHS[month - 1]}
                  </Text>
                </TouchableOpacity>
              )}
              {day != null && (
                <TouchableOpacity
                  onPress={() => setStep(2)}
                  style={[styles.chip, step === 2 && styles.chipActive, { backgroundColor: isDarkMode ? '#2D2640' : '#F5F3FF' }]}
                >
                  <Text style={[styles.chipText, { color: step === 2 ? ACCENT : textColor }]}>{day}</Text>
                </TouchableOpacity>
              )}
            </View>
          )}

          {/* Step title */}
          <Text style={[styles.stepTitle, { color: subColor }]}>{stepTitles[step]}</Text>

          {/* Grid */}
          <ScrollView style={styles.gridScroll} showsVerticalScrollIndicator={false} bounces={false}>
            {step === 0 && (
              <OptionGrid items={yearItems} selected={year} onSelect={handleSelectYear} isDarkMode={isDarkMode} columns={4} />
            )}
            {step === 1 && (
              <OptionGrid items={monthItems} selected={month} onSelect={handleSelectMonth} isDarkMode={isDarkMode} columns={3} />
            )}
            {step === 2 && (
              <OptionGrid items={dayItems} selected={day} onSelect={handleSelectDay} isDarkMode={isDarkMode} columns={7} />
            )}
          </ScrollView>

          {!!error && (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          {/* Submit */}
          {year && month && day && (
            <TouchableOpacity style={styles.submitBtn} onPress={handleSubmit} activeOpacity={0.8}>
              <Text style={styles.submitText}>Let's Go! 🚀</Text>
            </TouchableOpacity>
          )}

          {!!onCancel && (
            <TouchableOpacity style={styles.cancelBtn} onPress={onCancel} activeOpacity={0.6}>
              <Text style={[styles.cancelText, { color: subColor }]}>Not now</Text>
            </TouchableOpacity>
          )}

          <Text style={[styles.disclaimer, { color: subColor }]}>
            🔒 Your birthday is stored safely and securely.
          </Text>
        </View>
      </View>
  );
};

const screenHeight = Dimensions.get('window').height;

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(15, 10, 30, 0.95)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    zIndex: 9999,
    elevation: 9999,
  },
  card: {
    width: '100%',
    maxWidth: 400,
    maxHeight: screenHeight * 0.82,
    borderRadius: 28,
    padding: 24,
    shadowColor: '#8B5CF6',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 24,
    elevation: 10,
  },
  icon: {
    fontSize: 40,
    textAlign: 'center',
    marginBottom: 8,
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 16,
    lineHeight: 20,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 14,
  },
  chip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 12,
  },
  chipActive: {
    borderWidth: 2,
    borderColor: ACCENT,
  },
  chipText: {
    fontSize: 15,
    fontWeight: '700',
  },
  stepTitle: {
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  gridScroll: {
    maxHeight: 250,
    marginBottom: 14,
  },
  errorBox: {
    backgroundColor: '#FEE2E2',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginBottom: 10,
  },
  errorText: {
    color: '#DC2626',
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
  },
  submitBtn: {
    backgroundColor: ACCENT,
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
    marginBottom: 10,
    shadowColor: ACCENT,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  submitText: {
    color: '#FFF',
    fontSize: 17,
    fontWeight: '800',
  },
  cancelBtn: {
    paddingVertical: 10,
    alignItems: 'center',
    marginBottom: 6,
  },
  cancelText: {
    fontSize: 15,
    fontWeight: '600',
  },
  disclaimer: {
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 16,
  },
});

export default React.memo(DateOfBirthModal);
