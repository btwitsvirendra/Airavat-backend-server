// =============================================================================
// AIRAVAT B2B MARKETPLACE - RFQ (Request for Quotation) ROUTES
// =============================================================================

const express = require('express');
const router = express.Router();
const rfqController = require('../controllers/rfq.controller');
const { authenticate, requireBusiness, requireVerifiedBusiness } = require('../middleware/auth');
const { rfqLimiter } = require('../middleware/rateLimiter');

// =============================================================================
// BUYER ROUTES (RFQ Creator)
// =============================================================================

// Get my RFQs (as buyer)
router.get(
  '/my-rfqs',
  authenticate,
  requireBusiness,
  rfqController.getMyRFQs
);

// Create RFQ
router.post(
  '/',
  authenticate,
  requireBusiness,
  rfqLimiter,
  rfqController.create
);

// Get RFQ by ID
router.get(
  '/:rfqId',
  authenticate,
  requireBusiness,
  rfqController.getById
);

// Update RFQ (only in DRAFT status)
router.patch(
  '/:rfqId',
  authenticate,
  requireBusiness,
  rfqController.update
);

// Submit RFQ (change from DRAFT to SUBMITTED)
router.post(
  '/:rfqId/submit',
  authenticate,
  requireBusiness,
  rfqController.submit
);

// Cancel RFQ
router.post(
  '/:rfqId/cancel',
  authenticate,
  requireBusiness,
  rfqController.cancel
);

// Close RFQ
router.post(
  '/:rfqId/close',
  authenticate,
  requireBusiness,
  rfqController.close
);

// Get quotations for RFQ
router.get(
  '/:rfqId/quotations',
  authenticate,
  requireBusiness,
  rfqController.getQuotations
);

// Accept quotation
router.post(
  '/:rfqId/quotations/:quotationId/accept',
  authenticate,
  requireBusiness,
  rfqController.acceptQuotation
);

// Reject quotation
router.post(
  '/:rfqId/quotations/:quotationId/reject',
  authenticate,
  requireBusiness,
  rfqController.rejectQuotation
);

// Counter-offer quotation
router.post(
  '/:rfqId/quotations/:quotationId/counter',
  authenticate,
  requireBusiness,
  rfqController.counterOffer
);

// =============================================================================
// SELLER ROUTES (Quotation Provider)
// =============================================================================

// Get RFQs available for quoting (open RFQs matching seller's categories)
router.get(
  '/seller/available',
  authenticate,
  requireBusiness,
  requireVerifiedBusiness,
  rfqController.getAvailableRFQs
);

// Get my quotations (as seller)
router.get(
  '/seller/quotations',
  authenticate,
  requireBusiness,
  rfqController.getMyQuotations
);

// Create quotation for RFQ
router.post(
  '/:rfqId/quote',
  authenticate,
  requireBusiness,
  requireVerifiedBusiness,
  rfqController.createQuotation
);

// Get quotation by ID
router.get(
  '/quotations/:quotationId',
  authenticate,
  requireBusiness,
  rfqController.getQuotationById
);

// Update quotation (only in DRAFT status)
router.patch(
  '/quotations/:quotationId',
  authenticate,
  requireBusiness,
  rfqController.updateQuotation
);

// Submit quotation
router.post(
  '/quotations/:quotationId/submit',
  authenticate,
  requireBusiness,
  rfqController.submitQuotation
);

// Withdraw quotation
router.post(
  '/quotations/:quotationId/withdraw',
  authenticate,
  requireBusiness,
  rfqController.withdrawQuotation
);

// Revise quotation (create new version)
router.post(
  '/quotations/:quotationId/revise',
  authenticate,
  requireBusiness,
  rfqController.reviseQuotation
);

// =============================================================================
// RFQ ITEMS
// =============================================================================

// Add item to RFQ
router.post(
  '/:rfqId/items',
  authenticate,
  requireBusiness,
  rfqController.addItem
);

// Update RFQ item
router.patch(
  '/:rfqId/items/:itemId',
  authenticate,
  requireBusiness,
  rfqController.updateItem
);

// Remove RFQ item
router.delete(
  '/:rfqId/items/:itemId',
  authenticate,
  requireBusiness,
  rfqController.removeItem
);

// =============================================================================
// ANALYTICS
// =============================================================================

// Get RFQ stats (for dashboard)
router.get(
  '/stats/overview',
  authenticate,
  requireBusiness,
  rfqController.getStats
);

module.exports = router;
