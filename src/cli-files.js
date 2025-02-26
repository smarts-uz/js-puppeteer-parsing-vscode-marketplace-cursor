#!/usr/bin/env node
const { connectDB } = require('./config/database');
const Extension = require('./database/models/Extension');
const fileScraper = require('./scraper/fileScraper');
const path = require('path');
const fs = require('fs').promises;

// Argumentlarni olish
const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('Xatolik: Saqlash joyini ko\'rsating!');
  console.log('Ishlatish: vscode-files-scraper <saqlash_joyi>');
  console.log('Misol: vscode-files-scraper C:\\VSCodeExtensions');
  process.exit(1);
}

const savePath = args[0];

const main = async () => {
  try {
    // Connect to SQLite database
    console.log('SQLite bazasiga ulanish...');
    await connectDB();
    
    // Saqlash joyini tekshirish
    const absolutePath = path.resolve(savePath);
    console.log(`Saqlash joyi: ${absolutePath}`);
    
    // Papka mavjudligini tekshirish
    try {
      await fs.access(absolutePath);
    } catch {
      console.log('Ko\'rsatilgan papka mavjud emas. Yaratilmoqda...');
      await fs.mkdir(absolutePath, { recursive: true });
    }
    
    console.log('Fayllarni yuklash boshlandi...');
    await fileScraper.initialize();
    await fileScraper.scrapeFiles(absolutePath);
    await fileScraper.close();
    
    console.log('Fayllar muvaffaqiyatli yuklandi!');
    process.exit(0);
  } catch (error) {
    console.error('Xatolik yuz berdi:', error);
    process.exit(1);
  }
};

main(); 