// =============================================================================
// AIRAVAT B2B MARKETPLACE - VIRTUAL CARDS SERVICE
// Generate virtual cards for business purchases
// =============================================================================

const { prisma } = require('../config/database');
const { cache } = require('../config/redis');
const logger = require('../config/logger');
const { eventEmitter } = require('./eventEmitter.service');
const { encrypt, decrypt } = require('./dataEncryption.service');
const crypto = require('crypto');

/**
 * Virtual Card Configuration
 */
const VIRTUAL_CARD_CONFIG = {
  providers: {
    STRIPE: 'stripe',
    RAZORPAY: 'razorpay', // RazorpayX
    NIUM: 'nium',
    MARQETA: 'marqeta',
  },
  cardTypes: ['VISA', 'MASTERCARD', 'RUPAY'],
  defaultValidity: 365, // Days
  defaultCurrency: 'INR',
  minLimit: 1000,
  maxLimit: 10000000,
  cachePrefix: 'vcard:',
  cacheTTL: 300,
};

/**
 * Merchant Category Codes (MCC) for restrictions
 */
const MCC_CATEGORIES = {
  OFFICE_SUPPLIES: ['5111', '5943', '5044'],
  ELECTRONICS: ['5732', '5734', '5045'],
  TRAVEL: ['4511', '4722', '7011', '7512'],
  FUEL: ['5541', '5542', '5983'],
  RESTAURANTS: ['5812', '5813', '5814'],
  SHIPPING: ['4215', '4214', '4225'],
  ADVERTISING: ['7311', '7312', '7319'],
  SOFTWARE: ['5045', '5734', '7372'],
  ALL: [],
};

class VirtualCardService {
  // ===========================================================================
  // CARD CREATION
  // ===========================================================================

  /**
   * Create virtual card
   */
  async createCard(userId, cardData) {
    const {
      businessId,
      cardName,
      cardholderName,
      cardLimit,
      singleTxnLimit,
      dailyLimit,
      currency = VIRTUAL_CARD_CONFIG.defaultCurrency,
      validityDays = VIRTUAL_CARD_CONFIG.defaultValidity,
      allowOnline = true,
      allowInternational = false,
      allowedCategories = [],
      blockedMerchants = [],
    } = cardData;

    // Validate limits
    if (cardLimit < VIRTUAL_CARD_CONFIG.minLimit) {
      throw new Error(`Minimum card limit is ${VIRTUAL_CARD_CONFIG.minLimit}`);
    }
    if (cardLimit > VIRTUAL_CARD_CONFIG.maxLimit) {
      throw new Error(`Maximum card limit is ${VIRTUAL_CARD_CONFIG.maxLimit}`);
    }

    // Validate user/business
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });
    if (!user) throw new Error('User not found');

    if (businessId) {
      const business = await prisma.business.findUnique({
        where: { id: businessId },
      });
      if (!business) throw new Error('Business not found');
      if (business.verificationStatus !== 'VERIFIED') {
        throw new Error('Business must be verified to create virtual cards');
      }
    }

    // Generate card with provider (simulated)
    const cardDetails = await this.generateCardWithProvider({
      userId,
      businessId,
      cardholderName,
      cardLimit,
      currency,
    });

    // Calculate validity
    const validFrom = new Date();
    const validUntil = new Date();
    validUntil.setDate(validUntil.getDate() + validityDays);

    // Create card record
    const card = await prisma.virtualCard.create({
      data: {
        userId,
        businessId,
        cardToken: cardDetails.token,
        cardLast4: cardDetails.last4,
        cardType: cardDetails.cardType,
        expiryMonth: cardDetails.expiryMonth,
        expiryYear: cardDetails.expiryYear,
        cardName,
        cardholderName,
        cardLimit,
        availableLimit: cardLimit,
        singleTxnLimit,
        dailyLimit,
        currency,
        isActive: true,
        isLocked: false,
        allowOnline,
        allowInternational,
        allowedCategories,
        blockedMerchants,
        validFrom,
        validUntil,
      },
    });

    logger.info('Virtual card created', {
      cardId: card.id,
      userId,
      businessId,
      cardLast4: card.cardLast4,
    });

    eventEmitter.emit('virtualCard.created', {
      cardId: card.id,
      userId,
    });

    // Return card without sensitive details
    return this.sanitizeCard(card);
  }

  /**
   * Generate card with provider (simulated)
   */
  async generateCardWithProvider(options) {
    // In production, this would call actual card provider API
    // For simulation, we generate mock card details

    const cardNumber = this.generateCardNumber();
    const last4 = cardNumber.slice(-4);
    const expiryDate = new Date();
    expiryDate.setFullYear(expiryDate.getFullYear() + 3);

    return {
      token: `vcard_${crypto.randomBytes(16).toString('hex')}`,
      cardNumber: encrypt(cardNumber), // Encrypted for storage
      last4,
      cardType: 'VISA',
      expiryMonth: expiryDate.getMonth() + 1,
      expiryYear: expiryDate.getFullYear(),
      cvv: encrypt(this.generateCVV()),
    };
  }

  /**
   * Generate mock card number (Luhn valid)
   */
  generateCardNumber() {
    // Generate 15-digit number
    let cardNumber = '4'; // Start with 4 for Visa
    for (let i = 0; i < 14; i++) {
      cardNumber += Math.floor(Math.random() * 10);
    }

    // Calculate Luhn check digit
    let sum = 0;
    let isEven = true;
    for (let i = cardNumber.length - 1; i >= 0; i--) {
      let digit = parseInt(cardNumber[i]);
      if (isEven) {
        digit *= 2;
        if (digit > 9) digit -= 9;
      }
      sum += digit;
      isEven = !isEven;
    }
    const checkDigit = (10 - (sum % 10)) % 10;

    return cardNumber + checkDigit;
  }

  /**
   * Generate CVV
   */
  generateCVV() {
    return String(Math.floor(Math.random() * 900) + 100);
  }

  // ===========================================================================
  // CARD MANAGEMENT
  // ===========================================================================

  /**
   * Get card by ID
   */
  async getCard(cardId, userId = null) {
    const card = await prisma.virtualCard.findUnique({
      where: { id: cardId },
      include: {
        user: {
          select: { id: true, email: true, name: true },
        },
        business: {
          select: { id: true, businessName: true },
        },
      },
    });

    if (!card) throw new Error('Card not found');
    if (userId && card.userId !== userId) throw new Error('Unauthorized');

    return this.sanitizeCard(card);
  }

  /**
   * Get card details (with sensitive info - requires PIN/OTP)
   */
  async getCardDetails(cardId, userId, verificationCode) {
    // In production, verify OTP or PIN before revealing details
    const card = await prisma.virtualCard.findUnique({
      where: { id: cardId },
    });

    if (!card) throw new Error('Card not found');
    if (card.userId !== userId) throw new Error('Unauthorized');

    // Get full card details from provider
    const fullDetails = await this.getCardFromProvider(card.cardToken);

    return {
      cardNumber: fullDetails.cardNumber, // Masked except last 4
      cvv: fullDetails.cvv, // Revealed only after verification
      expiryMonth: card.expiryMonth,
      expiryYear: card.expiryYear,
      cardholderName: card.cardholderName,
    };
  }

  /**
   * Get cards from provider (simulated)
   */
  async getCardFromProvider(cardToken) {
    // In production, call provider API
    return {
      cardNumber: '**** **** **** ****', // Would be actual masked number
      cvv: '***',
    };
  }

  /**
   * Get user's cards
   */
  async getUserCards(userId, options = {}) {
    const { businessId, isActive, page = 1, limit = 10 } = options;

    const where = { userId };
    if (businessId) where.businessId = businessId;
    if (typeof isActive === 'boolean') where.isActive = isActive;

    const [cards, total] = await Promise.all([
      prisma.virtualCard.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.virtualCard.count({ where }),
    ]);

    return {
      cards: cards.map(this.sanitizeCard),
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Update card limits
   */
  async updateCardLimits(cardId, userId, limits) {
    const { cardLimit, singleTxnLimit, dailyLimit } = limits;

    const card = await this.getCard(cardId, userId);

    // Validate new limits
    if (cardLimit && cardLimit > VIRTUAL_CARD_CONFIG.maxLimit) {
      throw new Error(`Maximum card limit is ${VIRTUAL_CARD_CONFIG.maxLimit}`);
    }

    const updateData = {};
    if (cardLimit !== undefined) {
      updateData.cardLimit = cardLimit;
      // Adjust available limit proportionally
      const usedLimit = parseFloat(card.cardLimit) - parseFloat(card.availableLimit);
      updateData.availableLimit = Math.max(0, cardLimit - usedLimit);
    }
    if (singleTxnLimit !== undefined) updateData.singleTxnLimit = singleTxnLimit;
    if (dailyLimit !== undefined) updateData.dailyLimit = dailyLimit;

    const updatedCard = await prisma.virtualCard.update({
      where: { id: cardId },
      data: updateData,
    });

    logger.info('Card limits updated', { cardId, limits });

    return this.sanitizeCard(updatedCard);
  }

  /**
   * Update card controls
   */
  async updateCardControls(cardId, userId, controls) {
    const {
      allowOnline,
      allowInternational,
      allowedCategories,
      blockedMerchants,
    } = controls;

    await this.getCard(cardId, userId); // Verify ownership

    const updateData = {};
    if (typeof allowOnline === 'boolean') updateData.allowOnline = allowOnline;
    if (typeof allowInternational === 'boolean') updateData.allowInternational = allowInternational;
    if (allowedCategories) updateData.allowedCategories = allowedCategories;
    if (blockedMerchants) updateData.blockedMerchants = blockedMerchants;

    const updatedCard = await prisma.virtualCard.update({
      where: { id: cardId },
      data: updateData,
    });

    logger.info('Card controls updated', { cardId, controls });

    return this.sanitizeCard(updatedCard);
  }

  /**
   * Lock card
   */
  async lockCard(cardId, userId, reason) {
    await this.getCard(cardId, userId);

    const card = await prisma.virtualCard.update({
      where: { id: cardId },
      data: { isLocked: true },
    });

    // Notify provider to block transactions
    await this.notifyProviderCardStatus(card.cardToken, 'LOCKED');

    logger.info('Card locked', { cardId, reason });

    eventEmitter.emit('virtualCard.locked', { cardId, userId, reason });

    return this.sanitizeCard(card);
  }

  /**
   * Unlock card
   */
  async unlockCard(cardId, userId) {
    await this.getCard(cardId, userId);

    const card = await prisma.virtualCard.update({
      where: { id: cardId },
      data: { isLocked: false },
    });

    await this.notifyProviderCardStatus(card.cardToken, 'ACTIVE');

    logger.info('Card unlocked', { cardId });

    return this.sanitizeCard(card);
  }

  /**
   * Deactivate card
   */
  async deactivateCard(cardId, userId, reason) {
    await this.getCard(cardId, userId);

    const card = await prisma.virtualCard.update({
      where: { id: cardId },
      data: { isActive: false },
    });

    await this.notifyProviderCardStatus(card.cardToken, 'CANCELLED');

    logger.info('Card deactivated', { cardId, reason });

    eventEmitter.emit('virtualCard.deactivated', { cardId, userId, reason });

    return this.sanitizeCard(card);
  }

  /**
   * Notify provider of card status change
   */
  async notifyProviderCardStatus(cardToken, status) {
    // In production, call provider API
    logger.info('Provider notified of card status', { cardToken, status });
  }

  // ===========================================================================
  // TRANSACTION PROCESSING
  // ===========================================================================

  /**
   * Authorize transaction (webhook from provider)
   */
  async authorizeTransaction(transactionData) {
    const {
      cardToken,
      amount,
      currency,
      merchantName,
      merchantCategory,
      merchantId,
      transactionType, // PURCHASE, REFUND, etc.
    } = transactionData;

    // Find card
    const card = await prisma.virtualCard.findUnique({
      where: { cardToken },
    });

    if (!card) {
      return { approved: false, reason: 'CARD_NOT_FOUND' };
    }

    // Check card status
    if (!card.isActive) {
      return { approved: false, reason: 'CARD_INACTIVE' };
    }

    if (card.isLocked) {
      return { approved: false, reason: 'CARD_LOCKED' };
    }

    // Check validity
    if (new Date() > card.validUntil) {
      return { approved: false, reason: 'CARD_EXPIRED' };
    }

    // Check available limit
    if (amount > parseFloat(card.availableLimit)) {
      return { approved: false, reason: 'INSUFFICIENT_LIMIT' };
    }

    // Check single transaction limit
    if (card.singleTxnLimit && amount > parseFloat(card.singleTxnLimit)) {
      return { approved: false, reason: 'EXCEEDS_TXN_LIMIT' };
    }

    // Check daily limit
    if (card.dailyLimit) {
      const todaySpent = await this.getTodaySpending(card.id);
      if (todaySpent + amount > parseFloat(card.dailyLimit)) {
        return { approved: false, reason: 'EXCEEDS_DAILY_LIMIT' };
      }
    }

    // Check merchant category
    if (card.allowedCategories.length > 0) {
      const allowed = card.allowedCategories.some(cat => 
        MCC_CATEGORIES[cat]?.includes(merchantCategory)
      );
      if (!allowed) {
        return { approved: false, reason: 'CATEGORY_NOT_ALLOWED' };
      }
    }

    // Check blocked merchants
    if (card.blockedMerchants.includes(merchantId)) {
      return { approved: false, reason: 'MERCHANT_BLOCKED' };
    }

    // Generate auth code
    const authCode = crypto.randomBytes(6).toString('hex').toUpperCase();

    // Create transaction record
    const transaction = await prisma.virtualCardTransaction.create({
      data: {
        cardId: card.id,
        amount,
        currency,
        merchantName,
        merchantCategory,
        merchantId,
        status: 'AUTHORIZED',
        authCode,
      },
    });

    // Update available limit
    await prisma.virtualCard.update({
      where: { id: card.id },
      data: {
        availableLimit: { decrement: amount },
      },
    });

    logger.info('Card transaction authorized', {
      cardId: card.id,
      transactionId: transaction.id,
      amount,
      merchantName,
    });

    return {
      approved: true,
      authCode,
      transactionId: transaction.id,
    };
  }

  /**
   * Settle transaction (webhook from provider)
   */
  async settleTransaction(transactionId, settlementData) {
    const { settledAmount, externalRef } = settlementData;

    const transaction = await prisma.virtualCardTransaction.findUnique({
      where: { id: transactionId },
    });

    if (!transaction) throw new Error('Transaction not found');
    if (transaction.status !== 'AUTHORIZED') {
      throw new Error('Transaction not in authorized state');
    }

    // Handle partial settlement or amount difference
    const amountDiff = parseFloat(transaction.amount) - settledAmount;

    await prisma.$transaction([
      prisma.virtualCardTransaction.update({
        where: { id: transactionId },
        data: {
          status: 'SETTLED',
          settledAt: new Date(),
          externalRef,
        },
      }),
      // Adjust limit if settled amount differs
      ...(amountDiff !== 0 ? [
        prisma.virtualCard.update({
          where: { id: transaction.cardId },
          data: {
            availableLimit: { increment: amountDiff },
          },
        }),
      ] : []),
    ]);

    logger.info('Transaction settled', { transactionId, settledAmount });

    return { success: true };
  }

  /**
   * Reverse/void transaction
   */
  async reverseTransaction(transactionId, reason) {
    const transaction = await prisma.virtualCardTransaction.findUnique({
      where: { id: transactionId },
    });

    if (!transaction) throw new Error('Transaction not found');
    if (!['AUTHORIZED', 'SETTLED'].includes(transaction.status)) {
      throw new Error('Transaction cannot be reversed');
    }

    await prisma.$transaction([
      prisma.virtualCardTransaction.update({
        where: { id: transactionId },
        data: {
          status: 'REVERSED',
          declineReason: reason,
        },
      }),
      prisma.virtualCard.update({
        where: { id: transaction.cardId },
        data: {
          availableLimit: { increment: transaction.amount },
        },
      }),
    ]);

    logger.info('Transaction reversed', { transactionId, reason });

    return { success: true };
  }

  /**
   * Process refund
   */
  async processRefund(originalTransactionId, refundAmount) {
    const transaction = await prisma.virtualCardTransaction.findUnique({
      where: { id: originalTransactionId },
    });

    if (!transaction) throw new Error('Transaction not found');
    if (transaction.status !== 'SETTLED') {
      throw new Error('Only settled transactions can be refunded');
    }

    if (refundAmount > parseFloat(transaction.amount)) {
      throw new Error('Refund amount exceeds transaction amount');
    }

    // Create refund transaction
    const refundTransaction = await prisma.virtualCardTransaction.create({
      data: {
        cardId: transaction.cardId,
        amount: refundAmount,
        currency: transaction.currency,
        merchantName: transaction.merchantName,
        merchantCategory: transaction.merchantCategory,
        merchantId: transaction.merchantId,
        status: 'REFUNDED',
      },
    });

    // Restore limit
    await prisma.virtualCard.update({
      where: { id: transaction.cardId },
      data: {
        availableLimit: { increment: refundAmount },
      },
    });

    logger.info('Refund processed', {
      originalTransactionId,
      refundTransactionId: refundTransaction.id,
      refundAmount,
    });

    return refundTransaction;
  }

  /**
   * Get today's spending
   */
  async getTodaySpending(cardId) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const result = await prisma.virtualCardTransaction.aggregate({
      where: {
        cardId,
        status: { in: ['AUTHORIZED', 'SETTLED'] },
        transactionDate: { gte: today },
      },
      _sum: { amount: true },
    });

    return parseFloat(result._sum.amount || 0);
  }

  // ===========================================================================
  // TRANSACTION QUERIES
  // ===========================================================================

  /**
   * Get card transactions
   */
  async getCardTransactions(cardId, userId, options = {}) {
    const { status, startDate, endDate, page = 1, limit = 20 } = options;

    // Verify ownership
    await this.getCard(cardId, userId);

    const where = { cardId };
    if (status) where.status = status;
    if (startDate || endDate) {
      where.transactionDate = {};
      if (startDate) where.transactionDate.gte = new Date(startDate);
      if (endDate) where.transactionDate.lte = new Date(endDate);
    }

    const [transactions, total] = await Promise.all([
      prisma.virtualCardTransaction.findMany({
        where,
        orderBy: { transactionDate: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.virtualCardTransaction.count({ where }),
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
   * Get card spending summary
   */
  async getCardSpendingSummary(cardId, userId, period = 'month') {
    await this.getCard(cardId, userId);

    const startDate = new Date();
    if (period === 'week') {
      startDate.setDate(startDate.getDate() - 7);
    } else if (period === 'month') {
      startDate.setMonth(startDate.getMonth() - 1);
    } else if (period === 'year') {
      startDate.setFullYear(startDate.getFullYear() - 1);
    }

    const transactions = await prisma.virtualCardTransaction.findMany({
      where: {
        cardId,
        status: { in: ['AUTHORIZED', 'SETTLED'] },
        transactionDate: { gte: startDate },
      },
    });

    // Group by merchant category
    const byCategory = {};
    let totalSpent = 0;

    for (const txn of transactions) {
      const category = txn.merchantCategory || 'OTHER';
      if (!byCategory[category]) {
        byCategory[category] = { count: 0, amount: 0 };
      }
      byCategory[category].count++;
      byCategory[category].amount += parseFloat(txn.amount);
      totalSpent += parseFloat(txn.amount);
    }

    return {
      period,
      totalTransactions: transactions.length,
      totalSpent,
      byCategory,
    };
  }

  // ===========================================================================
  // UTILITIES
  // ===========================================================================

  /**
   * Sanitize card (remove sensitive data)
   */
  sanitizeCard(card) {
    const { cardToken, ...safeCard } = card;
    return safeCard;
  }

  /**
   * Add funds to card (increase limit)
   */
  async addFunds(cardId, userId, amount) {
    const card = await this.getCard(cardId, userId);

    const newLimit = parseFloat(card.cardLimit) + amount;
    if (newLimit > VIRTUAL_CARD_CONFIG.maxLimit) {
      throw new Error(`Cannot exceed maximum limit of ${VIRTUAL_CARD_CONFIG.maxLimit}`);
    }

    const updatedCard = await prisma.virtualCard.update({
      where: { id: cardId },
      data: {
        cardLimit: newLimit,
        availableLimit: { increment: amount },
      },
    });

    logger.info('Funds added to card', { cardId, amount, newLimit });

    return this.sanitizeCard(updatedCard);
  }
}

module.exports = new VirtualCardService();
