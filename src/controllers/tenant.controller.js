// =============================================================================
// AIRAVAT B2B MARKETPLACE - TENANT CONTROLLER
// Handles multi-tenancy and white-label endpoints
// =============================================================================

const tenantService = require('../services/multiTenancy.service');
const asyncHandler = require('../middleware/async.middleware');

// =============================================================================
// TENANT MANAGEMENT
// =============================================================================

/**
 * Create a tenant
 * @route POST /api/v1/tenants
 */
const createTenant = asyncHandler(async (req, res) => {
  const tenant = await tenantService.createTenant({
    ...req.body,
    ownerId: req.user.id,
  });

  res.status(201).json({
    success: true,
    message: 'Tenant created successfully',
    data: tenant,
  });
});

/**
 * Get tenant by slug or domain
 * @route GET /api/v1/tenants/:identifier
 */
const getTenant = asyncHandler(async (req, res) => {
  const tenant = await tenantService.getTenant(req.params.identifier);

  res.json({
    success: true,
    data: tenant,
  });
});

/**
 * Update tenant
 * @route PUT /api/v1/tenants/:id
 */
const updateTenant = asyncHandler(async (req, res) => {
  const tenant = await tenantService.updateTenant(req.params.id, req.body);

  res.json({
    success: true,
    message: 'Tenant updated',
    data: tenant,
  });
});

/**
 * Update tenant branding
 * @route PUT /api/v1/tenants/:id/branding
 */
const updateBranding = asyncHandler(async (req, res) => {
  const branding = await tenantService.updateBranding(req.params.id, req.body);

  res.json({
    success: true,
    message: 'Branding updated',
    data: branding,
  });
});

// =============================================================================
// DOMAIN MANAGEMENT
// =============================================================================

/**
 * Setup custom domain
 * @route POST /api/v1/tenants/:id/domain
 */
const setupDomain = asyncHandler(async (req, res) => {
  const result = await tenantService.setupCustomDomain(
    req.params.id,
    req.body.domain
  );

  res.json({
    success: true,
    message: 'Domain setup initiated',
    data: result,
  });
});

/**
 * Verify custom domain
 * @route POST /api/v1/tenants/:id/domain/verify
 */
const verifyDomain = asyncHandler(async (req, res) => {
  const result = await tenantService.verifyCustomDomain(req.params.id);

  res.json({
    success: result.verified,
    message: result.message,
    data: result,
  });
});

/**
 * Remove custom domain
 * @route DELETE /api/v1/tenants/:id/domain
 */
const removeDomain = asyncHandler(async (req, res) => {
  await tenantService.removeCustomDomain(req.params.id);

  res.json({
    success: true,
    message: 'Domain removed',
  });
});

// =============================================================================
// API KEY MANAGEMENT
// =============================================================================

/**
 * Rotate API key
 * @route POST /api/v1/tenants/:id/api-key/rotate
 */
const rotateApiKey = asyncHandler(async (req, res) => {
  const result = await tenantService.regenerateApiKey(req.params.id);

  res.json({
    success: true,
    message: result.message,
    data: { apiKey: result.apiKey },
  });
});

// =============================================================================
// USER MANAGEMENT
// =============================================================================

/**
 * Get tenant users
 * @route GET /api/v1/tenants/:id/users
 */
const getUsers = asyncHandler(async (req, res) => {
  const users = await tenantService.getTenantUsers(req.params.id);

  res.json({
    success: true,
    data: users,
  });
});

/**
 * Add user to tenant
 * @route POST /api/v1/tenants/:id/users
 */
const addUser = asyncHandler(async (req, res) => {
  const member = await tenantService.addTenantUser(
    req.params.id,
    req.body.userId,
    req.body.role
  );

  res.status(201).json({
    success: true,
    message: 'User added to tenant',
    data: member,
  });
});

/**
 * Remove user from tenant
 * @route DELETE /api/v1/tenants/:id/users/:userId
 */
const removeUser = asyncHandler(async (req, res) => {
  await tenantService.removeTenantUser(req.params.id, req.params.userId);

  res.json({
    success: true,
    message: 'User removed from tenant',
  });
});

// =============================================================================
// MODULE EXPORTS
// =============================================================================

module.exports = {
  createTenant,
  getTenant,
  updateTenant,
  updateBranding,
  setupDomain,
  verifyDomain,
  removeDomain,
  rotateApiKey,
  getUsers,
  addUser,
  removeUser,
};



