/**
 * Import updater script
 * Updates import statements in project files to use the new consolidated modules
 */

const fs = require('fs');
const path = require('path');
const { promisify } = require('util');

const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);
const readdir = promisify(fs.readdir);
const stat = promisify(fs.stat);

// Map of old import paths to new ones
const importMappings = {
  // Code validators
  '../../utils/code-validator': '../../utils/validators/code-validator',
  '../utils/code-validator': '../utils/validators/code-validator',
  './code-validator': '../utils/validators/code-validator',
  '../core/code-generator/code-validator': '../utils/validators/code-validator',
  '../core/code-testing/code-validator': '../utils/validators/code-validator',
  
  // Git clients
  '../../utils/git-client': '../../utils/git/git-client',
  '../utils/git-client': '../utils/git/git-client',
  './git-client': '../utils/git/git-client',
  '../core/vcs-manager/git-client': '../utils/git/git-client',
  
  // Task analyzers
  './task-analyzer': '../core/task-understanding/task-analyzer',
  '../core/task-planner/task-analyzer': '../core/task-understanding/task-analyzer',
  '../task-analyzer': '../core/task-understanding/task-analyzer',
};

/**
 * Recursively gets all JavaScript files in a directory
 * @param {string} dir - Directory to search
 * @param {Array<string>} fileList - Accumulator for file list
 * @returns {Promise<Array<string>>} List of JS file paths
 */
async function getJsFiles(dir, fileList = []) {
  const files = await readdir(dir);
  
  for (const file of files) {
    const filePath = path.join(dir, file);
    const stats = await stat(filePath);
    
    if (stats.isDirectory() && !file.startsWith('node_modules') && !file.startsWith('.git')) {
      await getJsFiles(filePath, fileList);
    } else if (stats.isFile() && (file.endsWith('.js') || file.endsWith('.ts'))) {
      fileList.push(filePath);
    }
  }
  
  return fileList;
}

/**
 * Updates import statements in a file
 * @param {string} filePath - Path to the file
 * @returns {Promise<boolean>} Whether the file was updated
 */
async function updateImportsInFile(filePath) {
  try {
    const content = await readFile(filePath, 'utf8');
    let updatedContent = content;
    let updated = false;
    
    // Check for require statements
    // Match patterns like: const validator = require('./code-validator')
    // or: const { validate } = require('../utils/code-validator')
    const requireRegex = /const\s+(?:{[^}]*}|\w+)\s*=\s*require\(['"](.*?)['"]\)/g;
    let requireMatch;
    
    while ((requireMatch = requireRegex.exec(content)) !== null) {
      const oldPath = requireMatch[1];
      if (importMappings[oldPath]) {
        const newRequire = requireMatch[0].replace(oldPath, importMappings[oldPath]);
        updatedContent = updatedContent.replace(requireMatch[0], newRequire);
        updated = true;
        console.log(`Updated require in ${filePath}: ${oldPath} -> ${importMappings[oldPath]}`);
      }
    }
    
    // Check for import statements
    // Match patterns like: import validator from './code-validator'
    // or: import { validate } from '../utils/code-validator'
    const importRegex = /import\s+(?:{[^}]*}|\w+)\s+from\s+['"](.*?)['"]/g;
    let importMatch;
    
    while ((importMatch = importRegex.exec(content)) !== null) {
      const oldPath = importMatch[1];
      if (importMappings[oldPath]) {
        const newImport = importMatch[0].replace(oldPath, importMappings[oldPath]);
        updatedContent = updatedContent.replace(importMatch[0], newImport);
        updated = true;
        console.log(`Updated import in ${filePath}: ${oldPath} -> ${importMappings[oldPath]}`);
      }
    }
    
    // Update the file if changes were made
    if (updated) {
      await writeFile(filePath, updatedContent, 'utf8');
      return true;
    }
    
    return false;
  } catch (error) {
    console.error(`Error updating imports in ${filePath}:`, error);
    return false;
  }
}

/**
 * Main function
 */
async function main() {
  try {
    const rootDir = path.resolve(__dirname, '..');
    console.log(`Scanning for JavaScript files in ${rootDir}...`);
    
    const jsFiles = await getJsFiles(rootDir);
    console.log(`Found ${jsFiles.length} JavaScript files.`);
    
    let updatedFiles = 0;
    
    for (const filePath of jsFiles) {
      const wasUpdated = await updateImportsInFile(filePath);
      if (wasUpdated) {
        updatedFiles++;
      }
    }
    
    console.log(`Updated imports in ${updatedFiles} files.`);
  } catch (error) {
    console.error('Error executing update-imports script:', error);
    process.exit(1);
  }
}

// Run the script if executed directly
if (require.main === module) {
  main().catch(console.error);
}

module.exports = { updateImportsInFile, getJsFiles };