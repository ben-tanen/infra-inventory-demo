#!/usr/bin/env python3
"""
Generate CSV files matching the BQ reporting tables used by the inventory view.

Reads entities.yaml and produces three CSVs:
  - entities.csv        (rpt_di_insights_hub_inventory_entities)
  - relationships.csv   (rpt_di_insights_hub_inventory_relationships)
  - workflow_metrics.csv (rpt_di_insights_hub_inventory_workflow_metrics_7p)

Usage (from repo root):
    uv run --with pyyaml -- python local_data/scripts/generate_csvs.py
"""

import csv
import json
import os
import sys
from datetime import datetime, timedelta, timezone

import yaml

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
LOCAL_DATA_DIR = os.path.join(SCRIPT_DIR, "..")
ENTITIES_YAML = os.path.join(LOCAL_DATA_DIR, "entities.yaml")
OUTPUT_DIR = LOCAL_DATA_DIR

# ---------------------------------------------------------------------------
# Snapshot constants — a single fake snapshot date/time for all rows
# ---------------------------------------------------------------------------

SNAPSHOT_DATE = "2026-10-01"
GENERATED_AT = "2026-10-01T08:00:00Z"

# ---------------------------------------------------------------------------
# Table schemas (sourced from BigQuery, hard-coded here for portability)
#
# Only the columns the app actually reads are included. The full upstream
# schemas have additional columns that the queries don't select.
# ---------------------------------------------------------------------------

# -- Source: bsi-data-infra-dev.di_insights_hub_reporting.rpt_di_insights_hub_inventory_entities
# Columns: entity_id STRING, entity_type STRING, name STRING, url STRING,
#          owners REPEATED STRING, initiative_tags REPEATED STRING,
#          in_scope BOOLEAN, attributes JSON, date DATE, generated_at TIMESTAMP
ENTITIES_COLUMNS = [
    "entity_id", "entity_type", "name", "url",
    "owners", "initiative_tags", "in_scope", "attributes",
    "date", "generated_at",
]

# -- Source: bsi-data-infra-dev.di_insights_hub_reporting.rpt_di_insights_hub_inventory_relationships
# Columns: source_entity_id STRING, target_entity_id STRING,
#          relationship_type STRING, status STRING, target_resolved BOOLEAN,
#          date DATE, generated_at TIMESTAMP
RELATIONSHIPS_COLUMNS = [
    "source_entity_id", "target_entity_id", "relationship_type",
    "status", "target_resolved", "date", "generated_at",
]

# -- Source: bsi-data-infra-dev.di_insights_hub_reporting.rpt_di_insights_hub_inventory_workflow_metrics_7p
# Columns: component_id STRING, workflow_id STRING, workflow_entity_id STRING,
#          submission_parameter STRING, partition_timestamp TIMESTAMP,
#          partition_rank INTEGER, is_success_baseline BOOLEAN,
#          is_in_latest_7 BOOLEAN, is_latest_partition BOOLEAN,
#          has_status_events BOOLEAN, health_status STRING,
#          triggered_at TIMESTAMP, finished_at TIMESTAMP,
#          completion_offset_ms INTEGER, runtime_ms INTEGER,
#          attempts INTEGER, status_counts JSON,
#          missing_dependency_attempts INTEGER, dependency_wait_ms INTEGER,
#          dependency_wait_pending BOOLEAN,
#          latest_health_status STRING, latest_runtime_ms INTEGER,
#          n_executions INTEGER, n_successful_executions INTEGER,
#          n_trigger_guids INTEGER, trigger_types REPEATED STRING,
#          first_submission_timestamp TIMESTAMP, last_termination_timestamp TIMESTAMP,
#          is_latest_execution_successful BOOLEAN, total_exec_duration_sec INTEGER,
#          source_execution_net_cost FLOAT,
#          n_jobs INTEGER, n_script_parent_jobs INTEGER,
#          n_failed_jobs INTEGER, n_cancelled_jobs INTEGER,
#          n_jobs_missing_slot_ms INTEGER, n_executions_with_jobs INTEGER,
#          n_executions_job_window_incomplete INTEGER,
#          total_slot_ms INTEGER, total_slot_hours FLOAT,
#          total_bytes_processed INTEGER,
#          job_project_ids REPEATED STRING, destination_project_ids REPEATED STRING,
#          destination_tables JSON,
#          date DATE, health_as_of TIMESTAMP, generated_at TIMESTAMP
WORKFLOW_METRICS_COLUMNS = [
    "component_id", "workflow_id", "workflow_entity_id",
    "submission_parameter", "partition_timestamp", "partition_rank",
    "is_success_baseline", "is_in_latest_7", "is_latest_partition",
    "has_status_events", "health_status",
    "triggered_at", "finished_at", "completion_offset_ms", "runtime_ms",
    "attempts", "status_counts",
    "missing_dependency_attempts", "dependency_wait_ms", "dependency_wait_pending",
    "latest_health_status", "latest_runtime_ms",
    "n_executions", "n_successful_executions", "n_trigger_guids",
    "trigger_types", "first_submission_timestamp", "last_termination_timestamp",
    "is_latest_execution_successful", "total_exec_duration_sec",
    "source_execution_net_cost",
    "n_jobs", "n_script_parent_jobs", "n_failed_jobs", "n_cancelled_jobs",
    "n_jobs_missing_slot_ms", "n_executions_with_jobs",
    "n_executions_job_window_incomplete",
    "total_slot_ms", "total_slot_hours", "total_bytes_processed",
    "job_project_ids", "destination_project_ids", "destination_tables",
    "date", "health_as_of", "generated_at",
]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def json_array(items):
    """Encode a list as a JSON array string for CSV."""
    return json.dumps(items)


def default_repo_name(component):
    return "".join(word.capitalize() for word in component.split("-"))


def owner_group(project_name):
    return f"group:default/{project_name}-infra"


def workflow_type_label(wf_type):
    """Map entity YAML workflow type to a workflowType attribute value."""
    return f"{wf_type}-query"


# ---------------------------------------------------------------------------
# Entity ID conventions (mirroring the real inventory pipeline)
# ---------------------------------------------------------------------------

def component_entity_id(component_name):
    return f"component:default/{component_name}"

def gcp_project_entity_id(project_name):
    return f"gcp-project:{project_name}"

def repository_entity_id(repo_name):
    return f"repository:github.com/streaming-infra/{repo_name}"

def workflow_entity_id(component_name, workflow_name):
    return f"workflow:{component_name}/{workflow_name}"


# ---------------------------------------------------------------------------
# Row generators
# ---------------------------------------------------------------------------

def build_entity_rows(yaml_data):
    """Build entity rows from entities.yaml."""
    rows = []

    for project in yaml_data["gcp_projects"]:
        project_name = project["project"]

        owner = owner_group(project_name)

        # GCP project entity
        rows.append({
            "entity_id": gcp_project_entity_id(project_name),
            "entity_type": "gcp_project",
            "name": project_name,
            "url": f"https://console.cloud.google.com/home/dashboard?project={project_name}",
            "owners": json_array([owner]),
            "initiative_tags": json_array([]),
            "in_scope": "true",
            "attributes": json.dumps({"gcp-project": {"project_id": project_name}}),
            "date": SNAPSHOT_DATE,
            "generated_at": GENERATED_AT,
        })

        for comp in project["components"]:
            comp_name = comp["component"]
            repo_name = comp.get("repo") or default_repo_name(comp_name)

            # Component entity
            rows.append({
                "entity_id": component_entity_id(comp_name),
                "entity_type": "component",
                "name": comp_name,
                "url": f"https://backstage.example.com/catalog/default/Component/{comp_name}",
                "owners": json_array([owner]),
                "initiative_tags": json_array([]),
                "in_scope": "true",
                "attributes": json.dumps({
                    "component": {"componentType": "service", "lifecycle": "production"},
                }),
                "date": SNAPSHOT_DATE,
                "generated_at": GENERATED_AT,
            })

            # Repository entity (deduplicated later)
            repo_id = repository_entity_id(repo_name)
            rows.append({
                "entity_id": repo_id,
                "entity_type": "repository",
                "name": repo_name,
                "url": f"https://github.com/streaming-infra/{repo_name}",
                "owners": json_array([]),
                "initiative_tags": json_array([]),
                "in_scope": "true",
                "attributes": json.dumps({
                    "repository": {
                        "archived": False,
                        "createdAt": "2024-01-15T10:00:00.000Z",
                        "defaultBranchLastCommit": {
                            "sha": "abc123def456",
                            "url": f"https://github.com/streaming-infra/{repo_name}/commit/abc123def456",
                        },
                        "description": f"Repository for {repo_name}",
                        "fullName": f"streaming-infra/{repo_name}",
                        "host": "github.com",
                        "organization": "streaming-infra",
                        "pushedAt": "2026-09-28T12:00:00.000Z",
                        "repositoryName": repo_name,
                    },
                }),
                "date": SNAPSHOT_DATE,
                "generated_at": GENERATED_AT,
            })

            # Workflow entities
            for wf in comp.get("workflows", []):
                wf_name = wf["workflow"]
                wf_type = wf.get("type", "cast-member")
                rows.append({
                    "entity_id": workflow_entity_id(comp_name, wf_name),
                    "entity_type": "workflow",
                    "name": wf_name,
                    "url": f"https://backstage.example.com/workflows/{wf_name}/instances",
                    "owners": json_array([owner]),
                    "initiative_tags": json_array([]),
                    "in_scope": "true",
                    "attributes": json.dumps({
                        "workflow": {
                            "bqDestinationTableProjects": [project_name],
                            "bqJobProjects": [project_name],
                            "enabled": True,
                            "offset": "PT1H",
                            "orchestrationType": "orchestrator",
                            "parentComponentId": component_entity_id(comp_name),
                            "schedule": "days",
                            "serviceAccount": f"{comp_name}@{project_name}.iam.gserviceaccount.com",
                            "orchestratorComponentId": comp_name,
                            "orchestratorWorkflowId": wf_name,
                            "workflowType": workflow_type_label(wf_type),
                        },
                    }),
                    "date": SNAPSHOT_DATE,
                    "generated_at": GENERATED_AT,
                })

    # Deduplicate repositories (shared repos appear multiple times)
    seen_ids = set()
    deduped = []
    for row in rows:
        if row["entity_id"] in seen_ids:
            continue
        seen_ids.add(row["entity_id"])
        deduped.append(row)

    return deduped


def build_relationship_rows(yaml_data):
    """Build relationship rows from entities.yaml."""
    rows = []

    for project in yaml_data["gcp_projects"]:
        project_name = project["project"]

        for comp in project["components"]:
            comp_name = comp["component"]
            comp_id = component_entity_id(comp_name)
            repo_name = comp.get("repo") or default_repo_name(comp_name)
            repo_id = repository_entity_id(repo_name)
            proj_id = gcp_project_entity_id(project_name)

            # component -> repository (sourceRepository)
            rows.append({
                "source_entity_id": comp_id,
                "target_entity_id": repo_id,
                "relationship_type": "sourceRepository",
                "status": "declared",
                "target_resolved": "true",
                "date": SNAPSHOT_DATE,
                "generated_at": GENERATED_AT,
            })

            # component -> gcp-project (associatedProject)
            rows.append({
                "source_entity_id": comp_id,
                "target_entity_id": proj_id,
                "relationship_type": "associatedProject",
                "status": "declared",
                "target_resolved": "true",
                "date": SNAPSHOT_DATE,
                "generated_at": GENERATED_AT,
            })

            # workflow -> component (partOf)
            for wf in comp.get("workflows", []):
                wf_id = workflow_entity_id(comp_name, wf["workflow"])
                rows.append({
                    "source_entity_id": wf_id,
                    "target_entity_id": comp_id,
                    "relationship_type": "partOf",
                    "status": "declared",
                    "target_resolved": "true",
                    "date": SNAPSHOT_DATE,
                    "generated_at": GENERATED_AT,
                })

    return rows


def build_workflow_metrics_rows(yaml_data):
    """Build workflow metrics rows — 7 partitions per workflow, all success."""
    rows = []
    base_date = datetime(2026, 9, 25, 0, 0, 0, tzinfo=timezone.utc)

    for project in yaml_data["gcp_projects"]:
        project_name = project["project"]

        for comp in project["components"]:
            comp_name = comp["component"]

            for wf in comp.get("workflows", []):
                wf_name = wf["workflow"]
                wf_eid = workflow_entity_id(comp_name, wf_name)

                for rank in range(1, 8):
                    partition_dt = base_date - timedelta(days=rank - 1)
                    partition_str = partition_dt.strftime("%Y-%m-%d")
                    triggered = partition_dt + timedelta(hours=1)
                    finished = triggered + timedelta(minutes=10)
                    is_latest = rank == 1

                    dest_table = {
                        "destination_label": f"{project_name}.{comp_name}_output.{wf_name}",
                        "destination_kind": "table",
                        "destination_project_id": project_name,
                        "destination_dataset_id": f"{comp_name}_output",
                        "destination_table_id": wf_name,
                        "statement_types": ["INSERT"],
                        "n_executions": 1,
                        "n_jobs": 1,
                        "total_slot_ms": 1000,
                        "total_slot_hours": 0.000278,
                        "total_bytes_processed": 1048576,
                        "share_of_partition_slot": 1.0,
                        "heaviest_job": {
                            "job_project_id": project_name,
                            "job_location": "US",
                            "job_id": f"job_{comp_name}_{wf_name}_{partition_str}",
                            "statement_type": "INSERT",
                            "job_outcome": "success",
                            "total_slot_ms": 1000,
                            "total_bytes_processed": 1048576,
                            "start_time": triggered.isoformat(),
                            "end_time": finished.isoformat(),
                            "bq_console_url": None,
                        },
                        "latest_job": {
                            "job_project_id": project_name,
                            "job_location": "US",
                            "job_id": f"job_{comp_name}_{wf_name}_{partition_str}",
                            "statement_type": "INSERT",
                            "job_outcome": "success",
                            "total_slot_ms": 1000,
                            "total_bytes_processed": 1048576,
                            "start_time": triggered.isoformat(),
                            "end_time": finished.isoformat(),
                            "bq_console_url": None,
                        },
                    }

                    rows.append({
                        "component_id": comp_name,
                        "workflow_id": wf_name,
                        "workflow_entity_id": wf_eid,
                        "submission_parameter": partition_str,
                        "partition_timestamp": partition_dt.isoformat(),
                        "partition_rank": rank,
                        "is_success_baseline": "false",
                        "is_in_latest_7": "true",
                        "is_latest_partition": str(is_latest).lower(),
                        "has_status_events": "true",
                        "health_status": "success",
                        "triggered_at": triggered.isoformat(),
                        "finished_at": finished.isoformat(),
                        "completion_offset_ms": 3600000,
                        "runtime_ms": 600000,
                        "attempts": 1,
                        "status_counts": json.dumps({"SUCCESS": 1}),
                        "missing_dependency_attempts": 0,
                        "dependency_wait_ms": 0,
                        "dependency_wait_pending": "false",
                        "latest_health_status": "success" if is_latest else "",
                        "latest_runtime_ms": 600000 if is_latest else "",
                        "n_executions": 1,
                        "n_successful_executions": 1,
                        "n_trigger_guids": 1,
                        "trigger_types": json_array(["natural"]),
                        "first_submission_timestamp": triggered.isoformat(),
                        "last_termination_timestamp": finished.isoformat(),
                        "is_latest_execution_successful": "true",
                        "total_exec_duration_sec": 600,
                        "source_execution_net_cost": 0.01,
                        "n_jobs": 1,
                        "n_script_parent_jobs": 0,
                        "n_failed_jobs": 0,
                        "n_cancelled_jobs": 0,
                        "n_jobs_missing_slot_ms": 0,
                        "n_executions_with_jobs": 1,
                        "n_executions_job_window_incomplete": 0,
                        "total_slot_ms": 1000,
                        "total_slot_hours": 0.000278,
                        "total_bytes_processed": 1048576,
                        "job_project_ids": json_array([project_name]),
                        "destination_project_ids": json_array([project_name]),
                        "destination_tables": json.dumps([dest_table]),
                        "date": SNAPSHOT_DATE,
                        "health_as_of": "2026-10-02T00:00:00Z",
                        "generated_at": GENERATED_AT,
                    })

    return rows


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    with open(ENTITIES_YAML) as f:
        yaml_data = yaml.safe_load(f)

    entity_rows = build_entity_rows(yaml_data)
    relationship_rows = build_relationship_rows(yaml_data)
    workflow_metrics_rows = build_workflow_metrics_rows(yaml_data)

    def write_csv(filename, columns, rows):
        path = os.path.join(OUTPUT_DIR, filename)
        with open(path, "w", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=columns)
            writer.writeheader()
            writer.writerows(rows)
        print(f"  {filename}: {len(rows)} rows", file=sys.stderr)

    print("Writing CSVs...", file=sys.stderr)
    write_csv("entities.csv", ENTITIES_COLUMNS, entity_rows)
    write_csv("relationships.csv", RELATIONSHIPS_COLUMNS, relationship_rows)
    write_csv("workflow_metrics.csv", WORKFLOW_METRICS_COLUMNS, workflow_metrics_rows)
    print("Done.", file=sys.stderr)


if __name__ == "__main__":
    main()
