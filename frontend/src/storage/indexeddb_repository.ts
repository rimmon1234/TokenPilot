import { openDB, DBSchema, IDBPDatabase } from 'idb';
import {
  WorkspaceModel,
  RoutingPool,
  PoolMembership,
  UsageEvent,
  Conversation,
  WorkspaceSettings,
} from '../types';
import { IWorkspaceRepository } from './repository';

interface TokenPilotDB extends DBSchema {
  workspace_models: {
    key: string;
    value: WorkspaceModel;
  };
  routing_pools: {
    key: string;
    value: RoutingPool;
  };
  pool_memberships: {
    key: string;
    value: PoolMembership;
    indexes: {
      'by-pool': string;
      'by-model': string;
    };
  };
  usage_events: {
    key: string;
    value: UsageEvent;
    indexes: {
      'by-model': string;
      'by-timestamp': string;
      'by-conversation': string;
    };
  };
  conversations: {
    key: string;
    value: Conversation;
    indexes: {
      'by-updated': string;
    };
  };
  meta: {
    key: string;
    value: { key: string; val: any };
  };
}

const DB_NAME = 'tokenpilot_workspace_db';
const DB_VERSION = 2;

export class IndexedDBWorkspaceRepository implements IWorkspaceRepository {
  private dbPromise: Promise<IDBPDatabase<TokenPilotDB>> | null = null;
  // Fallback in-memory map for non-browser or disabled IndexedDB environments
  private inMemoryModels = new Map<string, WorkspaceModel>();
  private inMemoryPools = new Map<string, RoutingPool>();
  private inMemoryMemberships = new Map<string, PoolMembership>();
  private inMemoryEvents = new Map<string, UsageEvent>();
  private inMemoryConversations = new Map<string, Conversation>();
  private inMemoryMeta = new Map<string, any>();
  private isFallback = false;

  constructor() {
    if (typeof window === 'undefined' || !window.indexedDB) {
      this.isFallback = true;
    }
  }

  private async getDB(): Promise<IDBPDatabase<TokenPilotDB> | null> {
    if (this.isFallback) return null;
    if (!this.dbPromise) {
      try {
        this.dbPromise = openDB<TokenPilotDB>(DB_NAME, DB_VERSION, {
          upgrade(db) {
            if (!db.objectStoreNames.contains('workspace_models')) {
              db.createObjectStore('workspace_models', { keyPath: 'id' });
            }
            if (!db.objectStoreNames.contains('routing_pools')) {
              db.createObjectStore('routing_pools', { keyPath: 'id' });
            }
            if (!db.objectStoreNames.contains('pool_memberships')) {
              const membershipStore = db.createObjectStore('pool_memberships', { keyPath: 'id' });
              membershipStore.createIndex('by-pool', 'pool_id');
              membershipStore.createIndex('by-model', 'model_id');
            }
            if (!db.objectStoreNames.contains('usage_events')) {
              const eventStore = db.createObjectStore('usage_events', { keyPath: 'id' });
              eventStore.createIndex('by-model', 'workspace_model_id');
              eventStore.createIndex('by-timestamp', 'timestamp');
              eventStore.createIndex('by-conversation', 'conversation_id');
            }
            if (!db.objectStoreNames.contains('conversations')) {
              const convStore = db.createObjectStore('conversations', { keyPath: 'id' });
              convStore.createIndex('by-updated', 'updated_at');
            }
            if (!db.objectStoreNames.contains('meta')) {
              db.createObjectStore('meta', { keyPath: 'key' });
            }
          },
        });
      } catch (err) {
        console.warn('Failed to open IndexedDB, falling back to memory store:', err);
        this.isFallback = true;
        return null;
      }
    }
    return this.dbPromise;
  }

  // --- Workspace Models ---

  async getWorkspaceModels(): Promise<WorkspaceModel[]> {
    const db = await this.getDB();
    if (!db) return Array.from(this.inMemoryModels.values());
    return db.getAll('workspace_models');
  }

  async getWorkspaceModel(id: string): Promise<WorkspaceModel | undefined> {
    const db = await this.getDB();
    if (!db) return this.inMemoryModels.get(id);
    return db.get('workspace_models', id);
  }

  async saveWorkspaceModel(model: WorkspaceModel): Promise<void> {
    const db = await this.getDB();
    if (!db) {
      this.inMemoryModels.set(model.id, model);
      return;
    }
    await db.put('workspace_models', model);
  }

  async deleteWorkspaceModel(id: string): Promise<void> {
    // Note: Historical usage events and conversations are preserved!
    const db = await this.getDB();
    if (!db) {
      this.inMemoryModels.delete(id);
      await this.removeMembershipsForModel(id);
      return;
    }
    await db.delete('workspace_models', id);
    await this.removeMembershipsForModel(id);
  }

  // --- Routing Pools ---

  async getRoutingPools(): Promise<RoutingPool[]> {
    const db = await this.getDB();
    if (!db) return Array.from(this.inMemoryPools.values());
    return db.getAll('routing_pools');
  }

  async saveRoutingPool(pool: RoutingPool): Promise<void> {
    const db = await this.getDB();
    if (!db) {
      this.inMemoryPools.set(pool.id, pool);
      return;
    }
    await db.put('routing_pools', pool);
  }

  async deleteRoutingPool(id: string): Promise<void> {
    const db = await this.getDB();
    if (!db) {
      this.inMemoryPools.delete(id);
      await this.removeMembershipsForPool(id);
      return;
    }
    await db.delete('routing_pools', id);
    await this.removeMembershipsForPool(id);
  }

  // --- Memberships ---

  async getPoolMemberships(): Promise<PoolMembership[]> {
    const db = await this.getDB();
    if (!db) return Array.from(this.inMemoryMemberships.values());
    return db.getAll('pool_memberships');
  }

  async savePoolMembership(membership: PoolMembership): Promise<void> {
    const db = await this.getDB();
    if (!db) {
      this.inMemoryMemberships.set(membership.id, membership);
      return;
    }
    await db.put('pool_memberships', membership);
  }

  async removePoolMembership(id: string): Promise<void> {
    const db = await this.getDB();
    if (!db) {
      this.inMemoryMemberships.delete(id);
      return;
    }
    await db.delete('pool_memberships', id);
  }

  async removeMembershipsForPool(poolId: string): Promise<void> {
    const db = await this.getDB();
    if (!db) {
      for (const [id, m] of Array.from(this.inMemoryMemberships.entries())) {
        if (m.pool_id === poolId) this.inMemoryMemberships.delete(id);
      }
      return;
    }
    const tx = db.transaction('pool_memberships', 'readwrite');
    const index = tx.store.index('by-pool');
    let cursor = await index.openCursor(poolId);
    while (cursor) {
      await cursor.delete();
      cursor = await cursor.continue();
    }
    await tx.done;
  }

  async removeMembershipsForModel(modelId: string): Promise<void> {
    const db = await this.getDB();
    if (!db) {
      for (const [id, m] of Array.from(this.inMemoryMemberships.entries())) {
        if (m.model_id === modelId) this.inMemoryMemberships.delete(id);
      }
      return;
    }
    const tx = db.transaction('pool_memberships', 'readwrite');
    const index = tx.store.index('by-model');
    let cursor = await index.openCursor(modelId);
    while (cursor) {
      await cursor.delete();
      cursor = await cursor.continue();
    }
    await tx.done;
  }

  // --- Conversations ---

  async getConversations(): Promise<Conversation[]> {
    const db = await this.getDB();
    if (!db) {
      const list = Array.from(this.inMemoryConversations.values());
      return list.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
    }
    const list = await db.getAll('conversations');
    return list.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
  }

  async getConversation(id: string): Promise<Conversation | undefined> {
    const db = await this.getDB();
    if (!db) return this.inMemoryConversations.get(id);
    return db.get('conversations', id);
  }

  async saveConversation(conversation: Conversation): Promise<void> {
    const db = await this.getDB();
    if (!db) {
      this.inMemoryConversations.set(conversation.id, conversation);
      return;
    }
    await db.put('conversations', conversation);
  }

  async deleteConversation(id: string): Promise<void> {
    // Explicitly delete only the conversation. Usage events are preserved!
    const db = await this.getDB();
    if (!db) {
      this.inMemoryConversations.delete(id);
      return;
    }
    await db.delete('conversations', id);
  }

  async clearAllConversations(): Promise<void> {
    const db = await this.getDB();
    if (!db) {
      this.inMemoryConversations.clear();
      return;
    }
    await db.clear('conversations');
  }

  // --- Settings & Retention ---

  async getSettings(): Promise<WorkspaceSettings> {
    const db = await this.getDB();
    const defaultSettings: WorkspaceSettings = { retain_prompts: true };
    if (!db) {
      return this.inMemoryMeta.get('settings') || defaultSettings;
    }
    const record = await db.get('meta', 'settings');
    return record?.val || defaultSettings;
  }

  async saveSettings(settings: WorkspaceSettings): Promise<void> {
    const db = await this.getDB();
    if (!db) {
      this.inMemoryMeta.set('settings', settings);
      return;
    }
    await db.put('meta', { key: 'settings', val: settings });
  }

  // --- Usage Events ---

  async getUsageEvents(): Promise<UsageEvent[]> {
    const db = await this.getDB();
    if (!db) {
      const list = Array.from(this.inMemoryEvents.values());
      return list.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    }
    const list = await db.getAll('usage_events');
    return list.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }

  /**
   * Idempotently saves or updates a usage event.
   * If a record with event.id exists, it is updated in-place without duplicating records.
   */
  async recordUsageEvent(event: UsageEvent): Promise<void> {
    const db = await this.getDB();
    if (!db) {
      this.inMemoryEvents.set(event.id, event);
      return;
    }
    await db.put('usage_events', event);
  }

  async clearAllUsageEvents(): Promise<void> {
    const db = await this.getDB();
    if (!db) {
      this.inMemoryEvents.clear();
      return;
    }
    await db.clear('usage_events');
  }

  // --- Meta / Initialization ---

  async isInitialized(): Promise<boolean> {
    const db = await this.getDB();
    if (!db) return !!this.inMemoryMeta.get('initialized');
    const record = await db.get('meta', 'initialized');
    return !!record?.val;
  }

  async setInitialized(): Promise<void> {
    const db = await this.getDB();
    if (!db) {
      this.inMemoryMeta.set('initialized', true);
      return;
    }
    await db.put('meta', { key: 'initialized', val: true });
  }
}

// Singleton repository instance
export const workspaceRepo = new IndexedDBWorkspaceRepository();
