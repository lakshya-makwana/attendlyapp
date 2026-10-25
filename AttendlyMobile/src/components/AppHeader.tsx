import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Colors, Spacing, Typography, BorderRadius } from '../theme/tokens';
import { Icon } from './Icon';

interface AppHeaderProps {
  title: string;
  subtitle?: string;
  rightActionText?: string;
  onRightAction?: () => void;
  onBack?: () => void;
  isOnline?: boolean;
  pendingCount?: number;
}

export const AppHeader: React.FC<AppHeaderProps> = ({
  title,
  subtitle,
  rightActionText,
  onRightAction,
  onBack,
  isOnline = true,
  pendingCount = 0,
}) => {
  return (
    <View style={styles.container}>
      <View style={styles.leftRow}>
        {onBack && (
          <TouchableOpacity
            style={styles.backBtn}
            onPress={onBack}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Back"
          >
            <Icon name="chevron-left" size={22} color={Colors.textPrimary} strokeWidth={2.2} />
          </TouchableOpacity>
        )}
        <View style={styles.left}>
          <Text style={styles.title}>{title}</Text>
          {subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
        </View>
      </View>
      <View style={styles.right}>
        {!isOnline && (
          <View style={styles.offlineBadge}>
            <Icon name="cloud-off" size={12} color={Colors.warning} strokeWidth={2} />
            <Text style={styles.offlineText}>Offline</Text>
          </View>
        )}
        {isOnline && pendingCount > 0 && (
          <View style={styles.syncBadge}>
            <Icon name="refresh-cw" size={12} color={Colors.accent} strokeWidth={2} />
            <Text style={styles.syncText}>{pendingCount} queued</Text>
          </View>
        )}
        {rightActionText && onRightAction && (
          <TouchableOpacity
            style={styles.actionBtn}
            onPress={onRightAction}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={rightActionText}
          >
            <Text style={styles.actionText}>{rightActionText}</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.md,
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  leftRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  backBtn: {
    paddingRight: 4,
    paddingVertical: 4,
    justifyContent: 'center',
    alignItems: 'center',
  },
  left: {
    flex: 1,
  },
  title: {
    ...Typography.titleLarge,
  },
  subtitle: {
    ...Typography.caption,
    marginTop: 2,
  },
  right: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  offlineBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.warningLight,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    borderRadius: BorderRadius.full,
    gap: 4,
  },
  offlineDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.warning,
  },
  offlineText: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.warning,
  },
  syncBadge: {
    backgroundColor: Colors.accentLight,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    borderRadius: BorderRadius.full,
  },
  syncText: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.accent,
  },
  actionBtn: {
    backgroundColor: Colors.textPrimary,
    paddingHorizontal: Spacing.md,
    paddingVertical: 8,
    borderRadius: BorderRadius.md,
    minHeight: 36,
    justifyContent: 'center',
  },
  actionText: {
    color: Colors.textInverse,
    fontSize: 13,
    fontWeight: '600',
  },
});
