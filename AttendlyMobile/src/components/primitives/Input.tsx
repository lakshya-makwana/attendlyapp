import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TextInputProps,
  StyleSheet,
  ViewStyle,
  StyleProp,
} from 'react-native';
import { Colors, Spacing, BorderRadius, Typography, TouchTarget } from '../../theme/tokens';

export interface InputProps extends TextInputProps {
  label?: string;
  error?: string;
  helperText?: string;
  containerStyle?: StyleProp<ViewStyle>;
}

/**
 * Reusable Input Primitive
 * Minimal, native-feeling text input with clear focus states and accessible touch height.
 */
export const Input: React.FC<InputProps> = ({
  label,
  error,
  helperText,
  containerStyle,
  onFocus,
  onBlur,
  style,
  ...props
}) => {
  const [isFocused, setIsFocused] = useState(false);

  const handleFocus = (e: any) => {
    setIsFocused(true);
    if (onFocus) onFocus(e);
  };

  const handleBlur = (e: any) => {
    setIsFocused(false);
    if (onBlur) onBlur(e);
  };

  const hasError = !!error;

  return (
    <View style={[styles.container, containerStyle]}>
      {label && <Text style={styles.label}>{label}</Text>}
      <View
        style={[
          styles.inputWrapper,
          isFocused && styles.focusedWrapper,
          hasError && styles.errorWrapper,
        ]}
      >
        <TextInput
          placeholderTextColor={Colors.textMuted}
          style={[styles.input, style]}
          onFocus={handleFocus}
          onBlur={handleBlur}
          {...props}
        />
      </View>
      {hasError ? (
        <Text style={styles.errorText}>{error}</Text>
      ) : helperText ? (
        <Text style={styles.helperText}>{helperText}</Text>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginBottom: Spacing.md,
    width: '100%',
  },
  label: {
    ...Typography.captionMedium,
    color: Colors.textPrimary,
    marginBottom: Spacing.xs,
  },
  inputWrapper: {
    minHeight: TouchTarget.comfortable,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md,
    justifyContent: 'center',
  },
  focusedWrapper: {
    borderColor: Colors.borderFocus,
    borderWidth: 1.5,
  },
  errorWrapper: {
    borderColor: Colors.error,
  },
  input: {
    ...Typography.bodyRegular,
    color: Colors.textPrimary,
    paddingVertical: Spacing.sm,
    fontSize: 16,
  },
  errorText: {
    ...Typography.caption,
    color: Colors.error,
    marginTop: Spacing.xs,
  },
  helperText: {
    ...Typography.caption,
    color: Colors.textSecondary,
    marginTop: Spacing.xs,
  },
});
