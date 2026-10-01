import React, { useEffect, useId, useMemo, useRef, useState } from 'react';

import type { InventoryEntity, InventoryRelationship } from '../contracts';
import { INVENTORY_DEEP_DIVE_LINKS } from '../deepDiveLinks';
import { INVENTORY_FILTER_FIELDS } from '../filterDefinitions';
import { buildInventoryFilterContext } from '../filterExpression';
import styles from '../Inventory.module.css';
import { ComponentWorkflowMetricsPanel } from './ComponentWorkflowMetricsPanel';
import { GcpProjectJobsPanel } from './GcpProjectJobsPanel';
import { WorkflowHealthPanel } from './WorkflowHealthPanel';
import { WorkflowResourcesPanel } from './WorkflowResourcesPanel';

interface InventoryTableProps {
  allEntities: InventoryEntity[];
  directEntityIds: Set<string>;
  onRevealInTable: (entityId: string) => void;
  onSelect: (entityId: string) => void;
  relationships: InventoryRelationship[];
  revealRequest: InventoryTableRevealRequest | null;
  selectedEntityId: string | null;
  visibleEntityIds: Set<string>;
}

export interface InventoryTableRevealRequest {
  entityId: string;
  sequence: number;
}

interface RelatedEntitySummary {
  entity: InventoryEntity;
  relationshipTypes: string[];
}

interface RelatedEntityGroup {
  items: RelatedEntitySummary[];
  type: string;
}

const PAGE_SIZE = 50;
const DESCRIPTION_MAX_CHARS = 50;
const DAY_MS = 86_400_000;

function displayType(type: string): string {
  return type.replaceAll('_', ' ');
}

function searchableText(
  entity: InventoryEntity,
  filterContext: ReturnType<typeof buildInventoryFilterContext>,
): string {
  return INVENTORY_FILTER_FIELDS.flatMap(definition => {
    const value = definition.read(entity, filterContext);
    return Array.isArray(value) ? value : value == null ? [] : [value];
  })
    .join(' ')
    .toLocaleLowerCase();
}

function truncateDescription(value: string | null): string {
  if (!value) return 'Unavailable';
  if (value.length <= DESCRIPTION_MAX_CHARS) return value;
  return `${value.slice(0, DESCRIPTION_MAX_CHARS - 1).trimEnd()}…`;
}

function timestamp(value: string | null): number | null {
  if (!value) return null;
  const milliseconds = new Date(value).getTime();
  return Number.isFinite(milliseconds) ? milliseconds : null;
}

function formatUtcTimestamp(value: string | null): string {
  const milliseconds = timestamp(value);
  if (milliseconds == null) return 'Unavailable';
  return (
    new Date(milliseconds).toISOString().slice(0, 16).replace('T', ' ') + ' UTC'
  );
}

function formatRelativeAge(value: string | null): string | null {
  const milliseconds = timestamp(value);
  if (milliseconds == null) return null;
  const elapsed = Math.max(0, Date.now() - milliseconds);
  const days = Math.floor(elapsed / DAY_MS);
  return days < 1
    ? '<1 days ago'
    : days === 1
      ? '1 day ago'
      : `${days} days ago`;
}

function formatLastUpdated(value: string | null): string {
  const milliseconds = timestamp(value);
  if (milliseconds == null) return 'Unavailable';
  const relative = formatRelativeAge(value);
  const formatted =
    new Date(milliseconds).toISOString().slice(0, 19).replace('T', ' ') +
    ' UTC';
  return `${formatted} (${relative})`;
}

function repositoryCommit(
  entity: InventoryEntity,
  commit: { committedAt: string | null; sha: string | null },
): React.ReactNode {
  if (!commit.sha) return 'Unavailable';
  const shortSha = commit.sha.slice(0, 7);
  const relative = formatRelativeAge(commit.committedAt);
  const link = entity.url
    ? `${entity.url.replace(/\/$/, '')}/commit/${commit.sha}`
    : null;
  return (
    <>
      {link ? (
        <a href={link} rel="noreferrer" target="_blank">
          {shortSha}
        </a>
      ) : (
        shortSha
      )}
      {relative ? ` (${relative})` : null}
    </>
  );
}

function attributeRows(
  entity: InventoryEntity,
): Array<[string, React.ReactNode]> {
  const attributes = entity.attributes;
  if (attributes.component) {
    return [
      ['Component type', attributes.component.componentType || 'Unavailable'],
      ['Lifecycle', attributes.component.lifecycle || 'Unavailable'],
    ];
  }
  if (attributes.gcpProject) {
    return [['Project ID', attributes.gcpProject.projectId || 'Unavailable']];
  }
  if (attributes.repository) {
    return [
      ['Repository', attributes.repository.fullName || 'Unavailable'],
      ['Description', truncateDescription(attributes.repository.description)],
      [
        'Archived',
        attributes.repository.archived == null
          ? 'Unavailable'
          : attributes.repository.archived
            ? 'Yes'
            : 'No',
      ],
      [
        'Forked',
        attributes.repository.forked == null
          ? 'Unavailable'
          : attributes.repository.forked
            ? 'Yes'
            : 'No',
      ],
      ['Created', formatUtcTimestamp(attributes.repository.createdAt)],
      ['Last Updated', formatLastUpdated(attributes.repository.pushedAt)],
      [
        'Last Human Commit',
        repositoryCommit(entity, attributes.repository.lastHumanCommit),
      ],
      [
        'Last Bot Commit',
        repositoryCommit(entity, attributes.repository.lastBotCommit),
      ],
    ];
  }
  if (attributes.workflow) {
    return [
      [
        'Enabled',
        attributes.workflow.enabled == null
          ? 'Unavailable'
          : attributes.workflow.enabled
            ? 'Yes'
            : 'No',
      ],
      ['Workflow type', attributes.workflow.workflowType || 'Unavailable'],
      [
        'Orchestration type',
        attributes.workflow.orchestrationType || 'Unavailable',
      ],
      [
        'Parent component',
        attributes.workflow.parentComponentId || 'Unavailable',
      ],
      [
        'BQ job projects',
        attributes.workflow.bqJobProjects.join(', ') || 'Unavailable',
      ],
      [
        'BQ destination table projects',
        attributes.workflow.bqDestinationTableProjects.join(', ') ||
          'Unavailable',
      ],
      ['Schedule', attributes.workflow.schedule || 'Unavailable'],
      ['Offset', attributes.workflow.offset || 'Unavailable'],
      ['Service account', attributes.workflow.serviceAccount || 'Unavailable'],
      ['Orchestrator component', attributes.workflow.orchestratorComponentId || 'Unavailable'],
      ['Orchestrator workflow', attributes.workflow.orchestratorWorkflowId || 'Unavailable'],
    ];
  }
  return [['Attributes', 'No recognized type-specific attributes']];
}

function relatedEntitySummaries(
  entityId: string,
  relationships: InventoryRelationship[],
  entityById: Map<string, InventoryEntity>,
): RelatedEntitySummary[] {
  const relatedById = new Map<
    string,
    { entity: InventoryEntity; relationshipTypes: Set<string> }
  >();

  for (const relationship of relationships) {
    if (
      relationship.sourceEntityId !== entityId &&
      relationship.targetEntityId !== entityId
    )
      continue;
    const relatedId =
      relationship.sourceEntityId === entityId
        ? relationship.targetEntityId
        : relationship.sourceEntityId;
    const relatedEntity = entityById.get(relatedId);
    if (!relatedEntity) continue;
    const summary = relatedById.get(relatedId) || {
      entity: relatedEntity,
      relationshipTypes: new Set<string>(),
    };
    summary.relationshipTypes.add(relationship.type);
    relatedById.set(relatedId, summary);
  }

  return [...relatedById.values()]
    .map(summary => ({
      entity: summary.entity,
      relationshipTypes: [...summary.relationshipTypes].sort(),
    }))
    .sort((left, right) => left.entity.name.localeCompare(right.entity.name));
}

function RelatedEntityListItem({
  item,
  onRevealInTable,
  visible,
}: {
  item: RelatedEntitySummary;
  onRevealInTable: (entityId: string) => void;
  visible: boolean;
}) {
  return (
    <li>
      <button
        className={`${styles.textButton} ${!visible ? styles.hiddenRelatedLink : ''}`}
        onClick={() => onRevealInTable(item.entity.id)}
        type="button"
      >
        {item.entity.name}
      </button>{' '}
      <span>· {item.relationshipTypes.join(', ')}</span>
    </li>
  );
}

function AttributeList({
  label,
  rows,
}: {
  label?: string;
  rows: Array<[string, React.ReactNode]>;
}) {
  return (
    <dl aria-label={label} className={styles.attributeList}>
      {rows.map(([rowLabel, value]) => (
        <React.Fragment key={rowLabel}>
          <dt>{rowLabel}</dt>
          <dd>{value}</dd>
        </React.Fragment>
      ))}
    </dl>
  );
}

function AttributeContent({
  entity,
  twoColumns = false,
}: {
  entity: InventoryEntity;
  twoColumns?: boolean;
}) {
  const rows = attributeRows(entity);
  const splitIndex = Math.ceil(rows.length / 2);
  return (
    <>
      {twoColumns ? (
        <div className={styles.workflowAttributeColumns}>
          <AttributeList
            label="Attributes column 1"
            rows={rows.slice(0, splitIndex)}
          />
          <AttributeList
            label="Attributes column 2"
            rows={rows.slice(splitIndex)}
          />
        </div>
      ) : (
        <AttributeList rows={rows} />
      )}
      {INVENTORY_DEEP_DIVE_LINKS[entity.id]?.map(link => (
        <a href={link.href} key={link.href}>
          {link.label}
        </a>
      ))}
    </>
  );
}

function RelatedEntitiesContent({
  groups,
  onRevealInTable,
  visibleEntityIds,
}: {
  groups: RelatedEntityGroup[];
  onRevealInTable: (entityId: string) => void;
  visibleEntityIds: Set<string>;
}) {
  if (!groups.length) return <p>No resolved related entities.</p>;
  return (
    <>
      {groups.map(group => (
        <div className={styles.relatedGroup} key={group.type}>
          <h4>
            {displayType(group.type)} ({group.items.length})
          </h4>
          <ul className={styles.relatedList}>
            {group.items.slice(0, 5).map(item => (
              <RelatedEntityListItem
                item={item}
                key={item.entity.id}
                onRevealInTable={onRevealInTable}
                visible={visibleEntityIds.has(item.entity.id)}
              />
            ))}
          </ul>
          {group.items.length > 5 && (
            <details>
              <summary>Show {group.items.length - 5} more</summary>
              <ul className={styles.relatedList}>
                {group.items.slice(5).map(item => (
                  <RelatedEntityListItem
                    item={item}
                    key={item.entity.id}
                    onRevealInTable={onRevealInTable}
                    visible={visibleEntityIds.has(item.entity.id)}
                  />
                ))}
              </ul>
            </details>
          )}
        </div>
      ))}
    </>
  );
}

function CollapsibleDetailSection({
  children,
  defaultExpanded,
  title,
}: {
  children: React.ReactNode;
  defaultExpanded: boolean;
  title: string;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const panelId = useId();
  return (
    <section className={styles.workflowDetailSection}>
      <div className={styles.workflowDetailHeading}>
        <button
          aria-controls={panelId}
          aria-expanded={expanded}
          aria-label={`${expanded ? 'Collapse' : 'Expand'} ${title}`}
          className={styles.iconButton}
          onClick={() => setExpanded(current => !current)}
          type="button"
        >
          {expanded ? '−' : '+'}
        </button>
        <h3>{title}</h3>
      </div>
      {expanded && (
        <div className={styles.workflowDetailContent} id={panelId}>
          {children}
        </div>
      )}
    </section>
  );
}

function WorkflowEntityDetails({
  entity,
  onRevealInTable,
  related,
  relatedByType,
  visibleEntityIds,
}: {
  entity: InventoryEntity;
  onRevealInTable: (entityId: string) => void;
  related: RelatedEntitySummary[];
  relatedByType: RelatedEntityGroup[];
  visibleEntityIds: Set<string>;
}) {
  const workflow = entity.attributes.workflow;
  return (
    <div className={styles.workflowDetails}>
      <CollapsibleDetailSection defaultExpanded title="Health">
        {workflow?.orchestratorComponentId && workflow.orchestratorWorkflowId ? (
          <WorkflowHealthPanel
            backstageUrl={entity.url}
            componentId={workflow.orchestratorComponentId}
            workflowId={workflow.orchestratorWorkflowId}
          />
        ) : (
          <p>Live health is unavailable for this workflow.</p>
        )}
      </CollapsibleDetailSection>
      <CollapsibleDetailSection
        defaultExpanded={false}
        title="Execution and resources"
      >
        {workflow?.orchestratorComponentId && workflow.orchestratorWorkflowId ? (
          <WorkflowResourcesPanel
            componentId={workflow.orchestratorComponentId}
            workflowId={workflow.orchestratorWorkflowId}
          />
        ) : (
          <p>Workflow resource data is unavailable for this workflow.</p>
        )}
      </CollapsibleDetailSection>
      <CollapsibleDetailSection defaultExpanded={false} title="Attributes">
        <AttributeContent entity={entity} twoColumns />
      </CollapsibleDetailSection>
      <CollapsibleDetailSection
        defaultExpanded={false}
        title={`Related entities (${related.length})`}
      >
        <RelatedEntitiesContent
          groups={relatedByType}
          onRevealInTable={onRevealInTable}
          visibleEntityIds={visibleEntityIds}
        />
      </CollapsibleDetailSection>
    </div>
  );
}

function ComponentEntityDetails({
  entity,
  onRevealInTable,
  related,
  relatedByType,
  visibleEntityIds,
}: {
  entity: InventoryEntity;
  onRevealInTable: (entityId: string) => void;
  related: RelatedEntitySummary[];
  relatedByType: RelatedEntityGroup[];
  visibleEntityIds: Set<string>;
}) {
  const workflows = related
    .filter(item => item.entity.type === 'workflow')
    .map(item => ({
      enabled: item.entity.attributes.workflow?.enabled ?? null,
      entityId: item.entity.id,
      name: item.entity.name,
      orchestratorComponentId: item.entity.attributes.workflow?.orchestratorComponentId || null,
      orchestratorWorkflowId: item.entity.attributes.workflow?.orchestratorWorkflowId || null,
    }));
  return (
    <div className={styles.workflowDetails}>
      <CollapsibleDetailSection defaultExpanded title="Workflows">
        <ComponentWorkflowMetricsPanel
          backstageWorkflowsUrl={`https://backstage.example.com/catalog/default/component/${encodeURIComponent(entity.name)}/workflows`}
          onRevealInTable={onRevealInTable}
          workflows={workflows}
        />
      </CollapsibleDetailSection>
      <CollapsibleDetailSection defaultExpanded={false} title="Attributes">
        <AttributeContent entity={entity} />
      </CollapsibleDetailSection>
      <CollapsibleDetailSection
        defaultExpanded={false}
        title={`Related entities (${related.length})`}
      >
        <RelatedEntitiesContent
          groups={relatedByType}
          onRevealInTable={onRevealInTable}
          visibleEntityIds={visibleEntityIds}
        />
      </CollapsibleDetailSection>
    </div>
  );
}

function GcpProjectEntityDetails({
  entity,
  onRevealInTable,
  related,
  relatedByType,
  visibleEntityIds,
}: {
  entity: InventoryEntity;
  onRevealInTable: (entityId: string) => void;
  related: RelatedEntitySummary[];
  relatedByType: RelatedEntityGroup[];
  visibleEntityIds: Set<string>;
}) {
  return (
    <div className={styles.workflowDetails}>
      <CollapsibleDetailSection defaultExpanded title="Jobs">
        <GcpProjectJobsPanel
          onRevealInTable={onRevealInTable}
          projectId={entity.attributes.gcpProject?.projectId || entity.name}
        />
      </CollapsibleDetailSection>
      <CollapsibleDetailSection defaultExpanded={false} title="Attributes">
        <AttributeContent entity={entity} />
      </CollapsibleDetailSection>
      <CollapsibleDetailSection
        defaultExpanded={false}
        title={`Related entities (${related.length})`}
      >
        <RelatedEntitiesContent
          groups={relatedByType}
          onRevealInTable={onRevealInTable}
          visibleEntityIds={visibleEntityIds}
        />
      </CollapsibleDetailSection>
    </div>
  );
}

export function InventoryTable({
  allEntities,
  directEntityIds,
  onRevealInTable,
  onSelect,
  relationships,
  revealRequest,
  selectedEntityId,
  visibleEntityIds,
}: InventoryTableProps) {
  const [expandedEntityIds, setExpandedEntityIds] = useState<Set<string>>(
    new Set(),
  );
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState('');
  const [showHidden, setShowHidden] = useState(false);
  const processedRevealSequence = useRef<number | null>(null);
  const rowRefs = useRef(new Map<string, HTMLTableRowElement>());
  const entityById = useMemo(
    () => new Map(allEntities.map(entity => [entity.id, entity])),
    [allEntities],
  );
  const filterContext = useMemo(
    () => buildInventoryFilterContext(relationships),
    [relationships],
  );
  const rows = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return allEntities
      .filter(entity => showHidden || visibleEntityIds.has(entity.id))
      .filter(
        entity =>
          !normalizedQuery ||
          searchableText(entity, filterContext).includes(normalizedQuery),
      )
      .sort((left, right) => {
        const visibilityDifference =
          Number(visibleEntityIds.has(right.id)) -
          Number(visibleEntityIds.has(left.id));
        return visibilityDifference || left.name.localeCompare(right.name);
      });
  }, [allEntities, filterContext, query, showHidden, visibleEntityIds]);
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const pageRows = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  useEffect(() => setPage(1), [query, showHidden, visibleEntityIds]);

  useEffect(() => {
    if (
      !revealRequest ||
      processedRevealSequence.current === revealRequest.sequence
    )
      return;
    const index = rows.findIndex(
      entity => entity.id === revealRequest.entityId,
    );
    if (index < 0) {
      const targetExists = entityById.has(revealRequest.entityId);
      const targetVisible = visibleEntityIds.has(revealRequest.entityId);
      if (targetExists && !targetVisible && !showHidden) {
        setShowHidden(true);
      } else if (query) {
        setQuery('');
      } else {
        processedRevealSequence.current = revealRequest.sequence;
      }
      return;
    }
    const selectedPage = Math.floor(index / PAGE_SIZE) + 1;
    if (page !== selectedPage) {
      setPage(selectedPage);
      return;
    }
    if (!expandedEntityIds.has(revealRequest.entityId)) {
      setExpandedEntityIds(current =>
        new Set(current).add(revealRequest.entityId),
      );
      return;
    }
    const targetRow = rowRefs.current.get(revealRequest.entityId);
    if (!targetRow) return;
    processedRevealSequence.current = revealRequest.sequence;
    targetRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [
    entityById,
    expandedEntityIds,
    page,
    query,
    revealRequest,
    rows,
    showHidden,
    visibleEntityIds,
  ]);

  return (
    <section
      aria-labelledby="inventory-table-heading"
      className={styles.tableSection}
    >
      <div className={styles.sectionHeadingRow}>
        <div>
          <h2 id="inventory-table-heading">Entities</h2>
          <p>{rows.length.toLocaleString()} rows in the current table view.</p>
        </div>
        <div className={styles.tableControls}>
          <label>
            <span>Quick search</span>
            <input
              onChange={event => setQuery(event.target.value)}
              placeholder="Search exposed fields"
              type="search"
              value={query}
            />
          </label>
          <label className={styles.checkboxLabel}>
            <input
              checked={showHidden}
              onChange={event => setShowHidden(event.target.checked)}
              type="checkbox"
            />
            Show entities not visible in graph
          </label>
        </div>
      </div>

      <div className={styles.tableScroller}>
        <table className={styles.table}>
          <caption>Inventory entities and their details</caption>
          <thead>
            <tr>
              <th aria-label="Expand" scope="col" />
              <th scope="col">Name</th>
              <th scope="col">Entity ID</th>
              <th scope="col">Type</th>
              <th scope="col">Initiative tags</th>
              <th scope="col">Owner</th>
              <th scope="col">Source</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map(entity => {
              const expanded = expandedEntityIds.has(entity.id);
              const visible = visibleEntityIds.has(entity.id);
              const related = relatedEntitySummaries(
                entity.id,
                relationships,
                entityById,
              );
              const relatedByType = [
                ...new Set(related.map(item => item.entity.type)),
              ]
                .sort()
                .map(type => ({
                  items: related.filter(item => item.entity.type === type),
                  type,
                }));
              return (
                <React.Fragment key={entity.id}>
                  <tr
                    className={`${!visible ? styles.hiddenRow : ''} ${
                      selectedEntityId === entity.id ? styles.selectedRow : ''
                    }`}
                    ref={row => {
                      if (row) rowRefs.current.set(entity.id, row);
                      else rowRefs.current.delete(entity.id);
                    }}
                  >
                    <td>
                      <button
                        aria-expanded={expanded}
                        aria-label={`${expanded ? 'Collapse' : 'Expand'} ${entity.name}`}
                        className={styles.iconButton}
                        onClick={() => {
                          setExpandedEntityIds(current => {
                            const next = new Set(current);
                            if (expanded) next.delete(entity.id);
                            else next.add(entity.id);
                            return next;
                          });
                          onSelect(entity.id);
                        }}
                        type="button"
                      >
                        {expanded ? '−' : '+'}
                      </button>
                    </td>
                    <th scope="row">
                      {entity.name}
                      {!visible && (
                        <span className={styles.hiddenBadge}>Not in graph</span>
                      )}
                      {visible && !directEntityIds.has(entity.id) && (
                        <span className={styles.relatedBadge}>Related</span>
                      )}
                    </th>
                    <td className={styles.monospace}>{entity.id}</td>
                    <td>{displayType(entity.type)}</td>
                    <td>{entity.initiativeTags.join(', ') || '—'}</td>
                    <td>{entity.owner || '—'}</td>
                    <td>
                      {entity.url ? (
                        <a href={entity.url} rel="noreferrer" target="_blank">
                          Open
                        </a>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                  {expanded && (
                    <tr className={styles.detailRow}>
                      <td colSpan={7}>
                        {entity.type === 'workflow' ? (
                          <WorkflowEntityDetails
                            entity={entity}
                            onRevealInTable={onRevealInTable}
                            related={related}
                            relatedByType={relatedByType}
                            visibleEntityIds={visibleEntityIds}
                          />
                        ) : entity.type === 'component' ? (
                          <ComponentEntityDetails
                            entity={entity}
                            onRevealInTable={onRevealInTable}
                            related={related}
                            relatedByType={relatedByType}
                            visibleEntityIds={visibleEntityIds}
                          />
                        ) : entity.type === 'gcp_project' ? (
                          <GcpProjectEntityDetails
                            entity={entity}
                            onRevealInTable={onRevealInTable}
                            related={related}
                            relatedByType={relatedByType}
                            visibleEntityIds={visibleEntityIds}
                          />
                        ) : (
                          <div className={styles.entityDetails}>
                            <section>
                              <h3>Attributes</h3>
                              <AttributeContent entity={entity} />
                            </section>
                            <section>
                              <h3>Related entities ({related.length})</h3>
                              <RelatedEntitiesContent
                                groups={relatedByType}
                                onRevealInTable={onRevealInTable}
                                visibleEntityIds={visibleEntityIds}
                              />
                            </section>
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className={styles.pagination}>
        <button
          className={styles.secondaryButton}
          disabled={page <= 1}
          onClick={() => setPage(current => current - 1)}
          type="button"
        >
          Previous
        </button>
        <span>
          Page {Math.min(page, totalPages)} of {totalPages}
        </span>
        <button
          className={styles.secondaryButton}
          disabled={page >= totalPages}
          onClick={() => setPage(current => current + 1)}
          type="button"
        >
          Next
        </button>
      </div>
    </section>
  );
}
