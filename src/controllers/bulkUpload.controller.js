// =============================================================================
// AIRAVAT B2B MARKETPLACE - BULK UPLOAD CONTROLLER
// =============================================================================

const BulkUploadService = require('../services/bulkUpload.service');
const { asyncHandler } = require('../utils/asyncHandler');

// Upload products
exports.uploadProducts = asyncHandler(async (req, res) => {
  const result = await BulkUploadService.processProductUpload(
    req.user.businessId,
    req.user.id,
    req.file,
    req.body
  );
  res.json({ success: true, data: result });
});

// Upload inventory
exports.uploadInventory = asyncHandler(async (req, res) => {
  const result = await BulkUploadService.processInventoryUpdate(
    req.user.businessId,
    req.user.id,
    req.file
  );
  res.json({ success: true, data: result });
});

// Upload prices
exports.uploadPrices = asyncHandler(async (req, res) => {
  const result = await BulkUploadService.processPriceUpdate(
    req.user.businessId,
    req.user.id,
    req.file,
    req.body
  );
  res.json({ success: true, data: result });
});

// Get jobs
exports.getJobs = asyncHandler(async (req, res) => {
  const result = await BulkUploadService.getJobs(req.user.businessId, req.query);
  res.json({ success: true, data: result });
});

// Get job
exports.getJob = asyncHandler(async (req, res) => {
  const result = await BulkUploadService.getJob(req.params.jobId, req.user.businessId);
  res.json({ success: true, data: result });
});

// Get template
exports.getTemplate = asyncHandler(async (req, res) => {
  const result = BulkUploadService.getTemplate(req.params.type);
  
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename=${result.filename}`);
  res.send(result.csvContent);
});

