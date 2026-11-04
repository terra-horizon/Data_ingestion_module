import httpx
import pytest
from app.main import app
from app.services.health import check_readiness

@pytest.fixture
def config(monkeypatch):
    monkeypatch.setenv('UC1_COLLECTOR_BASE_URL', 'https://collector.test')
    monkeypatch.setenv('UC1_COLLECTOR_API_KEY', 'secret')

@pytest.mark.asyncio
async def test_liveness():
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
        assert (await client.get('/health/live')).json() == {'status': 'ok'}

@pytest.mark.parametrize('body,expected', [
    ({'status': 'ready', 'checks': {'configuration': 'ok', 'mongodb': 'ok', 'minio': 'ok', 'worker': 'ok'}}, 'ready'),
    ({'status': 'ready', 'checks': {'configuration': 'ok'}}, 'not_ready'),
    ({'status': 'not_ready', 'checks': {}}, 'not_ready'),
])
def test_remote_readiness(config, monkeypatch, body, expected):
    calls = []
    def request(self, method, url, **kwargs):
        calls.append((method, url, kwargs))
        return httpx.Response(200, json=body)
    monkeypatch.setattr(httpx.Client, 'request', request)
    assert check_readiness().status == expected
    assert len(calls) == 1 and calls[0][0:2] == ('GET', 'https://collector.test/health/ready')
    assert calls[0][2]['headers']['X-API-Key'] == 'secret'

@pytest.mark.parametrize('error', [httpx.ReadTimeout('secret'), httpx.ConnectError('secret')])
def test_readiness_unavailable(config, monkeypatch, error):
    def request(*args, **kwargs): raise error
    monkeypatch.setattr(httpx.Client, 'request', request)
    result = check_readiness()
    assert result.status == 'not_ready' and result.checks.collector == 'unavailable'
    assert 'secret' not in str(result)

def test_readiness_missing_config(monkeypatch):
    monkeypatch.delenv('UC1_COLLECTOR_API_KEY', raising=False)
    result = check_readiness()
    assert result.status == 'not_ready' and result.checks.configuration == 'unavailable'

@pytest.mark.asyncio
async def test_readiness_http_status(config, monkeypatch):
    monkeypatch.setattr(httpx.Client, 'request', lambda *a, **kw: httpx.Response(503))
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
        response = await client.get('/health/ready')
    assert response.status_code == 503
    assert response.json()['checks'] == {'configuration': 'ok', 'collector': 'unavailable'}
