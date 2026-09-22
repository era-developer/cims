const ExcelJS = require('exceljs');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

async function migrateUsers() {
  console.log('📥 Migrating legacy users to JP Nagar...\n');
  
  const users = new Map();
  
  // Read orders.xlsx for user data
  const ordersWb = new ExcelJS.Workbook();
  await ordersWb.xlsx.readFile('./data/orders.xlsx');
  const ordersWs = ordersWb.worksheets[0];
  
  ordersWs.eachRow((row, rn) => {
    if (rn > 1) {
      const studentName = row.values[3];  // Column C: Student Name
      const username = row.values[4];      // Column D: Username
      const mobile = row.values[5];        // Column E: Mobile
      const college = row.values[6];       // Column F: College
      const email = row.values[19];        // Column S: Email
      
      if (username && typeof username === 'string') {
        const key = username.toLowerCase().trim();
        if (!users.has(key) && username !== 'Username') {
          users.set(key, {
            username: username.trim(),
            fullName: studentName || username,
            email: email || (username.trim() + '@jp_nagar.cims.edu'),
            mobile: mobile || '',
            college: college || 'JP Nagar'
          });
        }
      }
    }
  });
  
  console.log('Found ' + users.size + ' users to migrate\n');
  
  // Load JP Nagar users file
  const jpWb = new ExcelJS.Workbook();
  await jpWb.xlsx.readFile('./data/jp_nagar/users.xlsx');
  const jpWs = jpWb.worksheets[0];
  
  let addedCount = 0;
  for (const [key, userData] of users) {
    let alreadyExists = false;
    jpWs.eachRow((row, rn) => {
      if (rn > 1 && row.values[4] === userData.username) {
        alreadyExists = true;
      }
    });
    
    if (!alreadyExists) {
      const hash = await bcrypt.hash(userData.username + '123', 10);
      jpWs.addRow([
        crypto.randomUUID(),
        'jp_nagar',
        'J P Nagar',
        userData.username,
        hash,
        userData.fullName,
        userData.email,
        userData.mobile,
        '',
        userData.college,
        '',
        '',
        '',
        'student',
        true,
        new Date().toISOString(),
        'migrated'
      ]);
      addedCount++;
      console.log('✓ ' + userData.username + ' (' + userData.fullName + ')');
    }
  }
  
  // Save updated file
  await jpWb.xlsx.writeFile('./data/jp_nagar/users.xlsx');
  console.log('\n✅ Successfully migrated ' + addedCount + ' users to JP Nagar');
  console.log('\nLogin credentials:');
  console.log('  Username: (any of the migrated usernames)');
  console.log('  Password: {username}123');
  console.log('  Example: raj / raj123');
}

migrateUsers().catch(e => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
