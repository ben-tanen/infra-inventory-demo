import {
  DerivedInventory,
  INVENTORY_ENTITY_TYPES,
  InventoryEntity,
  InventoryFilter,
  InventoryFilterContext,
  InventoryFilterExpression,
  InventoryFilterOperator,
  InventoryRelationship,
  InventoryViewState,
  KnownInventoryEntityType,
} from './contracts';
import { INVENTORY_FILTER_FIELD_MAP } from './filterDefinitions';

const EMPTY_FILTER_CONTEXT: InventoryFilterContext = {
  relationshipTypesByEntityId: new Map(),
};

export const DEFAULT_FILTER_EXPRESSION: InventoryFilterExpression = {
  groupOperator: 'and',
  groups: [
    {
      filters: [
        {
          field: 'owner',
          id: 'default-owner-netflix',
          operator: 'is',
          value: 'group:default/netflix-infra',
        },
      ],
      id: 'default-group',
      operator: 'and',
    },
  ],
  version: 1,
};

export const DEFAULT_INVENTORY_VIEW: InventoryViewState = {
  entityTypes: ['component', 'gcp_project', 'repository'],
  expression: DEFAULT_FILTER_EXPRESSION,
  hops: 1,
};

function isEmpty(value: boolean | string | string[] | null): boolean {
  return value == null || (typeof value !== 'boolean' && value.length === 0);
}

function scalarMatches(
  actual: string | null,
  operator: InventoryFilterOperator,
  expected: string,
): boolean {
  if (operator === 'is_empty') return isEmpty(actual);
  if (operator === 'is_not_empty') return !isEmpty(actual);
  if (actual == null || actual === '') return false;

  if (operator === 'is') return actual === expected;
  if (operator === 'is_not') return actual !== expected;
  const contains = actual
    .toLocaleLowerCase()
    .includes(expected.toLocaleLowerCase());
  if (operator === 'contains') return contains;
  if (operator === 'does_not_contain') return !contains;
  return false;
}

function arrayMatches(
  actual: string[],
  operator: InventoryFilterOperator,
  expected: string,
): boolean {
  if (operator === 'is_empty') return actual.length === 0;
  if (operator === 'is_not_empty') return actual.length > 0;
  const contains = actual.includes(expected);
  if (operator === 'contains') return contains;
  if (operator === 'does_not_contain') return !contains;
  if (operator === 'includes') return contains;
  if (operator === 'does_not_include') return !contains;
  return false;
}

function booleanMatches(
  actual: boolean,
  operator: InventoryFilterOperator,
  expected: string,
): boolean {
  if (expected !== 'true' && expected !== 'false') return false;
  const expectedBoolean = expected === 'true';
  if (operator === 'is') return actual === expectedBoolean;
  if (operator === 'is_not') return actual !== expectedBoolean;
  return false;
}

function isValidDateOnly(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return (
    Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}

function dateMatches(
  actual: string | null,
  operator: InventoryFilterOperator,
  expected: string,
): boolean {
  if (!actual || !isValidDateOnly(expected)) return false;
  const actualTimestamp = new Date(actual);
  if (!Number.isFinite(actualTimestamp.getTime())) return false;
  const actualDate = actualTimestamp.toISOString().slice(0, 10);
  if (operator === 'on_or_before') return actualDate <= expected;
  if (operator === 'on_or_after') return actualDate >= expected;
  return false;
}

export function entityMatchesFilter(
  entity: InventoryEntity,
  filter: InventoryFilter,
  context: InventoryFilterContext,
): boolean {
  const definition = INVENTORY_FILTER_FIELD_MAP.get(filter.field);
  if (!definition || !definition.operators.includes(filter.operator))
    return false;

  const applies =
    definition.appliesTo === 'all' ||
    definition.appliesTo.includes(entity.type);
  const value = applies ? definition.read(entity, context) : null;
  if (filter.operator === 'is_empty') return isEmpty(value);
  if (filter.operator === 'is_not_empty') return applies && !isEmpty(value);
  if (!applies) return false;
  if (definition.valueType === 'date') {
    return dateMatches(
      typeof value === 'string' ? value : null,
      filter.operator,
      filter.value,
    );
  }
  return Array.isArray(value)
    ? arrayMatches(value, filter.operator, filter.value)
    : typeof value === 'boolean'
      ? booleanMatches(value, filter.operator, filter.value)
      : scalarMatches(value, filter.operator, filter.value);
}

export function entityMatchesExpression(
  entity: InventoryEntity,
  expression: InventoryFilterExpression,
  context: InventoryFilterContext = EMPTY_FILTER_CONTEXT,
): boolean {
  if (expression.groups.length === 0) return true;
  const groupResults = expression.groups.map(group => {
    if (group.filters.length === 0) return true;
    const results = group.filters.map(filter =>
      entityMatchesFilter(entity, filter, context),
    );
    return group.operator === 'and'
      ? results.every(Boolean)
      : results.some(Boolean);
  });
  return expression.groupOperator === 'and'
    ? groupResults.every(Boolean)
    : groupResults.some(Boolean);
}

export function buildInventoryFilterContext(
  relationships: InventoryRelationship[],
): InventoryFilterContext {
  const relationshipTypesByEntityId = new Map<string, Set<string>>();
  for (const relationship of relationships) {
    for (const entityId of [
      relationship.sourceEntityId,
      relationship.targetEntityId,
    ]) {
      const types = relationshipTypesByEntityId.get(entityId) || new Set();
      types.add(relationship.type);
      relationshipTypesByEntityId.set(entityId, types);
    }
  }
  return { relationshipTypesByEntityId };
}

export function deriveInventory(
  entities: InventoryEntity[],
  relationships: InventoryRelationship[],
  view: InventoryViewState,
): DerivedInventory {
  const allowedTypes = new Set(view.entityTypes);
  const entityById = new Map(entities.map(entity => [entity.id, entity]));
  const filterContext = buildInventoryFilterContext(relationships);
  const directEntityIds = new Set(
    entities
      .filter(
        entity =>
          allowedTypes.has(entity.type as KnownInventoryEntityType) &&
          entityMatchesExpression(entity, view.expression, filterContext),
      )
      .map(entity => entity.id),
  );
  const visibleEntityIds = new Set(directEntityIds);

  let frontier = new Set(directEntityIds);
  for (let depth = 0; depth < view.hops; depth += 1) {
    const next = new Set<string>();
    for (const relationship of relationships) {
      let candidate: string | null = null;
      if (frontier.has(relationship.sourceEntityId))
        candidate = relationship.targetEntityId;
      if (frontier.has(relationship.targetEntityId))
        candidate = relationship.sourceEntityId;
      if (!candidate || visibleEntityIds.has(candidate)) continue;
      const entity = entityById.get(candidate);
      if (!entity || !allowedTypes.has(entity.type as KnownInventoryEntityType))
        continue;
      visibleEntityIds.add(candidate);
      next.add(candidate);
    }
    frontier = next;
    if (frontier.size === 0) break;
  }

  const relatedEntityIds = new Set(
    [...visibleEntityIds].filter(entityId => !directEntityIds.has(entityId)),
  );
  return {
    directEntityIds,
    entities: entities.filter(entity => visibleEntityIds.has(entity.id)),
    relatedEntityIds,
    relationships: relationships.filter(
      relationship =>
        visibleEntityIds.has(relationship.sourceEntityId) &&
        visibleEntityIds.has(relationship.targetEntityId),
    ),
  };
}

function validFilterExpression(
  value: unknown,
): value is InventoryFilterExpression {
  if (!value || typeof value !== 'object') return false;
  const expression = value as Partial<InventoryFilterExpression>;
  if (
    expression.version !== 1 ||
    !['and', 'or'].includes(expression.groupOperator || '') ||
    !Array.isArray(expression.groups) ||
    expression.groups.length > 5
  ) {
    return false;
  }
  return expression.groups.every(group => {
    if (
      !group ||
      typeof group.id !== 'string' ||
      !['and', 'or'].includes(group.operator) ||
      !Array.isArray(group.filters) ||
      group.filters.length > 10
    ) {
      return false;
    }
    return group.filters.every(filter => {
      const definition = INVENTORY_FILTER_FIELD_MAP.get(filter.field);
      const valueIsValid =
        definition?.valueType !== 'date' ||
        filter.operator === 'is_empty' ||
        filter.operator === 'is_not_empty' ||
        isValidDateOnly(filter.value);
      return Boolean(
        filter &&
        typeof filter.id === 'string' &&
        definition &&
        definition.operators.includes(filter.operator) &&
        typeof filter.value === 'string' &&
        filter.value.length <= 500 &&
        valueIsValid,
      );
    });
  });
}

export function serializeFilterExpression(
  expression: InventoryFilterExpression,
): string {
  return JSON.stringify(expression);
}

export function parseFilterExpression(
  value: string | undefined,
): InventoryFilterExpression {
  if (!value) return DEFAULT_FILTER_EXPRESSION;
  try {
    const parsed: unknown = JSON.parse(value);
    return validFilterExpression(parsed) ? parsed : DEFAULT_FILTER_EXPRESSION;
  } catch {
    return DEFAULT_FILTER_EXPRESSION;
  }
}

export function parseEntityTypes(
  value: string | undefined,
): KnownInventoryEntityType[] {
  if (!value) return DEFAULT_INVENTORY_VIEW.entityTypes;
  const types = [...new Set(value.split(','))].filter(
    (type): type is KnownInventoryEntityType =>
      INVENTORY_ENTITY_TYPES.includes(type as KnownInventoryEntityType),
  );
  return types.length ? types : DEFAULT_INVENTORY_VIEW.entityTypes;
}

export function parseHops(value: string | undefined): 0 | 1 | 2 {
  return value === '0' || value === '1' || value === '2'
    ? (Number(value) as 0 | 1 | 2)
    : DEFAULT_INVENTORY_VIEW.hops;
}

export function inventoryViewQuery(
  view: InventoryViewState,
  selectedEntityId: string | null,
): Record<string, string> {
  return {
    filters: serializeFilterExpression(view.expression),
    hops: String(view.hops),
    ...(selectedEntityId ? { selected: selectedEntityId } : {}),
    types: view.entityTypes.join(','),
  };
}

export function inventoryQueryMatches(
  current: Record<string, string | string[] | undefined>,
  desired: Record<string, string>,
): boolean {
  const currentValue = (key: string) => {
    const value = current[key];
    return Array.isArray(value) ? value[0] : value;
  };
  return (
    currentValue('filters') === desired.filters &&
    currentValue('hops') === desired.hops &&
    currentValue('types') === desired.types &&
    (currentValue('selected') || '') === (desired.selected || '')
  );
}
