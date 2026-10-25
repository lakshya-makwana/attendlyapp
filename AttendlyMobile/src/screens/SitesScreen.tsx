import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Modal,
  TextInput,
  ActivityIndicator,
} from 'react-native';
import { Colors, Spacing, Typography, BorderRadius } from '../theme/tokens';
import { AppHeader } from '../components/AppHeader';
import { StatusPill, OfflineBanner } from '../components/Cards';
import { SiteRepository, LocalSite } from '../repositories/siteRepository';
import { SyncManager, SyncState } from '../sync/syncManager';
import { Icon } from '../components/Icon';

interface SitesScreenProps {
  accountId: string;
  onNavigateHome?: () => void;
  onNavigateToAnalytics?: () => void;
}

export const SitesScreen: React.FC<SitesScreenProps> = ({
  accountId,
  onNavigateHome: _onNavigateHome,
  onNavigateToAnalytics,
}) => {
  const [sites, setSites] = useState<LocalSite[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncState, setSyncState] = useState<SyncState>({
    isOnline: true,
    isSyncing: false,
    pendingCount: 0,
    lastSyncTime: null,
  });

  // Filter & Search
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');

  // Feedback Toast
  const [feedback, setFeedback] = useState<{
    message: string;
    type: 'success' | 'error' | 'info';
  } | null>(null);

  // Add / Edit Modal State
  const [modalVisible, setModalVisible] = useState(false);
  const [editingSite, setEditingSite] = useState<LocalSite | null>(null);
  const [name, setName] = useState('');
  const [location, setLocation] = useState('');
  const [nameError, setNameError] = useState('');
  const [saving, setSaving] = useState(false);

  // Delete Dialog State
  const [deleteModalVisible, setDeleteModalVisible] = useState(false);
  const [siteToDelete, setSiteToDelete] = useState<LocalSite | null>(null);
  const [deleteError, setDeleteError] = useState('');

  const showFeedback = useCallback((message: string, type: 'success' | 'error' | 'info' = 'info') => {
    setFeedback({ message, type });
    setTimeout(() => {
      setFeedback(prev => (prev?.message === message ? null : prev));
    }, 3500);
  }, []);

  const loadSites = useCallback(() => {
    try {
      setLoading(true);
      const list = SiteRepository.getAll(accountId, false);
      setSites(list);
    } catch {
      showFeedback('Failed to load local sites.', 'error');
    } finally {
      setLoading(false);
    }
  }, [accountId, showFeedback]);

  useEffect(() => {
    loadSites();
    const unsub = SyncManager.subscribe(state => {
      setSyncState(state);
      loadSites();
    });
    return unsub;
  }, [loadSites]);

  // Counts
  const activeCount = useMemo(() => sites.filter(s => s.is_active).length, [sites]);
  const inactiveCount = useMemo(() => sites.filter(s => !s.is_active).length, [sites]);

  // Filtered List
  const filteredSites = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return sites.filter(s => {
      if (statusFilter === 'active' && !s.is_active) return false;
      if (statusFilter === 'inactive' && s.is_active) return false;
      if (q) {
        const matchesName = s.name.toLowerCase().includes(q);
        const matchesLocation = s.location ? s.location.toLowerCase().includes(q) : false;
        return matchesName || matchesLocation;
      }
      return true;
    });
  }, [sites, statusFilter, searchQuery]);

  // ---------------------------------------------------------------------------
  // Add / Edit Handlers
  // ---------------------------------------------------------------------------
  const handleOpenAdd = () => {
    setEditingSite(null);
    setName('');
    setLocation('');
    setNameError('');
    setModalVisible(true);
  };

  const handleOpenEdit = (site: LocalSite) => {
    setEditingSite(site);
    setName(site.name);
    setLocation(site.location || '');
    setNameError('');
    setModalVisible(true);
  };

  const handleSave = () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setNameError('Site name is required');
      return;
    }
    if (trimmedName.length > 100) {
      setNameError('Site name cannot exceed 100 characters');
      return;
    }

    setSaving(true);
    try {
      if (editingSite) {
        SiteRepository.save({
          id: editingSite.id,
          account_id: accountId,
          name: trimmedName,
          location: location.trim() || null,
          is_active: editingSite.is_active,
          created_at: editingSite.created_at,
        });
        showFeedback(`Work site '${trimmedName}' updated successfully.`, 'success');
      } else {
        SiteRepository.save({
          account_id: accountId,
          name: trimmedName,
          location: location.trim() || null,
          is_active: true,
        });
        showFeedback('New work site added successfully.', 'success');
      }

      setModalVisible(false);
      setName('');
      setLocation('');
      setEditingSite(null);
      loadSites();
      SyncManager.triggerSync();
    } catch {
      showFeedback('Failed to save site.', 'error');
    } finally {
      setSaving(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Toggle Status
  // ---------------------------------------------------------------------------
  const handleToggleStatus = (site: LocalSite) => {
    try {
      SiteRepository.toggleStatus(site.id, accountId);
      const newStatus = !site.is_active ? 'Active' : 'Inactive';
      showFeedback(`${site.name} is now ${newStatus}`, 'info');
      loadSites();
      SyncManager.triggerSync();
    } catch {
      showFeedback('Failed to change site status.', 'error');
    }
  };

  // ---------------------------------------------------------------------------
  // Delete / Deactivate Instead
  // ---------------------------------------------------------------------------
  const handleOpenDelete = (site: LocalSite) => {
    setSiteToDelete(site);
    setDeleteError('');
    setDeleteModalVisible(true);
  };

  const handleDelete = () => {
    if (!siteToDelete) return;
    setDeleteError('');
    try {
      SiteRepository.delete(siteToDelete.id, accountId);
      showFeedback(`Site '${siteToDelete.name}' deleted successfully.`, 'success');
      setDeleteModalVisible(false);
      setSiteToDelete(null);
      loadSites();
      SyncManager.triggerSync();
    } catch (err: any) {
      const msg =
        err?.message ||
        'Cannot delete site with existing attendance. Please deactivate instead.';
      setDeleteError(msg);
    }
  };

  const handleDeactivateInstead = () => {
    if (!siteToDelete) return;
    try {
      if (siteToDelete.is_active) {
        SiteRepository.toggleStatus(siteToDelete.id, accountId);
      }
      showFeedback(`Site '${siteToDelete.name}' deactivated successfully.`, 'info');
      setDeleteModalVisible(false);
      setSiteToDelete(null);
      loadSites();
      SyncManager.triggerSync();
    } catch {
      showFeedback('Failed to deactivate site.', 'error');
    }
  };

  return (
    <View style={styles.container}>
      <AppHeader
        title="Job Sites"
        subtitle={`${activeCount} Active · ${sites.length} Total`}
        rightActionText="+ Add"
        onRightAction={handleOpenAdd}
        isOnline={syncState.isOnline}
        pendingCount={syncState.pendingCount}
      />

      <OfflineBanner
        isOnline={syncState.isOnline}
        pendingCount={syncState.pendingCount}
      />

      {/* Floating feedback toast */}
      {feedback && (
        <View
          style={[
            styles.feedbackBanner,
            feedback.type === 'success' && styles.feedbackSuccess,
            feedback.type === 'error' && styles.feedbackError,
            feedback.type === 'info' && styles.feedbackInfo,
          ]}
        >
          <Icon
            name={
              feedback.type === 'success'
                ? 'check'
                : feedback.type === 'error'
                ? 'alert-circle'
                : 'refresh-cw'
            }
            size={14}
            color={
              feedback.type === 'success'
                ? Colors.success
                : feedback.type === 'error'
                ? Colors.errorText
                : Colors.accent
            }
            strokeWidth={2}
          />
          <Text
            style={[
              styles.feedbackText,
              feedback.type === 'success' && styles.feedbackTextSuccess,
              feedback.type === 'error' && styles.feedbackTextError,
              feedback.type === 'info' && styles.feedbackTextInfo,
            ]}
          >
            {feedback.message}
          </Text>
        </View>
      )}

      {/* Search and Filter Controls */}
      <View style={styles.topControlSection}>
        {/* Search Bar */}
        <View style={styles.searchBar}>
          <Icon
            name="search"
            size={16}
            color={Colors.textSecondary}
            strokeWidth={2}
            style={styles.searchIcon}
          />
          <TextInput
            style={styles.searchInput}
            placeholder="Search by site name or location..."
            placeholderTextColor={Colors.textMuted}
            value={searchQuery}
            onChangeText={setSearchQuery}
            clearButtonMode="while-editing"
            autoCorrect={false}
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity
              onPress={() => setSearchQuery('')}
              style={styles.clearSearchBtn}
              accessibilityLabel="Clear search"
            >
              <Icon name="close" size={14} color={Colors.textSecondary} strokeWidth={2} />
            </TouchableOpacity>
          )}
        </View>

        {/* Filter Pills */}
        <View style={styles.filterPillsRow}>
          <TouchableOpacity
            style={[
              styles.filterPill,
              statusFilter === 'all' && styles.filterPillActive,
            ]}
            onPress={() => setStatusFilter('all')}
            accessibilityRole="button"
            accessibilityState={{ selected: statusFilter === 'all' }}
            accessibilityLabel={`All sites, ${sites.length}`}
          >
            <Text
              style={[
                styles.filterPillText,
                statusFilter === 'all' && styles.filterPillTextActive,
              ]}
            >
              All ({sites.length})
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.filterPill,
              statusFilter === 'active' && styles.filterPillActive,
            ]}
            onPress={() => setStatusFilter('active')}
            accessibilityRole="button"
            accessibilityState={{ selected: statusFilter === 'active' }}
            accessibilityLabel={`Active sites, ${activeCount}`}
          >
            <Text
              style={[
                styles.filterPillText,
                statusFilter === 'active' && styles.filterPillTextActive,
              ]}
            >
              Active ({activeCount})
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.filterPill,
              statusFilter === 'inactive' && styles.filterPillActive,
            ]}
            onPress={() => setStatusFilter('inactive')}
            accessibilityRole="button"
            accessibilityState={{ selected: statusFilter === 'inactive' }}
            accessibilityLabel={`Inactive sites, ${inactiveCount}`}
          >
            <Text
              style={[
                styles.filterPillText,
                statusFilter === 'inactive' && styles.filterPillTextActive,
              ]}
            >
              Inactive ({inactiveCount})
            </Text>
          </TouchableOpacity>

          {onNavigateToAnalytics && (
            <TouchableOpacity
              style={styles.analyticsPill}
              onPress={onNavigateToAnalytics}
              accessibilityRole="button"
              accessibilityLabel="View Site Analytics"
            >
              <Icon name="chart-no-axes-combined" size={13} color={Colors.textPrimary} strokeWidth={2} />
              <Text style={styles.analyticsPillText}>Analytics</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Sites List */}
      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="small" color={Colors.textPrimary} />
          <Text style={styles.loadingText}>Loading job sites...</Text>
        </View>
      ) : filteredSites.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyTitle}>
            {sites.length === 0 ? 'No Job Sites Added' : 'No Matching Sites'}
          </Text>
          <Text style={styles.emptySubtitle}>
            {sites.length === 0
              ? 'Create your project job sites to begin assigning worker attendance.'
              : 'No work sites match the current search or filter.'}
          </Text>
          {sites.length === 0 && (
            <TouchableOpacity
              style={styles.addFirstBtn}
              onPress={handleOpenAdd}
              accessibilityRole="button"
              accessibilityLabel="Add first site"
            >
              <Text style={styles.addFirstBtnText}>+ Add First Site</Text>
            </TouchableOpacity>
          )}
        </View>
      ) : (
        <FlatList
          data={filteredSites}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => {
            const attCount = SiteRepository.getAttendanceCount(item.id, accountId);
            return (
              <View style={[styles.card, !item.is_active && styles.cardInactive]}>
                <View style={styles.cardHeader}>
                  <View
                    style={[
                      styles.siteIconBadge,
                      !item.is_active && styles.siteIconBadgeInactive,
                    ]}
                  >
                    <Icon
                      name="building"
                      size={18}
                      color={item.is_active ? Colors.accent : Colors.textSecondary}
                      strokeWidth={1.8}
                    />
                  </View>

                  <View style={styles.info}>
                    <View style={styles.nameRow}>
                      <Text
                        style={[
                          styles.siteName,
                          !item.is_active && styles.textInactive,
                        ]}
                        numberOfLines={1}
                      >
                        {item.name}
                      </Text>
                      <StatusPill
                        label={item.is_active ? 'Active' : 'Inactive'}
                        status={item.is_active ? 'active' : 'inactive'}
                      />
                    </View>

                    {item.location ? (
                      <View style={styles.locationRow}>
                        <Icon
                          name="pin"
                          size={13}
                          color={Colors.textSecondary}
                          strokeWidth={1.8}
                        />
                        <Text style={styles.locationText} numberOfLines={1}>
                          {item.location}
                        </Text>
                      </View>
                    ) : (
                      <Text style={styles.locationMuted}>No location specified</Text>
                    )}

                    {attCount > 0 && (
                      <View style={styles.attBadge}>
                        <Text style={styles.attBadgeText}>
                          {attCount} attendance record{attCount === 1 ? '' : 's'}
                        </Text>
                      </View>
                    )}
                  </View>
                </View>

                {/* Action Buttons Row */}
                <View style={styles.actionRow}>
                  <TouchableOpacity
                    style={styles.editBtn}
                    onPress={() => handleOpenEdit(item)}
                    accessibilityRole="button"
                    accessibilityLabel={`Edit site ${item.name}`}
                  >
                    <Icon name="edit" size={13} color={Colors.textPrimary} strokeWidth={1.8} />
                    <Text style={styles.editBtnText}>Edit</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[
                      styles.toggleBtn,
                      !item.is_active && styles.toggleBtnReactivate,
                    ]}
                    onPress={() => handleToggleStatus(item)}
                    accessibilityRole="button"
                    accessibilityLabel={`${item.is_active ? 'Deactivate' : 'Activate'} site ${item.name}`}
                  >
                    <Text
                      style={[
                        styles.toggleBtnText,
                        !item.is_active && styles.toggleBtnTextReactivate,
                      ]}
                    >
                      {item.is_active ? 'Deactivate' : 'Activate'}
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.deleteBtn}
                    onPress={() => handleOpenDelete(item)}
                    accessibilityRole="button"
                    accessibilityLabel={`Delete site ${item.name}`}
                  >
                    <Icon name="trash" size={13} color={Colors.errorText} strokeWidth={1.8} />
                    <Text style={styles.deleteBtnText}>Delete</Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          }}
        />
      )}

      {/* Add / Edit Site Modal */}
      <Modal visible={modalVisible} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {editingSite ? `Edit ${editingSite.name}` : 'Add Work Site'}
              </Text>
              <TouchableOpacity
                onPress={() => setModalVisible(false)}
                accessibilityLabel="Close dialog"
                style={styles.modalCloseBtn}
              >
                <Icon name="close" size={18} color={Colors.textSecondary} strokeWidth={2} />
              </TouchableOpacity>
            </View>

            <Text style={styles.label}>
              Site Name <Text style={styles.requiredStar}>*</Text>
            </Text>
            <TextInput
              style={[styles.input, !!nameError && styles.inputError]}
              placeholder="e.g. Bandra Residential Complex"
              placeholderTextColor={Colors.textMuted}
              value={name}
              onChangeText={val => {
                setName(val);
                if (nameError) setNameError('');
              }}
              autoFocus
            />
            {nameError ? (
              <Text style={styles.fieldErrorText}>{nameError}</Text>
            ) : (
              <Text style={styles.helperText}>Renaming preserves past attendance records.</Text>
            )}

            <Text style={styles.label}>Address / Landmark (Optional)</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. Near Metro Station, Sector 62"
              placeholderTextColor={Colors.textMuted}
              value={location}
              onChangeText={setLocation}
            />
            <Text style={styles.helperText}>Optional location reference for this site.</Text>

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.cancelBtn}
                onPress={() => setModalVisible(false)}
              >
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.saveBtn, saving && styles.saveBtnDisabled]}
                onPress={handleSave}
                disabled={saving}
              >
                <Text style={styles.saveBtnText}>
                  {saving ? 'Saving...' : editingSite ? 'Update Site' : 'Add Site'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Delete / Deactivate Confirmation Dialog */}
      <Modal visible={deleteModalVisible} animationType="fade" transparent>
        <View style={styles.modalOverlayCenter}>
          <View style={styles.deleteDialogContent}>
            <Text style={styles.deleteDialogTitle}>
              {deleteError ? 'Cannot Delete Site' : 'Delete Work Site'}
            </Text>

            {deleteError ? (
              <View style={styles.warningBox}>
                <View style={styles.warningRow}>
                  <Icon name="alert-circle" size={16} color="#c2410c" strokeWidth={2} />
                  <Text style={styles.warningText}>{deleteError}</Text>
                </View>
              </View>
            ) : (
              <Text style={styles.deleteDialogBody}>
                Are you sure you want to delete <Text style={styles.deleteDialogBold}>{siteToDelete?.name}</Text>?
                {'\n\n'}
                If attendance was ever recorded at this site, deletion will be blocked to maintain historical records.
              </Text>
            )}

            <View style={styles.deleteDialogActions}>
              <TouchableOpacity
                style={styles.deleteCancelBtn}
                onPress={() => setDeleteModalVisible(false)}
              >
                <Text style={styles.deleteCancelBtnText}>Cancel</Text>
              </TouchableOpacity>

              {deleteError ? (
                <TouchableOpacity
                  style={styles.deactivateInsteadBtn}
                  onPress={handleDeactivateInstead}
                >
                  <Text style={styles.deactivateInsteadBtnText}>Deactivate Site Instead</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  style={styles.confirmDeleteBtn}
                  onPress={handleDelete}
                >
                  <Text style={styles.confirmDeleteBtnText}>Delete Site</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  topControlSection: {
    backgroundColor: Colors.surface,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surfaceMuted,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: Spacing.md,
    height: 40,
    marginBottom: Spacing.sm,
  },
  searchIcon: {
    marginRight: Spacing.xs,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: Colors.textPrimary,
    paddingVertical: 0,
  },
  clearSearchBtn: {
    padding: Spacing.xs,
  },
  filterPillsRow: {
    flexDirection: 'row',
    gap: Spacing.xs,
    paddingBottom: 2,
  },
  filterPill: {
    paddingVertical: 5,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.full,
    backgroundColor: Colors.surfaceMuted,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  filterPillActive: {
    backgroundColor: Colors.textPrimary,
    borderColor: Colors.textPrimary,
  },
  filterPillText: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  filterPillTextActive: {
    color: Colors.surface,
  },
  analyticsPill: {
    marginLeft: 'auto',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 5,
    paddingHorizontal: Spacing.sm,
    borderRadius: BorderRadius.full,
    backgroundColor: '#f4f4f5',
    borderWidth: 1,
    borderColor: '#e4e4e7',
  },
  analyticsPillText: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  feedbackBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.md,
    gap: Spacing.xs,
    borderWidth: 1,
  },
  feedbackSuccess: {
    backgroundColor: '#f0fdf4',
    borderColor: '#bbf7d0',
  },
  feedbackError: {
    backgroundColor: '#fef2f2',
    borderColor: '#fecaca',
  },
  feedbackInfo: {
    backgroundColor: '#eff6ff',
    borderColor: '#bfdbfe',
  },
  feedbackText: {
    fontSize: 13,
    fontWeight: '600',
    flex: 1,
  },
  feedbackTextSuccess: {
    color: Colors.success,
  },
  feedbackTextError: {
    color: Colors.errorText,
  },
  feedbackTextInfo: {
    color: '#1d4ed8',
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.xxxl,
    gap: Spacing.sm,
  },
  loadingText: {
    ...Typography.caption,
    color: Colors.textSecondary,
  },
  listContent: {
    padding: Spacing.lg,
    gap: Spacing.md,
  },
  card: {
    backgroundColor: Colors.surface,
    padding: Spacing.md,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  cardInactive: {
    backgroundColor: Colors.surfaceMuted,
    opacity: 0.85,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.md,
  },
  siteIconBadge: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#fff7ed',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#fed7aa',
  },
  siteIconBadgeInactive: {
    backgroundColor: '#f4f4f5',
    borderColor: '#e4e4e7',
  },
  info: {
    flex: 1,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.xs,
  },
  siteName: {
    ...Typography.titleSmall,
    flex: 1,
  },
  textInactive: {
    color: Colors.textSecondary,
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
  },
  locationText: {
    ...Typography.caption,
    color: Colors.textSecondary,
    flex: 1,
  },
  locationMuted: {
    ...Typography.caption,
    marginTop: 4,
    color: Colors.textMuted,
    fontStyle: 'italic',
  },
  attBadge: {
    alignSelf: 'flex-start',
    backgroundColor: '#f4f4f5',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 4,
    marginTop: 6,
  },
  attBadgeText: {
    fontSize: 11,
    color: Colors.textSecondary,
    fontWeight: '500',
  },
  actionRow: {
    marginTop: Spacing.md,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    paddingTop: Spacing.sm,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: Spacing.xs,
  },
  editBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: Spacing.sm,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  editBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  toggleBtn: {
    paddingVertical: 6,
    paddingHorizontal: Spacing.sm,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  toggleBtnReactivate: {
    borderColor: '#bfdbfe',
    backgroundColor: '#eff6ff',
  },
  toggleBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  toggleBtnTextReactivate: {
    color: '#1d4ed8',
  },
  deleteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: Spacing.sm,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: '#fecaca',
    backgroundColor: '#fef2f2',
  },
  deleteBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.errorText,
  },
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: Spacing.xxxl,
    paddingHorizontal: Spacing.xl,
  },
  emptyTitle: {
    ...Typography.titleMedium,
    color: Colors.textPrimary,
  },
  emptySubtitle: {
    ...Typography.caption,
    textAlign: 'center',
    marginTop: Spacing.xs,
    maxWidth: 280,
    color: Colors.textSecondary,
  },
  addFirstBtn: {
    marginTop: Spacing.lg,
    backgroundColor: Colors.textPrimary,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.md,
  },
  addFirstBtnText: {
    color: Colors.surface,
    fontSize: 14,
    fontWeight: '700',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: BorderRadius.xl,
    borderTopRightRadius: BorderRadius.xl,
    padding: Spacing.xl,
    paddingBottom: Spacing.xxxl,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.md,
  },
  modalTitle: {
    ...Typography.titleMedium,
    fontWeight: '700',
  },
  modalCloseBtn: {
    padding: Spacing.xs,
  },
  label: {
    ...Typography.captionMedium,
    color: Colors.textPrimary,
    marginTop: Spacing.md,
    marginBottom: 6,
  },
  requiredStar: {
    color: Colors.errorText,
  },
  input: {
    height: 46,
    borderWidth: 1,
    borderColor: Colors.borderStrong,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md,
    fontSize: 14,
    color: Colors.textPrimary,
    backgroundColor: Colors.surface,
  },
  inputError: {
    borderColor: Colors.errorText,
  },
  fieldErrorText: {
    fontSize: 12,
    color: Colors.errorText,
    marginTop: 4,
  },
  helperText: {
    fontSize: 12,
    color: Colors.textMuted,
    marginTop: 4,
  },
  modalActions: {
    flexDirection: 'row',
    gap: Spacing.md,
    marginTop: Spacing.xl,
  },
  cancelBtn: {
    flex: 1,
    height: 44,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.surface,
  },
  cancelBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  saveBtn: {
    flex: 1,
    height: 44,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.textPrimary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtnDisabled: {
    opacity: 0.6,
  },
  saveBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.surface,
  },
  modalOverlayCenter: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.xl,
  },
  deleteDialogContent: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    padding: Spacing.xl,
    width: '100%',
    maxWidth: 380,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  deleteDialogTitle: {
    ...Typography.titleMedium,
    fontWeight: '700',
    marginBottom: Spacing.sm,
  },
  deleteDialogBody: {
    fontSize: 14,
    color: Colors.textSecondary,
    lineHeight: 20,
    marginBottom: Spacing.lg,
  },
  deleteDialogBold: {
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  warningBox: {
    backgroundColor: '#fff7ed',
    borderColor: '#fed7aa',
    borderWidth: 1,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    marginBottom: Spacing.lg,
  },
  warningRow: {
    flexDirection: 'row',
    gap: Spacing.xs,
    alignItems: 'flex-start',
  },
  warningText: {
    fontSize: 13,
    color: '#c2410c',
    flex: 1,
    lineHeight: 18,
    fontWeight: '500',
  },
  deleteDialogActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: Spacing.sm,
  },
  deleteCancelBtn: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 10,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  deleteCancelBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  deactivateInsteadBtn: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 10,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.textPrimary,
  },
  deactivateInsteadBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.surface,
  },
  confirmDeleteBtn: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 10,
    borderRadius: BorderRadius.md,
    backgroundColor: '#dc2626',
  },
  confirmDeleteBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.surface,
  },
});
