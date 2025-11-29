// =============================================================================
// AIRAVAT B2B MARKETPLACE - BANK INTEGRATION SERVICE
// Direct bank feeds and account aggregation
// =============================================================================

const { prisma } = require('../config/database');
const { cache } = require('../config/redis');
const logger = require('../config/logger');
const { eventEmitter } = require('./eventEmitter.service');
const { encrypt, decrypt } = require('./dataEncryption.service');
const axios = require('axios');

/**
 * Bank Integration Configuration
 */
const BANK_CONFIG = {
  providers: {
    RAZORPAY: {
      name: 'Razorpay',
      apiUrl: process.env.RAZORPAY_API_URL || 'https://api.razorpay.com/v1',
      supportedBanks: ['HDFC', 'ICICI', 'SBI', 'AXIS', 'KOTAK', 'YES', 'PNB'],
    },
    YODLEE: {
      name: 'Yodlee',
      apiUrl: process.env.YODLEE_API_URL || 'https://sandbox.api.yodlee.com/ysl',
      supportedBanks: ['ALL'],
    },
    FINBOX: {
      name: 'Finbox',
      apiUrl: process.env.FINBOX_API_URL || 'https://api.finbox.in/v1',
      supportedBanks: ['ALL'],
    },
    AA: {
      name: 'Account Aggregator',
      apiUrl: process.env.AA_API_URL,
      supportedBanks: ['AA_ENABLED'],
    },
  },
  defaultProvider: process.env.BANK_PROVIDER || 'RAZORPAY',
  syncIntervalHours: 6,
  transactionRetentionDays: 365,
  consentValidityDays: 365,
  cachePrefix: 'bank:',
  cacheTTL: 300,
};

class BankIntegrationService {
  // ===========================================================================
  // BANK CONNECTION
  // ===========================================================================

  /**
   * Initialize bank connection
   */
  async initiateConnection(businessId, bankDetails) {
    const {
      bankName,
      bankCode,
      accountNumber,
      accountType,
      provider = BANK_CONFIG.defaultProvider,
    } = bankDetails;

    // Validate business
    const business = await prisma.business.findUnique({
      where: { id: businessId },
    });
    if (!business) throw new Error('Business not found');
    if (business.verificationStatus !== 'VERIFIED') {
      throw new Error('Business must be verified for bank integration');
    }

    // Check if connection already exists
    const existingConnection = await prisma.bankConnection.findFirst({
      where: {
        businessId,
        accountNumber: encrypt(accountNumber),
        status: { in: ['PENDING', 'ACTIVE'] },
      },
    });

    if (existingConnection) {
      throw new Error('Bank connection already exists for this account');
    }

    // Encrypt sensitive data
    const encryptedAccountNumber = encrypt(accountNumber);

    // Create connection record
    const connection = await prisma.bankConnection.create({
      data: {
        businessId,
        bankName,
        bankCode,
        accountNumber: encryptedAccountNumber,
        accountType,
        connectionProvider: provider,
        status: 'PENDING',
      },
    });

    // Initialize with provider
    const consentData = await this.initializeWithProvider(provider, {
      businessId,
      bankName,
      bankCode,
      accountNumber,
      connectionId: connection.id,
    });

    // Update with consent details
    await prisma.bankConnection.update({
      where: { id: connection.id },
      data: {
        consentId: consentData.consentId,
        consentExpiresAt: consentData.expiresAt,
      },
    });

    logger.info('Bank connection initiated', {
      connectionId: connection.id,
      businessId,
      bankName,
      provider,
    });

    return {
      connectionId: connection.id,
      consentUrl: consentData.consentUrl,
      consentId: consentData.consentId,
    };
  }

  /**
   * Initialize connection with provider
   */
  async initializeWithProvider(provider, details) {
    const providerConfig = BANK_CONFIG.providers[provider];
    if (!providerConfig) throw new Error('Invalid provider');

    // In production, this would call the actual provider API
    // For now, simulate the consent flow

    const consentId = `consent_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + BANK_CONFIG.consentValidityDays);

    return {
      consentId,
      consentUrl: `${providerConfig.apiUrl}/consent/${consentId}`,
      expiresAt,
    };
  }

  /**
   * Handle consent callback
   */
  async handleConsentCallback(connectionId, consentResult) {
    const { success, consentId, error } = consentResult;

    const connection = await prisma.bankConnection.findUnique({
      where: { id: connectionId },
    });

    if (!connection) throw new Error('Connection not found');
    if (connection.consentId !== consentId) throw new Error('Invalid consent');

    if (success) {
      await prisma.bankConnection.update({
        where: { id: connectionId },
        data: {
          status: 'ACTIVE',
          connectionId: consentId,
        },
      });

      // Trigger initial sync
      await this.syncTransactions(connectionId);

      logger.info('Bank connection activated', { connectionId });

      eventEmitter.emit('bank.connected', {
        connectionId,
        businessId: connection.businessId,
      });

      return { success: true };
    } else {
      await prisma.bankConnection.update({
        where: { id: connectionId },
        data: {
          status: 'FAILED',
          syncError: error,
        },
      });

      logger.warn('Bank connection failed', { connectionId, error });

      return { success: false, error };
    }
  }

  /**
   * Get connection status
   */
  async getConnection(connectionId) {
    const connection = await prisma.bankConnection.findUnique({
      where: { id: connectionId },
    });

    if (!connection) return null;

    return {
      ...connection,
      accountNumber: this.maskAccountNumber(decrypt(connection.accountNumber)),
    };
  }

  /**
   * Get business connections
   */
  async getBusinessConnections(businessId) {
    const connections = await prisma.bankConnection.findMany({
      where: { businessId },
      orderBy: { createdAt: 'desc' },
    });

    return connections.map(conn => ({
      ...conn,
      accountNumber: this.maskAccountNumber(decrypt(conn.accountNumber)),
    }));
  }

  /**
   * Mask account number
   */
  maskAccountNumber(accountNumber) {
    if (!accountNumber) return '';
    const len = accountNumber.length;
    return 'X'.repeat(len - 4) + accountNumber.slice(-4);
  }

  /**
   * Revoke connection
   */
  async revokeConnection(connectionId, businessId) {
    const connection = await prisma.bankConnection.findFirst({
      where: { id: connectionId, businessId },
    });

    if (!connection) throw new Error('Connection not found');

    // Revoke consent with provider
    await this.revokeProviderConsent(connection.connectionProvider, connection.consentId);

    await prisma.bankConnection.update({
      where: { id: connectionId },
      data: { status: 'REVOKED' },
    });

    logger.info('Bank connection revoked', { connectionId });

    return { success: true };
  }

  /**
   * Revoke consent with provider
   */
  async revokeProviderConsent(provider, consentId) {
    // In production, call provider API to revoke consent
    logger.info('Consent revoked with provider', { provider, consentId });
    return true;
  }

  // ===========================================================================
  // TRANSACTION SYNC
  // ===========================================================================

  /**
   * Sync transactions from bank
   */
  async syncTransactions(connectionId, options = {}) {
    const { fromDate, toDate } = options;

    const connection = await prisma.bankConnection.findUnique({
      where: { id: connectionId },
    });

    if (!connection) throw new Error('Connection not found');
    if (connection.status !== 'ACTIVE') throw new Error('Connection not active');

    // Check consent validity
    if (connection.consentExpiresAt && connection.consentExpiresAt < new Date()) {
      await prisma.bankConnection.update({
        where: { id: connectionId },
        data: { status: 'EXPIRED' },
      });
      throw new Error('Consent has expired');
    }

    try {
      // Fetch transactions from provider
      const transactions = await this.fetchTransactionsFromProvider(
        connection.connectionProvider,
        connection.connectionId,
        { fromDate, toDate }
      );

      // Store transactions
      let newCount = 0;
      for (const txn of transactions) {
        const existing = await prisma.bankTransaction.findUnique({
          where: {
            connectionId_transactionId: {
              connectionId,
              transactionId: txn.transactionId,
            },
          },
        });

        if (!existing) {
          await prisma.bankTransaction.create({
            data: {
              connectionId,
              transactionId: txn.transactionId,
              transactionDate: new Date(txn.date),
              valueDate: txn.valueDate ? new Date(txn.valueDate) : null,
              amount: txn.amount,
              type: txn.type,
              description: txn.description,
              reference: txn.reference,
              runningBalance: txn.balance,
              counterpartyName: txn.counterpartyName,
              counterpartyAccount: txn.counterpartyAccount,
              category: this.categorizeTransaction(txn),
            },
          });
          newCount++;
        }
      }

      // Update last sync time
      await prisma.bankConnection.update({
        where: { id: connectionId },
        data: {
          lastSyncAt: new Date(),
          syncError: null,
        },
      });

      logger.info('Bank transactions synced', {
        connectionId,
        totalFetched: transactions.length,
        newTransactions: newCount,
      });

      return {
        success: true,
        totalFetched: transactions.length,
        newTransactions: newCount,
      };
    } catch (error) {
      await prisma.bankConnection.update({
        where: { id: connectionId },
        data: { syncError: error.message },
      });

      logger.error('Bank sync failed', { connectionId, error: error.message });

      throw error;
    }
  }

  /**
   * Fetch transactions from provider
   */
  async fetchTransactionsFromProvider(provider, connectionId, dateRange) {
    // In production, call actual provider API
    // For now, return mock data

    const mockTransactions = [
      {
        transactionId: `TXN_${Date.now()}_1`,
        date: new Date().toISOString(),
        amount: 50000,
        type: 'CREDIT',
        description: 'NEFT from ABC Corp',
        reference: 'NEFT123456789',
        balance: 150000,
        counterpartyName: 'ABC Corp',
        counterpartyAccount: 'XXXX1234',
      },
      {
        transactionId: `TXN_${Date.now()}_2`,
        date: new Date().toISOString(),
        amount: 25000,
        type: 'DEBIT',
        description: 'Payment to Vendor',
        reference: 'IMPS987654321',
        balance: 125000,
        counterpartyName: 'XYZ Vendor',
        counterpartyAccount: 'XXXX5678',
      },
    ];

    return mockTransactions;
  }

  /**
   * Categorize transaction
   */
  categorizeTransaction(transaction) {
    const description = (transaction.description || '').toLowerCase();

    if (description.includes('salary') || description.includes('payroll')) {
      return 'SALARY';
    }
    if (description.includes('gst') || description.includes('tax')) {
      return 'TAX';
    }
    if (description.includes('rent') || description.includes('lease')) {
      return 'RENT';
    }
    if (description.includes('electricity') || description.includes('utility')) {
      return 'UTILITY';
    }
    if (description.includes('vendor') || description.includes('supplier')) {
      return 'VENDOR_PAYMENT';
    }
    if (description.includes('customer') || description.includes('invoice')) {
      return 'CUSTOMER_RECEIPT';
    }

    return 'OTHER';
  }

  /**
   * Sync all active connections (scheduled job)
   */
  async syncAllConnections() {
    const cutoffTime = new Date();
    cutoffTime.setHours(cutoffTime.getHours() - BANK_CONFIG.syncIntervalHours);

    const connectionsToSync = await prisma.bankConnection.findMany({
      where: {
        status: 'ACTIVE',
        OR: [
          { lastSyncAt: null },
          { lastSyncAt: { lt: cutoffTime } },
        ],
      },
    });

    let successCount = 0;
    let failCount = 0;

    for (const connection of connectionsToSync) {
      try {
        await this.syncTransactions(connection.id);
        successCount++;
      } catch (error) {
        failCount++;
        logger.error('Sync failed for connection', {
          connectionId: connection.id,
          error: error.message,
        });
      }
    }

    logger.info('Bulk bank sync completed', {
      total: connectionsToSync.length,
      success: successCount,
      failed: failCount,
    });

    return { total: connectionsToSync.length, success: successCount, failed: failCount };
  }

  // ===========================================================================
  // TRANSACTION QUERIES
  // ===========================================================================

  /**
   * Get transactions for connection
   */
  async getTransactions(connectionId, businessId, options = {}) {
    const { page = 1, limit = 50, type, startDate, endDate, category, isReconciled } = options;

    // Verify business owns connection
    const connection = await prisma.bankConnection.findFirst({
      where: { id: connectionId, businessId },
    });
    if (!connection) throw new Error('Connection not found');

    const where = { connectionId };
    if (type) where.type = type;
    if (category) where.category = category;
    if (isReconciled !== undefined) where.isReconciled = isReconciled;
    if (startDate || endDate) {
      where.transactionDate = {};
      if (startDate) where.transactionDate.gte = new Date(startDate);
      if (endDate) where.transactionDate.lte = new Date(endDate);
    }

    const [transactions, total] = await Promise.all([
      prisma.bankTransaction.findMany({
        where,
        orderBy: { transactionDate: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.bankTransaction.count({ where }),
    ]);

    return {
      transactions,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Get transaction summary
   */
  async getTransactionSummary(connectionId, businessId, period = 30) {
    const connection = await prisma.bankConnection.findFirst({
      where: { id: connectionId, businessId },
    });
    if (!connection) throw new Error('Connection not found');

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - period);

    const [credits, debits, byCategory] = await Promise.all([
      prisma.bankTransaction.aggregate({
        where: {
          connectionId,
          type: 'CREDIT',
          transactionDate: { gte: startDate },
        },
        _sum: { amount: true },
        _count: true,
      }),
      prisma.bankTransaction.aggregate({
        where: {
          connectionId,
          type: 'DEBIT',
          transactionDate: { gte: startDate },
        },
        _sum: { amount: true },
        _count: true,
      }),
      prisma.bankTransaction.groupBy({
        by: ['category'],
        where: {
          connectionId,
          transactionDate: { gte: startDate },
        },
        _sum: { amount: true },
        _count: true,
      }),
    ]);

    return {
      period: `Last ${period} days`,
      credits: {
        count: credits._count,
        total: parseFloat(credits._sum.amount || 0),
      },
      debits: {
        count: debits._count,
        total: parseFloat(debits._sum.amount || 0),
      },
      netFlow: parseFloat(credits._sum.amount || 0) - parseFloat(debits._sum.amount || 0),
      byCategory: byCategory.map(c => ({
        category: c.category,
        count: c._count,
        total: parseFloat(c._sum.amount),
      })),
    };
  }

  /**
   * Search transactions
   */
  async searchTransactions(businessId, searchTerm, options = {}) {
    const { page = 1, limit = 50 } = options;

    // Get all connections for business
    const connections = await prisma.bankConnection.findMany({
      where: { businessId, status: 'ACTIVE' },
      select: { id: true },
    });

    const connectionIds = connections.map(c => c.id);

    const where = {
      connectionId: { in: connectionIds },
      OR: [
        { description: { contains: searchTerm, mode: 'insensitive' } },
        { reference: { contains: searchTerm, mode: 'insensitive' } },
        { counterpartyName: { contains: searchTerm, mode: 'insensitive' } },
      ],
    };

    const [transactions, total] = await Promise.all([
      prisma.bankTransaction.findMany({
        where,
        include: {
          connection: {
            select: { bankName: true, accountNumber: true },
          },
        },
        orderBy: { transactionDate: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.bankTransaction.count({ where }),
    ]);

    return {
      transactions: transactions.map(t => ({
        ...t,
        connection: {
          ...t.connection,
          accountNumber: this.maskAccountNumber(decrypt(t.connection.accountNumber)),
        },
      })),
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    };
  }

  // ===========================================================================
  // BALANCE & STATEMENTS
  // ===========================================================================

  /**
   * Get current balance
   */
  async getCurrentBalance(connectionId, businessId) {
    const connection = await prisma.bankConnection.findFirst({
      where: { id: connectionId, businessId },
    });
    if (!connection) throw new Error('Connection not found');

    // Get latest transaction with balance
    const latestTxn = await prisma.bankTransaction.findFirst({
      where: { connectionId },
      orderBy: { transactionDate: 'desc' },
    });

    return {
      connectionId,
      bankName: connection.bankName,
      accountNumber: this.maskAccountNumber(decrypt(connection.accountNumber)),
      balance: latestTxn?.runningBalance || 0,
      lastUpdated: latestTxn?.transactionDate || connection.lastSyncAt,
    };
  }

  /**
   * Get all balances for business
   */
  async getAllBalances(businessId) {
    const connections = await prisma.bankConnection.findMany({
      where: { businessId, status: 'ACTIVE' },
    });

    const balances = [];

    for (const conn of connections) {
      const balance = await this.getCurrentBalance(conn.id, businessId);
      balances.push(balance);
    }

    const totalBalance = balances.reduce((sum, b) => sum + parseFloat(b.balance || 0), 0);

    return {
      accounts: balances,
      totalBalance,
    };
  }

  /**
   * Generate statement
   */
  async generateStatement(connectionId, businessId, startDate, endDate) {
    const connection = await prisma.bankConnection.findFirst({
      where: { id: connectionId, businessId },
    });
    if (!connection) throw new Error('Connection not found');

    const transactions = await prisma.bankTransaction.findMany({
      where: {
        connectionId,
        transactionDate: {
          gte: new Date(startDate),
          lte: new Date(endDate),
        },
      },
      orderBy: { transactionDate: 'asc' },
    });

    // Calculate opening and closing balance
    const openingTxn = await prisma.bankTransaction.findFirst({
      where: {
        connectionId,
        transactionDate: { lt: new Date(startDate) },
      },
      orderBy: { transactionDate: 'desc' },
    });

    const openingBalance = openingTxn?.runningBalance || 0;
    const closingBalance = transactions.length > 0 
      ? transactions[transactions.length - 1].runningBalance 
      : openingBalance;

    const totalCredits = transactions
      .filter(t => t.type === 'CREDIT')
      .reduce((sum, t) => sum + parseFloat(t.amount), 0);

    const totalDebits = transactions
      .filter(t => t.type === 'DEBIT')
      .reduce((sum, t) => sum + parseFloat(t.amount), 0);

    return {
      bankName: connection.bankName,
      accountNumber: this.maskAccountNumber(decrypt(connection.accountNumber)),
      accountType: connection.accountType,
      statementPeriod: { startDate, endDate },
      openingBalance: parseFloat(openingBalance),
      closingBalance: parseFloat(closingBalance),
      totalCredits,
      totalDebits,
      transactionCount: transactions.length,
      transactions,
    };
  }

  // ===========================================================================
  // CLEANUP
  // ===========================================================================

  /**
   * Clean old transactions (scheduled job)
   */
  async cleanOldTransactions() {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - BANK_CONFIG.transactionRetentionDays);

    const result = await prisma.bankTransaction.deleteMany({
      where: {
        transactionDate: { lt: cutoffDate },
        isReconciled: true,
      },
    });

    if (result.count > 0) {
      logger.info('Cleaned old bank transactions', { count: result.count });
    }

    return result.count;
  }
}

module.exports = new BankIntegrationService();
