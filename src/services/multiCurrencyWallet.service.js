// =============================================================================
// AIRAVAT B2B MARKETPLACE - MULTI-CURRENCY WALLET SERVICE
// Hold and exchange multiple currencies in wallet
// =============================================================================

const { prisma } = require('../config/database');
const { cache } = require('../config/redis');
const logger = require('../config/logger');
const { eventEmitter } = require('./eventEmitter.service');

/**
 * Multi-currency Configuration
 */
const CURRENCY_CONFIG = {
  baseCurrency: 'INR',
  supportedCurrencies: ['INR', 'USD', 'AED', 'EUR', 'GBP', 'SGD', 'JPY', 'CNY'],
  exchangeRateProvider: 'OPENEXCHANGERATES', // or 'FIXER', 'CURRENCYLAYER'
  exchangeMarkup: 1.5, // 1.5% markup on exchange
  minExchangeAmount: 100,
  maxExchangeAmount: 10000000,
  ratesCacheTTL: 3600, // 1 hour
  cachePrefix: 'forex:',
};

/**
 * Currency details
 */
const CURRENCY_DETAILS = {
  INR: { name: 'Indian Rupee', symbol: '₹', decimals: 2 },
  USD: { name: 'US Dollar', symbol: '$', decimals: 2 },
  AED: { name: 'UAE Dirham', symbol: 'د.إ', decimals: 2 },
  EUR: { name: 'Euro', symbol: '€', decimals: 2 },
  GBP: { name: 'British Pound', symbol: '£', decimals: 2 },
  SGD: { name: 'Singapore Dollar', symbol: 'S$', decimals: 2 },
  JPY: { name: 'Japanese Yen', symbol: '¥', decimals: 0 },
  CNY: { name: 'Chinese Yuan', symbol: '¥', decimals: 2 },
};

class MultiCurrencyWalletService {
  // ===========================================================================
  // EXCHANGE RATES
  // ===========================================================================

  /**
   * Get current exchange rates
   */
  async getExchangeRates(baseCurrency = CURRENCY_CONFIG.baseCurrency) {
    const cacheKey = `${CURRENCY_CONFIG.cachePrefix}rates:${baseCurrency}`;
    
    // Try cache first
    const cached = await cache.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }

    // Fetch from provider (simulated)
    const rates = await this.fetchExchangeRates(baseCurrency);

    // Cache rates
    await cache.set(cacheKey, JSON.stringify(rates), CURRENCY_CONFIG.ratesCacheTTL);

    return rates;
  }

  /**
   * Fetch exchange rates from provider
   */
  async fetchExchangeRates(baseCurrency) {
    // In production, call actual exchange rate API
    // For simulation, using approximate rates
    
    const baseRates = {
      INR: 1,
      USD: 0.012,
      AED: 0.044,
      EUR: 0.011,
      GBP: 0.0095,
      SGD: 0.016,
      JPY: 1.8,
      CNY: 0.087,
    };

    const rates = {};
    const baseRate = baseRates[baseCurrency] || 1;

    for (const currency of CURRENCY_CONFIG.supportedCurrencies) {
      if (currency === baseCurrency) {
        rates[currency] = 1;
      } else {
        rates[currency] = baseRates[currency] / baseRate;
      }
    }

    return {
      base: baseCurrency,
      timestamp: new Date().toISOString(),
      rates,
    };
  }

  /**
   * Get exchange rate between two currencies
   */
  async getExchangeRate(fromCurrency, toCurrency) {
    if (fromCurrency === toCurrency) return 1;

    const rates = await this.getExchangeRates(fromCurrency);
    const rate = rates.rates[toCurrency];

    if (!rate) {
      throw new Error(`Exchange rate not available for ${fromCurrency} to ${toCurrency}`);
    }

    return rate;
  }

  /**
   * Get rate with markup (customer rate)
   */
  async getCustomerRate(fromCurrency, toCurrency) {
    const baseRate = await this.getExchangeRate(fromCurrency, toCurrency);
    
    // Apply markup (customer gets slightly worse rate)
    const markup = CURRENCY_CONFIG.exchangeMarkup / 100;
    const customerRate = baseRate * (1 - markup);

    return {
      baseRate,
      customerRate,
      markup: CURRENCY_CONFIG.exchangeMarkup,
    };
  }

  /**
   * Calculate exchange amount
   */
  async calculateExchange(fromCurrency, toCurrency, amount) {
    if (!CURRENCY_CONFIG.supportedCurrencies.includes(fromCurrency)) {
      throw new Error(`Currency ${fromCurrency} not supported`);
    }
    if (!CURRENCY_CONFIG.supportedCurrencies.includes(toCurrency)) {
      throw new Error(`Currency ${toCurrency} not supported`);
    }

    const { baseRate, customerRate, markup } = await this.getCustomerRate(fromCurrency, toCurrency);
    
    const toDecimals = CURRENCY_DETAILS[toCurrency]?.decimals || 2;
    const receivedAmount = parseFloat((amount * customerRate).toFixed(toDecimals));
    const fee = parseFloat((amount * (markup / 100)).toFixed(CURRENCY_DETAILS[fromCurrency]?.decimals || 2));

    return {
      fromCurrency,
      toCurrency,
      fromAmount: amount,
      toAmount: receivedAmount,
      rate: customerRate,
      baseRate,
      fee,
      feePercentage: markup,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000), // Quote valid for 5 minutes
    };
  }

  // ===========================================================================
  // CURRENCY BALANCE MANAGEMENT
  // ===========================================================================

  /**
   * Add currency balance to wallet
   */
  async addCurrencyBalance(walletId, currency) {
    if (!CURRENCY_CONFIG.supportedCurrencies.includes(currency)) {
      throw new Error(`Currency ${currency} not supported`);
    }

    // Check if balance already exists
    const existing = await prisma.walletCurrencyBalance.findUnique({
      where: {
        walletId_currency: { walletId, currency },
      },
    });

    if (existing) {
      return existing;
    }

    const balance = await prisma.walletCurrencyBalance.create({
      data: {
        walletId,
        currency,
        balance: 0,
        lockedBalance: 0,
      },
    });

    logger.info('Currency balance added to wallet', { walletId, currency });

    return balance;
  }

  /**
   * Get all currency balances for wallet
   */
  async getCurrencyBalances(walletId) {
    const balances = await prisma.walletCurrencyBalance.findMany({
      where: { walletId },
    });

    // Get current exchange rates to INR for total calculation
    const rates = await this.getExchangeRates('INR');

    const formattedBalances = balances.map(bal => {
      const inrEquivalent = parseFloat(bal.balance) / (rates.rates[bal.currency] || 1);
      
      return {
        currency: bal.currency,
        currencyDetails: CURRENCY_DETAILS[bal.currency],
        balance: parseFloat(bal.balance),
        lockedBalance: parseFloat(bal.lockedBalance),
        availableBalance: parseFloat(bal.balance) - parseFloat(bal.lockedBalance),
        inrEquivalent: Math.round(inrEquivalent * 100) / 100,
      };
    });

    const totalINR = formattedBalances.reduce((sum, bal) => sum + bal.inrEquivalent, 0);

    return {
      balances: formattedBalances,
      totalEquivalentINR: Math.round(totalINR * 100) / 100,
    };
  }

  /**
   * Credit currency to wallet
   */
  async creditCurrency(walletId, currency, amount, options = {}) {
    const { referenceType, referenceId, description } = options;

    // Ensure currency balance exists
    await this.addCurrencyBalance(walletId, currency);

    // Update balance
    const balance = await prisma.walletCurrencyBalance.update({
      where: {
        walletId_currency: { walletId, currency },
      },
      data: {
        balance: { increment: amount },
      },
    });

    // Create transaction record
    const wallet = await prisma.wallet.findUnique({ where: { id: walletId } });
    
    await prisma.walletTransaction.create({
      data: {
        walletId,
        type: 'CREDIT',
        amount,
        currency,
        balanceBefore: parseFloat(balance.balance) - amount,
        balanceAfter: parseFloat(balance.balance),
        referenceType,
        referenceId,
        description,
        status: 'COMPLETED',
      },
    });

    logger.info('Currency credited', { walletId, currency, amount });

    return balance;
  }

  /**
   * Debit currency from wallet
   */
  async debitCurrency(walletId, currency, amount, options = {}) {
    const { referenceType, referenceId, description } = options;

    const balance = await prisma.walletCurrencyBalance.findUnique({
      where: {
        walletId_currency: { walletId, currency },
      },
    });

    if (!balance) {
      throw new Error(`No ${currency} balance in wallet`);
    }

    const available = parseFloat(balance.balance) - parseFloat(balance.lockedBalance);
    if (amount > available) {
      throw new Error(`Insufficient ${currency} balance`);
    }

    const updatedBalance = await prisma.walletCurrencyBalance.update({
      where: {
        walletId_currency: { walletId, currency },
      },
      data: {
        balance: { decrement: amount },
      },
    });

    await prisma.walletTransaction.create({
      data: {
        walletId,
        type: 'DEBIT',
        amount,
        currency,
        balanceBefore: parseFloat(balance.balance),
        balanceAfter: parseFloat(updatedBalance.balance),
        referenceType,
        referenceId,
        description,
        status: 'COMPLETED',
      },
    });

    logger.info('Currency debited', { walletId, currency, amount });

    return updatedBalance;
  }

  // ===========================================================================
  // CURRENCY EXCHANGE
  // ===========================================================================

  /**
   * Exchange currency within wallet
   */
  async exchangeCurrency(walletId, fromCurrency, toCurrency, amount, userId) {
    // Validate currencies
    if (!CURRENCY_CONFIG.supportedCurrencies.includes(fromCurrency)) {
      throw new Error(`Currency ${fromCurrency} not supported`);
    }
    if (!CURRENCY_CONFIG.supportedCurrencies.includes(toCurrency)) {
      throw new Error(`Currency ${toCurrency} not supported`);
    }
    if (fromCurrency === toCurrency) {
      throw new Error('Cannot exchange to same currency');
    }

    // Validate amount
    if (amount < CURRENCY_CONFIG.minExchangeAmount) {
      throw new Error(`Minimum exchange amount is ${CURRENCY_CONFIG.minExchangeAmount}`);
    }
    if (amount > CURRENCY_CONFIG.maxExchangeAmount) {
      throw new Error(`Maximum exchange amount is ${CURRENCY_CONFIG.maxExchangeAmount}`);
    }

    // Verify wallet ownership
    const wallet = await prisma.wallet.findUnique({
      where: { id: walletId },
    });
    if (!wallet) throw new Error('Wallet not found');
    if (wallet.userId !== userId) throw new Error('Unauthorized');

    // Check source balance
    const sourceBalance = await prisma.walletCurrencyBalance.findUnique({
      where: {
        walletId_currency: { walletId, currency: fromCurrency },
      },
    });

    if (!sourceBalance) {
      throw new Error(`No ${fromCurrency} balance in wallet`);
    }

    const available = parseFloat(sourceBalance.balance) - parseFloat(sourceBalance.lockedBalance);
    if (amount > available) {
      throw new Error(`Insufficient ${fromCurrency} balance`);
    }

    // Calculate exchange
    const exchange = await this.calculateExchange(fromCurrency, toCurrency, amount);

    // Ensure destination currency balance exists
    await this.addCurrencyBalance(walletId, toCurrency);

    // Perform exchange in transaction
    const result = await prisma.$transaction(async (tx) => {
      // Debit source currency
      const updatedSource = await tx.walletCurrencyBalance.update({
        where: {
          walletId_currency: { walletId, currency: fromCurrency },
        },
        data: {
          balance: { decrement: amount },
        },
      });

      // Credit destination currency
      const updatedDest = await tx.walletCurrencyBalance.update({
        where: {
          walletId_currency: { walletId, currency: toCurrency },
        },
        data: {
          balance: { increment: exchange.toAmount },
        },
      });

      // Create exchange transaction records
      const exchangeRef = `EX${Date.now()}`;

      await tx.walletTransaction.create({
        data: {
          walletId,
          type: 'DEBIT',
          amount,
          currency: fromCurrency,
          balanceBefore: parseFloat(sourceBalance.balance),
          balanceAfter: parseFloat(updatedSource.balance),
          referenceType: 'EXCHANGE',
          referenceId: exchangeRef,
          description: `Exchange ${fromCurrency} to ${toCurrency}`,
          metadata: {
            exchangeRate: exchange.rate,
            toAmount: exchange.toAmount,
            toCurrency,
          },
          status: 'COMPLETED',
        },
      });

      const destBalanceBefore = parseFloat(updatedDest.balance) - exchange.toAmount;
      await tx.walletTransaction.create({
        data: {
          walletId,
          type: 'CREDIT',
          amount: exchange.toAmount,
          currency: toCurrency,
          balanceBefore: destBalanceBefore,
          balanceAfter: parseFloat(updatedDest.balance),
          referenceType: 'EXCHANGE',
          referenceId: exchangeRef,
          description: `Exchange from ${fromCurrency}`,
          metadata: {
            exchangeRate: exchange.rate,
            fromAmount: amount,
            fromCurrency,
          },
          status: 'COMPLETED',
        },
      });

      return {
        exchangeRef,
        fromBalance: updatedSource,
        toBalance: updatedDest,
      };
    });

    logger.info('Currency exchanged', {
      walletId,
      fromCurrency,
      toCurrency,
      fromAmount: amount,
      toAmount: exchange.toAmount,
      rate: exchange.rate,
    });

    eventEmitter.emit('wallet.currency_exchanged', {
      walletId,
      userId,
      ...exchange,
    });

    return {
      success: true,
      exchangeRef: result.exchangeRef,
      ...exchange,
      balances: {
        [fromCurrency]: {
          balance: parseFloat(result.fromBalance.balance),
          lockedBalance: parseFloat(result.fromBalance.lockedBalance),
        },
        [toCurrency]: {
          balance: parseFloat(result.toBalance.balance),
          lockedBalance: parseFloat(result.toBalance.lockedBalance),
        },
      },
    };
  }

  // ===========================================================================
  // INTERNATIONAL TRANSFERS
  // ===========================================================================

  /**
   * Transfer currency to another wallet
   */
  async transferCurrency(fromWalletId, toWalletId, currency, amount, options = {}) {
    const { description, convertToCurrency } = options;

    if (fromWalletId === toWalletId) {
      throw new Error('Cannot transfer to same wallet');
    }

    // Get source wallet
    const fromWallet = await prisma.wallet.findUnique({
      where: { id: fromWalletId },
    });
    if (!fromWallet) throw new Error('Source wallet not found');

    // Get destination wallet
    const toWallet = await prisma.wallet.findUnique({
      where: { id: toWalletId },
    });
    if (!toWallet) throw new Error('Destination wallet not found');

    // Check source balance
    const sourceBalance = await prisma.walletCurrencyBalance.findUnique({
      where: {
        walletId_currency: { walletId: fromWalletId, currency },
      },
    });

    if (!sourceBalance) {
      throw new Error(`No ${currency} balance in source wallet`);
    }

    const available = parseFloat(sourceBalance.balance) - parseFloat(sourceBalance.lockedBalance);
    if (amount > available) {
      throw new Error(`Insufficient ${currency} balance`);
    }

    // Determine receiving currency and amount
    let receivingCurrency = currency;
    let receivingAmount = amount;

    if (convertToCurrency && convertToCurrency !== currency) {
      const exchange = await this.calculateExchange(currency, convertToCurrency, amount);
      receivingCurrency = convertToCurrency;
      receivingAmount = exchange.toAmount;
    }

    // Ensure destination has the currency
    await this.addCurrencyBalance(toWalletId, receivingCurrency);

    const transferRef = `TRF${Date.now()}`;

    // Perform transfer
    const result = await prisma.$transaction(async (tx) => {
      // Debit source
      const updatedSource = await tx.walletCurrencyBalance.update({
        where: {
          walletId_currency: { walletId: fromWalletId, currency },
        },
        data: {
          balance: { decrement: amount },
        },
      });

      // Credit destination
      const destBalance = await tx.walletCurrencyBalance.findUnique({
        where: {
          walletId_currency: { walletId: toWalletId, currency: receivingCurrency },
        },
      });

      const updatedDest = await tx.walletCurrencyBalance.update({
        where: {
          walletId_currency: { walletId: toWalletId, currency: receivingCurrency },
        },
        data: {
          balance: { increment: receivingAmount },
        },
      });

      // Create transaction records
      await tx.walletTransaction.create({
        data: {
          walletId: fromWalletId,
          type: 'TRANSFER_OUT',
          amount,
          currency,
          balanceBefore: parseFloat(sourceBalance.balance),
          balanceAfter: parseFloat(updatedSource.balance),
          counterpartyWalletId: toWalletId,
          referenceType: 'TRANSFER',
          referenceId: transferRef,
          description: description || `Transfer to wallet`,
          status: 'COMPLETED',
        },
      });

      await tx.walletTransaction.create({
        data: {
          walletId: toWalletId,
          type: 'TRANSFER_IN',
          amount: receivingAmount,
          currency: receivingCurrency,
          balanceBefore: parseFloat(destBalance?.balance || 0),
          balanceAfter: parseFloat(updatedDest.balance),
          counterpartyWalletId: fromWalletId,
          referenceType: 'TRANSFER',
          referenceId: transferRef,
          description: description || `Transfer from wallet`,
          status: 'COMPLETED',
        },
      });

      return { transferRef, updatedSource, updatedDest };
    });

    logger.info('Currency transferred', {
      fromWalletId,
      toWalletId,
      currency,
      amount,
      receivingCurrency,
      receivingAmount,
    });

    return {
      success: true,
      transferRef: result.transferRef,
      sentAmount: amount,
      sentCurrency: currency,
      receivedAmount: receivingAmount,
      receivedCurrency: receivingCurrency,
    };
  }

  // ===========================================================================
  // REPORTS
  // ===========================================================================

  /**
   * Get exchange history
   */
  async getExchangeHistory(walletId, options = {}) {
    const { page = 1, limit = 20 } = options;

    const [transactions, total] = await Promise.all([
      prisma.walletTransaction.findMany({
        where: {
          walletId,
          referenceType: 'EXCHANGE',
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.walletTransaction.count({
        where: {
          walletId,
          referenceType: 'EXCHANGE',
        },
      }),
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
   * Get currency summary
   */
  async getCurrencySummary(walletId, currency, period = 'month') {
    const startDate = new Date();
    if (period === 'week') {
      startDate.setDate(startDate.getDate() - 7);
    } else if (period === 'month') {
      startDate.setMonth(startDate.getMonth() - 1);
    } else if (period === 'year') {
      startDate.setFullYear(startDate.getFullYear() - 1);
    }

    const [credits, debits, balance] = await Promise.all([
      prisma.walletTransaction.aggregate({
        where: {
          walletId,
          currency,
          type: { in: ['CREDIT', 'TRANSFER_IN'] },
          createdAt: { gte: startDate },
          status: 'COMPLETED',
        },
        _sum: { amount: true },
        _count: true,
      }),
      prisma.walletTransaction.aggregate({
        where: {
          walletId,
          currency,
          type: { in: ['DEBIT', 'TRANSFER_OUT'] },
          createdAt: { gte: startDate },
          status: 'COMPLETED',
        },
        _sum: { amount: true },
        _count: true,
      }),
      prisma.walletCurrencyBalance.findUnique({
        where: {
          walletId_currency: { walletId, currency },
        },
      }),
    ]);

    return {
      currency,
      currencyDetails: CURRENCY_DETAILS[currency],
      period,
      currentBalance: parseFloat(balance?.balance || 0),
      lockedBalance: parseFloat(balance?.lockedBalance || 0),
      totalCredits: parseFloat(credits._sum.amount || 0),
      creditCount: credits._count,
      totalDebits: parseFloat(debits._sum.amount || 0),
      debitCount: debits._count,
      netFlow: parseFloat(credits._sum.amount || 0) - parseFloat(debits._sum.amount || 0),
    };
  }

  /**
   * Get supported currencies
   */
  getSupportedCurrencies() {
    return CURRENCY_CONFIG.supportedCurrencies.map(code => ({
      code,
      ...CURRENCY_DETAILS[code],
    }));
  }
}

module.exports = new MultiCurrencyWalletService();
