const puppeteer = require('puppeteer');
const Extension = require('../database/models/Extension');
const { sequelize } = require('../config/database');
const { Op } = require('sequelize');

class DatabaseScraper {
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

  async scrapeExtensions() {
    try {
      // Bitta page ochib ishlaymiz
      const page = await this.browser.newPage();
      await page.setDefaultNavigationTimeout(180000);
      await page.setDefaultTimeout(60000);
      
      // Keraksiz resurslarni bloklash
      await page.setRequestInterception(true);
      page.on('request', (request) => {
        if (['image', 'stylesheet', 'font', 'media'].includes(request.resourceType())) {
          request.abort();
        } else {
          request.continue();
        }
      });

      // Bazadagi mavjud identifier'larni olish
      const existingExtensions = await Extension.findAll({
        attributes: ['identifier']
      });
      const existingIdentifiers = new Set(
        existingExtensions.map(ext => ext.identifier)
      );
      
      console.log(`Bazada ${existingIdentifiers.size} ta extension mavjud`);
      
      const processedUrls = new Set();
      let totalSaved = 0;
      let totalErrors = 0;
      let totalSkipped = 0;
      
      const sortOptions = [
        'Installs',
        'Rating',
        'PublisherCount',
        'UpdatedDate',
        'ReleaseDate',
        'Name'
      ];

      const categories = [
        'All%20categories',
        'Programming%20Languages',
        'Snippets',
        'Linters',
        'Formatters',
        'Themes',
        'Debuggers',
        'Other',
        'Keymaps',
        'SCM%20Providers',
        'Extension%20Packs',
        'Language%20Packs',
        'Data%20Science',
        'Machine%20Learning',
        'Visualization',
        'Testing',
        'Education',
        'Azure'
      ];
      
      // Har bir kategoriya va sort uchun
      for (const category of categories) {
        for (const sortOption of sortOptions) {
          console.log(`\n=== ${category} kategoriyasi, ${sortOption} bo'yicha qidirilmoqda ===\n`);
          
          const url = `https://marketplace.visualstudio.com/search?target=VSCode&category=${category}&sortBy=${sortOption}&pageSize=100`;
          await page.goto(url, { waitUntil: 'networkidle0' });
          await page.waitForSelector('.item-list-container', { timeout: 80000 });
          
          let scrollCount = 0;
          const maxScrolls = 100; // Ko'proq scroll
          let noNewUrls = 0;
          
          while (scrollCount < maxScrolls && noNewUrls < 3) {
            const previousSize = processedUrls.size;
            
            // URL'larni yig'ish
            const newUrls = await this.extractUrlsAndIdentifiers(page);
            let batchUrls = [];
            
            for (const { url, identifier } of newUrls) {
              if (!processedUrls.has(url) && !existingIdentifiers.has(identifier)) {
                processedUrls.add(url);
                batchUrls.push({ url, identifier });
              }
            }

            // Agar yangi URL'lar topilmasa
            if (processedUrls.size === previousSize) {
              noNewUrls++;
              console.log(`⚠️ Yangi URL topilmadi (${noNewUrls}/3)`);
            } else {
              noNewUrls = 0;
            }

            // Topilgan URL'larni qayta ishlash
            if (batchUrls.length > 0) {
              console.log(`\n🔍 ${batchUrls.length} ta yangi URL topildi`);
              
              // URL'larni 5 talab qayta ishlash
              const batchSize = 5;
              for (let i = 0; i < batchUrls.length; i += batchSize) {
                const batch = batchUrls.slice(i, i + batchSize);
                const extensions = [];
                
                // Ma'lumotlarni yig'ish
                for (const { url } of batch) {
                  try {
                    const data = await this.getExtensionData(url);
                    if (data) {
                      extensions.push(data);
                    }
                  } catch (error) {
                    console.error(`❌ URL xatosi: ${url}`, error.message);
                    totalErrors++;
                  }
                }

                // Bazaga saqlash
                if (extensions.length > 0) {
                  try {
                    await sequelize.transaction(async (t) => {
                      for (const data of extensions) {
                        await Extension.findOrCreate({
                          where: { identifier: data.identifier },
                          defaults: { ...data, is_created: false },
                          transaction: t
                        });
                      }
                    });
                    totalSaved += extensions.length;
                    console.log(`✅ ${extensions.length} ta extension saqlandi`);
                  } catch (error) {
                    console.error('❌ Saqlash xatosi:', error.message);
                    totalErrors += extensions.length;
                  }
                }

                // Har bir batch'dan keyin kutish
                await new Promise(r => setTimeout(r, 500));
              }
            }

            // Scroll qilish
            await this.smartScroll(page);
            scrollCount++;
            
            // Statistika
            console.log(`\n📊 Progress: ${scrollCount}/${maxScrolls}`);
            console.log(`   • Topilgan: ${processedUrls.size} ta`);
            console.log(`   • Saqlangan: ${totalSaved} ta`);
            console.log(`   • Xatoliklar: ${totalErrors} ta`);
          }
        }
      }

      return totalSaved;
    } catch (error) {
      console.error('Scraping xatosi:', error);
      throw error;
    }
  }

  async extractUrlsAndIdentifiers(page) {
    return await page.evaluate(() => {
      const seen = new Set();
      const results = [];
      
      // Barcha kerakli elementlarni bir marta tanlab olish
      const containers = document.querySelectorAll([
        '.item-grid-container',
        '.item-list-container',
        '.gallery-item-card-container'
      ].join(','));

      containers.forEach(container => {
        const links = container.querySelectorAll('a[href*="/items?itemName="]');
        links.forEach(link => {
          const url = link.href;
          if (!seen.has(url)) {
            seen.add(url);
            const match = url.match(/itemName=([^&]+)/);
            if (match) {
              results.push({
                url,
                identifier: match[1],
                name: link.querySelector('.item-title')?.textContent || 
                      link.querySelector('.name')?.textContent || 
                      'Nomsiz'
              });
            }
          }
        });
      });

      return results;
    });
  }

  async getExtensionData(url) {
    const page = await this.browser.newPage();
    try {
      await page.setRequestInterception(true);
      page.on('request', (request) => {
        if (['image', 'stylesheet', 'font'].includes(request.resourceType())) {
          request.abort();
        } else {
          request.continue();
        }
      });

      await page.goto(url, { waitUntil: 'networkidle0' });
      
      const data = await page.evaluate((pageUrl) => {
        const getText = (selector) => {
          const element = document.querySelector(selector);
          return element ? element.textContent.trim() : '';
        };
        
        const getNumber = (selector) => {
          const text = getText(selector);
          return text ? parseInt(text.replace(/[^0-9]/g, '')) : 0;
        };
        
        const getArray = (selector) => {
          const elements = document.querySelectorAll(selector);
          return Array.from(elements).map(el => el.textContent.trim());
        };
        
        const getIdentifier = () => {
          const url = window.location.href;
          const match = url.match(/itemName=([^&]+)/);
          return match ? match[1] : '';
        };
        
        return {
          name: getText('h1[itemprop="name"]') || getText('.ux-item-name'),
          identifier: getIdentifier(),
          description: getText('.ux-item-shortdesc') || getText('.ux-item-description'),
          version: getText('.ux-item-meta-version') || getText('#version + td'),
          author: getText('.ux-item-publisher') || getText('#publisher + td'),
          url: pageUrl,
          downloads: getNumber('.ux-item-meta-installs') || getNumber('.installs'),
          installs: getNumber('.installs-text') || getNumber('.installs'),
          last_updated: getText('.extension-last-updated-date') || getText('#last-updated + td'),
          categories: getArray('.meta-data-list-link'),
          rating: parseFloat(getText('.ux-item-rating-count') || getText('.rating')) || 0,
          reviewCount: getText('.ux-item-rating-count span'),
          tags: getArray('.meta-data-list'),
          repository: getText('.ux-repository'),
          licenseUrl: getText('.ux-section-resources a[href*="license"]')
        };
      }, url);

      return this.prepareData(data);
    } catch (error) {
      console.error(`Error fetching ${url}:`, error);
      return null;
    } finally {
      await page.close();
    }
  }

  async saveToDatabase(data) {
    try {
      const [extension, created] = await Extension.findOrCreate({
        where: { identifier: data.identifier },
        defaults: {
          ...data,
          is_created: false
        }
      });
      
      if (!created) {
        await extension.update({
          ...data,
          is_created: false
        });
      }
      
      return extension;
    } catch (error) {
      console.error(`❌ Bazaga saqlashda xatolik:`, error);
      return null;
    }
  }

  prepareData(extensionData) {
    try {
      let lastUpdated = null;
      if (extensionData.last_updated) {
        try {
          lastUpdated = new Date(extensionData.last_updated);
          if (isNaN(lastUpdated.getTime())) lastUpdated = null;
        } catch (e) {
          lastUpdated = null;
        }
      }
      
      return {
        name: extensionData.name || null,
        identifier: extensionData.identifier || null,
        description: extensionData.description || null,
        version: extensionData.version || null,
        author: extensionData.author || null,
        url: extensionData.url || null,
        downloads: extensionData.downloads || null,
        installs: extensionData.installs || null,
        last_updated: lastUpdated,
        categories: extensionData.categories?.length > 0 ? extensionData.categories : null,
        rating: extensionData.rating || null,
        review_count: extensionData.reviewCount || null,
        tags: extensionData.tags?.length > 0 ? extensionData.tags : null,
        repository: extensionData.repository || null,
        license: extensionData.licenseUrl || null
      };
    } catch (error) {
      console.error('❌ Data tayyorlashda xatolik:', error);
      return null;
    }
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
    }
  }

  // Yangi smart scroll metodi
  async smartScroll(page) {
    await page.evaluate(async () => {
      const scrollStep = Math.max(500, window.innerHeight);
      const scrollDelay = 100;
      const maxScrollAttempts = 5;
      let scrollAttempt = 0;
      let lastScrollTop = window.pageYOffset;

      while (scrollAttempt < maxScrollAttempts) {
        const currentScrollTop = window.pageYOffset;
        window.scrollBy(0, scrollStep);
        await new Promise(resolve => setTimeout(resolve, scrollDelay));
        
        if (window.pageYOffset === lastScrollTop) {
          break; // Agar scroll bo'lmasa to'xtatamiz
        }
        
        lastScrollTop = window.pageYOffset;
        scrollAttempt++;
      }
    });

    // Dynamic content yuklanishi uchun kutish
    const waitTime = 2000; // Boshida ko'proq kutamiz
    await new Promise(r => setTimeout(r, waitTime));
  }

  // Batch saqlash uchun yangi metod
  async saveBatch(items) {
    try {
      await sequelize.transaction(async (t) => {
        for (const item of items) {
          await Extension.findOrCreate({
            where: { identifier: item.identifier },
            defaults: { ...item, is_created: false },
            transaction: t
          });
        }
      });
      return true;
    } catch (error) {
      console.error('Batch saqlashda xatolik:', error.message);
      return false;
    }
  }
}

module.exports = new DatabaseScraper(); 