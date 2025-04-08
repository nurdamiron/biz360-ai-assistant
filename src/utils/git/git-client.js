/**
 * Unified Git client for performing Git operations
 * Consolidates functionality from different git clients in the project
 */

const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
const path = require('path');
const fs = require('fs');
const logger = require('../logger');

/**
 * Git client class for handling Git operations
 */
class GitClient {
  /**
   * Create a new GitClient instance
   * @param {Object} options - Configuration options
   * @param {string} options.repoPath - Path to repository
   * @param {string} options.username - Git username for operations requiring auth
   * @param {string} options.email - Git email for operations requiring auth
   * @param {string} options.token - Auth token for remote operations (optional)
   * @param {string} options.remoteUrl - Remote repository URL (optional)
   */
  constructor(options = {}) {
    this.repoPath = options.repoPath || process.cwd();
    this.username = options.username;
    this.email = options.email;
    this.token = options.token;
    this.remoteUrl = options.remoteUrl;
    
    // Ensure the repo path exists
    if (!fs.existsSync(this.repoPath)) {
      throw new Error(`Repository path does not exist: ${this.repoPath}`);
    }
  }

  /**
   * Execute a git command in the repository
   * @param {string} command - Git command to execute
   * @param {boolean} silent - Whether to suppress logging
   * @returns {Promise<{stdout: string, stderr: string}>} Command output
   * @private
   */
  async _execGit(command, silent = false) {
    const fullCommand = `git ${command}`;
    
    if (!silent) {
      logger.debug(`Executing git command: ${fullCommand}`);
    }
    
    try {
      const options = { cwd: this.repoPath };
      const result = await execPromise(fullCommand, options);
      return result;
    } catch (error) {
      logger.error(`Git command failed: ${fullCommand}`, error);
      throw error;
    }
  }

  /**
   * Initialize a new Git repository
   * @returns {Promise<boolean>} Success status
   */
  async init() {
    try {
      await this._execGit('init');
      
      // Set user info if provided
      if (this.username && this.email) {
        await this.setConfig('user.name', this.username);
        await this.setConfig('user.email', this.email);
      }
      
      return true;
    } catch (error) {
      logger.error('Failed to initialize git repository', error);
      return false;
    }
  }

  /**
   * Set a git configuration value
   * @param {string} key - Configuration key
   * @param {string} value - Configuration value
   * @returns {Promise<boolean>} Success status
   */
  async setConfig(key, value) {
    try {
      await this._execGit(`config ${key} "${value}"`);
      return true;
    } catch (error) {
      logger.error(`Failed to set git config ${key}`, error);
      return false;
    }
  }

  /**
   * Get repository status
   * @returns {Promise<string>} Git status output
   */
  async status() {
    try {
      const { stdout } = await this._execGit('status');
      return stdout;
    } catch (error) {
      logger.error('Failed to get repository status', error);
      throw error;
    }
  }

  /**
   * Get a list of files with changes
   * @returns {Promise<Array<string>>} List of changed files
   */
  async getChangedFiles() {
    try {
      const { stdout } = await this._execGit('status --porcelain');
      if (!stdout) return [];
      
      return stdout.split('\n')
        .filter(line => line.trim() !== '')
        .map(line => {
          // Extract filename, handling renames
          const match = line.trim().match(/^.{2} (.+)$/);
          if (match) {
            // Handle renamed files
            if (line.includes(' -> ')) {
              return match[1].split(' -> ')[1];
            }
            return match[1];
          }
          return null;
        })
        .filter(Boolean);
    } catch (error) {
      logger.error('Failed to get changed files', error);
      return [];
    }
  }

  /**
   * Add file(s) to git staging
   * @param {string|Array<string>} files - File(s) to add (or '.' for all)
   * @returns {Promise<boolean>} Success status
   */
  async add(files = '.') {
    try {
      const filesToAdd = Array.isArray(files) ? files.join(' ') : files;
      await this._execGit(`add ${filesToAdd}`);
      return true;
    } catch (error) {
      logger.error(`Failed to add files: ${files}`, error);
      return false;
    }
  }

  /**
   * Commit changes to the repository
   * @param {string} message - Commit message
   * @param {boolean} allowEmpty - Allow empty commits
   * @returns {Promise<boolean>} Success status
   */
  async commit(message, allowEmpty = false) {
    try {
      const emptyFlag = allowEmpty ? '--allow-empty' : '';
      await this._execGit(`commit ${emptyFlag} -m "${message}"`);
      return true;
    } catch (error) {
      // If the error is about nothing to commit, that's not a critical error
      if (error.stderr && error.stderr.includes('nothing to commit')) {
        logger.info('Nothing to commit: working tree clean');
        return true;
      }
      
      logger.error(`Failed to commit: ${message}`, error);
      return false;
    }
  }

  /**
   * Create a new branch
   * @param {string} branchName - Name of the branch to create
   * @param {boolean} checkout - Whether to checkout the branch after creating it
   * @returns {Promise<boolean>} Success status
   */
  async createBranch(branchName, checkout = false) {
    try {
      if (checkout) {
        await this._execGit(`checkout -b ${branchName}`);
      } else {
        await this._execGit(`branch ${branchName}`);
      }
      return true;
    } catch (error) {
      logger.error(`Failed to create branch: ${branchName}`, error);
      return false;
    }
  }

  /**
   * Checkout a branch
   * @param {string} branchName - Name of the branch to checkout
   * @returns {Promise<boolean>} Success status
   */
  async checkout(branchName) {
    try {
      await this._execGit(`checkout ${branchName}`);
      return true;
    } catch (error) {
      logger.error(`Failed to checkout branch: ${branchName}`, error);
      return false;
    }
  }

  /**
   * Get current branch name
   * @returns {Promise<string>} Current branch name
   */
  async getCurrentBranch() {
    try {
      const { stdout } = await this._execGit('branch --show-current');
      return stdout.trim();
    } catch (error) {
      logger.error('Failed to get current branch', error);
      throw error;
    }
  }

  /**
   * List all branches
   * @param {boolean} includeRemote - Whether to include remote branches
   * @returns {Promise<Array<string>>} List of branch names
   */
  async listBranches(includeRemote = false) {
    try {
      const command = includeRemote ? 'branch -a' : 'branch';
      const { stdout } = await this._execGit(command);
      
      return stdout.split('\n')
        .filter(line => line.trim() !== '')
        .map(line => line.trim().replace(/^\*\s+/, ''));
    } catch (error) {
      logger.error('Failed to list branches', error);
      return [];
    }
  }

  /**
   * Add a remote repository
   * @param {string} name - Remote name (e.g., 'origin')
   * @param {string} url - Remote URL
   * @returns {Promise<boolean>} Success status
   */
  async addRemote(name, url) {
    try {
      await this._execGit(`remote add ${name} ${url}`);
      return true;
    } catch (error) {
      logger.error(`Failed to add remote: ${name} ${url}`, error);
      return false;
    }
  }

  /**
   * Push to remote repository
   * @param {string} remote - Remote name
   * @param {string} branch - Branch name
   * @param {boolean} setUpstream - Set upstream tracking
   * @returns {Promise<boolean>} Success status
   */
  async push(remote = 'origin', branch = '', setUpstream = false) {
    try {
      const currentBranch = branch || await this.getCurrentBranch();
      const upstreamFlag = setUpstream ? '-u' : '';
      
      // Handle authentication for push if token is provided
      if (this.token) {
        // Parse the remote URL to insert the token
        const remoteUrl = (await this._execGit(`remote get-url ${remote}`)).stdout.trim();
        let tokenizedUrl = remoteUrl;
        
        if (remoteUrl.startsWith('https://')) {
          // Convert https://github.com/user/repo.git to https://token@github.com/user/repo.git
          tokenizedUrl = remoteUrl.replace('https://', `https://${this.token}@`);
          
          // Temporarily set the remote URL with the token
          await this._execGit(`remote set-url ${remote} ${tokenizedUrl}`, true);
          
          try {
            await this._execGit(`push ${upstreamFlag} ${remote} ${currentBranch}`);
            
            // Reset the remote URL to the original
            await this._execGit(`remote set-url ${remote} ${remoteUrl}`, true);
            return true;
          } catch (pushError) {
            // Still reset the URL even if push fails
            await this._execGit(`remote set-url ${remote} ${remoteUrl}`, true);
            throw pushError;
          }
        }
      }
      
      // Standard push without token
      await this._execGit(`push ${upstreamFlag} ${remote} ${currentBranch}`);
      return true;
    } catch (error) {
      logger.error(`Failed to push to remote: ${remote}`, error);
      return false;
    }
  }

  /**
   * Pull from remote repository
   * @param {string} remote - Remote name
   * @param {string} branch - Branch name
   * @returns {Promise<boolean>} Success status
   */
  async pull(remote = 'origin', branch = '') {
    try {
      const currentBranch = branch || await this.getCurrentBranch();
      await this._execGit(`pull ${remote} ${currentBranch}`);
      return true;
    } catch (error) {
      logger.error(`Failed to pull from remote: ${remote}`, error);
      return false;
    }
  }

  /**
   * Create a file and stage it
   * @param {string} filePath - Path to the file
   * @param {string} content - File content
   * @param {boolean} stage - Whether to stage the file after creation
   * @returns {Promise<boolean>} Success status
   */
  async createFile(filePath, content, stage = true) {
    try {
      const fullPath = path.resolve(this.repoPath, filePath);
      const dirPath = path.dirname(fullPath);
      
      // Create directory if it doesn't exist
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
      }
      
      // Write file
      fs.writeFileSync(fullPath, content);
      
      // Stage the file if requested
      if (stage) {
        await this.add(filePath);
      }
      
      return true;
    } catch (error) {
      logger.error(`Failed to create file: ${filePath}`, error);
      return false;
    }
  }

  /**
   * Get file diff
   * @param {string} filePath - Path to the file
   * @returns {Promise<string>} Diff content
   */
  async getDiff(filePath) {
    try {
      const { stdout } = await this._execGit(`diff ${filePath}`);
      return stdout;
    } catch (error) {
      logger.error(`Failed to get diff for file: ${filePath}`, error);
      throw error;
    }
  }

  /**
   * Get commit history
   * @param {number} limit - Maximum number of commits to return
   * @returns {Promise<Array<Object>>} Commit objects with hash, author, date, message
   */
  async getCommitHistory(limit = 10) {
    try {
      const format = '--pretty=format:{"hash":"%h","author":"%an","email":"%ae","date":"%ad","message":"%s"}';
      const { stdout } = await this._execGit(`log -${limit} ${format}`);
      
      return stdout.split('\n')
        .filter(line => line.trim() !== '')
        .map(line => {
          try {
            return JSON.parse(line);
          } catch (error) {
            logger.error(`Failed to parse commit log line: ${line}`, error);
            return null;
          }
        })
        .filter(Boolean);
    } catch (error) {
      logger.error('Failed to get commit history', error);
      return [];
    }
  }

  /**
   * Create a tag
   * @param {string} tagName - Name of the tag
   * @param {string} message - Tag message
   * @returns {Promise<boolean>} Success status
   */
  async createTag(tagName, message) {
    try {
      await this._execGit(`tag -a ${tagName} -m "${message}"`);
      return true;
    } catch (error) {
      logger.error(`Failed to create tag: ${tagName}`, error);
      return false;
    }
  }

  /**
   * Push tags to remote
   * @param {string} remote - Remote name
   * @returns {Promise<boolean>} Success status
   */
  async pushTags(remote = 'origin') {
    try {
      await this._execGit(`push ${remote} --tags`);
      return true;
    } catch (error) {
      logger.error(`Failed to push tags to remote: ${remote}`, error);
      return false;
    }
  }

  /**
   * Clone a repository
   * @param {string} url - Repository URL
   * @param {string} targetDir - Target directory
   * @returns {Promise<GitClient>} A new GitClient instance for the cloned repo
   * @static
   */
  static async clone(url, targetDir) {
    try {
      const cwd = path.dirname(targetDir);
      const targetName = path.basename(targetDir);
      
      // Ensure the parent directory exists
      if (!fs.existsSync(cwd)) {
        fs.mkdirSync(cwd, { recursive: true });
      }
      
      // Clone the repository
      const command = `git clone ${url} ${targetName}`;
      await execPromise(command, { cwd });
      
      // Return a new GitClient instance for the cloned repo
      return new GitClient({ repoPath: targetDir });
    } catch (error) {
      logger.error(`Failed to clone repository: ${url}`, error);
      throw error;
    }
  }
}

module.exports = GitClient;