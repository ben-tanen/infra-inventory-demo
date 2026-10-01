import React, { useEffect, useRef } from 'react';

import type {
  WorkflowPartitionResources,
  WorkflowResourceMetric,
} from '../contracts';
import styles from '../Inventory.module.css';
import { workflowPartitionAxisLabel } from './WorkflowHealthCharts';

const HEIGHT = 230;
const MARGIN = { bottom: 42, left: 58, right: 18, top: 12 };

function formatTooltipNumber(value: number | null): string {
  if (value == null) return 'Unavailable';
  if (value > 0 && value < 0.1) return '<0.1';
  return value.toLocaleString('en-US', { maximumFractionDigits: 1 });
}

export function workflowResourceValue(
  partition: WorkflowPartitionResources,
  metric: WorkflowResourceMetric,
): number | null {
  if (metric === 'executions')
    return partition.executions ? partition.executions : null;
  if (metric === 'jobs') return partition.jobs;
  if (metric === 'slot_hours')
    return partition.jobs === 0 ? 0 : partition.slotHours;
  if (partition.jobs === 0) return 0;
  return partition.bytesProcessed == null
    ? null
    : partition.bytesProcessed / 2 ** 40;
}

export function workflowResourceTooltipRows(
  partition: WorkflowPartitionResources,
): Array<{ label: string; value: string }> {
  return [
    {
      label: 'BQ jobs executed',
      value:
        partition.jobs == null
          ? 'Unavailable'
          : partition.jobs.toLocaleString('en-US'),
    },
    {
      label: 'Slot-hours used',
      value:
        partition.jobs === 0
          ? '0 h'
          : `${formatTooltipNumber(partition.slotHours)} h`,
    },
    {
      label: 'Executions',
      value: partition.executions.toLocaleString('en-US'),
    },
    {
      label: 'TiB processed',
      value:
        partition.jobs === 0
          ? '0 TiB'
          : `${formatTooltipNumber(
              partition.bytesProcessed == null
                ? null
                : partition.bytesProcessed / 2 ** 40,
            )} TiB`,
    },
  ];
}

export function WorkflowResourcesChart({
  formatter,
  metric,
  partitions,
  title,
}: {
  formatter: (value: number | null) => string;
  metric: WorkflowResourceMetric;
  partitions: WorkflowPartitionResources[];
  title: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    const render = async () => {
      const container = containerRef.current;
      if (!container || !partitions.length) return;
      const d3 = await import('d3');
      if (cancelled || !containerRef.current) return;
      const data = partitions.map(partition => ({
        parameter: partition.parameter,
        partition,
        value: workflowResourceValue(partition, metric),
      }));
      const values = data.flatMap(datum =>
        datum.value == null ? [] : [datum.value],
      );
      const width = Math.max(480, container.clientWidth);
      const includeTime = partitions.some(partition =>
        partition.parameter.includes('T'),
      );
      const years = new Set(
        partitions.flatMap(partition => {
          const parsed = new Date(partition.parameter);
          return Number.isFinite(parsed.getTime())
            ? [parsed.getUTCFullYear()]
            : [];
        }),
      );
      const includeYear = years.size > 1;
      const bottomMargin =
        MARGIN.bottom + (Number(includeTime) + Number(includeYear)) * 13;
      container.replaceChildren();
      const tooltip = d3
        .select(container)
        .append('div')
        .attr('class', styles.workflowResourceChartTooltip)
        .attr('role', 'tooltip')
        .style('visibility', 'hidden');
      const svg = d3
        .select(container)
        .append('svg')
        .attr('aria-label', title)
        .attr('class', styles.workflowHealthChartSvg)
        .attr('role', 'img')
        .attr('viewBox', `0 0 ${width} ${HEIGHT}`)
        .attr('width', '100%');
      svg.append('title').text(title);
      const x = d3
        .scaleBand<string>()
        .domain(data.map(datum => datum.parameter))
        .range([MARGIN.left, width - MARGIN.right])
        .padding(0.35);
      const maximum = Math.max(0, ...values);
      const y = d3
        .scaleLinear()
        .domain([0, maximum ? maximum * 1.1 : 1])
        .nice()
        .range([HEIGHT - bottomMargin, MARGIN.top]);
      svg
        .append('g')
        .attr('class', styles.workflowHealthYAxis)
        .attr('transform', `translate(${MARGIN.left},0)`)
        .call(
          d3
            .axisLeft(y)
            .ticks(4)
            .tickFormat(value => formatter(Number(value)))
            .tickSize(-(width - MARGIN.left - MARGIN.right)),
        );
      const xAxis = svg
        .append('g')
        .attr('class', styles.workflowHealthXAxis)
        .attr('transform', `translate(0,${HEIGHT - bottomMargin})`)
        .call(
          d3
            .axisBottom(x)
            .tickFormat(value =>
              workflowPartitionAxisLabel(
                String(value),
                includeTime,
                includeYear,
              ),
            ),
        );
      xAxis.selectAll<SVGTextElement, string>('text').each(function () {
        const label = d3.select(this);
        const lines = label.text().split('\n');
        label.text(null).attr('dy', null);
        lines.forEach((line, index) => {
          label
            .append('tspan')
            .attr('x', 0)
            .attr('dy', index === 0 ? '0.71em' : '1.1em')
            .text(line);
        });
      });
      const bars = svg
        .append('g')
        .selectAll('g')
        .data(data.filter(datum => datum.value != null))
        .join('g')
        .attr(
          'aria-label',
          datum =>
            `${datum.parameter}: ${workflowResourceTooltipRows(datum.partition)
              .map(row => `${row.label} ${row.value}`)
              .join(', ')}`,
        )
        .attr('role', 'img')
        .attr('tabindex', 0);
      bars
        .append('rect')
        .attr('class', styles.workflowHealthBar)
        .attr('x', datum => x(datum.parameter) || MARGIN.left)
        .attr('width', x.bandwidth())
        .attr('y', datum => y(datum.value!))
        .attr('height', datum => y(0) - y(datum.value!));

      const showTooltip = (datum: (typeof data)[number]) => {
        tooltip.selectAll('*').remove();
        tooltip
          .append('strong')
          .attr('class', styles.workflowResourceChartTooltipTitle)
          .text(
            workflowPartitionAxisLabel(
              datum.parameter,
              includeTime,
              includeYear,
            ).replaceAll('\n', ' · '),
          );
        workflowResourceTooltipRows(datum.partition).forEach(row => {
          const tooltipRow = tooltip
            .append('div')
            .attr('class', styles.workflowResourceChartTooltipRow);
          tooltipRow.append('span').text(row.label);
          tooltipRow.append('strong').text(row.value);
        });
        tooltip.style('visibility', 'visible');

        const tooltipNode = tooltip.node();
        const tooltipWidth = tooltipNode?.offsetWidth || 0;
        const tooltipHeight = tooltipNode?.offsetHeight || 0;
        const center = (x(datum.parameter) || MARGIN.left) + x.bandwidth() / 2;
        const left = Math.max(
          0,
          Math.min(width - tooltipWidth, center - tooltipWidth / 2),
        );
        const top = Math.max(0, y(datum.value!) - tooltipHeight - 10);
        tooltip.style('left', `${left}px`).style('top', `${top}px`);
      };

      bars
        .on('mouseenter focus', (_event, datum) => showTooltip(datum))
        .on('mouseleave blur', () => tooltip.style('visibility', 'hidden'));
    };
    void render();
    return () => {
      cancelled = true;
    };
  }, [formatter, metric, partitions, title]);

  return (
    <>
      <div className={styles.workflowResourceChartCanvas} ref={containerRef} />
      <table aria-label={title} className={styles.screenReaderOnly}>
        <thead>
          <tr>
            <th scope="col">Partition</th>
            <th scope="col">Value</th>
          </tr>
        </thead>
        <tbody>
          {partitions.map(partition => (
            <tr key={partition.parameter}>
              <th scope="row">{partition.parameter}</th>
              <td>{formatter(workflowResourceValue(partition, metric))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
