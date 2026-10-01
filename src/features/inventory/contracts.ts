import type { DataEnvelope } from '../../contracts/envelope';

export const INVENTORY_ENTITY_TYPES = [
  'component',
  'gcp_project',
  'repository',
  'workflow',
] as const;

export type KnownInventoryEntityType = (typeof INVENTORY_ENTITY_TYPES)[number];
export type InventoryEntityType = KnownInventoryEntityType | 'unknown';

export interface ComponentAttributes {
  componentType: string | null;
  lifecycle: string | null;
}

export interface GcpProjectAttributes {
  projectId: string | null;
}

export interface RepositoryAttributes {
  archived: boolean | null;
  createdAt: string | null;
  description: string | null;
  forked: boolean | null;
  fullName: string | null;
  host: string | null;
  lastBotCommit: {
    committedAt: string | null;
    sha: string | null;
  };
  lastHumanCommit: {
    committedAt: string | null;
    sha: string | null;
  };
  organization: string | null;
  pushedAt: string | null;
  repositoryName: string | null;
}

export interface WorkflowAttributes {
  bqDestinationTableProjects: string[];
  bqJobProjects: string[];
  enabled: boolean | null;
  offset: string | null;
  orchestrationType: string | null;
  parentComponentId: string | null;
  schedule: string | null;
  serviceAccount: string | null;
  orchestratorComponentId: string | null;
  orchestratorWorkflowId: string | null;
  workflowType: string | null;
}

export interface InventoryEntityAttributes {
  component?: ComponentAttributes;
  gcpProject?: GcpProjectAttributes;
  repository?: RepositoryAttributes;
  workflow?: WorkflowAttributes;
}

export interface InventoryEntity {
  attributes: InventoryEntityAttributes;
  id: string;
  initiativeTags: string[];
  name: string;
  owner: string | null;
  type: InventoryEntityType;
  url: string | null;
}

export interface InventoryRelationship {
  sourceEntityId: string;
  statuses: string[];
  targetEntityId: string;
  type: string;
}

export interface InventorySnapshot {
  entities: InventoryEntity[];
  relationships: InventoryRelationship[];
  snapshotAt: string;
  snapshotId: string;
}

export type InventoryDataEnvelope = DataEnvelope<
  InventorySnapshot,
  Record<string, never>
>;

export interface InventoryApiError {
  error: {
    code: 'method_not_allowed' | 'query_failed';
    message: string;
    retryable: boolean;
  };
}

export type WorkflowHealthStatus =
  'failed' | 'running' | 'success' | 'unknown' | 'waiting';

export interface WorkflowPartitionHealth {
  attempts: number;
  completionOffsetMs: number | null;
  dependencyWaitMs: number | null;
  dependencyWaitPending: boolean;
  finishedAt: string | null;
  missingDependencyAttempts: number;
  parameter: string;
  runtimeMs: number | null;
  status: WorkflowHealthStatus;
  statusCounts: Record<string, number>;
  triggeredAt: string | null;
}

export interface WorkflowHealth {
  componentId: string;
  latest: WorkflowPartitionHealth | null;
  partitions: WorkflowPartitionHealth[];
  summary: {
    medianCompletionOffsetMs: number | null;
    medianRuntimeMs: number | null;
    successfulPartitions: number;
    successRate: number | null;
    terminalPartitions: number;
  };
  workflowId: string;
}

export interface WorkflowHealthFilters {
  componentId: string;
  workflowId: string;
}

export type WorkflowHealthEnvelope = DataEnvelope<
  WorkflowHealth,
  WorkflowHealthFilters
>;

export interface WorkflowHealthApiError {
  error: {
    code: 'invalid_request' | 'live_data_failed' | 'method_not_allowed';
    message: string;
    retryable: boolean;
  };
}

export type WorkflowResourceMetric =
  'bytes' | 'executions' | 'jobs' | 'slot_hours';

export interface WorkflowResourceJob {
  bqConsoleUrl: string | null;
  bytesProcessed: number | null;
  endTime: string | null;
  jobId: string;
  jobLocation: string | null;
  jobProjectId: string | null;
  outcome: string | null;
  slotMs: number | null;
  startTime: string | null;
  statementType: string | null;
}

export type WorkflowResourceDestinationKind =
  'ddl' | 'failed_before_run' | 'other' | 'query_results' | 'table' | 'unknown';

export interface WorkflowPartitionDestination {
  bytesProcessed: number;
  destinationDatasetId: string | null;
  destinationKind: WorkflowResourceDestinationKind;
  destinationLabel: string;
  destinationProjectId: string | null;
  destinationTableId: string | null;
  executions: number;
  heaviestJob: WorkflowResourceJob | null;
  jobs: number;
  latestJob: WorkflowResourceJob | null;
  slotHours: number;
  slotMs: number;
  statementTypes: string[];
}

export interface WorkflowResourceDestination extends Omit<
  WorkflowPartitionDestination,
  'executions'
> {
  executions: number;
  partitionCount: number;
  partitions: string[];
  shareOfWorkflowSlot: number | null;
}

export interface WorkflowPartitionResources {
  bytesProcessed: number | null;
  cancelledJobs: number;
  executions: number;
  executionsWithJobs: number;
  failedJobs: number;
  incompleteExecutionWindows: number;
  jobs: number | null;
  jobsMissingSlotMs: number;
  parameter: string;
  slotHours: number | null;
  slotMs: number | null;
  destinations: WorkflowPartitionDestination[];
}

export interface WorkflowResources {
  componentId: string;
  destinations: WorkflowResourceDestination[];
  partitions: WorkflowPartitionResources[];
  summary: {
    averageBytesProcessed: number | null;
    averageExecutions: number | null;
    averageJobs: number | null;
    averageSlotHours: number | null;
    bytesPartitionCount: number;
    eligiblePartitionCount: number;
    incompleteExecutionWindows: number;
    jobsMissingSlotMs: number;
    slotPartitionCount: number;
    unknownBytesPartitions: number;
  };
  workflowId: string;
}

export interface WorkflowResourcesFilters {
  componentId: string;
  workflowId: string;
}

export type WorkflowResourcesEnvelope = DataEnvelope<
  WorkflowResources,
  WorkflowResourcesFilters
>;

export interface WorkflowResourcesApiError {
  error: {
    code: 'invalid_request' | 'method_not_allowed' | 'query_failed';
    message: string;
    retryable: boolean;
  };
}

export interface ComponentWorkflowMetric {
  averageExecutions: number | null;
  averageJobs: number | null;
  componentId: string;
  latestParameter: string | null;
  latestStatus: WorkflowHealthStatus;
  medianCompletionOffsetMs: number | null;
  medianRuntimeMs: number | null;
  recentPartitionCount: number;
  resourcePartitionCount: number;
  successRate: number | null;
  totalBytesProcessed: number | null;
  totalSlotHours: number | null;
  workflowId: string;
}

export interface ComponentWorkflowMetrics {
  workflows: ComponentWorkflowMetric[];
}

export interface ComponentWorkflowMetricsFilters {
  componentIds: string[];
}

export type ComponentWorkflowMetricsEnvelope = DataEnvelope<
  ComponentWorkflowMetrics,
  ComponentWorkflowMetricsFilters
>;

export interface ComponentWorkflowMetricsApiError {
  error: {
    code: 'invalid_request' | 'method_not_allowed' | 'query_failed';
    message: string;
    retryable: boolean;
  };
}

export type GcpProjectAttributionCategory =
  | 'external_workflow'
  | 'network_workflow'
  | 'partial_attribution'
  | 'unattributed'
  | 'unknown';

export interface GcpProjectJobReference {
  bqConsoleUrl: string | null;
  jobId: string;
  totalSlotMs: number | null;
}

export interface GcpProjectJobMetric {
  attributionCategory: GcpProjectAttributionCategory;
  componentId: string | null;
  executions: number;
  failedJobs: number;
  heaviestJob: GcpProjectJobReference | null;
  jobs: number;
  missingSlotJobs: number;
  slotHoursPerExecution: number | null;
  source: string;
  totalBytesProcessed: number | null;
  totalSlotHours: number | null;
}

export interface GcpProjectJobs {
  projectId: string;
  rows: GcpProjectJobMetric[];
  windowEndDate: string | null;
  windowStartDate: string | null;
}

export interface GcpProjectJobsFilters {
  projectId: string;
}

export type GcpProjectJobsEnvelope = DataEnvelope<
  GcpProjectJobs,
  GcpProjectJobsFilters
>;

export interface GcpProjectJobsApiError {
  error: {
    code: 'invalid_request' | 'method_not_allowed' | 'query_failed';
    message: string;
    retryable: boolean;
  };
}

export const FILTER_FIELDS = [
  'entity_id',
  'name',
  'owner',
  'initiative_tags',
  'relationships',
  'component_type',
  'component_lifecycle',
  'gcp_project_id',
  'workflow_enabled',
  'workflow_type',
  'workflow_orchestration_type',
  'workflow_parent_component',
  'workflow_bq_job_projects',
  'workflow_bq_destination_table_projects',
  'workflow_schedule',
  'workflow_offset',
  'repository_archived',
  'repository_created',
  'repository_host',
  'repository_last_updated',
  'repository_organization',
  'repository_name',
] as const;

export type InventoryFilterField = (typeof FILTER_FIELDS)[number];
export type InventoryFilterOperator =
  | 'is'
  | 'is_not'
  | 'contains'
  | 'does_not_contain'
  | 'does_not_include'
  | 'includes'
  | 'on_or_after'
  | 'on_or_before'
  | 'is_empty'
  | 'is_not_empty';
export type InventoryLogicalOperator = 'and' | 'or';

export interface InventoryFilter {
  field: InventoryFilterField;
  id: string;
  operator: InventoryFilterOperator;
  value: string;
}

export interface InventoryFilterGroup {
  filters: InventoryFilter[];
  id: string;
  operator: InventoryLogicalOperator;
}

export interface InventoryFilterExpression {
  groupOperator: InventoryLogicalOperator;
  groups: InventoryFilterGroup[];
  version: 1;
}

export interface InventoryFilterContext {
  relationshipTypesByEntityId: ReadonlyMap<string, ReadonlySet<string>>;
}

export interface InventoryViewState {
  entityTypes: KnownInventoryEntityType[];
  expression: InventoryFilterExpression;
  hops: 0 | 1 | 2;
}

export interface DerivedInventory {
  directEntityIds: Set<string>;
  entities: InventoryEntity[];
  relatedEntityIds: Set<string>;
  relationships: InventoryRelationship[];
}
