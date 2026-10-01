import type {
  ComponentWorkflowMetric,
  ComponentWorkflowMetricsEnvelope,
  GcpProjectJobMetric,
  GcpProjectJobsEnvelope,
  WorkflowHealthEnvelope,
  WorkflowHealthStatus,
  WorkflowPartitionHealth,
  WorkflowResourcesEnvelope,
} from './contracts';
import { INVENTORY_FIXTURE } from './fixtures';
import { summarizeWorkflowPartitions } from './workflowHealthSummary';

// ---------------------------------------------------------------------------
// Seeded PRNG (mulberry32)
// ---------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++)
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  return hash;
}

function seededRng(key: string): () => number {
  return mulberry32(hashString(key));
}

// ---------------------------------------------------------------------------
// Entity graph helpers
// ---------------------------------------------------------------------------

function workflowsForComponent(componentName: string): string[] {
  const componentId = `component:default/${componentName}`;
  return INVENTORY_FIXTURE.data.relationships
    .filter(r => r.type === 'partOf' && r.targetEntityId === componentId)
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
    .filter(r => r.type === 'associatedProject' && r.targetEntityId === gcpId)
    .map(r => {
      const entity = INVENTORY_FIXTURE.data.entities.find(
        e => e.id === r.sourceEntityId,
      );
      return entity?.name ?? '';
    })
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// Workflow profile types and generation
// ---------------------------------------------------------------------------

type HealthPattern = 'all_success' | 'mostly_good' | 'just_broke' | 'waiting' | 'flaky' | 'broken';

interface WorkflowProfile {
  runtimeMs: number;
  completionOffsetMs: number;
  jobCount: number;
  slotHoursPerPartition: number;
  bytesPerPartition: number;
  partitionCount: number;
  healthPattern: HealthPattern;
  enabled: boolean;
}

// Showcase overrides for demo-ready scenarios
const SHOWCASE: Record<string, Partial<WorkflowProfile> & { healthPattern: HealthPattern }> = {
  'suits/meghan_duchess_of_sussex': {
    healthPattern: 'just_broke',
    runtimeMs: 7_200_000,
    completionOffsetMs: 10_800_000,
    jobCount: 25,
    slotHoursPerPartition: 12,
    bytesPerPartition: 500 * 2 ** 30,
    partitionCount: 7,
    enabled: true,
  },
  'breaking-bad/bryan_cranston': {
    healthPattern: 'all_success',
    runtimeMs: 14_400_000,
    completionOffsetMs: 18_000_000,
    jobCount: 45,
    slotHoursPerPartition: 85,
    bytesPerPartition: 2.5 * 2 ** 40,
    partitionCount: 7,
    enabled: true,
  },
  'top-gun-maverick/tom_cruise': {
    healthPattern: 'waiting',
    runtimeMs: 900_000,
    completionOffsetMs: 4_500_000,
    jobCount: 5,
    slotHoursPerPartition: 0.8,
    bytesPerPartition: 50 * 2 ** 30,
    partitionCount: 7,
    enabled: true,
  },
  'better-call-saul/kim_wexler': {
    healthPattern: 'just_broke',
    runtimeMs: 600_000,
    completionOffsetMs: 4_200_000,
    jobCount: 3,
    slotHoursPerPartition: 0.4,
    bytesPerPartition: 20 * 2 ** 30,
    partitionCount: 7,
    enabled: true,
  },
  'the-west-wing/josiah_bartlet': {
    healthPattern: 'flaky',
    runtimeMs: 1_800_000,
    completionOffsetMs: 7_200_000,
    jobCount: 12,
    slotHoursPerPartition: 3.5,
    bytesPerPartition: 200 * 2 ** 30,
    partitionCount: 7,
    enabled: true,
  },
};

function getWorkflowProfile(componentId: string, workflowId: string): WorkflowProfile {
  const key = `${componentId}/${workflowId}`;
  const showcase = SHOWCASE[key];

  const rng = seededRng(key);

  // Health pattern distribution
  let healthPattern: HealthPattern;
  if (showcase) {
    healthPattern = showcase.healthPattern;
  } else {
    const roll = rng();
    if (roll < 0.78) healthPattern = 'all_success';
    else if (roll < 0.88) healthPattern = 'mostly_good';
    else if (roll < 0.93) healthPattern = 'just_broke';
    else if (roll < 0.96) healthPattern = 'waiting';
    else if (roll < 0.98) healthPattern = 'flaky';
    else healthPattern = 'broken';
  }

  // Runtime: log-normal, 30s to 4h
  const runtimeMs = showcase?.runtimeMs ??
    Math.round(Math.exp(rng() * 4.5 + 10.3));

  // Completion offset: runtime + scheduling delay (1-6h)
  const schedulingDelay = (1 + rng() * 5) * 3_600_000;
  const completionOffsetMs = showcase?.completionOffsetMs ??
    Math.round(runtimeMs + schedulingDelay);

  // Job count: skewed low (1-50)
  const jobCount = showcase?.jobCount ??
    Math.max(1, Math.round(Math.exp(rng() * 3)));

  // Slot hours: correlated with jobs and runtime
  const baseSlotHours = (runtimeMs / 3_600_000) * jobCount * (0.3 + rng() * 0.7);
  const slotHoursPerPartition = showcase?.slotHoursPerPartition ??
    Math.round(baseSlotHours * 1000) / 1000;

  // Bytes: ~100MB per slot-hour with 10x variance
  const bytesMultiplier = Math.exp((rng() - 0.5) * 4.6); // ~0.1x to ~10x
  const bytesPerPartition = showcase?.bytesPerPartition ??
    Math.round(Math.max(1_048_576, slotHoursPerPartition * 100 * 2 ** 20 * bytesMultiplier));

  // Partition count
  let partitionCount: number;
  if (showcase?.partitionCount != null) {
    partitionCount = showcase.partitionCount;
  } else {
    const pRoll = rng();
    if (pRoll < 0.85) partitionCount = 7;
    else if (pRoll < 0.95) partitionCount = 3 + Math.floor(rng() * 3);
    else partitionCount = 1 + Math.floor(rng() * 2);
  }

  const enabled = showcase?.enabled ?? (rng() < 0.95);

  return {
    runtimeMs,
    completionOffsetMs,
    jobCount,
    slotHoursPerPartition,
    bytesPerPartition,
    partitionCount,
    healthPattern,
    enabled,
  };
}

// ---------------------------------------------------------------------------
// Partition date helpers
// ---------------------------------------------------------------------------

const BASE_PARTITIONS = [
  '2026-09-19', '2026-09-20', '2026-09-21', '2026-09-22',
  '2026-09-23', '2026-09-24', '2026-09-25',
];

function getPartitionDates(count: number): string[] {
  return BASE_PARTITIONS.slice(BASE_PARTITIONS.length - count);
}

// ---------------------------------------------------------------------------
// Health status generation per partition
// ---------------------------------------------------------------------------

function generatePartitionStatuses(
  profile: WorkflowProfile,
  componentId: string,
  workflowId: string,
): WorkflowHealthStatus[] {
  const { partitionCount, healthPattern } = profile;
  const rng = seededRng(`health:${componentId}/${workflowId}`);

  switch (healthPattern) {
    case 'all_success':
      return Array(partitionCount).fill('success');

    case 'mostly_good': {
      const statuses: WorkflowHealthStatus[] = Array(partitionCount).fill('success');
      const failCount = 1 + Math.floor(rng() * 2);
      for (let i = 0; i < failCount && i < partitionCount; i++) {
        const idx = Math.floor(rng() * partitionCount);
        statuses[idx] = 'failed';
      }
      return statuses;
    }

    case 'just_broke': {
      const statuses: WorkflowHealthStatus[] = Array(partitionCount).fill('success');
      statuses[partitionCount - 1] = 'failed';
      return statuses;
    }

    case 'waiting': {
      const statuses: WorkflowHealthStatus[] = Array(partitionCount).fill('success');
      statuses[partitionCount - 1] = 'waiting';
      return statuses;
    }

    case 'flaky': {
      return Array.from({ length: partitionCount }, () => {
        const r = rng();
        if (r < 0.55) return 'success' as const;
        if (r < 0.85) return 'failed' as const;
        return 'waiting' as const;
      });
    }

    case 'broken': {
      return Array.from({ length: partitionCount }, () =>
        rng() < 0.25 ? 'success' as const : 'failed' as const,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Build: Workflow Health
// ---------------------------------------------------------------------------

export function buildWorkflowHealth(
  componentId: string,
  workflowId: string,
): WorkflowHealthEnvelope {
  const profile = getWorkflowProfile(componentId, workflowId);
  const dates = getPartitionDates(profile.partitionCount);
  const statuses = generatePartitionStatuses(profile, componentId, workflowId);
  const rng = seededRng(`jitter:${componentId}/${workflowId}`);

  const partitions: WorkflowPartitionHealth[] = dates.map((parameter, i) => {
    const status = statuses[i];
    const isWaiting = status === 'waiting';
    const isFailed = status === 'failed';
    const jitter = 0.8 + rng() * 0.4;
    const partRuntimeMs = Math.round(profile.runtimeMs * jitter);
    const partOffsetMs = Math.round(profile.completionOffsetMs * jitter);
    const triggeredAt = `${parameter}T01:00:00.000Z`;
    const finishedMs = new Date(triggeredAt).getTime() + partRuntimeMs;
    const finishedAt = isWaiting ? null : new Date(finishedMs).toISOString();

    return {
      attempts: isFailed ? 1 + Math.floor(rng() * 2) : 1,
      completionOffsetMs: status === 'success' ? partOffsetMs : null,
      dependencyWaitMs: isWaiting ? Math.round(3_600_000 + rng() * 7_200_000) : 0,
      dependencyWaitPending: isWaiting,
      finishedAt,
      missingDependencyAttempts: isWaiting ? 1 : 0,
      parameter,
      runtimeMs: status === 'success' ? partRuntimeMs : (isFailed ? Math.round(partRuntimeMs * 0.3) : null),
      status,
      statusCounts: (status === 'success'
        ? { SUCCESS: 1 }
        : status === 'failed'
          ? { FAILED: 1 }
          : { MISSING_DEPS: 1 }) as Record<string, number>,
      triggeredAt,
    };
  });

  const latest = partitions[partitions.length - 1];
  const summary = summarizeWorkflowPartitions(partitions);

  return {
    appliedFilters: { componentId, workflowId },
    data: {
      componentId,
      latest,
      partitions,
      summary,
      workflowId,
    },
    dataAsOf: '2026-10-01T08:00:00.000Z',
    freshness: 'fresh',
    generatedAt: '2026-10-01T08:00:00.000Z',
    partial: false,
    source: ['fixture:workflow-health'],
    warnings: [],
  };
}

// ---------------------------------------------------------------------------
// Build: Component Workflow Metrics
// ---------------------------------------------------------------------------

export function buildComponentWorkflowMetrics(
  componentIds: string[],
): ComponentWorkflowMetricsEnvelope {
  const workflows: ComponentWorkflowMetric[] = [];

  for (const componentId of componentIds) {
    const wfNames = workflowsForComponent(componentId);
    for (const wfName of wfNames) {
      const profile = getWorkflowProfile(componentId, wfName);
      const statuses = generatePartitionStatuses(profile, componentId, wfName);
      const successCount = statuses.filter(s => s === 'success').length;
      const terminalCount = statuses.filter(s => s === 'success' || s === 'failed').length;
      const latestStatus = statuses[statuses.length - 1];
      const dates = getPartitionDates(profile.partitionCount);

      workflows.push({
        averageExecutions: profile.healthPattern === 'broken' ? 2.1 : 1.3,
        averageJobs: profile.jobCount,
        componentId,
        latestParameter: dates[dates.length - 1],
        latestStatus,
        medianCompletionOffsetMs: latestStatus === 'waiting' ? null : profile.completionOffsetMs,
        medianRuntimeMs: successCount > 0 ? profile.runtimeMs : null,
        recentPartitionCount: profile.partitionCount,
        resourcePartitionCount: profile.partitionCount,
        successRate: terminalCount > 0 ? successCount / terminalCount : null,
        totalBytesProcessed: profile.bytesPerPartition * profile.partitionCount,
        totalSlotHours: profile.slotHoursPerPartition * profile.partitionCount,
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

// ---------------------------------------------------------------------------
// Build: GCP Project Jobs
// ---------------------------------------------------------------------------

export function buildGcpProjectJobs(
  projectId: string,
): GcpProjectJobsEnvelope {
  const componentNames = componentsForProject(projectId);
  const rows: GcpProjectJobMetric[] = [];

  for (const compName of componentNames) {
    const wfNames = workflowsForComponent(compName);
    for (const wfName of wfNames) {
      const profile = getWorkflowProfile(compName, wfName);
      if (!profile.enabled) continue;
      const totalExecs = profile.partitionCount * (profile.healthPattern === 'broken' ? 2 : 1);
      const totalJobs = profile.jobCount * profile.partitionCount;
      const totalSlotHours = profile.slotHoursPerPartition * profile.partitionCount;
      const totalBytes = profile.bytesPerPartition * profile.partitionCount;
      const failedJobs = profile.healthPattern === 'broken'
        ? Math.ceil(totalJobs * 0.15)
        : profile.healthPattern === 'flaky'
          ? Math.ceil(totalJobs * 0.05)
          : 0;

      rows.push({
        attributionCategory: 'network_workflow',
        componentId: compName,
        executions: totalExecs,
        failedJobs,
        heaviestJob: totalSlotHours > 1 ? {
          bqConsoleUrl: null,
          jobId: `job-${compName}-${wfName}-heaviest`,
          totalSlotMs: Math.round(profile.slotHoursPerPartition * 3_600_000),
        } : null,
        jobs: totalJobs,
        missingSlotJobs: 0,
        slotHoursPerExecution: totalExecs > 0
          ? Math.round((totalSlotHours / totalExecs) * 1000) / 1000
          : null,
        source: `workflow:${compName}/${wfName}`,
        totalBytesProcessed: totalBytes,
        totalSlotHours: Math.round(totalSlotHours * 1000) / 1000,
      });
    }
  }

  // Add unattributed sources — seeded per project
  const projRng = seededRng(`unattributed:${projectId}`);
  const totalWorkflowSlot = rows.reduce((s, r) => s + (r.totalSlotHours ?? 0), 0);

  const UNATTRIBUTED_SOURCES = [
    { source: 'BigQuery console', base: 0.15 },
    { source: 'AI agents', base: 0.08 },
    { source: 'bq CLI', base: 0.03 },
    { source: 'Unknown client (service account)', base: 0.02 },
  ];
  for (const { source, base } of UNATTRIBUTED_SOURCES) {
    const share = base * (0.5 + projRng());
    const slotHours = Math.round(totalWorkflowSlot * share * 100) / 100;
    if (slotHours < 0.01) continue;
    const jobs = Math.max(1, Math.round(slotHours * (3 + projRng() * 10)));
    const bytes = Math.round(slotHours * (50 + projRng() * 200) * 2 ** 30);
    const failed = projRng() < 0.3 ? Math.ceil(jobs * 0.05 * projRng()) : 0;
    rows.push({
      attributionCategory: 'unattributed',
      componentId: null,
      executions: 0,
      failedJobs: failed,
      heaviestJob: slotHours > 5 ? {
        bqConsoleUrl: null,
        jobId: `job-${projectId}-${source.toLowerCase().replace(/\s+/g, '-')}-heaviest`,
        totalSlotMs: Math.round(slotHours * 0.3 * 3_600_000),
      } : null,
      jobs,
      missingSlotJobs: 0,
      slotHoursPerExecution: null,
      source,
      totalBytesProcessed: bytes,
      totalSlotHours: slotHours,
    });
  }

  // Sort by slot hours descending
  rows.sort((a, b) => (b.totalSlotHours ?? 0) - (a.totalSlotHours ?? 0));

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

// ---------------------------------------------------------------------------
// Build: Workflow Resources
// ---------------------------------------------------------------------------

export function buildWorkflowResources(
  componentId: string,
  workflowId: string,
): WorkflowResourcesEnvelope {
  const projectId = projectForComponent(componentId) ?? componentId;
  const profile = getWorkflowProfile(componentId, workflowId);
  const dates = getPartitionDates(profile.partitionCount);
  const statuses = generatePartitionStatuses(profile, componentId, workflowId);
  const rng = seededRng(`resources:${componentId}/${workflowId}`);
  const destLabel = `${projectId}.${componentId}_output.${workflowId}`;

  let totalBytes = 0;
  let totalSlotHours = 0;
  let totalJobs = 0;
  let totalExecs = 0;

  const partitions = dates.map((parameter, i) => {
    const status = statuses[i];
    const jitter = 0.7 + rng() * 0.6;
    const partJobs = Math.max(1, Math.round(profile.jobCount * jitter));
    const partSlotHours = Math.round(profile.slotHoursPerPartition * jitter * 1000) / 1000;
    const partSlotMs = Math.round(partSlotHours * 3_600_000);
    const partBytes = Math.round(profile.bytesPerPartition * jitter);
    const partExecs = status === 'failed' ? 1 + Math.floor(rng() * 2) : 1;
    const partFailedJobs = status === 'failed' ? Math.ceil(partJobs * 0.2) : 0;

    totalBytes += partBytes;
    totalSlotHours += partSlotHours;
    totalJobs += partJobs;
    totalExecs += partExecs;

    return {
      bytesProcessed: partBytes,
      cancelledJobs: 0,
      executions: partExecs,
      executionsWithJobs: partExecs,
      failedJobs: partFailedJobs,
      incompleteExecutionWindows: 0,
      jobs: partJobs,
      jobsMissingSlotMs: 0,
      parameter,
      slotHours: partSlotHours,
      slotMs: partSlotMs,
      destinations: [
        {
          bytesProcessed: partBytes,
          destinationDatasetId: `${componentId}_output`,
          destinationKind: 'table' as const,
          destinationLabel: destLabel,
          destinationProjectId: projectId,
          destinationTableId: workflowId,
          executions: partExecs,
          heaviestJob: partSlotMs > 3_600_000 ? {
            bqConsoleUrl: null,
            bytesProcessed: partBytes,
            endTime: `${parameter}T02:00:00.000Z`,
            jobId: `job-${componentId}-${workflowId}-${i}`,
            jobLocation: 'US',
            jobProjectId: projectId,
            outcome: status === 'failed' ? 'failed' : 'success',
            slotMs: partSlotMs,
            startTime: `${parameter}T01:00:00.000Z`,
            statementType: 'MERGE',
          } : null,
          jobs: partJobs,
          latestJob: null,
          slotHours: partSlotHours,
          slotMs: partSlotMs,
          statementTypes: ['MERGE'],
        },
      ],
    };
  });

  const n = partitions.length;

  return {
    appliedFilters: { componentId, workflowId },
    data: {
      componentId,
      partitions,
      summary: {
        averageBytesProcessed: n > 0 ? Math.round(totalBytes / n) : null,
        averageExecutions: n > 0 ? Math.round((totalExecs / n) * 10) / 10 : null,
        averageJobs: n > 0 ? Math.round((totalJobs / n) * 10) / 10 : null,
        averageSlotHours: n > 0 ? Math.round((totalSlotHours / n) * 1000) / 1000 : null,
        bytesPartitionCount: n,
        eligiblePartitionCount: n,
        incompleteExecutionWindows: 0,
        jobsMissingSlotMs: 0,
        slotPartitionCount: n,
        unknownBytesPartitions: 0,
      },
      destinations: [
        {
          bytesProcessed: totalBytes,
          destinationDatasetId: `${componentId}_output`,
          destinationKind: 'table',
          destinationLabel: destLabel,
          destinationProjectId: projectId,
          destinationTableId: workflowId,
          executions: totalExecs,
          heaviestJob: null,
          jobs: totalJobs,
          latestJob: null,
          partitionCount: n,
          partitions: dates,
          shareOfWorkflowSlot: 1,
          slotHours: Math.round(totalSlotHours * 1000) / 1000,
          slotMs: Math.round(totalSlotHours * 3_600_000),
          statementTypes: ['MERGE'],
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
