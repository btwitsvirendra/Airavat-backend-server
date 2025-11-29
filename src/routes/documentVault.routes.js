// =============================================================================
// AIRAVAT B2B MARKETPLACE - DOCUMENT VAULT ROUTES
// =============================================================================

const express = require('express');
const router = express.Router();
const multer = require('multer');
const documentVaultController = require('../controllers/documentVault.controller');
const { protect, authorize } = require('../middleware/auth.middleware');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
});

router.use(protect);

// Document upload and access
router.post('/upload', upload.single('document'), documentVaultController.uploadDocument);
router.get('/:documentId', documentVaultController.getDocument);
router.get('/:documentId/download', documentVaultController.downloadDocument);
router.get('/', documentVaultController.getBusinessDocuments);
router.delete('/:documentId', documentVaultController.deleteDocument);

// Access control
router.post('/:documentId/grant-access', documentVaultController.grantAccess);
router.post('/:documentId/revoke-access', documentVaultController.revokeAccess);

// Audit
router.get('/:documentId/audit-log', documentVaultController.getAuditLog);

// Admin - verification
router.put('/:documentId/verify', authorize('admin', 'verifier'), documentVaultController.verifyDocument);

module.exports = router;

