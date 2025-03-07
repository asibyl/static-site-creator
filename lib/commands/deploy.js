/**
 * Deploy a Zola site to AWS
 */

const path = require('path');
const inquirer = require('inquirer');
const logger = require('../utils/logger');
const config = require('../utils/config');
const gitService = require('../services/git');
const zolaService = require('../services/zola');
const githubService = require('../services/github');

/**
 * Execute the deploy command
 * @param {object} options - Command options
 * @returns {Promise<object>} - Site configuration
 */
async function execute(options = {}) {
  try {
    // Determine which site to deploy
    const siteName = await determineSiteName(options);
    
    // Load site config
    const siteConfig = config.getSiteConfig(siteName);
    if (!siteConfig) {
      throw new Error(`No configuration found for site "${siteName}". Please initialize the site first.`);
    }
    
    const sitePath = path.join(process.cwd(), siteName);
    
    // Build the site
    logger.info(`Building site "${siteName}"...`);
    const built = await zolaService.buildSite(sitePath);
    if (!built) {
      throw new Error(`Failed to build site "${siteName}"`);
    }
    
    // Check if GitHub repository is set up
    if (!siteConfig.githubUsername || !siteConfig.repo) {
      logger.warn('GitHub repository not set up. This site may not deploy automatically.');
      logger.info('Please run "ssc setup-github" to configure GitHub integration.');
    }
    
    // Check if AWS resources are set up
    if (!siteConfig.s3BucketName) {
      logger.warn('AWS resources not set up. This site may not deploy correctly.');
      logger.info('Please run "ssc setup-aws" to configure AWS integration.');
    }
    
    // Stage changes
    logger.info('Staging changes...');
    await gitService.stageAll(sitePath);
    
    // Commit changes
    const commitMessage = await promptForCommitMessage();
    logger.info(`Committing changes with message: "${commitMessage}"...`);
    await gitService.commit(sitePath, commitMessage);
    
    // Push to GitHub
    logger.info('Pushing changes to GitHub...');
    await gitService.push(sitePath);
    
    logger.info('Changes pushed to GitHub.');
    logger.info('If GitHub Actions is configured correctly, your site will be deployed automatically.');
    
    if (siteConfig.domain) {
      logger.info(`Once deployment is complete, your site will be available at: https://${siteConfig.domain}`);
    }
    
    return siteConfig;
  } catch (error) {
    logger.error(`Deploy command failed: ${error.message}`, error);
    throw error;
  }
}

/**
 * Determine which site to deploy
 * @param {object} options - Command options
 * @returns {Promise<string>} - Site name
 */
async function determineSiteName(options) {
  // If site name is provided in options, use it
  if (options.name) {
    return options.name;
  }
  
  // If options is a config object with siteName, use it
  if (options.siteName) {
    return options.siteName;
  }
  
  // Otherwise, list all sites and let user choose
  const sites = config.listSites();
  
  if (sites.length === 0) {
    throw new Error('No sites found. Please initialize a site first with `ssc init`.');
  }
  
  if (sites.length === 1) {
    return sites[0].siteName;
  }
  
  // Multiple sites found, prompt user to choose
  const { siteName } = await inquirer.prompt([
    {
      type: 'list',
      name: 'siteName',
      message: 'Which site would you like to deploy?',
      choices: sites.map(site => site.siteName)
    }
  ]);
  
  return siteName;
}

/**
 * Prompt for commit message
 * @returns {Promise<string>} - Commit message
 */
async function promptForCommitMessage() {
  const { commitMessage } = await inquirer.prompt([
    {
      type: 'input',
      name: 'commitMessage',
      message: 'Enter a commit message:',
      default: 'Update site content',
      validate: input => input ? true : 'Commit message is required'
    }
  ]);
  
  return commitMessage;
}

module.exports = {
  execute
};