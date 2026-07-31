const AppError = require('../utils/app-error');

class CopernicusAuth {
  constructor({ config, client, now = () => Date.now() }) {
    this.config = config;
    this.client = client;
    this.now = now;
    this.credentialIndex = 0;
    this.tokens = new Map();
  }

  hasNextCredential() {
    return this.credentialIndex + 1 < this.config.credentialSets.length;
  }

  moveToNextCredential() {
    if (!this.hasNextCredential()) return false;
    this.credentialIndex += 1;
    return true;
  }

  resetCredentials() {
    this.credentialIndex = 0;
  }

  invalidateCurrentToken() {
    this.tokens.delete(this.credentialIndex);
  }

  async getAccessToken({ forceRefresh = false } = {}) {
    if (this.config.accessToken) return this.config.accessToken;
    if (!this.config.credentialSets.length) {
      throw new AppError(
        'Copernicus authentication requires COPERNICUS_ACCESS_TOKEN or a client ID/client secret pair',
        503,
        'COPERNICUS_AUTH_MISSING'
      );
    }

    if (!forceRefresh) {
      const cached = this.tokens.get(this.credentialIndex);
      if (cached && cached.expiresAt > this.now() + 30000) return cached.value;
    }
    return this.requestTokenWithFallback();
  }

  async requestTokenWithFallback() {
    let lastStatus = null;
    while (this.credentialIndex < this.config.credentialSets.length) {
      const credentials = this.config.credentialSets[this.credentialIndex];
      const form = new URLSearchParams();
      form.set('grant_type', 'client_credentials');
      form.set('client_id', credentials.clientId);
      form.set('client_secret', credentials.clientSecret);

      let response;
      try {
        response = await this.client.post(this.config.tokenUrl, form.toString(), {
          headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
          validateStatus: () => true
        });
      } catch (error) {
        lastStatus = error.code || 'network_error';
        if (this.moveToNextCredential()) continue;
        throw new AppError(`Copernicus token request failed: ${error.message}`, 502, 'COPERNICUS_AUTH_ERROR', { retryable: true });
      }

      lastStatus = response.status;
      if (response.status === 200 && response.data && response.data.access_token) {
        const expiresIn = Math.max(Number(response.data.expires_in || 300), 60);
        this.tokens.set(this.credentialIndex, {
          value: response.data.access_token,
          expiresAt: this.now() + expiresIn * 1000
        });
        return response.data.access_token;
      }
      if (!this.moveToNextCredential()) break;
    }

    throw new AppError(
      `Copernicus authentication failed for all configured credential sets (${lastStatus})`,
      502,
      'COPERNICUS_AUTH_ERROR',
      { retryable: lastStatus === 429 || Number(lastStatus) >= 500 }
    );
  }
}

module.exports = CopernicusAuth;
