import React from 'react';
import { View, StyleSheet, ViewStyle, StyleProp } from 'react-native';
import { Colors, Spacing } from '../../theme/tokens';

export interface DividerProps {
  vertical?: boolean;
  spacing?: number;
  style?: StyleProp<ViewStyle>;
}

/**
 * Reusable Divider Primitive
 * Minimal hairline separator.
 */
export const Divider: React.FC<DividerProps> = ({
  vertical = false,
  spacing = Spacing.md,
  style,
}) => {
  return (
    <View
      style={[
        vertical ? styles.vertical : styles.horizontal,
        vertical
          ? { marginHorizontal: spacing }
          : { marginVertical: spacing },
        style,
      ]}
    />
  );
};

const styles = StyleSheet.create({
  horizontal: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: Colors.border,
    width: '100%',
  },
  vertical: {
    width: StyleSheet.hairlineWidth,
    backgroundColor: Colors.border,
    height: '100%',
  },
});
