#!/usr/bin/env python3
"""
Generate src/features/inventory/fixtures.ts from the CSV entity/relationship data.

Reads entities.csv and relationships.csv, and produces a TypeScript file with:
  - INVENTORY_FIXTURE (main snapshot with all entities + relationships)
  - INVENTORY_WORKFLOW_HEALTH_FIXTURE (generic, reused for any workflow)
  - INVENTORY_COMPONENT_WORKFLOW_METRICS_FIXTURE (generic, reused for any component)
  - INVENTORY_GCP_PROJECT_JOBS_FIXTURE (generic, reused for any project)
  - INVENTORY_WORKFLOW_RESOURCES_FIXTURE (generic, reused for any workflow)

Usage (from repo root):
    uv run --with pyyaml -- python local_data/scripts/generate_fixtures_ts.py
"""

import csv
import json
import os
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
LOCAL_DATA_DIR = os.path.join(SCRIPT_DIR, "..")
REPO_ROOT = os.path.join(LOCAL_DATA_DIR, "..")
ENTITIES_CSV = os.path.join(LOCAL_DATA_DIR, "entities.csv")
RELATIONSHIPS_CSV = os.path.join(LOCAL_DATA_DIR, "relationships.csv")
OUTPUT_PATH = os.path.join(
    REPO_ROOT, "src", "features", "inventory", "fixtures.ts"
)


def read_csv(path):
    with open(path, newline="") as f:
        return list(csv.DictReader(f))


def ts_string(value):
    """Escape a string for TypeScript."""
    return json.dumps(value)


def format_entity(row):
    """Convert a CSV entity row to a TypeScript InventoryEntity object literal."""
    entity_type = row["entity_type"]
    owners = json.loads(row["owners"])
    initiative_tags = json.loads(row["initiative_tags"])
    attributes_raw = json.loads(row["attributes"])
    owner = owners[0] if owners else None

    # Map BQ attribute keys/shapes to TypeScript interface shapes
    attributes = {}
    if "component" in attributes_raw:
        attributes["component"] = attributes_raw["component"]
    if "gcp-project" in attributes_raw:
        gcp = attributes_raw["gcp-project"]
        attributes["gcpProject"] = {
            "projectId": gcp.get("project_id") or gcp.get("projectId"),
        }
    if "repository" in attributes_raw:
        repo = attributes_raw["repository"]
        attributes["repository"] = {
            "archived": repo.get("archived", False),
            "createdAt": repo.get("createdAt"),
            "description": repo.get("description"),
            "forked": repo.get("forked", False),
            "fullName": repo.get("fullName"),
            "host": repo.get("host"),
            "lastBotCommit": repo.get("lastBotCommit", {"committedAt": None, "sha": None}),
            "lastHumanCommit": repo.get("lastHumanCommit", {
                "committedAt": repo.get("pushedAt"),
                "sha": repo.get("defaultBranchLastCommit", {}).get("sha"),
            }),
            "organization": repo.get("organization"),
            "pushedAt": repo.get("pushedAt"),
            "repositoryName": repo.get("repositoryName"),
        }
    if "workflow" in attributes_raw:
        attributes["workflow"] = attributes_raw["workflow"]
    elif "styx-workflow" in attributes_raw:
        attributes["workflow"] = attributes_raw["styx-workflow"]

    return {
        "attributes": attributes,
        "id": row["entity_id"],
        "initiativeTags": initiative_tags,
        "name": row["name"],
        "owner": owner,
        "type": entity_type,
        "url": row["url"],
    }


def format_relationship(row):
    """Convert a CSV relationship row to a TypeScript InventoryRelationship."""
    return {
        "sourceEntityId": row["source_entity_id"],
        "statuses": [row["status"]],
        "targetEntityId": row["target_entity_id"],
        "type": row["relationship_type"],
    }


def indent(text, level=2):
    """Indent each line of a JSON dump for TypeScript."""
    prefix = "  " * level
    return "\n".join(prefix + line for line in text.split("\n"))


def main():
    entity_rows = read_csv(ENTITIES_CSV)
    relationship_rows = read_csv(RELATIONSHIPS_CSV)

    entities = [format_entity(r) for r in entity_rows]
    relationships = [format_relationship(r) for r in relationship_rows]

    # Deduplicate relationships (CSV has one row per status, but the fixture
    # groups statuses into an array per edge — our CSV already has single status
    # rows, but just in case)
    seen_rels = set()
    unique_rels = []
    for rel in relationships:
        key = (rel["sourceEntityId"], rel["targetEntityId"], rel["type"])
        if key not in seen_rels:
            seen_rels.add(key)
            unique_rels.append(rel)
    relationships = unique_rels

    print(f"Entities: {len(entities)}", file=sys.stderr)
    print(f"Relationships: {len(relationships)}", file=sys.stderr)

    # Build the TypeScript source
    entities_json = json.dumps(entities, indent=2)
    relationships_json = json.dumps(relationships, indent=2)

    ts_source = f"""\
import type {{
  ComponentWorkflowMetricsEnvelope,
  GcpProjectJobsEnvelope,
  InventoryDataEnvelope,
  WorkflowHealthEnvelope,
  WorkflowResourcesEnvelope,
}} from './contracts';

// Generated from local_data/entities.csv and local_data/relationships.csv
// by local_data/scripts/generate_fixtures_ts.py

export const INVENTORY_FIXTURE: InventoryDataEnvelope = {{
  appliedFilters: {{}},
  data: {{
    entities: {entities_json},
    relationships: {relationships_json},
    snapshotAt: '2026-10-01T08:00:00.000Z',
    snapshotId: 'demo-fixture-v1',
  }},
  dataAsOf: '2026-10-01T08:00:00.000Z',
  freshness: 'fresh',
  generatedAt: '2026-10-01T08:00:00.000Z',
  partial: false,
  source: ['fixture:inventory'],
  warnings: [],
}};

export const INVENTORY_WORKFLOW_HEALTH_FIXTURE: WorkflowHealthEnvelope = {{
  appliedFilters: {{
    componentId: 'demo',
    workflowId: 'demo',
  }},
  data: {{
    componentId: 'demo',
    latest: {{
      attempts: 1,
      completionOffsetMs: 3_600_000,
      dependencyWaitMs: 0,
      dependencyWaitPending: false,
      finishedAt: '2026-09-25T01:10:00.000Z',
      missingDependencyAttempts: 0,
      parameter: '2026-09-25',
      runtimeMs: 600_000,
      status: 'success',
      statusCounts: {{ SUCCESS: 1 }},
      triggeredAt: '2026-09-25T01:00:00.000Z',
    }},
    partitions: (
      [
        ['2026-09-19', 3_600_000, 600_000],
        ['2026-09-20', 3_600_000, 600_000],
        ['2026-09-21', 3_600_000, 600_000],
        ['2026-09-22', 3_600_000, 600_000],
        ['2026-09-23', 3_600_000, 600_000],
        ['2026-09-24', 3_600_000, 600_000],
        ['2026-09-25', 3_600_000, 600_000],
      ] as const
    ).map(([parameter, completionOffsetMs, runtimeMs]) => ({{
      attempts: 1,
      completionOffsetMs,
      dependencyWaitMs: 0,
      dependencyWaitPending: false,
      finishedAt: null,
      missingDependencyAttempts: 0,
      parameter,
      runtimeMs,
      status: 'success' as const,
      statusCounts: {{ SUCCESS: 1 }},
      triggeredAt: null,
    }})),
    summary: {{
      medianCompletionOffsetMs: 3_600_000,
      medianRuntimeMs: 600_000,
      successfulPartitions: 7,
      successRate: 1,
      terminalPartitions: 7,
    }},
    workflowId: 'demo',
  }},
  dataAsOf: '2026-10-01T08:00:00.000Z',
  freshness: 'fresh',
  generatedAt: '2026-10-01T08:00:00.000Z',
  partial: false,
  source: ['fixture:workflow-health'],
  warnings: [],
}};

export const INVENTORY_COMPONENT_WORKFLOW_METRICS_FIXTURE: ComponentWorkflowMetricsEnvelope =
  {{
    appliedFilters: {{ componentIds: ['demo'] }},
    data: {{
      workflows: [
        {{
          averageExecutions: 1,
          averageJobs: 1,
          componentId: 'demo',
          latestParameter: '2026-09-25',
          latestStatus: 'success',
          medianCompletionOffsetMs: 3_600_000,
          medianRuntimeMs: 600_000,
          recentPartitionCount: 7,
          resourcePartitionCount: 7,
          successRate: 1,
          totalBytesProcessed: 7 * 1_048_576,
          totalSlotHours: 0.002,
          workflowId: 'demo',
        }},
      ],
    }},
    dataAsOf: '2026-10-01T00:00:00.000Z',
    freshness: 'fresh',
    generatedAt: '2026-10-01T08:00:00.000Z',
    partial: false,
    source: ['fixture:workflow-metrics'],
    warnings: [],
  }};

export const INVENTORY_GCP_PROJECT_JOBS_FIXTURE: GcpProjectJobsEnvelope = {{
  appliedFilters: {{ projectId: 'demo' }},
  data: {{
    projectId: 'demo',
    rows: [
      {{
        attributionCategory: 'network_workflow',
        componentId: 'demo',
        executions: 7,
        failedJobs: 0,
        heaviestJob: null,
        jobs: 7,
        missingSlotJobs: 0,
        slotHoursPerExecution: 0.000278,
        source: 'workflow:demo/demo',
        totalBytesProcessed: 7 * 1_048_576,
        totalSlotHours: 0.002,
      }},
    ],
    windowEndDate: '2026-10-01',
    windowStartDate: '2026-09-25',
  }},
  dataAsOf: '2026-10-01T00:00:00.000Z',
  freshness: 'fresh',
  generatedAt: '2026-10-01T08:00:00.000Z',
  partial: false,
  source: ['fixture:gcp-project-jobs'],
  warnings: [],
}};

const WORKFLOW_RESOURCE_PARTITIONS = [
  ['2026-09-19', 1, 1, 0.000278, 0.001],
  ['2026-09-20', 1, 1, 0.000278, 0.001],
  ['2026-09-21', 1, 1, 0.000278, 0.001],
  ['2026-09-22', 1, 1, 0.000278, 0.001],
  ['2026-09-23', 1, 1, 0.000278, 0.001],
  ['2026-09-24', 1, 1, 0.000278, 0.001],
  ['2026-09-25', 1, 1, 0.000278, 0.001],
] as const;

export const INVENTORY_WORKFLOW_RESOURCES_FIXTURE: WorkflowResourcesEnvelope = {{
  appliedFilters: {{
    componentId: 'demo',
    workflowId: 'demo',
  }},
  data: {{
    componentId: 'demo',
    partitions: WORKFLOW_RESOURCE_PARTITIONS.map(
      ([parameter, executions, jobs, slotHours, tebibytes]) => ({{
        bytesProcessed: tebibytes * 2 ** 40,
        cancelledJobs: 0,
        executions,
        executionsWithJobs: executions,
        failedJobs: 0,
        incompleteExecutionWindows: 0,
        jobs,
        jobsMissingSlotMs: 0,
        parameter,
        slotHours,
        slotMs: slotHours * 3.6e6,
        destinations: [
          {{
            bytesProcessed: tebibytes * 2 ** 40,
            destinationDatasetId: 'output',
            destinationKind: 'table' as const,
            destinationLabel: 'demo.output.demo',
            destinationProjectId: 'demo',
            destinationTableId: 'demo',
            executions,
            heaviestJob: null,
            jobs,
            latestJob: null,
            slotHours,
            slotMs: slotHours * 3.6e6,
            statementTypes: ['INSERT'],
          }},
        ],
      }}),
    ),
    summary: {{
      averageBytesProcessed: 0.001 * 2 ** 40,
      averageExecutions: 1,
      averageJobs: 1,
      averageSlotHours: 0.000278,
      bytesPartitionCount: 7,
      eligiblePartitionCount: 7,
      incompleteExecutionWindows: 0,
      jobsMissingSlotMs: 0,
      slotPartitionCount: 7,
      unknownBytesPartitions: 0,
    }},
    destinations: [
      {{
        bytesProcessed: 0.007 * 2 ** 40,
        destinationDatasetId: 'output',
        destinationKind: 'table',
        destinationLabel: 'demo.output.demo',
        destinationProjectId: 'demo',
        destinationTableId: 'demo',
        executions: 7,
        heaviestJob: null,
        jobs: 7,
        latestJob: null,
        partitionCount: 7,
        partitions: WORKFLOW_RESOURCE_PARTITIONS.map(
          ([parameter]) => parameter,
        ),
        shareOfWorkflowSlot: 1,
        slotHours: 0.002,
        slotMs: 0.002 * 3.6e6,
        statementTypes: ['INSERT'],
      }},
    ],
    workflowId: 'demo',
  }},
  dataAsOf: '2026-10-01T00:00:00.000Z',
  freshness: 'fresh',
  generatedAt: '2026-10-01T08:00:00.000Z',
  partial: false,
  source: ['fixture:workflow-resources'],
  warnings: [],
}};
"""

    with open(OUTPUT_PATH, "w") as f:
        f.write(ts_source)

    print(f"Output: {OUTPUT_PATH}", file=sys.stderr)


if __name__ == "__main__":
    main()
