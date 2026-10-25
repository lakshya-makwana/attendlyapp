import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors, Spacing, BorderRadius, Typography } from '../theme/tokens';
import { Icon } from './Icon';

export const SummaryCard: React.FC<{
  title: string;
  value: string | number;
  subtitle?: string;
  accent?: boolean;
}> = ({ title, value, subtitle, accent = false }) => {
  return (
    <View style={[styles.card, accent && styles.cardAccent]}>
      <Text style={[styles.cardTitle, accent && styles.cardTitleAccent]}>{title}</Text>
      <Text style={[styles.cardValue, accent && styles.cardValueAccent]}>{value}</Text>
      {subtitle && (
        <Text style={[styles.cardSubtitle, accent && styles.cardSubtitleAccent]}>
          {subtitle}
        </Text>
      )}
    </View>
  );
};

export const StatusPill: React.FC<{
  label: string;
  status: 'active' | 'inactive' | 'synced' | 'pending' | 'offline';
}> = ({ label, status }) => {
  let bg = Colors.surfaceMuted;
  let text = Colors.textSecondary;

  if (status === 'active' || status === 'synced') {
    bg = Colors.successLight;
    text = Colors.success;
  } else if (status === 'inactive') {
    bg = Colors.surfaceMuted;
    text = Colors.textMuted;
  } else if (status === 'pending') {
    bg = Colors.accentLight;
    text = Colors.accent;
  } else if (status === 'offline') {
    bg = Colors.warningLight;
    text = Colors.warning;
  }

  return (
    <View style={[styles.pill, { backgroundColor: bg }]}>
      <Text style={[styles.pillText, { color: text }]}>{label}</Text>
    </View>
  );
};

export const OfflineBanner: React.FC<{ isOnline: boolean; pendingCount: number }> = ({
  isOnline,
  pendingCount,
}) => {
  if (isOnline && pendingCount === 0) return null;

  return (
    <View style={[styles.banner, !isOnline ? styles.bannerOffline : styles.bannerSyncing]}>
      <Icon
        name={!isOnline ? 'cloud-off' : 'refresh-cw'}
        size={14}
        color={Colors.navyAccent}
        strokeWidth={2}
      />
      <Text style={styles.bannerText}>
        {!isOnline
          ? 'Offline mode — local changes are saved and will sync when online'
          : `Syncing ${pendingCount} local update${pendingCount > 1 ? 's' : ''}...`}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    padding: Spacing.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    flex: 1,
  },
  cardAccent: {
    backgroundColor: Colors.textPrimary,
    borderColor: Colors.textPrimary,
  },
  cardTitle: {
    ...Typography.caption,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  cardTitleAccent: {
    color: Colors.textMuted,
  },
  cardValue: {
    ...Typography.numericLarge,
  },
  cardValueAccent: {
    color: Colors.textInverse,
  },
  cardSubtitle: {
    ...Typography.caption,
    marginTop: 4,
  },
  cardSubtitleAccent: {
    color: 'rgba(255, 255, 255, 0.7)',
  },
  pill: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 3,
    borderRadius: BorderRadius.full,
    alignSelf: 'flex-start',
  },
  pillText: {
    fontSize: 12,
    fontWeight: '600',
  },
  banner: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: 8,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  bannerOffline: {
    backgroundColor: Colors.navyAccentLight,
  },
  bannerSyncing: {
    backgroundColor: Colors.navyAccentLight,
  },
  bannerText: {
    fontSize: 12,
    fontWeight: '500',
    color: Colors.textSecondary,
  },
});
