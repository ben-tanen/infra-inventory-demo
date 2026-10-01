import React, { useEffect, useRef } from 'react';

import type { GcpProjectJobMetric } from '../contracts';
import styles from '../Inventory.module.css';

export type GcpProjectShareMetric =
  'jobs' | 'totalBytesProcessed' | 'totalSlotHours';

export interface GcpProjectShareBucket {
  breakdown?: Array<{ label: string; value: number }>;
  color: string;
  key: string;
  label: string;
  share: number;
  value: number;
}

export interface GcpProjectShareData {
  buckets: GcpProjectShareBucket[];
  incomplete: boolean;
  total: number | null;
}

const NETWORK_KEY = 'network_workflows';
const EXTERNAL_KEY = 'external_workflows';
const OTHER_KEY = 'other';
const NETWORK_COLOR = '#14833b';
const EXTERNAL_COLOR = '#555';
const OTHER_COLOR = '#c9c9c9';
const GRAY_COLORS = ['#6a6a6a', '#7f7f7f', '#949494', '#a9a9a9', '#bcbcbc'];

const SOURCE_LABELS: Record<string, string> = {
  ai_agent: 'AI agents',
  bq_cli: 'bq CLI',
  bq_console: 'BigQuery console',
  data_transfer: 'Data Transfer / scheduled queries',
  dbt_local: 'dbt (local / CI)',
  go_client: 'Go client',
  java_client: 'Java / Scio client',
  jdbc_odbc: 'JDBC / ODBC driver',
  no_user_agent_human: 'Unknown client (person)',
  no_user_agent_service_account: 'Unknown client (service account)',
  node_client: 'Node.js client',
  other_human: 'Other (person)',
  other_service_account: 'Other (service account)',
  python_client: 'Python client',
  r_client: 'R client',
  saas_integration: 'SaaS integrations',
  tableau: 'Tableau',
};

const CHARTS: Array<{
  metric: GcpProjectShareMetric;
  title: string;
}> = [
  { metric: 'jobs', title: 'BQ jobs' },
  { metric: 'totalSlotHours', title: 'Slot-hours' },
  { metric: 'totalBytesProcessed', title: 'Bytes processed' },
];

export function gcpProjectSourceLabel(row: GcpProjectJobMetric): string {
  if (row.attributionCategory === 'partial_attribution') {
    return row.componentId || row.source.replace(/^component:/, '');
  }
  return SOURCE_LABELS[row.source] || row.source;
}

function grayColor(key: string): string {
  const hash = Array.from(key).reduce(
    (value, character) => (value * 31 + character.charCodeAt(0)) >>> 0,
    0,
  );
  return GRAY_COLORS[hash % GRAY_COLORS.length];
}

export function gcpProjectShareBucketColor(key: string): string {
  if (key === NETWORK_KEY) return NETWORK_COLOR;
  if (key === EXTERNAL_KEY) return EXTERNAL_COLOR;
  if (key === OTHER_KEY) return OTHER_COLOR;
  return grayColor(key);
}

function metricValue(
  row: GcpProjectJobMetric,
  metric: GcpProjectShareMetric,
): number | null {
  return row[metric];
}

export function gcpProjectJobShareBuckets(
  rows: GcpProjectJobMetric[],
  metric: GcpProjectShareMetric,
): GcpProjectShareData {
  const incomplete =
    metric !== 'jobs' &&
    rows.some(row => row.jobs > 0 && metricValue(row, metric) == null);
  if (incomplete) return { buckets: [], incomplete: true, total: null };

  const grouped = new Map<string, { label: string; value: number }>();
  rows.forEach(row => {
    const value = metricValue(row, metric) || 0;
    if (value <= 0) return;
    const key =
      row.attributionCategory === 'network_workflow'
        ? NETWORK_KEY
        : row.attributionCategory === 'external_workflow'
          ? EXTERNAL_KEY
          : `${row.attributionCategory}:${row.source}`;
    const label =
      key === NETWORK_KEY
        ? 'In-network workflows'
        : key === EXTERNAL_KEY
          ? 'External workflows'
          : gcpProjectSourceLabel(row);
    grouped.set(key, {
      label,
      value: (grouped.get(key)?.value || 0) + value,
    });
  });

  const total = Array.from(grouped.values()).reduce(
    (sum, bucket) => sum + bucket.value,
    0,
  );
  if (!total) return { buckets: [], incomplete: false, total: 0 };

  const named: GcpProjectShareBucket[] = [];
  const otherBuckets: Array<{ label: string; value: number }> = [];
  grouped.forEach((bucket, key) => {
    const share = bucket.value / total;
    if (share > 0.1) {
      named.push({
        color: gcpProjectShareBucketColor(key),
        key,
        label: bucket.label,
        share,
        value: bucket.value,
      });
    } else {
      otherBuckets.push(bucket);
    }
  });
  named.sort((left, right) => right.value - left.value);
  otherBuckets.sort((left, right) => right.value - left.value);
  const other = otherBuckets.reduce((sum, bucket) => sum + bucket.value, 0);
  if (other > 0) {
    named.push({
      breakdown: otherBuckets,
      color: gcpProjectShareBucketColor(OTHER_KEY),
      key: OTHER_KEY,
      label: 'Other',
      share: other / total,
      value: other,
    });
  }
  return { buckets: named, incomplete: false, total };
}

function formatValue(value: number, metric: GcpProjectShareMetric): string {
  if (metric === 'jobs')
    return value.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (metric === 'totalSlotHours') {
    return `${value.toLocaleString('en-US', { maximumFractionDigits: 1 })} h`;
  }
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'];
  let scaled = value;
  let unit = 0;
  while (scaled >= 1024 && unit < units.length - 1) {
    scaled /= 1024;
    unit += 1;
  }
  return `${scaled.toLocaleString('en-US', {
    maximumFractionDigits: scaled < 10 ? 1 : 0,
  })} ${units[unit]}`;
}

function formatShare(share: number): string {
  return `${(share * 100).toFixed(1)}%`;
}

function applyBucketEmphasis(
  container: HTMLDivElement | null,
  activeBucketKey: string | null,
) {
  container
    ?.querySelectorAll<SVGPathElement>('path[data-bucket-key]')
    .forEach(path => {
      path.dataset.emphasis = activeBucketKey
        ? path.dataset.bucketKey === activeBucketKey
          ? 'active'
          : 'muted'
        : 'none';
    });
}

function DonutChart({
  data,
  metric,
  title,
}: {
  data: GcpProjectShareData;
  metric: GcpProjectShareMetric;
  title: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const focusedBucketKeyRef = useRef<string | null>(null);
  const hoveredBucketKeyRef = useRef<string | null>(null);

  const updateBucketEmphasis = () => {
    applyBucketEmphasis(
      containerRef.current,
      hoveredBucketKeyRef.current ?? focusedBucketKeyRef.current,
    );
  };

  useEffect(() => {
    let cancelled = false;
    const render = async () => {
      const container = containerRef.current;
      if (!container || !data.buckets.length || data.total == null) return;
      const d3 = await import('d3');
      if (cancelled || !containerRef.current) return;
      container.replaceChildren();
      const tooltip = d3
        .select(container)
        .append('div')
        .attr('class', styles.gcpProjectShareTooltip)
        .attr('role', 'tooltip')
        .style('visibility', 'hidden');
      const size = 170;
      const svg = d3
        .select(container)
        .append('svg')
        .attr('aria-label', `${title} share by attribution source`)
        .attr('class', styles.gcpProjectShareSvg)
        .attr('role', 'img')
        .attr('viewBox', `0 0 ${size} ${size}`);
      const pie = d3
        .pie<GcpProjectShareBucket>()
        .sort(null)
        .value(bucket => bucket.value);
      const arc = d3
        .arc<d3.PieArcDatum<GcpProjectShareBucket>>()
        .innerRadius(45)
        .outerRadius(72);
      const group = svg
        .append('g')
        .attr('transform', `translate(${size / 2},${size / 2})`);
      const paths = group
        .selectAll('path')
        .data(pie(data.buckets))
        .join('path')
        .attr(
          'aria-label',
          arcDatum =>
            `${arcDatum.data.label}: ${formatValue(arcDatum.data.value, metric)}, ${formatShare(arcDatum.data.share)}`,
        )
        .attr('d', arc)
        .attr('data-bucket-key', arcDatum => arcDatum.data.key)
        .attr('data-emphasis', 'none')
        .attr('fill', arcDatum => arcDatum.data.color)
        .attr('role', 'img')
        .attr('tabindex', 0);
      applyBucketEmphasis(
        container,
        hoveredBucketKeyRef.current ?? focusedBucketKeyRef.current,
      );

      const showTooltip = (
        event: MouseEvent | FocusEvent,
        arcDatum: d3.PieArcDatum<GcpProjectShareBucket>,
      ) => {
        tooltip.html('').append('strong').text(arcDatum.data.label);
        if (arcDatum.data.key === OTHER_KEY && arcDatum.data.breakdown) {
          const list = tooltip.append('ul');
          list
            .selectAll('li')
            .data(arcDatum.data.breakdown)
            .join('li')
            .text(
              bucket =>
                `${bucket.label}: ${formatShare(bucket.value / data.total!)}`,
            );
        } else {
          tooltip
            .append('div')
            .text(
              `${formatValue(arcDatum.data.value, metric)} · ${formatShare(arcDatum.data.share)}`,
            );
        }
        const [pointerX, pointerY] =
          event.type === 'focus'
            ? [size / 2, size / 2]
            : d3.pointer(event, container);
        tooltip
          .style('left', `${Math.max(0, pointerX + 8)}px`)
          .style('top', `${Math.max(0, pointerY - 16)}px`)
          .style('visibility', 'visible');
      };
      paths
        .on('mouseenter focus', (event, arcDatum) =>
          showTooltip(event, arcDatum),
        )
        .on('mouseleave blur', () => tooltip.style('visibility', 'hidden'));
      group
        .append('text')
        .attr('class', styles.gcpProjectShareTotal)
        .attr('text-anchor', 'middle')
        .attr('y', -2)
        .text(formatValue(data.total, metric));
      group
        .append('text')
        .attr('class', styles.gcpProjectShareTotalLabel)
        .attr('text-anchor', 'middle')
        .attr('y', 17)
        .text('total');
    };
    void render();
    return () => {
      cancelled = true;
    };
  }, [data, metric, title]);

  if (data.incomplete) return <p>Unavailable due to incomplete usage data.</p>;
  if (!data.total) return <p>No usage was observed.</p>;
  return (
    <div className={styles.gcpProjectShareBody}>
      <div className={styles.gcpProjectShareCanvas} ref={containerRef} />
      <ul className={styles.gcpProjectShareLegend}>
        {data.buckets.map(bucket => (
          <li key={bucket.key}>
            <button
              aria-label={`Highlight ${bucket.label} slice, ${formatShare(bucket.share)}`}
              className={styles.gcpProjectShareLegendButton}
              onBlur={() => {
                focusedBucketKeyRef.current = null;
                updateBucketEmphasis();
              }}
              onFocus={() => {
                focusedBucketKeyRef.current = bucket.key;
                updateBucketEmphasis();
              }}
              onMouseEnter={() => {
                hoveredBucketKeyRef.current = bucket.key;
                updateBucketEmphasis();
              }}
              onMouseLeave={() => {
                hoveredBucketKeyRef.current = null;
                updateBucketEmphasis();
              }}
              type="button"
            >
              <span
                aria-hidden="true"
                className={styles.gcpProjectShareSwatch}
                style={{ backgroundColor: bucket.color }}
              />
              <span>{bucket.label}</span>
              <strong>{formatShare(bucket.share)}</strong>
            </button>
          </li>
        ))}
      </ul>
      <table
        aria-label={`${title} share by attribution source`}
        className={styles.screenReaderOnly}
      >
        <thead>
          <tr>
            <th scope="col">Source</th>
            <th scope="col">Value</th>
            <th scope="col">Share</th>
          </tr>
        </thead>
        <tbody>
          {data.buckets.map(bucket => (
            <tr key={bucket.key}>
              <th scope="row">{bucket.label}</th>
              <td>{formatValue(bucket.value, metric)}</td>
              <td>{formatShare(bucket.share)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function GcpProjectJobShareCharts({
  rows,
}: {
  rows: GcpProjectJobMetric[];
}) {
  return (
    <section>
      <h4>Job attribution</h4>
      <div className={styles.gcpProjectShareCharts}>
        {CHARTS.map(chart => (
          <section className={styles.gcpProjectShareChart} key={chart.metric}>
            <h5>{chart.title}</h5>
            <DonutChart
              data={gcpProjectJobShareBuckets(rows, chart.metric)}
              metric={chart.metric}
              title={chart.title}
            />
          </section>
        ))}
      </div>
    </section>
  );
}
