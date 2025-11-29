// =============================================================================
// AIRAVAT B2B MARKETPLACE - EMAIL TEMPLATES
// Responsive HTML email templates for all transactional emails
// =============================================================================

const config = require('../config');

class EmailTemplates {
  constructor() {
    this.baseUrl = config.app.frontendUrl || 'https://airavat.com';
    this.logoUrl = `${this.baseUrl}/images/logo.png`;
    this.supportEmail = 'support@airavat.com';
  }

  // ===========================================================================
  // BASE TEMPLATE WRAPPER
  // ===========================================================================

  baseTemplate(content, options = {}) {
    const { preheader = '', showFooter = true } = options;

    return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>Airavat B2B Marketplace</title>
  <style>
    body { margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f4f4f7; }
    .container { max-width: 600px; margin: 0 auto; background-color: #ffffff; }
    .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; text-align: center; }
    .header img { max-width: 150px; height: auto; }
    .header h1 { color: #ffffff; margin: 15px 0 0 0; font-size: 24px; }
    .content { padding: 40px 30px; }
    .footer { background-color: #f4f4f7; padding: 30px; text-align: center; font-size: 12px; color: #6b7280; }
    .btn { display: inline-block; padding: 14px 30px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: #ffffff !important; text-decoration: none; border-radius: 6px; font-weight: 600; margin: 20px 0; }
    .btn:hover { opacity: 0.9; }
    .order-table { width: 100%; border-collapse: collapse; margin: 20px 0; }
    .order-table th { background-color: #f9fafb; padding: 12px; text-align: left; border-bottom: 2px solid #e5e7eb; }
    .order-table td { padding: 12px; border-bottom: 1px solid #e5e7eb; }
    .highlight-box { background-color: #f0fdf4; border-left: 4px solid #22c55e; padding: 15px; margin: 20px 0; }
    .warning-box { background-color: #fef3c7; border-left: 4px solid #f59e0b; padding: 15px; margin: 20px 0; }
    .info-box { background-color: #eff6ff; border-left: 4px solid #3b82f6; padding: 15px; margin: 20px 0; }
    .preheader { display: none; max-width: 0; max-height: 0; overflow: hidden; font-size: 1px; line-height: 1px; color: #ffffff; opacity: 0; }
    h2 { color: #1f2937; margin-top: 0; }
    p { color: #4b5563; line-height: 1.6; }
    .divider { border-top: 1px solid #e5e7eb; margin: 30px 0; }
    .social-links a { display: inline-block; margin: 0 10px; }
    .social-links img { width: 24px; height: 24px; }
    @media only screen and (max-width: 600px) {
      .container { width: 100% !important; }
      .content { padding: 20px !important; }
    }
  </style>
</head>
<body>
  <div class="preheader">${preheader}</div>
  
  <div class="container">
    <div class="header">
      <img src="${this.logoUrl}" alt="Airavat" />
      <h1>Airavat B2B</h1>
    </div>
    
    <div class="content">
      ${content}
    </div>
    
    ${showFooter ? this.footerTemplate() : ''}
  </div>
</body>
</html>`;
  }

  footerTemplate() {
    return `
    <div class="footer">
      <p style="margin-bottom: 15px;">
        <a href="${this.baseUrl}" style="color: #667eea; text-decoration: none;">Website</a> •
        <a href="${this.baseUrl}/help" style="color: #667eea; text-decoration: none;">Help Center</a> •
        <a href="${this.baseUrl}/contact" style="color: #667eea; text-decoration: none;">Contact Us</a>
      </p>
      <p>
        © ${new Date().getFullYear()} Airavat B2B Marketplace. All rights reserved.<br>
        You're receiving this email because you have an account with us.
      </p>
      <p style="margin-top: 15px;">
        <a href="${this.baseUrl}/unsubscribe" style="color: #9ca3af; text-decoration: none;">Unsubscribe</a> •
        <a href="${this.baseUrl}/privacy" style="color: #9ca3af; text-decoration: none;">Privacy Policy</a>
      </p>
    </div>`;
  }

  // ===========================================================================
  // AUTHENTICATION TEMPLATES
  // ===========================================================================

  welcome(data) {
    const { name, email } = data;
    
    const content = `
      <h2>Welcome to Airavat B2B Marketplace! 🎉</h2>
      <p>Hi ${name},</p>
      <p>Thank you for joining Airavat, India and UAE's leading B2B marketplace. We're excited to have you on board!</p>
      
      <div class="highlight-box">
        <strong>Your account is ready!</strong><br>
        Email: ${email}
      </div>
      
      <p>Here's what you can do next:</p>
      <ul style="color: #4b5563; line-height: 2;">
        <li>Complete your business profile</li>
        <li>Browse thousands of products from verified sellers</li>
        <li>Submit RFQs for bulk orders</li>
        <li>Start selling your products</li>
      </ul>
      
      <p style="text-align: center;">
        <a href="${this.baseUrl}/dashboard" class="btn">Get Started</a>
      </p>
      
      <div class="divider"></div>
      
      <p>Need help? Our support team is here for you 24/7 at <a href="mailto:${this.supportEmail}">${this.supportEmail}</a></p>
    `;

    return this.baseTemplate(content, { preheader: `Welcome to Airavat, ${name}! Start your B2B journey today.` });
  }

  verifyEmail(data) {
    const { name, verificationUrl, expiresIn = '24 hours' } = data;

    const content = `
      <h2>Verify Your Email Address</h2>
      <p>Hi ${name},</p>
      <p>Please verify your email address to complete your registration and access all features.</p>
      
      <p style="text-align: center;">
        <a href="${verificationUrl}" class="btn">Verify Email Address</a>
      </p>
      
      <div class="warning-box">
        <strong>⏰ This link expires in ${expiresIn}</strong><br>
        If you didn't create an account, you can safely ignore this email.
      </div>
      
      <p style="font-size: 12px; color: #6b7280;">
        Or copy and paste this link in your browser:<br>
        <a href="${verificationUrl}" style="word-break: break-all;">${verificationUrl}</a>
      </p>
    `;

    return this.baseTemplate(content, { preheader: 'Please verify your email to complete registration.' });
  }

  resetPassword(data) {
    const { name, resetUrl, expiresIn = '1 hour' } = data;

    const content = `
      <h2>Reset Your Password</h2>
      <p>Hi ${name},</p>
      <p>We received a request to reset your password. Click the button below to create a new password.</p>
      
      <p style="text-align: center;">
        <a href="${resetUrl}" class="btn">Reset Password</a>
      </p>
      
      <div class="warning-box">
        <strong>⏰ This link expires in ${expiresIn}</strong><br>
        If you didn't request a password reset, please ignore this email or contact support if you have concerns.
      </div>
      
      <p style="font-size: 12px; color: #6b7280;">
        For security reasons, never share this link with anyone.
      </p>
    `;

    return this.baseTemplate(content, { preheader: 'Password reset requested for your Airavat account.' });
  }

  // ===========================================================================
  // ORDER TEMPLATES
  // ===========================================================================

  orderConfirmation(data) {
    const { orderNumber, buyerName, items, subtotal, tax, shipping, total, currency, shippingAddress, estimatedDelivery } = data;

    const itemRows = items.map(item => `
      <tr>
        <td style="padding: 12px; border-bottom: 1px solid #e5e7eb;">
          <strong>${item.name}</strong><br>
          <span style="color: #6b7280; font-size: 12px;">SKU: ${item.sku}</span>
        </td>
        <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; text-align: center;">${item.quantity}</td>
        <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; text-align: right;">${this.formatCurrency(item.price, currency)}</td>
      </tr>
    `).join('');

    const content = `
      <h2>Order Confirmed! ✅</h2>
      <p>Hi ${buyerName},</p>
      <p>Great news! Your order has been confirmed and is being processed.</p>
      
      <div class="highlight-box">
        <strong>Order Number: #${orderNumber}</strong><br>
        Estimated Delivery: ${estimatedDelivery || 'Within 5-7 business days'}
      </div>
      
      <h3 style="margin-top: 30px;">Order Summary</h3>
      <table class="order-table">
        <thead>
          <tr>
            <th>Item</th>
            <th style="text-align: center;">Qty</th>
            <th style="text-align: right;">Price</th>
          </tr>
        </thead>
        <tbody>
          ${itemRows}
        </tbody>
        <tfoot>
          <tr>
            <td colspan="2" style="text-align: right; padding: 12px;"><strong>Subtotal:</strong></td>
            <td style="text-align: right; padding: 12px;">${this.formatCurrency(subtotal, currency)}</td>
          </tr>
          <tr>
            <td colspan="2" style="text-align: right; padding: 12px;"><strong>Tax (GST/VAT):</strong></td>
            <td style="text-align: right; padding: 12px;">${this.formatCurrency(tax, currency)}</td>
          </tr>
          <tr>
            <td colspan="2" style="text-align: right; padding: 12px;"><strong>Shipping:</strong></td>
            <td style="text-align: right; padding: 12px;">${shipping > 0 ? this.formatCurrency(shipping, currency) : 'FREE'}</td>
          </tr>
          <tr style="background-color: #f9fafb;">
            <td colspan="2" style="text-align: right; padding: 12px;"><strong style="font-size: 16px;">Total:</strong></td>
            <td style="text-align: right; padding: 12px;"><strong style="font-size: 16px; color: #667eea;">${this.formatCurrency(total, currency)}</strong></td>
          </tr>
        </tfoot>
      </table>
      
      <h3>Shipping Address</h3>
      <div class="info-box">
        ${shippingAddress.name}<br>
        ${shippingAddress.line1}<br>
        ${shippingAddress.line2 ? shippingAddress.line2 + '<br>' : ''}
        ${shippingAddress.city}, ${shippingAddress.state} - ${shippingAddress.pincode}<br>
        Phone: ${shippingAddress.phone}
      </div>
      
      <p style="text-align: center;">
        <a href="${this.baseUrl}/orders/${orderNumber}" class="btn">Track Your Order</a>
      </p>
    `;

    return this.baseTemplate(content, { preheader: `Order #${orderNumber} confirmed! Track your delivery.` });
  }

  orderShipped(data) {
    const { orderNumber, buyerName, trackingNumber, courierName, trackingUrl, items, estimatedDelivery } = data;

    const content = `
      <h2>Your Order is on the Way! 🚚</h2>
      <p>Hi ${buyerName},</p>
      <p>Great news! Your order #${orderNumber} has been shipped and is on its way to you.</p>
      
      <div class="highlight-box">
        <strong>Tracking Information</strong><br>
        Courier: ${courierName}<br>
        Tracking Number: ${trackingNumber}<br>
        Estimated Delivery: ${estimatedDelivery}
      </div>
      
      <p style="text-align: center;">
        <a href="${trackingUrl}" class="btn">Track Shipment</a>
      </p>
      
      <h3>Items Shipped</h3>
      <ul>
        ${items.map(item => `<li>${item.name} (Qty: ${item.quantity})</li>`).join('')}
      </ul>
      
      <div class="info-box">
        <strong>Delivery Tips:</strong>
        <ul style="margin: 10px 0 0 0; padding-left: 20px;">
          <li>Keep your phone nearby for delivery updates</li>
          <li>Ensure someone is available to receive the package</li>
          <li>Check the package before signing for delivery</li>
        </ul>
      </div>
    `;

    return this.baseTemplate(content, { preheader: `Your order #${orderNumber} is on its way! Track: ${trackingNumber}` });
  }

  orderDelivered(data) {
    const { orderNumber, buyerName, deliveredAt, reviewUrl } = data;

    const content = `
      <h2>Order Delivered! 📦</h2>
      <p>Hi ${buyerName},</p>
      <p>Your order #${orderNumber} has been delivered on ${deliveredAt}. We hope you love your purchase!</p>
      
      <div class="highlight-box">
        <strong>✅ Delivery Confirmed</strong><br>
        Order #${orderNumber} was delivered successfully.
      </div>
      
      <h3>Share Your Experience</h3>
      <p>Your feedback helps other buyers and sellers improve. Would you mind taking a moment to review your purchase?</p>
      
      <p style="text-align: center;">
        <a href="${reviewUrl}" class="btn">Write a Review</a>
      </p>
      
      <div class="divider"></div>
      
      <p>Having issues with your order? <a href="${this.baseUrl}/help/returns">Learn about returns and refunds</a></p>
    `;

    return this.baseTemplate(content, { preheader: `Your order #${orderNumber} has been delivered! Share your review.` });
  }

  // ===========================================================================
  // SELLER TEMPLATES
  // ===========================================================================

  newOrderReceived(data) {
    const { sellerName, orderNumber, buyerName, items, total, currency } = data;

    const content = `
      <h2>New Order Received! 🎉</h2>
      <p>Hi ${sellerName},</p>
      <p>You have received a new order from <strong>${buyerName}</strong>.</p>
      
      <div class="highlight-box">
        <strong>Order #${orderNumber}</strong><br>
        Total Amount: ${this.formatCurrency(total, currency)}
      </div>
      
      <h3>Order Items</h3>
      <table class="order-table">
        <thead>
          <tr>
            <th>Product</th>
            <th style="text-align: center;">Qty</th>
            <th style="text-align: right;">Amount</th>
          </tr>
        </thead>
        <tbody>
          ${items.map(item => `
            <tr>
              <td>${item.name}</td>
              <td style="text-align: center;">${item.quantity}</td>
              <td style="text-align: right;">${this.formatCurrency(item.price * item.quantity, currency)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
      
      <div class="warning-box">
        <strong>⚡ Action Required</strong><br>
        Please confirm this order within 24 hours to avoid automatic cancellation.
      </div>
      
      <p style="text-align: center;">
        <a href="${this.baseUrl}/seller/orders/${orderNumber}" class="btn">View & Confirm Order</a>
      </p>
    `;

    return this.baseTemplate(content, { preheader: `New order #${orderNumber} from ${buyerName}. Action required!` });
  }

  businessVerified(data) {
    const { businessName, ownerName } = data;

    const content = `
      <h2>Congratulations! Your Business is Verified ✅</h2>
      <p>Hi ${ownerName},</p>
      <p>Great news! <strong>${businessName}</strong> has been verified on Airavat B2B Marketplace.</p>
      
      <div class="highlight-box">
        <strong>Verification Complete!</strong><br>
        Your business is now a verified seller on Airavat.
      </div>
      
      <h3>What This Means for You</h3>
      <ul style="color: #4b5563; line-height: 2;">
        <li>✅ Verified badge displayed on your profile</li>
        <li>✅ Higher visibility in search results</li>
        <li>✅ Increased trust from buyers</li>
        <li>✅ Access to premium features</li>
        <li>✅ Priority customer support</li>
      </ul>
      
      <p style="text-align: center;">
        <a href="${this.baseUrl}/seller/dashboard" class="btn">Go to Dashboard</a>
      </p>
    `;

    return this.baseTemplate(content, { preheader: `${businessName} is now a verified seller on Airavat!` });
  }

  lowStockAlert(data) {
    const { sellerName, products } = data;

    const productRows = products.map(p => `
      <tr>
        <td style="padding: 12px; border-bottom: 1px solid #e5e7eb;">${p.name}</td>
        <td style="padding: 12px; border-bottom: 1px solid #e5e7eb;">${p.sku}</td>
        <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; text-align: center; color: ${p.stock === 0 ? '#dc2626' : '#f59e0b'};">
          <strong>${p.stock}</strong>
        </td>
        <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; text-align: center;">${p.threshold}</td>
      </tr>
    `).join('');

    const content = `
      <h2>⚠️ Low Stock Alert</h2>
      <p>Hi ${sellerName},</p>
      <p>The following products are running low on stock and may need to be replenished:</p>
      
      <table class="order-table">
        <thead>
          <tr>
            <th>Product</th>
            <th>SKU</th>
            <th style="text-align: center;">Current Stock</th>
            <th style="text-align: center;">Threshold</th>
          </tr>
        </thead>
        <tbody>
          ${productRows}
        </tbody>
      </table>
      
      <div class="warning-box">
        <strong>Don't Miss Sales!</strong><br>
        Update your inventory now to avoid going out of stock and missing potential orders.
      </div>
      
      <p style="text-align: center;">
        <a href="${this.baseUrl}/seller/inventory" class="btn">Update Inventory</a>
      </p>
    `;

    return this.baseTemplate(content, { preheader: `Low stock alert: ${products.length} products need attention.` });
  }

  // ===========================================================================
  // HELPER METHODS
  // ===========================================================================

  formatCurrency(amount, currency = 'INR') {
    const symbols = { INR: '₹', AED: 'د.إ', USD: '$' };
    const symbol = symbols[currency] || currency;
    return `${symbol}${Number(amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
  }
}

module.exports = new EmailTemplates();
