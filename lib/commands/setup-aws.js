/**
 * Set up AWS resources for a Zola site
 */

const path = require('path');
const inquirer = require('inquirer');
const logger = require('../utils/logger');
const config = require('../utils/config');
const credentials = require('../utils/credentials');
const awsService = require('../services/aws');
const githubService = require('../services/github');

/**
 * Execute the setup-aws command
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
    
    // Collect AWS information
    const awsInfo = await collectAwsInfo(options, siteConfig);
    
    // Get AWS credentials (from stored credentials or user input)
    let awsCreds = await credentials.getAwsCredentials();
    if (!awsCreds) {
      awsCreds = await credentials.promptForAwsCredentials();
    }
    
    // Create AWS clients
    const clients = awsService.createAwsClients(awsCreds, awsInfo.region);
    
    // Create resources
    logger.info('Setting up AWS resources. This process may take several minutes...');
    
    // 1. Create S3 bucket
    const bucketName = `${siteName}-${Date.now().toString().slice(-6)}`;
    const bucketResult = await awsService.createS3Bucket(clients.s3, bucketName);
    if (!bucketResult) {
      throw new Error(`Failed to create S3 bucket "${bucketName}"`);
    }
    
    // 2. Create Route53 Hosted Zone
    let hostedZoneResult = null;
    if (awsInfo.domain) {
      hostedZoneResult = await awsService.createHostedZone(clients.route53, awsInfo.domain);
      
      if (!hostedZoneResult) {
        logger.warn(`Failed to create Route53 hosted zone for "${awsInfo.domain}". You'll need to set it up manually.`);
      } else {
        logger.info(`Please update your domain registrar NS records with the nameservers listed above.`);
        logger.info(`Once your domain's nameservers are updated, DNS propagation can take up to 48 hours.`);
      }
    } else {
      logger.warn('No domain specified. Skipping Route53 setup.');
    }
    
    // 3. Request ACM certificate
    let certificateResult = null;
    if (awsInfo.domain && hostedZoneResult) {
      certificateResult = await awsService.requestCertificate(clients.acm, awsInfo.domain);
      
      if (!certificateResult) {
        logger.warn(`Failed to request ACM certificate for "${awsInfo.domain}". You'll need to set it up manually.`);
      } else {
        // Get the certificate validation records
        const validationRecords = await awsService.getCertificateValidationRecords(
          clients.acm, 
          certificateResult.certificateArn
        );
        
        if (validationRecords) {
          // Create DNS validation records in Route53
          const dnsValidationResult = await awsService.createDnsValidationRecords(
            clients.route53,
            hostedZoneResult.hostedZoneId,
            validationRecords
          );
          
          if (dnsValidationResult) {
            logger.info(`Certificate validation records created in Route53. Validation should complete automatically.`);
          } else {
            logger.warn(`Failed to create DNS validation records. You'll need to validate the certificate manually.`);
          }
        } else {
          logger.warn(`Certificate validation records not available yet. You'll need to validate the certificate manually.`);
        }
      }
    } else if (awsInfo.domain) {
      // Domain provided but no hosted zone
      certificateResult = await awsService.requestCertificate(clients.acm, awsInfo.domain);
      
      if (!certificateResult) {
        logger.warn(`Failed to request ACM certificate for "${awsInfo.domain}". You'll need to set it up manually.`);
      } else {
        logger.info(`Certificate requested. You'll need to validate it through DNS validation before it can be used.`);
      }
    } else {
      logger.warn('No domain specified. Skipping ACM certificate request.');
    }
    
    // 4. Create CloudFront function
    const functionName = `${siteName}-redirect-function`;
    const functionResult = await awsService.createCloudfrontFunction(
      clients.cloudfront, 
      functionName
    );
    
    if (!functionResult) {
      logger.warn(`Failed to create CloudFront function "${functionName}". You'll need to set it up manually.`);
    }
    
    // 5. Create CloudFront distribution
    let distributionResult = null;
    if (functionResult) {
      // If we have a domain and certificate, wait for certificate validation before proceeding
      let certificateValidated = true; // Default to true if no certificate to validate
      
      if (awsInfo.domain && certificateResult && certificateResult.certificateArn) {
        // Wait for certificate validation to complete
        certificateValidated = await awsService.waitForCertificateValidation(
          clients.acm, 
          certificateResult.certificateArn
        );
        
        if (!certificateValidated) {
          logger.warn('Proceeding with CloudFront distribution creation, but it may fail due to certificate not being fully validated.');
          logger.info('If distribution creation fails, you can try again later when the certificate is validated.');
        }
      }
      
      // Create the CloudFront distribution
      distributionResult = await awsService.createCloudFrontDistribution(
        clients.cloudfront,
        bucketName,
        awsInfo.domain,
        certificateResult ? certificateResult.certificateArn : null,
        functionResult.functionArn
      );
      
      if (!distributionResult) {
        logger.warn(`Failed to create CloudFront distribution. You'll need to set it up manually.`);
      } else {
        logger.info(`CloudFront distribution created. It may take up to 15 minutes to deploy globally.`);
        
        // Update S3 bucket policy to allow CloudFront access
        await awsService.updateS3BucketPolicy(
          clients.s3,
          bucketName,
          distributionResult.distributionArn
        );
        
        // Create DNS A record for the CloudFront distribution if we have a hosted zone
        if (hostedZoneResult && awsInfo.domain) {
          await awsService.createCloudFrontDnsRecords(
            clients.route53,
            hostedZoneResult.hostedZoneId,
            awsInfo.domain,
            distributionResult.distributionDomain
          );
        }
      }
    } else {
      logger.warn('CloudFront function not created. Skipping CloudFront distribution setup.');
    }
    
    // 6. Create IAM policy and role for GitHub Actions
    // This requires GitHub repository information
    if (siteConfig.githubUsername && siteConfig.repo) {
      const policyName = `${siteName}-deploy-policy`;
      const roleName = `${siteName}-github-actions-role`;
      const githubRepo = `${siteConfig.githubUsername}/${siteConfig.repo}`;
      
      const s3BucketArn = bucketResult.bucketArn;
      const cloudfrontDistributionArn = distributionResult ? 
        distributionResult.distributionArn : 
        'arn:aws:cloudfront::123456789012:distribution/placeholder';
      
      const policyResult = await awsService.createIamPolicy(
        clients.iam, 
        policyName, 
        s3BucketArn, 
        cloudfrontDistributionArn
      );
      
      if (!policyResult) {
        logger.warn(`Failed to create IAM policy "${policyName}". You'll need to set it up manually.`);
      } else {
        const roleResult = await awsService.createIamRole(
          clients.iam, 
          roleName, 
          policyResult.policyArn, 
          githubRepo
        );
        
        if (!roleResult) {
          logger.warn(`Failed to create IAM role "${roleName}". You'll need to set it up manually.`);
        } else {
          // Update GitHub workflow file
          const sitePath = path.join(process.cwd(), siteName);
          await githubService.createWorkflowFile(sitePath, {
            s3BucketName: bucketName,
            awsRegion: awsInfo.region,
            iamRoleArn: roleResult.roleArn,
            cloudfrontDistributionId: distributionResult ? distributionResult.distributionId : 'YOUR_CLOUDFRONT_DISTRIBUTION_ID'
          });
        }
      }
    } else {
      logger.warn('GitHub repository information not found. Skipping IAM policy and role setup.');
      logger.info('Please run "ssc setup-github" before "ssc setup-aws" for complete integration.');
    }
    
    // Update site config
    siteConfig.domain = awsInfo.domain;
    siteConfig.awsRegion = awsInfo.region;
    siteConfig.s3BucketName = bucketName;
    siteConfig.s3BucketArn = bucketResult.bucketArn;
    
    if (hostedZoneResult) {
      siteConfig.route53HostedZoneId = hostedZoneResult.hostedZoneId;
    }
    
    if (certificateResult) {
      siteConfig.acmCertificateArn = certificateResult.certificateArn;
    }
    
    if (functionResult) {
      siteConfig.cloudfrontFunctionArn = functionResult.functionArn;
    }
    
    if (distributionResult) {
      siteConfig.cloudfrontDistributionId = distributionResult.distributionId;
      siteConfig.cloudfrontDistributionArn = distributionResult.distributionArn;
      siteConfig.cloudfrontDomain = distributionResult.distributionDomain;
    }
    
    config.saveSiteConfig(siteName, siteConfig);
    
    return siteConfig;
  } catch (error) {
    logger.error(`Setup AWS command failed: ${error.message}`, error);
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
      message: 'Which site would you like to set up on AWS?',
      choices: sites.map(site => site.siteName)
    }
  ]);
  
  return siteName;
}

/**
 * Collect AWS information from user input
 * @param {object} options - Command options
 * @param {object} siteConfig - Site configuration
 * @returns {Promise<object>} - AWS information
 */
async function collectAwsInfo(options, siteConfig) {
  const questions = [];
  
  // Domain
  if (!options.domain && !siteConfig.domain) {
    questions.push({
      type: 'input',
      name: 'domain',
      message: 'What domain will you use for your site? (e.g., example.com)',
      validate: input => {
        if (!input) return 'Domain is required for AWS setup';
        if (!/^[a-zA-Z0-9][a-zA-Z0-9-]{1,61}[a-zA-Z0-9]\.[a-zA-Z]{2,}$/.test(input)) {
          return 'Please enter a valid domain name (e.g., example.com)';
        }
        return true;
      }
    });
  }
  
  // AWS region
  if (!options.awsRegion && !siteConfig.awsRegion) {
    questions.push({
      type: 'list',
      name: 'region',
      message: 'Which AWS region would you like to use?',
      default: 'us-east-1',
      choices: [
        { name: 'US East (N. Virginia)', value: 'us-east-1' },
        { name: 'US East (Ohio)', value: 'us-east-2' },
        { name: 'US West (Oregon)', value: 'us-west-2' },
        { name: 'EU (Ireland)', value: 'eu-west-1' },
        { name: 'EU (Frankfurt)', value: 'eu-central-1' },
        { name: 'Asia Pacific (Tokyo)', value: 'ap-northeast-1' },
        { name: 'Asia Pacific (Singapore)', value: 'ap-southeast-1' },
        { name: 'Asia Pacific (Sydney)', value: 'ap-southeast-2' }
      ]
    });
  }
  
  // Prompt user for inputs
  const answers = questions.length > 0 ? await inquirer.prompt(questions) : {};
  
  return {
    domain: options.domain || siteConfig.domain || answers.domain,
    region: options.awsRegion || siteConfig.awsRegion || answers.region || 'us-east-1'
  };
}

module.exports = {
  execute
};