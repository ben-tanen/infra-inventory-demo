import Head from 'next/head';
import { useRouter } from 'next/router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';

import {
  INVENTORY_ENTITY_TYPES,
  InventoryDataEnvelope,
  InventoryFilterExpression,
  InventoryViewState,
  KnownInventoryEntityType,
} from './contracts';
import { INVENTORY_FIXTURE } from './fixtures';
import { InventoryFilterBuilder } from './components/InventoryFilterBuilder';
import {
  AUTO_GRAPH_LABEL_LIMIT,
  InventoryNetworkGraph,
} from './components/InventoryNetworkGraph';
import {
  InventoryTable,
  InventoryTableRevealRequest,
} from './components/InventoryTable';
import {
  DEFAULT_INVENTORY_VIEW,
  deriveInventory,
  inventoryQueryMatches,
  inventoryViewQuery,
  parseEntityTypes,
  parseFilterExpression,
  parseHops,
} from './filterExpression';
import styles from './Inventory.module.css';

function oneValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function countBy(values: string[]): string {
  if (values.length === 0) return 'None';
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) || 0) + 1);
  return [...counts.entries()]
    .sort(
      (left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
    )
    .map(
      ([value, count]) =>
        `${count.toLocaleString()} ${value.replaceAll('_', ' ')}`,
    )
    .join('\n');
}

function loadInventoryFixture(): InventoryDataEnvelope {
  return INVENTORY_FIXTURE;
}

export function InventoryPage() {
  const router = useRouter();
  const [envelope, setEnvelope] = useState<InventoryDataEnvelope | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);
  const [tableRevealRequest, setTableRevealRequest] =
    useState<InventoryTableRevealRequest | null>(null);
  const [filterControlsExpanded, setFilterControlsExpanded] = useState(false);
  const [showGraphLabelsOverride, setShowGraphLabelsOverride] = useState<
    boolean | null
  >(null);
  const [urlReady, setUrlReady] = useState(false);
  const [view, setView] = useState<InventoryViewState>(DEFAULT_INVENTORY_VIEW);

  useEffect(() => {
    if (!router.isReady || urlReady) return;
    setView({
      entityTypes: parseEntityTypes(oneValue(router.query.types)),
      expression: parseFilterExpression(oneValue(router.query.filters)),
      hops: parseHops(oneValue(router.query.hops)),
    });
    setSelectedEntityId(oneValue(router.query.selected) || null);
    setUrlReady(true);
  }, [router.isReady, router.query, urlReady]);

  useEffect(() => {
    if (!router.isReady || !urlReady) return;
    const query = inventoryViewQuery(view, selectedEntityId);
    if (inventoryQueryMatches(router.query, query)) return;
    void router.replace({ pathname: '/', query }, undefined, {
      shallow: true,
    });
  }, [router, router.isReady, selectedEntityId, urlReady, view]);

  useEffect(() => {
    setEnvelope(loadInventoryFixture());
    setLoading(false);
  }, []);

  const derived = useMemo(
    () =>
      envelope
        ? deriveInventory(
            envelope.data.entities,
            envelope.data.relationships,
            view,
          )
        : null,
    [envelope, view],
  );
  const onSelect = useCallback(
    (entityId: string | null) => setSelectedEntityId(entityId),
    [],
  );
  const onRevealInTable = useCallback((entityId: string) => {
    setSelectedEntityId(entityId);
    setTableRevealRequest(current => ({
      entityId,
      sequence: (current?.sequence || 0) + 1,
    }));
  }, []);

  function updateExpression(expression: InventoryFilterExpression) {
    setView(current => ({ ...current, expression }));
  }

  function toggleEntityType(type: KnownInventoryEntityType) {
    setView(current => {
      const selected = current.entityTypes.includes(type);
      const entityTypes = selected
        ? current.entityTypes.filter(item => item !== type)
        : [...current.entityTypes, type];
      return entityTypes.length ? { ...current, entityTypes } : current;
    });
  }

  const directEntities = derived?.entities.filter(entity =>
    derived.directEntityIds.has(entity.id),
  );
  const relatedEntities = derived?.entities.filter(entity =>
    derived.relatedEntityIds.has(entity.id),
  );
  const visibleEntityIds = useMemo(
    () => new Set(derived?.entities.map(entity => entity.id) || []),
    [derived],
  );
  const showGraphLabels =
    showGraphLabelsOverride ??
    (derived?.entities.length || 0) <= AUTO_GRAPH_LABEL_LIMIT;
  const appliedFilterCount = view.expression.groups.reduce(
    (count, group) => count + group.filters.length,
    0,
  );
  const appliedGroupCount = view.expression.groups.filter(
    group => group.filters.length > 0,
  ).length;
  const relatedEntitySummary =
    view.hops === 0
      ? 'Showing only matching entities'
      : `Showing matching and related entities (by ${view.hops} ${view.hops === 1 ? 'degree' : 'degrees'})`;
  const filterSummary = [
    `Showing ${view.entityTypes.length} of ${INVENTORY_ENTITY_TYPES.length} entity types`,
    relatedEntitySummary,
    `Applying ${appliedFilterCount} ${appliedFilterCount === 1 ? 'filter' : 'filters'} in ${appliedGroupCount} ${appliedGroupCount === 1 ? 'group' : 'groups'}`,
  ].join('; ');

  return (
    <>
      <Head>
        <title>Infrastructure Inventory Demo</title>
      </Head>
      <main className={styles.page}>
        <header className={styles.header}>
          <div className={styles.headerIntro}>
            <h1>Infrastructure Inventory</h1>
            <p>
              Explore components, repositories, GCP projects, workflows, and the
              catalog relationships between them.
            </p>
          </div>
          {envelope?.dataAsOf && (
            <p className={styles.dataAsOf}>
              <em>Data as of</em>
              <time dateTime={envelope.dataAsOf}>
                {envelope.dataAsOf.slice(0, 10)}
              </time>
            </p>
          )}
        </header>

        {loading && <div className={styles.notice}>Loading inventory…</div>}
        {error && <div className={styles.error}>{error}</div>}

        {envelope && derived && (
          <>
            <section
              aria-labelledby="filter-entities-heading"
              className={styles.displayPanel}
            >
              <div className={styles.filterPanelHeading}>
                <button
                  aria-controls="inventory-filter-controls"
                  aria-expanded={filterControlsExpanded}
                  aria-label={`${filterControlsExpanded ? 'Collapse' : 'Expand'} filter entities`}
                  className={styles.iconButton}
                  onClick={() => setFilterControlsExpanded(current => !current)}
                  type="button"
                >
                  {filterControlsExpanded ? '−' : '+'}
                </button>
                <h2 id="filter-entities-heading">Filter entities</h2>
              </div>
              <p className={styles.filterSummary}>{filterSummary}</p>
              {filterControlsExpanded && (
                <div id="inventory-filter-controls">
                  <div className={styles.displayControls}>
                    <div
                      className={`${styles.inlineControl} ${styles.entityTypeControl}`}
                    >
                      <span>Show entities of type...</span>
                      <div className={styles.checkboxGroup}>
                        {INVENTORY_ENTITY_TYPES.map(type => (
                          <label className={styles.checkboxLabel} key={type}>
                            <input
                              checked={view.entityTypes.includes(type)}
                              onChange={() => toggleEntityType(type)}
                              type="checkbox"
                            />
                            {type.replaceAll('_', ' ')}
                          </label>
                        ))}
                      </div>
                    </div>
                    <label className={styles.inlineControl}>
                      Show related entries within N degrees
                      <select
                        onChange={event =>
                          setView(current => ({
                            ...current,
                            hops: Number(event.target.value) as 0 | 1 | 2,
                          }))
                        }
                        value={view.hops}
                      >
                        <option value={0}>0 · Matching entities only</option>
                        <option value={1}>1 · Directly related</option>
                        <option value={2}>2 · Two degrees</option>
                      </select>
                    </label>
                  </div>
                  <InventoryFilterBuilder
                    entities={envelope.data.entities}
                    onChange={updateExpression}
                    relationships={envelope.data.relationships}
                    value={view.expression}
                  />
                </div>
              )}
              <section
                aria-label="Inventory result summary"
                className={styles.summary}
              >
                <span
                  data-tooltip={countBy(
                    (directEntities || []).map(entity => entity.type),
                  )}
                  tabIndex={0}
                >
                  <strong>
                    {derived.directEntityIds.size.toLocaleString()}
                  </strong>{' '}
                  matching entities
                </span>
                <span
                  data-tooltip={countBy(
                    (relatedEntities || []).map(entity => entity.type),
                  )}
                  tabIndex={0}
                >
                  <strong>
                    {derived.relatedEntityIds.size.toLocaleString()}
                  </strong>{' '}
                  related entities
                </span>
                <span
                  data-tooltip={countBy(
                    derived.relationships.map(
                      relationship => relationship.type,
                    ),
                  )}
                  tabIndex={0}
                >
                  <strong>
                    {derived.relationships.length.toLocaleString()}
                  </strong>{' '}
                  relationships
                </span>
              </section>
            </section>

            <section
              aria-labelledby="network-heading"
              className={styles.networkSection}
            >
              <div className={styles.sectionHeadingRow}>
                <div>
                  <h2 id="network-heading">Network</h2>
                  <p>
                    Drag nodes to reposition; scroll to zoom and drag the canvas
                    to pan.
                  </p>
                </div>
                <div className={styles.graphLegendControls}>
                  <ul aria-label="Entity type legend" className={styles.legend}>
                    {view.entityTypes.map(type => (
                      <li key={type}>
                        <span
                          className={`${styles.legendDot} ${styles[type]}`}
                        />
                        {type.replaceAll('_', ' ')}
                      </li>
                    ))}
                  </ul>
                  <label className={styles.checkboxLabel}>
                    <input
                      checked={showGraphLabels}
                      onChange={event =>
                        setShowGraphLabelsOverride(event.target.checked)
                      }
                      type="checkbox"
                    />
                    Show labels
                  </label>
                </div>
              </div>
              <InventoryNetworkGraph
                directEntityIds={derived.directEntityIds}
                entities={derived.entities}
                onRevealInTable={onRevealInTable}
                onSelect={onSelect}
                relationships={derived.relationships}
                selectedEntityId={selectedEntityId}
                showLabels={showGraphLabels}
              />
            </section>

            <InventoryTable
              allEntities={envelope.data.entities}
              directEntityIds={derived.directEntityIds}
              onRevealInTable={onRevealInTable}
              onSelect={onSelect}
              relationships={envelope.data.relationships}
              revealRequest={tableRevealRequest}
              selectedEntityId={selectedEntityId}
              visibleEntityIds={visibleEntityIds}
            />
          </>
        )}
      </main>
    </>
  );
}
