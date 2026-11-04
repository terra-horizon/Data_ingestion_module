from datetime import datetime, timezone
from hashlib import sha256
import httpx
import pytest
from app.adapters.collector import CollectorConfigurationError, CollectorUnavailableError
from app.adapters.uc1 import run_uc1_river_adapter, run_uc1_sea_adapter, run_uc1_water_pollutants_adapter
from app.schemas.ingestion import IngestionRunRequest
from app.services.ingestion import PROFILE_RUNNERS

REQUEST = {"run_job_id": "overall", "triggered_at": "2026-11-03T07:00:00Z", "provider": "sentinel-2", "profile": "uc1-sperchios-river", "aoi_id": "sperchios", "bbox": [22, 38, 23, 39]}

@pytest.fixture
def settings(monkeypatch):
    for key, value in {"UC1_COLLECTOR_BASE_URL": "https://collector.test/prefix", "UC1_COLLECTOR_API_KEY": "secret1", "UC1_HYDRO_BASE_URL": "https://hydro.test/prefix", "UC1_HYDRO_API_KEY": "secret2", "UC1_SPERCHIOS_ANALYSIS_AREA_ID": "river", "UC1_SPERCHIOS_MARINE_ANALYSIS_AREA_ID": "sea"}.items():
        monkeypatch.setenv(key, value)

@pytest.mark.parametrize("profile", ["uc1-water-pollutants-collector", "uc1-sperchios-river", "uc1-sperchios-sea", "coastal-uc3-sentinel2", "forecaster-collector"])
def test_profiles(profile):
    data = {**REQUEST, "profile": profile}
    if profile == "forecaster-collector": data["run_name"] = "test"
    if profile == "coastal-uc3-sentinel2": data["uc3"] = {"contract_version": 2, "mode": "window", "time_from": "2026-01-01T00:00:00Z", "time_to": "2026-01-02T00:00:00Z"}
    assert IngestionRunRequest.model_validate(data).profile == profile
    assert profile in PROFILE_RUNNERS

def test_unknown_profile():
    with pytest.raises(ValueError): IngestionRunRequest.model_validate({**REQUEST, "profile": "unknown"})

@pytest.mark.parametrize("profile", ["satellite", "river", "sea"])
def test_exact_calls_and_payloads(settings, monkeypatch, profile):
    # Each profile can run without the other service's configuration.
    for name in (["UC1_HYDRO_BASE_URL", "UC1_HYDRO_API_KEY", "UC1_SPERCHIOS_ANALYSIS_AREA_ID", "UC1_SPERCHIOS_MARINE_ANALYSIS_AREA_ID"] if profile == "satellite" else ["UC1_COLLECTOR_BASE_URL", "UC1_COLLECTOR_API_KEY"]):
        monkeypatch.delenv(name)
    calls = []
    def request(self, method, url, **kwargs):
        calls.append((method, url, kwargs))
        path = httpx.URL(url).path
        if path.endswith('/jobs'): body = {"job_id": "job", "status": "queued", "extra": 1}
        elif path.endswith('/river-analyses/river'): body = {"analysis_area_id": "river", "extra": 2}
        elif path.endswith('/marine-analyses'): body = {"count": 2, "analyses": [{"marine_analysis_area_id": "other", "river_analysis_area_id": "river"}, {"marine_analysis_area_id": "sea", "river_analysis_area_id": "river", "extra": 3}], "metadata": "preserved"}
        else: body = {"status": "success", "dataset": "test", "extra": 4, **({"marine_analysis_area_id": "sea"} if profile == 'sea' else {"analysis_area_id": "river"})}
        return httpx.Response(202 if path.endswith('/jobs') else 200, json=body)
    monkeypatch.setattr(httpx.Client, 'request', request)
    runner = {'satellite': run_uc1_water_pollutants_adapter, 'river': run_uc1_river_adapter, 'sea': run_uc1_sea_adapter}[profile]
    result = runner(REQUEST)
    assert result['status'] == 'success'
    expected = {'satellite': [('POST', '/api/collection/jobs')], 'river': [('GET', '/static/river-analyses/river'), ('POST', '/data-ingestion/ecmwf/reanalysis'), ('POST', '/data-ingestion/ecmwf/local-forecast')], 'sea': [('GET', '/static/marine-analyses'), ('POST', '/data-ingestion/ifs')]}
    assert [(method, url.split('/prefix')[-1]) for method, url, _ in calls] == expected[profile]
    today = datetime.now(timezone.utc).date().isoformat()
    if profile == 'satellite':
        assert calls[0][2]['json'] == {'run_job_id': f'uc1.collection.water-pollutants_{today}_{sha256(b"overall").hexdigest()[:24]}', 'triggered_at': REQUEST['triggered_at'], 'aoi_id': 'sperchios', 'bbox': REQUEST['bbox'], 'sensor': 'sentinel2', 'mode': 'auto'}
        assert result['satellite_collection'] == {'job_id': 'job', 'status': 'queued', 'extra': 1}
    elif profile == 'sea':
        assert calls[0][2]['params'] == {'river_analysis_area_id': 'river'}
        assert calls[1][2]['json'] == {'marine_analysis_area_id': 'sea', 'action_date': today, 'horizon_days': 6, 'source': 'ecmwf'}
        assert result['static_marine_analysis'] == {'count': 2, 'analyses': [{'marine_analysis_area_id': 'other', 'river_analysis_area_id': 'river'}, {'marine_analysis_area_id': 'sea', 'river_analysis_area_id': 'river', 'extra': 3}], 'metadata': 'preserved'}
        assert result['ifs_ingestion']['extra'] == 4
    else:
        assert calls[1][2]['json'] == {'analysis_area_id': 'river', 'action_date': today}
        assert calls[2][2]['json'] == {'analysis_area_id': 'river', 'horizon_days': 15}
        assert result['static_river_analysis']['extra'] == 2
        assert result['ecmwf_reanalysis']['extra'] == result['ecmwf_local_forecast']['extra'] == 4

@pytest.mark.parametrize('failure', ['timeout', 'auth', 'missing', 'invalid', 'intermediate'])
def test_failures_stop_and_preserve(settings, monkeypatch, failure):
    calls = []
    def request(self, method, url, **kwargs):
        calls.append(url)
        if len(calls) == 1:
            if failure == 'timeout': raise httpx.ReadTimeout('private')
            if failure == 'auth': return httpx.Response(401)
            if failure == 'missing': return httpx.Response(404)
            if failure == 'invalid': return httpx.Response(200, text='not json')
            return httpx.Response(200, json={'analysis_area_id': 'river'})
        return httpx.Response(500)
    monkeypatch.setattr(httpx.Client, 'request', request)
    if failure == 'timeout':
        with pytest.raises(CollectorUnavailableError): run_uc1_river_adapter(REQUEST)
    elif failure in ('auth', 'missing'):
        with pytest.raises(CollectorConfigurationError): run_uc1_river_adapter(REQUEST)
    elif failure == 'invalid':
        from app.adapters.collector import CollectorExecutionError
        with pytest.raises(CollectorExecutionError): run_uc1_river_adapter(REQUEST)
    else:
        result = run_uc1_river_adapter(REQUEST)
        assert result['status'] == 'partial' and result['static_river_analysis']['analysis_area_id'] == 'river'
    assert len(calls) == (2 if failure == 'intermediate' else 1)

@pytest.mark.parametrize('analyses', [[], [{'marine_analysis_area_id': 'other'}], [{'marine_analysis_area_id': 'sea'}, {'marine_analysis_area_id': 'sea'}]])
def test_marine_mismatch_stops(settings, monkeypatch, analyses):
    calls = []
    def request(self, method, url, **kwargs):
        calls.append(url)
        return httpx.Response(200, json={'count': len(analyses), 'analyses': analyses})
    monkeypatch.setattr(httpx.Client, 'request', request)
    result = run_uc1_sea_adapter(REQUEST)
    assert result['status'] == 'partial'
    assert result['static_marine_analysis'] == {'count': len(analyses), 'analyses': analyses}
    assert len(calls) == 1

def test_ca_bundle_uses_verifying_ssl_context(settings, monkeypatch):
    import ssl
    import certifi
    from app.adapters.uc1_client import Settings, UC1Client
    monkeypatch.setenv('UC1_HTTP_CA_BUNDLE', certifi.where())
    with UC1Client(Settings.from_env('river')) as client:
        context = client.client._transport._pool._ssl_context
        assert context.verify_mode == ssl.CERT_REQUIRED
        assert context.check_hostname
        assert context.cert_store_stats()['x509_ca'] > 0


def test_invalid_ca_bundle_is_configuration_error(settings, monkeypatch, tmp_path):
    from app.adapters.uc1_client import Settings, UC1Client
    monkeypatch.setenv('UC1_HTTP_CA_BUNDLE', str(tmp_path / 'missing.pem'))
    with pytest.raises(CollectorConfigurationError, match='CA bundle'):
        UC1Client(Settings.from_env('river'))


@pytest.mark.parametrize('profile,runner', [('river', run_uc1_river_adapter), ('sea', run_uc1_sea_adapter)])
def test_connection_failure_is_sanitized(settings, monkeypatch, profile, runner):
    def request(self, method, url, **kwargs):
        raise httpx.ConnectError('secret2 private connection details')
    monkeypatch.setattr(httpx.Client, 'request', request)
    with pytest.raises(CollectorUnavailableError) as exc:
        runner(REQUEST)
    assert 'secret2' not in str(exc.value)


@pytest.mark.parametrize('profile,runner', [('river', run_uc1_river_adapter), ('sea', run_uc1_sea_adapter)])
def test_http_failure_after_lookup_returns_partial(settings, monkeypatch, profile, runner):
    calls = []
    def request(self, method, url, **kwargs):
        calls.append((method, url))
        if len(calls) == 1:
            body = {'analysis_area_id': 'river', 'metadata': 'preserved'} if profile == 'river' else {'count': 1, 'analyses': [{'marine_analysis_area_id': 'sea', 'river_analysis_area_id': 'river', 'metadata': 'preserved'}]}
            return httpx.Response(200, json=body)
        return httpx.Response(503)
    monkeypatch.setattr(httpx.Client, 'request', request)
    result = runner(REQUEST)
    assert result['status'] == 'partial'
    assert result['error']['category'] == 'CollectorUnavailableError'
    assert result['error']['step'] == ('ecmwf_reanalysis' if profile == 'river' else 'ifs_ingestion')
    assert len(calls) == 2
    assert 'metadata' in str(result)


@pytest.mark.parametrize('profile,runner,body', [
    ('river', run_uc1_river_adapter, {'analysis_area_id': 'wrong'}),
    ('sea', run_uc1_sea_adapter, {'unexpected': 'object'}),
])
def test_invalid_static_response_stops(settings, monkeypatch, profile, runner, body):
    calls = []
    def request(self, method, url, **kwargs):
        calls.append(url)
        return httpx.Response(200, json=body)
    monkeypatch.setattr(httpx.Client, 'request', request)
    result = runner(REQUEST)
    assert result['status'] == 'partial'
    assert len(calls) == 1


@pytest.mark.asyncio
@pytest.mark.parametrize('profile', ['uc1-sperchios-river', 'uc1-sperchios-sea'])
async def test_endpoint_aggregates_mocked_responses(settings, monkeypatch, profile):
    from app.main import app
    def request(self, method, url, **kwargs):
        path = httpx.URL(url).path
        if path.endswith('/river-analyses/river'): body = {'analysis_area_id': 'river', 'extra': 1}
        elif path.endswith('/marine-analyses'): body = {'count': 1, 'analyses': [{'marine_analysis_area_id': 'sea', 'river_analysis_area_id': 'river', 'extra': 2}]}
        else: body = {'status': 'success', 'dataset': 'test', 'extra': 3, **({'marine_analysis_area_id': 'sea'} if profile.endswith('sea') else {'analysis_area_id': 'river'})}
        return httpx.Response(200, json=body)
    monkeypatch.setattr(httpx.Client, 'request', request)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
        response = await client.post('/api/ingestion/run', json={**REQUEST, 'profile': profile})
    assert response.status_code == 200
    body = response.json()
    assert body['run_job_id'] == REQUEST['run_job_id'] and body['status'] == 'success'
    assert set(body['collector_result']) == ({'status', 'static_marine_analysis', 'ifs_ingestion'} if profile.endswith('sea') else {'status', 'static_river_analysis', 'ecmwf_reanalysis', 'ecmwf_local_forecast'})

@pytest.mark.asyncio
async def test_standalone_hydro_routes_removed():
    from app.main import app
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
        for method, path in [
            ('GET', '/api/hydro-modeling/ecmwf/reanalysis-availability'),
            ('POST', '/api/hydro-modeling/ecmwf/reanalysis'),
            ('POST', '/api/hydro-modeling/ecmwf/local-forecast'),
            ('POST', '/api/hydro-modeling/ifs'),
        ]:
            response = await client.request(method, path)
            assert response.status_code == 404
    assert '/api/ingestion/run' in app.openapi()['paths']

@pytest.mark.asyncio
async def test_satellite_options_and_unique_stable_job_ids(settings, monkeypatch):
    from app.main import app
    calls = []
    def request(self, method, url, **kwargs):
        calls.append(kwargs['json'])
        return httpx.Response(202, json={'job_id': 'job', 'status': 'queued', 'metadata': {'keep': True}})
    monkeypatch.setattr(httpx.Client, 'request', request)
    payload = {**REQUEST, 'profile': 'uc1-water-pollutants-collector', 'sensor': 'sentinel2', 'mode': 'backfill', 'history_start': '2026-01-01', 'target_date': '2026-10-01', 'max_days_per_run': 2, 'max_tiles_per_run': 3, 'discovery_chunk_days': 4, 'max_cloud_coverage': 20}
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
        for run in ('one', 'one', 'two'):
            response = await client.post('/api/ingestion/run', json={**payload, 'run_job_id': run})
            assert response.status_code == 200
            assert response.json()['collector_result']['satellite_collection']['metadata'] == {'keep': True}
    assert calls[0] == calls[1]
    assert calls[0]['run_job_id'] != calls[2]['run_job_id']
    for key in ('sensor', 'mode', 'history_start', 'target_date', 'max_days_per_run', 'max_tiles_per_run', 'discovery_chunk_days', 'max_cloud_coverage'):
        assert calls[0][key] == payload[key]
    assert set(calls[0]) == {'run_job_id', 'triggered_at', 'aoi_id', 'bbox', 'sensor', 'mode', 'history_start', 'target_date', 'max_days_per_run', 'max_tiles_per_run', 'discovery_chunk_days', 'max_cloud_coverage'}

@pytest.mark.parametrize('status', [400, 401, 403, 404, 422, 500, 503])
def test_upstream_http_errors(settings, monkeypatch, status):
    from app.adapters.collector import CollectorAdapterError
    calls = []
    def request(self, method, url, **kwargs):
        calls.append(url)
        return httpx.Response(status, json={'detail': 'secret2'})
    monkeypatch.setattr(httpx.Client, 'request', request)
    with pytest.raises(CollectorAdapterError) as exc:
        run_uc1_river_adapter(REQUEST)
    assert 'secret2' not in str(exc.value)
    assert len(calls) == 1

@pytest.mark.parametrize('analyses', [
    [{'marine_analysis_area_id': 'sea', 'river_analysis_area_id': 'wrong'}],
    [{'marine_analysis_area_id': 'sea', 'river_analysis_area_id': 'river'}, {'marine_analysis_area_id': 'sea', 'river_analysis_area_id': 'wrong'}],
])
def test_inconsistent_marine_association_stops(settings, monkeypatch, analyses):
    calls = []
    def request(self, method, url, **kwargs):
        calls.append(url)
        return httpx.Response(200, json={'count': len(analyses), 'analyses': analyses})
    monkeypatch.setattr(httpx.Client, 'request', request)
    result = run_uc1_sea_adapter(REQUEST)
    assert result['status'] == 'partial' and result['static_marine_analysis'] == {'count': len(analyses), 'analyses': analyses}
    assert len(calls) == 1

@pytest.mark.parametrize('name', ['UC1_HYDRO_BASE_URL', 'UC1_HYDRO_API_KEY', 'UC1_SPERCHIOS_ANALYSIS_AREA_ID'])
def test_missing_required_config_before_requests(settings, monkeypatch, name):
    monkeypatch.delenv(name)
    with pytest.raises(CollectorConfigurationError):
        run_uc1_river_adapter(REQUEST)

@pytest.mark.parametrize('status', ['failed', 'error'])
def test_ingestion_failure_stops_forecast(settings, monkeypatch, status):
    calls = []
    def request(self, method, url, **kwargs):
        calls.append(url)
        body = {'analysis_area_id': 'river'} if len(calls) == 1 else {'analysis_area_id': 'river', 'dataset': 'test', 'status': status}
        return httpx.Response(200, json=body)
    monkeypatch.setattr(httpx.Client, 'request', request)
    result = run_uc1_river_adapter(REQUEST)
    assert result['status'] == 'partial' and result['error']['step'] == 'ecmwf_reanalysis'
    assert result['ecmwf_reanalysis']['status'] == status and len(calls) == 2

@pytest.mark.parametrize('body', [{'job_id': 'job', 'status': 'failed'}, {'status': 'queued'}, [], {'job_id': 'job', 'status': 'unknown'}])
def test_invalid_satellite_submission(settings, monkeypatch, body):
    from app.adapters.collector import CollectorExecutionError
    monkeypatch.setattr(httpx.Client, 'request', lambda *args, **kwargs: httpx.Response(202, json=body))
    with pytest.raises(CollectorExecutionError):
        run_uc1_water_pollutants_adapter(REQUEST)

@pytest.mark.parametrize('body', [
    {},
    {'count': 0},
    {'count': 0, 'analyses': None},
    {'count': 1, 'analyses': []},
    {'count': 0, 'analyses': [{}]},
    {'count': True, 'analyses': [{}]},
    {'count': '1', 'analyses': [{}]},
    {'count': 1, 'analyses': ['invalid']},
    {'count': 1, 'analyses': [{'marine_analysis_area_id': 'sea'}]},
    [],
])
def test_invalid_marine_envelope_stops_ifs(settings, monkeypatch, body):
    calls = []
    def request(self, method, url, **kwargs):
        calls.append((method, url))
        return httpx.Response(200, json=body)
    monkeypatch.setattr(httpx.Client, 'request', request)
    result = run_uc1_sea_adapter(REQUEST)
    assert result['status'] == 'partial'
    assert result['error']['step'] == 'static_marine_analysis'
    assert result['static_marine_analysis'] == body
    assert len(calls) == 1
