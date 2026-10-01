#!/usr/bin/env python3
"""
Generate dummy inventory entities YAML using TMDb API.

Maps gcp_projects -> components -> workflows, where workflows are named after
real cast, characters, or crew from the TV shows/movies defining each component.

Usage (from repo root):
    op run --env-file=.env -- uv run --with requests --with pyyaml -- python local_data/scripts/generate_entities.py
"""

import os
import sys
import re
import time

import requests
import yaml

API_KEY = os.environ.get("TMDB_API_KEY")
if not API_KEY:
    sys.exit("TMDB_API_KEY env var is required")

BASE = "https://api.themoviedb.org/3"
RATE_LIMIT_DELAY = 0.26
session = requests.Session()

# ---------------------------------------------------------------------------
# Component definitions
#
# Each component specifies:
#   search  - TMDb search query
#   media   - "tv" or "movie"
#   type    - workflow type: "cast-member", "character", or "crew-member"
#   count   - target number of workflows
#   year    - (optional) disambiguate search results
#   repo    - (optional) explicit repo name, otherwise derived from component
#
# Shared-repo groups use different types to avoid workflow name overlap:
#   BreakingBadUniverse: breaking-bad=cast, better-call-saul=character, el-camino=crew
#   GreatBritishBakingShow: main=cast, juniors=cast (different people)
#   BoBurnham: inside=crew, make-happy=cast
#   KnivesOutUniverse: glass-onion=cast, wake-up-dead-man=character
#   Avengers: avengers=character, age-of-ultron=crew, infinity-wars=cast, endgame=character
#   GoT universe (separate repos): got=character, hotd=cast, knight=crew
# ---------------------------------------------------------------------------

PROJECTS = [
    {
        "project": "paramount-plus",
        "components": [
            {"component": "survivor", "search": "Survivor", "media": "tv", "type": "cast-member", "count": 100, "year": 2000},
            {"component": "big-brother", "search": "Big Brother", "media": "tv", "type": "cast-member", "count": 100, "year": 2000},
            {"component": "the-amazing-race", "search": "The Amazing Race", "media": "tv", "type": "cast-member", "count": 50, "year": 2001},
            {"component": "tuner", "search": "Tuner", "media": "movie", "type": "cast-member", "count": 3, "year": 2025},
            {"component": "shutter-island", "search": "Shutter Island", "media": "movie", "type": "cast-member", "count": 5, "year": 2010},
            {"component": "interstellar", "search": "Interstellar", "media": "movie", "type": "crew-member", "count": 5, "year": 2014},
            {"component": "yellowjackets", "search": "Yellowjackets", "media": "tv", "type": "character", "count": 5},
        ],
    },
    {
        "project": "netflix",
        "components": [
            {"component": "the-great-british-baking-show", "search": "The Great British Bake Off", "media": "tv", "type": "cast-member", "count": 5, "repo": "GreatBritishBakingShow"},
            {"component": "the-great-british-baking-show-juniors", "search": "Junior Bake Off", "media": "tv", "type": "cast-member", "count": 3, "repo": "GreatBritishBakingShow"},
            {"component": "breaking-bad", "search": "Breaking Bad", "media": "tv", "type": "cast-member", "count": 5, "repo": "BreakingBadUniverse"},
            {"component": "better-call-saul", "search": "Better Call Saul", "media": "tv", "type": "character", "count": 5, "repo": "BreakingBadUniverse"},
            {"component": "el-camino", "search": "El Camino: A Breaking Bad Movie", "media": "movie", "type": "crew-member", "count": 3, "repo": "BreakingBadUniverse"},
            {"component": "pop-culture-jeopardy", "search": "Pop Culture Jeopardy!", "media": "tv", "type": "cast-member", "count": 3},
            {"component": "train-dreams", "search": "Train Dreams", "media": "movie", "type": "cast-member", "count": 3},
            {"component": "adolescence", "search": "Adolescence", "media": "tv", "type": "cast-member", "count": 4, "year": 2025},
            {"component": "bo-burnham-inside", "search": "Bo Burnham: Inside", "media": "movie", "type": "crew-member", "count": 3, "repo": "BoBurnham"},
            {"component": "eighth-grade", "search": "Eighth Grade", "media": "movie", "type": "cast-member", "count": 4, "year": 2018},
            {"component": "knives-out-glass-onion", "search": "Glass Onion: A Knives Out Mystery", "media": "movie", "type": "cast-member", "count": 5, "repo": "KnivesOutUniverse"},
            {"component": "knives-out-wake-up-dead-man", "search": "Wake Up Dead Man: A Knives Out Mystery", "media": "movie", "type": "character", "count": 5, "repo": "KnivesOutUniverse"},
            {"component": "top-gun-maverick", "search": "Top Gun: Maverick", "media": "movie", "type": "cast-member", "count": 5, "year": 2022},
            {"component": "nine-to-five", "search": "9 to 5", "media": "movie", "type": "cast-member", "count": 4, "year": 1980},
            {"component": "people-we-meet-on-vacation", "search": "People We Meet on Vacation", "media": "movie", "type": "cast-member", "count": 3},
            {"component": "dawsons-creek", "search": "Dawson's Creek", "media": "tv", "type": "character", "count": 5},
            {"component": "the-west-wing", "search": "The West Wing", "media": "tv", "type": "character", "count": 5},
            {"component": "suits", "search": "Suits", "media": "tv", "type": "cast-member", "count": 5},
            {"component": "black-mirror", "search": "Black Mirror", "media": "tv", "type": "crew-member", "count": 4},
            {"component": "beef", "search": "Beef", "media": "tv", "type": "cast-member", "count": 4, "year": 2023},
            {"component": "the-squid-and-the-whale", "search": "The Squid and the Whale", "media": "movie", "type": "cast-member", "count": 4, "year": 2005},
            {"component": "the-big-picture", "search": "The Big Picture", "media": "movie", "type": "cast-member", "count": 3},
        ],
    },
    {
        "project": "hbo-max",
        "components": [
            {"component": "one-battle-after-another", "search": "One Battle After Another", "media": "movie", "type": "cast-member", "count": 3},
            {"component": "sinners", "search": "Sinners", "media": "movie", "type": "cast-member", "count": 5, "year": 2025},
            {"component": "materialists", "search": "Materialists", "media": "movie", "type": "cast-member", "count": 4},
            {"component": "marty-supreme", "search": "Marty Supreme", "media": "movie", "type": "cast-member", "count": 3},
            {"component": "the-brutalist", "search": "The Brutalist", "media": "movie", "type": "cast-member", "count": 5, "year": 2024},
            {"component": "lanterns", "search": "Lanterns", "media": "tv", "type": "cast-member", "count": 4},
            {"component": "game-of-thrones", "search": "Game of Thrones", "media": "tv", "type": "character", "count": 60},
            {"component": "house-of-the-dragon", "search": "House of the Dragon", "media": "tv", "type": "cast-member", "count": 5},
            {"component": "a-knight-of-the-seven-kingdoms", "search": "A Knight of the Seven Kingdoms", "media": "tv", "type": "crew-member", "count": 3},
        ],
    },
    {
        "project": "dropout-tv",
        "components": [
            {"component": "game-changer", "search": "Game Changer", "media": "tv", "type": "cast-member", "count": 5, "year": 2019},
            {"component": "dimension-20", "search": "Dimension 20", "media": "tv", "type": "cast-member", "count": 5},
            {"component": "make-some-noise", "search": "Make Some Noise", "media": "tv", "type": "cast-member", "count": 4},
            {"component": "smartypants", "search": "Smartypants", "media": "tv", "type": "cast-member", "count": 3},
            {"component": "hundreds-of-beavers", "search": "Hundreds of Beavers", "media": "movie", "type": "crew-member", "count": 3, "year": 2022},
        ],
    },
    {
        "project": "hulu",
        "components": [
            {"component": "nirvanna-the-band-the-show-the-movie", "search": "Nirvanna the Band the Show", "media": "tv", "type": "cast-member", "count": 3},
            {"component": "saturday-night", "search": "Saturday Night", "media": "movie", "type": "cast-member", "count": 5, "year": 2024},
            {"component": "everything-everywhere-all-at-once", "search": "Everything Everywhere All at Once", "media": "movie", "type": "cast-member", "count": 5, "year": 2022},
            {"component": "palm-springs", "search": "Palm Springs", "media": "movie", "type": "cast-member", "count": 4, "year": 2020},
            {"component": "adults", "search": "Adults", "media": "tv", "type": "cast-member", "count": 3},
            {"component": "over-the-garden-wall", "search": "Over the Garden Wall", "media": "tv", "type": "character", "count": 4},
        ],
    },
    {
        "project": "disney-plus",
        "components": [
            {"component": "dancing-with-the-stars", "search": "Dancing with the Stars", "media": "tv", "type": "cast-member", "count": 50, "year": 2005},
            {"component": "xmen-97", "search": "X-Men '97", "media": "tv", "type": "character", "count": 5},
            {"component": "loki", "search": "Loki", "media": "tv", "type": "cast-member", "count": 5, "year": 2021},
            {"component": "thunderbolts", "search": "Thunderbolts", "media": "movie", "type": "cast-member", "count": 5},
            {"component": "avengers-endgame", "search": "Avengers: Endgame", "media": "movie", "type": "character", "count": 5, "repo": "Avengers", "year": 2019},
            {"component": "avengers-infinity-wars", "search": "Avengers: Infinity War", "media": "movie", "type": "cast-member", "count": 5, "repo": "Avengers", "year": 2018},
            {"component": "avengers-age-of-ultron", "search": "Avengers: Age of Ultron", "media": "movie", "type": "crew-member", "count": 4, "repo": "Avengers", "year": 2015},
            {"component": "avengers", "search": "The Avengers", "media": "movie", "type": "character", "count": 5, "repo": "Avengers", "year": 2012},
            {"component": "daredevil-born-again", "search": "Daredevil: Born Again", "media": "tv", "type": "cast-member", "count": 5},
            {"component": "toy-story-5", "search": "Toy Story 5", "media": "movie", "type": "character", "count": 4},
            {"component": "hocus-pocus", "search": "Hocus Pocus", "media": "movie", "type": "cast-member", "count": 4, "year": 1993},
        ],
    },
]


# ---------------------------------------------------------------------------
# TMDb helpers
# ---------------------------------------------------------------------------

def tmdb_get(path, params=None):
    url = f"{BASE}{path}"
    all_params = {"api_key": API_KEY}
    if params:
        all_params.update(params)
    time.sleep(RATE_LIMIT_DELAY)
    resp = session.get(url, params=all_params)
    resp.raise_for_status()
    return resp.json()


def search_tmdb(query, media_type, year=None):
    params = {"query": query}
    if year:
        key = "first_air_date_year" if media_type == "tv" else "primary_release_year"
        params[key] = year
    try:
        data = tmdb_get(f"/search/{media_type}", params)
        results = data.get("results", [])
        if results:
            r = results[0]
            return {"id": r["id"], "title": r.get("name") or r.get("title")}
    except Exception as e:
        print(f"  Search failed for '{query}': {e}", file=sys.stderr)
    return None


def get_credits(tmdb_id, media_type):
    try:
        if media_type == "tv":
            return tmdb_get(f"/tv/{tmdb_id}/aggregate_credits")
        else:
            return tmdb_get(f"/movie/{tmdb_id}/credits")
    except Exception as e:
        print(f"  Credits failed for {media_type}/{tmdb_id}: {e}", file=sys.stderr)
    return None


def get_tv_details(tv_id):
    try:
        return tmdb_get(f"/tv/{tv_id}")
    except:
        return None


def get_tv_season_credits(tv_id, season_number):
    try:
        return tmdb_get(f"/tv/{tv_id}/season/{season_number}/credits")
    except:
        return None


# ---------------------------------------------------------------------------
# Name processing
# ---------------------------------------------------------------------------

def to_snake_case(name):
    name = re.sub(r'\(.*?\)', '', name).strip()
    # Drop everything after " / " (role separators like "Self / Host")
    name = re.sub(r'\s*/\s*.*', '', name).strip()
    name = name.replace("'s", "s").replace("'s", "s")
    name = re.sub(r"[^a-zA-Z0-9\s\-]", '', name)
    name = re.sub(r'[\s\-]+', '_', name).lower().strip('_')
    return name


def default_repo_name(component):
    return ''.join(word.capitalize() for word in component.split('-'))


# ---------------------------------------------------------------------------
# Workflow extraction
# ---------------------------------------------------------------------------

SKIP_CHARACTERS = {
    "self", "himself", "herself", "themselves", "narrator",
    "various", "various roles", "", "host", "judge",
}


def extract_cast_members(credits, media_type, limit):
    cast = credits.get("cast", [])
    if media_type == "tv":
        cast.sort(key=lambda c: c.get("total_episode_count", 0), reverse=True)
    else:
        cast.sort(key=lambda c: c.get("order", 999))

    results, seen = [], set()
    for person in cast:
        name = person.get("name", "").strip()
        snake = to_snake_case(name)
        if not snake or len(snake) < 2 or snake in seen:
            continue
        seen.add(snake)
        results.append({"workflow": snake, "type": "cast-member", "tmdb_id": person.get("id")})
        if len(results) >= limit:
            break
    return results


def extract_characters(credits, media_type, limit):
    cast = credits.get("cast", [])
    if media_type == "tv":
        cast.sort(key=lambda c: c.get("total_episode_count", 0), reverse=True)
    else:
        cast.sort(key=lambda c: c.get("order", 999))

    results, seen = [], set()
    for person in cast:
        chars = []
        if media_type == "tv":
            chars = [r.get("character", "") for r in person.get("roles", [])]
        else:
            chars = [person.get("character", "")]

        for char in chars:
            char = char.strip()
            if char.lower() in SKIP_CHARACTERS or char.lower().startswith("self"):
                continue
            snake = to_snake_case(char)
            if not snake or len(snake) < 2 or snake in seen:
                continue
            seen.add(snake)
            results.append({"workflow": snake, "type": "character", "tmdb_id": person.get("id")})
            if len(results) >= limit:
                return results
    return results


def extract_crew_members(credits, media_type, limit):
    crew = credits.get("crew", [])
    priority_jobs = {
        "Director", "Writer", "Screenplay", "Producer",
        "Executive Producer", "Creator", "Showrunner",
        "Director of Photography", "Original Music Composer", "Editor",
    }

    persons = {}
    if media_type == "tv":
        for member in crew:
            pid = member.get("id")
            if pid not in persons:
                jobs = [j.get("job", "") for j in member.get("jobs", [])]
                persons[pid] = {
                    "name": member.get("name", ""),
                    "id": pid,
                    "episode_count": member.get("total_episode_count", 0),
                    "priority": any(j in priority_jobs for j in jobs),
                }
    else:
        for member in crew:
            pid = member.get("id")
            job = member.get("job", "")
            if pid not in persons:
                persons[pid] = {
                    "name": member.get("name", ""),
                    "id": pid,
                    "episode_count": 0,
                    "priority": job in priority_jobs,
                }
            elif job in priority_jobs:
                persons[pid]["priority"] = True

    sorted_crew = sorted(persons.values(), key=lambda c: (c["priority"], c["episode_count"]), reverse=True)

    results, seen = [], set()
    for person in sorted_crew:
        name = person.get("name", "").strip()
        snake = to_snake_case(name)
        if not snake or len(snake) < 2 or snake in seen:
            continue
        seen.add(snake)
        results.append({"workflow": snake, "type": "crew-member", "tmdb_id": person.get("id")})
        if len(results) >= limit:
            break
    return results


EXTRACTORS = {
    "cast-member": extract_cast_members,
    "character": extract_characters,
    "crew-member": extract_crew_members,
}


def supplement_from_seasons(tv_id, workflow_type, existing, target):
    """Fetch per-season credits (including guest stars) for large reality shows."""
    details = get_tv_details(tv_id)
    if not details:
        return existing

    num_seasons = details.get("number_of_seasons", 0)
    existing_names = {w["workflow"] for w in existing}
    new_workflows = list(existing)

    for season_num in range(1, num_seasons + 1):
        if len(new_workflows) >= target:
            break
        season_credits = get_tv_season_credits(tv_id, season_num)
        if not season_credits:
            continue

        people = season_credits.get("cast", []) + season_credits.get("guest_stars", [])
        for person in people:
            if len(new_workflows) >= target:
                break

            if workflow_type == "cast-member":
                name = person.get("name", "").strip()
                snake = to_snake_case(name)
                tmdb_id = person.get("id")
            elif workflow_type == "character":
                char = person.get("character", "").strip()
                if char.lower() in SKIP_CHARACTERS or char.lower().startswith("self"):
                    continue
                snake = to_snake_case(char)
                tmdb_id = person.get("id")
            else:
                continue

            if snake and len(snake) > 1 and snake not in existing_names:
                existing_names.add(snake)
                new_workflows.append({"workflow": snake, "type": workflow_type, "tmdb_id": tmdb_id})

    return new_workflows


# ---------------------------------------------------------------------------
# YAML output helpers
# ---------------------------------------------------------------------------

class LiteralStr(str):
    pass

def str_representer(dumper, data):
    return dumper.represent_scalar('tag:yaml.org,2002:str', data)

def dict_representer(dumper, data):
    return dumper.represent_mapping('tag:yaml.org,2002:map', data.items())

yaml.add_representer(dict, dict_representer)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    global_used = set()
    output_projects = []
    found, not_found, total_workflows = 0, 0, 0

    for project_def in PROJECTS:
        project_entry = {"project": project_def["project"], "components": []}

        for comp in project_def["components"]:
            name = comp["component"]
            wf_type = comp["type"]
            target = comp["count"]
            media = comp["media"]
            year = comp.get("year")
            repo = comp.get("repo") or default_repo_name(name)

            print(f"[{project_def['project']}] {name} ({wf_type}, target={target})...", file=sys.stderr)

            # Search TMDb
            result = search_tmdb(comp["search"], media, year)
            if not result and year:
                result = search_tmdb(comp["search"], media)
            if not result:
                print(f"  NOT FOUND", file=sys.stderr)
                not_found += 1
                project_entry["components"].append({
                    "component": name, "tmdb_id": None, "repo": repo, "workflows": [],
                })
                continue

            tmdb_id = result["id"]
            print(f"  -> {result['title']} (tmdb:{tmdb_id})", file=sys.stderr)
            found += 1

            # Get credits
            credits = get_credits(tmdb_id, media)
            workflows = []
            if credits:
                extractor = EXTRACTORS[wf_type]
                workflows = extractor(credits, media, target * 3)

            # For large TV targets, supplement with per-season credits
            if media == "tv" and target > 20 and len(workflows) < target:
                print(f"  Supplementing: {len(workflows)}/{target} from aggregate, fetching seasons...", file=sys.stderr)
                workflows = supplement_from_seasons(tmdb_id, wf_type, workflows, target * 2)
                print(f"  After seasons: {len(workflows)}", file=sys.stderr)

            # Global dedup
            deduped = []
            for w in workflows:
                if w["workflow"] not in global_used:
                    global_used.add(w["workflow"])
                    deduped.append(w)
                if len(deduped) >= target:
                    break

            if len(deduped) < target:
                print(f"  WARNING: {len(deduped)}/{target} unique workflows", file=sys.stderr)

            total_workflows += len(deduped)
            project_entry["components"].append({
                "component": name, "tmdb_id": tmdb_id, "repo": repo, "workflows": deduped,
            })

        output_projects.append(project_entry)

    # Write YAML
    output = {"gcp_projects": output_projects}
    script_dir = os.path.dirname(os.path.abspath(__file__))
    output_path = os.path.join(script_dir, "..", "entities.yaml")
    with open(output_path, "w") as f:
        yaml.dump(output, f, default_flow_style=False, allow_unicode=True, sort_keys=False, width=120)

    print(f"\nDone: {found} found, {not_found} not found, {total_workflows} total workflows", file=sys.stderr)
    print(f"Output: {output_path}", file=sys.stderr)


if __name__ == "__main__":
    main()
