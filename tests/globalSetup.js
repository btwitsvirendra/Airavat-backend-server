// =============================================================================
// AIRAVAT B2B MARKETPLACE - GLOBAL TEST SETUP
// Runs once before all test suites
// =============================================================================

const { execSync } = require('child_process');

module.exports = async () => {
  console.log('\n🚀 Setting up test environment...\n');

  // Set test environment
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'test-secret-key-for-testing';
  process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-key';

  // Use test database
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ||
    'postgresql://airavat:airavat123@localhost:5432/airavat_test?schema=public';

  try {
    // Run migrations
    console.log('📦 Running database migrations...');
    execSync('npx prisma migrate deploy', {
      env: process.env,
      stdio: 'inherit',
    });

    // Generate Prisma client
    console.log('🔧 Generating Prisma client...');
    execSync('npx prisma generate', {
      env: process.env,
      stdio: 'inherit',
    });

    console.log('\n✅ Test environment ready!\n');
  } catch (error) {
    console.error('❌ Failed to setup test environment:', error.message);
    process.exit(1);
  }
};
