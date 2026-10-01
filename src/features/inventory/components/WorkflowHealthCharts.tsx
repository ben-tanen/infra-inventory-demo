import React, { useEffect, useRef } from 'react';
import type { AxisScale, ScaleLinear, Selection } from 'd3';

import type { WorkflowPartitionHealth } from '../contracts';
import styles from '../Inventory.module.css';

interface WorkflowHealthChartsProps {
  completionMedian: number | null;
  executionMedian: number | null;
  formatCompletion: (value: number | null) => string;
  formatDuration: (value: number | null) => string;
  partitions: WorkflowPartitionHealth[];
}

interface ChartDatum {
  parameter: string;
  value: number | null;
}

const HEIGHT = 245;
const MARGIN = { bottom: 42, right: 18, top: 12 };

export function completionTimeDomain(
  values: number[],
  median: number | null,
): [number, number] {
  if (!values.length) return [0, 1];
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const range = maximum - minimum;
  const center = median ?? (minimum + maximum) / 2;
  const halfDomain =
    range === 0
      ? Math.max(Math.abs(center) * 0.1, 60_000)
      : range / 2 + range * 0.1;
  const padding = range * 0.1;
  const domainMinimum = Math.max(
    0,
    Math.min(center - halfDomain, minimum - padding),
  );
  const domainMaximum = Math.max(center + halfDomain, maximum + padding);
  return domainMaximum > domainMinimum
    ? [domainMinimum, domainMaximum]
    : [domainMinimum, domainMinimum + 1];
}

export function yAxisLeftMargin(labels: string[]): number {
  const longestLabel = Math.max(0, ...labels.map(label => label.length));
  return Math.max(52, Math.ceil(longestLabel * 5.7 + 12));
}

function valueLabelX(
  markX: number,
  label: string,
  leftMargin: number,
  width: number,
): number {
  const plotWidth = width - leftMargin - MARGIN.right;
  const halfLabelWidth = Math.min((label.length * 5.7) / 2, plotWidth / 2);
  return Math.max(
    leftMargin + halfLabelWidth,
    Math.min(width - MARGIN.right - halfLabelWidth, markX),
  );
}

function partitionDate(parameter: string): Date | null {
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(parameter)
    ? `${parameter}T00:00:00Z`
    : /^\d{4}-\d{2}-\d{2}T\d{2}$/.test(parameter)
      ? `${parameter}:00:00Z`
      : parameter;
  const parsed = new Date(normalized);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

export function workflowPartitionAxisLabel(
  parameter: string,
  includeTime: boolean,
  includeYear: boolean,
): string {
  const parsed = partitionDate(parameter);
  if (!parsed) return parameter;
  const month = parsed.toLocaleString('en-US', {
    month: 'short',
    timeZone: 'UTC',
  });
  const lines = [`${month} ${String(parsed.getUTCDate()).padStart(2, '0')}`];
  if (includeYear) lines.push(String(parsed.getUTCFullYear()));
  if (includeTime) {
    lines.push(
      [parsed.getUTCHours(), parsed.getUTCMinutes()]
        .map(value => String(value).padStart(2, '0'))
        .join(':'),
    );
  }
  return lines.join('\n');
}

function AccessibleDataTable({
  formatter,
  median,
  partitions,
  title,
  value,
}: {
  formatter: (value: number | null) => string;
  median: number | null;
  partitions: WorkflowPartitionHealth[];
  title: string;
  value: (partition: WorkflowPartitionHealth) => number | null;
}) {
  return (
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
            <td>{formatter(value(partition))}</td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr>
          <th scope="row">Median</th>
          <td>{formatter(median)}</td>
        </tr>
      </tfoot>
    </table>
  );
}

export function WorkflowHealthCharts({
  completionMedian,
  executionMedian,
  formatCompletion,
  formatDuration,
  partitions,
}: WorkflowHealthChartsProps) {
  const completionRef = useRef<HTMLDivElement>(null);
  const executionRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const completionContainer = completionRef.current;
    const executionContainer = executionRef.current;
    if (!completionContainer || !executionContainer || !partitions.length)
      return;
    let cancelled = false;

    const render = async () => {
      const d3 = await import('d3');
      if (cancelled || !completionRef.current || !executionRef.current) return;
      const includeTime = partitions.some(partition =>
        partition.parameter.includes('T'),
      );
      const years = new Set(
        partitions.flatMap(partition => {
          const parsed = partitionDate(partition.parameter);
          return parsed ? [parsed.getUTCFullYear()] : [];
        }),
      );
      const includeYear = years.size > 1;
      const tickLineCount = 1 + Number(includeTime) + Number(includeYear);
      const bottomMargin = MARGIN.bottom + (tickLineCount - 1) * 13;

      const drawAxes = (
        svg: Selection<SVGSVGElement, unknown, null, undefined>,
        width: number,
        leftMargin: number,
        x: AxisScale<string>,
        y: ScaleLinear<number, number>,
        formatter: (value: number | null) => string,
      ) => {
        svg
          .append('g')
          .attr('class', styles.workflowHealthYAxis)
          .attr('transform', `translate(${leftMargin},0)`)
          .call(
            d3
              .axisLeft(y)
              .ticks(4)
              .tickFormat(value => formatter(Number(value)))
              .tickSize(-(width - leftMargin - MARGIN.right)),
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
      };

      const addMedian = (
        svg: Selection<SVGSVGElement, unknown, null, undefined>,
        width: number,
        leftMargin: number,
        y: ScaleLinear<number, number>,
        median: number | null,
      ) => {
        if (median == null) return;
        const medianY = y(median);
        svg
          .append('line')
          .attr('class', styles.workflowHealthMedianLine)
          .attr('x1', leftMargin)
          .attr('x2', width - MARGIN.right)
          .attr('y1', medianY)
          .attr('y2', medianY);
        svg
          .append('text')
          .attr('class', styles.workflowHealthMedianLabel)
          .attr('text-anchor', 'end')
          .attr('x', width - MARGIN.right)
          .attr('y', Math.max(12, medianY - 6))
          .text('median');
      };

      const completionData: ChartDatum[] = partitions.map(partition => ({
        parameter: partition.parameter,
        value: partition.completionOffsetMs,
      }));
      const completionValues = completionData.flatMap(datum =>
        datum.value == null ? [] : [datum.value],
      );
      const completionDomain = completionTimeDomain(
        completionValues,
        completionMedian,
      );
      const completionTickFormatter = formatCompletion;
      const completionLeftMargin = yAxisLeftMargin(
        d3
          .scaleLinear()
          .domain(completionDomain)
          .ticks(4)
          .map(completionTickFormatter),
      );
      const completionWidth = Math.max(360, completionContainer.clientWidth);
      completionContainer.replaceChildren();
      const completionSvg = d3
        .select(completionContainer)
        .append('svg')
        .attr(
          'aria-label',
          'Completion time for the last seven workflow partitions',
        )
        .attr('class', styles.workflowHealthChartSvg)
        .attr('role', 'img')
        .attr('viewBox', `0 0 ${completionWidth} ${HEIGHT}`)
        .attr('width', '100%');
      completionSvg
        .append('title')
        .text('Completion time for the last seven workflow partitions');
      const completionX = d3
        .scalePoint<string>()
        .domain(completionData.map(datum => datum.parameter))
        .range([completionLeftMargin, completionWidth - MARGIN.right])
        .padding(0.18);
      const completionY = d3
        .scaleLinear()
        .domain(completionDomain)
        .range([HEIGHT - bottomMargin, MARGIN.top]);
      drawAxes(
        completionSvg,
        completionWidth,
        completionLeftMargin,
        completionX,
        completionY,
        completionTickFormatter,
      );
      addMedian(
        completionSvg,
        completionWidth,
        completionLeftMargin,
        completionY,
        completionMedian,
      );
      const completionLine = d3
        .line<ChartDatum>()
        .defined(datum => datum.value != null)
        .x(datum => completionX(datum.parameter) || completionLeftMargin)
        .y(datum => completionY(datum.value!));
      completionSvg
        .append('path')
        .datum(completionData)
        .attr('class', styles.workflowHealthLine)
        .attr('d', completionLine);
      const completionPoints = completionSvg
        .append('g')
        .selectAll('g')
        .data(completionData.filter(datum => datum.value != null))
        .join('g')
        .attr(
          'aria-label',
          datum => `${datum.parameter}: ${formatCompletion(datum.value)}`,
        )
        .attr('role', 'img')
        .attr('tabindex', 0)
        .on('mouseenter.valueLabel focus.valueLabel', function () {
          d3.select(this)
            .select(`.${styles.workflowHealthValueLabel}`)
            .attr('visibility', 'visible');
        })
        .on('mouseleave.valueLabel blur.valueLabel', function () {
          d3.select(this)
            .select(`.${styles.workflowHealthValueLabel}`)
            .attr('visibility', 'hidden');
        });
      completionPoints
        .append('circle')
        .attr('class', styles.workflowHealthDot)
        .attr(
          'cx',
          datum => completionX(datum.parameter) || completionLeftMargin,
        )
        .attr('cy', datum => completionY(datum.value!))
        .attr('r', 4);
      completionPoints
        .append('text')
        .attr('aria-hidden', 'true')
        .attr('class', styles.workflowHealthValueLabel)
        .attr('text-anchor', 'middle')
        .attr('visibility', 'hidden')
        .attr('x', datum => {
          const label = formatCompletion(datum.value);
          const markX = completionX(datum.parameter) || completionLeftMargin;
          return valueLabelX(
            markX,
            label,
            completionLeftMargin,
            completionWidth,
          );
        })
        .attr('y', datum => Math.max(11, completionY(datum.value!) - 8))
        .text(datum => formatCompletion(datum.value));

      const executionData: ChartDatum[] = partitions.map(partition => ({
        parameter: partition.parameter,
        value: partition.runtimeMs,
      }));
      const executionMaximum = Math.max(
        0,
        ...executionData.map(datum => datum.value || 0),
        executionMedian || 0,
      );
      const executionDomain: [number, number] = [
        0,
        executionMaximum ? executionMaximum * 1.1 : 1,
      ];
      const executionLeftMargin = yAxisLeftMargin(
        d3
          .scaleLinear()
          .domain(executionDomain)
          .ticks(4)
          .map(value => formatDuration(value)),
      );
      const executionWidth = Math.max(360, executionContainer.clientWidth);
      executionContainer.replaceChildren();
      const executionSvg = d3
        .select(executionContainer)
        .append('svg')
        .attr('aria-label', 'Runtime for the last seven workflow partitions')
        .attr('class', styles.workflowHealthChartSvg)
        .attr('role', 'img')
        .attr('viewBox', `0 0 ${executionWidth} ${HEIGHT}`)
        .attr('width', '100%');
      executionSvg
        .append('title')
        .text('Runtime for the last seven workflow partitions');
      const executionX = d3
        .scaleBand<string>()
        .domain(executionData.map(datum => datum.parameter))
        .range([executionLeftMargin, executionWidth - MARGIN.right])
        .padding(0.55);
      const executionY = d3
        .scaleLinear()
        .domain(executionDomain)
        .range([HEIGHT - bottomMargin, MARGIN.top]);
      drawAxes(
        executionSvg,
        executionWidth,
        executionLeftMargin,
        executionX,
        executionY,
        formatDuration,
      );
      addMedian(
        executionSvg,
        executionWidth,
        executionLeftMargin,
        executionY,
        executionMedian,
      );
      const executionBars = executionSvg
        .append('g')
        .selectAll('g')
        .data(executionData.filter(datum => datum.value != null))
        .join('g')
        .attr(
          'aria-label',
          datum => `${datum.parameter}: ${formatDuration(datum.value)}`,
        )
        .attr('role', 'img')
        .attr('tabindex', 0)
        .on('mouseenter.valueLabel focus.valueLabel', function () {
          d3.select(this)
            .select(`.${styles.workflowHealthValueLabel}`)
            .attr('visibility', 'visible');
        })
        .on('mouseleave.valueLabel blur.valueLabel', function () {
          d3.select(this)
            .select(`.${styles.workflowHealthValueLabel}`)
            .attr('visibility', 'hidden');
        });
      executionBars
        .append('rect')
        .attr('class', styles.workflowHealthBar)
        .attr('height', datum => executionY(0) - executionY(datum.value!))
        .attr('width', executionX.bandwidth())
        .attr('x', datum => executionX(datum.parameter) || executionLeftMargin)
        .attr('y', datum => executionY(datum.value!));
      executionBars
        .append('text')
        .attr('aria-hidden', 'true')
        .attr('class', styles.workflowHealthValueLabel)
        .attr('text-anchor', 'middle')
        .attr('visibility', 'hidden')
        .attr('x', datum => {
          const label = formatDuration(datum.value);
          const barX = executionX(datum.parameter) || executionLeftMargin;
          return valueLabelX(
            barX + executionX.bandwidth() / 2,
            label,
            executionLeftMargin,
            executionWidth,
          );
        })
        .attr('y', datum => Math.max(11, executionY(datum.value!) - 8))
        .text(datum => formatDuration(datum.value));
    };

    void render();
    const observer =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => void render());
    observer?.observe(completionContainer);
    observer?.observe(executionContainer);
    return () => {
      cancelled = true;
      observer?.disconnect();
      completionContainer.replaceChildren();
      executionContainer.replaceChildren();
    };
  }, [
    completionMedian,
    executionMedian,
    formatCompletion,
    formatDuration,
    partitions,
  ]);

  return (
    <div className={styles.workflowHealthCharts}>
      <section className={styles.workflowHealthChart}>
        <h5>Completion time</h5>
        <p>
          Elapsed time from logical partition to first successful completion
        </p>
        <div ref={completionRef} />
        <AccessibleDataTable
          formatter={formatCompletion}
          median={completionMedian}
          partitions={partitions}
          title="Completion time"
          value={partition => partition.completionOffsetMs}
        />
      </section>
      <section className={styles.workflowHealthChart}>
        <h5>Runtime</h5>
        <p>Execution time of the latest successful execution</p>
        <div ref={executionRef} />
        <AccessibleDataTable
          formatter={formatDuration}
          median={executionMedian}
          partitions={partitions}
          title="Runtime"
          value={partition => partition.runtimeMs}
        />
      </section>
    </div>
  );
}
