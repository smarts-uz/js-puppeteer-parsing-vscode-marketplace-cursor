const puppeteer = require('puppeteer');
const fs = require('fs').promises;
const path = require('path');
const Extension = require('../database/models/Extension');
const { Op } = require('sequelize');

class FileScraper {
  async initialize() {
    this.browser = await puppeteer.launch({
      headless: "new",
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu'
      ]
    });
  }

  async scrapeFiles(savePath) {
    try {
      // Faqat is_created=false bo'lgan extensionlarni olish
      const extensions = await Extension.findAll({
        where: {
          is_created: false,
          url: {
            [Op.not]: null
          }
        }
      });

      console.log(`${extensions.length} ta yangi extension topildi`);

      for (const extension of extensions) {
        await this.saveExtensionContent(extension, savePath);
      }

      console.log('\n=== YAKUNIY NATIJA ===');
      console.log(`Jami saqlangan fayllar: ${extensions.length}`);
      return extensions.length;
    } catch (error) {
      console.error('Scraping xatosi:', error);
      throw error;
    }
  }

  async saveExtensionContent(extension, savePath) {
    try {
      const page = await this.browser.newPage();
      await page.goto(extension.url, { waitUntil: 'networkidle0' });
      
      const htmlContent = await page.evaluate(() => document.documentElement.outerHTML);
      await page.close();

      const folderName = extension.name
        .replace(/\//g, ' ')
        .replace(/[\\:*?"<>|]/g, '_');
      const folderPath = path.join(savePath, folderName);

      // Create folder and save files
      await fs.mkdir(folderPath, { recursive: true });
      await fs.writeFile(path.join(folderPath, 'content.html'), htmlContent);
      
      const urlFilePath = path.join(folderPath, `${folderName}.url`);
      await fs.writeFile(urlFilePath, `[InternetShortcut]\nURL=${extension.url}\n`, 'utf8');

      // Update extension with local_path and is_created=true
      await Extension.update(
        { 
          local_path: folderPath,
          is_created: true 
        },
        { where: { id: extension.id } }
      );

      console.log(`✅ Saqlandi: ${extension.name} (${extension.url})`);
      console.log(`🔗 URL fayl saqlandi: ${urlFilePath}`);
    } catch (error) {
      console.error(`❌ Fayllarni saqlashda xatolik: ${extension.url}`, error);
    }
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
    }
  }
}

module.exports = new FileScraper(); 