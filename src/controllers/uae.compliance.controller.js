// =============================================================================
// AIRAVAT B2B MARKETPLACE - UAE COMPLIANCE CONTROLLER
// =============================================================================

const ComplianceService = require('../services/uae.compliance.service');

/**
 * Verify Trade License
 */
exports.verifyLicense = async (req, res, next) => {
  try {
    const businessId = req.business.id;
    const result = await ComplianceService.verifyTradeLicense(businessId, req.body);
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
};

/**
 * Verify VAT (TRN)
 */
exports.verifyVAT = async (req, res, next) => {
  try {
    const businessId = req.business.id;
    const result = await ComplianceService.verifyTRN(businessId, req.body);
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
};
