const { sequelize } = require('../../config/database');

async function addIsCreatedColumn() {
  try {
    await sequelize.query(`
      ALTER TABLE Extensions 
      ADD COLUMN is_created BOOLEAN DEFAULT FALSE NOT NULL;
    `);
    console.log('is_created column qo\'shildi');
  } catch (error) {
    console.error('Migration xatosi:', error);
  }
}

addIsCreatedColumn(); 