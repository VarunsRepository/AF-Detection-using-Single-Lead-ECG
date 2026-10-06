# ---------------------------------------------------------------------------
# catalog/sources/biology_pathway_store.py
#
# Where pathways live. One JSON file per model, in a folder, loaded at
# import and written on save.
#
# WHY FILES AND NOT A DATABASE
#
#   Git is already doing the job a database would do, and doing it better:
#   versioned, diffable, reviewable, rollback in one command. A model also
#   ships alongside the engine version that can interpret it, so the two
#   cannot desync -- which a database guarantees nothing about.
#
#   The thing that will eventually force Postgres is saves that must land
#   WITHOUT a deploy, from people we do not know. Until then this is the
#   cheaper correct answer.
#
#   When that day comes, the swap is this file and nothing else. Every
#   caller goes through load_all / get / save, and none of them knows there
#   is a filesystem behind it.
#
# WHY JSON AND NOT PYTHON DICTS
#
#   The builder emits JSON. The SBML converter will emit JSON. Keeping the
#   stored form as Python literals meant hand-translating true -> True on
#   the way in and back on the way out, every time, with a typo waiting at
#   each pass. The stored form is now the form the tools already produce.
# ---------------------------------------------------------------------------

from __future__ import annotations

import json
import os
import re
import tempfile
import threading
import time
from pathlib import Path

# Next to this module, i.e. catalog/sources/pathways/. Content in the code
# tree is not where it belongs long term -- catalog/data/ is -- but moving
# it is one constant, and the prefix on this filename is the standing note
# that the whole arrangement is provisional.
PATHWAY_DIR = Path(__file__).parent / "pathways"

# Saved models land here, not in the curated set. Nothing in the feed shows
# a draft; /builder can fetch one by id to carry on editing it. Promotion
# to published is a human moving a file, which is the review gate until
# there is a real one.
DRAFT_DIR = PATHWAY_DIR / "drafts"

_lock = threading.Lock()
_cache: dict[str, dict] = {}
_loaded = False

_ID_OK = re.compile(r"^[a-z0-9_]{3,64}$")


def slug(text: str) -> str:
    """Same rule as idOf() in the builder, so an id round-trips."""
    s = re.sub(r"[^a-z0-9]+", "_", (text or "").strip().lower()).strip("_")
    return s[:56]


def _read(path: Path) -> dict | None:
    try:
        with path.open(encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, json.JSONDecodeError) as exc:
        # One malformed file must not take the whole catalogue down. Say
        # which file, loudly, and carry on with the rest.
        print(f"[PATHWAY STORE] skipping {path.name}: {exc}")
        return None


def load_all(refresh: bool = False) -> dict[str, dict]:
    """
    id -> model, for every file in the folder and its drafts/ subfolder.
    Cached, because this is read on every feed build.
    """
    global _loaded
    with _lock:
        if _loaded and not refresh:
            return _cache

        _cache.clear()
        for folder, is_draft in ((PATHWAY_DIR, False), (DRAFT_DIR, True)):
            if not folder.is_dir():
                continue
            for path in sorted(folder.glob("*.json")):
                model = _read(path)
                if model is None:
                    continue
                pid = model.get("id") or path.stem
                model["id"] = pid
                model.setdefault("status", "draft" if is_draft else "published")
                if pid in _cache:
                    print(f"[PATHWAY STORE] duplicate id {pid} in {path.name}")
                _cache[pid] = model
        _loaded = True
        return _cache


def get(pathway_id: str) -> dict | None:
    return load_all().get(pathway_id)


def published() -> dict[str, dict]:
    """What the feed is allowed to see. Drafts are not public."""
    return {k: v for k, v in load_all().items() if v.get("status") == "published"}


def exists(pathway_id: str) -> bool:
    return pathway_id in load_all()


def resolve_id(model: dict, pathway_id: str | None = None) -> str:
    """
    The id save() would use. Exposed so a caller can detect a collision
    and DESCRIBE it before writing -- "already exists" on its own is a
    refusal, not a warning, and leaves the author guessing what is in the
    way.
    """
    return pathway_id or model.get("id") or f"path_{slug(model.get('name', ''))}"


def describe(pathway_id: str) -> dict | None:
    """What is already stored under this id, in terms worth showing."""
    existing = get(pathway_id)
    if existing is None:
        return None
    return {
        "id": pathway_id,
        "name": existing.get("name", pathway_id),
        "status": existing.get("status", "published"),
        "author": existing.get("author"),
        "updatedAt": existing.get("updatedAt"),
        "steps": len(existing.get("reactions") or []),
    }


def save(model: dict, author: str = "unknown",
         pathway_id: str | None = None, overwrite: bool = False) -> dict:
    """
    Write a validated model to drafts/. The CALLER validates -- this does
    not, deliberately: a store that validates is a store with an opinion
    about what it holds, and the gate belongs in one place where it can be
    seen. See data_source_store.save_source, which does both in order.

    Returns {"id": ..., "path": ..., "created": bool}.
    """
    pid = resolve_id(model, pathway_id)
    if not _ID_OK.match(pid):
        raise ValueError(f'bad id "{pid}": lowercase letters, digits and '
                         f"underscores, 3-64 characters")

    existing = get(pid)
    if existing and not overwrite:
        raise FileExistsError(f'"{pid}" already exists')
    if existing and existing.get("status") == "published":
        # A published pathway may already be referenced by a journey. Edit
        # it in the repo, through review, not through an API call.
        raise PermissionError(f'"{pid}" is published -- edit it in the repo')
    # Overwrite consent covers YOUR draft, not someone else's. Without
    # this, `overwrite: true` is a loaded gun pointed at whoever happened
    # to pick the same name -- and since ids are slugged from the name,
    # two people authoring "Glycolysis" collide by default rather than by
    # accident. There is no way to force past this through the API; the
    # answer is to save under a different name.
    owner = (existing or {}).get("author")
    if existing and owner and owner != author:
        raise PermissionError(
            f'"{pid}" is {owner}\'s draft -- save under a different name')

    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    record = dict(model)
    record["id"] = pid
    record["status"] = "draft"
    record["author"] = author
    record["updatedAt"] = now
    record.setdefault("createdAt", (existing or {}).get("createdAt", now))

    DRAFT_DIR.mkdir(parents=True, exist_ok=True)
    target = DRAFT_DIR / f"{pid}.json"

    # Write to a temp file in the same directory, then rename. A crash
    # halfway through a plain open("w") leaves a truncated file that
    # load_all then skips -- the model is gone and nothing says why.
    fd, tmp = tempfile.mkstemp(dir=str(DRAFT_DIR), suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(record, fh, indent=2, ensure_ascii=False)
            fh.write("\n")
        os.replace(tmp, target)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise

    with _lock:
        _cache[pid] = record

    return {"id": pid, "path": str(target), "created": existing is None}


def export_from_dicts(models: dict[str, dict], folder: Path = PATHWAY_DIR) -> int:
    """
    One-off: dump the old PATHWAY_MODELS dict into the folder, so the
    migration is a script run once rather than a hand edit of twenty
    models. Returns how many were written.
    """
    folder.mkdir(parents=True, exist_ok=True)
    n = 0
    for pid, model in models.items():
        record = dict(model)
        record["id"] = pid
        record.setdefault("status", "published")
        with (folder / f"{pid}.json").open("w", encoding="utf-8") as fh:
            json.dump(record, fh, indent=2, ensure_ascii=False)
            fh.write("\n")
        n += 1
    return n
