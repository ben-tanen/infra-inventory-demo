import React from 'react';

import {
  InventoryEntity,
  InventoryFilter,
  InventoryFilterExpression,
  InventoryFilterGroup,
  InventoryRelationship,
} from '../contracts';
import {
  FILTER_OPERATOR_LABELS,
  INVENTORY_FILTER_FIELDS,
  INVENTORY_FILTER_FIELD_MAP,
} from '../filterDefinitions';
import { buildInventoryFilterContext } from '../filterExpression';
import styles from '../Inventory.module.css';

interface InventoryFilterBuilderProps {
  entities: InventoryEntity[];
  onChange: (expression: InventoryFilterExpression) => void;
  relationships?: InventoryRelationship[];
  value: InventoryFilterExpression;
}

function id(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function hasValue(value: boolean | string | string[] | null): boolean {
  if (typeof value === 'boolean') return true;
  return Array.isArray(value) ? value.length > 0 : Boolean(value);
}

function toggleLogic(operator: 'and' | 'or'): 'and' | 'or' {
  return operator === 'and' ? 'or' : 'and';
}

export function InventoryFilterBuilder({
  entities,
  onChange,
  relationships = [],
  value,
}: InventoryFilterBuilderProps) {
  const filterContext = React.useMemo(
    () => buildInventoryFilterContext(relationships),
    [relationships],
  );
  const availableFields = INVENTORY_FILTER_FIELDS.filter(definition =>
    entities.some(entity => {
      const applies =
        definition.appliesTo === 'all' ||
        definition.appliesTo.includes(entity.type);
      return applies && hasValue(definition.read(entity, filterContext));
    }),
  );

  function updateGroup(groupId: string, next: InventoryFilterGroup) {
    onChange({
      ...value,
      groups: value.groups.map(group => (group.id === groupId ? next : group)),
    });
  }

  function updateFilter(
    group: InventoryFilterGroup,
    filterId: string,
    update: Partial<InventoryFilter>,
  ) {
    updateGroup(group.id, {
      ...group,
      filters: group.filters.map(filter =>
        filter.id === filterId ? { ...filter, ...update } : filter,
      ),
    });
  }

  function addFilter(group: InventoryFilterGroup) {
    const field = availableFields[0]?.field || 'entity_id';
    updateGroup(group.id, {
      ...group,
      filters: [
        ...group.filters,
        { field, id: id('filter'), operator: 'is', value: '' },
      ],
    });
  }

  function removeFilter(group: InventoryFilterGroup, filterId: string) {
    const filters = group.filters.filter(filter => filter.id !== filterId);
    if (filters.length === 0) {
      onChange({
        ...value,
        groups: value.groups.filter(item => item.id !== group.id),
      });
      return;
    }
    updateGroup(group.id, { ...group, filters });
  }

  function addGroup() {
    if (value.groups.length >= 5) return;
    onChange({
      ...value,
      groups: [
        ...value.groups,
        {
          filters: [
            {
              field: 'entity_id',
              id: id('filter'),
              operator: 'is',
              value: '',
            },
          ],
          id: id('group'),
          operator: 'and',
        },
      ],
    });
  }

  return (
    <section aria-label="Entity filters" className={styles.filterBuilder}>
      <div className={styles.filterGroups}>
        {value.groups.length === 0 && (
          <p className={styles.emptyFilterState}>
            No filters applied. All enabled entity types match.
          </p>
        )}
        {value.groups.map((group, groupIndex) => (
          <React.Fragment key={group.id}>
            {groupIndex > 0 && (
              <button
                aria-label={`Use ${toggleLogic(value.groupOperator).toUpperCase()} between filter groups`}
                className={`${styles.logicButton} ${styles.groupJoin}`}
                onClick={() =>
                  onChange({
                    ...value,
                    groupOperator: toggleLogic(value.groupOperator),
                  })
                }
                type="button"
              >
                {value.groupOperator.toUpperCase()}
              </button>
            )}
            <fieldset className={styles.filterGroup}>
              <legend>
                <span className={styles.groupLegend}>
                  Group {groupIndex + 1}
                  {value.groups.length > 1 && (
                    <button
                      aria-label={`Remove Group ${groupIndex + 1}`}
                      className={`${styles.iconButton} ${styles.groupRemoveButton}`}
                      onClick={() =>
                        onChange({
                          ...value,
                          groups: value.groups.filter(
                            item => item.id !== group.id,
                          ),
                        })
                      }
                      type="button"
                    >
                      ×
                    </button>
                  )}
                </span>
              </legend>

              {group.filters.map((filter, filterIndex) => {
                const definition = INVENTORY_FILTER_FIELD_MAP.get(filter.field);
                const noValue =
                  filter.operator === 'is_empty' ||
                  filter.operator === 'is_not_empty';
                const options = definition
                  ? [
                      ...new Set(
                        entities.flatMap(entity => {
                          const valueForEntity = definition.read(
                            entity,
                            filterContext,
                          );
                          return Array.isArray(valueForEntity)
                            ? valueForEntity
                            : typeof valueForEntity === 'boolean'
                              ? [String(valueForEntity)]
                              : valueForEntity
                                ? [valueForEntity]
                                : [];
                        }),
                      ),
                    ].sort()
                  : [];
                const dataListId = `inventory-options-${group.id}-${filter.id}`;
                return (
                  <React.Fragment key={filter.id}>
                    {filterIndex > 0 && (
                      <button
                        aria-label={`Use ${toggleLogic(group.operator).toUpperCase()} between filters in Group ${groupIndex + 1}`}
                        className={`${styles.logicButton} ${styles.filterJoin}`}
                        onClick={() =>
                          updateGroup(group.id, {
                            ...group,
                            operator: toggleLogic(group.operator),
                          })
                        }
                        type="button"
                      >
                        {group.operator.toUpperCase()}
                      </button>
                    )}
                    <div
                      className={`${styles.filterRow} ${
                        noValue ? styles.filterRowNoValue : ''
                      }`}
                    >
                      <select
                        aria-label="Filter field"
                        onChange={event => {
                          const field = event.target
                            .value as InventoryFilter['field'];
                          const nextDefinition =
                            INVENTORY_FILTER_FIELD_MAP.get(field);
                          updateFilter(group, filter.id, {
                            field,
                            operator: nextDefinition?.operators[0] || 'is',
                            value: '',
                          });
                        }}
                        value={filter.field}
                      >
                        {availableFields.map(field => (
                          <option key={field.field} value={field.field}>
                            {field.label}
                          </option>
                        ))}
                      </select>
                      <select
                        aria-label="Filter operator"
                        onChange={event =>
                          updateFilter(group, filter.id, {
                            operator: event.target
                              .value as InventoryFilter['operator'],
                          })
                        }
                        value={filter.operator}
                      >
                        {definition?.operators.map(operator => (
                          <option key={operator} value={operator}>
                            {FILTER_OPERATOR_LABELS[operator]}
                          </option>
                        ))}
                      </select>
                      {!noValue && definition?.valueType === 'boolean' && (
                        <select
                          aria-label="Filter value"
                          onChange={event =>
                            updateFilter(group, filter.id, {
                              value: event.target.value,
                            })
                          }
                          value={filter.value}
                        >
                          <option value="">Select...</option>
                          <option value="true">true</option>
                          <option value="false">false</option>
                        </select>
                      )}
                      {!noValue && definition?.valueType === 'date' && (
                        <input
                          aria-label="Filter value"
                          onChange={event =>
                            updateFilter(group, filter.id, {
                              value: event.target.value,
                            })
                          }
                          title="Enter a date in YYYY-MM-DD format"
                          type="date"
                          value={filter.value}
                        />
                      )}
                      {!noValue &&
                        definition?.valueType === 'relationship_type' && (
                          <select
                            aria-label="Filter value"
                            onChange={event =>
                              updateFilter(group, filter.id, {
                                value: event.target.value,
                              })
                            }
                            value={filter.value}
                          >
                            <option value="">Select...</option>
                            {options.map(option => (
                              <option key={option} value={option}>
                                {option}
                              </option>
                            ))}
                          </select>
                        )}
                      {!noValue &&
                        definition?.valueType !== 'boolean' &&
                        definition?.valueType !== 'date' &&
                        definition?.valueType !== 'relationship_type' && (
                          <>
                            <input
                              aria-label="Filter value"
                              list={dataListId}
                              onChange={event =>
                                updateFilter(group, filter.id, {
                                  value: event.target.value,
                                })
                              }
                              placeholder="Value"
                              value={filter.value}
                            />
                            <datalist id={dataListId}>
                              {options.slice(0, 500).map(option => (
                                <option key={option} value={option} />
                              ))}
                            </datalist>
                          </>
                        )}
                      <button
                        aria-label="Remove filter"
                        className={styles.iconButton}
                        onClick={() => removeFilter(group, filter.id)}
                        type="button"
                      >
                        ×
                      </button>
                    </div>
                  </React.Fragment>
                );
              })}
              <button
                className={styles.secondaryButton}
                disabled={group.filters.length >= 10}
                onClick={() => addFilter(group)}
                type="button"
              >
                Add filter
              </button>
            </fieldset>
          </React.Fragment>
        ))}
      </div>
      <button
        className={styles.secondaryButton}
        disabled={value.groups.length >= 5}
        onClick={addGroup}
        type="button"
      >
        Add filter group
      </button>
    </section>
  );
}
