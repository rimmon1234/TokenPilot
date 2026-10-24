import { WorkspaceModel, RoutingPool, PoolMembership, UsageEvent } from '../types';

export interface IWorkspaceRepository {
  // Workspace Models
  getWorkspaceModels(): Promise<WorkspaceModel[]>;
  getWorkspaceModel(id: string): Promise<WorkspaceModel | undefined>;
  saveWorkspaceModel(model: WorkspaceModel): Promise<void>;
  deleteWorkspaceModel(id: string): Promise<void>;

  // Routing Pools
  getRoutingPools(): Promise<RoutingPool[]>;
  saveRoutingPool(pool: RoutingPool): Promise<void>;
  deleteRoutingPool(id: string): Promise<void>;

  // Memberships
  getPoolMemberships(): Promise<PoolMembership[]>;
  savePoolMembership(membership: PoolMembership): Promise<void>;
  removePoolMembership(id: string): Promise<void>;
  removeMembershipsForPool(poolId: string): Promise<void>;
  removeMembershipsForModel(modelId: string): Promise<void>;

  // Usage Events
  getUsageEvents(): Promise<UsageEvent[]>;
  recordUsageEvent(event: UsageEvent): Promise<void>;

  // Initialization check
  isInitialized(): Promise<boolean>;
  setInitialized(): Promise<void>;
}
