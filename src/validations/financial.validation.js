// =============================================================================
// AIRAVAT B2B MARKETPLACE - FINANCIAL VALIDATION SCHEMAS
// Request validation for financial services
// =============================================================================

const Joi = require('joi');

// =============================================================================
// WALLET SCHEMAS
// =============================================================================

const walletSchemas = {
  createWallet: Joi.object({
    businessId: Joi.string().optional(),
    currency: Joi.string().valid('INR', 'AED', 'USD', 'EUR', 'GBP').default('INR'),
    dailyLimit: Joi.number().min(0).max(10000000).default(100000),
    monthlyLimit: Joi.number().min(0).max(100000000).default(1000000),
  }),

  credit: Joi.object({
    amount: Joi.number().positive().required(),
    currency: Joi.string().valid('INR', 'AED', 'USD', 'EUR', 'GBP').optional(),
    referenceType: Joi.string().optional(),
    referenceId: Joi.string().optional(),
    description: Joi.string().max(500).optional(),
  }),

  debit: Joi.object({
    amount: Joi.number().positive().required(),
    currency: Joi.string().valid('INR', 'AED', 'USD', 'EUR', 'GBP').optional(),
    referenceType: Joi.string().optional(),
    referenceId: Joi.string().optional(),
    description: Joi.string().max(500).optional(),
  }),

  transfer: Joi.object({
    fromWalletId: Joi.string().required(),
    toWalletId: Joi.string().required(),
    amount: Joi.number().positive().required(),
    description: Joi.string().max(500).optional(),
  }),

  setPin: Joi.object({
    pin: Joi.string().pattern(/^\d{4,6}$/).required()
      .messages({ 'string.pattern.base': 'PIN must be 4-6 digits' }),
  }),

  verifyPin: Joi.object({
    pin: Joi.string().required(),
  }),

  withdrawal: Joi.object({
    amount: Joi.number().min(100).max(500000).required(),
    bankAccountId: Joi.string().required(),
  }),

  updateLimits: Joi.object({
    dailyLimit: Joi.number().min(0).max(10000000).optional(),
    monthlyLimit: Joi.number().min(0).max(100000000).optional(),
  }),
};

// =============================================================================
// MULTI-CURRENCY SCHEMAS
// =============================================================================

const multiCurrencySchemas = {
  addCurrency: Joi.object({
    currency: Joi.string()
      .valid('INR', 'AED', 'USD', 'EUR', 'GBP', 'SGD', 'JPY', 'CNY')
      .required(),
  }),

  exchangeQuote: Joi.object({
    fromCurrency: Joi.string()
      .valid('INR', 'AED', 'USD', 'EUR', 'GBP', 'SGD', 'JPY', 'CNY')
      .required(),
    toCurrency: Joi.string()
      .valid('INR', 'AED', 'USD', 'EUR', 'GBP', 'SGD', 'JPY', 'CNY')
      .required(),
    amount: Joi.number().min(100).required(),
  }),

  exchange: Joi.object({
    fromCurrency: Joi.string()
      .valid('INR', 'AED', 'USD', 'EUR', 'GBP', 'SGD', 'JPY', 'CNY')
      .required(),
    toCurrency: Joi.string()
      .valid('INR', 'AED', 'USD', 'EUR', 'GBP', 'SGD', 'JPY', 'CNY')
      .required(),
    amount: Joi.number().min(100).required(),
    expectedRate: Joi.number().positive().optional(),
  }),
};

// =============================================================================
// EMI SCHEMAS
// =============================================================================

const emiSchemas = {
  calculateEMI: Joi.object({
    principal: Joi.number().min(1000).required(),
    tenureMonths: Joi.number().integer().valid(3, 6, 9, 12, 18, 24).required(),
    interestRate: Joi.number().min(0).max(50).required(),
    processingFee: Joi.number().min(0).max(10).default(1.5),
  }),

  createEMIOrder: Joi.object({
    orderId: Joi.string().required(),
    emiPlanId: Joi.string().required(),
    bankName: Joi.string().optional(),
    accountLast4: Joi.string().length(4).pattern(/^\d+$/).optional(),
  }),

  payInstallment: Joi.object({
    paymentId: Joi.string().required(),
    transactionRef: Joi.string().optional(),
    amount: Joi.number().positive().optional(),
  }),

  foreclose: Joi.object({
    paymentId: Joi.string().required(),
    transactionRef: Joi.string().optional(),
  }),
};

// =============================================================================
// INVOICE FACTORING SCHEMAS
// =============================================================================

const factoringSchemas = {
  checkEligibility: Joi.object({
    businessId: Joi.string().required(),
    invoiceAmount: Joi.number().min(10000).max(10000000).required(),
    invoiceDueDate: Joi.date().greater('now').required(),
    buyerBusinessId: Joi.string().optional(),
  }),

  submitApplication: Joi.object({
    businessId: Joi.string().required(),
    invoiceId: Joi.string().optional(),
    invoiceNumber: Joi.string().required(),
    invoiceAmount: Joi.number().min(10000).max(10000000).required(),
    invoiceDate: Joi.date().required(),
    invoiceDueDate: Joi.date().greater(Joi.ref('invoiceDate')).required(),
    buyerBusinessId: Joi.string().optional(),
    buyerName: Joi.string().required(),
    isRecourse: Joi.boolean().default(true),
    documents: Joi.array().items(
      Joi.object({
        type: Joi.string().required(),
        url: Joi.string().uri().required(),
        name: Joi.string().required(),
      })
    ).optional(),
  }),
};

// =============================================================================
// TRADE FINANCE (LC) SCHEMAS
// =============================================================================

const tradeFinanceSchemas = {
  createDraftLC: Joi.object({
    applicantId: Joi.string().required(),
    beneficiaryId: Joi.string().required(),
    type: Joi.string()
      .valid('IRREVOCABLE', 'CONFIRMED', 'STANDBY', 'REVOLVING', 'TRANSFERABLE', 'BACK_TO_BACK')
      .default('IRREVOCABLE'),
    amount: Joi.number().min(100000).max(100000000).required(),
    currency: Joi.string().default('INR'),
    tolerance: Joi.number().min(0).max(10).default(5),
    expiryDate: Joi.date().greater('now').required(),
    latestShipDate: Joi.date().less(Joi.ref('expiryDate')).optional(),
    issuingBank: Joi.string().optional(),
    issuingBankSwift: Joi.string().optional(),
    advisingBank: Joi.string().optional(),
    confirmingBank: Joi.string().optional(),
    paymentTerms: Joi.string().valid('AT_SIGHT', 'USANCE').default('AT_SIGHT'),
    usanceDays: Joi.number().when('paymentTerms', {
      is: 'USANCE',
      then: Joi.number().min(30).max(180).required(),
      otherwise: Joi.optional(),
    }),
    partialShipment: Joi.boolean().default(false),
    transhipment: Joi.boolean().default(false),
    goodsDescription: Joi.string().max(2000).required(),
    portOfLoading: Joi.string().optional(),
    portOfDischarge: Joi.string().optional(),
    placeOfDelivery: Joi.string().optional(),
    requiredDocuments: Joi.array().items(Joi.string()).optional(),
    orderId: Joi.string().optional(),
  }),

  requestAmendment: Joi.object({
    description: Joi.string().max(1000).required(),
    changes: Joi.object({
      amount: Joi.number().optional(),
      expiryDate: Joi.date().optional(),
      latestShipDate: Joi.date().optional(),
      goodsDescription: Joi.string().optional(),
    }).min(1).required(),
  }),

  presentDocuments: Joi.object({
    documents: Joi.array().items(
      Joi.object({
        documentType: Joi.string().required(),
        documentNumber: Joi.string().required(),
        fileUrl: Joi.string().uri().required(),
      })
    ).min(1).required(),
  }),

  uploadDocument: Joi.object({
    documentType: Joi.string()
      .valid('BILL_OF_LADING', 'COMMERCIAL_INVOICE', 'PACKING_LIST', 
             'CERTIFICATE_OF_ORIGIN', 'INSURANCE_CERTIFICATE', 'OTHER')
      .required(),
    documentNumber: Joi.string().required(),
    fileUrl: Joi.string().uri().required(),
    fileName: Joi.string().required(),
  }),

  examineDocuments: Joi.object({
    examinationResult: Joi.string().valid('COMPLIANT', 'DISCREPANT').required(),
    discrepancies: Joi.array().items(Joi.string()).when('examinationResult', {
      is: 'DISCREPANT',
      then: Joi.array().min(1).required(),
      otherwise: Joi.optional(),
    }),
  }),
};

// =============================================================================
// CASHBACK SCHEMAS
// =============================================================================

const cashbackSchemas = {
  createProgram: Joi.object({
    name: Joi.string().max(100).required(),
    description: Joi.string().max(500).optional(),
    type: Joi.string().valid('PERCENTAGE', 'FIXED', 'TIERED').required(),
    value: Joi.number().when('type', {
      is: 'TIERED',
      then: Joi.optional(),
      otherwise: Joi.required(),
    }),
    maxCashback: Joi.number().positive().optional(),
    minPurchase: Joi.number().min(0).default(500),
    startDate: Joi.date().required(),
    endDate: Joi.date().greater(Joi.ref('startDate')).required(),
    applicableCategories: Joi.array().items(Joi.string()).optional(),
    applicableSellers: Joi.array().items(Joi.string()).optional(),
    applicableProducts: Joi.array().items(Joi.string()).optional(),
    userTiers: Joi.array()
      .items(Joi.string().valid('BRONZE', 'SILVER', 'GOLD', 'PLATINUM'))
      .optional(),
    maxUsagePerUser: Joi.number().integer().positive().optional(),
    totalBudget: Joi.number().positive().optional(),
    isActive: Joi.boolean().default(true),
  }),

  calculateCashback: Joi.object({
    orderAmount: Joi.number().positive().required(),
    categoryId: Joi.string().optional(),
    sellerId: Joi.string().optional(),
    productIds: Joi.array().items(Joi.string()).optional(),
  }),
};

// =============================================================================
// VIRTUAL CARD SCHEMAS
// =============================================================================

const virtualCardSchemas = {
  createCard: Joi.object({
    businessId: Joi.string().optional(),
    cardName: Joi.string().max(50).optional(),
    cardholderName: Joi.string().max(100).required(),
    cardLimit: Joi.number().min(1000).max(10000000).required(),
    singleTxnLimit: Joi.number().min(100).max(Joi.ref('cardLimit')).optional(),
    dailyLimit: Joi.number().min(100).max(Joi.ref('cardLimit')).optional(),
    currency: Joi.string().valid('INR', 'AED', 'USD').default('INR'),
    cardType: Joi.string().valid('VISA', 'MASTERCARD').default('VISA'),
    validityDays: Joi.number().integer().min(1).max(730).default(365),
    allowOnline: Joi.boolean().default(true),
    allowInternational: Joi.boolean().default(false),
    allowedCategories: Joi.array().items(Joi.string()).optional(),
    blockedMerchants: Joi.array().items(Joi.string()).optional(),
  }),

  updateCard: Joi.object({
    cardName: Joi.string().max(50).optional(),
    singleTxnLimit: Joi.number().min(100).optional(),
    dailyLimit: Joi.number().min(100).optional(),
    allowOnline: Joi.boolean().optional(),
    allowInternational: Joi.boolean().optional(),
    allowedCategories: Joi.array().items(Joi.string()).optional(),
    blockedMerchants: Joi.array().items(Joi.string()).optional(),
  }).min(1),

  lockCard: Joi.object({
    reason: Joi.string().max(200).optional(),
  }),

  authorizeTransaction: Joi.object({
    amount: Joi.number().positive().required(),
    currency: Joi.string().required(),
    merchantName: Joi.string().required(),
    merchantCategory: Joi.string().required(),
    merchantId: Joi.string().optional(),
  }),
};

// =============================================================================
// BANK INTEGRATION SCHEMAS
// =============================================================================

const bankIntegrationSchemas = {
  initiateConnection: Joi.object({
    businessId: Joi.string().required(),
    bankName: Joi.string().required(),
    bankCode: Joi.string().required(),
    accountNumber: Joi.string().min(9).max(18).required(),
    accountType: Joi.string().valid('CURRENT', 'SAVINGS').required(),
    provider: Joi.string().valid('RAZORPAY', 'YODLEE', 'FINBOX', 'AA').optional(),
  }),

  consentCallback: Joi.object({
    success: Joi.boolean().required(),
    consentId: Joi.string().required(),
    error: Joi.string().when('success', {
      is: false,
      then: Joi.required(),
      otherwise: Joi.optional(),
    }),
  }),

  syncTransactions: Joi.object({
    fromDate: Joi.date().optional(),
    toDate: Joi.date().greater(Joi.ref('fromDate')).optional(),
  }),

  generateStatement: Joi.object({
    startDate: Joi.date().required(),
    endDate: Joi.date().greater(Joi.ref('startDate')).required(),
  }),
};

// =============================================================================
// CREDIT INSURANCE SCHEMAS
// =============================================================================

const creditInsuranceSchemas = {
  getQuote: Joi.object({
    businessId: Joi.string().required(),
    coverageType: Joi.string()
      .valid('WHOLE_TURNOVER', 'SPECIFIC_BUYERS', 'SINGLE_BUYER', 'TOP_UP')
      .required(),
    coverageLimit: Joi.number().min(100000).max(50000000).required(),
    buyers: Joi.array().items(Joi.string()).when('coverageType', {
      is: Joi.string().valid('SPECIFIC_BUYERS', 'SINGLE_BUYER'),
      then: Joi.array().min(1).required(),
      otherwise: Joi.optional(),
    }),
    validityMonths: Joi.number().integer().min(1).max(36).default(12),
  }),

  createPolicy: Joi.object({
    businessId: Joi.string().required(),
    coverageType: Joi.string()
      .valid('WHOLE_TURNOVER', 'SPECIFIC_BUYERS', 'SINGLE_BUYER', 'TOP_UP')
      .required(),
    coverageLimit: Joi.number().min(100000).max(50000000).required(),
    validityMonths: Joi.number().integer().min(1).max(36).default(12),
    insurerId: Joi.string().optional(),
    insurerName: Joi.string().optional(),
    deductiblePercent: Joi.number().min(0).max(30).default(10),
    buyers: Joi.array().items(
      Joi.object({
        buyerBusinessId: Joi.string().required(),
        buyerName: Joi.string().required(),
        creditLimit: Joi.number().positive().required(),
        riskGrade: Joi.string().valid('A', 'B', 'C', 'D').optional(),
      })
    ).optional(),
  }),

  addBuyer: Joi.object({
    buyerBusinessId: Joi.string().required(),
    buyerName: Joi.string().optional(),
    creditLimit: Joi.number().positive().required(),
  }),

  updateBuyerLimit: Joi.object({
    newLimit: Joi.number().positive().required(),
  }),

  checkClaimEligibility: Joi.object({
    buyerBusinessId: Joi.string().required(),
    invoiceId: Joi.string().required(),
    invoiceAmount: Joi.number().positive().required(),
    invoiceDueDate: Joi.date().required(),
  }),

  fileClaim: Joi.object({
    buyerBusinessId: Joi.string().required(),
    buyerName: Joi.string().required(),
    invoiceId: Joi.string().required(),
    invoiceNumber: Joi.string().required(),
    invoiceAmount: Joi.number().positive().required(),
    invoiceDueDate: Joi.date().required(),
    documents: Joi.array().items(
      Joi.object({
        type: Joi.string().required(),
        url: Joi.string().uri().required(),
        name: Joi.string().required(),
      })
    ).optional(),
  }),

  reviewClaim: Joi.object({
    notes: Joi.string().max(1000).optional(),
  }),

  rejectClaim: Joi.object({
    reason: Joi.string().max(500).required(),
  }),

  settleClaim: Joi.object({
    settlementAmount: Joi.number().positive().required(),
    settlementRef: Joi.string().required(),
  }),
};

// =============================================================================
// RECONCILIATION SCHEMAS
// =============================================================================

const reconciliationSchemas = {
  createRule: Joi.object({
    businessId: Joi.string().required(),
    name: Joi.string().max(100).required(),
    description: Joi.string().max(500).optional(),
    matchType: Joi.string()
      .valid('EXACT', 'FUZZY', 'REFERENCE', 'AMOUNT_DATE')
      .required(),
    matchFields: Joi.object({
      amount: Joi.boolean().optional(),
      reference: Joi.boolean().optional(),
      date: Joi.boolean().optional(),
      counterparty: Joi.boolean().optional(),
    }).min(1).required(),
    tolerance: Joi.number().min(0).max(10).default(1),
    dateTolerance: Joi.number().integer().min(0).max(30).default(7),
    priority: Joi.number().integer().min(1).max(100).default(10),
    isActive: Joi.boolean().default(true),
  }),

  startBatch: Joi.object({
    businessId: Joi.string().required(),
    startDate: Joi.date().required(),
    endDate: Joi.date().greater(Joi.ref('startDate')).required(),
  }),

  manualMatch: Joi.object({
    matchType: Joi.string()
      .valid('INVOICE', 'PAYMENT', 'ORDER')
      .required(),
    matchId: Joi.string().required(),
    notes: Joi.string().max(500).optional(),
  }),
};

// =============================================================================
// EXPORT ALL SCHEMAS
// =============================================================================

module.exports = {
  walletSchemas,
  multiCurrencySchemas,
  emiSchemas,
  factoringSchemas,
  tradeFinanceSchemas,
  cashbackSchemas,
  virtualCardSchemas,
  bankIntegrationSchemas,
  creditInsuranceSchemas,
  reconciliationSchemas,
};
