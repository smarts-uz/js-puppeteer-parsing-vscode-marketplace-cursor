require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const { Sequelize } = require('sequelize');
const path = require('path');

// Define the path for the SQLite database file
const dbPath = path.join(__dirname, '../../data/extensions.db');

// Create Sequelize instance with SQLite
const sequelize = new Sequelize({
  dialect: 'sqlite',
  storage: path.join(__dirname, '../../data/extensions.db'),
  logging: false,
  pool: {
    max: 1,  // Bir vaqtda faqat bitta connection
    min: 0,
    acquire: 30000,
    idle: 10000
  },
  dialectOptions: {
    // WAL mode - Write Ahead Logging
    // Bu mode parallel yozishlarni tezlashtiradi
    pragmas: {
      journal_mode: 'WAL',
      synchronous: 'NORMAL', // FULL emas NORMAL ishlatamiz
      busy_timeout: 3000,
      cache_size: -2 * 1024 // 2MB cache
    }
  },
  retry: {
    max: 3,
    match: [/SQLITE_BUSY/]
  }
});

// Test the connection
const connectDB = async () => {
  try {
    await sequelize.authenticate();
    console.log('SQLite bazasiga muvaffaqiyatli ulandi');
    
    // Sync the models with the database
    await sequelize.sync();
    console.log('Database jadvallar sinxronlashtirildi');
  } catch (error) {
    console.error('Bazaga ulanishda xatolik:', error);
    throw error;
  }
};

module.exports = { sequelize, connectDB }; 