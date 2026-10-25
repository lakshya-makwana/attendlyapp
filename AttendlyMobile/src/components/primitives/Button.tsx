import React from 'react';
import {
  Pressable,
  Text,
  StyleSheet,
  ActivityIndicator,
  ViewStyle,
  TextStyle,
  StyleProp,
} from 'react-native';
import { Colors, Spacing, BorderRadius, TouchTarget, Motion } from '../../theme/tokens';

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps {
  title: string;
  onPress: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
  accessibilityLabel?: string;
  testID?: string;
}

/**
 * Reusable Button Primitive
 * Built following Emil Kowalski's responsive design engineering principles:
 * - Subtle scale feedback (0.97) on press for responsive tactile feel.
 * - Minimum touch target >= 44pt for accessible one-handed usability.
 * - Distinct, restrained color contrast matching Attendly Mobile design.
 */
export const Button: React.FC<ButtonProps> = ({
  title,
  onPress,
  variant = 'primary',
  size = 'md',
  disabled = false,
  loading = false,
  style,
  textStyle,
  accessibilityLabel,
  testID,
}) => {
  const isInteractive = !disabled && !loading;

  return (
    <Pressable
      onPress={onPress}
      disabled={!isInteractive}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || title}
      accessibilityState={{ disabled: !isInteractive, busy: loading }}
      testID={testID}
      style={({ pressed }) => [
        styles.base,
        styles[variant],
        styles[`size_${size}`],
        pressed && isInteractive && styles.pressed,
        disabled && styles.disabled,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator
          size="small"
          color={
            variant === 'primary' || variant === 'danger'
              ? Colors.textInverse
              : Colors.textPrimary
          }
        />
      ) : (
        <Text
          style={[
            styles.textBase,
            styles[`text_${variant}`],
            styles[`textSize_${size}`],
            disabled && styles.textDisabled,
            textStyle,
          ]}
        >
          {title}
        </Text>
      )}
    </Pressable>
  );
};

const styles = StyleSheet.create({
  base: {
    borderRadius: BorderRadius.md,
    justifyContent: 'center',
    alignItems: 'center',
    flexDirection: 'row',
  },
  pressed: {
    transform: [{ scale: Motion.scale.pressed }],
    opacity: 0.9,
  },
  disabled: {
    opacity: 0.45,
  },

  // Variants
  primary: {
    backgroundColor: Colors.primary,
  },
  secondary: {
    backgroundColor: Colors.surfaceMuted,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  outline: {
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderColor: Colors.borderStrong,
  },
  ghost: {
    backgroundColor: 'transparent',
  },
  danger: {
    backgroundColor: Colors.error,
  },

  // Sizes
  size_sm: {
    minHeight: TouchTarget.min,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
  },
  size_md: {
    minHeight: TouchTarget.comfortable,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.sm,
  },
  size_lg: {
    minHeight: TouchTarget.large,
    paddingHorizontal: Spacing.xxl,
    paddingVertical: Spacing.md,
  },

  // Text Base
  textBase: {
    fontWeight: '600',
    textAlign: 'center',
  },
  text_primary: {
    color: Colors.textInverse,
  },
  text_secondary: {
    color: Colors.textPrimary,
  },
  text_outline: {
    color: Colors.textPrimary,
  },
  text_ghost: {
    color: Colors.textSecondary,
  },
  text_danger: {
    color: Colors.textInverse,
  },
  textDisabled: {
    color: Colors.textMuted,
  },

  // Text Sizes
  textSize_sm: {
    fontSize: 14,
    lineHeight: 18,
  },
  textSize_md: {
    fontSize: 15,
    lineHeight: 20,
  },
  textSize_lg: {
    fontSize: 16,
    lineHeight: 22,
  },
});
