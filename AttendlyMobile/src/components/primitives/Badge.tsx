import React from 'react';
import { View, Text, StyleSheet, ViewStyle, StyleProp } from 'react-native';
import { Colors, Spacing, BorderRadius, Typography } from '../../theme/tokens';

export type BadgeVariant = 'default' | 'success' | 'warning' | 'error' | 'accent';

export interface BadgeProps {
  label: string;
  variant?: BadgeVariant;
  style?: StyleProp<ViewStyle>;
}

/**
 * Reusable Badge Primitive
 * Compact status indicators with restrained, high-contrast tinted backgrounds.
 */
export const Badge: React.FC<BadgeProps> = ({
  label,
  variant = 'default',
  style,
}) => {
  return (
    <View style={[styles.base, styles[variant], style]}>
      <Text style={[styles.text, styles[`text_${variant}`]]}>{label}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  base: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: BorderRadius.full,
    alignSelf: 'flex-start',
    justifyContent: 'center',
    alignItems: 'center',
  },
  default: {
    backgroundColor: Colors.surfaceMuted,
  },
  success: {
    backgroundColor: Colors.successLight,
  },
  warning: {
    backgroundColor: Colors.warningLight,
  },
  error: {
    backgroundColor: Colors.errorLight,
  },
  accent: {
    backgroundColor: Colors.accentLight,
  },

  text: {
    ...Typography.captionMedium,
    fontSize: 12,
    lineHeight: 16,
  },
  text_default: {
    color: Colors.textSecondary,
  },
  text_success: {
    color: Colors.success,
  },
  text_warning: {
    color: Colors.warning,
  },
  text_error: {
    color: Colors.error,
  },
  text_accent: {
    color: Colors.accent,
  },
});
