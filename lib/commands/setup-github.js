/**
 * Set up GitHub repository for a Zola site
 */

const path = require('path');
const inquirer = require('inquirer');
const logger = require('../utils/logger');
const config = require('../utils/config');
const credentials = require('../utils/credentials');
const githubService = require('../services/github');
const gitService = require('../services/git');

/**
 * Execute the setup-github command
 * @param {object} options - Command options
 * @returns {Promise<object>} - Updated site configuration
 */
async function execute(options = {}) {
  try {
    // Determine which site to set up
    const siteName = await determineSiteName(options);
    
    // Load site config
    let siteConfig = config.getSiteConfig(siteName);
    if (!siteConfig) {
      throw new Error(`No configuration found for site "${siteName}". Please initialize the site first.`);
    }
    
    // Collect GitHub information
    const githubInfo = await collectGithubInfo(options, siteConfig);
    
    // Use the GitHub OAuth device flow to authenticate
    // This will handle both new auth and token refreshing automatically
    logger.info(`Setting up GitHub access for user ${githubInfo.username || '(to be determined)'}`);
    
    // Get GitHub auth token and username - will authenticate if needed
    let token;
    let authUsername;
    
    if (githubInfo.username) {
      // If username is provided, get the token
      token = await githubService.getAuthToken(githubInfo.username);
      authUsername = githubInfo.username;
    } else {
      // If username is not provided, authenticate and get both token and username
      token = await githubService.getAuthToken();
      // Now get the authenticated user information to get the username
      const user = await githubService.getAuthenticatedUser();
      authUsername = user ? user.login : null;
    }
    
    if (!token || !authUsername) {
      throw new Error('Failed to authenticate with GitHub');
    }
    
    // Verify the authenticated user has the correct permissions
    const authUser = await githubService.getAuthenticatedUser();
    if (!authUser) {
      throw new Error('Failed to get authenticated user information. Please try authenticating again.');
    }
    
    logger.info(`Authenticated as GitHub user: ${authUser.login}`);
    
    // Make sure we're using the correct username from the authenticated user
    authUsername = authUser.login;
    
    // Create GitHub repository
    const repoData = await githubService.createRepository(
      authUsername,
      githubInfo.repoName, 
      `Zola static site for ${siteName}`
    );
    
    if (!repoData) {
      throw new Error(`Failed to create GitHub repository "${githubInfo.repoName}"`);
    }
    
    // Verify the repository owner matches the authenticated user
    if (repoData.owner.login !== authUsername) {
      logger.warn(`Repository owner (${repoData.owner.login}) does not match authenticated user (${authUsername})`);
      logger.info('This may cause permission issues when pushing to the repository.');
    }
    
    // Check repository permissions
    if (repoData.permissions && !repoData.permissions.push) {
      throw new Error(`You do not have push access to ${repoData.full_name}. Please use a repository you have write access to.`);
    }
    
    // Set remote URL in Git repository and configure credentials
    const sitePath = path.join(process.cwd(), siteName);
    await gitService.setRemoteUrl(
      sitePath, 
      authUsername, 
      githubInfo.repoName,
      token  // Pass the OAuth token to store in Git credential helper
    );
    
    // Stage all files
    const stageSuccess = await gitService.stageAll(sitePath);
    if (!stageSuccess) {
      throw new Error('Failed to stage files for commit');
    }
    
    // Commit
    const commitSuccess = await gitService.commit(sitePath, 'Initial commit');
    if (!commitSuccess) {
      throw new Error('Failed to commit changes to Git repository');
    }
    
    // Push to GitHub with the OAuth token for authentication
    const pushSuccess = await gitService.push(sitePath, 'main', token);
    if (!pushSuccess) {
      throw new Error('Failed to push changes to GitHub. Make sure you have the correct permissions.');
    }
    
    // Only log success messages if push actually succeeded
    logger.info(`Repository successfully pushed to https://github.com/${authUsername}/${githubInfo.repoName}`);
    logger.info(`Visit ${repoData.html_url} to view your repository`);
    
    // Update site config
    siteConfig.githubUsername = authUsername;
    siteConfig.repo = githubInfo.repoName;
    siteConfig.repoUrl = repoData.html_url;
    
    config.saveSiteConfig(siteName, siteConfig);
    
    return siteConfig;
  } catch (error) {
    logger.error(`Setup GitHub command failed: ${error.message}`, error);
    throw error;
  }
}

/**
 * Determine which site to set up
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
      message: 'Which site would you like to set up on GitHub?',
      choices: sites.map(site => site.siteName)
    }
  ]);
  
  return siteName;
}

/**
 * Collect GitHub information from user input
 * @param {object} options - Command options
 * @param {object} siteConfig - Site configuration
 * @returns {Promise<object>} - GitHub information
 */
async function collectGithubInfo(options, siteConfig) {
  const questions = [];
  
  // GitHub username
  if (!options.githubUsername) {
    questions.push({
      type: 'input',
      name: 'username',
      message: 'What is your GitHub username?',
      validate: input => input ? true : 'GitHub username is required'
    });
  }
  
  // Repository name
  if (!options.repo) {
    questions.push({
      type: 'input',
      name: 'repoName',
      message: 'What name would you like to use for the GitHub repository?',
      default: siteConfig.repo || siteConfig.siteName,
      validate: input => {
        if (!input) return 'Repository name is required';
        if (!/^[a-zA-Z0-9-_.]+$/.test(input)) {
          return 'Repository name can only contain letters, numbers, hyphens, underscores, and periods';
        }
        return true;
      }
    });
  }
  
  // Prompt user for inputs
  const answers = questions.length > 0 ? await inquirer.prompt(questions) : {};
  
  return {
    username: options.githubUsername || answers.username,
    repoName: options.repo || answers.repoName
  };
}

module.exports = {
  execute
};