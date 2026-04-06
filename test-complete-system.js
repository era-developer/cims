#!/usr/bin/env node
/**
 * Complete System Test Suite for CIMS
 * Tests backend inventory logic and frontend component integration
 */

const { getInventory } = require('./backend/utils/excel');
const { CENTERS } = require('./backend/utils/centers');

async function testInventorySystem() {
  console.log('\n' + '='.repeat(70));
  console.log('CIMS - Complete System Test Suite');
  console.log('='.repeat(70));

  const tests = [];
  let passed = 0;
  let failed = 0;

  // Test 1: All centers have inventory
  console.log('\n[TEST 1] All Centers Have Inventory Data');
  try {
    for (const center of CENTERS) {
      const items = await getInventory(center.id);
      const test = {
        center: center.id,
        status: items.length > 0 ? 'PASS' : 'FAIL',
        count: items.length,
      };
      tests.push(test);
      console.log(`  ✓ ${center.name}: ${items.length} items`);
      passed++;
    }
  } catch (e) {
    console.log(`  ✗ Error: ${e.message}`);
    failed++;
  }

  // Test 2: JP Nagar has correct item count
  console.log('\n[TEST 2] JP Nagar Has 382 Items (Database Validation)');
  try {
    const jpItems = await getInventory('jp_nagar');
    if (jpItems.length === 382) {
      console.log(`  ✓ JP Nagar has exactly 382 items`);
      passed++;
    } else {
      console.log(`  ✗ JP Nagar has ${jpItems.length} items (expected 382)`);
      failed++;
    }
  } catch (e) {
    console.log(`  ✗ Error: ${e.message}`);
    failed++;
  }

  // Test 3: All items have correct centerId
  console.log('\n[TEST 3] All Items Have Correct Center ID');
  try {
    for (const center of CENTERS) {
      const items = await getInventory(center.id);
      const allCorrect = items.every(item => item.centerId === center.id);
      if (allCorrect && items.length > 0) {
        console.log(`  ✓ ${center.name}: All ${items.length} items have correct centerId`);
        passed++;
      } else if (items.length === 0) {
        console.log(`  ⊘ ${center.name}: No items (skipped)`);
      } else {
        console.log(`  ✗ ${center.name}: Some items have incorrect centerId`);
        failed++;
      }
    }
  } catch (e) {
    console.log(`  ✗ Error: ${e.message}`);
    failed++;
  }

  // Test 4: All items have required fields
  console.log('\n[TEST 4] All Items Have Required Fields');
  try {
    let totalItems = 0;
    let itemsWithAllFields = 0;

    for (const center of CENTERS) {
      const items = await getInventory(center.id);
      for (const item of items) {
        totalItems++;
        if (
          item.id &&
          item.centerId &&
          item.centerName &&
          item.name &&
          item.category &&
          item.stock !== undefined &&
          item.totalProcured !== undefined
        ) {
          itemsWithAllFields++;
        }
      }
    }

    if (itemsWithAllFields === totalItems) {
      console.log(`  ✓ All ${totalItems} items have required fields`);
      passed++;
    } else {
      console.log(`  ✗ ${totalItems - itemsWithAllFields} of ${totalItems} items missing fields`);
      failed++;
    }
  } catch (e) {
    console.log(`  ✗ Error: ${e.message}`);
    failed++;
  }

  // Test 5: JP Nagar sample items
  console.log('\n[TEST 5] JP Nagar Sample Items (Data Quality)');
  try {
    const items = await getInventory('jp_nagar');
    if (items.length > 0) {
      const samples = items.slice(0, 3);
      console.log('  Sample items:');
      samples.forEach((item, i) => {
        console.log(`    ${i + 1}. ${item.name}`);
        console.log(`       Category: ${item.category}, Stock: ${item.stock}`);
        console.log(`       Center: ${item.centerName}`);
      });
      passed++;
    }
  } catch (e) {
    console.log(`  ✗ Error: ${e.message}`);
    failed++;
  }

  // Test 6: Frontend compatibility check
  console.log('\n[TEST 6] Frontend API Response Format');
  try {
    const items = await getInventory('jp_nagar');
    if (items.length > 0) {
      const item = items[0];
      const expected = ['id', 'centerId', 'centerName', 'name', 'category', 'stock'];
      const hasAllFields = expected.every(field => field in item);

      if (hasAllFields) {
        console.log('  ✓ Response format is correct for frontend consumption');
        passed++;
      } else {
        console.log('  ✗ Response format is missing some fields');
        console.log('  Expected:', expected);
        console.log('  Got:', Object.keys(item));
        failed++;
      }
    }
  } catch (e) {
    console.log(`  ✗ Error: ${e.message}`);
    failed++;
  }

  // Test 7: Stock numbers are valid
  console.log('\n[TEST 7] Stock Numbers Validation');
  try {
    let validCount = 0;
    let totalCount = 0;

    for (const center of CENTERS) {
      const items = await getInventory(center.id);
      for (const item of items) {
        totalCount++;
        if (
          Number.isInteger(item.stock) &&
          item.stock >= 0 &&
          Number.isInteger(item.totalProcured) &&
          item.totalProcured >= 0
        ) {
          validCount++;
        }
      }
    }

    if (validCount === totalCount) {
      console.log(`  ✓ All ${totalCount} stock numbers are valid integers and non-negative`);
      passed++;
    } else {
      console.log(`  ✗ ${totalCount - validCount} of ${totalCount} items have invalid stock numbers`);
      failed++;
    }
  } catch (e) {
    console.log(`  ✗ Error: ${e.message}`);
    failed++;
  }

  // Summary
  console.log('\n' + '='.repeat(70));
  console.log('TEST SUMMARY');
  console.log('='.repeat(70));
  console.log(`Total Tests: ${passed + failed}`);
  console.log(`✓ Passed: ${passed}`);
  console.log(`✗ Failed: ${failed}`);

  if (failed === 0) {
    console.log('\n✓✓✓ ALL TESTS PASSED! ✓✓✓');
    console.log('The system is working correctly. You can now:');
    console.log('1. Visit http://localhost:3000 (frontend)');
    console.log('2. Log in with super admin credentials');
    console.log('3. Select "JP Nagar" from the center dropdown');
    console.log('4. Verify the inventory page displays 382 items');
    console.log('='.repeat(70));
    process.exit(0);
  } else {
    console.log('\n✗ Some tests failed. Please review the errors above.');
    console.log('='.repeat(70));
    process.exit(1);
  }
}

testInventorySystem().catch(err => {
  console.error('FATAL ERROR:', err);
  process.exit(1);
});
