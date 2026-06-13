# -*- coding: utf-8 -*-
"""
QwenPaw Environment Config Plugin — Backend
=============================================
Manages shell/python scripts & schemes (collections of scripts) for
one-click environment configuration in Docker QwenPaw deployments.

Data is persisted under ~/.qwenpaw/env-config/ (volume-mapped).
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import AsyncGenerator, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

logger = logging.getLogger(__name__)

# ── Paths ─────────────────────────────────────────────────────────────────

PLUGIN_DIR = Path(__file__).parent.resolve()

LEGACY_DATA_DIR = Path.home() / ".qwenpaw" / "env-config"
DATA_DIR = PLUGIN_DIR / "data"
SCHEMES_DIR = DATA_DIR / "schemes"
SCRIPTS_DIR = DATA_DIR / "scripts"
USER_SCHEMES_DIR = Path(__file__).parent.resolve().parent.resolve() / "env-config-userdata/schemes"
USER_SCRIPTS_DIR = Path(__file__).parent.resolve().parent.resolve() / "env-config-userdata/scripts"


router = APIRouter(tags=["env-config"])

# ── Data models ───────────────────────────────────────────────────────────


class ScriptParam(BaseModel):
    type: str = "text"
    label: str = ""
    required: bool = False
    default: str = ""
    options: list[str] = []


class Script(BaseModel):
    id: str
    name: str
    description: str = ""
    type: str = "shell"
    code: str = ""
    params: dict[str, ScriptParam] = {}
    tags: list[str] = []
    os: str = ""
    readonly: bool = False


# Required for forward-reference resolution
Script.model_rebuild()


class Scheme(BaseModel):
    id: str
    name: str
    description: str = ""
    steps: list[dict] = []  # list of {script_id, params?}


class ExecuteRequest(BaseModel):
    script_id: Optional[str] = None
    scheme_id: Optional[str] = None
    params: dict[str, str] = {}
    step_params: dict[str, dict[str, str]] = {}
    code: Optional[str] = None  # Override script code (for edit-before-run)


# ── Persistence helpers ───────────────────────────────────────────────────


def _ensure_dirs():
    USER_SCRIPTS_DIR.mkdir(parents=True, exist_ok=True)
    USER_SCHEMES_DIR.mkdir(parents=True, exist_ok=True)

    # Migrate legacy data from ~/.qwenpaw/env-config to the plugin data folder.
    if LEGACY_DATA_DIR.is_dir():
        migrated = False
        for sub in ("scripts", "schemes"):
            src = LEGACY_DATA_DIR / sub
            dst = DATA_DIR / sub
            if src.is_dir():
                shutil.copytree(src, dst, dirs_exist_ok=True)
                migrated = True
        if migrated:
            logger.info("Migrated Environment Config data from %s to %s", LEGACY_DATA_DIR, DATA_DIR)


_ensure_dirs()


def _load_scripts_from_dir(directory: Path) -> list[Script]:
    scripts = []
    if not directory.is_dir():
        return scripts
    for f in sorted(directory.iterdir()):
        if f.suffix == ".json":
            try:
                data = json.loads(f.read_text(encoding="utf-8"))
                data["readonly"] = data.get("readonly", False)
                # Coerce params - ensure default is string
                params = {}
                for k, v in data.get("params", {}).items():
                    if isinstance(v, dict):
                        v["default"] = str(v.get("default", ""))
                        params[k] = ScriptParam(**v)
                    else:
                        params[k] = ScriptParam()
                data["params"] = params
                scripts.append(Script(**data))
            except Exception as e:
                logger.warning("Failed to load script %s: %s", f, e)
    return scripts


def _load_all_scripts() -> list[Script]:
    builtin = _load_scripts_from_dir(SCRIPTS_DIR)
    user = _load_scripts_from_dir(USER_SCRIPTS_DIR)
    # User scripts override builtin with same id
    ids = {s.id for s in user}
    return user + [s for s in builtin if s.id not in ids]


def _find_script(script_id: str) -> Optional[Script]:
    for s in _load_all_scripts():
        if s.id == script_id:
            return s
    return None


def _load_schemes() -> list[dict]:
    schemes = []
    if not USER_SCHEMES_DIR.is_dir():
        return schemes
    for f in sorted(USER_SCHEMES_DIR.iterdir()):
        if f.suffix == ".json":
            try:
                data = json.loads(f.read_text(encoding="utf-8"))
                schemes.append(data)
            except Exception as e:
                logger.warning("Failed to load scheme %s: %s", f, e)
    return schemes


def _save_scheme(data: dict):
    USER_SCHEMES_DIR.mkdir(parents=True, exist_ok=True)
    path = USER_SCHEMES_DIR / f"{data['id']}.json"
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")


def _delete_scheme(scheme_id: str) -> bool:
    path = USER_SCHEMES_DIR / f"{scheme_id}.json"
    if path.exists():
        path.unlink()
        return True
    return False


def _save_user_script(script: Script):
    USER_SCRIPTS_DIR.mkdir(parents=True, exist_ok=True)
    path = USER_SCRIPTS_DIR / f"{script.id}.json"
    path.write_text(json.dumps(script.model_dump(), indent=2, ensure_ascii=False), encoding="utf-8")
    # Verify by reading back
    saved = json.loads(path.read_text(encoding="utf-8"))
    params_keys = list(saved.get("params", {}).keys())
    logger.info(f"[EnvConfig] _save_user_script wrote {script.id}: params_keys={params_keys}, code_len={len(saved.get('code', ''))}")


def _delete_user_script(script_id: str) -> bool:
    path = USER_SCRIPTS_DIR / f"{script_id}.json"
    if path.exists():
        path.unlink()
        return True
    return False


# ── Parameter substitution ────────────────────────────────────────────────


def _substitute_params(code: str, params: dict[str, str]) -> str:
    """Replace {{VAR}} placeholders with actual values."""
    import re
    return re.sub(r"\{\{(\w+)\}\}", lambda m: params.get(m.group(1), m.group(0)), code)


# ── Script execution ──────────────────────────────────────────────────────


async def _run_command(code: str, script_type: str) -> AsyncGenerator[dict, None]:
    """Run shell or python code and yield output lines."""
    suffix = ".sh" if script_type == "shell" else ".py"
    with tempfile.NamedTemporaryFile(mode="w", suffix=suffix, delete=False) as f:
        f.write(code)
        tmp_path = f.name
    os.chmod(tmp_path, 0o755)

    interpreter = ["bash", tmp_path] if script_type == "shell" else ["python3", tmp_path]

    try:
        proc = await asyncio.create_subprocess_exec(
            *interpreter,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )

        async def _read_stream(stream, stream_type: str):
            while True:
                line = await stream.readline()
                if not line:
                    break
                yield {"type": stream_type, "line": line.decode("utf-8", errors="replace").rstrip()}

        async for item in _read_stream(proc.stdout, "stdout"):
            yield item
        async for item in _read_stream(proc.stderr, "stderr"):
            yield item

        rc = await proc.wait()
        yield {"type": "exit", "code": rc}
    except Exception as e:
        yield {"type": "error", "line": str(e)}
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass


async def _execute_scheme(scheme_id: str, params: dict[str, str], step_params: Optional[dict[str, dict[str, str]]] = None):
    """Execute a scheme step by step, yielding SSE events."""
    step_params = step_params or {}
    schemes = _load_schemes()
    scheme = next((s for s in schemes if s["id"] == scheme_id), None)
    if not scheme:
        yield {"type": "error", "message": f"Scheme '{scheme_id}' not found"}
        return

    yield {"type": "info", "message": f"Starting scheme: {scheme.get('name', scheme_id)} ({len(scheme['steps'])} steps)"}

    for i, step in enumerate(scheme["steps"]):
        script_id = step["script_id"] if isinstance(step, dict) else step
        scheme_step_params = step.get("params", {}) if isinstance(step, dict) else {}
        ui_step_params = step_params.get(str(i), {}) or step_params.get(script_id, {})

        script = _find_script(script_id)
        if not script:
            yield {"type": "error", "step": script_id, "line": f"Script '{script_id}' not found, skipping"}
            continue

        merged_params = {**params, **scheme_step_params, **ui_step_params}
        code = _substitute_params(script.code, merged_params)

        yield {"type": "info", "step": script.id, "line": f"▶ Step {i+1}: {script.name}"}

        async for line in _run_command(code, script.type):
            line["step"] = script.id
            yield line
            # Stop on error
            if line.get("type") == "exit" and line.get("code", 0) != 0:
                yield {"type": "error", "step": script.id, "line": f"❌ Failed with exit code {line['code']}"}
                break

    yield {"type": "complete"}


# ── API Endpoints ─────────────────────────────────────────────────────────


@router.get("/scripts", summary="List all scripts")
def list_scripts():
    return _load_all_scripts()


@router.get("/scripts/{script_id}", summary="Get script detail")
def get_script(script_id: str):
    script = _find_script(script_id)
    if not script:
        raise HTTPException(404, f"Script '{script_id}' not found")
    return script


@router.post("/scripts", summary="Create a user script")
def create_script(script: Script):
    if script.readonly:
        raise HTTPException(400, "Cannot create a read-only script")
    _save_user_script(script)
    return {"status": "ok", "id": script.id, "params_count": len(script.params), "params_keys": list(script.params.keys())}


@router.put("/scripts/{script_id}", summary="Update a user script")
def update_script(script_id: str, script: Script):
    if script.id != script_id:
        raise HTTPException(400, "ID mismatch")
    path = USER_SCRIPTS_DIR / f"{script_id}.json"
    if not path.exists():
        raise HTTPException(404, f"Script '{script_id}' not found or is read-only")
    _save_user_script(script)
    return {"status": "updated", "id": script.id}


@router.delete("/scripts/{script_id}", summary="Delete a user script")
def delete_script_endpoint(script_id: str):
    if not _delete_user_script(script_id):
        raise HTTPException(404, f"Script '{script_id}' not found")
    return {"status": "deleted", "id": script_id}


@router.get("/schemes", summary="List all schemes")
def list_schemes():
    return _load_schemes()


@router.get("/schemes/{scheme_id}", summary="Get scheme detail")
def get_scheme(scheme_id: str):
    schemes = _load_schemes()
    scheme = next((s for s in schemes if s["id"] == scheme_id), None)
    if not scheme:
        raise HTTPException(404, f"Scheme '{scheme_id}' not found")
    return scheme


@router.post("/schemes", summary="Create a scheme")
def create_scheme(data: dict):
    if "id" not in data or "name" not in data:
        raise HTTPException(400, "Scheme must have 'id' and 'name'")
    _save_scheme(data)
    return {"status": "ok", "id": data["id"]}


@router.put("/schemes/{scheme_id}", summary="Update a scheme")
def update_scheme(scheme_id: str, data: dict):
    if not _delete_scheme(scheme_id):
        raise HTTPException(404, f"Scheme '{scheme_id}' not found")
    data["id"] = scheme_id
    _save_scheme(data)
    return {"status": "updated", "id": scheme_id}


@router.delete("/schemes/{scheme_id}", summary="Delete a scheme")
def delete_scheme_endpoint(scheme_id: str):
    if not _delete_scheme(scheme_id):
        raise HTTPException(404, f"Scheme '{scheme_id}' not found")
    return {"status": "deleted", "id": scheme_id}


@router.post("/execute", summary="Execute a script or scheme (SSE stream)")
async def execute(body: ExecuteRequest):
    if bool(body.script_id) == bool(body.scheme_id):
        raise HTTPException(400, "Provide exactly one of: script_id or scheme_id")

    from fastapi.responses import StreamingResponse

    async def event_stream():
        if body.script_id:
            script = _find_script(body.script_id)
            if not script:
                yield f"data: {json.dumps({'type': 'error', 'line': f'Script {body.script_id} not found'})}\n\n"
                yield f"data: {json.dumps({'type': 'complete'})}\n\n"
                return

            code = _substitute_params(body.code if body.code is not None else script.code, body.params)
            yield f"data: {json.dumps({'type': 'info', 'line': f'▶ Running: {script.name}'})}\n\n"

            async for line_data in _run_command(code, script.type):
                line_data["script"] = script.id
                yield f"data: {json.dumps(line_data)}\n\n"

        elif body.scheme_id:
            async for event in _execute_scheme(body.scheme_id, body.params, body.step_params):
                yield f"data: {json.dumps(event)}\n\n"

        yield f"data: {json.dumps({'type': 'complete'})}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")


# ── Initialize built-in schemes ────────────────────────────────────────


def _init_builtin_schemes():
    """Create default schemes if they don't exist."""
    defaults = [
        {
            "id": "minimal",
            "name": "最小配置",
            "description": "仅更换 apt 源 + 安装 SSH 服务，适合快速远程访问。",
            "steps": [{"script_id": "apt-tsinghua"}, {"script_id": "sshd-setup"}],
        },
        {
            "id": "full-dev",
            "name": "完整开发环境",
            "description": "配置 apt 源、SSH、代理、opencode，适合开发者使用。",
            "steps": [
                {"script_id": "apt-tsinghua"},
                {"script_id": "sshd-setup"},
                {"script_id": "proxychains-setup"},
                {"script_id": "opencode-setup"},
            ],
        },
    ]
    schemes = _load_schemes()
    existing_ids = {s["id"] for s in schemes}
    for default in defaults:
        if default["id"] not in existing_ids:
            _save_scheme(default)
            logger.info("Created default scheme: %s", default["id"])


_init_builtin_schemes()


# ── Plugin entry point ───────────────────────────────────────────────────


class EnvConfigPlugin:
    """Environment Config Plugin for QwenPaw."""

    def register(self, api):
        """Register the plugin with QwenPaw."""
        logger.info("Registering Env Config plugin...")
        api.register_http_router(router, prefix="/env-config", tags=["env-config"])
        logger.info("Env Config plugin registered at /api/env-config/")


plugin = EnvConfigPlugin()
