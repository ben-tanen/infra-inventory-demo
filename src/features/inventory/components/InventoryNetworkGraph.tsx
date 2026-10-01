import type { SimulationLinkDatum, SimulationNodeDatum } from 'd3';
import React, { useEffect, useId, useRef, useState } from 'react';

import type { InventoryEntity, InventoryRelationship } from '../contracts';
import styles from '../Inventory.module.css';

interface InventoryNetworkGraphProps {
  directEntityIds: ReadonlySet<string>;
  entities: InventoryEntity[];
  onRevealInTable: (entityId: string) => void;
  onSelect: (entityId: string | null) => void;
  relationships: InventoryRelationship[];
  selectedEntityId: string | null;
  showLabels: boolean;
}

interface GraphNode extends SimulationNodeDatum {
  entity: InventoryEntity;
  id: string;
}

interface GraphLink extends SimulationLinkDatum<GraphNode> {
  id: string;
  records: InventoryRelationship[];
  source: string | GraphNode;
  target: string | GraphNode;
}

const NODE_COLORS: Record<string, string> = {
  component: '#1ed760',
  gcp_project: '#509bf5',
  repository: '#af80ff',
  unknown: '#8f8f8f',
  workflow: '#ffa42b',
};
const MAX_GRAPH_ENTITIES = 250;
export const AUTO_GRAPH_LABEL_LIMIT = 60;

function graphLinks(relationships: InventoryRelationship[]): GraphLink[] {
  const grouped = new Map<string, InventoryRelationship[]>();
  for (const relationship of relationships) {
    const pair = [
      relationship.sourceEntityId,
      relationship.targetEntityId,
    ].sort();
    const key = pair.join('\u0000');
    grouped.set(key, [...(grouped.get(key) || []), relationship]);
  }
  return [...grouped.entries()].map(([id, records]) => {
    const [source, target] = id.split('\u0000');
    return { id, records, source, target };
  });
}

function updateSelectedNode(
  container: HTMLDivElement,
  selectedEntityId: string | null,
): void {
  container.querySelectorAll<SVGGElement>('[data-entity-id]').forEach(node => {
    const selected = node.dataset.entityId === selectedEntityId;
    const circle = node.querySelector('circle');
    node.setAttribute('aria-pressed', String(selected));
    circle?.setAttribute('r', selected ? '10' : '7');
    circle?.setAttribute('stroke', selected ? '#121212' : '#ffffff');
    circle?.setAttribute('stroke-width', selected ? '3' : '1.5');
  });
}

function updateNodeLabels(
  container: HTMLDivElement,
  showLabels: boolean,
): void {
  container.querySelectorAll<SVGGElement>('[data-entity-id]').forEach(node => {
    const existing = node.querySelector<SVGTextElement>('[data-node-label]');
    if (!showLabels) {
      existing?.remove();
      return;
    }
    const label =
      existing ||
      document.createElementNS('http://www.w3.org/2000/svg', 'text');
    label.setAttribute('data-node-label', 'true');
    label.setAttribute('dx', '10');
    label.setAttribute('dy', '4');
    label.setAttribute('font-size', '10');
    label.setAttribute(
      'opacity',
      node.dataset.directMatch === 'true' ? '1' : '0.5',
    );
    label.setAttribute('paint-order', 'stroke');
    label.setAttribute('stroke', '#ffffff');
    label.setAttribute('stroke-width', '3');
    label.textContent = node.dataset.entityName || '';
    if (!existing) node.append(label);
  });
}

interface TooltipDetail {
  label: string;
  value: string;
}

function nodeTooltipDetails(entity: InventoryEntity): TooltipDetail[] {
  const details = [
    { label: 'Entity ID', value: entity.id },
    { label: 'Owner', value: entity.owner || 'No owner' },
    {
      label: 'Initiative tags',
      value: entity.initiativeTags.length
        ? entity.initiativeTags.join(', ')
        : 'None',
    },
  ];
  if (entity.attributes.component) {
    details.push(
      {
        label: 'Component type',
        value: entity.attributes.component.componentType || 'Unavailable',
      },
      {
        label: 'Lifecycle',
        value: entity.attributes.component.lifecycle || 'Unavailable',
      },
    );
  }
  if (entity.attributes.gcpProject) {
    details.push({
      label: 'Project ID',
      value: entity.attributes.gcpProject.projectId || 'Unavailable',
    });
  }
  if (entity.attributes.repository) {
    details.push({
      label: 'Repository',
      value: entity.attributes.repository.fullName || 'Unavailable',
    });
  }
  if (entity.attributes.workflow) {
    details.push(
      {
        label: 'Parent',
        value: entity.attributes.workflow.parentComponentId || 'Unavailable',
      },
      {
        label: 'Schedule',
        value: entity.attributes.workflow.schedule || 'Unavailable',
      },
      {
        label: 'Offset',
        value: entity.attributes.workflow.offset || 'Unavailable',
      },
    );
  }
  return details;
}

function populateNodeTooltip(
  tooltip: HTMLDivElement,
  entity: InventoryEntity,
  isDirectMatch: boolean,
  onRevealInTable: (entityId: string) => void,
): void {
  tooltip.replaceChildren();

  const header = document.createElement('div');
  header.className = styles.graphTooltipHeader;
  const title = document.createElement('strong');
  title.className = styles.graphTooltipTitle;
  title.textContent = entity.name;
  const type = document.createElement('span');
  type.className = styles.graphTooltipType;
  type.textContent = entity.type.replaceAll('_', ' ');
  const matchStatus = document.createElement('span');
  matchStatus.className = isDirectMatch
    ? `${styles.graphTooltipStatus} ${styles.graphTooltipMatch}`
    : `${styles.graphTooltipStatus} ${styles.graphTooltipRelated}`;
  matchStatus.textContent = isDirectMatch ? 'Filter match' : 'Related entity';
  const badges = document.createElement('span');
  badges.className = styles.graphTooltipBadges;
  badges.append(type, matchStatus);
  header.append(title, badges);

  const details = document.createElement('dl');
  details.className = styles.graphTooltipDetails;
  for (const detail of nodeTooltipDetails(entity)) {
    const label = document.createElement('dt');
    label.textContent = detail.label;
    const value = document.createElement('dd');
    value.textContent = detail.value;
    details.append(label, value);
  }
  const action = document.createElement('button');
  action.className = styles.graphTooltipAction;
  action.type = 'button';
  action.textContent = 'Scroll to table row';
  action.addEventListener('click', () => onRevealInTable(entity.id));
  tooltip.append(header, details, action);
}

export function InventoryNetworkGraph({
  directEntityIds,
  entities,
  onRevealInTable,
  onSelect,
  relationships,
  selectedEntityId,
  showLabels,
}: InventoryNetworkGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const selectedEntityIdRef = useRef(selectedEntityId);
  selectedEntityIdRef.current = selectedEntityId;
  const showLabelsRef = useRef(showLabels);
  showLabelsRef.current = showLabels;
  const [largeResultsApproved, setLargeResultsApproved] = useState(false);
  const canRenderGraph =
    entities.length <= MAX_GRAPH_ENTITIES || largeResultsApproved;
  const reactTooltipId = useId();
  const tooltipId = `inventory-network-tooltip-${reactTooltipId.replaceAll(':', '')}`;
  const largeGraphWarningId = `inventory-network-warning-${reactTooltipId.replaceAll(':', '')}`;

  useEffect(() => {
    const container = containerRef.current;
    if (!container || entities.length === 0 || !canRenderGraph) return;
    let cancelled = false;
    let stop: (() => void) | null = null;
    let hideTooltipTimer: ReturnType<typeof setTimeout> | null = null;

    const render = async () => {
      const d3 = await import('d3');
      if (cancelled || !containerRef.current) return;
      const target = containerRef.current;
      stop?.();
      stop = null;
      target.replaceChildren();
      const width = Math.max(640, target.clientWidth);
      const height = 480;
      const nodes: GraphNode[] = entities.map(entity => ({
        entity,
        id: entity.id,
      }));
      const links = graphLinks(relationships);
      const svg = d3
        .select(target)
        .append('svg')
        .attr(
          'aria-label',
          `Inventory network with ${entities.length} entities`,
        )
        .attr('height', height)
        .attr('role', 'img')
        .attr('viewBox', `0 0 ${width} ${height}`)
        .attr('width', '100%');
      const tooltip = document.createElement('div');
      tooltip.className = styles.graphTooltip;
      tooltip.hidden = true;
      tooltip.id = tooltipId;
      tooltip.setAttribute('role', 'dialog');
      target.append(tooltip);
      let activeTooltipNode: SVGGElement | null = null;
      let suppressNextFocusTooltip = false;

      const cancelTooltipHide = () => {
        if (hideTooltipTimer === null) return;
        clearTimeout(hideTooltipTimer);
        hideTooltipTimer = null;
      };

      const positionTooltip = (clientX: number, clientY: number) => {
        const containerBounds = target.getBoundingClientRect();
        const gap = 12;
        const minimumInset = 8;
        let left = clientX - containerBounds.left + gap;
        let top = clientY - containerBounds.top + gap;

        if (left + tooltip.offsetWidth + minimumInset > containerBounds.width) {
          left = clientX - containerBounds.left - tooltip.offsetWidth - gap;
        }
        if (
          top + tooltip.offsetHeight + minimumInset >
          containerBounds.height
        ) {
          top = clientY - containerBounds.top - tooltip.offsetHeight - gap;
        }
        tooltip.style.left = `${Math.max(minimumInset, left)}px`;
        tooltip.style.top = `${Math.max(minimumInset, top)}px`;
      };

      const showTooltip = (
        entity: InventoryEntity,
        element: SVGGElement,
        clientX: number,
        clientY: number,
      ) => {
        cancelTooltipHide();
        activeTooltipNode?.removeAttribute('aria-controls');
        populateNodeTooltip(
          tooltip,
          entity,
          directEntityIds.has(entity.id),
          onRevealInTable,
        );
        tooltip.hidden = false;
        tooltip.setAttribute('aria-label', `${entity.name} details`);
        element.setAttribute('aria-controls', tooltipId);
        activeTooltipNode = element;
        positionTooltip(clientX, clientY);
      };

      const hideTooltip = () => {
        cancelTooltipHide();
        tooltip.hidden = true;
        activeTooltipNode?.removeAttribute('aria-controls');
        activeTooltipNode = null;
      };

      const scheduleTooltipHide = () => {
        cancelTooltipHide();
        hideTooltipTimer = setTimeout(hideTooltip, 150);
      };

      tooltip.addEventListener('mouseenter', cancelTooltipHide);
      tooltip.addEventListener('mouseleave', scheduleTooltipHide);
      tooltip.addEventListener('focusin', cancelTooltipHide);
      tooltip.addEventListener('focusout', event => {
        if (activeTooltipNode?.contains(event.relatedTarget as Node)) return;
        scheduleTooltipHide();
      });
      tooltip.addEventListener('keydown', event => {
        if (event.key === 'Escape') {
          event.preventDefault();
          const nodeToFocus = activeTooltipNode;
          hideTooltip();
          suppressNextFocusTooltip = true;
          nodeToFocus?.focus();
          queueMicrotask(() => {
            suppressNextFocusTooltip = false;
          });
        } else if (event.key === 'Tab' && event.shiftKey && activeTooltipNode) {
          event.preventDefault();
          activeTooltipNode.focus();
        }
      });

      const zoomLayer = svg.append('g');
      svg.call(
        d3
          .zoom<SVGSVGElement, unknown>()
          .scaleExtent([0.35, 4])
          .on('zoom', event => zoomLayer.attr('transform', event.transform)),
      );
      svg.on('click.clear-selection', event => {
        if (event.target === svg.node()) onSelect(null);
      });

      const link = zoomLayer
        .append('g')
        .attr('stroke', '#a7a7a7')
        .attr('stroke-opacity', 0.58)
        .selectAll('line')
        .data(links)
        .join('line')
        .attr('stroke-width', item =>
          Math.min(4, 1 + item.records.length * 0.5),
        );
      link.append('title').text(item =>
        item.records
          .map(record => {
            return `${record.type}: ${record.sourceEntityId} → ${record.targetEntityId}${
              record.statuses.length ? `\n${record.statuses.join(', ')}` : ''
            }`;
          })
          .join('\n'),
      );

      const node = zoomLayer
        .append('g')
        .selectAll<SVGGElement, GraphNode>('g')
        .data(nodes)
        .join('g')
        .attr('aria-label', item => `${item.entity.name}, ${item.entity.type}`)
        .attr('data-direct-match', item => String(directEntityIds.has(item.id)))
        .attr('data-entity-id', item => item.id)
        .attr('data-entity-name', item => item.entity.name)
        .attr('cursor', 'pointer')
        .attr('role', 'button')
        .attr('tabindex', 0)
        .on('click', (event, item) => {
          event.stopPropagation();
          onSelect(selectedEntityIdRef.current === item.id ? null : item.id);
        })
        .on('mouseenter', function (event, item) {
          showTooltip(item.entity, this, event.clientX, event.clientY);
        })
        .on('mousemove', event => positionTooltip(event.clientX, event.clientY))
        .on('mouseleave', scheduleTooltipHide)
        .on('focus', function (_, item) {
          if (suppressNextFocusTooltip) return;
          const bounds = this.getBoundingClientRect();
          showTooltip(
            item.entity,
            this,
            bounds.right,
            bounds.top + bounds.height / 2,
          );
        })
        .on('blur', function (event) {
          if (tooltip.contains(event.relatedTarget as Node)) return;
          scheduleTooltipHide();
        })
        .on('keydown', (event, item) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onSelect(selectedEntityIdRef.current === item.id ? null : item.id);
          } else if (event.key === 'Tab' && !event.shiftKey) {
            const action = tooltip.querySelector<HTMLButtonElement>('button');
            if (action && activeTooltipNode === event.currentTarget) {
              event.preventDefault();
              action.focus();
            }
          }
        });

      node
        .append('circle')
        .attr(
          'fill',
          item => NODE_COLORS[item.entity.type] || NODE_COLORS.unknown,
        )
        .attr('r', 7)
        .attr('stroke', '#ffffff')
        .attr('stroke-width', 1.5);
      updateSelectedNode(target, selectedEntityIdRef.current);
      updateNodeLabels(target, showLabelsRef.current);

      const simulation = d3
        .forceSimulation(nodes)
        .force(
          'link',
          d3
            .forceLink<GraphNode, GraphLink>(links)
            .id(item => item.id)
            .distance(100)
            .strength(1),
        )
        .force(
          'charge',
          d3
            .forceManyBody<GraphNode>()
            .strength(-150)
            .distanceMin(10)
            .distanceMax(500),
        )
        .force('center', d3.forceCenter(width / 2, height / 2))
        .force('x', d3.forceX<GraphNode>(width / 2).strength(0.007))
        .force('y', d3.forceY<GraphNode>(height / 2).strength(0.007))
        .force(
          'collision',
          d3.forceCollide<GraphNode>().radius(11).strength(1).iterations(2),
        )
        .on('tick', () => {
          link
            .attr('x1', item => (item.source as GraphNode).x || 0)
            .attr('y1', item => (item.source as GraphNode).y || 0)
            .attr('x2', item => (item.target as GraphNode).x || 0)
            .attr('y2', item => (item.target as GraphNode).y || 0);
          node.attr(
            'transform',
            item => `translate(${item.x || 0},${item.y || 0})`,
          );
        });

      node.call(
        d3
          .drag<SVGGElement, GraphNode>()
          .on('start', (event, item) => {
            if (!event.active) simulation.alphaTarget(0.3).restart();
            item.fx = item.x;
            item.fy = item.y;
          })
          .on('drag', (event, item) => {
            item.fx = event.x;
            item.fy = event.y;
          })
          .on('end', (event, item) => {
            if (!event.active) simulation.alphaTarget(0);
            item.fx = null;
            item.fy = null;
          }),
      );
      stop = () => {
        cancelTooltipHide();
        simulation.stop();
      };
    };

    void render();
    const observer =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => void render());
    observer?.observe(container);
    return () => {
      cancelled = true;
      stop?.();
      observer?.disconnect();
      container.replaceChildren();
    };
  }, [
    canRenderGraph,
    directEntityIds,
    entities,
    onRevealInTable,
    onSelect,
    relationships,
    tooltipId,
  ]);

  useEffect(() => {
    if (containerRef.current) {
      updateSelectedNode(containerRef.current, selectedEntityId);
    }
  }, [selectedEntityId]);

  useEffect(() => {
    if (containerRef.current) {
      updateNodeLabels(containerRef.current, showLabels);
    }
  }, [showLabels]);

  if (entities.length > MAX_GRAPH_ENTITIES && !largeResultsApproved) {
    return (
      <div className={styles.graphMessage} key="large-result-warning">
        <p id={largeGraphWarningId}>
          This result contains {entities.length.toLocaleString()} entities.
          Rendering more than {MAX_GRAPH_ENTITIES.toLocaleString()} nodes may be
          slow or cause this page to become unresponsive. Narrow the filters or
          reduce related depth for a more readable graph.
        </p>
        <button
          aria-describedby={largeGraphWarningId}
          className={styles.secondaryButton}
          onClick={() => setLargeResultsApproved(true)}
          type="button"
        >
          Render {entities.length.toLocaleString()}-node graph anyway
        </button>
      </div>
    );
  }
  if (entities.length === 0) {
    return (
      <div className={styles.graphMessage} key="empty-result-message">
        No entities match these filters.
      </div>
    );
  }
  return (
    <div className={styles.graph} key="network-graph" ref={containerRef} />
  );
}
