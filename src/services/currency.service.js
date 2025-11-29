// =============================================================================
// AIRAVAT B2B MARKETPLACE - CURRENCY SERVICE
// Multi-currency support for India (INR) and UAE (AED)
// =============================================================================

const axios = require('axios');
const { cache } = require('../config/redis');
const logger = require('../config/logger');
const config = require('../config');

class CurrencyService {
  constructor() {
    // Base currency
    this.baseCurrency = 'INR';
    
    // Supported currencies
    this.supportedCurrencies = ['INR', 'AED', 'USD', 'EUR', 'GBP', 'SAR', 'OMR', 'KWD', 'BHD', 'QAR'];
    
    // Currency metadata
    this.currencyInfo = {
      INR: { symbol: '₹', name: 'Indian Rupee', decimals: 2, locale: 'en-IN' },
      AED: { symbol: 'د.إ', name: 'UAE Dirham', decimals: 2, locale: 'ar-AE' },
      USD: { symbol: '$', name: 'US Dollar', decimals: 2, locale: 'en-US' },
      EUR: { symbol: '€', name: 'Euro', decimals: 2, locale: 'de-DE' },
      GBP: { symbol: '£', name: 'British Pound', decimals: 2, locale: 'en-GB' },
      SAR: { symbol: '﷼', name: 'Saudi Riyal', decimals: 2, locale: 'ar-SA' },
      OMR: { symbol: 'ر.ع.', name: 'Omani Rial', decimals: 3, locale: 'ar-OM' },
      KWD: { symbol: 'د.ك', name: 'Kuwaiti Dinar', decimals: 3, locale: 'ar-KW' },
      BHD: { symbol: '.د.ب', name: 'Bahraini Dinar', decimals: 3, locale: 'ar-BH' },
      QAR: { symbol: 'ر.ق', name: 'Qatari Riyal', decimals: 2, locale: 'ar-QA' },
    };
    
    // Fallback rates (update regularly in production)
    this.fallbackRates = {
      INR: 1,
      AED: 0.044, // 1 INR = 0.044 AED
      USD: 0.012, // 1 INR = 0.012 USD
      EUR: 0.011,
      GBP: 0.0095,
      SAR: 0.045,
      OMR: 0.0046,
      KWD: 0.0037,
      BHD: 0.0045,
      QAR: 0.044,
    };
    
    // Exchange rate API
    this.exchangeApi = axios.create({
      baseURL: config.currency?.apiUrl || 'https://api.exchangerate-api.com/v4',
      timeout: 10000,
    });
  }
  
  // =============================================================================
  // EXCHANGE RATES
  // =============================================================================
  
  /**
   * Get current exchange rates
   */
  async getExchangeRates(baseCurrency = 'INR') {
    const cacheKey = `exchange_rates:${baseCurrency}`;
    
    // Check cache (rates valid for 1 hour)
    const cached = await cache.get(cacheKey);
    if (cached) {
      return cached;
    }
    
    try {
      const response = await this.exchangeApi.get(`/latest/${baseCurrency}`);
      
      const rates = {
        base: baseCurrency,
        date: response.data.date,
        rates: {},
        updatedAt: new Date().toISOString(),
      };
      
      // Filter to supported currencies only
      for (const currency of this.supportedCurrencies) {
        if (response.data.rates[currency]) {
          rates.rates[currency] = response.data.rates[currency];
        }
      }
      
      // Cache for 1 hour
      await cache.set(cacheKey, rates, 3600);
      
      // Store in database for historical tracking
      await this.storeExchangeRates(rates);
      
      return rates;
      
    } catch (error) {
      logger.error('Failed to fetch exchange rates', { error: error.message });
      
      // Return fallback rates
      return {
        base: baseCurrency,
        rates: this.getRelativeRates(baseCurrency),
        isFallback: true,
      };
    }
  }
  
  /**
   * Get relative rates from fallback
   */
  getRelativeRates(baseCurrency) {
    const baseRate = this.fallbackRates[baseCurrency] || 1;
    const rates = {};
    
    for (const [currency, rate] of Object.entries(this.fallbackRates)) {
      rates[currency] = rate / baseRate;
    }
    
    return rates;
  }
  
  /**
   * Store exchange rates in database
   */
  async storeExchangeRates(rates) {
    try {
      const { prisma } = require('../config/database');
      
      await prisma.exchangeRate.create({
        data: {
          baseCurrency: rates.base,
          rates: rates.rates,
          source: 'API',
          fetchedAt: new Date(),
        },
      });
    } catch (error) {
      logger.error('Failed to store exchange rates', { error: error.message });
    }
  }
  
  // =============================================================================
  // CURRENCY CONVERSION
  // =============================================================================
  
  /**
   * Convert amount between currencies
   */
  async convert(amount, fromCurrency, toCurrency) {
    if (fromCurrency === toCurrency) {
      return {
        originalAmount: amount,
        convertedAmount: amount,
        fromCurrency,
        toCurrency,
        rate: 1,
      };
    }
    
    const rates = await this.getExchangeRates(fromCurrency);
    const rate = rates.rates[toCurrency];
    
    if (!rate) {
      throw new Error(`Unsupported currency: ${toCurrency}`);
    }
    
    const convertedAmount = this.roundToDecimals(amount * rate, toCurrency);
    
    return {
      originalAmount: amount,
      convertedAmount,
      fromCurrency,
      toCurrency,
      rate,
      rateDate: rates.date,
    };
  }
  
  /**
   * Convert to base currency (INR)
   */
  async convertToBase(amount, fromCurrency) {
    return this.convert(amount, fromCurrency, this.baseCurrency);
  }
  
  /**
   * Batch convert amounts
   */
  async batchConvert(items, toCurrency) {
    const results = [];
    const rates = await this.getExchangeRates('INR');
    
    for (const item of items) {
      const fromRate = rates.rates[item.currency] || 1;
      const toRate = rates.rates[toCurrency] || 1;
      const rate = toRate / fromRate;
      
      results.push({
        ...item,
        originalAmount: item.amount,
        convertedAmount: this.roundToDecimals(item.amount * rate, toCurrency),
        convertedCurrency: toCurrency,
        rate,
      });
    }
    
    return results;
  }
  
  // =============================================================================
  // FORMATTING
  // =============================================================================
  
  /**
   * Format amount with currency symbol
   */
  formatAmount(amount, currency, options = {}) {
    const info = this.currencyInfo[currency] || this.currencyInfo.INR;
    const { showSymbol = true, showCode = false, locale = info.locale } = options;
    
    const formatted = new Intl.NumberFormat(locale, {
      style: showSymbol ? 'currency' : 'decimal',
      currency: showSymbol ? currency : undefined,
      minimumFractionDigits: info.decimals,
      maximumFractionDigits: info.decimals,
    }).format(amount);
    
    if (showCode && !showSymbol) {
      return `${formatted} ${currency}`;
    }
    
    return formatted;
  }
  
  /**
   * Format for Indian numbering system (lakhs, crores)
   */
  formatIndian(amount, showSymbol = true) {
    const formatted = new Intl.NumberFormat('en-IN', {
      maximumFractionDigits: 2,
    }).format(amount);
    
    return showSymbol ? `₹${formatted}` : formatted;
  }
  
  /**
   * Format for Arabic/UAE numbering
   */
  formatArabic(amount, currency = 'AED', showSymbol = true) {
    const info = this.currencyInfo[currency];
    
    const formatted = new Intl.NumberFormat('ar-AE', {
      style: showSymbol ? 'currency' : 'decimal',
      currency: showSymbol ? currency : undefined,
      minimumFractionDigits: info?.decimals || 2,
      maximumFractionDigits: info?.decimals || 2,
    }).format(amount);
    
    return formatted;
  }
  
  /**
   * Get human-readable amount (K, L, Cr, M, B)
   */
  humanReadable(amount, currency = 'INR') {
    const isIndian = currency === 'INR';
    
    if (isIndian) {
      // Indian system: Lakhs, Crores
      if (amount >= 10000000) {
        return `₹${(amount / 10000000).toFixed(2)} Cr`;
      }
      if (amount >= 100000) {
        return `₹${(amount / 100000).toFixed(2)} L`;
      }
      if (amount >= 1000) {
        return `₹${(amount / 1000).toFixed(2)} K`;
      }
      return `₹${amount.toFixed(2)}`;
    } else {
      // International system: K, M, B
      const symbol = this.currencyInfo[currency]?.symbol || currency;
      
      if (amount >= 1000000000) {
        return `${symbol}${(amount / 1000000000).toFixed(2)}B`;
      }
      if (amount >= 1000000) {
        return `${symbol}${(amount / 1000000).toFixed(2)}M`;
      }
      if (amount >= 1000) {
        return `${symbol}${(amount / 1000).toFixed(2)}K`;
      }
      return `${symbol}${amount.toFixed(2)}`;
    }
  }
  
  // =============================================================================
  // HELPERS
  // =============================================================================
  
  /**
   * Round to appropriate decimal places for currency
   */
  roundToDecimals(amount, currency) {
    const decimals = this.currencyInfo[currency]?.decimals || 2;
    const factor = Math.pow(10, decimals);
    return Math.round(amount * factor) / factor;
  }
  
  /**
   * Check if currency is supported
   */
  isSupported(currency) {
    return this.supportedCurrencies.includes(currency);
  }
  
  /**
   * Get currency info
   */
  getCurrencyInfo(currency) {
    return this.currencyInfo[currency] || null;
  }
  
  /**
   * Get all supported currencies with info
   */
  getAllCurrencies() {
    return this.supportedCurrencies.map((code) => ({
      code,
      ...this.currencyInfo[code],
    }));
  }
  
  /**
   * Detect currency from country code
   */
  getCurrencyFromCountry(countryCode) {
    const countryToCurrency = {
      IN: 'INR',
      AE: 'AED',
      US: 'USD',
      GB: 'GBP',
      SA: 'SAR',
      OM: 'OMR',
      KW: 'KWD',
      BH: 'BHD',
      QA: 'QAR',
      // Add more as needed
    };
    
    return countryToCurrency[countryCode] || 'USD';
  }
  
  /**
   * Parse amount from string (handles different formats)
   */
  parseAmount(amountString, currency = 'INR') {
    if (typeof amountString === 'number') {
      return amountString;
    }
    
    // Remove currency symbols and spaces
    let cleaned = amountString
      .replace(/[₹$€£د.إ﷼ر.ع.د.ك.د.بر.ق]/g, '')
      .replace(/\s/g, '')
      .trim();
    
    // Handle Indian format (1,00,000)
    if (currency === 'INR' && cleaned.match(/^\d{1,2}(,\d{2})*(,\d{3})?(\.\d+)?$/)) {
      cleaned = cleaned.replace(/,/g, '');
    }
    // Handle international format (1,000,000)
    else if (cleaned.match(/^\d{1,3}(,\d{3})*(\.\d+)?$/)) {
      cleaned = cleaned.replace(/,/g, '');
    }
    // Handle European format (1.000.000,00)
    else if (cleaned.match(/^\d{1,3}(\.\d{3})*(,\d+)?$/)) {
      cleaned = cleaned.replace(/\./g, '').replace(',', '.');
    }
    
    return parseFloat(cleaned) || 0;
  }
  
  // =============================================================================
  // PRICE DISPLAY
  // =============================================================================
  
  /**
   * Get display price with original and converted
   */
  async getDisplayPrice(amount, originalCurrency, displayCurrency) {
    if (originalCurrency === displayCurrency) {
      return {
        amount,
        currency: displayCurrency,
        formatted: this.formatAmount(amount, displayCurrency),
      };
    }
    
    const converted = await this.convert(amount, originalCurrency, displayCurrency);
    
    return {
      amount: converted.convertedAmount,
      currency: displayCurrency,
      formatted: this.formatAmount(converted.convertedAmount, displayCurrency),
      original: {
        amount,
        currency: originalCurrency,
        formatted: this.formatAmount(amount, originalCurrency),
      },
      rate: converted.rate,
    };
  }
  
  /**
   * Format price range
   */
  formatPriceRange(minPrice, maxPrice, currency) {
    if (minPrice === maxPrice) {
      return this.formatAmount(minPrice, currency);
    }
    
    const symbol = this.currencyInfo[currency]?.symbol || currency;
    const min = this.formatAmount(minPrice, currency, { showSymbol: false });
    const max = this.formatAmount(maxPrice, currency, { showSymbol: false });
    
    return `${symbol}${min} - ${symbol}${max}`;
  }
}

module.exports = new CurrencyService();
