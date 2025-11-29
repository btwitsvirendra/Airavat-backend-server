// =============================================================================
// AIRAVAT B2B MARKETPLACE - CONTRACT CONTROLLER
// Controller for contract management endpoints
// =============================================================================

const asyncHandler = require('../middleware/async.middleware');
const contractService = require('../services/contract.service');
const { success, created } = require('../utils/apiResponse');

// =============================================================================
// CREATE OPERATIONS
// =============================================================================

/**
 * @desc    Create contract draft
 * @route   POST /api/v1/contracts
 * @access  Private
 */
exports.createContract = asyncHandler(async (req, res) => {
  const contract = await contractService.createContract(
    req.user.businessId,
    req.body.role || 'buyer',
    req.body
  );
  return created(res, contract, 'Contract draft created');
});

// =============================================================================
// READ OPERATIONS
// =============================================================================

/**
 * @desc    Get contracts list
 * @route   GET /api/v1/contracts
 * @access  Private
 */
exports.getContracts = asyncHandler(async (req, res) => {
  const result = await contractService.getContracts(req.user.businessId, req.query);
  return success(res, result);
});

/**
 * @desc    Get contract by ID
 * @route   GET /api/v1/contracts/:contractId
 * @access  Private
 */
exports.getContractById = asyncHandler(async (req, res) => {
  const contract = await contractService.getContractById(
    req.params.contractId,
    req.user.businessId
  );
  return success(res, contract);
});

/**
 * @desc    Get contract statistics
 * @route   GET /api/v1/contracts/stats
 * @access  Private
 */
exports.getContractStats = asyncHandler(async (req, res) => {
  const stats = await contractService.getContractStats(req.user.businessId);
  return success(res, stats);
});

// =============================================================================
// UPDATE OPERATIONS
// =============================================================================

/**
 * @desc    Update contract
 * @route   PATCH /api/v1/contracts/:contractId
 * @access  Private
 */
exports.updateContract = asyncHandler(async (req, res) => {
  const contract = await contractService.updateContract(
    req.params.contractId,
    req.user.businessId,
    req.body
  );
  return success(res, contract, 'Contract updated');
});

// =============================================================================
// WORKFLOW OPERATIONS
// =============================================================================

/**
 * @desc    Submit contract for approval
 * @route   POST /api/v1/contracts/:contractId/submit
 * @access  Private
 */
exports.submitForApproval = asyncHandler(async (req, res) => {
  const contract = await contractService.submitForApproval(
    req.params.contractId,
    req.user.businessId
  );
  return success(res, contract, 'Contract submitted for approval');
});

/**
 * @desc    Respond to contract (approve/reject/negotiate)
 * @route   POST /api/v1/contracts/:contractId/respond
 * @access  Private
 */
exports.respondToContract = asyncHandler(async (req, res) => {
  const contract = await contractService.respondToContract(
    req.params.contractId,
    req.user.businessId,
    req.body.action,
    req.body.comments
  );
  return success(res, contract, `Contract ${req.body.action}ed`);
});

/**
 * @desc    Sign contract
 * @route   POST /api/v1/contracts/:contractId/sign
 * @access  Private
 */
exports.signContract = asyncHandler(async (req, res) => {
  const contract = await contractService.signContract(
    req.params.contractId,
    req.user.businessId
  );
  return success(res, contract, 'Contract signed');
});

/**
 * @desc    Terminate contract
 * @route   POST /api/v1/contracts/:contractId/terminate
 * @access  Private
 */
exports.terminateContract = asyncHandler(async (req, res) => {
  const contract = await contractService.terminateContract(
    req.params.contractId,
    req.user.businessId,
    req.body.reason
  );
  return success(res, contract, 'Contract terminated');
});

/**
 * @desc    Renew contract
 * @route   POST /api/v1/contracts/:contractId/renew
 * @access  Private
 */
exports.renewContract = asyncHandler(async (req, res) => {
  const contract = await contractService.renewContract(
    req.params.contractId,
    req.user.businessId,
    req.body.newEndDate
  );
  return created(res, contract, 'Contract renewed');
});

module.exports = exports;



