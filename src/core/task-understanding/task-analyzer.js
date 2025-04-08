/**
 * Task analyzer module
 * Responsible for understanding and extracting information from tasks
 * Consolidates functionality from various task analyzers throughout the project
 */

const llmClient = require('../../utils/llm-client');
const promptManager = require('../../utils/prompt-manager');
const logger = require('../../utils/logger');
const dbAdapter = require('./db-adapter');
const requirementParser = require('./requirement-parser');

/**
 * Main class for analyzing tasks
 */
class TaskAnalyzer {
  /**
   * Create a new TaskAnalyzer instance
   * @param {Object} options - Configuration options
   * @param {Object} options.llmConfig - LLM client configuration (optional)
   * @param {Object} options.dbConfig - Database configuration (optional)
   */
  constructor(options = {}) {
    this.llmConfig = options.llmConfig || {};
    this.dbAdapter = options.dbConfig ? new dbAdapter(options.dbConfig) : null;
    this.requirementParser = requirementParser;
  }

  /**
   * Analyze a task description to understand its requirements and context
   * @param {string} taskDescription - Description of the task
   * @param {Object} options - Analysis options
   * @param {Object} options.projectContext - Project context information
   * @param {boolean} options.extractRequirements - Whether to extract formal requirements
   * @param {boolean} options.identifyDependencies - Whether to identify dependencies
   * @param {boolean} options.estimateComplexity - Whether to estimate task complexity
   * @param {boolean} options.suggestApproach - Whether to suggest implementation approach
   * @returns {Promise<Object>} Analysis results
   */
  async analyzeTask(taskDescription, options = {}) {
    logger.info('Starting task analysis for: ' + taskDescription.substring(0, 50) + '...');
    
    try {
      // Default options
      const analysisOptions = {
        projectContext: {},
        extractRequirements: true,
        identifyDependencies: true, 
        estimateComplexity: true,
        suggestApproach: false,
        ...options
      };
      
      // Generate prompt with task analysis instructions
      const prompt = await promptManager.getPrompt('task-analysis', {
        task: taskDescription,
        projectContext: JSON.stringify(analysisOptions.projectContext),
        extractRequirements: analysisOptions.extractRequirements,
        identifyDependencies: analysisOptions.identifyDependencies,
        estimateComplexity: analysisOptions.estimateComplexity,
        suggestApproach: analysisOptions.suggestApproach
      });
      
      // Send task to LLM for analysis
      const llmResponse = await llmClient.sendPrompt(prompt, this.llmConfig);
      
      // Parse the LLM response
      const analysis = this._parseAnalysisResponse(llmResponse);
      
      // Enrich with additional information if needed
      if (analysisOptions.extractRequirements && !analysis.requirements) {
        analysis.requirements = await this.requirementParser.extractRequirements(taskDescription);
      }
      
      // Add database-related context if available
      if (this.dbAdapter) {
        const dbContext = await this._enrichWithDatabaseContext(analysis);
        analysis.databaseContext = dbContext;
      }
      
      logger.info('Task analysis completed successfully');
      return analysis;
    } catch (error) {
      logger.error('Task analysis failed', error);
      throw new Error(`Failed to analyze task: ${error.message}`);
    }
  }

  /**
   * Parse the response from LLM into a structured analysis object
   * @param {string} llmResponse - Raw response from LLM
   * @returns {Object} Structured analysis object
   * @private
   */
  _parseAnalysisResponse(llmResponse) {
    // Try to parse as JSON first
    try {
      // Check if the response contains a JSON block
      const jsonMatch = llmResponse.match(/```json\s*([\s\S]*?)\s*```/);
      if (jsonMatch && jsonMatch[1]) {
        return JSON.parse(jsonMatch[1]);
      }
      
      // Try to parse the whole response as JSON
      return JSON.parse(llmResponse);
    } catch (jsonError) {
      // If not JSON, try to parse in a more forgiving way
      logger.debug('LLM response is not valid JSON, attempting structured text parsing');
      
      const analysis = {
        summary: '',
        requirements: [],
        dependencies: [],
        complexity: null,
        approach: '',
        tags: [],
        estimatedTime: null
      };
      
      // Extract sections based on headers
      const sections = llmResponse.split(/(?:^|\n)#+\s+/);
      
      for (const section of sections) {
        if (!section.trim()) continue;
        
        const lines = section.split('\n');
        const header = lines[0].trim().toLowerCase();
        const content = lines.slice(1).join('\n').trim();
        
        if (header.includes('summary') || header.includes('overview')) {
          analysis.summary = content;
        } else if (header.includes('requirement')) {
          // Extract bullet points as requirements
          analysis.requirements = content
            .split(/(?:\r?\n)+/)
            .filter(line => line.trim().startsWith('-') || line.trim().startsWith('*'))
            .map(line => line.trim().replace(/^[-*]\s+/, ''));
        } else if (header.includes('dependenc')) {
          // Extract dependencies
          analysis.dependencies = content
            .split(/(?:\r?\n)+/)
            .filter(line => line.trim().startsWith('-') || line.trim().startsWith('*'))
            .map(line => line.trim().replace(/^[-*]\s+/, ''));
        } else if (header.includes('complex')) {
          // Try to extract complexity rating
          const complexityMatch = content.match(/(\d+(?:\.\d+)?)\s*\/\s*10/);
          if (complexityMatch) {
            analysis.complexity = parseFloat(complexityMatch[1]);
          } else {
            // Look for terms like "high", "medium", "low"
            const complexityTerms = {
              high: 8,
              medium: 5,
              low: 2
            };
            
            for (const [term, value] of Object.entries(complexityTerms)) {
              if (content.toLowerCase().includes(term)) {
                analysis.complexity = value;
                break;
              }
            }
          }
        } else if (header.includes('approach') || header.includes('implementation')) {
          analysis.approach = content;
        } else if (header.includes('tag')) {
          // Extract tags
          analysis.tags = content
            .split(/(?:\r?\n)+/)
            .filter(line => line.trim().startsWith('-') || line.trim().startsWith('*'))
            .map(line => line.trim().replace(/^[-*]\s+/, ''))
            .filter(Boolean);
        } else if (header.includes('time') || header.includes('estimate')) {
          // Try to extract time estimate
          const timeMatch = content.match(/(\d+(?:\.\d+)?)\s*(hour|hr|day|minute|min)/i);
          if (timeMatch) {
            let time = parseFloat(timeMatch[1]);
            const unit = timeMatch[2].toLowerCase();
            
            // Convert to hours
            if (unit.startsWith('min')) {
              time /= 60;
            } else if (unit.startsWith('day')) {
              time *= 8; // Assuming 8-hour workdays
            }
            
            analysis.estimatedTime = time;
          }
        }
      }
      
      return analysis;
    }
  }

  /**
   * Enrich analysis with database context
   * @param {Object} analysis - Current analysis object
   * @returns {Promise<Object>} Database context
   * @private
   */
  async _enrichWithDatabaseContext(analysis) {
    try {
      if (!this.dbAdapter) {
        return null;
      }
      
      // Identify potential database entities from requirements and summary
      const entityNames = this._extractPotentialEntities(analysis);
      
      // Query database schema for these entities
      const dbContext = {
        relevantEntities: [],
        relations: [],
        suggestedQueries: []
      };
      
      // Get schema information for potential entities
      for (const entityName of entityNames) {
        const entityInfo = await this.dbAdapter.getEntityInfo(entityName);
        if (entityInfo) {
          dbContext.relevantEntities.push(entityInfo);
        }
      }
      
      // Get relations between entities
      if (dbContext.relevantEntities.length > 1) {
        dbContext.relations = await this.dbAdapter.getRelationsBetweenEntities(
          dbContext.relevantEntities.map(e => e.name)
        );
      }
      
      // Generate suggested queries if entities were found
      if (dbContext.relevantEntities.length > 0) {
        const queryContext = {
          task: analysis.summary,
          entities: dbContext.relevantEntities,
          relations: dbContext.relations
        };
        
        const prompt = await promptManager.getPrompt('db-query-suggestion', queryContext);
        const response = await llmClient.sendPrompt(prompt, this.llmConfig);
        
        // Extract queries from response
        const queries = response.match(/```sql\s*([\s\S]*?)\s*```/g);
        if (queries) {
          dbContext.suggestedQueries = queries.map(q => 
            q.replace(/```sql\s*/, '').replace(/\s*```/, '').trim()
          );
        }
      }
      
      return dbContext;
    } catch (error) {
      logger.error('Failed to enrich with database context', error);
      return null;
    }
  }

  /**
   * Extract potential database entities from analysis
   * @param {Object} analysis - Analysis object
   * @returns {Array<string>} Potential entity names
   * @private
   */
  _extractPotentialEntities(analysis) {
    const potentialEntities = new Set();
    const sources = [
      analysis.summary,
      ...(analysis.requirements || []),
      analysis.approach
    ].filter(Boolean);
    
    // Common singular/plural patterns
    const singularize = (word) => {
      if (word.endsWith('ies')) return word.slice(0, -3) + 'y';
      if (word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
      return word;
    };
    
    // Look for nouns that might be database entities
    // This is a simplified approach; a real implementation might use NLP
    const combinedText = sources.join(' ');
    
    // Look for capitalized nouns or words followed by common db terms
    const entityRegex = /\b([A-Z][a-z]+(?:[A-Z][a-z]+)*)\b|\b([a-z]+(?:_[a-z]+)*)\s+(?:table|model|entity|record)\b/g;
    let match;
    
    while ((match = entityRegex.exec(combinedText)) !== null) {
      const entity = (match[1] || match[2]).trim();
      potentialEntities.add(entity);
      potentialEntities.add(singularize(entity));
    }
    
    // Look for words that appear to be used as objects in sentences
    // This is an extremely simplified approach
    const sentences = combinedText.split(/[.!?]+/);
    for (const sentence of sentences) {
      const words = sentence.split(/\s+/);
      for (let i = 0; i < words.length - 1; i++) {
        const word = words[i].toLowerCase();
        const nextWord = words[i + 1].replace(/[^a-zA-Z0-9_]/g, '');
        
        if (['create', 'update', 'delete', 'get', 'fetch', 'retrieve', 'modify'].includes(word) && 
            nextWord && 
            nextWord[0] === nextWord[0].toLowerCase() && 
            nextWord.length > 3) {
          potentialEntities.add(nextWord);
          potentialEntities.add(singularize(nextWord));
        }
      }
    }
    
    return [...potentialEntities];
  }
  
  /**
   * Identify key skills or knowledge areas required for the task
   * @param {string} taskDescription - Description of the task
   * @returns {Promise<Array<string>>} Required skills or knowledge areas
   */
  async identifyRequiredSkills(taskDescription) {
    try {
      const prompt = await promptManager.getPrompt('skill-identification', {
        task: taskDescription
      });
      
      const response = await llmClient.sendPrompt(prompt, this.llmConfig);
      
      // Try to extract skills as a list
      const skills = [];
      
      // Look for bullet points or numbered lists
      const listItems = response.match(/(?:^|\n)(?:[-*]|\d+\.)\s+(.+)(?:\n|$)/g);
      if (listItems) {
        for (const item of listItems) {
          const skill = item.replace(/(?:^|\n)(?:[-*]|\d+\.)\s+/, '').trim();
          if (skill) skills.push(skill);
        }
      }
      
      // If no list found, try to extract from paragraphs
      if (skills.length === 0) {
        const lines = response.split('\n').filter(line => line.trim());
        for (const line of lines) {
          if (!line.includes(':') && line.length < 100) {
            skills.push(line.trim());
          }
        }
      }
      
      return skills;
    } catch (error) {
      logger.error('Failed to identify required skills', error);
      return [];
    }
  }
  
  /**
   * Estimate task complexity and effort
   * @param {string} taskDescription - Description of the task
   * @param {Object} projectContext - Project context
   * @returns {Promise<Object>} Complexity and effort estimates
   */
  async estimateEffort(taskDescription, projectContext = {}) {
    try {
      const prompt = await promptManager.getPrompt('effort-estimation', {
        task: taskDescription,
        projectContext: JSON.stringify(projectContext)
      });
      
      const response = await llmClient.sendPrompt(prompt, this.llmConfig);
      
      // Try to parse as JSON
      try {
        const jsonMatch = response.match(/```json\s*([\s\S]*?)\s*```/);
        if (jsonMatch && jsonMatch[1]) {
          return JSON.parse(jsonMatch[1]);
        }
        
        return JSON.parse(response);
      } catch (jsonError) {
        // Fallback to regex parsing
        const estimate = {
          complexity: null,
          timeInHours: null,
          confidenceLevel: 'medium',
          factors: []
        };
        
        // Extract complexity score
        const complexityMatch = response.match(/complexity[^:]*:\s*(\d+(?:\.\d+)?)\s*\/\s*10/i);
        if (complexityMatch) {
          estimate.complexity = parseFloat(complexityMatch[1]);
        }
        
        // Extract time estimate
        const timeMatch = response.match(/(?:time|effort|duration)[^:]*:\s*(\d+(?:\.\d+)?)\s*(hour|hr|day|minute|min)/i);
        if (timeMatch) {
          let time = parseFloat(timeMatch[1]);
          const unit = timeMatch[2].toLowerCase();
          
          // Convert to hours
          if (unit.startsWith('min')) {
            time /= 60;
          } else if (unit.startsWith('day')) {
            time *= 8; // Assuming 8-hour workdays
          }
          
          estimate.timeInHours = time;
        }
        
        // Extract confidence level
        if (response.toLowerCase().includes('confidence: high') || 
            response.toLowerCase().includes('high confidence')) {
          estimate.confidenceLevel = 'high';
        } else if (response.toLowerCase().includes('confidence: low') || 
                  response.toLowerCase().includes('low confidence')) {
          estimate.confidenceLevel = 'low';
        }
        
        // Extract factors
        const factorsMatch = response.match(/factors[^:]*:\s*([\s\S]+?)(?:\n\s*\n|\n#|\n##|$)/i);
        if (factorsMatch) {
          const factorsText = factorsMatch[1];
          estimate.factors = factorsText
            .split(/\n/)
            .filter(line => line.trim().startsWith('-') || line.trim().startsWith('*'))
            .map(line => line.trim().replace(/^[-*]\s+/, ''))
            .filter(Boolean);
        }
        
        return estimate;
      }
    } catch (error) {
      logger.error('Failed to estimate effort', error);
      return {
        complexity: null,
        timeInHours: null,
        confidenceLevel: 'low',
        factors: ['Error in estimation']
      };
    }
  }
}

module.exports = TaskAnalyzer;