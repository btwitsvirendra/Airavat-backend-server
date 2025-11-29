// =============================================================================
// AIRAVAT B2B MARKETPLACE - FINANCIAL SERVICES CONTROLLER
// API endpoints for all financial services
// =============================================================================

const walletService = require('../services/wallet.service');
const emiService = require('../services/emi.service');
const invoiceFactoringService = require('../services/invoiceFactoring.service');
const tradeFinanceService = require('../services/tradeFinance.service');
const cashbackService = require('../services/cashback.service');
const virtualCardService = require('../services/virtualCard.service');
const bankIntegrationService = require('../services/bankIntegration.service');
const creditInsuranceService = require('../services/creditInsurance.service');
const reconciliationService = require('../services/reconciliation.service');
const multiCurrencyWalletService = require('../services/multiCurrencyWallet.service');
const { asyncHandler } = require('../utils/apiResponse');

// =============================================================================
// WALLET CONTROLLER
// =============================================================================

/**
 * Create wallet
 */
exports.createWallet = asyncHandler(async (req, res) => {
  const wallet = await walletService.createWallet(req.user.id, {
    businessId: req.body.businessId,
    currency: req.body.currency,
    dailyLimit: req.body.dailyLimit,
    monthlyLimit: req.body.monthlyLimit,
  });

  res.created(wallet, 'Wallet created successfully');
});

/**
 * Get user wallets
 */
exports.getWallets = asyncHandler(async (req, res) => {
  const wallets = await walletService.getUserWallets(req.user.id);
  res.success(wallets);
});

/**
 * Get wallet balance
 */
exports.getWalletBalance = asyncHandler(async (req, res) => {
  const balance = await walletService.getBalance(req.params.walletId);
  res.success(balance);
});

/**
 * Get wallet summary
 */
exports.getWalletSummary = asyncHandler(async (req, res) => {
  const summary = await walletService.getWalletSummary(req.params.walletId);
  res.success(summary);
});

/**
 * Credit wallet
 */
exports.creditWallet = asyncHandler(async (req, res) => {
  const result = await walletService.credit(req.params.walletId, req.body.amount, {
    currency: req.body.currency,
    referenceType: req.body.referenceType,
    referenceId: req.body.referenceId,
    description: req.body.description,
  });

  res.success(result, 'Wallet credited successfully');
});

/**
 * Debit wallet
 */
exports.debitWallet = asyncHandler(async (req, res) => {
  const result = await walletService.debit(req.params.walletId, req.body.amount, {
    currency: req.body.currency,
    referenceType: req.body.referenceType,
    referenceId: req.body.referenceId,
    description: req.body.description,
  });

  res.success(result, 'Wallet debited successfully');
});

/**
 * Transfer between wallets
 */
exports.walletTransfer = asyncHandler(async (req, res) => {
  const result = await walletService.transfer(
    req.body.fromWalletId,
    req.body.toWalletId,
    req.body.amount,
    { description: req.body.description }
  );

  res.success(result, 'Transfer completed successfully');
});

/**
 * Get wallet transactions
 */
exports.getWalletTransactions = asyncHandler(async (req, res) => {
  const result = await walletService.getTransactions(req.params.walletId, {
    page: parseInt(req.query.page) || 1,
    limit: parseInt(req.query.limit) || 20,
    type: req.query.type,
    status: req.query.status,
    startDate: req.query.startDate,
    endDate: req.query.endDate,
  });

  res.paginated(result.transactions, result.pagination);
});

/**
 * Set wallet PIN
 */
exports.setWalletPin = asyncHandler(async (req, res) => {
  await walletService.setPin(req.params.walletId, req.body.pin, req.user.id);
  res.success({ success: true }, 'PIN set successfully');
});

/**
 * Verify wallet PIN
 */
exports.verifyWalletPin = asyncHandler(async (req, res) => {
  await walletService.verifyPin(req.params.walletId, req.body.pin, req.user.id);
  res.success({ verified: true }, 'PIN verified');
});

/**
 * Request withdrawal
 */
exports.requestWithdrawal = asyncHandler(async (req, res) => {
  const withdrawal = await walletService.requestWithdrawal(
    req.params.walletId,
    req.body.amount,
    req.body.bankAccountId,
    req.user.id
  );

  res.success(withdrawal, 'Withdrawal requested');
});

// =============================================================================
// MULTI-CURRENCY WALLET CONTROLLER
// =============================================================================

/**
 * Get all currency balances
 */
exports.getCurrencyBalances = asyncHandler(async (req, res) => {
  const balances = await multiCurrencyWalletService.getBalances(req.params.walletId);
  res.success(balances);
});

/**
 * Add currency to wallet
 */
exports.addCurrency = asyncHandler(async (req, res) => {
  const result = await multiCurrencyWalletService.addCurrency(
    req.params.walletId,
    req.body.currency,
    req.user.id
  );
  res.success(result, 'Currency added to wallet');
});

/**
 * Get exchange quote
 */
exports.getExchangeQuote = asyncHandler(async (req, res) => {
  const quote = await multiCurrencyWalletService.getExchangeQuote(
    req.params.walletId,
    req.body.fromCurrency,
    req.body.toCurrency,
    req.body.amount,
    req.user.id
  );
  res.success(quote);
});

/**
 * Execute currency exchange
 */
exports.executeExchange = asyncHandler(async (req, res) => {
  const result = await multiCurrencyWalletService.executeExchange(
    req.params.walletId,
    {
      fromCurrency: req.body.fromCurrency,
      toCurrency: req.body.toCurrency,
      fromAmount: req.body.amount,
      expectedRate: req.body.expectedRate,
    },
    req.user.id
  );
  res.success(result, 'Exchange completed');
});

/**
 * Get supported currencies
 */
exports.getSupportedCurrencies = asyncHandler(async (req, res) => {
  const currencies = multiCurrencyWalletService.getSupportedCurrencies();
  res.success(currencies);
});

// =============================================================================
// EMI CONTROLLER
// =============================================================================

/**
 * Get available EMI plans
 */
exports.getEMIPlans = asyncHandler(async (req, res) => {
  const plans = await emiService.getAvailablePlans(req.query.amount, {
    partnerId: req.query.partnerId,
  });
  res.success(plans);
});

/**
 * Calculate EMI
 */
exports.calculateEMI = asyncHandler(async (req, res) => {
  const calculation = emiService.calculateEMI(
    req.body.principal,
    req.body.tenureMonths,
    req.body.interestRate,
    req.body.processingFee
  );
  res.success(calculation);
});

/**
 * Create EMI order
 */
exports.createEMIOrder = asyncHandler(async (req, res) => {
  const emiOrder = await emiService.createEMIOrder(
    req.body.orderId,
    req.body.emiPlanId,
    req.user.id,
    {
      bankName: req.body.bankName,
      accountLast4: req.body.accountLast4,
    }
  );
  res.created(emiOrder, 'EMI order created');
});

/**
 * Get user EMI orders
 */
exports.getUserEMIOrders = asyncHandler(async (req, res) => {
  const result = await emiService.getUserEMIOrders(req.user.id, {
    status: req.query.status,
    page: parseInt(req.query.page) || 1,
    limit: parseInt(req.query.limit) || 10,
  });
  res.paginated(result.orders, result.pagination);
});

/**
 * Get EMI order details
 */
exports.getEMIOrder = asyncHandler(async (req, res) => {
  const emiOrder = await emiService.getEMIOrder(req.params.emiOrderId);
  if (!emiOrder) return res.notFound('EMI Order');
  res.success(emiOrder);
});

/**
 * Get upcoming installments
 */
exports.getUpcomingInstallments = asyncHandler(async (req, res) => {
  const installments = await emiService.getUpcomingInstallments(
    req.user.id,
    parseInt(req.query.days) || 7
  );
  res.success(installments);
});

/**
 * Pay installment
 */
exports.payInstallment = asyncHandler(async (req, res) => {
  const result = await emiService.payInstallment(req.params.installmentId, {
    paymentId: req.body.paymentId,
    transactionRef: req.body.transactionRef,
    amount: req.body.amount,
  });
  res.success(result, 'Installment paid');
});

/**
 * Calculate foreclosure amount
 */
exports.getForeclosureAmount = asyncHandler(async (req, res) => {
  const amount = await emiService.calculateForeclosureAmount(req.params.emiOrderId);
  res.success(amount);
});

/**
 * Foreclose EMI
 */
exports.foreclosureEMI = asyncHandler(async (req, res) => {
  const result = await emiService.foreclose(
    req.params.emiOrderId,
    {
      paymentId: req.body.paymentId,
      transactionRef: req.body.transactionRef,
    },
    req.user.id
  );
  res.success(result, 'EMI foreclosed');
});

/**
 * Get EMI summary
 */
exports.getEMISummary = asyncHandler(async (req, res) => {
  const summary = await emiService.getUserEMISummary(req.user.id);
  res.success(summary);
});

// =============================================================================
// INVOICE FACTORING CONTROLLER
// =============================================================================

/**
 * Check factoring eligibility
 */
exports.checkFactoringEligibility = asyncHandler(async (req, res) => {
  const eligibility = await invoiceFactoringService.checkEligibility(
    req.body.businessId,
    req.body
  );
  res.success(eligibility);
});

/**
 * Submit factoring application
 */
exports.submitFactoringApplication = asyncHandler(async (req, res) => {
  const application = await invoiceFactoringService.submitApplication(
    req.body.businessId,
    req.body
  );
  res.created(application, 'Factoring application submitted');
});

/**
 * Get factoring applications
 */
exports.getFactoringApplications = asyncHandler(async (req, res) => {
  const result = await invoiceFactoringService.getBusinessApplications(
    req.params.businessId,
    {
      status: req.query.status,
      page: parseInt(req.query.page) || 1,
      limit: parseInt(req.query.limit) || 10,
    }
  );
  res.paginated(result.applications, result.pagination);
});

/**
 * Get factoring application
 */
exports.getFactoringApplication = asyncHandler(async (req, res) => {
  const application = await invoiceFactoringService.getApplication(req.params.applicationId);
  if (!application) return res.notFound('Application');
  res.success(application);
});

/**
 * Get factoring summary
 */
exports.getFactoringSummary = asyncHandler(async (req, res) => {
  const summary = await invoiceFactoringService.getBusinessFactoringSummary(
    req.params.businessId
  );
  res.success(summary);
});

// =============================================================================
// TRADE FINANCE (LETTER OF CREDIT) CONTROLLER
// =============================================================================

/**
 * Create draft LC
 */
exports.createDraftLC = asyncHandler(async (req, res) => {
  const lc = await tradeFinanceService.createDraftLC(req.body.applicantId, req.body);
  res.created(lc, 'Draft LC created');
});

/**
 * Get LC details
 */
exports.getLC = asyncHandler(async (req, res) => {
  const lc = await tradeFinanceService.getLC(req.params.lcId);
  if (!lc) return res.notFound('Letter of Credit');
  res.success(lc);
});

/**
 * Submit LC for issuance
 */
exports.submitLC = asyncHandler(async (req, res) => {
  const lc = await tradeFinanceService.submitLC(req.params.lcId, req.user.id);
  res.success(lc, 'LC submitted for issuance');
});

/**
 * Get business LCs
 */
exports.getBusinessLCs = asyncHandler(async (req, res) => {
  const result = await tradeFinanceService.getBusinessLCs(req.params.businessId, {
    role: req.query.role,
    status: req.query.status,
    page: parseInt(req.query.page) || 1,
    limit: parseInt(req.query.limit) || 10,
  });
  res.paginated(result.lcs, result.pagination);
});

/**
 * Request LC amendment
 */
exports.requestLCAmendment = asyncHandler(async (req, res) => {
  const amendment = await tradeFinanceService.requestAmendment(
    req.params.lcId,
    req.body,
    req.user.id
  );
  res.success(amendment, 'Amendment requested');
});

/**
 * Present LC documents
 */
exports.presentLCDocuments = asyncHandler(async (req, res) => {
  const presentation = await tradeFinanceService.presentDocuments(
    req.params.lcId,
    req.body,
    req.user.id
  );
  res.success(presentation, 'Documents presented');
});

/**
 * Upload LC document
 */
exports.uploadLCDocument = asyncHandler(async (req, res) => {
  const document = await tradeFinanceService.uploadDocument(
    req.params.lcId,
    req.body,
    req.user.id
  );
  res.success(document, 'Document uploaded');
});

/**
 * Get LC summary
 */
exports.getLCSummary = asyncHandler(async (req, res) => {
  const summary = await tradeFinanceService.getBusinessLCSummary(req.params.businessId);
  res.success(summary);
});

// =============================================================================
// CASHBACK CONTROLLER
// =============================================================================

/**
 * Get active cashback programs
 */
exports.getCashbackPrograms = asyncHandler(async (req, res) => {
  const result = await cashbackService.getActivePrograms({
    categoryId: req.query.categoryId,
    sellerId: req.query.sellerId,
    userTier: req.query.userTier,
    page: parseInt(req.query.page) || 1,
    limit: parseInt(req.query.limit) || 10,
  });
  res.paginated(result.programs, result.pagination);
});

/**
 * Calculate cashback for order
 */
exports.calculateCashback = asyncHandler(async (req, res) => {
  const calculation = await cashbackService.calculateCashback(req.user.id, req.body);
  res.success(calculation);
});

/**
 * Get user cashback rewards
 */
exports.getUserCashbackRewards = asyncHandler(async (req, res) => {
  const result = await cashbackService.getUserRewards(req.user.id, {
    status: req.query.status,
    page: parseInt(req.query.page) || 1,
    limit: parseInt(req.query.limit) || 10,
  });
  res.paginated(result.rewards, result.pagination);
});

/**
 * Get user cashback summary
 */
exports.getCashbackSummary = asyncHandler(async (req, res) => {
  const summary = await cashbackService.getUserCashbackSummary(req.user.id);
  res.success(summary);
});

/**
 * Get user tier
 */
exports.getUserTier = asyncHandler(async (req, res) => {
  const tier = await cashbackService.getUserTier(req.user.id);
  res.success({ tier });
});

// =============================================================================
// VIRTUAL CARD CONTROLLER
// =============================================================================

/**
 * Create virtual card
 */
exports.createVirtualCard = asyncHandler(async (req, res) => {
  const card = await virtualCardService.createCard(req.user.id, req.body);
  res.created(card, 'Virtual card created');
});

/**
 * Get user cards
 */
exports.getUserCards = asyncHandler(async (req, res) => {
  const cards = await virtualCardService.getUserCards(req.user.id, {
    includeInactive: req.query.includeInactive === 'true',
    businessId: req.query.businessId,
  });
  res.success(cards);
});

/**
 * Get card details
 */
exports.getCardDetails = asyncHandler(async (req, res) => {
  const secrets = await virtualCardService.getCardSecrets(
    req.params.cardId,
    req.user.id
  );
  res.success(secrets);
});

/**
 * Update card settings
 */
exports.updateCard = asyncHandler(async (req, res) => {
  const card = await virtualCardService.updateCard(
    req.params.cardId,
    req.user.id,
    req.body
  );
  res.success(card, 'Card updated');
});

/**
 * Lock card
 */
exports.lockCard = asyncHandler(async (req, res) => {
  await virtualCardService.lockCard(req.params.cardId, req.user.id, req.body.reason);
  res.success({ success: true }, 'Card locked');
});

/**
 * Unlock card
 */
exports.unlockCard = asyncHandler(async (req, res) => {
  await virtualCardService.unlockCard(req.params.cardId, req.user.id);
  res.success({ success: true }, 'Card unlocked');
});

/**
 * Deactivate card
 */
exports.deactivateCard = asyncHandler(async (req, res) => {
  await virtualCardService.deactivateCard(req.params.cardId, req.user.id, req.body.reason);
  res.success({ success: true }, 'Card deactivated');
});

/**
 * Get card transactions
 */
exports.getCardTransactions = asyncHandler(async (req, res) => {
  const result = await virtualCardService.getCardTransactions(
    req.params.cardId,
    req.user.id,
    {
      page: parseInt(req.query.page) || 1,
      limit: parseInt(req.query.limit) || 20,
      status: req.query.status,
      startDate: req.query.startDate,
      endDate: req.query.endDate,
    }
  );
  res.paginated(result.transactions, result.pagination);
});

/**
 * Get card spending summary
 */
exports.getCardSpendingSummary = asyncHandler(async (req, res) => {
  const summary = await virtualCardService.getCardSpendingSummary(
    req.params.cardId,
    req.user.id
  );
  res.success(summary);
});

// =============================================================================
// BANK INTEGRATION CONTROLLER
// =============================================================================

/**
 * Initiate bank connection
 */
exports.initiateBankConnection = asyncHandler(async (req, res) => {
  const result = await bankIntegrationService.initiateConnection(
    req.body.businessId,
    req.body
  );
  res.success(result, 'Bank connection initiated');
});

/**
 * Handle consent callback
 */
exports.handleConsentCallback = asyncHandler(async (req, res) => {
  const result = await bankIntegrationService.handleConsentCallback(
    req.params.connectionId,
    req.body
  );
  res.success(result);
});

/**
 * Get business bank connections
 */
exports.getBankConnections = asyncHandler(async (req, res) => {
  const connections = await bankIntegrationService.getBusinessConnections(
    req.params.businessId
  );
  res.success(connections);
});

/**
 * Sync bank transactions
 */
exports.syncBankTransactions = asyncHandler(async (req, res) => {
  const result = await bankIntegrationService.syncTransactions(
    req.params.connectionId,
    {
      fromDate: req.body.fromDate,
      toDate: req.body.toDate,
    }
  );
  res.success(result, 'Transactions synced');
});

/**
 * Get bank transactions
 */
exports.getBankTransactions = asyncHandler(async (req, res) => {
  const result = await bankIntegrationService.getTransactions(
    req.params.connectionId,
    req.params.businessId,
    {
      page: parseInt(req.query.page) || 1,
      limit: parseInt(req.query.limit) || 50,
      type: req.query.type,
      startDate: req.query.startDate,
      endDate: req.query.endDate,
      category: req.query.category,
      isReconciled: req.query.isReconciled === 'true',
    }
  );
  res.paginated(result.transactions, result.pagination);
});

/**
 * Get all bank balances
 */
exports.getBankBalances = asyncHandler(async (req, res) => {
  const balances = await bankIntegrationService.getAllBalances(req.params.businessId);
  res.success(balances);
});

/**
 * Generate bank statement
 */
exports.generateBankStatement = asyncHandler(async (req, res) => {
  const statement = await bankIntegrationService.generateStatement(
    req.params.connectionId,
    req.params.businessId,
    req.query.startDate,
    req.query.endDate
  );
  res.success(statement);
});

/**
 * Revoke bank connection
 */
exports.revokeBankConnection = asyncHandler(async (req, res) => {
  await bankIntegrationService.revokeConnection(
    req.params.connectionId,
    req.params.businessId
  );
  res.success({ success: true }, 'Connection revoked');
});

// =============================================================================
// CREDIT INSURANCE CONTROLLER
// =============================================================================

/**
 * Get insurance quote
 */
exports.getInsuranceQuote = asyncHandler(async (req, res) => {
  const quote = await creditInsuranceService.getQuote(req.body.businessId, req.body);
  res.success(quote);
});

/**
 * Create insurance policy
 */
exports.createInsurancePolicy = asyncHandler(async (req, res) => {
  const policy = await creditInsuranceService.createPolicy(
    req.body.businessId,
    req.body
  );
  res.created(policy, 'Insurance policy created');
});

/**
 * Get insurance policy
 */
exports.getInsurancePolicy = asyncHandler(async (req, res) => {
  const policy = await creditInsuranceService.getPolicy(req.params.policyId);
  if (!policy) return res.notFound('Policy');
  res.success(policy);
});

/**
 * Get business policies
 */
exports.getBusinessPolicies = asyncHandler(async (req, res) => {
  const result = await creditInsuranceService.getBusinessPolicies(
    req.params.businessId,
    {
      status: req.query.status,
      page: parseInt(req.query.page) || 1,
      limit: parseInt(req.query.limit) || 10,
    }
  );
  res.paginated(result.policies, result.pagination);
});

/**
 * Activate policy
 */
exports.activateInsurancePolicy = asyncHandler(async (req, res) => {
  const policy = await creditInsuranceService.activatePolicy(
    req.params.policyId,
    req.body
  );
  res.success(policy, 'Policy activated');
});

/**
 * Add buyer to policy
 */
exports.addInsuredBuyer = asyncHandler(async (req, res) => {
  const buyer = await creditInsuranceService.addBuyer(req.params.policyId, req.body);
  res.success(buyer, 'Buyer added to policy');
});

/**
 * Check claim eligibility
 */
exports.checkClaimEligibility = asyncHandler(async (req, res) => {
  const eligibility = await creditInsuranceService.checkClaimEligibility(
    req.params.policyId,
    req.body
  );
  res.success(eligibility);
});

/**
 * File insurance claim
 */
exports.fileInsuranceClaim = asyncHandler(async (req, res) => {
  const claim = await creditInsuranceService.fileClaim(req.params.policyId, req.body);
  res.created(claim, 'Claim filed');
});

/**
 * Get insurance claim
 */
exports.getInsuranceClaim = asyncHandler(async (req, res) => {
  const claim = await creditInsuranceService.getClaim(req.params.claimId);
  if (!claim) return res.notFound('Claim');
  res.success(claim);
});

/**
 * Get policy claims
 */
exports.getPolicyClaims = asyncHandler(async (req, res) => {
  const result = await creditInsuranceService.getPolicyClaims(req.params.policyId, {
    status: req.query.status,
    page: parseInt(req.query.page) || 1,
    limit: parseInt(req.query.limit) || 10,
  });
  res.paginated(result.claims, result.pagination);
});

/**
 * Get policy summary
 */
exports.getInsurancePolicySummary = asyncHandler(async (req, res) => {
  const summary = await creditInsuranceService.getPolicySummary(req.params.policyId);
  res.success(summary);
});

// =============================================================================
// RECONCILIATION CONTROLLER
// =============================================================================

/**
 * Create reconciliation rule
 */
exports.createReconciliationRule = asyncHandler(async (req, res) => {
  const rule = await reconciliationService.createRule(req.body.businessId, req.body);
  res.created(rule, 'Reconciliation rule created');
});

/**
 * Get reconciliation rules
 */
exports.getReconciliationRules = asyncHandler(async (req, res) => {
  const rules = await reconciliationService.getRules(req.params.businessId);
  res.success(rules);
});

/**
 * Start reconciliation batch
 */
exports.startReconciliation = asyncHandler(async (req, res) => {
  const batch = await reconciliationService.startBatch(
    req.body.businessId,
    req.body.startDate,
    req.body.endDate
  );
  res.success(batch, 'Reconciliation started');
});

/**
 * Get reconciliation batch
 */
exports.getReconciliationBatch = asyncHandler(async (req, res) => {
  const batch = await reconciliationService.getBatch(req.params.batchId);
  if (!batch) return res.notFound('Batch');
  res.success(batch);
});

/**
 * Get unmatched items
 */
exports.getUnmatchedItems = asyncHandler(async (req, res) => {
  const items = await reconciliationService.getUnmatchedItems(req.params.batchId);
  res.success(items);
});

/**
 * Manual match
 */
exports.manualMatch = asyncHandler(async (req, res) => {
  const result = await reconciliationService.manualMatch(
    req.params.itemId,
    req.body.matchType,
    req.body.matchId,
    req.user.id
  );
  res.success(result, 'Manual match recorded');
});

/**
 * Get reconciliation summary
 */
exports.getReconciliationSummary = asyncHandler(async (req, res) => {
  const summary = await reconciliationService.getSummary(req.params.businessId);
  res.success(summary);
});
