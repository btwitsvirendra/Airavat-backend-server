// =============================================================================
// AIRAVAT B2B MARKETPLACE - FINANCIAL ADMIN CONTROLLER
// Admin endpoints for managing financial services
// =============================================================================

const emiService = require('../services/emi.service');
const invoiceFactoringService = require('../services/invoiceFactoring.service');
const tradeFinanceService = require('../services/tradeFinance.service');
const cashbackService = require('../services/cashback.service');
const walletService = require('../services/wallet.service');
const creditInsuranceService = require('../services/creditInsurance.service');
const reconciliationService = require('../services/reconciliation.service');
const { asyncHandler } = require('../utils/apiResponse');

// =============================================================================
// WALLET ADMIN
// =============================================================================

/**
 * Update wallet limits (admin)
 */
exports.updateWalletLimits = asyncHandler(async (req, res) => {
  const result = await walletService.updateLimits(
    req.params.walletId,
    {
      dailyLimit: req.body.dailyLimit,
      monthlyLimit: req.body.monthlyLimit,
    },
    req.user.id
  );
  res.success(result, 'Wallet limits updated');
});

/**
 * Suspend wallet (admin)
 */
exports.suspendWallet = asyncHandler(async (req, res) => {
  const wallet = await walletService.suspendWallet(
    req.params.walletId,
    req.body.reason,
    req.user.id
  );
  res.success(wallet, 'Wallet suspended');
});

/**
 * Activate wallet (admin)
 */
exports.activateWallet = asyncHandler(async (req, res) => {
  const wallet = await walletService.activateWallet(req.params.walletId, req.user.id);
  res.success(wallet, 'Wallet activated');
});

/**
 * Get all wallets (admin)
 */
exports.getAllWallets = asyncHandler(async (req, res) => {
  const { prisma } = require('../config/database');
  
  const { page = 1, limit = 20, status, minBalance, maxBalance } = req.query;
  
  const where = {};
  if (status) where.status = status;
  if (minBalance) where.balance = { gte: parseFloat(minBalance) };
  if (maxBalance) {
    where.balance = { ...where.balance, lte: parseFloat(maxBalance) };
  }

  const [wallets, total] = await Promise.all([
    prisma.wallet.findMany({
      where,
      include: {
        user: {
          select: { id: true, name: true, email: true },
        },
        business: {
          select: { id: true, businessName: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      skip: (parseInt(page) - 1) * parseInt(limit),
      take: parseInt(limit),
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
 * Get wallet statistics (admin)
 */
exports.getWalletStats = asyncHandler(async (req, res) => {
  const { prisma } = require('../config/database');
  
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
 * Approve EMI order (admin)
 */
exports.approveEMIOrder = asyncHandler(async (req, res) => {
  const emiOrder = await emiService.approveEMIOrder(req.params.emiOrderId, req.user.id);
  res.success(emiOrder, 'EMI order approved');
});

/**
 * Reject EMI order (admin)
 */
exports.rejectEMIOrder = asyncHandler(async (req, res) => {
  const emiOrder = await emiService.rejectEMIOrder(
    req.params.emiOrderId,
    req.body.reason,
    req.user.id
  );
  res.success(emiOrder, 'EMI order rejected');
});

/**
 * Waive late fee (admin)
 */
exports.waiveLateFee = asyncHandler(async (req, res) => {
  const installment = await emiService.waiveLateFee(
    req.params.installmentId,
    req.user.id,
    req.body.reason
  );
  res.success(installment, 'Late fee waived');
});

/**
 * Get all EMI orders (admin)
 */
exports.getAllEMIOrders = asyncHandler(async (req, res) => {
  const { prisma } = require('../config/database');
  
  const { page = 1, limit = 20, status } = req.query;
  
  const where = {};
  if (status) where.status = status;

  const [orders, total] = await Promise.all([
    prisma.eMIOrder.findMany({
      where,
      include: {
        user: {
          select: { id: true, name: true, email: true },
        },
        order: {
          select: { id: true, orderNumber: true },
        },
        _count: {
          select: { installments: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      skip: (parseInt(page) - 1) * parseInt(limit),
      take: parseInt(limit),
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
 * Get EMI collection report (admin)
 */
exports.getEMICollectionReport = asyncHandler(async (req, res) => {
  const report = await emiService.getCollectionReport(
    req.query.startDate,
    req.query.endDate
  );
  res.success(report);
});

/**
 * Get overdue installments (admin)
 */
exports.getAllOverdueInstallments = asyncHandler(async (req, res) => {
  const { prisma } = require('../config/database');
  
  const { page = 1, limit = 50 } = req.query;

  const [installments, total] = await Promise.all([
    prisma.eMIInstallment.findMany({
      where: { status: 'OVERDUE' },
      include: {
        emiOrder: {
          include: {
            user: { select: { id: true, name: true, email: true, phone: true } },
          },
        },
      },
      orderBy: { dueDate: 'asc' },
      skip: (parseInt(page) - 1) * parseInt(limit),
      take: parseInt(limit),
    }),
    prisma.eMIInstallment.count({ where: { status: 'OVERDUE' } }),
  ]);

  res.paginated(installments, {
    page: parseInt(page),
    limit: parseInt(limit),
    total,
    pages: Math.ceil(total / parseInt(limit)),
  });
});

// =============================================================================
// INVOICE FACTORING ADMIN
// =============================================================================

/**
 * Approve factoring application (admin)
 */
exports.approveFactoringApplication = asyncHandler(async (req, res) => {
  const application = await invoiceFactoringService.approveApplication(
    req.params.applicationId,
    req.user.id,
    req.body.notes
  );
  res.success(application, 'Application approved');
});

/**
 * Reject factoring application (admin)
 */
exports.rejectFactoringApplication = asyncHandler(async (req, res) => {
  const application = await invoiceFactoringService.rejectApplication(
    req.params.applicationId,
    req.user.id,
    req.body.reason
  );
  res.success(application, 'Application rejected');
});

/**
 * Disburse factoring (admin)
 */
exports.disburseFactoring = asyncHandler(async (req, res) => {
  const result = await invoiceFactoringService.disburse(
    req.params.applicationId,
    {
      disbursementRef: req.body.disbursementRef,
      bankAccountId: req.body.bankAccountId,
    }
  );
  res.success(result, 'Disbursement completed');
});

/**
 * Record factoring settlement (admin)
 */
exports.recordFactoringSettlement = asyncHandler(async (req, res) => {
  const result = await invoiceFactoringService.recordSettlement(
    req.params.applicationId,
    {
      settlementAmount: req.body.settlementAmount,
      settlementRef: req.body.settlementRef,
      settlementDate: req.body.settlementDate,
    }
  );
  res.success(result, 'Settlement recorded');
});

/**
 * Get all factoring applications (admin)
 */
exports.getAllFactoringApplications = asyncHandler(async (req, res) => {
  const { prisma } = require('../config/database');
  
  const { page = 1, limit = 20, status } = req.query;
  
  const where = {};
  if (status) where.status = status;

  const [applications, total] = await Promise.all([
    prisma.factoringApplication.findMany({
      where,
      include: {
        business: {
          select: { id: true, businessName: true },
        },
        buyerBusiness: {
          select: { id: true, businessName: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      skip: (parseInt(page) - 1) * parseInt(limit),
      take: parseInt(limit),
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
 * Get factoring report (admin)
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
 * Issue LC (admin/bank)
 */
exports.issueLC = asyncHandler(async (req, res) => {
  const lc = await tradeFinanceService.issueLC(req.params.lcId, req.user.id);
  res.success(lc, 'LC issued');
});

/**
 * Advise LC (admin/bank)
 */
exports.adviseLC = asyncHandler(async (req, res) => {
  const lc = await tradeFinanceService.adviseLC(req.params.lcId, req.user.id);
  res.success(lc, 'LC advised');
});

/**
 * Confirm LC (admin/bank)
 */
exports.confirmLC = asyncHandler(async (req, res) => {
  const lc = await tradeFinanceService.confirmLC(
    req.params.lcId,
    req.body.confirmingBank,
    req.user.id
  );
  res.success(lc, 'LC confirmed');
});

/**
 * Approve LC amendment (admin)
 */
exports.approveLCAmendment = asyncHandler(async (req, res) => {
  const amendment = await tradeFinanceService.approveAmendment(
    req.params.amendmentId,
    req.user.id
  );
  res.success(amendment, 'Amendment approved');
});

/**
 * Examine LC documents (admin/bank)
 */
exports.examineLCDocuments = asyncHandler(async (req, res) => {
  const result = await tradeFinanceService.examineDocuments(
    req.params.presentationId,
    req.body.examinationResult,
    req.user.id
  );
  res.success(result, 'Documents examined');
});

/**
 * Process LC payment (admin/bank)
 */
exports.processLCPayment = asyncHandler(async (req, res) => {
  const result = await tradeFinanceService.processPayment(
    req.params.lcId,
    {
      paymentAmount: req.body.paymentAmount,
      paymentRef: req.body.paymentRef,
    },
    req.user.id
  );
  res.success(result, 'Payment processed');
});

/**
 * Get all LCs (admin)
 */
exports.getAllLCs = asyncHandler(async (req, res) => {
  const { prisma } = require('../config/database');
  
  const { page = 1, limit = 20, status, type } = req.query;
  
  const where = {};
  if (status) where.status = status;
  if (type) where.type = type;

  const [lcs, total] = await Promise.all([
    prisma.letterOfCredit.findMany({
      where,
      include: {
        applicant: { select: { id: true, businessName: true } },
        beneficiary: { select: { id: true, businessName: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip: (parseInt(page) - 1) * parseInt(limit),
      take: parseInt(limit),
    }),
    prisma.letterOfCredit.count({ where }),
  ]);

  res.paginated(lcs, {
    page: parseInt(page),
    limit: parseInt(limit),
    total,
    pages: Math.ceil(total / parseInt(limit)),
  });
});

// =============================================================================
// CASHBACK ADMIN
// =============================================================================

/**
 * Create cashback program (admin)
 */
exports.createCashbackProgram = asyncHandler(async (req, res) => {
  const program = await cashbackService.createProgram(req.body);
  res.created(program, 'Cashback program created');
});

/**
 * Update cashback program (admin)
 */
exports.updateCashbackProgram = asyncHandler(async (req, res) => {
  const program = await cashbackService.updateProgram(req.params.programId, req.body);
  res.success(program, 'Program updated');
});

/**
 * Deactivate cashback program (admin)
 */
exports.deactivateCashbackProgram = asyncHandler(async (req, res) => {
  await cashbackService.deactivateProgram(req.params.programId);
  res.success({ success: true }, 'Program deactivated');
});

/**
 * Get all cashback programs (admin)
 */
exports.getAllCashbackPrograms = asyncHandler(async (req, res) => {
  const { prisma } = require('../config/database');
  
  const { page = 1, limit = 20, isActive } = req.query;
  
  const where = {};
  if (isActive !== undefined) where.isActive = isActive === 'true';

  const [programs, total] = await Promise.all([
    prisma.cashbackProgram.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (parseInt(page) - 1) * parseInt(limit),
      take: parseInt(limit),
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
 * Manually credit cashback (admin)
 */
exports.manuallyCreditCashback = asyncHandler(async (req, res) => {
  const result = await cashbackService.creditReward(req.params.rewardId);
  res.success(result, 'Cashback credited');
});

/**
 * Cancel cashback reward (admin)
 */
exports.cancelCashbackReward = asyncHandler(async (req, res) => {
  const result = await cashbackService.cancelReward(req.params.rewardId, req.body.reason);
  res.success(result, 'Reward cancelled');
});

// =============================================================================
// CREDIT INSURANCE ADMIN
// =============================================================================

/**
 * Review insurance claim (admin)
 */
exports.reviewInsuranceClaim = asyncHandler(async (req, res) => {
  const claim = await creditInsuranceService.reviewClaim(
    req.params.claimId,
    { notes: req.body.notes },
    req.user.id
  );
  res.success(claim, 'Claim under review');
});

/**
 * Approve insurance claim (admin)
 */
exports.approveInsuranceClaim = asyncHandler(async (req, res) => {
  const claim = await creditInsuranceService.approveClaim(req.params.claimId, req.user.id);
  res.success(claim, 'Claim approved');
});

/**
 * Reject insurance claim (admin)
 */
exports.rejectInsuranceClaim = asyncHandler(async (req, res) => {
  const claim = await creditInsuranceService.rejectClaim(
    req.params.claimId,
    req.body.reason,
    req.user.id
  );
  res.success(claim, 'Claim rejected');
});

/**
 * Settle insurance claim (admin)
 */
exports.settleInsuranceClaim = asyncHandler(async (req, res) => {
  const claim = await creditInsuranceService.settleClaim(req.params.claimId, {
    settlementAmount: req.body.settlementAmount,
    settlementRef: req.body.settlementRef,
  });
  res.success(claim, 'Claim settled');
});

/**
 * Get all insurance claims (admin)
 */
exports.getAllInsuranceClaims = asyncHandler(async (req, res) => {
  const { prisma } = require('../config/database');
  
  const { page = 1, limit = 20, status } = req.query;
  
  const where = {};
  if (status) where.status = status;

  const [claims, total] = await Promise.all([
    prisma.insuranceClaim.findMany({
      where,
      include: {
        policy: {
          select: { policyNumber: true, businessId: true },
        },
      },
      orderBy: { claimDate: 'desc' },
      skip: (parseInt(page) - 1) * parseInt(limit),
      take: parseInt(limit),
    }),
    prisma.insuranceClaim.count({ where }),
  ]);

  res.paginated(claims, {
    page: parseInt(page),
    limit: parseInt(limit),
    total,
    pages: Math.ceil(total / parseInt(limit)),
  });
});

/**
 * Update buyer credit limit (admin)
 */
exports.updateBuyerCreditLimit = asyncHandler(async (req, res) => {
  const buyer = await creditInsuranceService.updateBuyerLimit(
    req.params.insuredBuyerId,
    req.body.newLimit
  );
  res.success(buyer, 'Credit limit updated');
});

// =============================================================================
// RECONCILIATION ADMIN
// =============================================================================

/**
 * Get reconciliation dashboard (admin)
 */
exports.getReconciliationDashboard = asyncHandler(async (req, res) => {
  const { prisma } = require('../config/database');
  
  const [
    totalBatches,
    inProgressBatches,
    matchedItems,
    unmatchedItems,
  ] = await Promise.all([
    prisma.reconciliationBatch.count(),
    prisma.reconciliationBatch.count({ where: { status: 'IN_PROGRESS' } }),
    prisma.reconciliationItem.count({ where: { status: 'MATCHED' } }),
    prisma.reconciliationItem.count({ where: { status: 'UNMATCHED' } }),
  ]);

  res.success({
    totalBatches,
    inProgressBatches,
    matchedItems,
    unmatchedItems,
    matchRate: totalBatches > 0 
      ? Math.round((matchedItems / (matchedItems + unmatchedItems)) * 100) 
      : 0,
  });
});

// =============================================================================
// FINANCIAL DASHBOARD
// =============================================================================

/**
 * Get financial overview (admin)
 */
exports.getFinancialOverview = asyncHandler(async (req, res) => {
  const { prisma } = require('../config/database');
  
  const today = new Date();
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const [
    walletStats,
    emiStats,
    factoringStats,
    lcStats,
    insuranceStats,
  ] = await Promise.all([
    // Wallet stats
    prisma.wallet.aggregate({
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
    
    // Insurance stats
    prisma.creditInsurancePolicy.aggregate({
      where: { status: 'ACTIVE' },
      _sum: { coverageLimit: true },
      _count: true,
    }),
  ]);

  res.success({
    wallet: {
      totalBalance: parseFloat(walletStats._sum.balance || 0),
      totalWallets: walletStats._count,
    },
    emi: {
      activeOrders: emiStats._count,
      outstandingAmount: parseFloat(emiStats._sum.remainingAmount || 0),
    },
    factoring: {
      activeApplications: factoringStats._count,
      totalDisbursed: parseFloat(factoringStats._sum.advanceAmount || 0),
    },
    tradeFinance: {
      activeLCs: lcStats._count,
      totalAmount: parseFloat(lcStats._sum.amount || 0),
    },
    insurance: {
      activePolicies: insuranceStats._count,
      totalCoverage: parseFloat(insuranceStats._sum.coverageLimit || 0),
    },
    generatedAt: new Date(),
  });
});

/**
 * Get financial transactions report (admin)
 */
exports.getFinancialTransactionsReport = asyncHandler(async (req, res) => {
  const { prisma } = require('../config/database');
  
  const { startDate, endDate, groupBy = 'day' } = req.query;
  
  const start = new Date(startDate);
  const end = new Date(endDate);

  const transactions = await prisma.walletTransaction.groupBy({
    by: ['type'],
    where: {
      createdAt: { gte: start, lte: end },
      status: 'COMPLETED',
    },
    _sum: { amount: true },
    _count: true,
  });

  const report = {
    period: { startDate, endDate },
    byType: transactions.map(t => ({
      type: t.type,
      count: t._count,
      totalAmount: parseFloat(t._sum.amount || 0),
    })),
  };

  res.success(report);
});
