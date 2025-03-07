/**
 * AWS service for managing AWS resources
 */

const { 
  S3Client, 
  CreateBucketCommand,
  PutBucketPolicyCommand
} = require('@aws-sdk/client-s3');

const {
  Route53Client,
  CreateHostedZoneCommand,
  GetHostedZoneCommand,
  ChangeResourceRecordSetsCommand
} = require('@aws-sdk/client-route-53');

const {
  ACMClient,
  RequestCertificateCommand,
  DescribeCertificateCommand
} = require('@aws-sdk/client-acm');

const {
  CloudFrontClient,
  CreateDistributionCommand,
  CreateFunctionCommand,
  PublishFunctionCommand,
  CreateInvalidationCommand
} = require('@aws-sdk/client-cloudfront');

const {
  IAMClient,
  CreatePolicyCommand,
  CreateRoleCommand,
  AttachRolePolicyCommand,
  ListOpenIDConnectProvidersCommand,
  GetOpenIDConnectProviderCommand,
  CreateOpenIDConnectProviderCommand
} = require('@aws-sdk/client-iam');

const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

/**
 * Create AWS clients with the provided credentials
 * @param {object} credentials - AWS credentials
 * @param {string} region - AWS region
 * @returns {object} - Object containing AWS clients
 */
function createAwsClients(credentials, region) {
  const clientConfig = {
    region,
    credentials: {
      accessKeyId: credentials.accessKeyId,
      secretAccessKey: credentials.secretAccessKey
    }
  };
  
  // Create a separate config for ACM since it needs to be in us-east-1 for CloudFront
  const acmConfig = {
    region: 'us-east-1',
    credentials: {
      accessKeyId: credentials.accessKeyId,
      secretAccessKey: credentials.secretAccessKey
    }
  };
  
  return {
    s3: new S3Client(clientConfig),
    route53: new Route53Client(clientConfig),
    acm: new ACMClient(acmConfig),
    cloudfront: new CloudFrontClient(clientConfig),
    iam: new IAMClient(clientConfig)
  };
}

/**
 * Create an S3 bucket
 * @param {S3Client} s3Client - AWS S3 client
 * @param {string} bucketName - Name of the bucket
 * @returns {Promise<object|null>} - Bucket data or null if creation failed
 */
async function createS3Bucket(s3Client, bucketName) {
  try {
    logger.startSpinner(`Creating S3 bucket "${bucketName}"...`);
    
    const command = new CreateBucketCommand({
      Bucket: bucketName,
      // Block all public access by default
      // CloudFront will access it through Origin Access Control
    });
    
    const response = await s3Client.send(command);
    
    logger.succeed(`S3 bucket "${bucketName}" created`);
    return {
      bucketName,
      bucketArn: `arn:aws:s3:::${bucketName}`,
      location: response.Location
    };
  } catch (error) {
    logger.fail(`Failed to create S3 bucket "${bucketName}"`);
    logger.error(error.message);
    return null;
  }
}

/**
 * Update S3 bucket policy to allow CloudFront access
 * @param {S3Client} s3Client - AWS S3 client
 * @param {string} bucketName - Name of the bucket
 * @param {string} cloudFrontDistributionArn - CloudFront distribution ARN
 * @returns {Promise<boolean>} - Whether the update was successful
 */
async function updateS3BucketPolicy(s3Client, bucketName, cloudFrontDistributionArn) {
  try {
    logger.startSpinner(`Updating S3 bucket policy for "${bucketName}"...`);
    
    const policy = {
      Version: '2008-10-17',
      Id: 'PolicyForCloudFrontPrivateContent',
      Statement: [
        {
          Sid: 'AllowCloudFrontServicePrincipal',
          Effect: 'Allow',
          Principal: {
            Service: 'cloudfront.amazonaws.com'
          },
          Action: 's3:GetObject',
          Resource: `arn:aws:s3:::${bucketName}/*`,
          Condition: {
            StringEquals: {
              'AWS:SourceArn': cloudFrontDistributionArn
            }
          }
        }
      ]
    };
    
    const command = new PutBucketPolicyCommand({
      Bucket: bucketName,
      Policy: JSON.stringify(policy)
    });
    
    await s3Client.send(command);
    
    logger.succeed(`S3 bucket policy updated for "${bucketName}"`);
    return true;
  } catch (error) {
    logger.fail(`Failed to update S3 bucket policy for "${bucketName}"`);
    logger.error(error.message);
    return false;
  }
}

/**
 * Create Route53 hosted zone
 * @param {Route53Client} route53Client - AWS Route53 client
 * @param {string} domainName - Domain name
 * @returns {Promise<object|null>} - Hosted zone data or null if creation failed
 */
async function createHostedZone(route53Client, domainName) {
  try {
    logger.startSpinner(`Creating Route53 hosted zone for "${domainName}"...`);
    
    const command = new CreateHostedZoneCommand({
      Name: domainName,
      CallerReference: Date.now().toString()
    });
    
    const response = await route53Client.send(command);
    
    logger.succeed(`Route53 hosted zone created for "${domainName}"`);
    logger.info('Please update your domain registrar NS records with the following name servers:');
    
    response.DelegationSet.NameServers.forEach((ns, i) => {
      logger.info(`  ${i + 1}. ${ns}`);
    });
    
    return {
      hostedZoneId: response.HostedZone.Id,
      nameServers: response.DelegationSet.NameServers
    };
  } catch (error) {
    logger.fail(`Failed to create Route53 hosted zone for "${domainName}"`);
    logger.error(error.message);
    return null;
  }
}

/**
 * Request ACM certificate
 * @param {ACMClient} acmClient - AWS ACM client
 * @param {string} domainName - Domain name
 * @returns {Promise<object|null>} - Certificate data or null if request failed
 */
async function requestCertificate(acmClient, domainName) {
  try {
    logger.startSpinner(`Requesting ACM certificate for "${domainName}"...`);
    
    const command = new RequestCertificateCommand({
      DomainName: domainName,
      ValidationMethod: 'DNS'
    });
    
    const response = await acmClient.send(command);
    const certificateArn = response.CertificateArn;
    
    logger.succeed(`ACM certificate requested for "${domainName}"`);
    logger.info(`Certificate ARN: ${certificateArn}`);
    
    return {
      certificateArn,
      domainValidationRecords: null // Will be populated by the getValidationRecords function
    };
  } catch (error) {
    logger.fail(`Failed to request ACM certificate for "${domainName}"`);
    logger.error(error.message);
    return null;
  }
}

/**
 * Get certificate validation records
 * @param {ACMClient} acmClient - AWS ACM client
 * @param {string} certificateArn - Certificate ARN
 * @returns {Promise<Array|null>} - Validation records or null if retrieval failed
 */
async function getCertificateValidationRecords(acmClient, certificateArn) {
  try {
    logger.startSpinner('Retrieving certificate validation records...');
    
    // Certificate details might not be immediately available, so we need to retry a few times
    let retries = 0;
    const maxRetries = 5;
    let validationRecords = null;
    
    while (retries < maxRetries && !validationRecords) {
      try {
        const command = new DescribeCertificateCommand({
          CertificateArn: certificateArn
        });
        
        const response = await acmClient.send(command);
        const certificate = response.Certificate;
        
        // Check if validation records are available
        if (certificate.DomainValidationOptions && 
            certificate.DomainValidationOptions.length > 0 && 
            certificate.DomainValidationOptions[0].ResourceRecord) {
          
          validationRecords = certificate.DomainValidationOptions.map(option => {
            if (option.ResourceRecord) {
              return {
                name: option.ResourceRecord.Name,
                type: option.ResourceRecord.Type,
                value: option.ResourceRecord.Value
              };
            }
            return null;
          }).filter(record => record !== null);
          
          break;
        }
      } catch (err) {
        // Ignore errors during retries
      }
      
      // Wait before retrying
      retries++;
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
    
    if (!validationRecords) {
      logger.warn('Certificate validation records not available yet. Please check ACM console to add them manually.');
      return null;
    }
    
    logger.succeed(`Retrieved ${validationRecords.length} certificate validation records`);
    return validationRecords;
  } catch (error) {
    logger.fail('Failed to retrieve certificate validation records');
    logger.error(error.message);
    return null;
  }
}

/**
 * Wait for ACM certificate to be validated and ready for use
 * @param {ACMClient} acmClient - AWS ACM client
 * @param {string} certificateArn - Certificate ARN
 * @param {number} maxWaitMinutes - Maximum time to wait in minutes (default: 15)
 * @returns {Promise<boolean>} - Whether certificate is valid
 */
async function waitForCertificateValidation(acmClient, certificateArn, maxWaitMinutes = 15) {
  try {
    logger.startSpinner('Waiting for certificate validation...');
    logger.info(`This process may take up to ${maxWaitMinutes} minutes.`);
    logger.info('Certificate validation requires the DNS records to propagate, which can take time.');
    
    const maxAttempts = maxWaitMinutes * 2; // Check every 30 seconds
    let attempts = 0;
    let isValid = false;
    
    while (attempts < maxAttempts && !isValid) {
      try {
        const command = new DescribeCertificateCommand({
          CertificateArn: certificateArn
        });
        
        const response = await acmClient.send(command);
        const certificate = response.Certificate;
        
        // Check certificate status
        if (certificate.Status === 'ISSUED') {
          isValid = true;
          break;
        } else if (certificate.Status === 'FAILED') {
          logger.fail(`Certificate validation failed: ${certificate.FailureReason || 'Unknown reason'}`);
          return false;
        } else {
          // Still pending, wait and retry
          const minutesElapsed = Math.floor(attempts / 2);
          const minutesRemaining = maxWaitMinutes - minutesElapsed;
          
          if (attempts % 4 === 0) { // Only log every 2 minutes
            logger.info(`Certificate status: ${certificate.Status}. Continuing to wait... (${minutesElapsed} minutes elapsed, up to ${minutesRemaining} minutes remaining)`);
          }
        }
      } catch (err) {
        logger.warn(`Error checking certificate status: ${err.message}. Retrying...`);
      }
      
      // Wait 30 seconds before checking again
      attempts++;
      await new Promise(resolve => setTimeout(resolve, 30000));
    }
    
    if (isValid) {
      logger.succeed('Certificate is now validated and ready to use!');
      return true;
    } else {
      logger.warn(`Certificate validation timed out after ${maxWaitMinutes} minutes.`);
      logger.info('The CloudFront distribution creation may fail. You may need to try again later when the certificate is validated.');
      return false;
    }
  } catch (error) {
    logger.fail('Failed to wait for certificate validation');
    logger.error(error.message);
    return false;
  }
}

/**
 * Create DNS validation records in Route53
 * @param {Route53Client} route53Client - AWS Route53 client
 * @param {string} hostedZoneId - Hosted zone ID
 * @param {Array} validationRecords - Validation records from ACM
 * @returns {Promise<boolean>} - Whether the creation was successful
 */
async function createDnsValidationRecords(route53Client, hostedZoneId, validationRecords) {
  try {
    logger.startSpinner('Creating DNS validation records in Route53...');
    
    // Extract the hosted zone ID from the ARN if needed
    const zoneId = hostedZoneId.replace(/^\/hostedzone\//, '');
    
    // Create changes for each validation record
    const changes = validationRecords.map(record => ({
      Action: 'UPSERT',
      ResourceRecordSet: {
        Name: record.name,
        Type: record.type,
        TTL: 300,
        ResourceRecords: [
          {
            Value: record.value
          }
        ]
      }
    }));
    
    const command = new ChangeResourceRecordSetsCommand({
      HostedZoneId: zoneId,
      ChangeBatch: {
        Comment: 'ACM certificate validation records',
        Changes: changes
      }
    });
    
    await route53Client.send(command);
    
    logger.succeed('DNS validation records created in Route53');
    logger.info('Certificate validation should complete automatically within 30 minutes');
    
    return true;
  } catch (error) {
    logger.fail('Failed to create DNS validation records in Route53');
    logger.error(error.message);
    return false;
  }
}

/**
 * Create DNS A and AAAA records for CloudFront distribution
 * @param {Route53Client} route53Client - AWS Route53 client
 * @param {string} hostedZoneId - Hosted zone ID
 * @param {string} domainName - Domain name
 * @param {string} distributionDomain - CloudFront distribution domain name
 * @returns {Promise<boolean>} - Whether the creation was successful
 */
async function createCloudFrontDnsRecords(route53Client, hostedZoneId, domainName, distributionDomain) {
  try {
    logger.startSpinner(`Creating DNS A and AAAA records for ${domainName} pointing to CloudFront...`);
    
    // Extract the hosted zone ID from the ARN if needed
    const zoneId = hostedZoneId.replace(/^\/hostedzone\//, '');
    
    // Create both A (IPv4) and AAAA (IPv6) records as aliases to the CloudFront distribution
    // CloudFront has a fixed hosted zone ID of Z2FDTNDATAQYW2
    const changes = [
      // A record for IPv4
      {
        Action: 'UPSERT',
        ResourceRecordSet: {
          Name: domainName,
          Type: 'A',
          AliasTarget: {
            HostedZoneId: 'Z2FDTNDATAQYW2', // CloudFront always uses this hosted zone ID
            DNSName: distributionDomain,
            EvaluateTargetHealth: false
          }
        }
      },
      // AAAA record for IPv6
      {
        Action: 'UPSERT',
        ResourceRecordSet: {
          Name: domainName,
          Type: 'AAAA',
          AliasTarget: {
            HostedZoneId: 'Z2FDTNDATAQYW2', // CloudFront always uses this hosted zone ID
            DNSName: distributionDomain,
            EvaluateTargetHealth: false
          }
        }
      }
    ];
    
    const command = new ChangeResourceRecordSetsCommand({
      HostedZoneId: zoneId,
      ChangeBatch: {
        Comment: 'CloudFront DNS A and AAAA records',
        Changes: changes
      }
    });
    
    await route53Client.send(command);
    
    logger.succeed(`DNS A and AAAA records created for ${domainName}`);
    logger.info('DNS propagation can take up to 48 hours, but usually happens much faster');
    
    return true;
  } catch (error) {
    logger.fail(`Failed to create DNS records for ${domainName}`);
    logger.error(error.message);
    return false;
  }
}

/**
 * Get CloudFront function code
 * @returns {string} - CloudFront function code
 */
function getCloudfrontFunctionCode() {
  return `
async function handler(event) {
    var request = event.request;
    var uri = request.uri;
    
    // Check whether the URI is missing a file name.
    if (uri.endsWith('/')) {
        request.uri += 'index.html';
    } 
    // Check whether the URI is missing a file extension.
    else if (!uri.includes('.')) {
        request.uri += '/index.html';
    }

    return request;
}
`;
}

/**
 * Create CloudFront function
 * @param {CloudFrontClient} cloudfrontClient - AWS CloudFront client
 * @param {string} functionName - Function name
 * @returns {Promise<object|null>} - Function data or null if creation failed
 */
async function createCloudfrontFunction(cloudfrontClient, functionName) {
  try {
    logger.startSpinner(`Creating CloudFront function "${functionName}"...`);
    
    const functionCode = getCloudfrontFunctionCode();
    
    const createCommand = new CreateFunctionCommand({
      Name: functionName,
      FunctionConfig: {
        Comment: 'Redirects for SPA',
        Runtime: 'cloudfront-js-1.0'
      },
      FunctionCode: Buffer.from(functionCode)
    });
    
    const createResponse = await cloudfrontClient.send(createCommand);
    
    // Wait a moment before publishing
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Publish the function
    const publishCommand = new PublishFunctionCommand({
      Name: functionName,
      IfMatch: createResponse.ETag
    });
    
    const publishResponse = await cloudfrontClient.send(publishCommand);
    
    logger.succeed(`CloudFront function "${functionName}" created and published`);
    
    return {
      functionName,
      functionArn: publishResponse.FunctionSummary.FunctionMetadata.FunctionARN
    };
  } catch (error) {
    logger.fail(`Failed to create CloudFront function "${functionName}"`);
    logger.error(error.message);
    return null;
  }
}

/**
 * Create IAM policy for GitHub Actions
 * @param {IAMClient} iamClient - AWS IAM client
 * @param {string} policyName - Policy name
 * @param {string} s3BucketArn - S3 bucket ARN
 * @param {string} cloudFrontDistributionArn - CloudFront distribution ARN
 * @returns {Promise<object|null>} - Policy data or null if creation failed
 */
async function createIamPolicy(iamClient, policyName, s3BucketArn, cloudFrontDistributionArn) {
  try {
    logger.startSpinner(`Creating IAM policy "${policyName}"...`);
    
    const policyDocument = {
      Version: '2012-10-17',
      Statement: [
        {
          Sid: 'Statement0',
          Effect: 'Allow',
          Action: [
            's3:PutObject',
            's3:GetObject',
            's3:ListBucket',
            's3:DeleteObject',
            'cloudfront:CreateInvalidation'
          ],
          Resource: [
            `${s3BucketArn}/*`,
            s3BucketArn,
            cloudFrontDistributionArn
          ]
        }
      ]
    };
    
    const command = new CreatePolicyCommand({
      PolicyName: policyName,
      PolicyDocument: JSON.stringify(policyDocument)
    });
    
    const response = await iamClient.send(command);
    
    logger.succeed(`IAM policy "${policyName}" created`);
    
    return {
      policyName,
      policyArn: response.Policy.Arn
    };
  } catch (error) {
    logger.fail(`Failed to create IAM policy "${policyName}"`);
    logger.error(error.message);
    return null;
  }
}

/**
 * Create or get OpenID Connect Provider for GitHub Actions
 * @param {IAMClient} iamClient - AWS IAM client
 * @returns {Promise<string|null>} - OIDC Provider ARN or null if creation failed
 */
async function createOrGetGithubOidcProvider(iamClient) {
  try {
    logger.startSpinner('Setting up GitHub Actions OIDC provider...');
    
    // First, check if the GitHub OIDC provider already exists
    let providerArn = null;
    
    try {
      // List all OIDC providers
      const listCommand = new ListOpenIDConnectProvidersCommand({});
      const listResponse = await iamClient.send(listCommand);
      
      // Look for GitHub provider by iterating through providers
      const providers = listResponse.OpenIDConnectProviderList || [];
      for (const provider of providers) {
        try {
          // Get provider details to check URL
          const getCommand = new GetOpenIDConnectProviderCommand({
            OpenIDConnectProviderArn: provider.Arn
          });
          
          const getResponse = await iamClient.send(getCommand);
          
          // If this is the GitHub provider, save the ARN
          if (getResponse.Url === 'token.actions.githubusercontent.com') {
            providerArn = provider.Arn;
            logger.info('GitHub Actions OIDC provider already exists');
            break;
          }
        } catch (getError) {
          // Skip this provider if we can't get its details
          logger.warn(`Could not get provider details: ${getError.message}`);
          continue;
        }
      }
    } catch (listError) {
      logger.warn(`Could not list existing OIDC providers: ${listError.message}`);
      // Continue to try creating a new one
    }
    
    // If provider doesn't exist, create it
    if (!providerArn) {
      try {
        // Create the OIDC provider with GitHub's URL and thumbprint
        const createCommand = new CreateOpenIDConnectProviderCommand({
          Url: 'https://token.actions.githubusercontent.com',
          ClientIDList: ['sts.amazonaws.com'],
          ThumbprintList: ['6938fd4d98bab03faadb97b34396831e3780aea1'] // GitHub's thumbprint
        });
        
        const createResponse = await iamClient.send(createCommand);
        providerArn = createResponse.OpenIDConnectProviderArn;
        
        logger.succeed('GitHub Actions OIDC provider created successfully');
      } catch (createError) {
        // If provider already exists but we couldn't find it before
        if (createError.name === 'EntityAlreadyExistsException') {
          logger.info('GitHub Actions OIDC provider already exists, but we could not find it earlier');
          
          // Try to get the ARN again
          try {
            const listCommand = new ListOpenIDConnectProvidersCommand({});
            const listResponse = await iamClient.send(listCommand);
            
            // Look for GitHub provider again
            const providers = listResponse.OpenIDConnectProviderList || [];
            for (const provider of providers) {
              try {
                const getCommand = new GetOpenIDConnectProviderCommand({
                  OpenIDConnectProviderArn: provider.Arn
                });
                
                const getResponse = await iamClient.send(getCommand);
                
                if (getResponse.Url === 'token.actions.githubusercontent.com') {
                  providerArn = provider.Arn;
                  break;
                }
              } catch (error) {
                continue; // Skip this provider
              }
            }
          } catch (error) {
            logger.warn(`Could not get existing OIDC provider ARN: ${error.message}`);
          }
        } else {
          // Handle other errors
          logger.error(`Failed to create OIDC provider: ${createError.message}`);
          throw createError;
        }
      }
    }
    
    if (!providerArn) {
      throw new Error('Failed to get or create GitHub OIDC provider');
    }
    
    logger.succeed('GitHub Actions OIDC provider configured');
    return providerArn;
  } catch (error) {
    logger.fail('Failed to set up GitHub Actions OIDC provider');
    logger.error(error.message);
    return null;
  }
}

/**
 * Create IAM role for GitHub Actions
 * @param {IAMClient} iamClient - AWS IAM client
 * @param {string} roleName - Role name
 * @param {string} policyArn - Policy ARN
 * @param {string} githubRepo - GitHub repository (format: owner/repo)
 * @returns {Promise<object|null>} - Role data or null if creation failed
 */
async function createIamRole(iamClient, roleName, policyArn, githubRepo) {
  try {
    logger.startSpinner(`Creating IAM role "${roleName}"...`);
    
    // First, ensure the GitHub OIDC provider exists
    const providerArn = await createOrGetGithubOidcProvider(iamClient);
    if (!providerArn) {
      throw new Error('GitHub OIDC provider not available. IAM role creation aborted.');
    }
    
    // Trust relationship for GitHub Actions
    const assumeRolePolicyDocument = {
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Principal: {
            Federated: providerArn
          },
          Action: 'sts:AssumeRoleWithWebIdentity',
          Condition: {
            StringEquals: {
              'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com'
            },
            StringLike: {
              'token.actions.githubusercontent.com:sub': `repo:${githubRepo}:*`
            }
          }
        }
      ]
    };
    
    // Create the role
    const createRoleCommand = new CreateRoleCommand({
      RoleName: roleName,
      AssumeRolePolicyDocument: JSON.stringify(assumeRolePolicyDocument)
    });
    
    const roleResponse = await iamClient.send(createRoleCommand);
    
    // Attach the policy to the role
    const attachPolicyCommand = new AttachRolePolicyCommand({
      RoleName: roleName,
      PolicyArn: policyArn
    });
    
    await iamClient.send(attachPolicyCommand);
    
    logger.succeed(`IAM role "${roleName}" created with policy attached`);
    
    return {
      roleName,
      roleArn: roleResponse.Role.Arn
    };
  } catch (error) {
    logger.fail(`Failed to create IAM role "${roleName}"`);
    logger.error(error.message);
    return null;
  }
}

/**
 * Create CloudFront distribution
 * @param {CloudFrontClient} cloudfrontClient - AWS CloudFront client
 * @param {string} bucketName - S3 bucket name
 * @param {string} domainName - Domain name (optional)
 * @param {string} certificateArn - ACM certificate ARN (required if domainName is provided)
 * @param {string} functionArn - CloudFront function ARN
 * @returns {Promise<object|null>} - Distribution data or null if creation failed
 */
async function createCloudFrontDistribution(cloudfrontClient, bucketName, domainName, certificateArn, functionArn) {
  try {
    logger.startSpinner(`Creating CloudFront distribution for "${bucketName}"...`);
    
    // Create distribution config
    const distributionConfig = {
      CallerReference: Date.now().toString(),
      Comment: `Distribution for ${bucketName}`,
      DefaultRootObject: 'index.html',
      Enabled: true,
      
      // Origin configuration for S3 bucket
      Origins: {
        Quantity: 1,
        Items: [
          {
            Id: 'S3Origin',
            DomainName: `${bucketName}.s3.amazonaws.com`,
            S3OriginConfig: {
              OriginAccessIdentity: ''
            }
          }
        ]
      },
      
      // Default cache behavior
      DefaultCacheBehavior: {
        TargetOriginId: 'S3Origin',
        ViewerProtocolPolicy: 'redirect-to-https',
        AllowedMethods: {
          Quantity: 2,
          Items: ['GET', 'HEAD'],
          CachedMethods: {
            Quantity: 2,
            Items: ['GET', 'HEAD']
          }
        },
        Compress: true,
        DefaultTTL: 86400,
        MinTTL: 0,
        MaxTTL: 31536000,
        ForwardedValues: {
          QueryString: false,
          Cookies: {
            Forward: 'none'
          },
          Headers: {
            Quantity: 0
          },
          QueryStringCacheKeys: {
            Quantity: 0
          }
        },
        
        // Add the CloudFront function if provided
        FunctionAssociations: functionArn ? {
          Quantity: 1,
          Items: [
            {
              FunctionARN: functionArn,
              EventType: 'viewer-request'
            }
          ]
        } : { Quantity: 0 }
      },
      
      // Custom error responses
      CustomErrorResponses: {
        Quantity: 1,
        Items: [
          {
            ErrorCode: 404,
            ResponsePagePath: '/index.html',
            ResponseCode: '200',
            ErrorCachingMinTTL: 300
          }
        ]
      },
      
      // Price class
      PriceClass: 'PriceClass_100', // Use only US, Canada and Europe
      
      // Enabled, Logging, etc.
      Enabled: true,
      Logging: {
        Enabled: false,
        IncludeCookies: false,
        Bucket: '',
        Prefix: ''
      },
      
      // Aliases and viewer certificate for custom domain
      Aliases: { 
        Quantity: domainName ? 1 : 0,
        Items: domainName ? [domainName] : []
      },
      
      // Certificate configuration
      ViewerCertificate: domainName && certificateArn ? {
        ACMCertificateArn: certificateArn,
        SSLSupportMethod: 'sni-only',
        MinimumProtocolVersion: 'TLSv1.2_2021'
      } : {
        CloudFrontDefaultCertificate: true
      }
    };
    
    const command = new CreateDistributionCommand({
      DistributionConfig: distributionConfig
    });
    
    const response = await cloudfrontClient.send(command);
    
    logger.succeed(`CloudFront distribution created with ID: ${response.Distribution.Id}`);
    logger.info(`Distribution domain name: ${response.Distribution.DomainName}`);
    
    return {
      distributionId: response.Distribution.Id,
      distributionArn: response.Distribution.ARN,
      distributionDomain: response.Distribution.DomainName
    };
  } catch (error) {
    logger.fail(`Failed to create CloudFront distribution`);
    logger.error(error.message);
    return null;
  }
}

module.exports = {
  createAwsClients,
  createS3Bucket,
  updateS3BucketPolicy,
  createHostedZone,
  requestCertificate,
  getCertificateValidationRecords,
  waitForCertificateValidation,
  createDnsValidationRecords,
  createCloudFrontDnsRecords,
  createCloudfrontFunction,
  createCloudFrontDistribution,
  createIamPolicy,
  createOrGetGithubOidcProvider,
  createIamRole
};