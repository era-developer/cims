const ExcelJS = require('exceljs');
const path = require('path');
const fs = require('fs');

// This data is based on project documentation.
const CENTERS = [
    { id: 'jp_nagar', name: 'JP Nagar, Bengaluru' },
    { id: 'yelahanka', name: 'Yelahanka, Bengaluru' },
    { id: 'gopalan_mall', name: 'Gopalan Mall, Bengaluru' },
    { id: 'mysore', name: 'Mysore' },
    { id: 'tumkur', name: 'Tumkur' },
    { id: 'mangalore', name: 'Mangalore' },
    { id: 'hubballi', name: 'Hubballi' },
    { id: 'belagavi', name: 'Belagavi' },
    { id: 'kalaburagi', name: 'Kalaburagi' },
];

const SOURCE_CENTER_ID = 'jp_nagar';
const DATA_DIR = path.join(__dirname, '..', 'data');

/**
 * Finds the index of a column by trying multiple possible names, case-insensitively.
 * @param {Array<string>} headers - The list of headers from the Excel file.
 * @param {Array<string>} possibleNames - An array of possible names for the column.
 * @returns {number} The found index, or -1 if not found.
 */
function findColumnIndex(headers, possibleNames) {
    const lowerCaseHeaders = headers.map(h => String(h || '').toLowerCase().trim());
    for (const name of possibleNames) {
        const index = lowerCaseHeaders.indexOf(name.toLowerCase());
        if (index !== -1) return index;
    }
    return -1;
}

async function syncInventories() {
    console.log('🚀 Starting inventory synchronization...');

    // 1. Define source and target centers
    const sourceCenter = CENTERS.find(c => c.id === SOURCE_CENTER_ID);
    const targetCenters = CENTERS.filter(c => c.id !== SOURCE_CENTER_ID);

    if (!sourceCenter) {
        console.error(`❌ Source center "${SOURCE_CENTER_ID}" not found.`);
        return;
    }

    // 2. Read the source inventory file
    const sourceFilePath = path.join(DATA_DIR, sourceCenter.id, `${sourceCenter.id}_inventory.xlsx`);
    if (!fs.existsSync(sourceFilePath)) {
        console.error(`❌ Source inventory file not found at: ${sourceFilePath}`);
        return;
    }

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(sourceFilePath);
    const sourceSheet = workbook.worksheets[0];

    if (!sourceSheet) {
        console.error(`❌ No worksheet found in ${sourceFilePath}`);
        return;
    }

    const headerRow = sourceSheet.getRow(1);
    const headers = headerRow.values.slice(1); // .values is 1-based, but returns array starting at index 1

    // Define possible header names for each critical column to make the script more robust
    const headerMapping = {
        centerId: ['Center ID'],
        centerName: ['Center Name'],
        stock: ['Stock', 'Total Stock', 'Total', 'Current Stock'],
        available: ['Available', 'Available Stock', 'Current Stock'],
        issued: ['Issued', 'Issued Stock', 'Total Issued'],
        damaged: ['Damaged Count', 'Damaged'],
    };

    const colIndices = {};
    const missingColumns = [];

    // Find column indices using the flexible mapping
    for (const [key, possibleNames] of Object.entries(headerMapping)) {
        const index = findColumnIndex(headers, possibleNames);
        if (index === -1) {
            missingColumns.push({ key, names: possibleNames });
        }
        colIndices[key] = index + 1; // +1 because ExcelJS columns are 1-based
    }

    // Validate that we found all critical columns and provide a detailed error if not
    if (missingColumns.length > 0) {
        console.error('❌ Critical columns not found in source inventory headers.');
        missingColumns.forEach(mc => console.error(`   - Column "${mc.key}" was not found. Tried looking for: [${mc.names.join(', ')}]`));
        console.error('\nHeaders found in the Excel file:', headers.filter(Boolean));
        console.error('\nPlease check the source Excel file and correct the headers.');
        return;
    }

    const sourceDataRows = [];
    sourceSheet.eachRow((row, rowNumber) => {
        if (rowNumber > 1) { // Skip header
            sourceDataRows.push(row.values.slice(1));
        }
    });

    console.log(`✅ Found ${sourceDataRows.length} components in "${sourceCenter.name}" inventory.`);

    // 3. Loop through target centers and create new inventory files
    for (const targetCenter of targetCenters) {
        console.log(`\n🔄 Processing center: "${targetCenter.name}"...`);

        const targetWorkbook = new ExcelJS.Workbook();
        const targetSheet = targetWorkbook.addWorksheet('Inventory');
        targetSheet.addRow(headers);

        sourceDataRows.forEach(sourceRowData => {
            const newRow = [...sourceRowData]; // Create a copy
            newRow[colIndices.centerId - 1] = targetCenter.id;
            newRow[colIndices.centerName - 1] = targetCenter.name;
            newRow[colIndices.stock - 1] = 1;
            newRow[colIndices.available - 1] = 1;
            newRow[colIndices.issued - 1] = 0;
            newRow[colIndices.damaged - 1] = 0;
            targetSheet.addRow(newRow);
        });

        const targetFilePath = path.join(DATA_DIR, targetCenter.id, `${targetCenter.id}_inventory.xlsx`);
        await targetWorkbook.xlsx.writeFile(targetFilePath);
        console.log(`   ✅ Successfully wrote ${sourceDataRows.length} components to ${targetFilePath}`);
    }

    console.log('\n🎉 Inventory synchronization complete!');
}

syncInventories().catch(err => {
    console.error('An unexpected error occurred:', err);
});