#!/usr/bin/env node

const { program } = require('commander');
const chalk = require('chalk');
const packageJson = require('../package.json');

// Import command modules
const initCommand = require('../lib/commands/init');
const setupGithubCommand = require('../lib/commands/setup-github');
const setupAwsCommand = require('../lib/commands/setup-aws'); 
const deployCommand = require('../lib/commands/deploy');

// CLI configuration
program
  .name('ssc')
  .description('Static Site Creator - CLI tool for setting up static sites with Zola, GitHub and AWS')
  .version(packageJson.version);

// Create command - runs the full end-to-end process
program
  .command('create')
  .description('Create a new static site and set up all required components')
  .option('-n, --name <name>', 'Site name')
  .option('-d, --domain <domain>', 'Domain name')
  .option('-g, --github-username <username>', 'GitHub username')
  .option('-r, --repo <repo>', 'GitHub repository name')
  .option('--aws-region <region>', 'AWS region', 'us-east-1')
  .option('-t, --theme <theme>', 'Zola theme name')
  .option('--ask-theme', 'Force the theme question')
  .option('--skip-github', 'Skip GitHub setup')
  .option('--skip-aws', 'Skip AWS setup')
  .action(async (options) => {
    try {
      // Initialize site with Zola
      const siteConfig = await initCommand.execute(options);
      
      // Set up GitHub repository if not skipped
      if (!options.skipGithub) {
        await setupGithubCommand.execute(siteConfig);
      }
      
      // Set up AWS resources if not skipped
      if (!options.skipAws) {
        await setupAwsCommand.execute(siteConfig);
      }
      
      // Deploy site if both GitHub and AWS are set up
      if (!options.skipGithub && !options.skipAws) {
        await deployCommand.execute(siteConfig);
      }
      
      console.log(chalk.green('\n✨ Static site successfully created! ✨'));
      if (!options.skipAws) {
        console.log(`Site URL: https://${siteConfig.domain}`);
      }
    } catch (error) {
      console.error(chalk.red(`Error: ${error.message}`));
      process.exit(1);
    }
  });

// Individual commands for more granular control
program
  .command('init')
  .description('Initialize a new Zola site')
  .option('-n, --name <name>', 'Site name')
  .option('-t, --theme <theme>', 'Zola theme name')
  .option('--ask-theme', 'Force the theme question')
  .action(async (options) => {
    try {
      const result = await initCommand.execute(options);
      console.log(chalk.green(`\n✨ Zola site "${result.siteName}" initialized! ✨`));
    } catch (error) {
      console.error(chalk.red(`Error: ${error.message}`));
      process.exit(1);
    }
  });

program
  .command('setup-github')
  .description('Set up GitHub repository for your static site')
  .option('-n, --name <name>', 'Site name (must match existing site)')
  .option('-g, --github-username <username>', 'GitHub username')
  .option('-r, --repo <repo>', 'GitHub repository name')
  .action(async (options) => {
    try {
      await setupGithubCommand.execute(options);
      console.log(chalk.green('\n✨ GitHub repository set up successfully! ✨'));
    } catch (error) {
      console.error(chalk.red(`Error: ${error.message}`));
      process.exit(1);
    }
  });

program
  .command('setup-aws')
  .description('Set up AWS resources for your static site')
  .option('-n, --name <name>', 'Site name (must match existing site)')
  .option('-d, --domain <domain>', 'Domain name')
  .option('--aws-region <region>', 'AWS region', 'us-east-1')
  .action(async (options) => {
    try {
      await setupAwsCommand.execute(options);
      console.log(chalk.green('\n✨ AWS resources set up successfully! ✨'));
      console.log(`Site URL: https://${options.domain}`);
    } catch (error) {
      console.error(chalk.red(`Error: ${error.message}`));
      process.exit(1);
    }
  });

program
  .command('deploy')
  .description('Deploy your static site to AWS')
  .option('-n, --name <name>', 'Site name (must match existing site)')
  .action(async (options) => {
    try {
      await deployCommand.execute(options);
      console.log(chalk.green('\n✨ Site deployed successfully! ✨'));
    } catch (error) {
      console.error(chalk.red(`Error: ${error.message}`));
      process.exit(1);
    }
  });

// Parse command line arguments
program.parse(process.argv);

// Show help if no arguments provided
if (!process.argv.slice(2).length) {
  program.outputHelp();
}