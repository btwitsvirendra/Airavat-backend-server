// =============================================================================
// AIRAVAT B2B MARKETPLACE - GLOBAL TEST TEARDOWN
// Runs once after all test suites complete
// =============================================================================

module.exports = async () => {
  console.log('\n🧹 Cleaning up test environment...\n');

  try {
    // Close any open connections
    // Additional cleanup can be added here

    console.log('✅ Test environment cleaned up!\n');
  } catch (error) {
    console.error('⚠️ Warning during teardown:', error.message);
  }
};
