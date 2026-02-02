// =============================================================================
// AIRAVAT B2B MARKETPLACE - UAE COMPLIANCE ROUTES
// =============================================================================

const express = require('express');
const router = express.Router();
const ComplianceController = require('../controllers/uae.compliance.controller');
const { authenticate, requireBusiness } = require('../middleware/auth');

router.use(authenticate);
router.use(requireBusiness);

/**
 * @route   POST /api/v1/uae/compliance/verify-license
 */
router.post('/verify-license', ComplianceController.verifyLicense);

/**
 * @route   POST /api/v1/uae/compliance/verify-vat
 */
router.post('/verify-vat', ComplianceController.verifyVAT);

module.exports = router;
