import React, { useEffect, useState } from 'react';

import type {
  WorkflowHealthEnvelope,
  WorkflowHealthStatus,
  WorkflowPartitionHealth,
} from '../contracts';
import { fixtureEnvelope } from '../workflowHealth';
import styles from '../Inventory.module.css';
import { WorkflowHealthCharts } from './WorkflowHealthCharts';

interface WorkflowHealthPanelProps {
  backstageUrl: string | null;
  componentId: string;
  workflowId: string;
}

export function backstageRangeUrl(
  url: string,
  partitions: Pick<WorkflowPartitionHealth, 'parameter'>[],
): string {
  const start = partitions[0]?.parameter;
  const stop = partitions.at(-1)?.parameter;
  if (!start || !stop) return url;

  const hashIndex = url.indexOf('#');
  const hash = hashIndex < 0 ? '' : url.slice(hashIndex);
  const withoutHash = hashIndex < 0 ? url : url.slice(0, hashIndex);
  const queryIndex = withoutHash.indexOf('?');
  const path = queryIndex < 0 ? withoutHash : withoutHash.slice(0, queryIndex);
  const query = queryIndex < 0 ? '' : withoutHash.slice(queryIndex + 1);
  const params = new URLSearchParams(query);
  params.set('start', start);
  params.set('stop', stop);
  return `${path}?${params.toString()}${hash}`;
}

const STATUS_ORDER = [
  'RUNNING',
  'STARTED',
  'SUBMITTED',
  'SUCCESS',
  'MISSING_DEPS',
  'FAILED',
  'FATAL',
  'ERROR',
  'CANCELLED',
  'HALTED',
  'UNKNOWN',
];

function formatDuration(milliseconds: number | null): string {
  if (milliseconds == null) return 'Pending';
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
  if (milliseconds == null) return 'Pending';
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

function formatTimestamp(value: string | null): string {
  if (!value) return 'Pending';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Unavailable';
  return `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

function formatRate(value: number | null): string {
  return value == null ? 'Unavailable' : `${Math.round(value * 100)}%`;
}

function formatDataAsOf(
  value: string | null,
  source: 'bigquery' | 'live',
): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const iso = date.toISOString();
  return source === 'live' ? `${iso.slice(11, 19)} UTC` : iso.slice(0, 10);
}

function statusLabel(status: WorkflowHealthStatus): string {
  if (status === 'success') return 'Succeeded';
  if (status === 'waiting') return 'Waiting';
  return status.charAt(0).toLocaleUpperCase() + status.slice(1);
}

function latestStatus(run: WorkflowPartitionHealth): string {
  const attempt = `attempt ${run.attempts || 1}`;
  if (run.status === 'running' && run.runtimeMs != null)
    return `Running for ${formatDuration(run.runtimeMs)} (${attempt})`;
  if (run.status === 'waiting') return `Waiting for dependencies (${attempt})`;
  return `${statusLabel(run.status)} (${attempt})`;
}

function executionCounts(counts: Record<string, number>): string {
  return Object.entries(counts)
    .sort((left, right) => {
      const leftRank = STATUS_ORDER.indexOf(left[0]);
      const rightRank = STATUS_ORDER.indexOf(right[0]);
      return (
        (leftRank < 0 ? STATUS_ORDER.length : leftRank) -
          (rightRank < 0 ? STATUS_ORDER.length : rightRank) ||
        left[0].localeCompare(right[0])
      );
    })
    .map(([status, count]) => `${count} ${status}`)
    .join(', ');
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.workflowHealthMetric}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export function WorkflowHealthPanel({
  backstageUrl,
  componentId,
  workflowId,
}: WorkflowHealthPanelProps) {
  const [envelope, setEnvelope] = useState<WorkflowHealthEnvelope | null>(null);
  const [error] = useState<string | null>(null);

  useEffect(() => {
    setEnvelope(fixtureEnvelope({ componentId, workflowId }));
  }, [componentId, workflowId]);

  if (error) return <p className={styles.workflowHealthError}>{error}</p>;
  if (!envelope) return <p>Loading live workflow health…</p>;

  const { latest, partitions, summary } = envelope.data;
  const sourceAsOf = formatDataAsOf(envelope.dataAsOf, 'bigquery');
  const rangedBackstageUrl = backstageUrl
    ? backstageRangeUrl(backstageUrl, partitions)
    : null;
  return (
    <div className={styles.workflowHealth}>
      <div className={styles.workflowHealthStatusRow}>
        {latest && (
          <span
            className={`${styles.workflowHealthStatus} ${styles[`workflowHealthStatus_${latest.status}`]}`}
          >
            {statusLabel(latest.status)}
          </span>
        )}
        <em>
          Based on fixture data{sourceAsOf ? ` (as of ${sourceAsOf})` : ''}
        </em>
      </div>
      <div className={styles.workflowHealthGrid}>
        <section>
          <h4>Latest run</h4>
          {latest ? (
            <dl className={styles.workflowHealthLatest}>
              <dt>Partition</dt>
              <dd>{latest.parameter}</dd>
              <dt>Status</dt>
              <dd>{latestStatus(latest)}</dd>
              <dt>Executions</dt>
              <dd>{executionCounts(latest.statusCounts) || 'Unavailable'}</dd>
              <dt>Runtime</dt>
              <dd>{formatDuration(latest.runtimeMs)}</dd>
              <dt>Dep. wait time</dt>
              <dd>
                {latest.missingDependencyAttempts
                  ? `${formatDuration(latest.dependencyWaitMs)}${
                      latest.dependencyWaitPending ? ' (pending)' : ''
                    }`
                  : 'None'}
              </dd>
              <dt>Finished at</dt>
              <dd>{formatTimestamp(latest.finishedAt)}</dd>
            </dl>
          ) : (
            <p>No recent run data available.</p>
          )}
          {rangedBackstageUrl && (
            <a href={rangedBackstageUrl} rel="noreferrer" target="_blank">
              View instance details
            </a>
          )}
        </section>
        <section>
          <h4>Historical health (last 7 runs)</h4>
          <div className={styles.workflowHealthMetrics}>
            <MetricCard
              label="Success rate"
              value={formatRate(summary.successRate)}
            />
            <MetricCard
              label="Median completion time"
              value={formatCompletionOffset(summary.medianCompletionOffsetMs)}
            />
            <MetricCard
              label="Median runtime"
              value={formatDuration(summary.medianRuntimeMs)}
            />
          </div>
          <WorkflowHealthCharts
            completionMedian={summary.medianCompletionOffsetMs}
            executionMedian={summary.medianRuntimeMs}
            formatCompletion={formatCompletionOffset}
            formatDuration={formatDuration}
            partitions={partitions}
          />
        </section>
      </div>
    </div>
  );
}
