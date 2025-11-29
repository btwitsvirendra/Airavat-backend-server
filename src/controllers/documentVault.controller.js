// =============================================================================
// AIRAVAT B2B MARKETPLACE - DOCUMENT VAULT CONTROLLER
// =============================================================================

const DocumentVaultService = require('../services/documentVault.service');
const { asyncHandler } = require('../utils/asyncHandler');

// Upload document
exports.uploadDocument = asyncHandler(async (req, res) => {
  const { documentType, ...metadata } = req.body;
  const result = await DocumentVaultService.uploadDocument(
    req.user.businessId,
    req.user.id,
    req.file,
    documentType,
    metadata
  );
  res.status(201).json({ success: true, data: result });
});

// Get document
exports.getDocument = asyncHandler(async (req, res) => {
  const { accessReason } = req.query;
  const result = await DocumentVaultService.getDocument(req.params.documentId, req.user.id, accessReason);
  res.json({ success: true, data: result });
});

// Download document
exports.downloadDocument = asyncHandler(async (req, res) => {
  const { accessReason } = req.query;
  const result = await DocumentVaultService.downloadDocument(req.params.documentId, req.user.id, accessReason);
  
  res.setHeader('Content-Type', result.mimeType);
  res.setHeader('Content-Disposition', `attachment; filename=${result.fileName}`);
  res.json({ success: true, data: result });
});

// Get business documents
exports.getBusinessDocuments = asyncHandler(async (req, res) => {
  const result = await DocumentVaultService.getBusinessDocuments(req.user.businessId, req.query);
  res.json({ success: true, data: result });
});

// Delete document
exports.deleteDocument = asyncHandler(async (req, res) => {
  const { reason } = req.body;
  await DocumentVaultService.deleteDocument(req.params.documentId, req.user.id, reason);
  res.json({ success: true, message: 'Document deleted' });
});

// Grant access
exports.grantAccess = asyncHandler(async (req, res) => {
  const { grantedTo, expiresAt } = req.body;
  const result = await DocumentVaultService.grantAccess(req.params.documentId, req.user.id, grantedTo, expiresAt);
  res.json({ success: true, data: result });
});

// Revoke access
exports.revokeAccess = asyncHandler(async (req, res) => {
  const { userId } = req.body;
  await DocumentVaultService.revokeAccess(req.params.documentId, userId, req.user.id);
  res.json({ success: true, message: 'Access revoked' });
});

// Get audit log
exports.getAuditLog = asyncHandler(async (req, res) => {
  const result = await DocumentVaultService.getAuditLog(req.params.documentId, req.query);
  res.json({ success: true, data: result });
});

// Verify document (admin)
exports.verifyDocument = asyncHandler(async (req, res) => {
  const { status, notes } = req.body;
  await DocumentVaultService.verifyDocument(req.params.documentId, req.user.id, status, notes);
  res.json({ success: true, message: 'Document verified' });
});

