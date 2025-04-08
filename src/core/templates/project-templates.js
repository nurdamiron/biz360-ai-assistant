// src/core/templates/project-templates.js
const { pool } = require('../../config/db.config');
const logger = require('../../utils/logger');
const fs = require('fs');
const path = require('path');
const { getLLMClient } = require('../../utils/llm-client');

/**
 * Manages project templates for quick project setup
 */
class ProjectTemplateManager {
  /**
   * Create template from an existing project
   * @param {number} projectId - Source project ID
   * @param {string} templateName - Name for the new template
   * @param {string} description - Template description
   * @param {Object} options - Template creation options
   * @returns {Promise<Object>} - Created template
   */
  async createTemplateFromProject(projectId, templateName, description, options = {}) {
    try {
      const connection = await pool.getConnection();
      
      // Get project details
      const [projects] = await connection.query(
        'SELECT * FROM projects WHERE id = ?',
        [projectId]
      );
      
      if (projects.length === 0) {
        connection.release();
        throw new Error(`Project with id=${projectId} not found`);
      }
      
      const project = projects[0];
      
      // Check if template with this name already exists
      const [existingTemplates] = await connection.query(
        'SELECT id FROM project_templates WHERE name = ?',
        [templateName]
      );
      
      if (existingTemplates.length > 0) {
        connection.release();
        throw new Error(`Template with name "${templateName}" already exists`);
      }
      
      // Collect project structure
      const structure = await this._collectProjectStructure(project, connection);
      
      // Collect tasks (optionally filtered)
      const tasks = await this._collectProjectTasks(project.id, connection, options);
      
      // Create template record
      const [result] = await connection.query(
        `INSERT INTO project_templates 
         (name, description, source_project_id, structure, default_tasks) 
         VALUES (?, ?, ?, ?, ?)`,
        [
          templateName,
          description,
          projectId,
          JSON.stringify(structure),
          JSON.stringify(tasks)
        ]
      );
      
      const templateId = result.insertId;
      
      // Get the created template
      const [templates] = await connection.query(
        'SELECT * FROM project_templates WHERE id = ?',
        [templateId]
      );
      
      connection.release();
      
      const template = templates[0];
      
      // Parse JSON fields
      template.structure = JSON.parse(template.structure);
      template.default_tasks = JSON.parse(template.default_tasks);
      
      logger.info(`Created project template "${templateName}" with ID ${templateId}`);
      return template;
    } catch (error) {
      logger.error(`Error creating template from project #${projectId}:`, error);
      throw error;
    }
  }
  
  /**
   * Create a new project from a template
   * @param {number} templateId - Template ID
   * @param {string} projectName - Name for the new project
   * @param {string} projectDescription - Project description
   * @param {Object} options - Project creation options
   * @returns {Promise<Object>} - Created project
   */
  async createProjectFromTemplate(templateId, projectName, projectDescription, options = {}) {
    try {
      const connection = await pool.getConnection();
      
      // Get template details
      const [templates] = await connection.query(
        'SELECT * FROM project_templates WHERE id = ?',
        [templateId]
      );
      
      if (templates.length === 0) {
        connection.release();
        throw new Error(`Template with id=${templateId} not found`);
      }
      
      const template = templates[0];
      const structure = JSON.parse(template.structure);
      const defaultTasks = JSON.parse(template.default_tasks);
      
      // Check if project with this name already exists
      const [existingProjects] = await connection.query(
        'SELECT id FROM projects WHERE name = ?',
        [projectName]
      );
      
      if (existingProjects.length > 0) {
        connection.release();
        throw new Error(`Project with name "${projectName}" already exists`);
      }
      
      // Start a transaction
      await connection.beginTransaction();
      
      try {
        // Create the project
        const [projectResult] = await connection.query(
          `INSERT INTO projects 
           (name, description, status, template_id, created_at) 
           VALUES (?, ?, ?, ?, NOW())`,
          [
            projectName,
            projectDescription,
            'active',
            templateId
          ]
        );
        
        const projectId = projectResult.insertId;
        
        // Create project structure (directories and files)
        await this._createProjectStructure(projectId, structure, connection);
        
        // Create default tasks if requested
        if (options.createDefaultTasks !== false) {
          await this._createDefaultTasks(projectId, defaultTasks, connection);
        }
        
        // Commit the transaction
        await connection.commit();
        
        // Get the created project
        const [projects] = await connection.query(
          'SELECT * FROM projects WHERE id = ?',
          [projectId]
        );
        
        connection.release();
        
        logger.info(`Created project "${projectName}" from template ${templateId}`);
        return projects[0];
      } catch (error) {
        await connection.rollback();
        throw error;
      }
    } catch (error) {
      logger.error(`Error creating project from template #${templateId}:`, error);
      throw error;
    }
  }
  
  /**
   * Get all available project templates
   * @param {Object} options - Query options
   * @returns {Promise<Array>} - List of templates
   */
  async getAllTemplates(options = {}) {
    try {
      const connection = await pool.getConnection();
      
      let query = 'SELECT * FROM project_templates';
      const queryParams = [];
      
      // Add search filter if provided
      if (options.search) {
        query += ' WHERE name LIKE ? OR description LIKE ?';
        queryParams.push(`%${options.search}%`, `%${options.search}%`);
      }
      
      // Add sorting
      query += ' ORDER BY name ASC';
      
      const [templates] = await connection.query(query, queryParams);
      
      connection.release();
      
      // Parse JSON fields
      return templates.map(template => ({
        ...template,
        structure: JSON.parse(template.structure),
        default_tasks: JSON.parse(template.default_tasks)
      }));
    } catch (error) {
      logger.error('Error getting project templates:', error);
      throw error;
    }
  }
  
  /**
   * Get template by ID
   * @param {number} templateId - Template ID
   * @returns {Promise<Object|null>} - Template or null if not found
   */
  async getTemplateById(templateId) {
    try {
      const connection = await pool.getConnection();
      
      const [templates] = await connection.query(
        'SELECT * FROM project_templates WHERE id = ?',
        [templateId]
      );
      
      connection.release();
      
      if (templates.length === 0) {
        return null;
      }
      
      const template = templates[0];
      
      // Parse JSON fields
      template.structure = JSON.parse(template.structure);
      template.default_tasks = JSON.parse(template.default_tasks);
      
      return template;
    } catch (error) {
      logger.error(`Error getting template #${templateId}:`, error);
      throw error;
    }
  }
  
  /**
   * Update an existing template
   * @param {number} templateId - Template ID
   * @param {Object} updates - Fields to update
   * @returns {Promise<Object>} - Updated template
   */
  async updateTemplate(templateId, updates) {
    try {
      const connection = await pool.getConnection();
      
      // Check if template exists
      const [templates] = await connection.query(
        'SELECT * FROM project_templates WHERE id = ?',
        [templateId]
      );
      
      if (templates.length === 0) {
        connection.release();
        throw new Error(`Template with id=${templateId} not found`);
      }
      
      const allowedFields = ['name', 'description', 'structure', 'default_tasks'];
      const updateFields = [];
      const updateValues = [];
      
      // Prepare update fields
      for (const [key, value] of Object.entries(updates)) {
        if (allowedFields.includes(key)) {
          updateFields.push(`${key} = ?`);
          
          // Stringify JSON fields
          if (key === 'structure' || key === 'default_tasks') {
            updateValues.push(JSON.stringify(value));
          } else {
            updateValues.push(value);
          }
        }
      }
      
      if (updateFields.length === 0) {
        connection.release();
        throw new Error('No valid fields to update');
      }
      
      // Add updated_at timestamp
      updateFields.push('updated_at = NOW()');
      
      // Perform update
      await connection.query(
        `UPDATE project_templates 
         SET ${updateFields.join(', ')} 
         WHERE id = ?`,
        [...updateValues, templateId]
      );
      
      // Get updated template
      const [updatedTemplates] = await connection.query(
        'SELECT * FROM project_templates WHERE id = ?',
        [templateId]
      );
      
      connection.release();
      
      const updatedTemplate = updatedTemplates[0];
      
      // Parse JSON fields
      updatedTemplate.structure = JSON.parse(updatedTemplate.structure);
      updatedTemplate.default_tasks = JSON.parse(updatedTemplate.default_tasks);
      
      logger.info(`Updated template #${templateId}`);
      return updatedTemplate;
    } catch (error) {
      logger.error(`Error updating template #${templateId}:`, error);
      throw error;
    }
  }
  
  /**
   * Delete a template
   * @param {number} templateId - Template ID
   * @returns {Promise<boolean>} - Success status
   */
  async deleteTemplate(templateId) {
    try {
      const connection = await pool.getConnection();
      
      // Check if template exists
      const [templates] = await connection.query(
        'SELECT * FROM project_templates WHERE id = ?',
        [templateId]
      );
      
      if (templates.length === 0) {
        connection.release();
        throw new Error(`Template with id=${templateId} not found`);
      }
      
      // Delete template
      await connection.query(
        'DELETE FROM project_templates WHERE id = ?',
        [templateId]
      );
      
      connection.release();
      
      logger.info(`Deleted template #${templateId}`);
      return true;
    } catch (error) {
      logger.error(`Error deleting template #${templateId}:`, error);
      throw error;
    }
  }
  
  /**
   * Generate a template automatically based on project description
   * @param {string} name - Template name
   * @param {string} description - Project type description
   * @returns {Promise<Object>} - Generated template
   */
  async generateTemplateFromDescription(name, description) {
    try {
      // Use LLM to generate project structure and tasks
      const llmClient = getLLMClient();
      
      const prompt = `
# Generate Project Template

## Project Type
${description}

## Instructions
1. Based on the project type description, design a suitable project structure with files and directories.
2. Create a list of initial tasks that would be appropriate for this type of project.

## Response Format
Please provide your response in JSON format:
{
  "structure": {
    "directories": [
      {
        "path": "src/components",
        "description": "React components directory"
      },
      // More directories...
    ],
    "files": [
      {
        "path": "src/index.js",
        "description": "Main entry point",
        "template": "// Basic file content template here"
      },
      // More files...
    ]
  },
  "tasks": [
    {
      "title": "Setup project structure",
      "description": "Create initial directory structure and config files",
      "priority": "high",
      "tags": ["setup", "infrastructure"]
    },
    // More tasks...
  ]
}
`;
      
      const response = await llmClient.sendPrompt(prompt);
      
      // Extract JSON from response
      const jsonMatch = response.match(/{[\s\S]*}/);
      if (!jsonMatch) {
        throw new Error('Failed to parse LLM response');
      }
      
      const templateData = JSON.parse(jsonMatch[0]);
      
      // Save the template to database
      const connection = await pool.getConnection();
      
      // Check if template with this name already exists
      const [existingTemplates] = await connection.query(
        'SELECT id FROM project_templates WHERE name = ?',
        [name]
      );
      
      if (existingTemplates.length > 0) {
        connection.release();
        throw new Error(`Template with name "${name}" already exists`);
      }
      
      // Create template record
      const [result] = await connection.query(
        `INSERT INTO project_templates 
         (name, description, structure, default_tasks, is_ai_generated, created_at) 
         VALUES (?, ?, ?, ?, TRUE, NOW())`,
        [
          name,
          description,
          JSON.stringify(templateData.structure),
          JSON.stringify(templateData.tasks)
        ]
      );
      
      const templateId = result.insertId;
      
      // Get the created template
      const [templates] = await connection.query(
        'SELECT * FROM project_templates WHERE id = ?',
        [templateId]
      );
      
      connection.release();
      
      const template = templates[0];
      
      // Parse JSON fields
      template.structure = JSON.parse(template.structure);
      template.default_tasks = JSON.parse(template.default_tasks);
      
      logger.info(`Generated AI project template "${name}" with ID ${templateId}`);
      return template;
    } catch (error) {
      logger.error(`Error generating template from description:`, error);
      throw error;
    }
  }
  
  /**
   * Collect project structure from an existing project
   * @param {Object} project - Project object
   * @param {Object} connection - Database connection
   * @returns {Promise<Object>} - Project structure
   * @private
   */
  async _collectProjectStructure(project, connection) {
    // Get all project files
    const [files] = await connection.query(
      'SELECT * FROM project_files WHERE project_id = ?',
      [project.id]
    );
    
    // Organize into directories and files
    const directories = new Set();
    const fileEntries = [];
    
    for (const file of files) {
      // Extract directory path
      const filePath = file.file_path;
      const dirPath = path.dirname(filePath);
      
      if (dirPath !== '.') {
        // Split path and add all directories and their parents
        const parts = dirPath.split('/');
        let currentPath = '';
        
        for (let i = 0; i < parts.length; i++) {
          currentPath = currentPath ? `${currentPath}/${parts[i]}` : parts[i];
          directories.add(currentPath);
        }
      }
      
      // Get file content for template
      const [codeSegments] = await connection.query(
        `SELECT code_segment FROM code_vectors 
         WHERE file_id = ? 
         ORDER BY start_line`,
        [file.id]
      );
      
      const content = codeSegments.length > 0
        ? codeSegments.map(segment => segment.code_segment).join('\n')
        : '// Template content';
      
      fileEntries.push({
        path: filePath,
        description: `${file.file_type} file`,
        template: content
      });
    }
    
    return {
      directories: Array.from(directories).map(dir => ({
        path: dir,
        description: `Directory for ${dir}`
      })),
      files: fileEntries
    };
  }
  
  /**
   * Collect tasks from an existing project
   * @param {number} projectId - Project ID
   * @param {Object} connection - Database connection
   * @param {Object} options - Collection options
   * @returns {Promise<Array>} - Project tasks
   * @private
   */
  async _collectProjectTasks(projectId, connection, options = {}) {
    // Build query with filters
    let query = `
      SELECT t.*, GROUP_CONCAT(tt.tag_name) as tags
      FROM tasks t
      LEFT JOIN task_tags tt ON t.id = tt.task_id
      WHERE t.project_id = ?
    `;
    
    const queryParams = [projectId];
    
    // Optional filters
    if (options.statuses) {
      query += ` AND t.status IN (?)`;
      queryParams.push(options.statuses);
    }
    
    if (options.priorityMin && options.priorityMax) {
      query += ` AND t.priority BETWEEN ? AND ?`;
      queryParams.push(options.priorityMin, options.priorityMax);
    }
    
    // Group by task ID for tag concatenation
    query += ` GROUP BY t.id`;
    
    // Limit number of tasks if specified
    if (options.limit) {
      query += ` LIMIT ?`;
      queryParams.push(options.limit);
    }
    
    const [tasks] = await connection.query(query, queryParams);
    
    // Format tasks for template
    return tasks.map(task => {
      const tags = task.tags ? task.tags.split(',') : [];
      
      return {
        title: task.title,
        description: task.description,
        priority: this._mapPriorityToString(task.priority),
        tags
      };
    });
  }
  
  /**
   * Map numeric priority to string
   * @param {number} priority - Priority value
   * @returns {string} - Priority string
   * @private
   */
  _mapPriorityToString(priority) {
    if (priority >= 8) return 'high';
    if (priority >= 4) return 'medium';
    return 'low';
  }
  
  /**
   * Create project structure from template
   * @param {number} projectId - Project ID
   * @param {Object} structure - Structure definition
   * @param {Object} connection - Database connection
   * @returns {Promise<void>}
   * @private
   */
  async _createProjectStructure(projectId, structure, connection) {
    // Create directories first (represented as virtual entries in database)
    for (const dir of structure.directories) {
      // Create virtual directory entry in project_files
      await connection.query(
        `INSERT INTO project_files 
         (project_id, file_path, file_type, is_directory) 
         VALUES (?, ?, 'directory', TRUE)`,
        [projectId, dir.path]
      );
    }
    
    // Then create files
    for (const file of structure.files) {
      // Determine file type from extension
      const extension = path.extname(file.path).slice(1).toLowerCase();
      const fileType = this._getFileTypeFromExtension(extension);
      
      // Create file entry
      const [fileResult] = await connection.query(
        `INSERT INTO project_files 
         (project_id, file_path, file_type, file_hash) 
         VALUES (?, ?, ?, ?)`,
        [
          projectId,
          file.path,
          fileType,
          'template-hash-' + Math.random().toString(36).substring(2, 10)
        ]
      );
      
      const fileId = fileResult.insertId;
      
      // Create code vector entry with template content
      await connection.query(
        `INSERT INTO code_vectors 
         (file_id, code_segment, start_line, end_line, embedding) 
         VALUES (?, ?, ?, ?, ?)`,
        [
          fileId,
          file.template || `// Template for ${file.path}`,
          1,
          (file.template || '').split('\n').length || 1,
          '[]' // Empty embedding
        ]
      );
    }
  }
  
  /**
   * Create default tasks from template
   * @param {number} projectId - Project ID
   * @param {Array} defaultTasks - Task definitions
   * @param {Object} connection - Database connection
   * @returns {Promise<void>}
   * @private
   */
  async _createDefaultTasks(projectId, defaultTasks, connection) {
    for (const taskDef of defaultTasks) {
      // Create task
      const [taskResult] = await connection.query(
        `INSERT INTO tasks 
         (project_id, title, description, status, priority) 
         VALUES (?, ?, ?, ?, ?)`,
        [
          projectId,
          taskDef.title,
          taskDef.description,
          'pending',
          this._mapPriorityToNumber(taskDef.priority)
        ]
      );
      
      const taskId = taskResult.insertId;
      
      // Add tags if present
      if (taskDef.tags && taskDef.tags.length > 0) {
        for (const tag of taskDef.tags) {
          // Ensure tag exists
          await connection.query(
            `INSERT IGNORE INTO tags (name) VALUES (?)`,
            [tag]
          );
          
          // Link tag to task
          await connection.query(
            `INSERT INTO task_tags (task_id, tag_name) VALUES (?, ?)`,
            [taskId, tag]
          );
        }
      }
      
      // Create subtasks if defined
      if (taskDef.subtasks && taskDef.subtasks.length > 0) {
        for (let i = 0; i < taskDef.subtasks.length; i++) {
          const subtask = taskDef.subtasks[i];
          
          await connection.query(
            `INSERT INTO subtasks 
             (task_id, title, description, status, sequence_number) 
             VALUES (?, ?, ?, ?, ?)`,
            [
              taskId,
              subtask.title,
              subtask.description,
              'pending',
              i + 1
            ]
          );
        }
      }
    }
  }
  
  /**
   * Map string priority to number
   * @param {string} priority - Priority string
   * @returns {number} - Priority value
   * @private
   */
  _mapPriorityToNumber(priority) {
    switch (priority.toLowerCase()) {
      case 'high': return 8;
      case 'medium': return 5;
      case 'low': return 2;
      default: return 5;
    }
  }
  
  /**
   * Get file type from extension
   * @param {string} extension - File extension
   * @returns {string} - File type
   * @private
   */
  _getFileTypeFromExtension(extension) {
    const extensionMap = {
      'js': 'javascript',
      'jsx': 'javascript',
      'ts': 'typescript',
      'tsx': 'typescript',
      'py': 'python',
      'java': 'java',
      'html': 'html',
      'css': 'css',
      'json': 'json',
      'md': 'markdown'
    };
    
    return extensionMap[extension] || extension;
  }
}

module.exports = ProjectTemplateManager;