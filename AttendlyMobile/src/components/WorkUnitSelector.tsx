import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Spacing, BorderRadius } from '../theme/tokens';

export const WORK_UNIT_VALUES = [
  { value: 0.0, label: '0', sub: 'Absent', accessibleLabel: '0 units Absent' },
  { value: 0.5, label: '0.5', sub: 'Half', accessibleLabel: '0.5 units Half Day' },
  { value: 1.0, label: '1', sub: 'Full', accessibleLabel: '1 unit Full Day' },
  { value: 1.5, label: '1.5', sub: '1.5x', accessibleLabel: '1.5 units Overtime' },
  { value: 2.0, label: '2', sub: '2x', accessibleLabel: '2 units Double Shift' },
];

interface WorkUnitSelectorProps {
  currentValue: number | null | undefined;
  onSelect: (value: number) => void;
  disabled?: boolean;
}

export const WorkUnitSelector: React.FC<WorkUnitSelectorProps> = ({
  currentValue,
  onSelect,
  disabled = false,
}) => {
  return (
    <View style={styles.container} accessibilityRole="radiogroup" accessibilityLabel="Work units selector">
      {WORK_UNIT_VALUES.map(u => {
        const isSelected = currentValue !== null && currentValue !== undefined && Math.abs(currentValue - u.value) < 0.01;
        return (
          <TouchableOpacity
            key={u.value}
            testID={`unit_btn_${u.value}`}
            style={[
              styles.unitButton,
              isSelected && styles.unitButtonSelected,
              disabled && styles.unitButtonDisabled,
            ]}
            onPress={() => !disabled && onSelect(u.value)}
            activeOpacity={0.7}
            disabled={disabled}
            accessibilityRole="radio"
            accessibilityState={{ selected: isSelected, disabled }}
            accessibilityLabel={u.accessibleLabel}
          >
            <Text
              style={[
                styles.unitLabel,
                isSelected && styles.unitLabelSelected,
                disabled && styles.unitTextDisabled,
              ]}
            >
              {u.label}
            </Text>
            <Text
              style={[
                styles.unitSub,
                isSelected && styles.unitSubSelected,
                disabled && styles.unitTextDisabled,
              ]}
            >
              {u.sub}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    gap: 4,
    marginTop: Spacing.sm,
    backgroundColor: '#f4f4f5',
    padding: 4,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: '#e4e4e7',
  },
  unitButton: {
    flex: 1,
    minHeight: 40,
    borderRadius: 8,
    backgroundColor: 'transparent',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 4,
  },
  unitButtonSelected: {
    backgroundColor: '#000000',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.15,
    shadowRadius: 2,
    elevation: 2,
  },
  unitButtonDisabled: {
    opacity: 0.5,
  },
  unitLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: '#52525b',
  },
  unitLabelSelected: {
    color: '#ffffff',
  },
  unitSub: {
    fontSize: 9,
    fontWeight: '600',
    color: '#71717a',
    marginTop: 1,
  },
  unitSubSelected: {
    color: '#fed7aa', // Subtle warm accent on active selection
  },
  unitTextDisabled: {
    color: '#a1a1aa',
  },
});

