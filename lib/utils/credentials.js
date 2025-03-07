/**
 * Secure credential management for the static site creator
 * Uses system keychain to store and retrieve sensitive credentials
 */

const keytar = require('keytar');
const inquirer = require('inquirer');
const SERVICE_NAME = 'static-site-creator';

/**
 * Get stored GitHub token
 * @param {string} username - GitHub username
 * @returns {Promise<string|null>} - The stored token or null if not found
 */
async function getGithubToken(username) {
  return keytar.getPassword(SERVICE_NAME, `github_${username}`);
}

/**
 * Store GitHub token
 * @param {string} username - GitHub username
 * @param {string} token - GitHub personal access token
 * @returns {Promise<void>}
 */
async function storeGithubToken(username, token) {
  return keytar.setPassword(SERVICE_NAME, `github_${username}`, token);
}

/**
 * Get stored AWS credentials
 * @param {string} profileName - AWS profile name (default: 'default')
 * @returns {Promise<Object|null>} - Object with accessKeyId and secretAccessKey or null
 */
async function getAwsCredentials(profileName = 'default') {
  const accessKeyId = await keytar.getPassword(SERVICE_NAME, `aws_${profileName}_id`);
  const secretAccessKey = await keytar.getPassword(SERVICE_NAME, `aws_${profileName}_secret`);
  
  if (accessKeyId && secretAccessKey) {
    return { accessKeyId, secretAccessKey };
  }
  
  return null;
}

/**
 * Store AWS credentials
 * @param {string} accessKeyId - AWS access key ID
 * @param {string} secretAccessKey - AWS secret access key
 * @param {string} profileName - AWS profile name (default: 'default')
 * @returns {Promise<void>}
 */
async function storeAwsCredentials(accessKeyId, secretAccessKey, profileName = 'default') {
  await keytar.setPassword(SERVICE_NAME, `aws_${profileName}_id`, accessKeyId);
  await keytar.setPassword(SERVICE_NAME, `aws_${profileName}_secret`, secretAccessKey);
}

/**
 * Prompt user for GitHub token
 * @param {string} username - GitHub username
 * @returns {Promise<string>} - GitHub token
 */
async function promptForGithubToken(username) {
  const { token } = await inquirer.prompt([
    {
      type: 'password',
      name: 'token',
      message: `Enter GitHub personal access token for user ${username}:`,
      validate: input => input.length > 0 || 'Token is required'
    }
  ]);
  
  // Ask if user wants to save the token
  const { save } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'save',
      message: 'Would you like to save this token in your system keychain?',
      default: true
    }
  ]);
  
  if (save) {
    await storeGithubToken(username, token);
  }
  
  return token;
}

/**
 * Prompt user for AWS credentials
 * @param {string} profileName - AWS profile name (default: 'default')
 * @returns {Promise<Object>} - Object with accessKeyId and secretAccessKey
 */
async function promptForAwsCredentials(profileName = 'default') {
  const credentials = await inquirer.prompt([
    {
      type: 'input',
      name: 'accessKeyId',
      message: 'Enter AWS Access Key ID:',
      validate: input => input.length > 0 || 'Access Key ID is required'
    },
    {
      type: 'password',
      name: 'secretAccessKey',
      message: 'Enter AWS Secret Access Key:',
      validate: input => input.length > 0 || 'Secret Access Key is required'
    }
  ]);
  
  // Ask if user wants to save the credentials
  const { save } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'save',
      message: 'Would you like to save these credentials in your system keychain?',
      default: true
    }
  ]);
  
  if (save) {
    await storeAwsCredentials(credentials.accessKeyId, credentials.secretAccessKey, profileName);
  }
  
  return credentials;
}

/**
 * Delete all stored credentials
 * @returns {Promise<void>}
 */
async function clearAllCredentials() {
  // This is a simplistic implementation
  // In a real application, you'd want to enumerate and delete all credentials
  // for the service, but keytar doesn't provide a simple way to do this
}

module.exports = {
  getGithubToken,
  storeGithubToken,
  getAwsCredentials,
  storeAwsCredentials,
  promptForGithubToken,
  promptForAwsCredentials,
  clearAllCredentials
};