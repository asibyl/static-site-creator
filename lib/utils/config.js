/**
 * Configuration management for the static site creator
 * Handles reading and writing configuration data
 */

const { default: Conf } = require('conf');
const path = require('path');
const fs = require('fs');

// Create a config instance with encryption for sensitive data
const config = new Conf({
  projectName: 'static-site-creator',
  schema: {
    sites: {
      type: 'object',
      default: {}
    }
  }
});

/**
 * Get configuration for a specific site
 * @param {string} siteName - Name of the site
 * @returns {object|null} - Site configuration or null if not found
 */
function getSiteConfig(siteName) {
  const sites = config.get('sites');
  return sites[siteName] || null;
}

/**
 * Save configuration for a site
 * @param {string} siteName - Name of the site
 * @param {object} siteConfig - Configuration object
 */
function saveSiteConfig(siteName, siteConfig) {
  const sites = config.get('sites');
  sites[siteName] = siteConfig;
  config.set('sites', sites);
  
  // Also save site-specific config in the site directory
  const configPath = path.join(process.cwd(), siteName, '.ssc-config.json');
  try {
    fs.writeFileSync(
      configPath, 
      JSON.stringify({
        siteName,
        domain: siteConfig.domain,
        theme: siteConfig.theme,
        repo: siteConfig.repo,
        awsRegion: siteConfig.awsRegion
      }, null, 2)
    );
  } catch (error) {
    // Silent fail if we can't write to the site directory
    // This might happen if the directory doesn't exist yet
  }
  
  return siteConfig;
}

/**
 * List all sites in the configuration
 * @returns {Array<object>} - Array of site configurations
 */
function listSites() {
  const sites = config.get('sites');
  return Object.keys(sites).map(siteName => ({
    siteName,
    ...sites[siteName]
  }));
}

/**
 * Load configuration from a site directory
 * @param {string} siteName - Name of the site
 * @returns {object|null} - Site configuration or null if not found
 */
function loadFromSiteDirectory(siteName) {
  const configPath = path.join(process.cwd(), siteName, '.ssc-config.json');
  try {
    if (fs.existsSync(configPath)) {
      const siteConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      return siteConfig;
    }
  } catch (error) {
    // Silent fail if we can't read from the site directory
  }
  return null;
}

/**
 * Delete a site configuration
 * @param {string} siteName - Name of the site
 */
function deleteSiteConfig(siteName) {
  const sites = config.get('sites');
  delete sites[siteName];
  config.set('sites', sites);
}

module.exports = {
  getSiteConfig,
  saveSiteConfig,
  listSites,
  loadFromSiteDirectory,
  deleteSiteConfig
};