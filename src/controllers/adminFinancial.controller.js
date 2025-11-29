// =============================================================================
// AIRAVAT B2B MARKETPLACE - ADMIN FINANCIAL CONTROLLER
// Admin endpoints for financial services management
// =============================================================================

const walletService = require('../services/wallet.service');
const emiService = require('../services/emi.service');
const invoiceFactoringService = require('../services/invoiceFactoring.service');
const tradeFinanceService = require('../services/tradeFinance.service');
const cashbackService = require('../services/cashback.service');
const virtualCardService = require('../services/virtualCard.service');
const creditInsuranceService = require('../services/creditInsurance.service');
const reconciliationService = require('../services/reconciliation.service');
const { runJob, getJobStatus } = require('../jobs/financial.jobs');
const { asyncHandler } = require('../utils/apiResponse');
const { prisma } = require('../config/database');

// =============================================================================
// WALLET ADMIN
// =============================================================================

/**
 * Get all wallets (paginated)
 */
exports.getAllWallets = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, status, currency } = req.query;

  const where = {};
  if (status) where.status = status;
  if (currency) where.currency = currency;

  const [wallets, total] = await Promise.all([
    prisma.wallet.findMany({
      where,
      include: {
        user: { select: { id: true, name: true, email: true } },
        business: { select: { id: true, businessName: true } },
      },
      skip: (parseInt(page) - 1) * parseInt(limit),
      take: parseInt(limit),
      orderBy: { createdAt: 'desc' },
    }),
    prisma.wallet.count({ where }),
  ]);

  res.paginated(wallets, {
    page: parseInt(page),
    limit: parseInt(limit),
    total,
    pages: Math.ceil(total / parseInt(limit)),
  });
});

/**
 * Suspend wallet
 */
exports.suspendWallet = asyncHandler(async (req, res) => {
  const result = await walletService.suspendWallet(
    req.params.walletId,
    req.body.reason,
    req.user.id
  );
  res.success(result, 'Wallet suspended');
});

/**
 * Activate wallet
 */
exports.activateWallet = asyncHandler(async (req, res) => {
  const result = await walletService.activateWallet(req.params.walletId, req.user.id);
  res.success(result, 'Wallet activated');
});

/**
 * Update wallet limits
 */
exports.updateWalletLimits = asyncHandler(async (req, res) => {
  const result = await walletService.updateLimits(
    req.params.walletId,
    req.body,
    req.user.id
  );
  res.success(result, 'Wallet limits updated');
});

/**
 * Get wallet statistics
 */
exports.getWalletStats = asyncHandler(async (req, res) => {
  const [
    totalWallets,
    activeWallets,
    totalBalance,
    totalTransactions,
  ] = await Promise.all([
    prisma.wallet.count(),
    prisma.wallet.count({ where: { status: 'ACTIVE' } }),
    prisma.wallet.aggregate({ _sum: { balance: true } }),
    prisma.walletTransaction.count(),
  ]);

  res.success({
    totalWallets,
    activeWallets,
    totalBalance: parseFloat(totalBalance._sum.balance || 0),
    totalTransactions,
  });
});

// =============================================================================
// EMI ADMIN
// =============================================================================

/**
 * Get all EMI orders
 */
exports.getAllEMIOrders = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, status } = req.query;

  const where = {};
  if (status) where.status = status;

  const [orders, total] = await Promise.all([
    prisma.eMIOrder.findMany({
      where,
      include: {
        user: { select: { id: true, name: true, email: true } },
        order: { select: { id: true, orderNumber: true } },
        emiPlan: true,
        _count: { select: { installments: true } },
      },
      skip: (parseInt(page) - 1) * parseInt(limit),
      take: parseInt(limit),
      orderBy: { createdAt: 'desc' },
    }),
    prisma.eMIOrder.count({ where }),
  ]);

  res.paginated(orders, {
    page: parseInt(page),
    limit: parseInt(limit),
    total,
    pages: Math.ceil(total / parseInt(limit)),
  });
});

/**
 * Approve EMI order
 */
exports.approveEMIOrder = asyncHandler(async (req, res) => {
  const result = await emiService.approveEMIOrder(req.params.emiOrderId, req.user.id);
  res.success(result, 'EMI order approved');
});

/**
 * Reject EMI order
 */
exports.rejectEMIOrder = asyncHandler(async (req, res) => {
  const result = await emiService.rejectEMIOrder(
    req.params.emiOrderId,
    req.body.reason,
    req.user.id
  );
  res.success(result, 'EMI order rejected');
});

/**
 * Waive late fee
 */
exports.waiveLateFee = asyncHandler(async (req, res) => {
  const result = await emiService.waiveLateFee(
    req.params.installmentId,
    req.user.id,
    req.body.reason
  );
  res.success(result, 'Late fee waived');
});

/**
 * Get EMI collection report
 */
exports.getEMICollectionReport = asyncHandler(async (req, res) => {
  const report = await emiService.getCollectionReport(
    req.query.startDate,
    req.query.endDate
  );
  res.success(report);
});

/**
 * Create EMI plan
 */
exports.createEMIPlan = asyncHandler(async (req, res) => {
  const plan = await prisma.eMIPlan.create({
    data: {
      name: req.body.name,
      tenureMonths: req.body.tenureMonths,
      interestRate: req.body.interestRate,
      processingFee: req.body.processingFee || 1.5,
      minAmount: req.body.minAmount || 1000,
      maxAmount: req.body.maxAmount || 10000000,
      partnerId: req.body.partnerId,
      partnerName: req.body.partnerName,
      isActive: true,
    },
  });
  res.created(plan, 'EMI plan created');
});

// =============================================================================
// INVOICE FACTORING ADMIN
// =============================================================================

/**
 * Get all factoring applications
 */
exports.getAllFactoringApplications = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, status } = req.query;

  const where = {};
  if (status) where.status = status;

  const [applications, total] = await Promise.all([
    prisma.factoringApplication.findMany({
      where,
      include: {
        business: { select: { id: true, businessName: true } },
        buyerBusiness: { select: { id: true, businessName: true } },
      },
      skip: (parseInt(page) - 1) * parseInt(limit),
      take: parseInt(limit),
      orderBy: { createdAt: 'desc' },
    }),
    prisma.factoringApplication.count({ where }),
  ]);

  res.paginated(applications, {
    page: parseInt(page),
    limit: parseInt(limit),
    total,
    pages: Math.ceil(total / parseInt(limit)),
  });
});

/**
 * Approve factoring application
 */
exports.approveFactoringApplication = asyncHandler(async (req, res) => {
  const result = await invoiceFactoringService.approveApplication(
    req.params.applicationId,
    req.user.id,
    req.body.notes
  );
  res.success(result, 'Application approved');
});

/**
 * Reject factoring application
 */
exports.rejectFactoringApplication = asyncHandler(async (req, res) => {
  const result = await invoiceFactoringService.rejectApplication(
    req.params.applicationId,
    req.user.id,
    req.body.reason
  );
  res.success(result, 'Application rejected');
});

/**
 * Disburse factoring
 */
exports.disburseFactoring = asyncHandler(async (req, res) => {
  const result = await invoiceFactoringService.disburse(
    req.params.applicationId,
    req.body
  );
  res.success(result, 'Factoring disbursed');
});

/**
 * Record factoring settlement
 */
exports.recordFactoringSettlement = asyncHandler(async (req, res) => {
  const result = await invoiceFactoringService.recordSettlement(
    req.params.applicationId,
    req.body
  );
  res.success(result, 'Settlement recorded');
});

/**
 * Get factoring report
 */
exports.getFactoringReport = asyncHandler(async (req, res) => {
  const report = await invoiceFactoringService.getFactoringReport(
    req.query.startDate,
    req.query.endDate
  );
  res.success(report);
});

// =============================================================================
// TRADE FINANCE ADMIN
// =============================================================================

/**
 * Issue LC
 */
exports.issueLC = asyncHandler(async (req, res) => {
  const result = await tradeFinanceService.issueLC(req.params.lcId, req.user.id);
  res.success(result, 'LC issued');
});

/**
 * Advise LC
 */
exports.adviseLC = asyncHandler(async (req, res) => {
  const result = await tradeFinanceService.adviseLC(req.params.lcId, req.user.id);
  res.success(result, 'LC advised');
});

/**
 * Confirm LC
 */
exports.confirmLC = asyncHandler(async (req, res) => {
  const result = await tradeFinanceService.confirmLC(
    req.params.lcId,
    req.body.confirmingBank,
    req.user.id
  );
  res.success(result, 'LC confirmed');
});

/**
 * Approve LC amendment
 */
exports.approveLCAmendment = asyncHandler(async (req, res) => {
  const result = await tradeFinanceService.approveAmendment(
    req.params.amendmentId,
    req.user.id
  );
  res.success(result, 'Amendment approved');
});

/**
 * Examine LC documents
 */
exports.examineLCDocuments = asyncHandler(async (req, res) => {
  const result = await tradeFinanceService.examineDocuments(
    req.params.presentationId,
    req.body.examinationResult,
    req.user.id,
    req.body.discrepancies
  );
  res.success(result, 'Documents examined');
});

/**
 * Process LC payment
 */
exports.processLCPayment = asyncHandler(async (req, res) => {
  const result = await tradeFinanceService.processPayment(
    req.params.lcId,
    req.body,
    req.user.id
  );
  res.success(result, 'Payment processed');
});

// =============================================================================
// CASHBACK ADMIN
// =============================================================================

/**
 * Create cashback program
 */
exports.createCashbackProgram = asyncHandler(async (req, res) => {
  const program = await cashbackService.createProgram(req.body);
  res.created(program, 'Cashback program created');
});

/**
 * Update cashback program
 */
exports.updateCashbackProgram = asyncHandler(async (req, res) => {
  const program = await cashbackService.updateProgram(req.params.programId, req.body);
  res.success(program, 'Program updated');
});

/**
 * Deactivate cashback program
 */
exports.deactivateCashbackProgram = asyncHandler(async (req, res) => {
  await cashbackService.deactivateProgram(req.params.programId);
  res.success({ success: true }, 'Program deactivated');
});

/**
 * Get all cashback programs
 */
exports.getAllCashbackPrograms = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, isActive } = req.query;

  const where = {};
  if (isActive !== undefined) where.isActive = isActive === 'true';

  const [programs, total] = await Promise.all([
    prisma.cashbackProgram.findMany({
      where,
      skip: (parseInt(page) - 1) * parseInt(limit),
      take: parseInt(limit),
      orderBy: { createdAt: 'desc' },
    }),
    prisma.cashbackProgram.count({ where }),
  ]);

  res.paginated(programs, {
    page: parseInt(page),
    limit: parseInt(limit),
    total,
    pages: Math.ceil(total / parseInt(limit)),
  });
});

/**
 * Approve cashback reward
 */
exports.approveCashbackReward = asyncHandler(async (req, res) => {
  const result = await cashbackService.approveReward(req.params.rewardId);
  res.success(result, 'Reward approved');
});

/**
 * Cancel cashback reward
 */
exports.cancelCashbackReward = asyncHandler(async (req, res) => {
  const result = await cashbackService.cancelReward(req.params.rewardId, req.body.reason);
  res.success(result, 'Reward cancelled');
});

// =============================================================================
// VIRTUAL CARD ADMIN
// =============================================================================

/**
 * Get all virtual cards
 */
exports.getAllVirtualCards = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, isActive } = req.query;

  const where = {};
  if (isActive !== undefined) where.isActive = isActive === 'true';

  const [cards, total] = await Promise.all([
    prisma.virtualCard.findMany({
      where,
      include: {
        user: { select: { id: true, name: true, email: true } },
        business: { select: { id: true, businessName: true } },
      },
      skip: (parseInt(page) - 1) * parseInt(limit),
      take: parseInt(limit),
      orderBy: { createdAt: 'desc' },
    }),
    prisma.virtualCard.count({ where }),
  ]);

  // Mask card details
  const maskedCards = cards.map(card => ({
    ...card,
    cardToken: undefined,
  }));

  res.paginated(maskedCards, {
    page: parseInt(page),
    limit: parseInt(limit),
    total,
    pages: Math.ceil(total / parseInt(limit)),
  });
});

/**
 * Update card limit (admin)
 */
exports.updateCardLimit = asyncHandler(async (req, res) => {
  const result = await virtualCardService.updateCardLimit(
    req.params.cardId,
    req.body.newLimit,
    req.user.id
  );
  res.success(result, 'Card limit updated');
});

/**
 * Get card transaction report
 */
exports.getCardTransactionReport = asyncHandler(async (req, res) => {
  const { startDate, endDate } = req.query;

  const where = {};
  if (startDate || endDate) {
    where.transactionDate = {};
    if (startDate) where.transactionDate.gte = new Date(startDate);
    if (endDate) where.transactionDate.lte = new Date(endDate);
  }

  const [transactions, stats] = await Promise.all([
    prisma.virtualCardTransaction.groupBy({
      by: ['status'],
      where,
      _count: true,
      _sum: { amount: true },
    }),
    prisma.virtualCardTransaction.aggregate({
      where,
      _sum: { amount: true },
      _count: true,
    }),
  ]);

  res.success({
    total: stats._count,
    totalAmount: parseFloat(stats._sum.amount || 0),
    byStatus: transactions.map(t => ({
      status: t.status,
      count: t._count,
      amount: parseFloat(t._sum.amount || 0),
    })),
  });
});

// =============================================================================
// CREDIT INSURANCE ADMIN
// =============================================================================

/**
 * Review insurance claim
 */
exports.reviewInsuranceClaim = asyncHandler(async (req, res) => {
  const result = await creditInsuranceService.reviewClaim(
    req.params.claimId,
    req.body,
    req.user.id
  );
  res.success(result, 'Claim under review');
});

/**
 * Approve insurance claim
 */
exports.approveInsuranceClaim = asyncHandler(async (req, res) => {
  const result = await creditInsuranceService.approveClaim(
    req.params.claimId,
    req.user.id
  );
  res.success(result, 'Claim approved');
});

/**
 * Reject insurance claim
 */
exports.rejectInsuranceClaim = asyncHandler(async (req, res) => {
  const result = await creditInsuranceService.rejectClaim(
    req.params.claimId,
    req.body.reason,
    req.user.id
  );
  res.success(result, 'Claim rejected');
});

/**
 * Settle insurance claim
 */
exports.settleInsuranceClaim = asyncHandler(async (req, res) => {
  const result = await creditInsuranceService.settleClaim(
    req.params.claimId,
    req.body
  );
  res.success(result, 'Claim settled');
});

/**
 * Get insurance overview
 */
exports.getInsuranceOverview = asyncHandler(async (req, res) => {
  const [
    totalPolicies,
    activePolicies,
    totalClaims,
    pendingClaims,
    totalCoverage,
  ] = await Promise.all([
    prisma.creditInsurancePolicy.count(),
    prisma.creditInsurancePolicy.count({ where: { status: 'ACTIVE' } }),
    prisma.insuranceClaim.count(),
    prisma.insuranceClaim.count({ where: { status: { in: ['SUBMITTED', 'UNDER_REVIEW'] } } }),
    prisma.creditInsurancePolicy.aggregate({
      where: { status: 'ACTIVE' },
      _sum: { coverageLimit: true },
    }),
  ]);

  res.success({
    totalPolicies,
    activePolicies,
    totalClaims,
    pendingClaims,
    totalCoverage: parseFloat(totalCoverage._sum.coverageLimit || 0),
  });
});

// =============================================================================
// SCHEDULED JOBS ADMIN
// =============================================================================

/**
 * Get job status
 */
exports.getFinancialJobStatus = asyncHandler(async (req, res) => {
  const jobs = getJobStatus();
  res.success(jobs);
});

/**
 * Run job manually
 */
exports.runFinancialJob = asyncHandler(async (req, res) => {
  const result = await runJob(req.params.jobName);
  res.success(result, `Job ${req.params.jobName} executed`);
});

// =============================================================================
// FINANCIAL DASHBOARD
// =============================================================================

/**
 * Get financial dashboard overview
 */
exports.getFinancialDashboard = asyncHandler(async (req, res) => {
  const [
    walletStats,
    emiStats,
    factoringStats,
    lcStats,
    cashbackStats,
    cardStats,
    insuranceStats,
  ] = await Promise.all([
    // Wallet stats
    prisma.wallet.aggregate({
      where: { status: 'ACTIVE' },
      _sum: { balance: true },
      _count: true,
    }),
    // EMI stats
    prisma.eMIOrder.aggregate({
      where: { status: 'ACTIVE' },
      _sum: { remainingAmount: true },
      _count: true,
    }),
    // Factoring stats
    prisma.factoringApplication.aggregate({
      where: { status: 'DISBURSED' },
      _sum: { advanceAmount: true },
      _count: true,
    }),
    // LC stats
    prisma.letterOfCredit.aggregate({
      where: { status: { in: ['ISSUED', 'ADVISED', 'CONFIRMED'] } },
      _sum: { amount: true },
      _count: true,
    }),
    // Cashback stats
    prisma.cashbackReward.aggregate({
      where: { status: 'CREDITED' },
      _sum: { cashbackAmount: true },
      _count: true,
    }),
    // Virtual card stats
    prisma.virtualCard.aggregate({
      where: { isActive: true },
      _sum: { cardLimit: true },
      _count: true,
    }),
    // Insurance stats
    prisma.creditInsurancePolicy.aggregate({
      where: { status: 'ACTIVE' },
      _sum: { coverageLimit: true },
      _count: true,
    }),
  ]);

  res.success({
    wallets: {
      count: walletStats._count,
      totalBalance: parseFloat(walletStats._sum.balance || 0),
    },
    emi: {
      activeOrders: emiStats._count,
      outstandingAmount: parseFloat(emiStats._sum.remainingAmount || 0),
    },
    factoring: {
      activeApplications: factoringStats._count,
      disbursedAmount: parseFloat(factoringStats._sum.advanceAmount || 0),
    },
    letterOfCredit: {
      activeCount: lcStats._count,
      totalValue: parseFloat(lcStats._sum.amount || 0),
    },
    cashback: {
      rewardsGiven: cashbackStats._count,
      totalAmount: parseFloat(cashbackStats._sum.cashbackAmount || 0),
    },
    virtualCards: {
      activeCards: cardStats._count,
      totalLimit: parseFloat(cardStats._sum.cardLimit || 0),
    },
    insurance: {
      activePolicies: insuranceStats._count,
      totalCoverage: parseFloat(insuranceStats._sum.coverageLimit || 0),
    },
  });
});
