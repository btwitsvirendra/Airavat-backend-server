// =============================================================================
// AIRAVAT B2B MARKETPLACE - DATABASE CLIENT
// Prisma client with connection management and logging
// =============================================================================

const { PrismaClient } = require('@prisma/client');
const config = require('./index');

// Create Prisma client with logging configuration
const prisma = new PrismaClient({
  log: config.app.isDev
    ? [
        { level: 'query', emit: 'event' },
        { level: 'error', emit: 'stdout' },
        { level: 'warn', emit: 'stdout' },
      ]
    : [{ level: 'error', emit: 'stdout' }],
  errorFormat: config.app.isDev ? 'pretty' : 'minimal',
});

// Log queries in development (optional - can be verbose)
if (config.app.isDev && process.env.LOG_QUERIES === 'true') {
  prisma.$on('query', (e) => {
    console.log('Query: ' + e.query);
    console.log('Params: ' + e.params);
    console.log('Duration: ' + e.duration + 'ms');
    console.log('---');
  });
}

// Graceful shutdown
const disconnectDB = async () => {
  await prisma.$disconnect();
  console.log('📦 Database disconnected');
};

// Connect and verify
const connectDB = async () => {
  try {
    await prisma.$connect();
    console.log('📦 Database connected successfully');
    return true;
  } catch (error) {
    console.error('❌ Database connection failed:', error.message);
    throw error;
  }
};

// Export Prisma client extensions with soft delete support
const extendedPrisma = prisma.$extends({
  query: {
    // Soft delete support for models with deletedAt field
    $allModels: {
      async findMany({ model, operation, args, query }) {
        // Add deletedAt filter by default for models that support soft delete
        const softDeleteModels = ['User', 'Business', 'Product'];
        if (softDeleteModels.includes(model) && !args.where?.deletedAt) {
          args.where = { ...args.where, deletedAt: null };
        }
        return query(args);
      },
      async findFirst({ model, operation, args, query }) {
        const softDeleteModels = ['User', 'Business', 'Product'];
        if (softDeleteModels.includes(model) && !args.where?.deletedAt) {
          args.where = { ...args.where, deletedAt: null };
        }
        return query(args);
      },
    },
  },
  model: {
    // Add soft delete method to all models
    $allModels: {
      async softDelete(where) {
        const context = Prisma.getExtensionContext(this);
        return context.update({
          where,
          data: { deletedAt: new Date() },
        });
      },
    },
  },
});

module.exports = {
  prisma: extendedPrisma,
  connectDB,
  disconnectDB,
};
