// =============================================================================
// AIRAVAT B2B MARKETPLACE - AUTHENTICATION MIDDLEWARE
// JWT-based authentication and authorization
// =============================================================================

const jwt = require('jsonwebtoken');
const config = require('../config');
const { prisma } = require('../config/database');
const { UnauthorizedError, ForbiddenError, VerificationRequiredError } = require('../utils/errors');

/**
 * Extract JWT token from request
 */
const extractToken = (req) => {
  // Check Authorization header
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }
  
  // Check cookies (for web clients)
  if (req.cookies && req.cookies.accessToken) {
    return req.cookies.accessToken;
  }
  
  return null;
};

/**
 * Authenticate user (required)
 * Verifies JWT token and attaches user to request
 */
const authenticate = async (req, res, next) => {
  try {
    const token = extractToken(req);
    
    if (!token) {
      throw new UnauthorizedError('Access token required');
    }
    
    // Verify token
    let decoded;
    try {
      decoded = jwt.verify(token, config.jwt.secret);
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        throw new UnauthorizedError('Access token expired');
      }
      throw new UnauthorizedError('Invalid access token');
    }
    
    // Fetch user from database
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      include: {
        business: {
          select: {
            id: true,
            businessName: true,
            slug: true,
            businessType: true,
            verificationStatus: true,
            subscriptionId: true,
          },
        },
      },
    });
    
    if (!user) {
      throw new UnauthorizedError('User not found');
    }
    
    if (!user.isActive) {
      throw new UnauthorizedError('Account is deactivated');
    }
    
    if (user.isBanned) {
      throw new ForbiddenError(`Account is banned: ${user.banReason || 'Contact support'}`);
    }
    
    // Attach user and business to request
    req.user = user;
    req.business = user.business;
    req.token = token;
    
    next();
  } catch (error) {
    next(error);
  }
};

/**
 * Optional authentication
 * Attaches user if token present, but doesn't require it
 */
const optionalAuth = async (req, res, next) => {
  try {
    const token = extractToken(req);
    
    if (!token) {
      return next();
    }
    
    try {
      const decoded = jwt.verify(token, config.jwt.secret);
      const user = await prisma.user.findUnique({
        where: { id: decoded.userId },
        include: {
          business: {
            select: {
              id: true,
              businessName: true,
              slug: true,
              businessType: true,
              verificationStatus: true,
            },
          },
        },
      });
      
      if (user && user.isActive && !user.isBanned) {
        req.user = user;
        req.business = user.business;
        req.token = token;
      }
    } catch (err) {
      // Token invalid, but that's okay for optional auth
    }
    
    next();
  } catch (error) {
    next(error);
  }
};

/**
 * Role-based authorization
 * Check if user has required role
 */
const authorize = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return next(new UnauthorizedError('Authentication required'));
    }
    
    if (!allowedRoles.includes(req.user.role)) {
      return next(new ForbiddenError('You do not have permission to access this resource'));
    }
    
    next();
  };
};

/**
 * Check if user has a business profile
 */
const requireBusiness = async (req, res, next) => {
  if (!req.business) {
    return next(new ForbiddenError('Business profile required'));
  }
  next();
};

/**
 * Check if business is verified
 */
const requireVerifiedBusiness = async (req, res, next) => {
  if (!req.business) {
    return next(new ForbiddenError('Business profile required'));
  }
  
  if (req.business.verificationStatus !== 'VERIFIED') {
    return next(new VerificationRequiredError());
  }
  
  next();
};

/**
 * Check if user is the business owner or has specific permission
 */
const requireBusinessOwner = async (req, res, next) => {
  if (!req.business) {
    return next(new ForbiddenError('Business profile required'));
  }
  
  // Check if user is the owner
  if (req.business.ownerId !== req.user.id) {
    // Check if user is a member with required permission
    const membership = await prisma.businessMember.findUnique({
      where: {
        businessId_userId: {
          businessId: req.business.id,
          userId: req.user.id,
        },
      },
    });
    
    if (!membership || !membership.isActive) {
      return next(new ForbiddenError('You do not have permission to perform this action'));
    }
    
    req.businessMember = membership;
  }
  
  next();
};

/**
 * Check specific business permission
 */
const requirePermission = (permission) => {
  return async (req, res, next) => {
    if (!req.business) {
      return next(new ForbiddenError('Business profile required'));
    }
    
    // Owner has all permissions
    if (req.business.ownerId === req.user.id) {
      return next();
    }
    
    // Check member permissions
    const membership = req.businessMember || await prisma.businessMember.findUnique({
      where: {
        businessId_userId: {
          businessId: req.business.id,
          userId: req.user.id,
        },
      },
    });
    
    if (!membership || !membership.isActive) {
      return next(new ForbiddenError('You do not have access to this business'));
    }
    
    const permissions = membership.permissions || {};
    if (!permissions[permission]) {
      return next(new ForbiddenError(`Permission required: ${permission}`));
    }
    
    req.businessMember = membership;
    next();
  };
};

/**
 * Check if accessing own resource or is admin
 */
const requireOwnerOrAdmin = (userIdParam = 'userId') => {
  return (req, res, next) => {
    const resourceUserId = req.params[userIdParam];
    const isOwner = req.user.id === resourceUserId;
    const isAdmin = ['SUPER_ADMIN', 'ADMIN'].includes(req.user.role);
    
    if (!isOwner && !isAdmin) {
      return next(new ForbiddenError('You can only access your own resources'));
    }
    
    req.isOwner = isOwner;
    req.isAdmin = isAdmin;
    next();
  };
};

/**
 * Admin only access
 */
const adminOnly = (req, res, next) => {
  if (!req.user) {
    return next(new UnauthorizedError('Authentication required'));
  }
  
  if (!['SUPER_ADMIN', 'ADMIN'].includes(req.user.role)) {
    return next(new ForbiddenError('Admin access required'));
  }
  
  next();
};

/**
 * Super admin only access
 */
const superAdminOnly = (req, res, next) => {
  if (!req.user) {
    return next(new UnauthorizedError('Authentication required'));
  }
  
  if (req.user.role !== 'SUPER_ADMIN') {
    return next(new ForbiddenError('Super admin access required'));
  }
  
  next();
};

/**
 * Generate access token
 */
const generateAccessToken = (userId, additionalData = {}) => {
  return jwt.sign(
    { userId, ...additionalData },
    config.jwt.secret,
    { expiresIn: config.jwt.expiresIn }
  );
};

/**
 * Generate refresh token
 */
const generateRefreshToken = (userId) => {
  return jwt.sign(
    { userId, type: 'refresh' },
    config.jwt.refreshSecret,
    { expiresIn: config.jwt.refreshExpiresIn }
  );
};

/**
 * Verify refresh token
 */
const verifyRefreshToken = (token) => {
  try {
    const decoded = jwt.verify(token, config.jwt.refreshSecret);
    if (decoded.type !== 'refresh') {
      throw new Error('Invalid token type');
    }
    return decoded;
  } catch (error) {
    throw new UnauthorizedError('Invalid refresh token');
  }
};

module.exports = {
  authenticate,
  optionalAuth,
  authorize,
  requireBusiness,
  requireVerifiedBusiness,
  requireBusinessOwner,
  requirePermission,
  requireOwnerOrAdmin,
  adminOnly,
  superAdminOnly,
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
};
