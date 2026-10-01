import type {
  WorkflowHealthEnvelope,
  WorkflowHealthFilters,
} from './contracts';
import { INVENTORY_WORKFLOW_HEALTH_FIXTURE } from './fixtures';
import { summarizeWorkflowPartitions } from './workflowHealthSummary';

export function validWorkflowHealthFilters(
  filters: WorkflowHealthFilters,
): boolean {
  return /^[A-Za-z0-9._:-]{1,300}$/.test(filters.componentId) &&
    /^[A-Za-z0-9._:-]{1,300}$/.test(filters.workflowId);
}

export function fixtureEnvelope(
  filters: WorkflowHealthFilters,
): WorkflowHealthEnvelope {
  return {
    ...INVENTORY_WORKFLOW_HEALTH_FIXTURE,
    appliedFilters: filters,
    data: {
      ...INVENTORY_WORKFLOW_HEALTH_FIXTURE.data,
      componentId: filters.componentId,
      workflowId: filters.workflowId,
    },
  };
}
