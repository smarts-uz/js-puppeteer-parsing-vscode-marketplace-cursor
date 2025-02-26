#!/usr/bin/env node
const { connectDB } = require('./config/database');
const Extension = require('./database/models/Extension');
const databaseScraper = require('./scraper/databaseScraper');
const path = require('path');
const fs = require('fs').promises;

const main = async () => {
  try {
    // Ensure data directory exists
    const dataDir = path.join(__dirname, '../data');
    try {
      await fs.access(dataDir);
    } catch {
      console.log('Data papkasi mavjud emas. Yaratilmoqda...');
      await fs.mkdir(dataDir, { recursive: true });
    }

    // Connect to SQLite database
    console.log('SQLite bazasiga ulanish...');
    await connectDB();
    
    // Force sync the model with the database
    console.log('Database jadvallarini yaratish...');
    await Extension.sync({ alter: true });
    console.log('Database jadvallar yaratildi');
    
    console.log('VSCode Extension scraping boshlandi...');
    await databaseScraper.initialize();
    await databaseScraper.scrapeExtensions();
    await databaseScraper.close();
    
    console.log('Scraping muvaffaqiyatli yakunlandi!');
    process.exit(0);
  } catch (error) {
    console.error('Xatolik yuz berdi:', error);
    process.exit(1);
  }
};

main(); 