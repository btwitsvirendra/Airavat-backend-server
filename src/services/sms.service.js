// =============================================================================
// AIRAVAT B2B MARKETPLACE - SMS SERVICE
// SMS sending for OTP and notifications using MSG91
// =============================================================================

const axios = require('axios');
const config = require('../config');
const logger = require('../config/logger');

const MSG91_API_URL = 'https://control.msg91.com/api/v5';

/**
 * Send OTP via MSG91
 */
const sendOTP = async (phone, otp) => {
  try {
    // Format phone number (ensure 10 digits without country code)
    const formattedPhone = phone.replace(/^\+91|^91|^0/, '').trim();

    if (!config.sms.msg91.authKey) {
      logger.warn('MSG91 auth key not configured, skipping SMS');
      logger.info(`OTP for ${formattedPhone}: ${otp}`); // Log for dev
      return { success: true, mock: true };
    }

    const response = await axios.post(
      `${MSG91_API_URL}/otp`,
      {
        mobile: `91${formattedPhone}`,
        otp,
        template_id: config.sms.msg91.templateId,
        sender: config.sms.msg91.senderId,
      },
      {
        headers: {
          'authkey': config.sms.msg91.authKey,
          'Content-Type': 'application/json',
        },
      }
    );

    if (response.data.type === 'success') {
      logger.info(`OTP sent to ${formattedPhone}`);
      return { success: true };
    } else {
      throw new Error(response.data.message || 'Failed to send OTP');
    }
  } catch (error) {
    logger.error(`Failed to send OTP to ${phone}:`, error.message);
    // Don't throw - SMS failures shouldn't break the flow in development
    if (config.app.isProd) {
      throw error;
    }
    return { success: false, error: error.message };
  }
};

/**
 * Send transactional SMS
 */
const sendSMS = async (phone, message, templateId) => {
  try {
    const formattedPhone = phone.replace(/^\+91|^91|^0/, '').trim();

    if (!config.sms.msg91.authKey) {
      logger.warn('MSG91 auth key not configured, skipping SMS');
      logger.info(`SMS to ${formattedPhone}: ${message}`);
      return { success: true, mock: true };
    }

    const response = await axios.post(
      `${MSG91_API_URL}/flow`,
      {
        flow_id: templateId,
        sender: config.sms.msg91.senderId,
        mobiles: `91${formattedPhone}`,
        VAR1: message,
      },
      {
        headers: {
          'authkey': config.sms.msg91.authKey,
          'Content-Type': 'application/json',
        },
      }
    );

    if (response.data.type === 'success') {
      logger.info(`SMS sent to ${formattedPhone}`);
      return { success: true };
    } else {
      throw new Error(response.data.message || 'Failed to send SMS');
    }
  } catch (error) {
    logger.error(`Failed to send SMS to ${phone}:`, error.message);
    if (config.app.isProd) {
      throw error;
    }
    return { success: false, error: error.message };
  }
};

/**
 * Send order status SMS
 */
const sendOrderStatusSMS = async (phone, orderNumber, status) => {
  const messages = {
    CONFIRMED: `Your order #${orderNumber} has been confirmed by the seller.`,
    SHIPPED: `Your order #${orderNumber} has been shipped!`,
    DELIVERED: `Your order #${orderNumber} has been delivered.`,
    CANCELLED: `Your order #${orderNumber} has been cancelled.`,
  };

  const message = messages[status];
  if (message) {
    return sendSMS(phone, message, config.sms.msg91.templateId);
  }
};

/**
 * Send new inquiry notification SMS to seller
 */
const sendInquiryNotificationSMS = async (phone, productName, buyerName) => {
  const message = `New inquiry for "${productName}" from ${buyerName}. Check Airavat app.`;
  return sendSMS(phone, message, config.sms.msg91.templateId);
};

/**
 * Send quotation notification SMS
 */
const sendQuotationNotificationSMS = async (phone, sellerName, rfqTitle) => {
  const message = `${sellerName} sent a quotation for "${rfqTitle}". Check Airavat app.`;
  return sendSMS(phone, message, config.sms.msg91.templateId);
};

module.exports = {
  sendOTP,
  sendSMS,
  sendOrderStatusSMS,
  sendInquiryNotificationSMS,
  sendQuotationNotificationSMS,
};
