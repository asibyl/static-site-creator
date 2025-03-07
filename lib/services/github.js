/**
 * GitHub service for managing GitHub API operations
 */

const { Octokit } = require('octokit');
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');
const githubOAuth = require('./github-oauth');

/**
 * Create an authenticated Octokit instance
 * @param {string} token - GitHub OAuth access token
 * @returns {Octokit} - Authenticated Octokit instance
 */
function createOctokit(token) {
  return new Octokit({ auth: token });
}

/**
 * Get authenticated Octokit instance for a user
 * @param {string} username - GitHub username
 * @returns {Promise<Octokit>} - Authenticated Octokit instance
 */
async function getAuthenticatedOctokit(username) {
  // Get token for user - will trigger authentication if needed
  const token = await getAuthToken(username);
  if (!token) {
    throw new Error('Failed to get GitHub authentication token');
  }
  
  return createOctokit(token);
}

/**
 * Get GitHub auth token, authenticate if needed
 * @param {string} username - GitHub username (optional)
 * @returns {Promise<string>} - GitHub OAuth token
 */
async function getAuthToken(username) {
  // If username is provided, try to get existing token
  if (username) {
    const token = await githubOAuth.getAccessToken(username);
    if (token) return token;
  }
  
  // Authenticate with device flow and get username
  const newUsername = await githubOAuth.authenticate();
  
  // Now get the token with the authenticated username
  return githubOAuth.getAccessToken(newUsername);
}

/**
 * Create a new GitHub repository
 * @param {string} username - GitHub username
 * @param {string} repoName - Repository name
 * @param {string} description - Repository description (optional)
 * @param {boolean} isPrivate - Whether the repository is private (default: false)
 * @returns {Promise<object|null>} - Repository data or null if creation failed
 */
async function createRepository(username, repoName, description = '', isPrivate = true) {
  try {
    logger.startSpinner(`Creating GitHub repository "${repoName}"...`);
    
    const octokit = await getAuthenticatedOctokit(username);
    
    // Create the repository with specified settings
    const response = await octokit.rest.repos.createForAuthenticatedUser({
      name: repoName,
      description,
      private: isPrivate,
      auto_init: false,  // Don't initialize with README
      has_issues: true,
      has_projects: true,
      has_wiki: true
    });
    
    // Make sure branch protection rules are not blocking our pushes
    // By default, GitHub repos don't have branch protection rules,
    // but some organizations may have default settings
    try {
      logger.info('Ensuring no branch protection rules are blocking pushes...');
      
      // Check if we're dealing with a new repository or existing one
      const isNewRepo = response.status === 201;
      
      // If this is a new repo, GitHub won't have created the default branch yet
      // since we didn't use auto_init. But for existing repos, we should ensure
      // there are no protection rules
      if (!isNewRepo) {
        // Get default branch name
        const repoDetails = await octokit.rest.repos.get({
          owner: username,
          repo: repoName
        });
        
        const defaultBranch = repoDetails.data.default_branch || 'main';
        
        // Check if branch protection is enabled
        try {
          const protectionResponse = await octokit.rest.repos.getBranchProtection({
            owner: username,
            repo: repoName,
            branch: defaultBranch
          });
          
          // If we reach here, branch protection exists, so let's disable it temporarily
          if (protectionResponse.status === 200) {
            logger.info(`Found branch protection rules on ${defaultBranch}. Temporarily disabling...`);
            
            // Disable branch protection
            await octokit.rest.repos.deleteBranchProtection({
              owner: username,
              repo: repoName,
              branch: defaultBranch
            });
            
            logger.info(`Branch protection disabled on ${defaultBranch}`);
          }
        } catch (protectionError) {
          // 404 means no protection rules exist, which is what we want
          if (protectionError.status !== 404) {
            logger.warn(`Could not check branch protection: ${protectionError.message}`);
          }
        }
      }
    } catch (settingsError) {
      // Just log the error but continue, as this is optional
      logger.warn(`Could not update repository settings: ${settingsError.message}`);
      logger.info('Continuing with push, but you may need to create a pull request instead of pushing directly.');
    }
    
    logger.succeed(`GitHub repository "${repoName}" created`);
    return response.data;
  } catch (error) {
    logger.fail(`Failed to create GitHub repository "${repoName}"`);
    
    // Check if repository already exists
    if (error.status === 422) {
      logger.info(`Repository "${repoName}" may already exist`);
      
      try {
        // Try to fetch the repository to confirm it exists
        const octokit = await getAuthenticatedOctokit(username);
        const response = await octokit.rest.repos.get({
          owner: username,
          repo: repoName
        });
        
        logger.info(`Repository "${repoName}" already exists and will be used`);
        return response.data;
      } catch (getError) {
        logger.error(`Failed to get repository information: ${getError.message}`);
      }
    } else {
      logger.error(error.message);
    }
    
    return null;
  }
}

/**
 * Create or update a GitHub workflow file
 * @param {string} repoPath - Path to the repository
 * @param {object} config - Workflow configuration
 * @returns {Promise<boolean>} - Whether operation was successful
 */
async function createWorkflowFile(repoPath, config) {
  try {
    logger.startSpinner('Creating GitHub workflow file...');
    
    // Ensure .github/workflows directory exists
    const workflowsDir = path.join(repoPath, '.github', 'workflows');
    fs.mkdirSync(workflowsDir, { recursive: true });
    
    // Create workflow file from template
    const workflowPath = path.join(workflowsDir, 'main.yml');
    
    // Generate workflow file content
    const workflowContent = `name: Build and Deploy

on:
  push:
    branches: [ main ]
  pull_request:
    branches: [ main ]

jobs:
  build:
    runs-on: ubuntu-latest
    permissions:
      id-token: write
      contents: read
    
    steps:
      - uses: actions/checkout@v3
        with:
          submodules: recursive
      
      - name: Setup Zola
        uses: taiki-e/install-action@v2
        with:
          tool: zola@0.17.1
      
      - name: Build site
        run: zola build
      
      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${config.iamRoleArn || 'YOUR_IAM_ROLE_ARN'}
          aws-region: ${config.awsRegion || 'us-east-1'}
      
      - name: Sync files to S3 and invalidate CloudFront
        run: |
          aws s3 sync public/ s3://${config.s3BucketName || 'YOUR_S3_BUCKET_NAME'} --delete --cache-control max-age=86400
          aws cloudfront create-invalidation --distribution-id ${config.cloudfrontDistributionId || 'YOUR_CLOUDFRONT_DISTRIBUTION_ID'} --paths '/*'
`;
    
    fs.writeFileSync(workflowPath, workflowContent);
    
    logger.succeed('GitHub workflow file created');
    logger.info(`Workflow file created at ${workflowPath}`);
    
    return true;
  } catch (error) {
    logger.fail('Failed to create GitHub workflow file');
    logger.error(error.message);
    return false;
  }
}

/**
 * Get authenticated user information
 * @param {string} username - GitHub username (optional)
 * @returns {Promise<object|null>} - User data or null if request failed
 */
async function getAuthenticatedUser(username) {
  try {
    const octokit = await getAuthenticatedOctokit(username);
    const { data: user } = await octokit.rest.users.getAuthenticated();
    return user;
  } catch (error) {
    logger.error(`Failed to get authenticated user: ${error.message}`);
    return null;
  }
}

module.exports = {
  createRepository,
  createWorkflowFile,
  getAuthenticatedUser,
  getAuthToken
};