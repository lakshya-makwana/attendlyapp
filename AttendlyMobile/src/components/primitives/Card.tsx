import React from 'react';
import {
  View,
  Pressable,
  StyleSheet,
  ViewStyle,
  StyleProp,
} from 'react-native';
import { Colors, Spacing, BorderRadius, Shadows, Motion } from '../../theme/tokens';

export interface CardProps {
  children: React.ReactNode;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  elevated?: boolean;
}

/**
 * Reusable Card Primitive
 * Clean, native-feeling surface container with subtle border and optional press micro-interaction.
 */
export const Card: React.FC<CardProps> = ({
  children,
  onPress,
  style,
  elevated = false,
}) => {
  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [
          styles.card,
          elevated && Shadows.card,
          pressed && styles.pressed,
          style,
        ]}
      >
        {children}
      </Pressable>
    );
  }

  return (
    <View style={[styles.card, elevated && Shadows.card, style]}>
      {children}
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: BorderRadius.lg,
    padding: Spacing.lg,
    marginBottom: Spacing.md,
  },
  pressed: {
    transform: [{ scale: Motion.scale.subtlePressed }],
    opacity: 0.95,
  },
});
