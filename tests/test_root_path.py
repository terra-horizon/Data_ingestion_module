import json
import os
from pathlib import Path
import shutil
import subprocess

import httpx
import pytest

from app.main import app


ROOT = Path(__file__).resolve().parents[1]
PREFIX = "/terra/data-ingestion"


@pytest.mark.asyncio
@pytest.mark.parametrize("root_path", ["", PREFIX])
async def test_proxy_root_path(root_path, monkeypatch):
    # FastAPI caches the generated schema and advertised servers on the app.
    monkeypatch.setattr(app, "openapi_schema", None)
    monkeypatch.setattr(app, "servers", [])
    scopes = []

    async def capture(scope, receive, send):
        scopes.append(scope)
        await app(scope, receive, send)

    transport = httpx.ASGITransport(app=capture, root_path=root_path)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        assert (await client.get("/health/live")).json() == {"status": "ok"}
        docs = await client.get("/docs")
        schema_response = await client.get("/openapi.json")
        # Validation rejects the empty request without executing an ingestion profile.
        assert (await client.post("/api/ingestion/run", json={})).status_code == 422

    assert app.root_path == ""
    assert all(scope["root_path"] == root_path for scope in scopes)
    assert docs.status_code == schema_response.status_code == 200
    assert f"url: '{root_path}/openapi.json'" in docs.text
    schema = schema_response.json()
    assert schema.get("servers", []) == ([{"url": root_path}] if root_path else [])
    for path in ("/health/live", "/health/ready", "/health/ready/coastal-uc3-sentinel2", "/api/ingestion/run", "/api/ingestion/satellite/jobs/{job_id}"):
        assert path in schema["paths"]
    assert not any(path.startswith(PREFIX) for path in schema["paths"])
    assert PREFIX + PREFIX not in docs.text
    if not root_path:
        assert PREFIX not in docs.text
        assert PREFIX not in json.dumps(schema)


@pytest.mark.parametrize("file_value,shell_value,expected", [
    ("", None, ""),
    (PREFIX, None, PREFIX),
    ("", PREFIX, PREFIX),
])
def test_compose_root_path(tmp_path, file_value, shell_value, expected):
    if not shutil.which("docker"):
        pytest.skip("Docker Compose is unavailable")
    env_file = tmp_path / "interpolation.env"
    env_file.write_text(f"APP_ROOT_PATH={file_value}\n", encoding="utf-8")
    env = os.environ.copy()
    env.pop("APP_ROOT_PATH", None)
    if shell_value is not None:
        env["APP_ROOT_PATH"] = shell_value
    result = subprocess.run(
        ["docker", "compose", "--project-directory", str(ROOT), "--env-file", str(env_file),
         "-f", str(ROOT / "docker-compose.yml"), "config", "--no-env-resolution", "--format", "json"],
        capture_output=True, text=True, env=env, check=True,
    )
    config = json.loads(result.stdout)
    service = config["services"]["data-ingestion-module"]
    assert service["command"] == ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--root-path", expected]
    assert service["ports"] == [{"host_ip": "127.0.0.1", "mode": "ingress", "target": 8000, "published": "18000", "protocol": "tcp"}]
    assert set(service["networks"]) == {"terra-network"}
    assert config["networks"]["terra-network"]["external"] is True
    assert config["networks"]["terra-network"]["name"] == "terra-network"
