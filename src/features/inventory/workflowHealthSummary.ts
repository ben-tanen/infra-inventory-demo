import type { WorkflowHealth } from './contracts';

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function summarizeWorkflowPartitions(
  partitions: WorkflowHealth['partitions'],
): WorkflowHealth['summary'] {
  const successfulPartitions = partitions.filter(
    partition => partition.status === 'success',
  );
  const terminalPartitions = partitions.filter(partition =>
    ['failed', 'success'].includes(partition.status),
  );
  return {
    medianCompletionOffsetMs: median(
      successfulPartitions.flatMap(partition =>
        partition.completionOffsetMs == null
          ? []
          : [partition.completionOffsetMs],
      ),
    ),
    medianRuntimeMs: median(
      successfulPartitions.flatMap(partition =>
        partition.runtimeMs == null ? [] : [partition.runtimeMs],
      ),
    ),
    successfulPartitions: successfulPartitions.length,
    successRate: terminalPartitions.length
      ? successfulPartitions.length / terminalPartitions.length
      : null,
    terminalPartitions: terminalPartitions.length,
  };
}
