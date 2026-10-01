import type {
  WorkflowHealthEnvelope,
  WorkflowHealthFilters,
} from './contracts';
import { buildWorkflowHealth } from './fixtureBuilders';

export function validWorkflowHealthFilters(
  filters: WorkflowHealthFilters,
): boolean {
  return /^[A-Za-z0-9._:-]{1,300}$/.test(filters.componentId) &&
    /^[A-Za-z0-9._:-]{1,300}$/.test(filters.workflowId);
}

export function fixtureEnvelope(
  filters: WorkflowHealthFilters,
): WorkflowHealthEnvelope {
  return buildWorkflowHealth(filters.componentId, filters.workflowId);
}
