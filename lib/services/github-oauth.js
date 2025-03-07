/**
 * GitHub OAuth authentication using device flow
 */

const fetch = require('node-fetch');
const open = require('open');
const keytar = require('keytar');
const logger = require('../utils/logger');

// GitHub OAuth configuration
const OAUTH_CONFIG = {
  clientId: process.env.GITHUB_CLIENT_ID  
  tokenUrl: 'https://github.com/login/oauth/access_token',
  deviceUrl: 'https://github.com/login/device/code',
  scope: 'repo workflow',
  serviceName: 'static-site-creator-oauth'
};

/**
 * Start device flow authentication
 * @returns {Promise<string>} - GitHub username after successful authentication
 */
async function authenticate() {
  try {
    logger.info('Starting GitHub authentication...');
    
    // Step 1: Request device and user code
    const deviceCodeResponse = await fetch(OAUTH_CONFIG.deviceUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        client_id: OAUTH_CONFIG.clientId,
        scope: OAUTH_CONFIG.scope
      })
    });
    
    if (!deviceCodeResponse.ok) {
      throw new Error(`Failed to get device code: ${deviceCodeResponse.statusText}`);
    }
    
    const deviceData = await deviceCodeResponse.json();
    const {
      device_code,
      user_code,
      verification_uri,
      expires_in,
      interval
    } = deviceData;
    
    // Step 2: Prompt user to authenticate
    logger.info(`\nTo authenticate with GitHub, please visit:\n${verification_uri}`);
    logger.info(`And enter this code: ${user_code}\n`);
    
    // Try to open the browser automatically
    try {
      await open(verification_uri);
      logger.info('Browser opened automatically. Please enter the code shown above.');
    } catch (error) {
      logger.info('Please open the URL in your browser manually.');
    }
    
    // Step 3: Poll for user authentication
    const startTime = Date.now();
    const expiresAt = startTime + (expires_in * 1000);
    
    // Start polling
    let authenticated = false;
    let authData = null;
    
    while (!authenticated && Date.now() < expiresAt) {
      await new Promise(resolve => setTimeout(resolve, interval * 1000));
      
      const tokenResponse = await fetch(OAUTH_CONFIG.tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({
          client_id: OAUTH_CONFIG.clientId,
          device_code: device_code,
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
        })
      });
      
      const tokenData = await tokenResponse.json();
      
      if (tokenData.error) {
        if (tokenData.error === 'authorization_pending') {
          // User hasn't authorized yet, continue polling
          logger.info('Waiting for authorization...');
        } else if (tokenData.error === 'slow_down') {
          // GitHub asks us to slow down polling
          interval += 5;
        } else if (tokenData.error === 'expired_token') {
          throw new Error('Device code expired. Please try again.');
        } else {
          throw new Error(`Authentication error: ${tokenData.error_description}`);
        }
      } else {
        // Successfully authenticated
        authenticated = true;
        authData = tokenData;
      }
    }
    
    if (!authenticated) {
      throw new Error('Authentication timed out. Please try again.');
    }
    
    // Step 4: Get user info to match with token
    const userResponse = await fetch('https://api.github.com/user', {
      headers: {
        'Authorization': `token ${authData.access_token}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    });
    
    if (!userResponse.ok) {
      throw new Error(`Failed to get user info: ${userResponse.statusText}`);
    }
    
    const userData = await userResponse.json();
    
    // Step 5: Store tokens securely
    await keytar.setPassword(
      OAUTH_CONFIG.serviceName,
      userData.login,
      JSON.stringify({
        access_token: authData.access_token,
        refresh_token: authData.refresh_token,
        expires_at: authData.expires_in ? Date.now() + (authData.expires_in * 1000) : null
      })
    );
    
    logger.succeed(`Successfully authenticated as ${userData.login}`);
    return userData.login;
  } catch (error) {
    logger.error(`Authentication failed: ${error.message}`);
    throw error;
  }
}

/**
 * Get GitHub access token for a user
 * @param {string} username - GitHub username
 * @returns {Promise<string|null>} - Access token or null if not found
 */
async function getAccessToken(username) {
  try {
    const tokenStr = await keytar.getPassword(OAUTH_CONFIG.serviceName, username);
    if (!tokenStr) return null;
    
    const tokenData = JSON.parse(tokenStr);
    
    // Check if token needs refresh
    if (tokenData.expires_at && Date.now() > tokenData.expires_at && tokenData.refresh_token) {
      logger.info('Access token expired. Refreshing...');
      
      const refreshResponse = await fetch(OAUTH_CONFIG.tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({
          client_id: OAUTH_CONFIG.clientId,
          refresh_token: tokenData.refresh_token,
          grant_type: 'refresh_token'
        })
      });
      
      if (!refreshResponse.ok) {
        logger.warn('Failed to refresh token. Re-authentication required.');
        return null;
      }
      
      const refreshData = await refreshResponse.json();
      
      // Update stored token
      const newTokenData = {
        access_token: refreshData.access_token,
        refresh_token: refreshData.refresh_token || tokenData.refresh_token,
        expires_at: refreshData.expires_in ? Date.now() + (refreshData.expires_in * 1000) : null
      };
      
      await keytar.setPassword(
        OAUTH_CONFIG.serviceName,
        username,
        JSON.stringify(newTokenData)
      );
      return newTokenData.access_token;
    }
    return tokenData.access_token;
  } catch (error) {
    logger.error(`Failed to get access token: ${error.message}`);
    return null;
  }
}

/**
 * Check if a user is authenticated
 * @param {string} username - GitHub username
 * @returns {Promise<boolean>} - Whether the user is authenticated
 */
async function isAuthenticated(username) {
  return (await getAccessToken(username)) !== null;
}

module.exports = {
  authenticate,
  getAccessToken,
  isAuthenticated
};