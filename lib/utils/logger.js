/**
 * Logger utility for the static site creator
 * Provides consistent logging and UI feedback
 */

const chalk = require('chalk');
const ora = require('ora');

let spinner = null;

/**
 * Start a spinner with the given message
 * @param {string} message - Message to display
 * @returns {object} - Spinner instance
 */
function startSpinner(message) {
  if (spinner) {
    spinner.stop();
  }
  
  spinner = ora({
    text: message,
    color: 'cyan'
  }).start();
  
  return spinner;
}

/**
 * Update the current spinner message
 * @param {string} message - New message
 */
function updateSpinner(message) {
  if (spinner) {
    spinner.text = message;
  } else {
    spinner = startSpinner(message);
  }
}

/**
 * Stop the spinner with success
 * @param {string} message - Success message (optional)
 */
function succeed(message) {
  if (spinner) {
    spinner.succeed(message);
    spinner = null;
  } else if (message) {
    console.log(chalk.green(`✓ ${message}`));
  }
}

/**
 * Stop the spinner with failure
 * @param {string} message - Error message (optional)
 */
function fail(message) {
  if (spinner) {
    spinner.fail(message);
    spinner = null;
  } else if (message) {
    console.error(chalk.red(`✗ ${message}`));
  }
}

/**
 * Log an info message
 * @param {string} message - Message to log
 */
function info(message) {
  const wasSpinning = spinner !== null;
  const text = spinner?.text;
  
  if (wasSpinning) {
    spinner.stop();
  }
  
  console.log(chalk.blue(`ℹ ${message}`));
  
  if (wasSpinning) {
    spinner = ora({
      text,
      color: 'cyan'
    }).start();
  }
}

/**
 * Log a warning message
 * @param {string} message - Message to log
 */
function warn(message) {
  const wasSpinning = spinner !== null;
  const text = spinner?.text;
  
  if (wasSpinning) {
    spinner.stop();
  }
  
  console.log(chalk.yellow(`⚠ ${message}`));
  
  if (wasSpinning) {
    spinner = ora({
      text,
      color: 'cyan'
    }).start();
  }
}

/**
 * Log an error message
 * @param {string} message - Message to log
 * @param {Error} error - Error object (optional)
 */
function error(message, error) {
  const wasSpinning = spinner !== null;
  
  if (wasSpinning) {
    spinner.stop();
    spinner = null;
  }
  
  console.error(chalk.red(`✗ ${message}`));
  
  if (error && error.stack) {
    console.error(chalk.red(error.stack));
  }
}

/**
 * Log a success message
 * @param {string} message - Message to log
 */
function success(message) {
  const wasSpinning = spinner !== null;
  
  if (wasSpinning) {
    spinner.stop();
    spinner = null;
  }
  
  console.log(chalk.green(`✓ ${message}`));
}

module.exports = {
  startSpinner,
  updateSpinner,
  succeed,
  fail,
  info,
  warn,
  error,
  success
};