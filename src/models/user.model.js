/**
 * Модель пользователя
 */
module.exports = (sequelize, DataTypes) => {
    const User = sequelize.define('User', {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
      },
      username: {
        type: DataTypes.STRING(50),
        allowNull: false,
        unique: true,
        validate: {
          len: [3, 50]
        }
      },
      email: {
        type: DataTypes.STRING(100),
        allowNull: false,
        unique: true,
        validate: {
          isEmail: true
        }
      },
      password: {
        type: DataTypes.STRING(255),
        allowNull: false,
        validate: {
          len: [6, 255]
        }
      },
      role: {
        type: DataTypes.ENUM('user', 'manager', 'admin'),
        defaultValue: 'user',
        allowNull: false
      },
      active: {
        type: DataTypes.BOOLEAN,
        defaultValue: true
      },
      last_login: {
        type: DataTypes.DATE,
        allowNull: true
      },
      created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW
      },
      updated_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW
      }
    }, {
      tableName: 'users',
      timestamps: false, // Мы управляем полями created_at и updated_at вручную
      hooks: {
        beforeCreate: (user) => {
          user.created_at = new Date();
          user.updated_at = new Date();
        },
        beforeUpdate: (user) => {
          user.updated_at = new Date();
        }
      }
    });
  
    /**
     * Дополнительные методы для модели пользователя
     */
    User.prototype.toJSON = function() {
      const values = Object.assign({}, this.get());
      delete values.password; // Не включаем пароль в JSON-представление
      return values;
    };
  
    return User;
  };