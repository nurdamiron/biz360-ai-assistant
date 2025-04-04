const fs = require('fs').promises;
const path = require('path');
const logger = require('./logger');

/**
 * Утилиты для работы с файлами
 */
const fileUtils = {
  /**
   * Чтение файла
   * @param {string} filePath - Путь к файлу
   * @returns {Promise<string>} - Содержимое файла
   */
  async readFile(filePath) {
    try {
      return await fs.readFile(filePath, 'utf8');
    } catch (error) {
      logger.error(`Ошибка при чтении файла ${filePath}:`, error);
      throw error;
    }
  },

  /**
   * Запись в файл
   * @param {string} filePath - Путь к файлу
   * @param {string} content - Содержимое для записи
   * @returns {Promise<void>}
   */
  async writeFile(filePath, content) {
    try {
      // Создаем директории, если их нет
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, content);
    } catch (error) {
      logger.error(`Ошибка при записи в файл ${filePath}:`, error);
      throw error;
    }
  },

  /**
   * Проверка существования файла
   * @param {string} filePath - Путь к файлу
   * @returns {Promise<boolean>} - Существует ли файл
   */
  async fileExists(filePath) {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  },

  /**
   * Получение списка файлов в директории
   * @param {string} dirPath - Путь к директории
   * @param {Array<string>} [extensions] - Список расширений для фильтрации
   * @returns {Promise<Array<string>>} - Список путей к файлам
   */
  async listFiles(dirPath, extensions = null) {
    try {
      const files = await fs.readdir(dirPath);
      
      let result = [];
      for (const file of files) {
        const filePath = path.join(dirPath, file);
        const stat = await fs.stat(filePath);
        
        if (stat.isDirectory()) {
          const subFiles = await this.listFiles(filePath, extensions);
          result = result.concat(subFiles);
        } else {
          if (!extensions || extensions.includes(path.extname(file))) {
            result.push(filePath);
          }
        }
      }
      
      return result;
    } catch (error) {
      logger.error(`Ошибка при получении списка файлов в ${dirPath}:`, error);
      throw error;
    }
  }
};

module.exports = fileUtils;
