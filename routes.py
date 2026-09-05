"""Strum Fighter — server-side storage for what the player has learned.

The plugin needs to remember which chord grips a player knows, across runs.
It first tried `localStorage`, which turned out to be unusable in at least one
real feedBack build: writes appeared to succeed, nothing came back, and every
session started from zero. Worse, that failed silently — the player drilled
chords while the game only pretended to be keeping score.

So progress lives here instead, on the same host that already serves this
plugin's files. Two routes, and the server deliberately knows nothing about
the shape of what it stores:

    GET  /api/plugins/strum_fighter/progress   -> the stored object, or {}
    PUT  /api/plugins/strum_fighter/progress   -> replaces it

Keeping the schema entirely on the client side means the two halves can never
disagree about it, and a schema change needs no migration here. The server's
only jobs are to persist a blob, refuse an unreasonably large one, and never
hand back something that isn't a JSON object.

Written atomically (temp file + replace) so an interrupted write cannot leave
a truncated file that would read back as corrupt and lose everything.
"""

from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request

PLUGIN_ID = "strum_fighter"
PROGRESS_FILE = "progress.json"

# Generous for the real payload (a few hundred chords is a few tens of KB),
# small enough that a broken client cannot fill the disk.
MAX_BYTES = 512 * 1024


def _config_dir(context: dict | None) -> Path:
    """Where to keep our state.

    The plugin spec hands `config_dir` to setup(); prefer it over guessing at
    environment variables, and fall back only so a misconfigured host still
    gets working storage rather than a crash at import time.
    """
    if context:
        raw = context.get("config_dir")
        if raw:
            return Path(raw)
    env = os.environ.get("FEEDBACK_CONFIG_DIR") or os.environ.get("SLOPSMITH_CONFIG_DIR")
    if env:
        return Path(env)
    return Path.home() / ".feedback"


def _atomic_write(path: Path, text: str) -> None:
    """Replace `path`'s contents without ever leaving it half-written."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), prefix=".progress-", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(text)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def build_router(context: dict | None = None) -> APIRouter:
    """The plugin's routes. Exposed separately so tests can mount them alone."""
    router = APIRouter(prefix=f"/api/plugins/{PLUGIN_ID}")
    store = _config_dir(context) / PLUGIN_ID / PROGRESS_FILE

    @router.get("/progress")
    def read_progress() -> dict:
        # No history is the normal state on a first run, not an error — the
        # client should get an empty object and carry on.
        try:
            raw = store.read_text(encoding="utf-8")
        except FileNotFoundError:
            return {}
        except OSError:
            return {}
        try:
            data = json.loads(raw)
        except ValueError:
            # A corrupt file is treated as no history rather than propagated:
            # losing the record is bad, but refusing to start is worse.
            return {}
        return data if isinstance(data, dict) else {}

    @router.put("/progress")
    async def write_progress(request: Request) -> dict:
        body = await request.body()
        if len(body) > MAX_BYTES:
            raise HTTPException(status_code=413, detail="progress payload too large")
        try:
            data = json.loads(body.decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            raise HTTPException(status_code=400, detail="progress must be JSON")
        if not isinstance(data, dict):
            raise HTTPException(status_code=400, detail="progress must be a JSON object")
        try:
            _atomic_write(store, json.dumps(data, separators=(",", ":")))
        except OSError as exc:
            # Say so plainly. A save that quietly does nothing is the exact
            # failure this whole file exists to replace.
            raise HTTPException(status_code=500, detail=f"could not write progress: {exc}")
        return {"ok": True, "bytes": len(body)}

    return router


def setup(app, context: dict | None = None) -> None:
    """Entry point the host calls to mount this plugin's routes."""
    app.include_router(build_router(context))
