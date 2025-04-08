const dbConfig = require('./db.config');

module.exports = {
  development: {
    ...dbConfig,
    dialect: dbConfig.dialect || 'mysql'
  },
  test: {
    ...dbConfig,
    dialect: dbConfig.dialect || 'mysql'
  },
  production: {
    ...dbConfig,
    dialect: dbConfig.dialect || 'mysql'
  }
};