import NetInfo, { NetInfoState } from '@react-native-community/netinfo';
import { getDatabase, normalizeRows, verifyAccountContext } from '../db/database';
import { ApiClient } from '../api/client';
import { AuthStorage } from '../storage/authStorage';
import { WorkerRepository } from '../repositories/workerRepository';
import { SiteRepository } from '../repositories/siteRepository';
import { AttendanceRepository } from '../repositories/attendanceRepository';
import { AdvanceRepository } from '../repositories/advanceRepository';

export interface SyncState {
  isOnline: boolean;
  isSyncing: boolean;
  pendingCount: number;
  lastSyncTime: string | null;
}

export type SyncListener = (state: SyncState) => void;

class SyncManagerClass {
  private isOnline: boolean = true;
  private isSyncing: boolean = false;
  private pendingCount: number = 0;
  private lastSyncTime: string | null = null;
  private listeners: Set<SyncListener> = new Set();
  private syncTimer: any = null;

  init() {
    // Monitor network state
    NetInfo.addEventListener((state: NetInfoState) => {
      const online = Boolean(state.isConnected && state.isInternetReachable !== false);
      const changed = this.isOnline !== online;
      this.isOnline = online;
      if (changed && online) {
        // Back online -> trigger sync
        this.triggerSync();
      }
      this.notifyListeners();
    });

    // Check initial pending count
    this.refreshPendingCount();

    // Periodic sync attempt every 30s
    if (this.syncTimer) clearInterval(this.syncTimer);
    this.syncTimer = setInterval(() => {
      if (this.isOnline && !this.isSyncing) {
        this.triggerSync();
      }
    }, 30000);
  }

  subscribe(listener: SyncListener): () => void {
    this.listeners.add(listener);
    listener({
      isOnline: this.isOnline,
      isSyncing: this.isSyncing,
      pendingCount: this.pendingCount,
      lastSyncTime: this.lastSyncTime,
    });
    return () => this.listeners.delete(listener);
  }

  private notifyListeners() {
    const state = {
      isOnline: this.isOnline,
      isSyncing: this.isSyncing,
      pendingCount: this.pendingCount,
      lastSyncTime: this.lastSyncTime,
    };
    this.listeners.forEach((fn) => fn(state));
  }

  refreshPendingCount(): number {
    try {
      const db = getDatabase();
      const res = db.executeSync(
        "SELECT COUNT(*) as count FROM sync_queue WHERE status = 'PENDING'"
      );
      if (res.rows && res.rows.length > 0) {
        this.pendingCount = (res.rows[0] as any).count || 0;
      }
    } catch {
      this.pendingCount = 0;
    }
    this.notifyListeners();
    return this.pendingCount;
  }

  async triggerSync(): Promise<boolean> {
    if (this.isSyncing) return false;

    const session = await AuthStorage.getSession();
    if (!session.token || !session.accountId) {
      return false;
    }

    // Protect account context: ensure database belongs to the authenticated session
    const verification = verifyAccountContext(session.accountId);
    if (!verification.safe) {
      console.warn('Sync aborted: Account verification check failed:', verification.reason);
      return false;
    }

    this.isSyncing = true;
    this.notifyListeners();

    try {
      const db = getDatabase();

      // 1. Gather all pending items from queue for this account
      const queueRes = db.executeSync(
        "SELECT * FROM sync_queue WHERE account_id = ? AND status = 'PENDING'",
        [session.accountId]
      );

      const items = normalizeRows(queueRes);
      const workers: any[] = [];
      const sites: any[] = [];
      const attendance: any[] = [];
      const advances: any[] = [];

      for (const item of items) {
        try {
          const payload = JSON.parse(item.payload);
          if (item.entity_type === 'worker') workers.push(payload);
          else if (item.entity_type === 'site') {
            if (item.action === 'UPSERT') sites.push(payload);
          }
          else if (item.entity_type === 'attendance') attendance.push(payload);
          else if (item.entity_type === 'advance') {
            if (item.action === 'UPSERT' || !item.action) advances.push(payload);
          }
        } catch {}
      }

      // 2. If there are pending changes, push them to the server
      if (
        workers.length > 0 ||
        sites.length > 0 ||
        attendance.length > 0 ||
        advances.length > 0
      ) {
        const pushRes = await ApiClient.syncPush({
          workers,
          sites,
          attendance,
          advances,
        });

        // Verification: Only mark items synced if the backend explicitly confirms success
        if (!pushRes || !pushRes.success) {
          console.warn('Sync push reported server failure:', pushRes?.errors);
          this.refreshPendingCount();
          return false;
        }

        // Backend confirmed success -> safely remove from queue and mark local records SYNCED
        for (const item of items) {
          if (item.entity_type === 'worker_wage') continue; // Handled separately below
          if (item.entity_type === 'site' && item.action === 'DELETE') continue; // Handled separately below
          if (item.entity_type === 'advance' && item.action === 'DELETE') continue; // Handled separately below
          db.executeSync('DELETE FROM sync_queue WHERE id = ?', [item.id]);
          if (item.entity_type === 'worker') {
            db.executeSync(
              "UPDATE workers SET sync_status = 'SYNCED' WHERE id = ?",
              [item.entity_id]
            );
          } else if (item.entity_type === 'site') {
            db.executeSync(
              "UPDATE sites SET sync_status = 'SYNCED' WHERE id = ?",
              [item.entity_id]
            );
          } else if (item.entity_type === 'attendance') {
            db.executeSync(
              "UPDATE attendance SET sync_status = 'SYNCED' WHERE id = ?",
              [item.entity_id]
            );
          } else if (item.entity_type === 'advance') {
            db.executeSync(
              "UPDATE advances SET sync_status = 'SYNCED' WHERE id = ?",
              [item.entity_id]
            );
          }
        }
      }

      // 2b. Process pending site DELETE operations
      const siteDeleteItems = items.filter(
        it => it.entity_type === 'site' && it.action === 'DELETE'
      );
      for (const dItem of siteDeleteItems) {
        try {
          const payload = JSON.parse(dItem.payload);
          await ApiClient.deleteSite(payload.id);
          db.executeSync('DELETE FROM sync_queue WHERE id = ?', [dItem.id]);
        } catch (delErr: any) {
          console.warn('Sync site delete error:', delErr?.message);
          db.executeSync(
            "UPDATE sync_queue SET status = 'FAILED' WHERE id = ?",
            [dItem.id]
          );
        }
      }

      // 2c. Process pending individual worker_wage items
      const wageItems = items.filter(it => it.entity_type === 'worker_wage');
      for (const wItem of wageItems) {
        try {
          const payload = JSON.parse(wItem.payload);
          if (wItem.action === 'UPSERT') {
            await ApiClient.addWorkerWage(payload.worker_id, {
              daily_wage: payload.daily_wage,
              effective_from: payload.effective_from,
            });
          } else if (wItem.action === 'DELETE') {
            await ApiClient.deleteWorkerWage(payload.worker_id, payload.id);
          }
          db.executeSync('DELETE FROM sync_queue WHERE id = ?', [wItem.id]);
          db.executeSync(
            "UPDATE worker_wage_history SET sync_status = 'SYNCED' WHERE id = ?",
            [wItem.entity_id]
          );
        } catch (err) {
          console.warn('Sync worker_wage error:', err);
        }
      }

      // 2d. Process pending advance DELETE operations
      const advanceDeleteItems = items.filter(
        it => it.entity_type === 'advance' && it.action === 'DELETE'
      );
      for (const dItem of advanceDeleteItems) {
        try {
          const payload = JSON.parse(dItem.payload);
          await ApiClient.deleteAdvance(payload.id);
          db.executeSync('DELETE FROM sync_queue WHERE id = ?', [dItem.id]);
        } catch (delErr: any) {
          console.warn('Sync advance delete error:', delErr?.message);
          db.executeSync(
            "UPDATE sync_queue SET status = 'FAILED' WHERE id = ?",
            [dItem.id]
          );
        }
      }

      // 3. Pull latest server state to ensure complete reconciliation
      const pullData = await ApiClient.syncPull();
      if (pullData) {
        WorkerRepository.saveBatchFromSync(pullData.workers || [], session.accountId);
        SiteRepository.saveBatchFromSync(pullData.sites || [], session.accountId);
        AttendanceRepository.saveBatchFromSync(pullData.attendance || [], session.accountId);
        AdvanceRepository.saveBatchFromSync(pullData.advances || [], session.accountId);
      }

      this.lastSyncTime = new Date().toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      });
      this.refreshPendingCount();
      return true;
    } catch {
      // Pending records are preserved in queue during network timeouts, server errors, or token expiry
      this.refreshPendingCount();
      return false;
    } finally {
      this.isSyncing = false;
      this.notifyListeners();
    }
  }
}

export const SyncManager = new SyncManagerClass();
