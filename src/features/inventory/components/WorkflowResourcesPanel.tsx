import React, { useEffect, useMemo, useState } from 'react';

import type {
  WorkflowResourceDestination,
  WorkflowResourceJob,
  WorkflowResourceMetric,
  WorkflowResourcesEnvelope,
} from '../contracts';
import { buildWorkflowResources } from '../fixtureBuilders';
import styles from '../Inventory.module.css';
import { WorkflowResourcesChart } from './WorkflowResourcesChart';

const METRICS: Record<WorkflowResourceMetric, { title: string }> = {
  jobs: {
    title: 'BQ jobs executed by partition',
  },
  slot_hours: {
    title: 'Slot-hours used by partition',
  },
  executions: {
    title: 'Executions by partition',
  },
  bytes: { title: 'TiB processed by partition' },
};

export type WorkflowDestinationSortKey =
  | 'averageBytesProcessed'
  | 'averageSlotHours'
  | 'destination'
  | 'executions'
  | 'jobs'
  | 'partitions';
type SortDirection = 'asc' | 'desc';

const DESTINATION_COLUMNS: Array<{
  headerLines?: readonly string[];
  label: string;
  sortDescription?: string;
  sortKey?: WorkflowDestinationSortKey;
}> = [
  {
    label: 'Destination',
    sortDescription: 'destination',
    sortKey: 'destination',
  },
  { label: 'Partitions', sortDescription: 'partitions', sortKey: 'partitions' },
  { label: 'Executions', sortDescription: 'executions', sortKey: 'executions' },
  { label: 'Jobs', sortDescription: 'jobs', sortKey: 'jobs' },
  { label: 'Statements' },
  {
    headerLines: ['Avg', 'Slot-Hours'],
    label: 'Avg slot-hours',
    sortDescription: 'average slot-hours',
    sortKey: 'averageSlotHours',
  },
  {
    headerLines: ['Avg', 'Bytes', 'Processed'],
    label: 'Avg bytes processed',
    sortDescription: 'average bytes processed',
    sortKey: 'averageBytesProcessed',
  },
  { label: 'Heaviest job' },
  { label: 'Latest job' },
];

export function formatDecimal(value: number | null): string {
  if (value == null) return 'Unavailable';
  if (value > 0 && value < 0.1) return '<0.1';
  return value.toLocaleString('en-US', {
    maximumFractionDigits: 1,
    minimumFractionDigits: 1,
  });
}

export function formatInteger(value: number): string {
  return value.toLocaleString('en-US', { maximumFractionDigits: 0 });
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
  const formatted =
    scaled < 10
      ? scaled.toLocaleString('en-US', {
          maximumFractionDigits: 1,
          minimumFractionDigits: 1,
        })
      : Math.round(scaled).toLocaleString('en-US');
  return `${formatted} ${units[unit]}`;
}

function formatSlotTime(slotMs: number | null): string {
  if (slotMs == null) return 'Unavailable';
  return `${formatDecimal(slotMs / 3.6e6)} h`;
}

function perPartition(total: number, partitionCount: number): number | null {
  return partitionCount ? total / partitionCount : null;
}

function destinationSortValue(
  destination: WorkflowResourceDestination,
  key: WorkflowDestinationSortKey,
): number | string | null {
  if (key === 'destination') return destination.destinationLabel;
  if (key === 'partitions') return destination.partitionCount;
  if (key === 'executions') return destination.executions;
  if (key === 'jobs') return destination.jobs;
  if (key === 'averageSlotHours')
    return perPartition(destination.slotMs, destination.partitionCount);
  return perPartition(destination.bytesProcessed, destination.partitionCount);
}

function compareDestinations(
  left: WorkflowResourceDestination,
  right: WorkflowResourceDestination,
  key: WorkflowDestinationSortKey,
  direction: SortDirection,
): number {
  const leftValue = destinationSortValue(left, key);
  const rightValue = destinationSortValue(right, key);
  if (leftValue == null && rightValue == null)
    return left.destinationLabel.localeCompare(right.destinationLabel);
  if (leftValue == null) return 1;
  if (rightValue == null) return -1;
  const comparison =
    typeof leftValue === 'number' && typeof rightValue === 'number'
      ? leftValue - rightValue
      : String(leftValue).localeCompare(String(rightValue));
  return (
    (direction === 'asc' ? comparison : -comparison) ||
    left.destinationLabel.localeCompare(right.destinationLabel)
  );
}

function heavierJob(
  left: WorkflowResourceJob | null,
  right: WorkflowResourceJob | null,
): WorkflowResourceJob | null {
  if (!left) return right;
  if (!right) return left;
  return (right.slotMs ?? -1) > (left.slotMs ?? -1) ? right : left;
}

function laterJob(
  left: WorkflowResourceJob | null,
  right: WorkflowResourceJob | null,
): WorkflowResourceJob | null {
  if (!left?.endTime) return right;
  if (!right?.endTime) return left;
  return new Date(right.endTime).getTime() > new Date(left.endTime).getTime()
    ? right
    : left;
}

function rollUpDestinations(
  destinations: WorkflowResourceDestination[],
): WorkflowResourceDestination {
  const partitions = Array.from(
    new Set(destinations.flatMap(destination => destination.partitions)),
  );
  return {
    bytesProcessed: destinations.reduce(
      (total, destination) => total + destination.bytesProcessed,
      0,
    ),
    destinationDatasetId: null,
    destinationKind: 'table',
    destinationLabel: 'Other destination tables',
    destinationProjectId: null,
    destinationTableId: null,
    executions: destinations.reduce(
      (total, destination) => total + destination.executions,
      0,
    ),
    heaviestJob: destinations.reduce<WorkflowResourceJob | null>(
      (job, destination) => heavierJob(job, destination.heaviestJob),
      null,
    ),
    jobs: destinations.reduce(
      (total, destination) => total + destination.jobs,
      0,
    ),
    latestJob: destinations.reduce<WorkflowResourceJob | null>(
      (job, destination) => laterJob(job, destination.latestJob),
      null,
    ),
    partitionCount: partitions.length,
    partitions,
    shareOfWorkflowSlot: destinations.reduce(
      (total, destination) => total + (destination.shareOfWorkflowSlot ?? 0),
      0,
    ),
    slotHours: destinations.reduce(
      (total, destination) => total + destination.slotHours,
      0,
    ),
    slotMs: destinations.reduce(
      (total, destination) => total + destination.slotMs,
      0,
    ),
    statementTypes: Array.from(
      new Set(destinations.flatMap(destination => destination.statementTypes)),
    ).sort(),
  };
}

export function workflowDestinationRows(
  destinations: WorkflowResourceDestination[],
  showAllTables: boolean,
  sortKey: WorkflowDestinationSortKey = 'averageSlotHours',
  sortDirection: SortDirection = 'desc',
): WorkflowResourceDestination[] {
  const sortRows = (rows: WorkflowResourceDestination[]) =>
    [...rows].sort((left, right) =>
      compareDestinations(left, right, sortKey, sortDirection),
    );
  const tables = sortRows(
    destinations.filter(destination => destination.destinationKind === 'table'),
  );
  const specialBuckets = destinations.filter(
    destination => destination.destinationKind !== 'table',
  );
  if (showAllTables || tables.length <= 5)
    return [...tables, ...specialBuckets];
  return [
    ...tables.slice(0, 5),
    rollUpDestinations(tables.slice(5)),
    ...specialBuckets,
  ];
}

function JobLink({ job }: { job: WorkflowResourceJob | null }) {
  if (!job?.bqConsoleUrl) return <>Unavailable</>;
  return (
    <a
      href={job.bqConsoleUrl}
      rel="noreferrer"
      target="_blank"
      title={job.jobId}
    >
      Open in BQ
    </a>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.workflowHealthMetric}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export function WorkflowResourcesPanel({
  componentId,
  workflowId,
}: {
  componentId: string;
  workflowId: string;
}) {
  const [envelope, setEnvelope] = useState<WorkflowResourcesEnvelope | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [metric, setMetric] = useState<WorkflowResourceMetric>('jobs');
  const [showAllTables, setShowAllTables] = useState(false);
  const [destinationSort, setDestinationSort] = useState<{
    direction: SortDirection;
    key: WorkflowDestinationSortKey;
  }>({ direction: 'desc', key: 'averageSlotHours' });

  useEffect(() => {
    setEnvelope(buildWorkflowResources(componentId, workflowId));
  }, [componentId, workflowId]);

  const chartFormatter = useMemo(
    () => (value: number | null) => formatDecimal(value),
    [],
  );

  if (error) return <p className={styles.workflowHealthError}>{error}</p>;
  if (!envelope) return <p>Loading workflow resource data…</p>;

  const { destinations, partitions, summary } = envelope.data;
  const destinationRows = workflowDestinationRows(
    destinations,
    showAllTables,
    destinationSort.key,
    destinationSort.direction,
  );
  const destinationSortColumn = DESTINATION_COLUMNS.find(
    column => column.sortKey === destinationSort.key,
  )!;
  const destinationSortDirection =
    destinationSort.key === 'destination'
      ? destinationSort.direction === 'asc'
        ? 'A–Z'
        : 'Z–A'
      : destinationSort.direction === 'asc'
        ? 'lowest first'
        : 'highest first';
  const namedTableCount = destinations.filter(
    destination => destination.destinationKind === 'table',
  ).length;
  const totals = rollUpDestinations(destinations);
  const snapshotDate = envelope.dataAsOf?.slice(0, 10);
  return (
    <div className={styles.workflowResources}>
      <em className={styles.workflowResourcesSource}>
        Based on latest BQ snapshot
        {snapshotDate ? ` (as of ${snapshotDate})` : ''}
      </em>
      <div className={styles.workflowResourceOverview}>
        <section>
          <h4>Per-partition averages</h4>
          <p
            className={`${styles.workflowResourcesSubcopy} ${styles.workflowResourceSummarySubcopy}`}
          >
            Across {summary.eligiblePartitionCount} partitions with executions
          </p>
          <div className={styles.workflowResourceMetrics}>
            <MetricCard
              label="Workflow executions"
              value={formatDecimal(summary.averageExecutions)}
            />
            <MetricCard
              label="Slot-hours"
              value={formatDecimal(summary.averageSlotHours)}
            />
            <MetricCard
              label="BQ jobs"
              value={formatDecimal(summary.averageJobs)}
            />
            <MetricCard
              label="TiB processed"
              value={formatDecimal(
                summary.averageBytesProcessed == null
                  ? null
                  : summary.averageBytesProcessed / 2 ** 40,
              )}
            />
          </div>
        </section>
        <section className={styles.workflowResourceChart}>
          <label className={styles.workflowResourceChartMetric}>
            <span className={styles.screenReaderOnly}>Chart metric</span>
            <span aria-hidden="true" className={styles.workflowResourceCaret}>
              ⌄
            </span>
            <span aria-hidden="true">{METRICS[metric].title}</span>
            <select
              aria-label="Chart metric"
              onChange={event =>
                setMetric(event.target.value as WorkflowResourceMetric)
              }
              value={metric}
            >
              {Object.entries(METRICS).map(([value, option]) => (
                <option key={value} value={value}>
                  {option.title}
                </option>
              ))}
            </select>
          </label>
          <WorkflowResourcesChart
            formatter={chartFormatter}
            metric={metric}
            partitions={partitions}
            title={METRICS[metric].title}
          />
        </section>
      </div>
      {envelope.warnings.length > 0 && (
        <ul className={styles.workflowResourceWarnings}>
          {envelope.warnings.map(warning => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      )}
      <section>
        <h4>Top jobs</h4>
        <p className={styles.workflowResourcesSubcopy}>
          Grouped by destination across the latest partitions. Sorted by{' '}
          {destinationSortColumn.sortDescription}, {destinationSortDirection}.
        </p>
        {destinationRows.length ? (
          <>
            <div className={styles.workflowResourceTableWrapper}>
              <table
                className={`${styles.workflowResourceTable} ${styles.workflowResourceDestinationTable}`}
              >
                <thead>
                  <tr>
                    {DESTINATION_COLUMNS.map(column => (
                      <th
                        aria-label={column.label}
                        aria-sort={
                          column.sortKey
                            ? destinationSort.key === column.sortKey
                              ? destinationSort.direction === 'asc'
                                ? 'ascending'
                                : 'descending'
                              : 'none'
                            : undefined
                        }
                        key={column.label}
                        scope="col"
                      >
                        {column.sortKey ? (
                          <button
                            aria-label={column.label}
                            className={styles.workflowResourceSortButton}
                            onClick={() => {
                              setDestinationSort(current => ({
                                direction:
                                  current.key === column.sortKey &&
                                  current.direction === 'desc'
                                    ? 'asc'
                                    : current.key !== column.sortKey &&
                                        column.sortKey === 'destination'
                                      ? 'asc'
                                      : 'desc',
                                key: column.sortKey!,
                              }));
                              setShowAllTables(false);
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
                            {destinationSort.key === column.sortKey && (
                              <span aria-hidden="true">
                                {destinationSort.direction === 'asc'
                                  ? ' ↑'
                                  : ' ↓'}
                              </span>
                            )}
                          </button>
                        ) : (
                          (column.headerLines || [column.label]).map(
                            (line, index) => (
                              <React.Fragment key={line}>
                                {index > 0 && <br />}
                                {line}
                              </React.Fragment>
                            ),
                          )
                        )}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {destinationRows.map(destination => (
                    <tr
                      className={
                        destination.destinationKind !== 'table' ||
                        destination.destinationLabel ===
                          'Other destination tables'
                          ? styles.workflowResourceSpecialRow
                          : undefined
                      }
                      key={destination.destinationLabel}
                    >
                      <td className={styles.workflowResourceDestination}>
                        {destination.destinationLabel}
                      </td>
                      <td>{formatInteger(destination.partitionCount)}</td>
                      <td>{formatInteger(destination.executions)}</td>
                      <td>{formatInteger(destination.jobs)}</td>
                      <td className={styles.workflowResourceStatements}>
                        {destination.statementTypes.join(', ') || 'Unavailable'}
                      </td>
                      <td>
                        {formatSlotTime(
                          perPartition(
                            destination.slotMs,
                            destination.partitionCount,
                          ),
                        )}
                      </td>
                      <td>
                        {formatBytes(
                          perPartition(
                            destination.bytesProcessed,
                            destination.partitionCount,
                          ),
                        )}
                      </td>
                      <td>
                        <JobLink job={destination.heaviestJob} />
                      </td>
                      <td>
                        <JobLink job={destination.latestJob} />
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <th scope="row">TOTAL</th>
                    <td>{formatInteger(summary.eligiblePartitionCount)}</td>
                    <td>{formatInteger(totals.executions)}</td>
                    <td>{formatInteger(totals.jobs)}</td>
                    <td>—</td>
                    <td>
                      {formatSlotTime(
                        summary.averageSlotHours == null
                          ? null
                          : summary.averageSlotHours * 3.6e6,
                      )}
                    </td>
                    <td>{formatBytes(summary.averageBytesProcessed)}</td>
                    <td>—</td>
                    <td>—</td>
                  </tr>
                </tfoot>
              </table>
            </div>
            {namedTableCount > 5 && (
              <button
                className={styles.textButton}
                onClick={() => setShowAllTables(current => !current)}
                type="button"
              >
                {showAllTables
                  ? 'Show top 5'
                  : `Show all ${namedTableCount} destination tables`}
              </button>
            )}
            <p className={styles.workflowResourceTableNote}>
              Averages are per partition.
            </p>
          </>
        ) : (
          <p>No attributed BigQuery jobs were found.</p>
        )}
      </section>
    </div>
  );
}
