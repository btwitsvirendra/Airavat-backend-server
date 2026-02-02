// =============================================================================
// AIRAVAT B2B MARKETPLACE - UAE COMPLIANCE SERVICE
// Handles Trade License & VAT Verifications for UAE Businesses
// =============================================================================

const { prisma } = require('../config/database');
const logger = require('../config/logger');
const { NotFoundError, BadRequestError } = require('../utils/errors');

/**
 * Register and verify UAE Trade License (Mock Verification)
 */
const verifyTradeLicense = async (businessId, licenseData) => {
  const { licenseNumber, legalName, issuingAuthority, expiryDate, documentUrl } = licenseData;

  const existing = await prisma.uAETradeLicense.findFirst({
    where: { licenseNumber }
  });

  if (existing && existing.businessId !== businessId) {
    throw new BadRequestError('License number already registered by another business');
  }

  const license = await prisma.uAETradeLicense.upsert({
    where: { businessId },
    create: {
      businessId,
      licenseNumber,
      legalName,
      tradeName: licenseData.tradeName || legalName,
      licenseType: licenseData.licenseType || 'Commercial',
      issuingAuthority,
      issueDate: new Date(licenseData.issueDate || Date.now()),
      expiryDate: new Date(expiryDate),
      documentUrl,
      isVerified: true, // Auto-verify for MVP
      verifiedAt: new Date(),
      status: 'ACTIVE'
    },
    update: {
      licenseNumber,
      legalName,
      expiryDate: new Date(expiryDate),
      documentUrl,
      updatedAt: new Date()
    }
  });

  // Update business verification status
  await prisma.business.update({
    where: { id: businessId },
    data: { verificationStatus: 'VERIFIED' }
  });

  logger.info(`UAE Trade License verified for business ${businessId}`);
  return license;
};

/**
 * Register and verify TRN (VAT)
 */
const verifyTRN = async (businessId, vatData) => {
  const { trn, legalName } = vatData;

  const registration = await prisma.uAEVatRegistration.upsert({
    where: { businessId },
    create: {
      businessId,
      trn,
      legalName,
      registrationDate: new Date(vatData.registrationDate || Date.now()),
      isVerified: true,
      status: 'ACTIVE'
    },
    update: {
      trn,
      legalName,
      updatedAt: new Date()
    }
  });

  logger.info(`UAE TRN verified for business ${businessId}`);
  return registration;
};

module.exports = {
  verifyTradeLicense,
  verifyTRN
};
