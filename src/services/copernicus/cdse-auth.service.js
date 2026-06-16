const AppError = require('../../utils/app-error');
const env = require('../../config/env');
const { httpClient } = require('../../utils/http-client');

class CdseAuthService {
  constructor(options = {}) {
    this.httpClient = options.httpClient || httpClient;
    this.tokenUrl = options.tokenUrl || env.copernicus.tokenUrl;
    this.staticAccessToken = options.accessToken || env.copernicus.accessToken;
    this.credentialSets = (options.credentialSets || env.copernicus.credentialSets)
      .filter((credential) => credential.clientId && credential.clientSecret);
    this.currentCredentialIndex = 0;
    this.tokenCache = new Map();
  }

  hasBackupCredentials() {
    return this.credentialSets.length > 1;
  }

  currentCredential() {
    const credential = this.credentialSets[this.currentCredentialIndex];

    if (!credential) {
      throw new AppError('CDSE credentials are not configured', 503, 'COPERNICUS_AUTH_MISSING');
    }

    return credential;
  }

  async getAccessToken(options = {}) {
    if (this.staticAccessToken) {
      return this.staticAccessToken;
    }

    const credential = this.currentCredential();
    const cacheKey = this.currentCredentialIndex;
    const cached = this.tokenCache.get(cacheKey);

    if (!options.forceRefresh && cached && cached.expiresAt > Date.now() + 30000) {
      return cached.accessToken;
    }

    const form = new URLSearchParams();
    form.set('grant_type', 'client_credentials');
    form.set('client_id', credential.clientId);
    form.set('client_secret', credential.clientSecret);

    let response;
    try {
      response = await this.httpClient.post(this.tokenUrl, form.toString(), {
        timeout: env.requestTimeoutMs,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        validateStatus: () => true
      });
    } catch (error) {
      if (error.code === 'ECONNABORTED') {
        throw new AppError('CDSE token request timed out', 504, 'EXTERNAL_PROVIDER_TIMEOUT', {
          provider: 'cdse',
          retryable: true
        });
      }

      throw new AppError('CDSE token request failed', 502, 'COPERNICUS_AUTH_ERROR', {
        provider: 'cdse',
        retryable: true
      });
    }

    if (response.status !== 200) {
      throw new AppError(`CDSE token request failed with status ${response.status}`, 502, 'COPERNICUS_AUTH_ERROR', {
        provider: 'cdse',
        retryable: response.status >= 500 || response.status === 429
      });
    }

    const accessToken = response.data && response.data.access_token;

    if (!accessToken) {
      throw new AppError('CDSE token response did not include access_token', 502, 'INVALID_PROVIDER_RESPONSE', {
        provider: 'cdse',
        retryable: false
      });
    }

    const expiresInMs = Number(response.data.expires_in || 300) * 1000;
    this.tokenCache.set(cacheKey, {
      accessToken,
      expiresAt: Date.now() + expiresInMs
    });

    return accessToken;
  }

  rotateCredential() {
    if (this.currentCredentialIndex + 1 >= this.credentialSets.length) {
      return false;
    }

    this.currentCredentialIndex += 1;
    return true;
  }

  clearCurrentToken() {
    this.tokenCache.delete(this.currentCredentialIndex);
  }
}

module.exports = CdseAuthService;
