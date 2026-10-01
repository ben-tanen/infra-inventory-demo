import React, { useEffect, useMemo, useState } from 'react';

import type {
  GcpProjectAttributionCategory,
  GcpProjectJobMetric,
  GcpProjectJobReference,
  GcpProjectJobsEnvelope,
} from '../contracts';
import { buildGcpProjectJobs } from '../fixtureBuilders';
import styles from '../Inventory.module.css';
import {
  GcpProjectJobShareCharts,
  gcpProjectSourceLabel,
} from './GcpProjectJobShareCharts';

type SortDirection = 'asc' | 'desc';
export type GcpProjectJobsSortKey =
  | 'attributionCategory'
  | 'executions'
  | 'failedJobs'
  | 'jobs'
  | 'slotHoursPerExecution'
  | 'source'
  | 'totalBytesProcessed'
  | 'totalSlotHours';

interface DisplayRow extends GcpProjectJobMetric {
  rollup: boolean;
}

interface Column {
  headerLines?: readonly string[];
  key: GcpProjectJobsSortKey | 'heaviestJob';
  label: string;
  sortDescription?: string;
}

const WORKFLOW_COLUMNS: Column[] = [
  { key: 'source', label: 'Workflow', sortDescription: 'workflow' },
  {
    key: 'attributionCategory',
    label: 'Attribution',
    sortDescription: 'attribution',
  },
  { key: 'executions', label: 'Executions', sortDescription: 'executions' },
  {
    headerLines: ['BQ', 'Jobs'],
    key: 'jobs',
    label: 'BQ jobs',
    sortDescription: 'jobs',
  },
  {
    headerLines: ['Slot-Hours', 'Per', 'Execution'],
    key: 'slotHoursPerExecution',
    label: 'Slot-hours per execution',
    sortDescription: 'slot-hours per execution',
  },
  {
    headerLines: ['Total', 'Slot-Hours'],
    key: 'totalSlotHours',
    label: 'Total slot-hours',
    sortDescription: 'total slot-hours',
  },
  {
    headerLines: ['Total', 'Bytes', 'Processed'],
    key: 'totalBytesProcessed',
    label: 'Total bytes processed',
    sortDescription: 'total bytes processed',
  },
  {
    headerLines: ['Heaviest', 'Job'],
    key: 'heaviestJob',
    label: 'Heaviest job',
  },
];

const UNATTRIBUTED_COLUMNS: Column[] = [
  { key: 'source', label: 'Source', sortDescription: 'source' },
  {
    key: 'attributionCategory',
    label: 'Attribution',
    sortDescription: 'attribution',
  },
  {
    headerLines: ['BQ', 'Jobs'],
    key: 'jobs',
    label: 'BQ jobs',
    sortDescription: 'jobs',
  },
  {
    headerLines: ['Failed', 'Jobs'],
    key: 'failedJobs',
    label: 'Failed jobs',
    sortDescription: 'failed jobs',
  },
  {
    headerLines: ['Total', 'Slot-Hours'],
    key: 'totalSlotHours',
    label: 'Total slot-hours',
    sortDescription: 'total slot-hours',
  },
  {
    headerLines: ['Total', 'Bytes', 'Processed'],
    key: 'totalBytesProcessed',
    label: 'Total bytes processed',
    sortDescription: 'total bytes processed',
  },
  {
    headerLines: ['Heaviest', 'Job'],
    key: 'heaviestJob',
    label: 'Heaviest job',
  },
];

const ATTRIBUTION_LABELS: Record<GcpProjectAttributionCategory, string> = {
  external_workflow: 'External',
  network_workflow: 'Network',
  partial_attribution: 'Partial attribution',
  unattributed: 'Unattributed',
  unknown: 'Unknown',
};

function formatDecimal(value: number | null): string {
  if (value == null) return 'Unavailable';
  if (value > 0 && value < 0.1) return '<0.1';
  return value.toLocaleString('en-US', {
    maximumFractionDigits: 1,
    minimumFractionDigits: 1,
  });
}

function formatInteger(value: number): string {
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
  return `${scaled.toLocaleString('en-US', {
    maximumFractionDigits: scaled < 10 ? 1 : 0,
    minimumFractionDigits: scaled < 10 ? 1 : 0,
  })} ${units[unit]}`;
}

function heaviestJob(
  rows: GcpProjectJobMetric[],
): GcpProjectJobReference | null {
  return rows.reduce<GcpProjectJobReference | null>((heaviest, row) => {
    if (!row.heaviestJob) return heaviest;
    if (!heaviest) return row.heaviestJob;
    return (row.heaviestJob.totalSlotMs ?? -1) > (heaviest.totalSlotMs ?? -1)
      ? row.heaviestJob
      : heaviest;
  }, null);
}

function nullableTotal(
  rows: GcpProjectJobMetric[],
  field: 'totalBytesProcessed' | 'totalSlotHours',
): number | null {
  if (rows.some(row => row.jobs > 0 && row[field] == null)) return null;
  return rows.reduce((total, row) => total + (row[field] || 0), 0);
}

function aggregateRows(
  rows: GcpProjectJobMetric[],
  source: string,
): DisplayRow {
  const executions = rows.reduce((total, row) => total + row.executions, 0);
  const attributedSlotHours = rows.reduce<number | null>((total, row) => {
    if (
      total == null ||
      (row.executions > 0 && row.slotHoursPerExecution == null)
    )
      return null;
    return total + (row.slotHoursPerExecution || 0) * row.executions;
  }, 0);
  return {
    attributionCategory: 'unknown',
    componentId: null,
    executions,
    failedJobs: rows.reduce((total, row) => total + row.failedJobs, 0),
    heaviestJob: heaviestJob(rows),
    jobs: rows.reduce((total, row) => total + row.jobs, 0),
    missingSlotJobs: rows.reduce(
      (total, row) => total + row.missingSlotJobs,
      0,
    ),
    rollup: true,
    slotHoursPerExecution:
      executions && attributedSlotHours != null
        ? attributedSlotHours / executions
        : null,
    source,
    totalBytesProcessed: nullableTotal(rows, 'totalBytesProcessed'),
    totalSlotHours: nullableTotal(rows, 'totalSlotHours'),
  };
}

function sortValue(
  row: GcpProjectJobMetric,
  key: GcpProjectJobsSortKey,
): number | string | null {
  if (key === 'source') return gcpProjectSourceLabel(row);
  if (key === 'attributionCategory')
    return ATTRIBUTION_LABELS[row.attributionCategory];
  return row[key];
}

function compareRows(
  left: GcpProjectJobMetric,
  right: GcpProjectJobMetric,
  key: GcpProjectJobsSortKey,
  direction: SortDirection,
): number {
  const leftValue = sortValue(left, key);
  const rightValue = sortValue(right, key);
  if (leftValue == null && rightValue == null)
    return gcpProjectSourceLabel(left).localeCompare(
      gcpProjectSourceLabel(right),
    );
  if (leftValue == null) return 1;
  if (rightValue == null) return -1;
  const comparison =
    typeof leftValue === 'number' && typeof rightValue === 'number'
      ? leftValue - rightValue
      : String(leftValue).localeCompare(String(rightValue));
  return (
    (direction === 'asc' ? comparison : -comparison) ||
    gcpProjectSourceLabel(left).localeCompare(gcpProjectSourceLabel(right))
  );
}

export function gcpProjectJobTableRows(
  rows: GcpProjectJobMetric[],
  showAll: boolean,
  sortKey: GcpProjectJobsSortKey = 'totalSlotHours',
  sortDirection: SortDirection = 'desc',
  otherLabel = 'Other sources',
): { body: DisplayRow[]; total: DisplayRow } {
  const sorted = [...rows].sort((left, right) =>
    compareRows(left, right, sortKey, sortDirection),
  );
  const body = sorted.map(row => ({ ...row, rollup: false }));
  return {
    body:
      showAll || body.length <= 5
        ? body
        : [...body.slice(0, 5), aggregateRows(body.slice(5), otherLabel)],
    total: aggregateRows(rows, 'TOTAL'),
  };
}

function AttributionPill({
  category,
}: {
  category: GcpProjectAttributionCategory;
}) {
  return (
    <span
      className={`${styles.gcpProjectAttribution} ${styles[`gcpProjectAttribution_${category}`]}`}
    >
      {ATTRIBUTION_LABELS[category]}
    </span>
  );
}

function JobLink({ job }: { job: GcpProjectJobReference | null }) {
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

function SourceCell({
  onRevealInTable,
  row,
}: {
  onRevealInTable: (entityId: string) => void;
  row: DisplayRow;
}) {
  if (row.rollup) return <>{row.source}</>;
  if (row.attributionCategory === 'network_workflow') {
    return (
      <button
        className={styles.textButton}
        onClick={() => onRevealInTable(row.source)}
        type="button"
      >
        {gcpProjectSourceLabel(row)}
      </button>
    );
  }
  if (row.attributionCategory === 'partial_attribution' && row.componentId) {
    return (
      <button
        className={styles.textButton}
        onClick={() => onRevealInTable(`component:default/${row.componentId}`)}
        type="button"
      >
        {gcpProjectSourceLabel(row)}
      </button>
    );
  }
  return <>{gcpProjectSourceLabel(row)}</>;
}

function MetricTable({
  columns,
  emptyMessage,
  label,
  onRevealInTable,
  otherLabel,
  populationLabel,
  rows,
}: {
  columns: Column[];
  emptyMessage: string;
  label: string;
  onRevealInTable: (entityId: string) => void;
  otherLabel: string;
  populationLabel: string;
  rows: GcpProjectJobMetric[];
}) {
  const [showAll, setShowAll] = useState(false);
  const [sort, setSort] = useState<{
    direction: SortDirection;
    key: GcpProjectJobsSortKey;
  }>({ direction: 'desc', key: 'totalSlotHours' });
  const tableRows = gcpProjectJobTableRows(
    rows,
    showAll,
    sort.key,
    sort.direction,
    otherLabel,
  );
  const sortColumn = columns.find(column => column.key === sort.key)!;
  const sortDirection =
    sort.key === 'source' || sort.key === 'attributionCategory'
      ? sort.direction === 'asc'
        ? 'A–Z'
        : 'Z–A'
      : sort.direction === 'asc'
        ? 'lowest first'
        : 'highest first';
  const showsExecutions = columns.some(column => column.key === 'executions');

  return (
    <section className={styles.gcpProjectMetricTable}>
      <h4>{label}</h4>
      <p className={styles.workflowResourcesSubcopy}>
        Showing {showAll ? 'all' : `top ${Math.min(5, rows.length)} of`}{' '}
        {rows.length} {populationLabel}. Sorted by {sortColumn.sortDescription},{' '}
        {sortDirection}.
      </p>
      {rows.length ? (
        <>
          <div className={styles.workflowResourceTableWrapper}>
            <table className={styles.workflowResourceTable}>
              <caption className={styles.screenReaderOnly}>{label}</caption>
              <thead>
                <tr>
                  {columns.map(column => {
                    const sortable = column.key !== 'heaviestJob';
                    return (
                      <th
                        aria-label={column.label}
                        aria-sort={
                          sortable
                            ? sort.key === column.key
                              ? sort.direction === 'asc'
                                ? 'ascending'
                                : 'descending'
                              : 'none'
                            : undefined
                        }
                        key={column.key}
                        scope="col"
                      >
                        {sortable ? (
                          <button
                            aria-label={column.label}
                            className={styles.workflowResourceSortButton}
                            onClick={() => {
                              setSort(current => ({
                                direction:
                                  current.key === column.key &&
                                  current.direction === 'desc'
                                    ? 'asc'
                                    : current.key !== column.key &&
                                        (column.key === 'source' ||
                                          column.key === 'attributionCategory')
                                      ? 'asc'
                                      : 'desc',
                                key: column.key as GcpProjectJobsSortKey,
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
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {tableRows.body.map(row => (
                  <tr
                    className={
                      row.rollup ? styles.workflowResourceSpecialRow : undefined
                    }
                    key={`${row.attributionCategory}:${row.source}`}
                  >
                    <th
                      className={styles.workflowResourceDestination}
                      scope="row"
                    >
                      <SourceCell onRevealInTable={onRevealInTable} row={row} />
                    </th>
                    <td>
                      {row.rollup ? (
                        '—'
                      ) : (
                        <AttributionPill category={row.attributionCategory} />
                      )}
                    </td>
                    {showsExecutions && (
                      <td>{formatInteger(row.executions)}</td>
                    )}
                    <td>{formatInteger(row.jobs)}</td>
                    {columns.some(column => column.key === 'failedJobs') && (
                      <td>{formatInteger(row.failedJobs)}</td>
                    )}
                    {columns.some(
                      column => column.key === 'slotHoursPerExecution',
                    ) && <td>{formatDecimal(row.slotHoursPerExecution)}</td>}
                    <td>{formatDecimal(row.totalSlotHours)}</td>
                    <td>{formatBytes(row.totalBytesProcessed)}</td>
                    <td>
                      <JobLink job={row.heaviestJob} />
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row">TOTAL</th>
                  <td>—</td>
                  {showsExecutions && (
                    <td>{formatInteger(tableRows.total.executions)}</td>
                  )}
                  <td>{formatInteger(tableRows.total.jobs)}</td>
                  {columns.some(column => column.key === 'failedJobs') && (
                    <td>{formatInteger(tableRows.total.failedJobs)}</td>
                  )}
                  {columns.some(
                    column => column.key === 'slotHoursPerExecution',
                  ) && (
                    <td>
                      {formatDecimal(tableRows.total.slotHoursPerExecution)}
                    </td>
                  )}
                  <td>{formatDecimal(tableRows.total.totalSlotHours)}</td>
                  <td>{formatBytes(tableRows.total.totalBytesProcessed)}</td>
                  <td>—</td>
                </tr>
              </tfoot>
            </table>
          </div>
          {rows.length > 5 && (
            <button
              className={styles.textButton}
              onClick={() => setShowAll(current => !current)}
              type="button"
            >
              {showAll
                ? `Show top 5 ${populationLabel}`
                : `Show all ${rows.length} ${populationLabel}`}
            </button>
          )}
        </>
      ) : (
        <p>{emptyMessage}</p>
      )}
    </section>
  );
}

export function GcpProjectJobsPanel({
  onRevealInTable,
  projectId,
}: {
  onRevealInTable: (entityId: string) => void;
  projectId: string;
}) {
  const [envelope, setEnvelope] = useState<GcpProjectJobsEnvelope | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setEnvelope(buildGcpProjectJobs(projectId));
  }, [projectId]);

  const groupedRows = useMemo(() => {
    const rows = envelope?.data.rows || [];
    return {
      unattributed: rows.filter(
        row =>
          row.attributionCategory !== 'network_workflow' &&
          row.attributionCategory !== 'external_workflow',
      ),
      workflows: rows.filter(
        row =>
          row.attributionCategory === 'network_workflow' ||
          row.attributionCategory === 'external_workflow',
      ),
    };
  }, [envelope]);

  if (error) return <p className={styles.workflowHealthError}>{error}</p>;
  if (!envelope) return <p>Loading GCP project job metrics…</p>;

  const snapshotDate = envelope.dataAsOf?.slice(0, 10);
  const { windowEndDate, windowStartDate } = envelope.data;
  return (
    <div className={styles.gcpProjectJobs}>
      <em className={styles.workflowResourcesSource}>
        {windowStartDate && windowEndDate
          ? `Based on latest BQ snapshot for jobs ending from ${windowStartDate} through ${windowEndDate} UTC.`
          : `Based on latest BQ snapshot${snapshotDate ? ` (as of ${snapshotDate})` : ''}`}
      </em>
      <GcpProjectJobShareCharts rows={envelope.data.rows} />
      <MetricTable
        columns={WORKFLOW_COLUMNS}
        emptyMessage="No workflow-attributed jobs were observed in this window."
        label="Top workflows"
        onRevealInTable={onRevealInTable}
        otherLabel="Other workflows"
        populationLabel="workflows"
        rows={groupedRows.workflows}
      />
      <MetricTable
        columns={UNATTRIBUTED_COLUMNS}
        emptyMessage="No unattributed jobs were observed in this window."
        label="Top unattributed sources"
        onRevealInTable={onRevealInTable}
        otherLabel="Other unattributed sources"
        populationLabel="unattributed sources"
        rows={groupedRows.unattributed}
      />
      <p className={styles.workflowResourceTableNote}>
        Usage covers jobs ending within this seven-day window and should not be
        added to workflow partition metrics.
      </p>
      {!!envelope.warnings.length && (
        <ul className={styles.workflowResourceWarnings}>
          {envelope.warnings.map(warning => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
