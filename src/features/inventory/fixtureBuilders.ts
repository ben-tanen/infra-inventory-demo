import type {
  ComponentWorkflowMetric,
  ComponentWorkflowMetricsEnvelope,
  GcpProjectJobMetric,
  GcpProjectJobsEnvelope,
  WorkflowResourcesEnvelope,
} from './contracts';
import { INVENTORY_FIXTURE } from './fixtures';

function workflowsForComponent(componentName: string): string[] {
  const componentId = `component:default/${componentName}`;
  return INVENTORY_FIXTURE.data.relationships
    .filter(
      r => r.type === 'partOf' && r.targetEntityId === componentId,
    )
    .map(r => {
      const entity = INVENTORY_FIXTURE.data.entities.find(
        e => e.id === r.sourceEntityId,
      );
      return entity?.name ?? '';
    })
    .filter(Boolean);
}

function projectForComponent(componentName: string): string | null {
  const componentId = `component:default/${componentName}`;
  const rel = INVENTORY_FIXTURE.data.relationships.find(
    r => r.type === 'associatedProject' && r.sourceEntityId === componentId,
  );
  if (!rel) return null;
  return rel.targetEntityId.replace('gcp-project:', '');
}

function componentsForProject(projectId: string): string[] {
  const gcpId = `gcp-project:${projectId}`;
  return INVENTORY_FIXTURE.data.relationships
    .filter(
      r => r.type === 'associatedProject' && r.targetEntityId === gcpId,
    )
    .map(r => {
      const entity = INVENTORY_FIXTURE.data.entities.find(
        e => e.id === r.sourceEntityId,
      );
      return entity?.name ?? '';
    })
    .filter(Boolean);
}

export function buildComponentWorkflowMetrics(
  componentIds: string[],
): ComponentWorkflowMetricsEnvelope {
  const workflows: ComponentWorkflowMetric[] = [];

  for (const componentId of componentIds) {
    const wfNames = workflowsForComponent(componentId);
    for (const wfName of wfNames) {
      workflows.push({
        averageExecutions: 1,
        averageJobs: 1,
        componentId,
        latestParameter: '2026-09-25',
        latestStatus: 'success',
        medianCompletionOffsetMs: 3_600_000,
        medianRuntimeMs: 600_000,
        recentPartitionCount: 7,
        resourcePartitionCount: 7,
        successRate: 1,
        totalBytesProcessed: 7 * 1_048_576,
        totalSlotHours: 0.002,
        workflowId: wfName,
      });
    }
  }

  return {
    appliedFilters: { componentIds },
    data: { workflows },
    dataAsOf: '2026-10-01T00:00:00.000Z',
    freshness: 'fresh',
    generatedAt: '2026-10-01T08:00:00.000Z',
    partial: false,
    source: ['fixture:workflow-metrics'],
    warnings: [],
  };
}

export function buildGcpProjectJobs(
  projectId: string,
): GcpProjectJobsEnvelope {
  const componentNames = componentsForProject(projectId);
  const rows: GcpProjectJobMetric[] = [];

  for (const compName of componentNames) {
    const wfNames = workflowsForComponent(compName);
    for (const wfName of wfNames) {
      rows.push({
        attributionCategory: 'network_workflow',
        componentId: compName,
        executions: 7,
        failedJobs: 0,
        heaviestJob: null,
        jobs: 7,
        missingSlotJobs: 0,
        slotHoursPerExecution: 0.000278,
        source: `workflow:${compName}/${wfName}`,
        totalBytesProcessed: 7 * 1_048_576,
        totalSlotHours: 0.002,
      });
    }
  }

  return {
    appliedFilters: { projectId },
    data: {
      projectId,
      rows,
      windowEndDate: '2026-10-01',
      windowStartDate: '2026-09-25',
    },
    dataAsOf: '2026-10-01T00:00:00.000Z',
    freshness: 'fresh',
    generatedAt: '2026-10-01T08:00:00.000Z',
    partial: false,
    source: ['fixture:gcp-project-jobs'],
    warnings: [],
  };
}

const RESOURCE_PARTITIONS = [
  '2026-09-19', '2026-09-20', '2026-09-21', '2026-09-22',
  '2026-09-23', '2026-09-24', '2026-09-25',
];

export function buildWorkflowResources(
  componentId: string,
  workflowId: string,
): WorkflowResourcesEnvelope {
  const projectId = projectForComponent(componentId) ?? componentId;
  const destLabel = `${projectId}.${componentId}_output.${workflowId}`;

  return {
    appliedFilters: { componentId, workflowId },
    data: {
      componentId,
      partitions: RESOURCE_PARTITIONS.map((parameter, index) => ({
        bytesProcessed: 1_048_576,
        cancelledJobs: 0,
        executions: 1,
        executionsWithJobs: 1,
        failedJobs: 0,
        incompleteExecutionWindows: 0,
        jobs: 1,
        jobsMissingSlotMs: 0,
        parameter,
        slotHours: 0.000278,
        slotMs: 1000,
        destinations: [
          {
            bytesProcessed: 1_048_576,
            destinationDatasetId: `${componentId}_output`,
            destinationKind: 'table' as const,
            destinationLabel: destLabel,
            destinationProjectId: projectId,
            destinationTableId: workflowId,
            executions: 1,
            heaviestJob: null,
            jobs: 1,
            latestJob: null,
            slotHours: 0.000278,
            slotMs: 1000,
            statementTypes: ['INSERT'],
          },
        ],
      })),
      summary: {
        averageBytesProcessed: 1_048_576,
        averageExecutions: 1,
        averageJobs: 1,
        averageSlotHours: 0.000278,
        bytesPartitionCount: 7,
        eligiblePartitionCount: 7,
        incompleteExecutionWindows: 0,
        jobsMissingSlotMs: 0,
        slotPartitionCount: 7,
        unknownBytesPartitions: 0,
      },
      destinations: [
        {
          bytesProcessed: 7 * 1_048_576,
          destinationDatasetId: `${componentId}_output`,
          destinationKind: 'table',
          destinationLabel: destLabel,
          destinationProjectId: projectId,
          destinationTableId: workflowId,
          executions: 7,
          heaviestJob: null,
          jobs: 7,
          latestJob: null,
          partitionCount: 7,
          partitions: RESOURCE_PARTITIONS,
          shareOfWorkflowSlot: 1,
          slotHours: 0.002,
          slotMs: 7000,
          statementTypes: ['INSERT'],
        },
      ],
      workflowId,
    },
    dataAsOf: '2026-10-01T00:00:00.000Z',
    freshness: 'fresh',
    generatedAt: '2026-10-01T08:00:00.000Z',
    partial: false,
    source: ['fixture:workflow-resources'],
    warnings: [],
  };
}
