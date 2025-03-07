/**
 * Initialize a new Zola site
 */

const path = require('path');
const fs = require('fs');
const inquirer = require('inquirer');
const logger = require('../utils/logger');
const config = require('../utils/config');
const zolaService = require('../services/zola');
const gitService = require('../services/git');

/**
 * Execute the init command
 * @param {object} options - Command options
 * @returns {Promise<object>} - Site configuration
 */
async function execute(options = {}) {
  try {
    // Check if Zola is installed
    if (!await zolaService.isZolaInstalled()) {
      logger.info('Zola is not installed. Installing now...');
      const installed = await zolaService.installZola();
      
      if (!installed) {
        throw new Error('Failed to install Zola. Please install it manually and try again.');
      }
    }
    
    // Check if Git is installed
    if (!await gitService.isGitInstalled()) {
      throw new Error('Git is not installed. Please install Git and try again.');
    }
    
    // Collect site information if not provided in options
    const siteInfo = await collectSiteInfo(options);
    
    // Create site directory structure manually instead of using Zola init
    const sitePath = path.join(process.cwd(), siteInfo.siteName);
    fs.mkdirSync(sitePath, { recursive: true });
    fs.mkdirSync(path.join(sitePath, 'content'), { recursive: true });
    fs.mkdirSync(path.join(sitePath, 'templates'), { recursive: true });
    fs.mkdirSync(path.join(sitePath, 'static'), { recursive: true });
    
    // Create basic config.toml
    const configToml = `
# Basic config.toml for ${siteInfo.siteName}
base_url = "https://${siteInfo.domain || 'example.com'}"
title = "${siteInfo.siteName}"
description = "A static site created with Static Site Creator"

# Optional: Syntax highlighting
[markdown]
highlight_code = true

# Optional: Search index
[search]
index_pages = true
    `;
    fs.writeFileSync(path.join(sitePath, 'config.toml'), configToml);
    
    // Create a basic index page
    const indexMd = `
+++
title = "Welcome to ${siteInfo.siteName}"
template = "index.html"
+++

# Welcome to ${siteInfo.siteName}

This is your new static site created with Static Site Creator.
    `;
    fs.writeFileSync(path.join(sitePath, 'content', '_index.md'), indexMd);
    
    // Create a basic template
    const indexTemplate = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{{ config.title }}</title>
    <meta name="description" content="{{ config.description }}">
    <link rel="stylesheet" href="/style.css">
</head>
<body>
    <header>
        <h1>{{ config.title }}</h1>
    </header>
    <main>
        {{ section.content | safe }}
    </main>
    <footer>
        <p>&copy; {{ now() | date(format="%Y") }} {{ config.title }}</p>
    </footer>
</body>
</html>
    `;
    fs.writeFileSync(path.join(sitePath, 'templates', 'index.html'), indexTemplate);
    
    // Create a basic stylesheet
    const css = `
body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    line-height: 1.6;
    max-width: 800px;
    margin: 0 auto;
    padding: 2rem;
    color: #333;
}

h1, h2, h3 {
    color: #111;
}

a {
    color: #0077cc;
}

footer {
    margin-top: 2rem;
    border-top: 1px solid #eee;
    padding-top: 1rem;
}
    `;
    fs.writeFileSync(path.join(sitePath, 'static', 'style.css'), css);
    
    logger.succeed(`Basic Zola site structure created for "${siteInfo.siteName}"`);
    const initialized = true;
    
    // Save site config
    const siteConfig = config.saveSiteConfig(siteInfo.siteName, {
      siteName: siteInfo.siteName,
      theme: siteInfo.theme,
      repo: siteInfo.repo || siteInfo.siteName,
      domain: siteInfo.domain
    });
    
    // Create .gitignore file
    createGitignore(sitePath);
    
    const repoInitialized = await gitService.initRepo(sitePath);
    if (!repoInitialized) {
      logger.warn(`Failed to initialize Git repository in "${sitePath}"`);
    }
    
    // Install theme if specified
    if (siteInfo.theme) {
      await zolaService.installTheme(sitePath, siteInfo.theme);
    }
    
    return siteConfig;
  } catch (error) {
    logger.error(`Init command failed: ${error.message}`, error);
    throw error;
  }
}

/**
 * Collect site information from user input
 * @param {object} options - Command options
 * @returns {Promise<object>} - Site information
 */
async function collectSiteInfo(options) {
  const questions = [];
  
  // Site name
  if (!options.name) {
    questions.push({
      type: 'input',
      name: 'siteName',
      message: 'What would you like to name your site?',
      default: 'my-zola-site',
      validate: input => {
        if (!input) return 'Site name is required';
        if (!/^[a-zA-Z0-9-_]+$/.test(input)) return 'Site name can only contain letters, numbers, hyphens, and underscores';
        return true;
      }
    });
  }
  
  // Theme - only ask if explicitly requested or if theme is not provided
  if (!options.theme && options.askTheme) {
    questions.push({
      type: 'confirm',
      name: 'useTheme',
      message: 'Would you like to use a theme?',
      default: true
    });
    
    questions.push({
      type: 'input',
      name: 'theme',
      message: 'Enter the theme name (serene is a good option):',
      default: 'serene',
      when: answers => answers.useTheme
    });
  }
  
  // Domain (optional at this point)
  if (options.askDomain) {
    questions.push({
      type: 'input',
      name: 'domain',
      message: 'What domain will you use for your site? (optional at this stage)',
      default: ''
    });
  }
  
  // Prompt user for inputs
  const answers = questions.length > 0 ? await inquirer.prompt(questions) : {};
  
  return {
    siteName: options.name || answers.siteName,
    // Set theme to null by default, unless explicitly provided or selected through prompt
    theme: options.theme || (answers.useTheme ? answers.theme : null),
    domain: options.domain || answers.domain,
    repo: options.repo || null
  };
}

/**
 * Create .gitignore file in the site directory
 * @param {string} sitePath - Path to the site directory
 */
function createGitignore(sitePath) {
  const gitignorePath = path.join(sitePath, '.gitignore');
  const gitignoreContent = `# Zola output directory
public/

# Environment variables
.env
.env.*

# Local configuration files
.ssc-config.json

# Node.js
node_modules/

# macOS
.DS_Store

# Visual Studio Code
.vscode/
`;
  
  fs.writeFileSync(gitignorePath, gitignoreContent);
  logger.info('.gitignore file created');
}

module.exports = {
  execute
};