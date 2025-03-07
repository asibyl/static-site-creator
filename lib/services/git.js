/**
 * Git service for managing Git operations
 */

const execa = require('execa');
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

/**
 * Check if Git is installed
 * @returns {Promise<boolean>} - Whether Git is installed
 */
async function isGitInstalled() {
  try {
    await execa('git', ['--version']);
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Initialize a Git repository in the specified directory
 * @param {string} repoPath - Path to the directory
 * @returns {Promise<boolean>} - Whether initialization was successful
 */
async function initRepo(repoPath) {
  try {
    logger.startSpinner('Initializing Git repository...');
    
    await execa('git', ['init'], {
      cwd: repoPath
    });
    
    logger.succeed('Git repository initialized');
    return true;
  } catch (error) {
    logger.fail('Failed to initialize Git repository');
    logger.error(error.message);
    return false;
  }
}

/**
 * Add Git remote origin for the repository
 * @param {string} repoPath - Path to the repository
 * @param {string} username - GitHub username
 * @param {string} repoName - GitHub repository name
 * @param {string} token - GitHub OAuth token (optional)
 * @returns {Promise<boolean>} - Whether operation was successful
 */
async function setRemoteUrl(repoPath, username, repoName, token = null) {
  try {
    logger.startSpinner('Adding Git remote origin...');
    
    // Create remote URL, with token embedded if provided
    let remoteUrl;
    if (token) {
      // Use HTTPS URL with embedded token
      remoteUrl = `https://${username}:${token}@github.com/${username}/${repoName}.git`;
      logger.info('Using authenticated remote URL with token');
    } else {
      // Use HTTPS URL without embedding credentials
      remoteUrl = `https://github.com/${username}/${repoName}.git`;
    }
    
    // Check if remote already exists
    let remoteExists = false;
    try {
      await execa('git', ['remote', 'get-url', 'origin'], { cwd: repoPath });
      remoteExists = true;
    } catch (e) {
      // Remote doesn't exist, which is fine
      remoteExists = false;
    }
    
    if (remoteExists) {
      // If remote exists, inform user and remove it
      logger.info('Remote "origin" already exists. Removing and re-adding it...');
      await execa('git', ['remote', 'remove', 'origin'], { cwd: repoPath });
    }
    
    // Add the remote with token embedded in URL
    await execa('git', ['remote', 'add', 'origin', remoteUrl], { 
      cwd: repoPath,
      // Don't show the command with token in the logs
      stdio: ['pipe', 'pipe', 'pipe']
    });
    
    logger.info('Git remote origin added with authentication');
    
    logger.succeed('Git remote origin added');
    logger.info('Authentication will be handled securely using OAuth tokens.');
    
    return true;
  } catch (error) {
    logger.fail('Failed to add Git remote origin');
    logger.error(error.message);
    return false;
  }
}

/**
 * Stage all files in the repository
 * @param {string} repoPath - Path to the repository
 * @returns {Promise<boolean>} - Whether staging was successful
 */
async function stageAll(repoPath) {
  try {
    logger.startSpinner('Staging files...');
    
    await execa('git', ['add', '.'], {
      cwd: repoPath
    });
    
    logger.succeed('Files staged');
    return true;
  } catch (error) {
    logger.fail('Failed to stage files');
    logger.error(error.message);
    return false;
  }
}

/**
 * Commit staged changes
 * @param {string} repoPath - Path to the repository
 * @param {string} message - Commit message
 * @returns {Promise<boolean>} - Whether commit was successful
 */
async function commit(repoPath, message) {
  try {
    logger.startSpinner('Committing changes...');
    
    await execa('git', ['commit', '-m', message], {
      cwd: repoPath
    });
    
    logger.succeed('Changes committed');
    return true;
  } catch (error) {
    logger.fail('Failed to commit changes');
    logger.error(error.message);
    return false;
  }
}

/**
 * Push changes to remote
 * @param {string} repoPath - Path to the repository
 * @param {string} branch - Branch name (default: main)
 * @param {string} token - GitHub OAuth token (optional, not used anymore as it's now in the remote URL)
 * @returns {Promise<boolean>} - Whether push was successful
 */
async function push(repoPath, branch = 'main', token = null) {
  try {
    logger.startSpinner(`Pushing to ${branch}...`);
    
    // Simply push to the remote that was already set up with auth
    await execa('git', ['push', '-u', 'origin', branch], {
      cwd: repoPath,
      env: {
        // Disable interactive prompts
        GIT_TERMINAL_PROMPT: '0',
        GCM_INTERACTIVE: 'never'
      }
    });
    
    logger.succeed(`Changes pushed to ${branch}`);
    return true;
  } catch (error) {
    logger.fail(`Failed to push changes to ${branch}`);
    logger.error(`Error: ${error.message}`);
    
    if (error.stderr) {
      // If token was provided, make sure it doesn't appear in error messages
      const sanitizedError = token
        ? error.stderr.replace(new RegExp(token, 'g'), '********')
        : error.stderr;
      
      logger.error(`Git error details: ${sanitizedError}`);
    }
    
    return false;
  }
}

/**
 * Create and checkout a new branch
 * @param {string} repoPath - Path to the repository
 * @param {string} branch - Branch name
 * @returns {Promise<boolean>} - Whether branch creation was successful
 */
async function createBranch(repoPath, branch) {
  try {
    logger.startSpinner(`Creating branch ${branch}...`);
    
    await execa('git', ['checkout', '-b', branch], {
      cwd: repoPath
    });
    
    logger.succeed(`Branch ${branch} created`);
    return true;
  } catch (error) {
    logger.fail(`Failed to create branch ${branch}`);
    logger.error(error.message);
    return false;
  }
}

/**
 * Clone a Git repository
 * @param {string} url - Repository URL
 * @param {string} targetDir - Directory to clone into
 * @returns {Promise<boolean>} - Whether clone was successful
 */
async function cloneRepo(url, targetDir) {
  try {
    logger.startSpinner(`Cloning repository from ${url}...`);
    
    await execa('git', ['clone', url, targetDir]);
    
    logger.succeed('Repository cloned');
    return true;
  } catch (error) {
    logger.fail('Failed to clone repository');
    logger.error(error.message);
    return false;
  }
}

module.exports = {
  isGitInstalled,
  initRepo,
  setRemoteUrl,
  stageAll,
  commit,
  push,
  createBranch,
  cloneRepo
};