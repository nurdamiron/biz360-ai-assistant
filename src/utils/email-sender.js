// src/utils/email-sender.js

const nodemailer = require('nodemailer');
const logger = require('./logger');

/**
 * Сервис для отправки email
 */
class EmailSender {
  constructor() {
    this.transporter = null;
    this.initialized = false;
    
    // Инициализируем транспорт при первом использовании
    this.initialize();
  }

  /**
   * Инициализирует SMTP-транспорт
   */
  initialize() {
    try {
      // Проверяем наличие переменных окружения
      if (!process.env.SMTP_HOST || !process.env.SMTP_PORT) {
        logger.warn('Email-сервис не сконфигурирован. Отсутствуют переменные окружения SMTP_HOST и SMTP_PORT.');
        return;
      }
      
      // Создаем транспорт
      this.transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT),
        secure: process.env.SMTP_SECURE === 'true', // true для порта 465, false для остальных
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASSWORD
        }
      });
      
      this.initialized = true;
      logger.info('Email-сервис успешно инициализирован');
    } catch (error) {
      logger.error('Ошибка при инициализации email-сервиса:', error);
    }
  }

  /**
   * Отправляет email-сообщение
   * @param {Object} options - Параметры отправки
   * @param {string} options.to - Email получателя
   * @param {string} options.subject - Тема письма
   * @param {string} options.text - Текстовое содержимое
   * @param {string} options.html - HTML-содержимое (опционально)
   * @returns {Promise<Object>} - Результат отправки
   */
  async sendEmail(options) {
    try {
      // Если транспорт не инициализирован, пытаемся инициализировать его
      if (!this.initialized) {
        this.initialize();
        
        // Если инициализация не удалась
        if (!this.initialized) {
          return { success: false, error: 'Email-сервис не инициализирован' };
        }
      }
      
      // Проверяем обязательные поля
      if (!options.to || !options.subject || (!options.text && !options.html)) {
        return { success: false, error: 'Не указаны обязательные параметры (to, subject, text/html)' };
      }
      
      // Формируем объект отправки
      const mailOptions = {
        from: process.env.EMAIL_FROM || `"AI Assistant" <${process.env.SMTP_USER}>`,
        to: options.to,
        subject: options.subject,
        text: options.text
      };
      
      // Добавляем HTML-версию, если она указана
      if (options.html) {
        mailOptions.html = options.html;
      }
      
      // В режиме разработки логируем письмо вместо отправки
      if (process.env.NODE_ENV === 'development' && process.env.EMAIL_DEBUG === 'true') {
        logger.debug('Email не отправлен (режим разработки):', mailOptions);
        return { success: true, debug: true };
      }
      
      // Отправляем письмо
      const info = await this.transporter.sendMail(mailOptions);
      
      logger.info(`Email отправлен: ${info.messageId}`);
      
      return { success: true, messageId: info.messageId };
    } catch (error) {
      logger.error('Ошибка при отправке email:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Отправляет тестовое сообщение для проверки настроек
   * @param {string} to - Email получателя
   * @returns {Promise<Object>} - Результат отправки
   */
  async sendTestEmail(to) {
    try {
      return await this.sendEmail({
        to,
        subject: 'Тестовое сообщение от AI Assistant',
        text: 'Это тестовое сообщение для проверки настроек email-сервиса.',
        html: `
          <div style="font-family: Arial, sans-serif; padding: 20px; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #333;">Тестовое сообщение</h2>
            <p style="margin: 15px 0; line-height: 1.5;">Это тестовое сообщение для проверки настроек email-сервиса.</p>
            <p style="margin: 15px 0; line-height: 1.5;">Если вы получили это сообщение, значит настройки работают корректно.</p>
            <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
            <p style="color: #777; font-size: 12px;">Это автоматическое уведомление, пожалуйста, не отвечайте на него.</p>
          </div>
        `
      });
    } catch (error) {
      logger.error('Ошибка при отправке тестового email:', error);
      return { success: false, error: error.message };
    }
  }
}

// Экспортируем синглтон
const emailSender = new EmailSender();
module.exports = emailSender;