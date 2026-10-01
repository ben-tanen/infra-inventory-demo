import {
  InventoryEntity,
  InventoryFilterContext,
  InventoryFilterField,
  InventoryFilterOperator,
  InventoryEntityType,
} from './contracts';

export interface InventoryFilterFieldDefinition {
  appliesTo: InventoryEntityType[] | 'all';
  field: InventoryFilterField;
  label: string;
  operators: InventoryFilterOperator[];
  read: (
    entity: InventoryEntity,
    context: InventoryFilterContext,
  ) => boolean | string | string[] | null;
  valueType:
    'boolean' | 'date' | 'relationship_type' | 'string' | 'string_array';
}

const STRING_OPERATORS: InventoryFilterOperator[] = [
  'is',
  'is_not',
  'contains',
  'does_not_contain',
  'is_empty',
  'is_not_empty',
];

const ARRAY_OPERATORS: InventoryFilterOperator[] = [
  'contains',
  'does_not_contain',
  'is_empty',
  'is_not_empty',
];

const BOOLEAN_OPERATORS: InventoryFilterOperator[] = [
  'is',
  'is_not',
  'is_empty',
  'is_not_empty',
];

const DATE_OPERATORS: InventoryFilterOperator[] = [
  'on_or_before',
  'on_or_after',
  'is_empty',
  'is_not_empty',
];

const RELATIONSHIP_OPERATORS: InventoryFilterOperator[] = [
  'includes',
  'does_not_include',
];

export const INVENTORY_FILTER_FIELDS: InventoryFilterFieldDefinition[] = [
  {
    appliesTo: 'all',
    field: 'entity_id',
    label: 'Entity ID',
    operators: STRING_OPERATORS,
    read: entity => entity.id,
    valueType: 'string',
  },
  {
    appliesTo: 'all',
    field: 'name',
    label: 'Name',
    operators: STRING_OPERATORS,
    read: entity => entity.name,
    valueType: 'string',
  },
  {
    appliesTo: 'all',
    field: 'owner',
    label: 'Owner',
    operators: STRING_OPERATORS,
    read: entity => entity.owner,
    valueType: 'string',
  },
  {
    appliesTo: 'all',
    field: 'initiative_tags',
    label: 'Initiative tags',
    operators: ARRAY_OPERATORS,
    read: entity => entity.initiativeTags,
    valueType: 'string_array',
  },
  {
    appliesTo: 'all',
    field: 'relationships',
    label: 'Relationships',
    operators: RELATIONSHIP_OPERATORS,
    read: (entity, context) => [
      ...(context.relationshipTypesByEntityId.get(entity.id) || []),
    ],
    valueType: 'relationship_type',
  },
  {
    appliesTo: ['component'],
    field: 'component_type',
    label: 'Component type',
    operators: STRING_OPERATORS,
    read: entity => entity.attributes.component?.componentType ?? null,
    valueType: 'string',
  },
  {
    appliesTo: ['component'],
    field: 'component_lifecycle',
    label: 'Component lifecycle',
    operators: STRING_OPERATORS,
    read: entity => entity.attributes.component?.lifecycle ?? null,
    valueType: 'string',
  },
  {
    appliesTo: ['gcp_project'],
    field: 'gcp_project_id',
    label: 'GCP project ID',
    operators: STRING_OPERATORS,
    read: entity => entity.attributes.gcpProject?.projectId ?? null,
    valueType: 'string',
  },
  {
    appliesTo: ['workflow'],
    field: 'workflow_enabled',
    label: 'Workflow enabled',
    operators: BOOLEAN_OPERATORS,
    read: entity => entity.attributes.workflow?.enabled ?? null,
    valueType: 'boolean',
  },
  {
    appliesTo: ['workflow'],
    field: 'workflow_type',
    label: 'Workflow type',
    operators: STRING_OPERATORS,
    read: entity => entity.attributes.workflow?.workflowType ?? null,
    valueType: 'string',
  },
  {
    appliesTo: ['workflow'],
    field: 'workflow_orchestration_type',
    label: 'Workflow orchestration type',
    operators: STRING_OPERATORS,
    read: entity => entity.attributes.workflow?.orchestrationType ?? null,
    valueType: 'string',
  },
  {
    appliesTo: ['workflow'],
    field: 'workflow_parent_component',
    label: 'Workflow parent component',
    operators: STRING_OPERATORS,
    read: entity => entity.attributes.workflow?.parentComponentId ?? null,
    valueType: 'string',
  },
  {
    appliesTo: ['workflow'],
    field: 'workflow_bq_job_projects',
    label: 'Workflow BQ job projects',
    operators: ARRAY_OPERATORS,
    read: entity => entity.attributes.workflow?.bqJobProjects ?? [],
    valueType: 'string_array',
  },
  {
    appliesTo: ['workflow'],
    field: 'workflow_bq_destination_table_projects',
    label: 'Workflow BQ destination table projects',
    operators: ARRAY_OPERATORS,
    read: entity =>
      entity.attributes.workflow?.bqDestinationTableProjects ?? [],
    valueType: 'string_array',
  },
  {
    appliesTo: ['workflow'],
    field: 'workflow_schedule',
    label: 'Workflow schedule',
    operators: STRING_OPERATORS,
    read: entity => entity.attributes.workflow?.schedule ?? null,
    valueType: 'string',
  },
  {
    appliesTo: ['workflow'],
    field: 'workflow_offset',
    label: 'Workflow offset',
    operators: STRING_OPERATORS,
    read: entity => entity.attributes.workflow?.offset ?? null,
    valueType: 'string',
  },
  {
    appliesTo: ['repository'],
    field: 'repository_archived',
    label: 'Repository archived',
    operators: BOOLEAN_OPERATORS,
    read: entity => entity.attributes.repository?.archived ?? null,
    valueType: 'boolean',
  },
  {
    appliesTo: ['repository'],
    field: 'repository_created',
    label: 'Repository created',
    operators: DATE_OPERATORS,
    read: entity => entity.attributes.repository?.createdAt ?? null,
    valueType: 'date',
  },
  {
    appliesTo: ['repository'],
    field: 'repository_host',
    label: 'Repository host',
    operators: STRING_OPERATORS,
    read: entity => entity.attributes.repository?.host ?? null,
    valueType: 'string',
  },
  {
    appliesTo: ['repository'],
    field: 'repository_last_updated',
    label: 'Repository last updated',
    operators: DATE_OPERATORS,
    read: entity => entity.attributes.repository?.pushedAt ?? null,
    valueType: 'date',
  },
  {
    appliesTo: ['repository'],
    field: 'repository_organization',
    label: 'Repository organization',
    operators: STRING_OPERATORS,
    read: entity => entity.attributes.repository?.organization ?? null,
    valueType: 'string',
  },
  {
    appliesTo: ['repository'],
    field: 'repository_name',
    label: 'Repository name',
    operators: STRING_OPERATORS,
    read: entity => entity.attributes.repository?.repositoryName ?? null,
    valueType: 'string',
  },
];

export const INVENTORY_FILTER_FIELD_MAP = new Map(
  INVENTORY_FILTER_FIELDS.map(definition => [definition.field, definition]),
);

export const FILTER_OPERATOR_LABELS: Record<InventoryFilterOperator, string> = {
  contains: 'contains',
  does_not_contain: 'does not contain',
  does_not_include: "doesn't include",
  includes: 'includes',
  is: 'is',
  is_empty: 'is empty',
  is_not: 'is not',
  is_not_empty: 'is not empty',
  on_or_after: 'on or after',
  on_or_before: 'on or before',
};
