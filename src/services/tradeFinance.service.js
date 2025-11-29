// =============================================================================
// AIRAVAT B2B MARKETPLACE - TRADE FINANCE SERVICE
// Letter of Credit management for B2B transactions
// =============================================================================

const { prisma } = require('../config/database');
const logger = require('../config/logger');
const { eventEmitter } = require('./eventEmitter.service');
const crypto = require('crypto');

/**
 * Trade Finance Configuration
 */
const LC_CONFIG = {
  minAmount: 100000, // Minimum LC amount
  maxAmount: 100000000, // Maximum LC amount
  defaultTolerance: 5, // +/- 5%
  maxExpiryDays: 180, // Maximum LC validity
  issuanceFeeRate: 0.15, // 0.15% per month
  amendmentFee: 5000, // Fixed fee per amendment
  lcPrefix: 'LC',
  requiredDocuments: [
    'COMMERCIAL_INVOICE',
    'PACKING_LIST',
    'BILL_OF_LADING',
    'CERTIFICATE_OF_ORIGIN',
    'INSURANCE_CERTIFICATE',
  ],
};

class TradeFinanceService {
  // ===========================================================================
  // LETTER OF CREDIT CREATION
  // ===========================================================================

  /**
   * Create draft LC
   */
  async createDraftLC(applicantId, lcData) {
    const {
      beneficiaryId,
      amount,
      currency,
      type = 'IRREVOCABLE',
      issuingBank,
      issuingBankSwift,
      advisingBank,
      advisingBankSwift,
      paymentTerms,
      usanceDays,
      expiryDate,
      latestShipDate,
      partialShipment = false,
      transhipment = false,
      goodsDescription,
      portOfLoading,
      portOfDischarge,
      placeOfDelivery,
      requiredDocuments = LC_CONFIG.requiredDocuments,
      orderId,
    } = lcData;

    // Validate applicant (buyer)
    const applicant = await prisma.business.findUnique({
      where: { id: applicantId },
    });
    if (!applicant) throw new Error('Applicant business not found');
    if (applicant.verificationStatus !== 'VERIFIED') {
      throw new Error('Applicant business must be verified');
    }

    // Validate beneficiary (seller)
    const beneficiary = await prisma.business.findUnique({
      where: { id: beneficiaryId },
    });
    if (!beneficiary) throw new Error('Beneficiary business not found');
    if (beneficiary.verificationStatus !== 'VERIFIED') {
      throw new Error('Beneficiary business must be verified');
    }

    // Validate amount
    if (amount < LC_CONFIG.minAmount) {
      throw new Error(`Minimum LC amount is ${currency} ${LC_CONFIG.minAmount}`);
    }
    if (amount > LC_CONFIG.maxAmount) {
      throw new Error(`Maximum LC amount is ${currency} ${LC_CONFIG.maxAmount}`);
    }

    // Validate expiry date
    const expiry = new Date(expiryDate);
    const maxExpiry = new Date();
    maxExpiry.setDate(maxExpiry.getDate() + LC_CONFIG.maxExpiryDays);
    if (expiry > maxExpiry) {
      throw new Error(`LC expiry cannot exceed ${LC_CONFIG.maxExpiryDays} days`);
    }

    // Generate LC number
    const lcNumber = await this.generateLCNumber();

    const lc = await prisma.letterOfCredit.create({
      data: {
        lcNumber,
        applicantId,
        beneficiaryId,
        type,
        amount,
        currency,
        tolerance: LC_CONFIG.defaultTolerance,
        issueDate: new Date(),
        expiryDate: expiry,
        latestShipDate: latestShipDate ? new Date(latestShipDate) : null,
        issuingBank,
        issuingBankSwift,
        advisingBank,
        advisingBankSwift,
        paymentTerms,
        usanceDays: paymentTerms === 'USANCE' ? usanceDays : null,
        partialShipment,
        transhipment,
        goodsDescription,
        portOfLoading,
        portOfDischarge,
        placeOfDelivery,
        requiredDocuments,
        status: 'DRAFT',
        orderId,
      },
    });

    logger.info('Draft LC created', {
      lcId: lc.id,
      lcNumber,
      applicantId,
      beneficiaryId,
      amount,
    });

    return lc;
  }

  /**
   * Generate LC number
   */
  async generateLCNumber() {
    const date = new Date();
    const year = date.getFullYear().toString().slice(-2);
    const month = String(date.getMonth() + 1).padStart(2, '0');

    const count = await prisma.letterOfCredit.count({
      where: {
        lcNumber: { startsWith: `${LC_CONFIG.lcPrefix}${year}${month}` },
      },
    });

    return `${LC_CONFIG.lcPrefix}${year}${month}${String(count + 1).padStart(5, '0')}`;
  }

  // ===========================================================================
  // LC LIFECYCLE MANAGEMENT
  // ===========================================================================

  /**
   * Submit LC for issuance
   */
  async submitLC(lcId, applicantUserId) {
    const lc = await this.getLC(lcId);
    if (!lc) throw new Error('LC not found');
    if (lc.status !== 'DRAFT') throw new Error('LC is not in draft status');

    // Verify applicant owns this LC
    const applicantBusiness = await prisma.business.findFirst({
      where: { id: lc.applicantId, userId: applicantUserId },
    });
    if (!applicantBusiness) throw new Error('Unauthorized');

    // Validate all required fields
    this.validateLCForSubmission(lc);

    const updatedLC = await prisma.letterOfCredit.update({
      where: { id: lcId },
      data: { status: 'SUBMITTED' },
    });

    logger.info('LC submitted for issuance', { lcId, lcNumber: lc.lcNumber });

    eventEmitter.emit('lc.submitted', { lcId, lcNumber: lc.lcNumber });

    return updatedLC;
  }

  /**
   * Validate LC for submission
   */
  validateLCForSubmission(lc) {
    const required = [
      'beneficiaryId',
      'amount',
      'currency',
      'issuingBank',
      'expiryDate',
      'goodsDescription',
      'requiredDocuments',
    ];

    const missing = required.filter((field) => !lc[field]);
    if (missing.length > 0) {
      throw new Error(`Missing required fields: ${missing.join(', ')}`);
    }

    if (lc.requiredDocuments.length === 0) {
      throw new Error('At least one required document must be specified');
    }
  }

  /**
   * Issue LC (by bank/admin)
   */
  async issueLC(lcId, issuedBy) {
    const lc = await this.getLC(lcId);
    if (!lc) throw new Error('LC not found');
    if (lc.status !== 'SUBMITTED') throw new Error('LC must be submitted first');

    const updatedLC = await prisma.letterOfCredit.update({
      where: { id: lcId },
      data: {
        status: 'ISSUED',
        issueDate: new Date(),
      },
    });

    logger.info('LC issued', { lcId, lcNumber: lc.lcNumber, issuedBy });

    eventEmitter.emit('lc.issued', {
      lcId,
      lcNumber: lc.lcNumber,
      applicantId: lc.applicantId,
      beneficiaryId: lc.beneficiaryId,
    });

    // Notify beneficiary
    // emailService.sendLCIssuedNotification(...)

    return updatedLC;
  }

  /**
   * Advise LC (by advising bank)
   */
  async adviseLC(lcId, advisedBy) {
    const lc = await this.getLC(lcId);
    if (!lc) throw new Error('LC not found');
    if (lc.status !== 'ISSUED') throw new Error('LC must be issued first');

    const updatedLC = await prisma.letterOfCredit.update({
      where: { id: lcId },
      data: { status: 'ADVISED' },
    });

    logger.info('LC advised', { lcId, lcNumber: lc.lcNumber, advisedBy });

    eventEmitter.emit('lc.advised', { lcId, lcNumber: lc.lcNumber });

    return updatedLC;
  }

  /**
   * Confirm LC (by confirming bank)
   */
  async confirmLC(lcId, confirmingBank, confirmedBy) {
    const lc = await this.getLC(lcId);
    if (!lc) throw new Error('LC not found');
    if (lc.type !== 'CONFIRMED') throw new Error('This LC type does not require confirmation');

    const updatedLC = await prisma.letterOfCredit.update({
      where: { id: lcId },
      data: {
        status: 'CONFIRMED',
        confirmingBank,
      },
    });

    logger.info('LC confirmed', { lcId, lcNumber: lc.lcNumber, confirmingBank });

    return updatedLC;
  }

  // ===========================================================================
  // LC AMENDMENTS
  // ===========================================================================

  /**
   * Request LC amendment
   */
  async requestAmendment(lcId, amendmentData, requestedBy) {
    const lc = await this.getLC(lcId);
    if (!lc) throw new Error('LC not found');
    if (!['ISSUED', 'ADVISED', 'CONFIRMED'].includes(lc.status)) {
      throw new Error('LC cannot be amended in current status');
    }

    const amendmentNumber = lc.amendmentCount + 1;

    const amendment = await prisma.lCAmendment.create({
      data: {
        lcId,
        amendmentNumber,
        description: amendmentData.description,
        changes: amendmentData.changes,
        status: 'PENDING',
        requestedBy,
        feeAmount: LC_CONFIG.amendmentFee,
      },
    });

    await prisma.letterOfCredit.update({
      where: { id: lcId },
      data: {
        amendmentCount: amendmentNumber,
        status: 'AMENDED',
      },
    });

    logger.info('LC amendment requested', {
      lcId,
      lcNumber: lc.lcNumber,
      amendmentNumber,
    });

    eventEmitter.emit('lc.amendment_requested', {
      lcId,
      amendmentId: amendment.id,
    });

    return amendment;
  }

  /**
   * Approve amendment
   */
  async approveAmendment(amendmentId, approvedBy) {
    const amendment = await prisma.lCAmendment.findUnique({
      where: { id: amendmentId },
      include: { lc: true },
    });

    if (!amendment) throw new Error('Amendment not found');
    if (amendment.status !== 'PENDING') throw new Error('Amendment already processed');

    // Apply changes to LC
    const changes = amendment.changes;
    const updateData = {};

    if (changes.amount) updateData.amount = changes.amount;
    if (changes.expiryDate) updateData.expiryDate = new Date(changes.expiryDate);
    if (changes.latestShipDate) updateData.latestShipDate = new Date(changes.latestShipDate);
    if (changes.goodsDescription) updateData.goodsDescription = changes.goodsDescription;
    // Add more fields as needed

    await prisma.$transaction([
      prisma.lCAmendment.update({
        where: { id: amendmentId },
        data: {
          status: 'APPROVED',
          approvedBy,
          approvedAt: new Date(),
        },
      }),
      prisma.letterOfCredit.update({
        where: { id: amendment.lcId },
        data: {
          ...updateData,
          status: 'ISSUED', // Back to issued after amendment
        },
      }),
    ]);

    logger.info('LC amendment approved', {
      amendmentId,
      lcId: amendment.lcId,
      approvedBy,
    });

    return amendment;
  }

  // ===========================================================================
  // DOCUMENT PRESENTATION
  // ===========================================================================

  /**
   * Present documents
   */
  async presentDocuments(lcId, presentationData, beneficiaryUserId) {
    const { documents } = presentationData;

    const lc = await this.getLC(lcId);
    if (!lc) throw new Error('LC not found');

    // Verify beneficiary
    const beneficiaryBusiness = await prisma.business.findFirst({
      where: { id: lc.beneficiaryId, userId: beneficiaryUserId },
    });
    if (!beneficiaryBusiness) throw new Error('Unauthorized');

    // Check LC status
    if (!['ISSUED', 'ADVISED', 'CONFIRMED'].includes(lc.status)) {
      throw new Error('LC is not in a state to accept documents');
    }

    // Check expiry
    if (new Date() > lc.expiryDate) {
      throw new Error('LC has expired');
    }

    // Get presentation number
    const presentationCount = await prisma.lCPresentation.count({
      where: { lcId },
    });

    const presentation = await prisma.lCPresentation.create({
      data: {
        lcId,
        presentationNumber: presentationCount + 1,
        documents,
        status: 'UNDER_EXAMINATION',
      },
    });

    await prisma.letterOfCredit.update({
      where: { id: lcId },
      data: { status: 'PRESENTED' },
    });

    logger.info('Documents presented', {
      lcId,
      lcNumber: lc.lcNumber,
      presentationId: presentation.id,
    });

    eventEmitter.emit('lc.documents_presented', {
      lcId,
      presentationId: presentation.id,
    });

    return presentation;
  }

  /**
   * Upload LC document
   */
  async uploadDocument(lcId, documentData, uploadedBy) {
    const { documentType, documentNumber, fileUrl, fileName } = documentData;

    const lc = await this.getLC(lcId);
    if (!lc) throw new Error('LC not found');

    const document = await prisma.lCDocument.create({
      data: {
        lcId,
        documentType,
        documentNumber,
        fileUrl,
        fileName,
      },
    });

    logger.info('LC document uploaded', {
      lcId,
      documentType,
      documentId: document.id,
    });

    return document;
  }

  /**
   * Examine documents
   */
  async examineDocuments(presentationId, examinationResult, examinedBy) {
    const { result, discrepancies } = examinationResult;

    const presentation = await prisma.lCPresentation.findUnique({
      where: { id: presentationId },
      include: { lc: true },
    });

    if (!presentation) throw new Error('Presentation not found');
    if (presentation.status !== 'UNDER_EXAMINATION') {
      throw new Error('Presentation already examined');
    }

    const newStatus = result === 'COMPLIANT' ? 'COMPLIANT' : 'DISCREPANT';

    const updatedPresentation = await prisma.lCPresentation.update({
      where: { id: presentationId },
      data: {
        examinationResult: result,
        discrepancies: discrepancies?.join('\n'),
        status: newStatus,
      },
    });

    if (newStatus === 'COMPLIANT') {
      await prisma.letterOfCredit.update({
        where: { id: presentation.lcId },
        data: { status: 'ACCEPTED' },
      });
    }

    logger.info('Documents examined', {
      presentationId,
      result,
      discrepancies,
    });

    eventEmitter.emit('lc.documents_examined', {
      presentationId,
      lcId: presentation.lcId,
      result,
    });

    return updatedPresentation;
  }

  /**
   * Accept discrepant documents
   */
  async acceptDiscrepantDocuments(presentationId, acceptedBy, notes) {
    const presentation = await prisma.lCPresentation.findUnique({
      where: { id: presentationId },
    });

    if (!presentation) throw new Error('Presentation not found');
    if (presentation.status !== 'DISCREPANT') {
      throw new Error('Documents are not discrepant');
    }

    const updatedPresentation = await prisma.lCPresentation.update({
      where: { id: presentationId },
      data: { status: 'ACCEPTED' },
    });

    await prisma.letterOfCredit.update({
      where: { id: presentation.lcId },
      data: { status: 'ACCEPTED' },
    });

    logger.info('Discrepant documents accepted', {
      presentationId,
      acceptedBy,
    });

    return updatedPresentation;
  }

  // ===========================================================================
  // PAYMENT
  // ===========================================================================

  /**
   * Process LC payment
   */
  async processPayment(lcId, paymentDetails, processedBy) {
    const { paymentAmount, paymentRef } = paymentDetails;

    const lc = await this.getLC(lcId);
    if (!lc) throw new Error('LC not found');
    if (lc.status !== 'ACCEPTED') throw new Error('LC not ready for payment');

    // For usance LC, check if maturity reached
    if (lc.paymentTerms === 'USANCE' && lc.usanceDays) {
      const acceptedPresentation = await prisma.lCPresentation.findFirst({
        where: { lcId, status: 'ACCEPTED' },
        orderBy: { presentationDate: 'desc' },
      });

      if (acceptedPresentation) {
        const maturityDate = new Date(acceptedPresentation.presentationDate);
        maturityDate.setDate(maturityDate.getDate() + lc.usanceDays);

        if (new Date() < maturityDate) {
          throw new Error(`Payment not due until ${maturityDate.toISOString().split('T')[0]}`);
        }
      }
    }

    // Validate payment amount with tolerance
    const minAmount = parseFloat(lc.amount) * (1 - parseFloat(lc.tolerance) / 100);
    const maxAmount = parseFloat(lc.amount) * (1 + parseFloat(lc.tolerance) / 100);

    if (paymentAmount < minAmount || paymentAmount > maxAmount) {
      throw new Error(`Payment amount must be between ${minAmount} and ${maxAmount}`);
    }

    // Update presentation
    const presentation = await prisma.lCPresentation.findFirst({
      where: { lcId, status: 'ACCEPTED' },
      orderBy: { presentationDate: 'desc' },
    });

    if (presentation) {
      await prisma.lCPresentation.update({
        where: { id: presentation.id },
        data: {
          status: 'PAID',
          paymentDate: new Date(),
          paymentAmount,
          paymentRef,
        },
      });
    }

    // Update LC status
    const updatedLC = await prisma.letterOfCredit.update({
      where: { id: lcId },
      data: { status: 'PAID' },
    });

    logger.info('LC payment processed', {
      lcId,
      lcNumber: lc.lcNumber,
      paymentAmount,
      paymentRef,
    });

    eventEmitter.emit('lc.paid', {
      lcId,
      lcNumber: lc.lcNumber,
      beneficiaryId: lc.beneficiaryId,
      paymentAmount,
    });

    return updatedLC;
  }

  // ===========================================================================
  // QUERIES
  // ===========================================================================

  /**
   * Get LC by ID
   */
  async getLC(lcId) {
    return prisma.letterOfCredit.findUnique({
      where: { id: lcId },
      include: {
        applicantBusiness: {
          select: { id: true, businessName: true, gstin: true },
        },
        beneficiaryBusiness: {
          select: { id: true, businessName: true, gstin: true },
        },
        documents: true,
        amendments: {
          orderBy: { amendmentNumber: 'asc' },
        },
        presentations: {
          orderBy: { presentationNumber: 'desc' },
        },
      },
    });
  }

  /**
   * Get LC by number
   */
  async getLCByNumber(lcNumber) {
    return prisma.letterOfCredit.findUnique({
      where: { lcNumber },
      include: {
        applicantBusiness: true,
        beneficiaryBusiness: true,
      },
    });
  }

  /**
   * Get LCs for business (as applicant or beneficiary)
   */
  async getBusinessLCs(businessId, options = {}) {
    const { role, status, page = 1, limit = 10 } = options;

    const where = {};

    if (role === 'applicant') {
      where.applicantId = businessId;
    } else if (role === 'beneficiary') {
      where.beneficiaryId = businessId;
    } else {
      where.OR = [
        { applicantId: businessId },
        { beneficiaryId: businessId },
      ];
    }

    if (status) where.status = status;

    const [lcs, total] = await Promise.all([
      prisma.letterOfCredit.findMany({
        where,
        include: {
          applicantBusiness: {
            select: { id: true, businessName: true },
          },
          beneficiaryBusiness: {
            select: { id: true, businessName: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.letterOfCredit.count({ where }),
    ]);

    return {
      lcs,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Get LC summary for business
   */
  async getBusinessLCSummary(businessId) {
    const [asApplicant, asBeneficiary] = await Promise.all([
      prisma.letterOfCredit.aggregate({
        where: {
          applicantId: businessId,
          status: { notIn: ['DRAFT', 'CANCELLED', 'EXPIRED'] },
        },
        _sum: { amount: true },
        _count: true,
      }),
      prisma.letterOfCredit.aggregate({
        where: {
          beneficiaryId: businessId,
          status: { notIn: ['DRAFT', 'CANCELLED', 'EXPIRED'] },
        },
        _sum: { amount: true },
        _count: true,
      }),
    ]);

    const activeLCs = await prisma.letterOfCredit.count({
      where: {
        OR: [
          { applicantId: businessId },
          { beneficiaryId: businessId },
        ],
        status: { in: ['ISSUED', 'ADVISED', 'CONFIRMED', 'PRESENTED', 'ACCEPTED'] },
      },
    });

    return {
      asApplicant: {
        count: asApplicant._count,
        totalAmount: parseFloat(asApplicant._sum.amount || 0),
      },
      asBeneficiary: {
        count: asBeneficiary._count,
        totalAmount: parseFloat(asBeneficiary._sum.amount || 0),
      },
      activeLCs,
    };
  }

  /**
   * Calculate LC issuance fee
   */
  calculateIssuanceFee(amount, validityMonths) {
    const feeRate = LC_CONFIG.issuanceFeeRate;
    const fee = (amount * feeRate * validityMonths) / 100;
    return Math.round(fee * 100) / 100;
  }
}

module.exports = new TradeFinanceService();
