// =============================================================================
// AIRAVAT B2B MARKETPLACE - ADMIN ROUTES
// =============================================================================

const express = require('express');
const router = express.Router();
const { authenticate, adminOnly, superAdminOnly } = require('../middleware/auth');
const { prisma } = require('../config/database');
const { success, paginated } = require('../utils/response');
const { parsePagination } = require('../utils/helpers');
const { asyncHandler } = require('../middleware/errorHandler');
const { BadRequestError, NotFoundError } = require('../utils/errors');

// =============================================================================
// DASHBOARD
// =============================================================================

// Get admin dashboard stats
router.get(
  '/dashboard',
  authenticate,
  adminOnly,
  asyncHandler(async (req, res) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const [
      totalUsers,
      totalBusinesses,
      totalProducts,
      totalOrders,
      todayOrders,
      pendingVerifications,
      activeDisputes,
      revenueStats,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.business.count(),
      prisma.product.count(),
      prisma.order.count(),
      prisma.order.count({ where: { createdAt: { gte: today } } }),
      prisma.business.count({ where: { verificationStatus: 'PENDING' } }),
      prisma.dispute.count({ where: { status: { in: ['OPEN', 'UNDER_REVIEW'] } } }),
      prisma.order.aggregate({
        where: { status: 'COMPLETED' },
        _sum: { totalAmount: true },
      }),
    ]);
    
    success(res, {
      stats: {
        totalUsers,
        totalBusinesses,
        totalProducts,
        totalOrders,
        todayOrders,
        pendingVerifications,
        activeDisputes,
        totalRevenue: revenueStats._sum.totalAmount || 0,
      },
    });
  })
);

// Get dashboard charts data
router.get(
  '/dashboard/charts',
  authenticate,
  adminOnly,
  asyncHandler(async (req, res) => {
    const { period = '30days' } = req.query;
    
    let startDate = new Date();
    switch (period) {
      case '7days':
        startDate.setDate(startDate.getDate() - 7);
        break;
      case '30days':
        startDate.setDate(startDate.getDate() - 30);
        break;
      case '90days':
        startDate.setDate(startDate.getDate() - 90);
        break;
      case '1year':
        startDate.setFullYear(startDate.getFullYear() - 1);
        break;
    }
    
    // Get daily order counts
    const orders = await prisma.$queryRaw`
      SELECT DATE(created_at) as date, COUNT(*) as count, SUM(total_amount) as revenue
      FROM orders
      WHERE created_at >= ${startDate}
      GROUP BY DATE(created_at)
      ORDER BY date
    `;
    
    // Get daily user registrations
    const users = await prisma.$queryRaw`
      SELECT DATE(created_at) as date, COUNT(*) as count
      FROM users
      WHERE created_at >= ${startDate}
      GROUP BY DATE(created_at)
      ORDER BY date
    `;
    
    success(res, { orders, users });
  })
);

// =============================================================================
// USER MANAGEMENT
// =============================================================================

// Get all users
router.get(
  '/users',
  authenticate,
  adminOnly,
  asyncHandler(async (req, res) => {
    const { page, limit, skip } = parsePagination(req.query);
    const { role, status, q } = req.query;
    
    const where = {};
    if (role) where.role = role;
    if (status) where.status = status;
    if (q) {
      where.OR = [
        { email: { contains: q, mode: 'insensitive' } },
        { firstName: { contains: q, mode: 'insensitive' } },
        { lastName: { contains: q, mode: 'insensitive' } },
        { phone: { contains: q } },
      ];
    }
    
    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          business: {
            select: { id: true, businessName: true, verificationStatus: true },
          },
        },
      }),
      prisma.user.count({ where }),
    ]);
    
    paginated(res, users, { page, limit, total });
  })
);

// Update user
router.patch(
  '/users/:userId',
  authenticate,
  adminOnly,
  asyncHandler(async (req, res) => {
    const { role, status, isBlocked } = req.body;
    
    const user = await prisma.user.update({
      where: { id: req.params.userId },
      data: {
        ...(role && { role }),
        ...(status && { status }),
        ...(isBlocked !== undefined && { isBlocked }),
      },
    });
    
    success(res, { user }, 'User updated');
  })
);

// Ban user
router.post(
  '/users/:userId/ban',
  authenticate,
  adminOnly,
  asyncHandler(async (req, res) => {
    const { reason, duration } = req.body;
    
    await prisma.user.update({
      where: { id: req.params.userId },
      data: {
        isBlocked: true,
        blockedAt: new Date(),
        blockReason: reason,
        blockExpiresAt: duration ? new Date(Date.now() + duration * 24 * 60 * 60 * 1000) : null,
      },
    });
    
    success(res, null, 'User banned');
  })
);

// Unban user
router.post(
  '/users/:userId/unban',
  authenticate,
  adminOnly,
  asyncHandler(async (req, res) => {
    await prisma.user.update({
      where: { id: req.params.userId },
      data: {
        isBlocked: false,
        blockedAt: null,
        blockReason: null,
        blockExpiresAt: null,
      },
    });
    
    success(res, null, 'User unbanned');
  })
);

// =============================================================================
// BUSINESS VERIFICATION
// =============================================================================

// Get pending verifications
router.get(
  '/verifications',
  authenticate,
  adminOnly,
  asyncHandler(async (req, res) => {
    const { page, limit, skip } = parsePagination(req.query);
    const { status = 'PENDING' } = req.query;
    
    const where = { verificationStatus: status };
    
    const [businesses, total] = await Promise.all([
      prisma.business.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'asc' },
        include: {
          owner: {
            select: { id: true, email: true, firstName: true, lastName: true, phone: true },
          },
          documents: true,
        },
      }),
      prisma.business.count({ where }),
    ]);
    
    paginated(res, businesses, { page, limit, total });
  })
);

// Get verification details
router.get(
  '/verifications/:businessId',
  authenticate,
  adminOnly,
  asyncHandler(async (req, res) => {
    const business = await prisma.business.findUnique({
      where: { id: req.params.businessId },
      include: {
        owner: true,
        documents: true,
        addresses: true,
        bankAccount: true,
      },
    });
    
    if (!business) {
      throw new NotFoundError('Business');
    }
    
    success(res, { business });
  })
);

// Approve business
router.post(
  '/verifications/:businessId/approve',
  authenticate,
  adminOnly,
  asyncHandler(async (req, res) => {
    const { note } = req.body;
    
    const business = await prisma.business.update({
      where: { id: req.params.businessId },
      data: {
        verificationStatus: 'VERIFIED',
        verifiedAt: new Date(),
        verifiedBy: req.user.id,
        verificationNote: note,
      },
    });
    
    // TODO: Send notification to business owner
    
    success(res, { business }, 'Business verified');
  })
);

// Reject business
router.post(
  '/verifications/:businessId/reject',
  authenticate,
  adminOnly,
  asyncHandler(async (req, res) => {
    const { reason, documents } = req.body;
    
    if (!reason) {
      throw new BadRequestError('Rejection reason is required');
    }
    
    const business = await prisma.business.update({
      where: { id: req.params.businessId },
      data: {
        verificationStatus: 'REJECTED',
        verificationNote: reason,
        rejectedDocuments: documents || [],
      },
    });
    
    // TODO: Send notification to business owner
    
    success(res, { business }, 'Business rejected');
  })
);

// Request additional documents
router.post(
  '/verifications/:businessId/request-documents',
  authenticate,
  adminOnly,
  asyncHandler(async (req, res) => {
    const { documents, message } = req.body;
    
    if (!documents || documents.length === 0) {
      throw new BadRequestError('Document list is required');
    }
    
    await prisma.business.update({
      where: { id: req.params.businessId },
      data: {
        verificationStatus: 'DOCUMENTS_REQUIRED',
        requiredDocuments: documents,
        verificationNote: message,
      },
    });
    
    // TODO: Send notification
    
    success(res, null, 'Document request sent');
  })
);

// =============================================================================
// PRODUCT MODERATION
// =============================================================================

// Get products for moderation
router.get(
  '/products/moderation',
  authenticate,
  adminOnly,
  asyncHandler(async (req, res) => {
    const { page, limit, skip } = parsePagination(req.query);
    const { status = 'PENDING_APPROVAL' } = req.query;
    
    const where = { status };
    
    const [products, total] = await Promise.all([
      prisma.product.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'asc' },
        include: {
          business: {
            select: { id: true, businessName: true, verificationStatus: true },
          },
          category: {
            select: { id: true, name: true },
          },
        },
      }),
      prisma.product.count({ where }),
    ]);
    
    paginated(res, products, { page, limit, total });
  })
);

// Approve product
router.post(
  '/products/:productId/approve',
  authenticate,
  adminOnly,
  asyncHandler(async (req, res) => {
    const product = await prisma.product.update({
      where: { id: req.params.productId },
      data: {
        status: 'ACTIVE',
        approvedAt: new Date(),
        approvedBy: req.user.id,
      },
    });
    
    success(res, { product }, 'Product approved');
  })
);

// Reject product
router.post(
  '/products/:productId/reject',
  authenticate,
  adminOnly,
  asyncHandler(async (req, res) => {
    const { reason } = req.body;
    
    if (!reason) {
      throw new BadRequestError('Rejection reason is required');
    }
    
    const product = await prisma.product.update({
      where: { id: req.params.productId },
      data: {
        status: 'REJECTED',
        rejectionReason: reason,
      },
    });
    
    success(res, { product }, 'Product rejected');
  })
);

// =============================================================================
// DISPUTES
// =============================================================================

// Get disputes
router.get(
  '/disputes',
  authenticate,
  adminOnly,
  asyncHandler(async (req, res) => {
    const { page, limit, skip } = parsePagination(req.query);
    const { status } = req.query;
    
    const where = status ? { status } : {};
    
    const [disputes, total] = await Promise.all([
      prisma.dispute.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          order: {
            include: {
              buyer: { select: { id: true, businessName: true } },
              seller: { select: { id: true, businessName: true } },
            },
          },
          raisedBy: { select: { id: true, businessName: true } },
        },
      }),
      prisma.dispute.count({ where }),
    ]);
    
    paginated(res, disputes, { page, limit, total });
  })
);

// Get dispute details
router.get(
  '/disputes/:disputeId',
  authenticate,
  adminOnly,
  asyncHandler(async (req, res) => {
    const dispute = await prisma.dispute.findUnique({
      where: { id: req.params.disputeId },
      include: {
        order: {
          include: {
            items: { include: { product: true } },
            buyer: true,
            seller: true,
            payments: true,
          },
        },
        raisedBy: true,
        messages: {
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    
    if (!dispute) {
      throw new NotFoundError('Dispute');
    }
    
    success(res, { dispute });
  })
);

// Update dispute status
router.patch(
  '/disputes/:disputeId',
  authenticate,
  adminOnly,
  asyncHandler(async (req, res) => {
    const { status, resolution, refundAmount } = req.body;
    
    const dispute = await prisma.dispute.update({
      where: { id: req.params.disputeId },
      data: {
        status,
        resolution,
        refundAmount,
        resolvedAt: status === 'RESOLVED' ? new Date() : undefined,
        resolvedBy: status === 'RESOLVED' ? req.user.id : undefined,
      },
    });
    
    // TODO: Process refund if applicable
    // TODO: Send notifications
    
    success(res, { dispute }, 'Dispute updated');
  })
);

// Add admin message to dispute
router.post(
  '/disputes/:disputeId/message',
  authenticate,
  adminOnly,
  asyncHandler(async (req, res) => {
    const { content, attachments } = req.body;
    
    const message = await prisma.disputeMessage.create({
      data: {
        disputeId: req.params.disputeId,
        senderId: req.user.id,
        senderType: 'admin',
        content,
        attachments: attachments || [],
      },
    });
    
    success(res, { message }, 'Message added');
  })
);

// =============================================================================
// REPORTS
// =============================================================================

// Get sales report
router.get(
  '/reports/sales',
  authenticate,
  adminOnly,
  asyncHandler(async (req, res) => {
    const { startDate, endDate, groupBy = 'day' } = req.query;
    
    const start = startDate ? new Date(startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const end = endDate ? new Date(endDate) : new Date();
    
    const orders = await prisma.order.findMany({
      where: {
        createdAt: { gte: start, lte: end },
        status: { in: ['DELIVERED', 'COMPLETED'] },
      },
      select: {
        totalAmount: true,
        platformFee: true,
        createdAt: true,
      },
    });
    
    // Group data
    const report = {};
    orders.forEach((order) => {
      const key = groupBy === 'month' 
        ? `${order.createdAt.getFullYear()}-${String(order.createdAt.getMonth() + 1).padStart(2, '0')}`
        : order.createdAt.toISOString().split('T')[0];
      
      if (!report[key]) {
        report[key] = { date: key, orders: 0, revenue: 0, commission: 0 };
      }
      report[key].orders += 1;
      report[key].revenue += parseFloat(order.totalAmount);
      report[key].commission += parseFloat(order.platformFee || 0);
    });
    
    success(res, { report: Object.values(report).sort((a, b) => a.date.localeCompare(b.date)) });
  })
);

// Get category report
router.get(
  '/reports/categories',
  authenticate,
  adminOnly,
  asyncHandler(async (req, res) => {
    const categoryStats = await prisma.category.findMany({
      where: { isActive: true, parentId: null },
      select: {
        id: true,
        name: true,
        productCount: true,
        _count: {
          select: { children: true },
        },
      },
      orderBy: { productCount: 'desc' },
    });
    
    success(res, { categories: categoryStats });
  })
);

// =============================================================================
// SETTINGS
// =============================================================================

// Get platform settings
router.get(
  '/settings',
  authenticate,
  adminOnly,
  asyncHandler(async (req, res) => {
    const settings = await prisma.platformSettings.findFirst();
    success(res, { settings });
  })
);

// Update platform settings
router.patch(
  '/settings',
  authenticate,
  superAdminOnly,
  asyncHandler(async (req, res) => {
    const settings = await prisma.platformSettings.upsert({
      where: { id: 'default' },
      update: req.body,
      create: { id: 'default', ...req.body },
    });
    
    success(res, { settings }, 'Settings updated');
  })
);

module.exports = router;
