# Static Site Creator

A CLI tool to automate the creation, configuration, and deployment of static sites built with Zola, GitHub, and AWS.

## Features

- Initialize Zola static sites with optional themes
- Set up GitHub repositories and workflows
- Provision AWS resources (S3, CloudFront, Route53, ACM)
- Configure secure GitHub Actions deployment pipeline
- Manage multiple sites from a single tool

## Prerequisites

## Accounts
- **AWS account**, ideally with an IAM user with Administrator privileges. Note the <ins>Access Key</ins> and <ins>Secret</ins> for this IAM user. 
- **GitHub account** with a registered **OAuth App**. See section below on instructions to register an OAuth App with GitHub.   
- A registered domain name (for AWS deployment)

### Installation Prerequisites
- Node.js 14.16 or higher
- Git

## Installation

```bash
git clone https://github.com/yourusername/static-site-creator.git
cd static-site-creator
npm install
npm link
```

## Usage

### Creating a new site (end-to-end)

```bash
ssc create --name my-site --domain example.com
```

This will guide you through the complete process of setting up a Zola site with GitHub and AWS integration. This will attempt to create a repository in your GitHub account with the same name as you provide above. Make sure that no such repository already exists. 

### Individual steps

You can also run each step separately:

```bash
# Initialize a Zola site
ssc init --name my-site

# Set up GitHub repository
ssc setup-github --name my-site

# Configure AWS resources
ssc setup-aws --name my-site --domain example.com

# Deploy site changes
ssc deploy --name my-site
```

## Command Options

### Global Options

- `--name <name>`: The name of the site to work with

### Create Command

- `--domain <domain>`: The domain name to use for the site
- `--github-username <username>`: Your GitHub username
- `--repo <repo>`: GitHub repository name
- `--aws-region <region>`: AWS region to use (default: us-east-1)
- `--theme <theme>`: Zola theme to use
- `--skip-github`: Skip GitHub setup
- `--skip-aws`: Skip AWS setup

## Security Notes

- GitHub authentication uses OAuth 2.0 Device Authorization Flow for improved security
- OAuth tokens and AWS credentials are stored securely in your system's keychain
- AWS resources are created with secure defaults, including private S3 buckets

## GitHub OAuth Setup

This tool uses the OAuth 2.0 Device Authorization Flow for secure GitHub authentication:

1. Register a new OAuth application in your [GitHub Developer Settings](https://github.com/settings/developers)
   - Set any URL for the Homepage URL (e.g., `http://localhost`)
   - No callback URL is needed for device flow. Set it to anything (e.g.`http://localhost`)
   - Check *Enable Device Flow*. 
   - After creation, note the Client ID

2. Set the client ID as an environment variable:
   ```
   export GITHUB_CLIENT_ID=your_client_id
   ```
   
   Or replace the placeholder in `lib/services/github-oauth.js`

   Learn more about [Device Authorization Flow](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow).

## Your Inputs During Execution

During execution, you will be required to:
1. Provide your GitHub username and authorize the application to perform GitHub actions. To do this, you'll complete the device flow authorization flow with GitHub by entering the device code provided locally into GitHub when prompted. 
2. Select the AWS region you want to deploy your website. 
3. **Important**: Update your domain registrar's NS records with the name servers provided. 
4. Please wait while your requested certificate gets validated. This may take a few minutes. 

## Updating Your Site 
1. The content for your site will be available in a directory with name that you provided. The directory will be located where you execute the initial `create` command.
2. In this directory, create a new Markdown file in the content/posts sub-directory (example below). Edit the title, date, and other fields. Add content for the new post in the {CONTENT} section of this file.

```
+++
title = "{TITLE}"
date = {YYYY}-{MM}-{DD}T{HH}:{MM}:{SS}Z
[taxonomies]
authors = ["{AUTHOR-1}", "{AUTHOR-2}"]
tags = ["{TAG-1}", "{TAG-2}"]
+++

{CONTENT}
```
3. Validate a draft of the new post. To validate a draft, you can run zola serve and navigate to the localhost url that it provides to see your changes. 
4. When ready, commit and push the change to your GitHub repository.

```
git commit -a
git push 
```

## To do
1. Hardcoded GitHub certificate thumbprint may become outdated. This thumbprint validates GitHub's OIDC provider certificate.

> todo: Implement automatic thumbprint retrieval or periodic updates from a trusted source

2. Input validation is limited. 

> todo: ensure AWS resoure naming follow naming rules with allowed characters. Check for proper formatting before attempting Route53 operations. Validator repo names match GitHub's constraints. Sanitize site name and other inputs to prevent path traversal. Add stronger validation when handling ACM certificates and proper error handling for certificate validation failures.

3. User experience could improve e.g. support recovery and rollback in case of failures, better input validation, clearing credentials 

> todo: improve user experience and complete credential management

4. Missing test suite.

> todo: complete test infrastructure


## License

MIT