/**
 * Unified code validation module
 * Combines functionality from various code validators throughout the project
 */

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
const logger = require('../logger');

/**
 * Validates JavaScript code syntax
 * @param {string} code - JavaScript code to validate
 * @returns {Promise<{isValid: boolean, errors: Array<string>}>} Validation result
 */
async function validateJavaScript(code) {
  try {
    // Use Node.js to check for syntax errors
    const tempFile = path.join(process.cwd(), 'temp_validation.js');
    fs.writeFileSync(tempFile, code);
    
    try {
      // Try to load the file to check for syntax errors
      require(tempFile);
      fs.unlinkSync(tempFile);
      return { isValid: true, errors: [] };
    } catch (error) {
      fs.unlinkSync(tempFile);
      return { 
        isValid: false, 
        errors: [error.message] 
      };
    }
  } catch (error) {
    logger.error('Error validating JavaScript:', error);
    return { isValid: false, errors: [error.message] };
  }
}

/**
 * Validates TypeScript code using tsc
 * @param {string} code - TypeScript code to validate
 * @returns {Promise<{isValid: boolean, errors: Array<string>}>} Validation result
 */
async function validateTypeScript(code) {
  try {
    const tempDir = path.join(process.cwd(), 'temp_ts_validation');
    const tempFile = path.join(tempDir, 'temp.ts');
    
    // Ensure the directory exists
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir);
    }
    
    fs.writeFileSync(tempFile, code);
    
    try {
      // Run tsc to check types
      const { stderr } = await execPromise(`npx tsc --noEmit ${tempFile}`);
      
      // Clean up
      fs.unlinkSync(tempFile);
      fs.rmdirSync(tempDir);
      
      if (stderr) {
        return { isValid: false, errors: stderr.split('\n').filter(Boolean) };
      }
      
      return { isValid: true, errors: [] };
    } catch (error) {
      // Clean up
      if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
      }
      if (fs.existsSync(tempDir)) {
        fs.rmdirSync(tempDir);
      }
      
      // Parse errors from tsc output
      const errorLines = error.stderr.split('\n')
        .filter(line => line.includes('error TS'))
        .map(line => line.trim());
      
      return { isValid: false, errors: errorLines };
    }
  } catch (error) {
    logger.error('Error validating TypeScript:', error);
    return { isValid: false, errors: [error.message] };
  }
}

/**
 * Validates Python code syntax
 * @param {string} code - Python code to validate
 * @returns {Promise<{isValid: boolean, errors: Array<string>}>} Validation result
 */
async function validatePython(code) {
  try {
    const tempFile = path.join(process.cwd(), 'temp_validation.py');
    fs.writeFileSync(tempFile, code);
    
    try {
      // Use Python to check syntax
      const { stderr } = await execPromise(`python -m py_compile ${tempFile}`);
      fs.unlinkSync(tempFile);
      
      if (stderr) {
        return { isValid: false, errors: stderr.split('\n').filter(Boolean) };
      }
      
      return { isValid: true, errors: [] };
    } catch (error) {
      fs.unlinkSync(tempFile);
      return { 
        isValid: false, 
        errors: error.stderr ? error.stderr.split('\n').filter(Boolean) : [error.message] 
      };
    }
  } catch (error) {
    logger.error('Error validating Python:', error);
    return { isValid: false, errors: [error.message] };
  }
}

/**
 * Validates SQL syntax (basic validation)
 * @param {string} code - SQL code to validate 
 * @returns {Promise<{isValid: boolean, errors: Array<string>}>} Validation result
 */
async function validateSQL(code) {
  // Basic SQL validation (checking for common syntax errors)
  // For a more thorough validation, consider using a SQL parser library
  const errors = [];
  
  // Check for unbalanced quotes
  const singleQuotes = (code.match(/'/g) || []).length;
  if (singleQuotes % 2 !== 0) {
    errors.push('Unbalanced single quotes');
  }
  
  const doubleQuotes = (code.match(/"/g) || []).length;
  if (doubleQuotes % 2 !== 0) {
    errors.push('Unbalanced double quotes');
  }
  
  // Check for missing semicolons at the end of statements
  const statements = code.split(';').filter(stmt => stmt.trim().length > 0);
  if (code.trim() && !code.trim().endsWith(';') && statements.length > 0) {
    errors.push('SQL statement might be missing a semicolon');
  }
  
  return { isValid: errors.length === 0, errors };
}

/**
 * Validates HTML code
 * @param {string} code - HTML code to validate
 * @returns {Promise<{isValid: boolean, errors: Array<string>}>} Validation result
 */
async function validateHTML(code) {
  // Basic HTML validation (checking for common syntax errors)
  // For a more thorough validation, consider using an HTML validator library
  const errors = [];
  
  // Check for unbalanced tags (very basic approach)
  const openTags = [];
  const tagRegex = /<\/?([a-z][a-z0-9]*)\b[^>]*>/gi;
  let match;
  
  while ((match = tagRegex.exec(code))) {
    const fullTag = match[0];
    const tagName = match[1].toLowerCase();
    
    // Skip self-closing tags
    if (fullTag.endsWith('/>') || ['meta', 'link', 'img', 'br', 'hr', 'input'].includes(tagName)) {
      continue;
    }
    
    if (!fullTag.startsWith('</')) {
      // Opening tag
      openTags.push(tagName);
    } else {
      // Closing tag
      if (openTags.length === 0 || openTags[openTags.length - 1] !== tagName) {
        errors.push(`Unexpected closing tag: ${tagName}`);
      } else {
        openTags.pop();
      }
    }
  }
  
  if (openTags.length > 0) {
    errors.push(`Unclosed tags: ${openTags.join(', ')}`);
  }
  
  return { isValid: errors.length === 0, errors };
}

/**
 * Main validation function that determines the type of code and calls the appropriate validator
 * @param {string} code - Code to validate
 * @param {string} language - Language of the code (js, ts, python, sql, html)
 * @returns {Promise<{isValid: boolean, errors: Array<string>}>} Validation result
 */
async function validate(code, language) {
  if (!code || code.trim() === '') {
    return { isValid: false, errors: ['Empty code provided'] };
  }
  
  // Normalize language value
  const normalizedLanguage = language?.toLowerCase() || detectLanguage(code);
  
  switch (normalizedLanguage) {
    case 'js':
    case 'javascript':
      return validateJavaScript(code);
    case 'ts':
    case 'typescript':
      return validateTypeScript(code);
    case 'py':
    case 'python':
      return validatePython(code);
    case 'sql':
      return validateSQL(code);
    case 'html':
      return validateHTML(code);
    default:
      // Basic syntax check for unknown languages
      return { 
        isValid: true, 
        errors: [`Warning: No specific validator for ${normalizedLanguage}. Basic validation only.`] 
      };
  }
}

/**
 * Attempts to detect the language of the provided code
 * @param {string} code - Code to analyze
 * @returns {string} Detected language
 */
function detectLanguage(code) {
  // Simple heuristic for language detection
  if (code.includes('function') && (code.includes('var ') || code.includes('let ') || code.includes('const '))) {
    return 'javascript';
  }
  
  if (code.includes('interface ') || code.includes(': string') || code.includes(': number')) {
    return 'typescript';
  }
  
  if (code.includes('def ') && code.includes(':') && !code.includes('{')) {
    return 'python';
  }
  
  if (code.includes('SELECT ') && code.includes('FROM ') && code.includes(';')) {
    return 'sql';
  }
  
  if (code.includes('<html>') || code.includes('<!DOCTYPE html>')) {
    return 'html';
  }
  
  return 'unknown';
}

/**
 * Validates file structure and project consistency
 * @param {string} filePath - Path to file being generated/modified
 * @param {string} code - Code to be written to file
 * @param {Object} projectContext - Context about the project structure
 * @returns {Promise<{isValid: boolean, errors: Array<string>, warnings: Array<string>}>} Validation result
 */
async function validateFileInProjectContext(filePath, code, projectContext) {
  const errors = [];
  const warnings = [];
  
  // Determine file extension
  const extension = path.extname(filePath).toLowerCase();
  
  // Basic language-specific validation
  let languageValidation;
  
  switch (extension) {
    case '.js':
      languageValidation = await validateJavaScript(code);
      break;
    case '.ts':
      languageValidation = await validateTypeScript(code);
      break;
    case '.py':
      languageValidation = await validatePython(code);
      break;
    case '.sql':
      languageValidation = await validateSQL(code);
      break;
    case '.html':
      languageValidation = await validateHTML(code);
      break;
    default:
      languageValidation = { isValid: true, errors: [] };
      warnings.push(`No specific validator for files with extension ${extension}`);
  }
  
  if (!languageValidation.isValid) {
    errors.push(...languageValidation.errors);
  }
  
  // Check if file already exists
  if (projectContext && projectContext.existingFiles) {
    const fileExists = projectContext.existingFiles.includes(filePath);
    if (fileExists) {
      warnings.push(`File ${filePath} already exists and will be overwritten`);
    }
  }
  
  // Check for imports/requires that might not exist
  if (extension === '.js' || extension === '.ts') {
    const importRegex = /(?:import .+ from ['"](.+)['"]|require\(['"](.+)['"]\))/g;
    let importMatch;
    
    while ((importMatch = importRegex.exec(code))) {
      const importPath = importMatch[1] || importMatch[2];
      
      // Skip node_modules and relative paths we can't verify
      if (!importPath.startsWith('.')) continue;
      
      // Convert relative import to absolute path
      const resolvedPath = path.resolve(path.dirname(filePath), importPath);
      
      // Check if imported file exists in project context
      if (projectContext && projectContext.existingFiles) {
        // Try different extensions if not specified
        const possiblePaths = [
          resolvedPath,
          `${resolvedPath}.js`,
          `${resolvedPath}.ts`,
          `${resolvedPath}/index.js`,
          `${resolvedPath}/index.ts`,
        ];
        
        const importExists = possiblePaths.some(p => 
          projectContext.existingFiles.includes(p)
        );
        
        if (!importExists) {
          warnings.push(`Imported module not found: ${importPath}`);
        }
      }
    }
  }
  
  return {
    isValid: errors.length === 0,
    errors,
    warnings
  };
}

module.exports = {
  validate,
  validateJavaScript,
  validateTypeScript,
  validatePython,
  validateSQL,
  validateHTML,
  validateFileInProjectContext,
  detectLanguage
};