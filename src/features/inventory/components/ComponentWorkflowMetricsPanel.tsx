import React, { useEffect, useMemo, useState } from 'react';

import type {
  ComponentWorkflowMetric,
  ComponentWorkflowMetricsEnvelope,
  WorkflowHealthStatus,
} from '../contracts';
import { buildComponentWorkflowMetrics } from '../fixtureBuilders';
import styles from '../Inventory.module.css';

export interface ComponentWorkflowReference {
  enabled: boolean | null;
  entityId: string;
  name: string;
  orchestratorComponentId: string | null;
  orchestratorWorkflowId: string | null;
}

interface ComponentWorkflowMetricsPanelProps {
  backstageWorkflowsUrl: string;
  onRevealInTable: (entityId: string) => void;
  workflows: ComponentWorkflowReference[];
}

type SortKey =
  | 'averageExecutions'
  | 'averageJobs'
  | 'enabled'
  | 'latestParameter'
  | 'medianCompletionOffsetMs'
  | 'medianRuntimeMs'
  | 'name'
  | 'recentPartitionCount'
  | 'successRate'
  | 'totalBytesProcessed'
  | 'totalSlotHours';
type SortDirection = 'asc' | 'desc';

interface DisplayWorkflow extends ComponentWorkflowReference {
  metric: ComponentWorkflowMetric | null;
}

const COLUMNS: Array<{
  headerLines?: readonly string[];
  key: SortKey;
  label: string;
  title?: string;
}> = [
  { key: 'name', label: 'Workflow' },
  { key: 'enabled', label: 'Enabled' },
  { key: 'latestParameter', label: 'Latest partition' },
  {
    headerLines: ['Recent', 'Partitions'],
    key: 'recentPartitionCount',
    label: 'Recent partitions',
  },
  {
    headerLines: ['Success', 'Rate'],
    key: 'successRate',
    label: 'Success rate',
  },
  {
    headerLines: ['Median', 'Completion', 'Time'],
    key: 'medianCompletionOffsetMs',
    label: 'Median completion time',
  },
  {
    headerLines: ['Median', 'Runtime'],
    key: 'medianRuntimeMs',
    label: 'Median runtime',
  },
  {
    headerLines: ['Avg', 'Executions'],
    key: 'averageExecutions',
    label: 'Avg executions',
    title:
      'Average per partition across partitions with at least one execution',
  },
  {
    headerLines: ['Avg', 'BQ Jobs'],
    key: 'averageJobs',
    label: 'Avg BQ jobs',
    title:
      'Average per partition across partitions with at least one execution',
  },
  {
    headerLines: ['Total', 'Slot-Hours'],
    key: 'totalSlotHours',
    label: 'Total slot-hours',
  },
  {
    headerLines: ['Total', 'Bytes', 'Processed'],
    key: 'totalBytesProcessed',
    label: 'Total bytes processed',
  },
];

const STATUS_LABELS: Record<WorkflowHealthStatus, string> = {
  failed: 'Failed',
  running: 'Running',
  success: 'Succeeded',
  unknown: 'Unknown',
  waiting: 'Waiting',
};

function canonicalWorkflowId(componentId: string, workflowId: string): string {
  return `workflow:${componentId}/${workflowId}`;
}

function formatDecimal(value: number | null): string {
  return value == null
    ? 'Unavailable'
    : value.toLocaleString('en-US', {
        maximumFractionDigits: 1,
        minimumFractionDigits: 1,
      });
}

function formatBytes(value: number | null): string {
  if (value == null) return 'Unavailable';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'];
  let scaled = Math.max(0, value);
  let unit = 0;
  while (scaled >= 1024 && unit < units.length - 1) {
    scaled /= 1024;
    unit += 1;
  }
  return `${scaled.toLocaleString('en-US', {
    maximumFractionDigits: scaled < 10 ? 1 : 0,
    minimumFractionDigits: scaled < 10 ? 1 : 0,
  })} ${units[unit]}`;
}

function formatDuration(milliseconds: number | null): string {
  if (milliseconds == null) return 'Unavailable';
  const totalSeconds = Math.max(0, Math.round(milliseconds / 1_000));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  return [
    hours ? `${hours}h` : '',
    minutes || hours ? `${minutes}m` : '',
    `${seconds}s`,
  ]
    .filter(Boolean)
    .join(' ');
}

function formatCompletionOffset(milliseconds: number | null): string {
  if (milliseconds == null) return 'Unavailable';
  const totalSeconds = Math.max(0, Math.round(milliseconds / 1_000));
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  const clock = [hours, minutes, seconds]
    .map(value => String(value).padStart(2, '0'))
    .join(':');
  return `${days ? `D+${days} ` : ''}${clock}`;
}

function sortValue(
  workflow: DisplayWorkflow,
  key: SortKey,
): number | string | null {
  if (key === 'name') return workflow.name;
  if (key === 'enabled')
    return workflow.enabled == null ? null : Number(workflow.enabled);
  return workflow.metric?.[key] ?? null;
}

function compareWorkflows(
  left: DisplayWorkflow,
  right: DisplayWorkflow,
  key: SortKey,
  direction: SortDirection,
): number {
  const leftValue = sortValue(left, key);
  const rightValue = sortValue(right, key);
  if (leftValue == null && rightValue == null)
    return left.name.localeCompare(right.name);
  if (leftValue == null) return 1;
  if (rightValue == null) return -1;
  const comparison =
    typeof leftValue === 'number' && typeof rightValue === 'number'
      ? leftValue - rightValue
      : String(leftValue).localeCompare(String(rightValue));
  return (
    (direction === 'asc' ? comparison : -comparison) ||
    left.name.localeCompare(right.name)
  );
}

function StatusPill({ status }: { status: WorkflowHealthStatus }) {
  return (
    <span
      className={`${styles.workflowHealthStatus} ${styles[`workflowHealthStatus_${status}`]}`}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}

export function ComponentWorkflowMetricsPanel({
  backstageWorkflowsUrl,
  onRevealInTable,
  workflows,
}: ComponentWorkflowMetricsPanelProps) {
  const [envelope, setEnvelope] =
    useState<ComponentWorkflowMetricsEnvelope | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [showDisabled, setShowDisabled] = useState(false);
  const [sort, setSort] = useState<{
    direction: SortDirection;
    key: SortKey;
  }>({ direction: 'desc', key: 'totalSlotHours' });
  const componentIds = useMemo(
    () =>
      Array.from(
        new Set(
          workflows.flatMap(workflow =>
            workflow.orchestratorComponentId ? [workflow.orchestratorComponentId] : [],
          ),
        ),
      ),
    [workflows],
  );

  useEffect(() => {
    if (!componentIds.length) {
      setEnvelope(null);
      setError(null);
      return;
    }
    setEnvelope(buildComponentWorkflowMetrics(componentIds));
  }, [componentIds]);

  const rows = useMemo(() => {
    const metricsById = new Map(
      (envelope?.data.workflows || []).map(metric => [
        canonicalWorkflowId(metric.componentId, metric.workflowId),
        metric,
      ]),
    );
    return workflows
      .filter(workflow => showDisabled || workflow.enabled !== false)
      .map(workflow => ({
        ...workflow,
        metric: metricsById.get(workflow.entityId) || null,
      }))
      .sort((left, right) =>
        compareWorkflows(left, right, sort.key, sort.direction),
      );
  }, [envelope, showDisabled, sort, workflows]);

  if (!workflows.length)
    return <p>No workflows are related to this component.</p>;
  if (error) return <p className={styles.workflowHealthError}>{error}</p>;
  if (componentIds.length && !envelope) return <p>Loading workflow metrics…</p>;

  const displayedRows = showAll ? rows : rows.slice(0, 5);
  const sortLabel = COLUMNS.find(column => column.key === sort.key)?.label;
  const snapshotDate = envelope?.dataAsOf?.slice(0, 10);
  const workflowPopulationLabel = showDisabled
    ? 'workflow'
    : 'enabled workflow';
  return (
    <div className={styles.componentWorkflows}>
      <em
        className={`${styles.workflowResourcesSource} ${styles.componentWorkflowSource}`}
      >
        Based on latest BQ snapshot
        {snapshotDate ? ` (as of ${snapshotDate})` : ''}
      </em>
      <div className={styles.componentWorkflowToolbar}>
        <p className={styles.workflowResourcesSubcopy}>
          Showing {showAll ? 'all' : `top ${Math.min(5, rows.length)} of`}{' '}
          {rows.length} {workflowPopulationLabel}
          {rows.length === 1 ? '' : 's'} by {sortLabel?.toLocaleLowerCase()}.
        </p>
        <label
          className={`${styles.checkboxLabel} ${styles.componentWorkflowFilter}`}
        >
          <input
            checked={showDisabled}
            onChange={event => {
              setShowDisabled(event.target.checked);
              setShowAll(false);
            }}
            type="checkbox"
          />
          Show disabled workflows
        </label>
      </div>
      <div className={styles.workflowResourceTableWrapper}>
        <table
          className={`${styles.workflowResourceTable} ${styles.componentWorkflowTable}`}
        >
          <caption className={styles.screenReaderOnly}>
            Workflows related to this component and their recent health and
            resource metrics
          </caption>
          <thead>
            <tr>
              {COLUMNS.map(column => (
                <th
                  aria-label={column.label}
                  aria-sort={
                    sort.key === column.key
                      ? sort.direction === 'asc'
                        ? 'ascending'
                        : 'descending'
                      : 'none'
                  }
                  key={column.key}
                  scope="col"
                  title={column.title}
                >
                  <button
                    aria-label={column.label}
                    className={styles.componentWorkflowSortButton}
                    onClick={() => {
                      setSort(current => ({
                        direction:
                          current.key === column.key &&
                          current.direction === 'desc'
                            ? 'asc'
                            : current.key !== column.key &&
                                column.key === 'name'
                              ? 'asc'
                              : 'desc',
                        key: column.key,
                      }));
                      setShowAll(false);
                    }}
                    type="button"
                  >
                    {(column.headerLines || [column.label]).map(
                      (line, index) => (
                        <React.Fragment key={line}>
                          {index > 0 && <br />}
                          {line}
                        </React.Fragment>
                      ),
                    )}
                    {sort.key === column.key && (
                      <span aria-hidden="true">
                        {sort.direction === 'asc' ? ' ↑' : ' ↓'}
                      </span>
                    )}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {displayedRows.map(workflow => {
              const metric = workflow.metric;
              return (
                <tr key={workflow.entityId}>
                  <th scope="row">
                    <button
                      className={styles.textButton}
                      onClick={() => onRevealInTable(workflow.entityId)}
                      type="button"
                    >
                      {workflow.name}
                    </button>
                  </th>
                  <td>
                    {workflow.enabled == null
                      ? 'Unavailable'
                      : workflow.enabled
                        ? 'Yes'
                        : 'No'}
                  </td>
                  {metric ? (
                    <>
                      <td>
                        <div className={styles.componentWorkflowLatest}>
                          <span>{metric.latestParameter || 'Unavailable'}</span>
                          <StatusPill status={metric.latestStatus} />
                        </div>
                      </td>
                      <td>{metric.recentPartitionCount.toLocaleString()}</td>
                      <td>
                        {metric.successRate == null
                          ? 'Unavailable'
                          : `${Math.round(metric.successRate * 100)}%`}
                      </td>
                      <td>
                        {formatCompletionOffset(
                          metric.medianCompletionOffsetMs,
                        )}
                      </td>
                      <td>{formatDuration(metric.medianRuntimeMs)}</td>
                      <td>{formatDecimal(metric.averageExecutions)}</td>
                      <td>{formatDecimal(metric.averageJobs)}</td>
                      <td>{formatDecimal(metric.totalSlotHours)}</td>
                      <td>{formatBytes(metric.totalBytesProcessed)}</td>
                    </>
                  ) : (
                    <td className={styles.componentWorkflowNoData} colSpan={9}>
                      No recent data
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {rows.length > 5 && (
        <button
          className={styles.textButton}
          onClick={() => setShowAll(current => !current)}
          type="button"
        >
          {showAll
            ? `Show top 5 ${showDisabled ? '' : 'enabled '}workflows`
            : `Show all ${rows.length} ${showDisabled ? '' : 'enabled '}workflows`}
        </button>
      )}
      <div className={styles.componentWorkflowNotes}>
        <p className={styles.workflowResourceTableNote}>
          Average jobs and executions are per partition, excluding partitions
          with no executions. All BQ job statistics (including slot usage and
          bytes processed) are based on attributable jobs and may be missing
          currently unattributable jobs.
        </p>
        <p className={styles.workflowResourceTableNote}>
          <a href={backstageWorkflowsUrl} rel="noreferrer" target="_blank">
            View workflows
          </a>
        </p>
      </div>
      {!!envelope?.warnings.length && (
        <ul className={styles.workflowResourceWarnings}>
          {envelope.warnings.map(warning => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
