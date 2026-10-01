# local_data

Dummy data for the inventory demo, generated from real TV/movie metadata via TMDb.

## Files

- `entities.yaml` — all GCP projects, components, repos, and workflows. This is the source of truth; edit it directly for manual tweaks.
- `entities.csv` — inventory entities table (one row per entity: gcp_project, component, repository, workflow).
- `relationships.csv` — inventory relationships table (edges: sourceRepository, associatedProject, partOf).
- `workflow_metrics.csv` — workflow metrics table (7 partitions per workflow with health, timing, and resource data).

The CSVs mirror the schemas of the upstream BQ reporting tables that the inventory view reads from. See column comments in `scripts/generate_csvs.py` for the source table each CSV maps to.

## Scripts

### `scripts/generate_entities.py`

Generates `entities.yaml` by querying the TMDb API for cast, character, and crew names across all defined components. Each component maps to a TV show or movie, and its workflows are named after real people/characters from that property.

**Prerequisites:** a TMDb API key in `.env` at the repo root (uses `op://` reference resolved by `op run`).

**Run from the repo root:**

```bash
op run --env-file=.env -- uv run --with requests --with pyyaml -- python local_data/scripts/generate_entities.py
```

**Configuration** is inline in the script's `PROJECTS` list. Each component specifies a TMDb search query, media type (tv/movie), workflow type (cast-member/character/crew-member), and target count. Shared-repo groups use different workflow types to avoid name collisions.

**Notes:**
- TMDb API ordering is not guaranteed stable across runs. For deterministic changes, edit `entities.yaml` directly.
- Workflow names are globally deduplicated — no name appears in more than one component.
- Reality shows with large targets (Survivor, Big Brother, etc.) supplement aggregate credits with per-season guest star data.

### `scripts/generate_csvs.py`

Reads `entities.yaml` and produces the three CSV files above, matching the BQ table schemas used by the inventory hub view. Schemas are hard-coded in the script with comments referencing the upstream tables.

**No prerequisites** beyond pyyaml (no API keys, no BQ access).

**Run from the repo root:**

```bash
uv run --with pyyaml -- python local_data/scripts/generate_csvs.py
```

**Current dummy values:** all workflows have 7 partitions, all `success` health status, uniform timing (10min runtime, 1hr completion offset), and flat resource usage (1 job, 1000 slot_ms, 1MB bytes_processed per partition). These will be made more variable in a later pass.

### `scripts/generate_fixtures_ts.py`

Reads `entities.csv` and `relationships.csv` and writes `src/features/inventory/fixtures.ts` — the TypeScript fixture file consumed by the demo app. Maps BQ-style attribute keys to the TypeScript interface shapes (e.g., `gcp-project.project_id` → `gcpProject.projectId`).

**No prerequisites** beyond pyyaml.

**Run from the repo root:**

```bash
uv run --with pyyaml -- python local_data/scripts/generate_fixtures_ts.py
```

Panel fixtures (workflow health, resources, GCP jobs, component metrics) are generic placeholders reused for any entity. The main inventory fixture (entities + relationships) is generated from the CSVs.
