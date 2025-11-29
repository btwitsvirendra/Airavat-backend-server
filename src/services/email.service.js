// =============================================================================
// AIRAVAT B2B MARKETPLACE - EMAIL SERVICE
// Transactional email sending with templates
// =============================================================================

const nodemailer = require('nodemailer');
const handlebars = require('handlebars');
const config = require('../config');
const logger = require('../config/logger');

// Create transporter
let transporter = null;

const getTransporter = () => {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.email.host,
      port: config.email.port,
      secure: config.email.port === 465,
      auth: {
        user: config.email.user,
        pass: config.email.pass,
      },
    });
  }
  return transporter;
};

// =============================================================================
// EMAIL TEMPLATES
// =============================================================================

const templates = {
  verification: `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; text-align: center;">
        <h1 style="color: white; margin: 0;">Airavat</h1>
        <p style="color: rgba(255,255,255,0.9); margin: 10px 0 0;">B2B Marketplace</p>
      </div>
      <div style="padding: 30px; background: #ffffff;">
        <h2 style="color: #333;">Verify Your Email</h2>
        <p style="color: #666;">Hello {{name}},</p>
        <p style="color: #666;">Your verification code is:</p>
        <div style="background: #f5f5f5; padding: 20px; text-align: center; margin: 20px 0; border-radius: 8px;">
          <span style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #333;">{{otp}}</span>
        </div>
        <p style="color: #666;">This code expires in 10 minutes.</p>
        <p style="color: #999; font-size: 12px;">If you didn't request this, please ignore this email.</p>
      </div>
      <div style="padding: 20px; background: #f9f9f9; text-align: center;">
        <p style="color: #999; font-size: 12px; margin: 0;">© {{year}} Airavat. All rights reserved.</p>
      </div>
    </div>
  `,

  passwordReset: `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; text-align: center;">
        <h1 style="color: white; margin: 0;">Airavat</h1>
      </div>
      <div style="padding: 30px; background: #ffffff;">
        <h2 style="color: #333;">Reset Your Password</h2>
        <p style="color: #666;">Hello {{name}},</p>
        <p style="color: #666;">You requested to reset your password. Click the button below:</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="{{resetUrl}}" style="background: #667eea; color: white; padding: 15px 30px; text-decoration: none; border-radius: 5px; display: inline-block;">Reset Password</a>
        </div>
        <p style="color: #666;">This link expires in 1 hour.</p>
        <p style="color: #999; font-size: 12px;">If you didn't request this, please ignore this email.</p>
      </div>
    </div>
  `,

  welcome: `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; text-align: center;">
        <h1 style="color: white; margin: 0;">Welcome to Airavat!</h1>
      </div>
      <div style="padding: 30px; background: #ffffff;">
        <h2 style="color: #333;">Hello {{name}},</h2>
        <p style="color: #666;">Thank you for joining Airavat - India's Premier B2B Marketplace!</p>
        <p style="color: #666;">Here's what you can do next:</p>
        <ul style="color: #666;">
          <li>Complete your business profile</li>
          <li>Get your business verified</li>
          <li>Start listing products or sourcing</li>
        </ul>
        <div style="text-align: center; margin: 30px 0;">
          <a href="{{dashboardUrl}}" style="background: #667eea; color: white; padding: 15px 30px; text-decoration: none; border-radius: 5px; display: inline-block;">Go to Dashboard</a>
        </div>
      </div>
    </div>
  `,

  orderConfirmation: `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; text-align: center;">
        <h1 style="color: white; margin: 0;">Order Confirmed!</h1>
      </div>
      <div style="padding: 30px; background: #ffffff;">
        <h2 style="color: #333;">Order #{{orderNumber}}</h2>
        <p style="color: #666;">Hello {{name}},</p>
        <p style="color: #666;">Your order has been confirmed. Here are the details:</p>
        
        <div style="background: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <p style="margin: 5px 0;"><strong>Order Total:</strong> ₹{{totalAmount}}</p>
          <p style="margin: 5px 0;"><strong>Seller:</strong> {{sellerName}}</p>
          <p style="margin: 5px 0;"><strong>Items:</strong> {{itemCount}} items</p>
        </div>
        
        <div style="text-align: center; margin: 30px 0;">
          <a href="{{orderUrl}}" style="background: #667eea; color: white; padding: 15px 30px; text-decoration: none; border-radius: 5px; display: inline-block;">View Order</a>
        </div>
      </div>
    </div>
  `,

  newQuotation: `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; text-align: center;">
        <h1 style="color: white; margin: 0;">New Quotation Received!</h1>
      </div>
      <div style="padding: 30px; background: #ffffff;">
        <h2 style="color: #333;">RFQ: {{rfqTitle}}</h2>
        <p style="color: #666;">Hello {{name}},</p>
        <p style="color: #666;">You have received a new quotation from <strong>{{sellerName}}</strong>.</p>
        
        <div style="background: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <p style="margin: 5px 0;"><strong>Quoted Amount:</strong> ₹{{totalAmount}}</p>
          <p style="margin: 5px 0;"><strong>Valid Until:</strong> {{validUntil}}</p>
        </div>
        
        <div style="text-align: center; margin: 30px 0;">
          <a href="{{quotationUrl}}" style="background: #667eea; color: white; padding: 15px 30px; text-decoration: none; border-radius: 5px; display: inline-block;">View Quotation</a>
        </div>
      </div>
    </div>
  `,

  businessVerified: `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); padding: 30px; text-align: center;">
        <h1 style="color: white; margin: 0;">🎉 Business Verified!</h1>
      </div>
      <div style="padding: 30px; background: #ffffff;">
        <h2 style="color: #333;">Congratulations, {{name}}!</h2>
        <p style="color: #666;">Your business <strong>{{businessName}}</strong> has been verified.</p>
        <p style="color: #666;">You now have access to:</p>
        <ul style="color: #666;">
          <li>Full platform features</li>
          <li>Verified badge on your profile</li>
          <li>Higher trust score</li>
          <li>Priority in search results</li>
        </ul>
        <div style="text-align: center; margin: 30px 0;">
          <a href="{{dashboardUrl}}" style="background: #10b981; color: white; padding: 15px 30px; text-decoration: none; border-radius: 5px; display: inline-block;">Go to Dashboard</a>
        </div>
      </div>
    </div>
  `,
};

// Compile templates
const compiledTemplates = {};
Object.keys(templates).forEach((key) => {
  compiledTemplates[key] = handlebars.compile(templates[key]);
});

// =============================================================================
// EMAIL SENDING FUNCTIONS
// =============================================================================

/**
 * Send email
 */
const sendEmail = async (to, subject, html, text = null) => {
  try {
    const transport = getTransporter();
    
    const mailOptions = {
      from: config.email.from,
      to,
      subject,
      html,
      text: text || html.replace(/<[^>]*>/g, ''), // Strip HTML for text version
    };

    const result = await transport.sendMail(mailOptions);
    logger.info(`Email sent to ${to}: ${subject}`);
    return result;
  } catch (error) {
    logger.error(`Failed to send email to ${to}:`, error);
    // Don't throw - email failures shouldn't break the flow
    return null;
  }
};

/**
 * Send verification email
 */
const sendVerificationEmail = async (to, data) => {
  const html = compiledTemplates.verification({
    ...data,
    year: new Date().getFullYear(),
  });
  return sendEmail(to, 'Verify Your Email - Airavat', html);
};

/**
 * Send password reset email
 */
const sendPasswordResetEmail = async (to, data) => {
  const html = compiledTemplates.passwordReset(data);
  return sendEmail(to, 'Reset Your Password - Airavat', html);
};

/**
 * Send welcome email
 */
const sendWelcomeEmail = async (to, data) => {
  const html = compiledTemplates.welcome({
    ...data,
    dashboardUrl: `${config.app.frontendUrl}/dashboard`,
  });
  return sendEmail(to, 'Welcome to Airavat!', html);
};

/**
 * Send order confirmation email
 */
const sendOrderConfirmationEmail = async (to, data) => {
  const html = compiledTemplates.orderConfirmation({
    ...data,
    orderUrl: `${config.app.frontendUrl}/orders/${data.orderId}`,
  });
  return sendEmail(to, `Order Confirmed - #${data.orderNumber}`, html);
};

/**
 * Send new quotation email
 */
const sendNewQuotationEmail = async (to, data) => {
  const html = compiledTemplates.newQuotation({
    ...data,
    quotationUrl: `${config.app.frontendUrl}/quotations/${data.quotationId}`,
  });
  return sendEmail(to, `New Quotation for ${data.rfqTitle}`, html);
};

/**
 * Send business verified email
 */
const sendBusinessVerifiedEmail = async (to, data) => {
  const html = compiledTemplates.businessVerified({
    ...data,
    dashboardUrl: `${config.app.frontendUrl}/dashboard`,
  });
  return sendEmail(to, 'Your Business is Verified! 🎉', html);
};

/**
 * Send generic email with custom template
 */
const sendCustomEmail = async (to, subject, template, data) => {
  const compiled = handlebars.compile(template);
  const html = compiled(data);
  return sendEmail(to, subject, html);
};

module.exports = {
  sendEmail,
  sendVerificationEmail,
  sendPasswordResetEmail,
  sendWelcomeEmail,
  sendOrderConfirmationEmail,
  sendNewQuotationEmail,
  sendBusinessVerifiedEmail,
  sendCustomEmail,
};
