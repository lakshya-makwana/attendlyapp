import React, { useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  ViewStyle,
  StyleProp,
} from 'react-native';
import { Colors, Spacing, Typography, TouchTarget } from '../../theme/tokens';

export interface MpinInputProps {
  value: string;
  onChangeText: (text: string) => void;
  masked?: boolean;
  error?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
  hideNativeKeyboard?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export const MPIN_LENGTH = 4;

/**
 * 4-Digit MPIN Input Component
 * Built for contractor mobile usability and absolute PWA visual parity:
 * - Exactly 4 tactile, accessible digit boxes (58pt x 58pt with 13pt radius).
 * - High-contrast states:
 *   - Empty: Warm off-white canvas with #d4d4d8 border.
 *   - Active: White surface with #ea580c orange focus border and soft glow.
 *   - Filled: White surface with #09090b dark border and 14pt obsidian dot.
 *   - Error: Warm #fff7ed tint with #ea580c border.
 * - Supports both hidden native keyboard input and custom on-screen keypad.
 */
export const MpinInput: React.FC<MpinInputProps> = ({
  value,
  onChangeText,
  masked = true,
  error = false,
  disabled = false,
  autoFocus = false,
  hideNativeKeyboard = false,
  style,
  testID = 'mpin-input',
}) => {
  const inputRef = useRef<any>(null);

  const handlePress = () => {
    if (!disabled && !hideNativeKeyboard && inputRef.current && typeof inputRef.current.focus === 'function') {
      inputRef.current.focus();
    }
  };

  const cleanValue = value.replace(/[^\d]/g, '').slice(0, MPIN_LENGTH);

  return (
    <Pressable
      onPress={handlePress}
      style={[styles.container, style]}
      accessibilityRole="group"
      accessibilityLabel="4-digit MPIN input"
      disabled={disabled || hideNativeKeyboard}
    >
      {/* Hidden real TextInput when using native keyboard */}
      {!hideNativeKeyboard && (
        <TextInput
          ref={inputRef}
          value={cleanValue}
          onChangeText={(text) => {
            const digits = text.replace(/[^\d]/g, '').slice(0, MPIN_LENGTH);
            onChangeText(digits);
          }}
          keyboardType="number-pad"
          maxLength={MPIN_LENGTH}
          autoFocus={autoFocus}
          editable={!disabled}
          testID={testID}
          style={styles.hiddenInput}
          caretHidden
        />
      )}

      {/* 4 Tactile Visual Digit Slots in ONE Row */}
      <View style={styles.slotsRow} testID={hideNativeKeyboard ? testID : undefined}>
        {Array.from({ length: MPIN_LENGTH }).map((_, index) => {
          const isFilled = index < cleanValue.length;
          const isActive = index === cleanValue.length && !disabled && !error;
          const isSlotError = error;
          const digit = cleanValue[index];

          return (
            <View
              key={index}
              accessible={true}
              accessibilityLabel={`Digit ${index + 1} of 4${isFilled ? ' filled' : ''}`}
              style={[
                styles.slot,
                isActive && styles.slotActive,
                isFilled && styles.slotFilled,
                isSlotError && styles.slotError,
                disabled && styles.slotDisabled,
              ]}
            >
              {isFilled ? (
                masked ? (
                  <View style={styles.dot} />
                ) : (
                  <Text style={styles.digitText}>{digit}</Text>
                )
              ) : null}
            </View>
          );
        })}
      </View>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  container: {
    marginVertical: Spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: TouchTarget.large,
  },
  hiddenInput: {
    position: 'absolute',
    opacity: 0,
    width: '100%',
    height: '100%',
  },
  slotsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 14,
    maxWidth: 320,
    width: '100%',
  },
  slot: {
    width: 58,
    height: 58,
    backgroundColor: Colors.background,
    borderWidth: 1.5,
    borderColor: Colors.borderStrong,
    borderRadius: 13,
    justifyContent: 'center',
    alignItems: 'center',
  },
  slotActive: {
    borderColor: Colors.accent,
    backgroundColor: Colors.surface,
    borderWidth: 2,
    shadowColor: Colors.accent,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.18,
    shadowRadius: 5,
    elevation: 2,
  },
  slotFilled: {
    borderColor: Colors.textPrimary,
    backgroundColor: Colors.surface,
    borderWidth: 2,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 1,
  },
  slotError: {
    borderColor: Colors.accent,
    backgroundColor: Colors.accentLight,
    borderWidth: 2,
    shadowColor: Colors.accent,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
  },
  slotDisabled: {
    opacity: 0.45,
  },
  dot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: Colors.textPrimary,
  },
  digitText: {
    ...Typography.numericMedium,
    color: Colors.textPrimary,
    fontWeight: '700',
  },
});
