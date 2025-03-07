/**
 * Zola service for managing Zola static site operations
 */

const execa = require('execa');
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

/**
 * Check if Zola is installed
 * @returns {Promise<boolean>} - Whether Zola is installed
 */
async function isZolaInstalled() {
  try {
    await execa('zola', ['--version']);
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Install Zola if not already installed
 * @returns {Promise<boolean>} - Whether installation was successful
 */
async function installZola() {
  try {
    logger.startSpinner('Installing Zola...');
    
    // Check the platform and use appropriate installation method
    if (process.platform === 'darwin') {
      // macOS
      await execa('brew', ['install', 'zola']);
    } else if (process.platform === 'linux') {
      // Linux - this is a simplistic approach
      // In a real implementation, you'd want to check the distro
      logger.fail('Automatic Zola installation on Linux is not supported');
      logger.info('Please install Zola manually: https://www.getzola.org/documentation/getting-started/installation/');
      return false;
    } else if (process.platform === 'win32') {
      // Windows
      logger.fail('Automatic Zola installation on Windows is not supported');
      logger.info('Please install Zola manually: https://www.getzola.org/documentation/getting-started/installation/');
      return false;
    }
    
    logger.succeed('Zola installed successfully');
    return true;
  } catch (error) {
    logger.fail('Failed to install Zola');
    logger.error(error.message);
    logger.info('Please install Zola manually: https://www.getzola.org/documentation/getting-started/installation/');
    return false;
  }
}

/**
 * Initialize a new Zola site
 * @param {string} siteName - Name of the site
 * @returns {Promise<boolean>} - Whether initialization was successful
 */
async function initSite(siteName) {
  try {
    logger.startSpinner(`Initializing Zola site "${siteName}"...`);
    
    // Run zola init
    await execa('zola', ['init', siteName]);
    
    logger.succeed(`Zola site "${siteName}" initialized`);
    return true;
  } catch (error) {
    logger.fail(`Failed to initialize Zola site "${siteName}"`);
    logger.error(error.message);
    return false;
  }
}

/**
 * Install a Zola theme
 * @param {string} sitePath - Path to the site
 * @param {string} theme - Name of the theme
 * @returns {Promise<boolean>} - Whether installation was successful
 */
async function installTheme(sitePath, theme) {
  try {
    logger.startSpinner(`Installing theme "${theme}"...`);
    
    // Create themes directory if it doesn't exist
    const themesDir = path.join(sitePath, 'themes');
    if (!fs.existsSync(themesDir)) {
      fs.mkdirSync(themesDir, { recursive: true });
    }
    
    // Run git submodule add
    const process = await execa('git', [
      'submodule', 
      'add', 
      '-b', 
      'latest', 
      `https://github.com/isunjn/serene.git`, 
      `themes/${theme}`
    ], {
      cwd: sitePath
    });
    
    // Update config.toml to use the theme
    const configPath = path.join(sitePath, 'config.toml');
    let configContent = fs.readFileSync(configPath, 'utf8');
    
    // Add or update theme setting
    if (configContent.includes('theme = ')) {
      configContent = configContent.replace(/theme = ".*"/g, `theme = "${theme}"`);
    } else {
      configContent += `\ntheme = "${theme}"\n`;
    }
    
    fs.writeFileSync(configPath, configContent);
    
    logger.succeed(`Theme "${theme}" installed successfully`);
    return true;
  } catch (error) {
    logger.fail(`Failed to install theme "${theme}"`);
    logger.error(error.message);
    return false;
  }
}

/**
 * Build the Zola site
 * @param {string} sitePath - Path to the site
 * @returns {Promise<boolean>} - Whether build was successful
 */
async function buildSite(sitePath) {
  try {
    logger.startSpinner('Building site...');
    
    await execa('zola', ['build'], {
      cwd: sitePath
    });
    
    logger.succeed('Site built successfully');
    return true;
  } catch (error) {
    logger.fail('Failed to build site');
    logger.error(error.message);
    return false;
  }
}

/**
 * Serve the Zola site locally
 * @param {string} sitePath - Path to the site
 * @param {number} port - Port to serve on (default: 1111)
 * @returns {Promise<object>} - The execa process
 */
async function serveSite(sitePath, port = 1111) {
  logger.info(`Starting local server on http://127.0.0.1:${port}`);
  
  const process = execa('zola', ['serve', '--port', port.toString()], {
    cwd: sitePath
  });
  
  // Forward stdout and stderr
  process.stdout.pipe(process.stdout);
  process.stderr.pipe(process.stderr);
  
  return process;
}

module.exports = {
  isZolaInstalled,
  installZola,
  initSite,
  installTheme,
  buildSite,
  serveSite
};