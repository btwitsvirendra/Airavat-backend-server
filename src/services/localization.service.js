// =============================================================================
// AIRAVAT B2B MARKETPLACE - LOCALIZATION SERVICE
// Multi-language support for Hindi, Tamil, and regional languages
// =============================================================================

const { prisma } = require('../config/database');
const logger = require('../config/logger');
const { BadRequestError, NotFoundError } = require('../utils/errors');

// =============================================================================
// CONFIGURATION
// =============================================================================

/**
 * Supported languages
 */
const SUPPORTED_LANGUAGES = {
  en: {
    code: 'en',
    name: 'English',
    nativeName: 'English',
    direction: 'ltr',
    default: true,
  },
  hi: {
    code: 'hi',
    name: 'Hindi',
    nativeName: 'हिन्दी',
    direction: 'ltr',
    default: false,
  },
  ta: {
    code: 'ta',
    name: 'Tamil',
    nativeName: 'தமிழ்',
    direction: 'ltr',
    default: false,
  },
  te: {
    code: 'te',
    name: 'Telugu',
    nativeName: 'తెలుగు',
    direction: 'ltr',
    default: false,
  },
  mr: {
    code: 'mr',
    name: 'Marathi',
    nativeName: 'मराठी',
    direction: 'ltr',
    default: false,
  },
  gu: {
    code: 'gu',
    name: 'Gujarati',
    nativeName: 'ગુજરાતી',
    direction: 'ltr',
    default: false,
  },
  bn: {
    code: 'bn',
    name: 'Bengali',
    nativeName: 'বাংলা',
    direction: 'ltr',
    default: false,
  },
  kn: {
    code: 'kn',
    name: 'Kannada',
    nativeName: 'ಕನ್ನಡ',
    direction: 'ltr',
    default: false,
  },
  ml: {
    code: 'ml',
    name: 'Malayalam',
    nativeName: 'മലയാളം',
    direction: 'ltr',
    default: false,
  },
  pa: {
    code: 'pa',
    name: 'Punjabi',
    nativeName: 'ਪੰਜਾਬੀ',
    direction: 'ltr',
    default: false,
  },
};

/**
 * Translation namespaces
 */
const NAMESPACES = {
  COMMON: 'common',
  AUTH: 'auth',
  PRODUCTS: 'products',
  ORDERS: 'orders',
  PAYMENTS: 'payments',
  MESSAGES: 'messages',
  NOTIFICATIONS: 'notifications',
  ERRORS: 'errors',
  CATEGORIES: 'categories',
};

/**
 * Default translations (English - source)
 */
const DEFAULT_TRANSLATIONS = {
  common: {
    welcome: 'Welcome',
    login: 'Login',
    register: 'Register',
    logout: 'Logout',
    search: 'Search',
    home: 'Home',
    products: 'Products',
    orders: 'Orders',
    cart: 'Cart',
    checkout: 'Checkout',
    profile: 'Profile',
    settings: 'Settings',
    help: 'Help',
    contact: 'Contact Us',
    about: 'About Us',
    terms: 'Terms & Conditions',
    privacy: 'Privacy Policy',
    save: 'Save',
    cancel: 'Cancel',
    delete: 'Delete',
    edit: 'Edit',
    view: 'View',
    submit: 'Submit',
    loading: 'Loading...',
    noResults: 'No results found',
    success: 'Success',
    error: 'Error',
    warning: 'Warning',
    info: 'Information',
  },
  auth: {
    loginTitle: 'Login to your account',
    registerTitle: 'Create an account',
    email: 'Email Address',
    password: 'Password',
    confirmPassword: 'Confirm Password',
    forgotPassword: 'Forgot Password?',
    resetPassword: 'Reset Password',
    rememberMe: 'Remember Me',
    orLoginWith: 'Or login with',
    noAccount: "Don't have an account?",
    hasAccount: 'Already have an account?',
    invalidCredentials: 'Invalid email or password',
    accountCreated: 'Account created successfully',
    passwordReset: 'Password reset link sent',
  },
  products: {
    addToCart: 'Add to Cart',
    buyNow: 'Buy Now',
    outOfStock: 'Out of Stock',
    inStock: 'In Stock',
    price: 'Price',
    quantity: 'Quantity',
    description: 'Description',
    specifications: 'Specifications',
    reviews: 'Reviews',
    relatedProducts: 'Related Products',
    moq: 'Minimum Order Quantity',
    requestQuote: 'Request Quote',
    sendInquiry: 'Send Inquiry',
    addToWishlist: 'Add to Wishlist',
    compareProducts: 'Compare Products',
  },
  orders: {
    orderPlaced: 'Order Placed Successfully',
    orderNumber: 'Order Number',
    orderStatus: 'Order Status',
    orderDate: 'Order Date',
    deliveryDate: 'Expected Delivery',
    trackOrder: 'Track Order',
    cancelOrder: 'Cancel Order',
    reorder: 'Reorder',
    orderDetails: 'Order Details',
    shippingAddress: 'Shipping Address',
    billingAddress: 'Billing Address',
    paymentMethod: 'Payment Method',
    orderTotal: 'Order Total',
    subtotal: 'Subtotal',
    shipping: 'Shipping',
    tax: 'Tax',
    discount: 'Discount',
  },
  payments: {
    payNow: 'Pay Now',
    paymentSuccess: 'Payment Successful',
    paymentFailed: 'Payment Failed',
    paymentPending: 'Payment Pending',
    selectPaymentMethod: 'Select Payment Method',
    cardNumber: 'Card Number',
    expiryDate: 'Expiry Date',
    cvv: 'CVV',
    upi: 'UPI',
    netBanking: 'Net Banking',
    wallet: 'Wallet',
    cod: 'Cash on Delivery',
    securePayment: 'Secure Payment',
  },
  notifications: {
    orderConfirmed: 'Your order has been confirmed',
    orderShipped: 'Your order has been shipped',
    orderDelivered: 'Your order has been delivered',
    paymentReceived: 'Payment received',
    priceDropAlert: 'Price drop alert',
    newMessage: 'You have a new message',
    rfqReceived: 'New RFQ received',
    quotationReceived: 'New quotation received',
  },
  errors: {
    somethingWentWrong: 'Something went wrong',
    pageNotFound: 'Page not found',
    unauthorized: 'Unauthorized access',
    sessionExpired: 'Your session has expired',
    networkError: 'Network error. Please try again.',
    validationError: 'Please check your input',
    serverError: 'Server error. Please try again later.',
  },
};

/**
 * Hindi translations
 */
const HINDI_TRANSLATIONS = {
  common: {
    welcome: 'स्वागत है',
    login: 'लॉग इन',
    register: 'रजिस्टर करें',
    logout: 'लॉग आउट',
    search: 'खोजें',
    home: 'होम',
    products: 'उत्पाद',
    orders: 'ऑर्डर',
    cart: 'कार्ट',
    checkout: 'चेकआउट',
    profile: 'प्रोफाइल',
    settings: 'सेटिंग्स',
    help: 'सहायता',
    contact: 'संपर्क करें',
    about: 'हमारे बारे में',
    terms: 'नियम और शर्तें',
    privacy: 'गोपनीयता नीति',
    save: 'सहेजें',
    cancel: 'रद्द करें',
    delete: 'हटाएं',
    edit: 'संपादित करें',
    view: 'देखें',
    submit: 'जमा करें',
    loading: 'लोड हो रहा है...',
    noResults: 'कोई परिणाम नहीं मिला',
    success: 'सफलता',
    error: 'त्रुटि',
    warning: 'चेतावनी',
    info: 'जानकारी',
  },
  auth: {
    loginTitle: 'अपने खाते में लॉगिन करें',
    registerTitle: 'खाता बनाएं',
    email: 'ईमेल पता',
    password: 'पासवर्ड',
    confirmPassword: 'पासवर्ड की पुष्टि करें',
    forgotPassword: 'पासवर्ड भूल गए?',
    resetPassword: 'पासवर्ड रीसेट करें',
    rememberMe: 'मुझे याद रखें',
    orLoginWith: 'या इससे लॉगिन करें',
    noAccount: 'खाता नहीं है?',
    hasAccount: 'पहले से खाता है?',
    invalidCredentials: 'अमान्य ईमेल या पासवर्ड',
    accountCreated: 'खाता सफलतापूर्वक बनाया गया',
    passwordReset: 'पासवर्ड रीसेट लिंक भेजा गया',
  },
  products: {
    addToCart: 'कार्ट में डालें',
    buyNow: 'अभी खरीदें',
    outOfStock: 'स्टॉक में नहीं',
    inStock: 'स्टॉक में उपलब्ध',
    price: 'कीमत',
    quantity: 'मात्रा',
    description: 'विवरण',
    specifications: 'विशिष्टताएं',
    reviews: 'समीक्षाएं',
    relatedProducts: 'संबंधित उत्पाद',
    moq: 'न्यूनतम ऑर्डर मात्रा',
    requestQuote: 'कोटेशन मांगें',
    sendInquiry: 'पूछताछ भेजें',
    addToWishlist: 'विशलिस्ट में जोड़ें',
    compareProducts: 'उत्पादों की तुलना करें',
  },
  orders: {
    orderPlaced: 'ऑर्डर सफलतापूर्वक दिया गया',
    orderNumber: 'ऑर्डर नंबर',
    orderStatus: 'ऑर्डर स्थिति',
    orderDate: 'ऑर्डर की तारीख',
    deliveryDate: 'अनुमानित डिलीवरी',
    trackOrder: 'ऑर्डर ट्रैक करें',
    cancelOrder: 'ऑर्डर रद्द करें',
    reorder: 'फिर से ऑर्डर करें',
    orderDetails: 'ऑर्डर विवरण',
    shippingAddress: 'शिपिंग पता',
    billingAddress: 'बिलिंग पता',
    paymentMethod: 'भुगतान विधि',
    orderTotal: 'कुल राशि',
    subtotal: 'उप-योग',
    shipping: 'शिपिंग',
    tax: 'कर',
    discount: 'छूट',
  },
  payments: {
    payNow: 'अभी भुगतान करें',
    paymentSuccess: 'भुगतान सफल',
    paymentFailed: 'भुगतान विफल',
    paymentPending: 'भुगतान लंबित',
    selectPaymentMethod: 'भुगतान विधि चुनें',
    cardNumber: 'कार्ड नंबर',
    expiryDate: 'समाप्ति तिथि',
    cvv: 'सीवीवी',
    upi: 'यूपीआई',
    netBanking: 'नेट बैंकिंग',
    wallet: 'वॉलेट',
    cod: 'कैश ऑन डिलीवरी',
    securePayment: 'सुरक्षित भुगतान',
  },
  notifications: {
    orderConfirmed: 'आपका ऑर्डर कन्फर्म हो गया है',
    orderShipped: 'आपका ऑर्डर शिप हो गया है',
    orderDelivered: 'आपका ऑर्डर डिलीवर हो गया है',
    paymentReceived: 'भुगतान प्राप्त हुआ',
    priceDropAlert: 'कीमत में गिरावट की सूचना',
    newMessage: 'आपके पास एक नया संदेश है',
    rfqReceived: 'नई आरएफक्यू प्राप्त हुई',
    quotationReceived: 'नया कोटेशन प्राप्त हुआ',
  },
  errors: {
    somethingWentWrong: 'कुछ गलत हो गया',
    pageNotFound: 'पेज नहीं मिला',
    unauthorized: 'अनधिकृत पहुंच',
    sessionExpired: 'आपका सेशन समाप्त हो गया है',
    networkError: 'नेटवर्क त्रुटि। कृपया पुनः प्रयास करें।',
    validationError: 'कृपया अपनी जानकारी जांचें',
    serverError: 'सर्वर त्रुटि। कृपया बाद में पुनः प्रयास करें।',
  },
};

/**
 * Tamil translations
 */
const TAMIL_TRANSLATIONS = {
  common: {
    welcome: 'வரவேற்கிறோம்',
    login: 'உள்நுழை',
    register: 'பதிவு செய்யுங்கள்',
    logout: 'வெளியேறு',
    search: 'தேடல்',
    home: 'முகப்பு',
    products: 'பொருட்கள்',
    orders: 'ஆர்டர்கள்',
    cart: 'கார்ட்',
    checkout: 'செக்அவுட்',
    profile: 'சுயவிவரம்',
    settings: 'அமைப்புகள்',
    help: 'உதவி',
    contact: 'தொடர்பு கொள்ளுங்கள்',
    about: 'எங்களைப் பற்றி',
    terms: 'விதிமுறைகள்',
    privacy: 'தனியுரிமைக் கொள்கை',
    save: 'சேமி',
    cancel: 'ரத்து செய்',
    delete: 'நீக்கு',
    edit: 'திருத்து',
    view: 'பார்',
    submit: 'சமர்ப்பி',
    loading: 'ஏற்றுகிறது...',
    noResults: 'முடிவுகள் இல்லை',
    success: 'வெற்றி',
    error: 'பிழை',
    warning: 'எச்சரிக்கை',
    info: 'தகவல்',
  },
  products: {
    addToCart: 'கார்ட்டில் சேர்',
    buyNow: 'இப்போதே வாங்கு',
    outOfStock: 'ஸ்டாக் இல்லை',
    inStock: 'ஸ்டாக்கில் உள்ளது',
    price: 'விலை',
    quantity: 'அளவு',
    description: 'விவரம்',
    specifications: 'விவரக்குறிப்புகள்',
    reviews: 'விமர்சனங்கள்',
    relatedProducts: 'தொடர்புடைய பொருட்கள்',
    moq: 'குறைந்தபட்ச ஆர்டர் அளவு',
    requestQuote: 'மேற்கோள் கேளுங்கள்',
    sendInquiry: 'விசாரணை அனுப்பு',
  },
};

// In-memory cache for translations
const translationCache = new Map();

// =============================================================================
// LANGUAGE MANAGEMENT
// =============================================================================

/**
 * Get supported languages
 * @returns {Object[]} Supported languages
 */
exports.getSupportedLanguages = () => {
  return Object.values(SUPPORTED_LANGUAGES);
};

/**
 * Check if language is supported
 * @param {string} languageCode - Language code
 * @returns {boolean} Is supported
 */
exports.isLanguageSupported = (languageCode) => {
  return !!SUPPORTED_LANGUAGES[languageCode];
};

/**
 * Get default language
 * @returns {Object} Default language
 */
exports.getDefaultLanguage = () => {
  return SUPPORTED_LANGUAGES.en;
};

// =============================================================================
// TRANSLATION MANAGEMENT
// =============================================================================

/**
 * Get translations for a language
 * @param {string} languageCode - Language code
 * @param {string} namespace - Translation namespace
 * @returns {Promise<Object>} Translations
 */
exports.getTranslations = async (languageCode, namespace = null) => {
  const cacheKey = `${languageCode}:${namespace || 'all'}`;
  
  if (translationCache.has(cacheKey)) {
    return translationCache.get(cacheKey);
  }

  let translations;

  switch (languageCode) {
    case 'hi':
      translations = namespace 
        ? HINDI_TRANSLATIONS[namespace] || DEFAULT_TRANSLATIONS[namespace]
        : HINDI_TRANSLATIONS;
      break;
    case 'ta':
      translations = namespace
        ? TAMIL_TRANSLATIONS[namespace] || DEFAULT_TRANSLATIONS[namespace]
        : TAMIL_TRANSLATIONS;
      break;
    default:
      translations = namespace 
        ? DEFAULT_TRANSLATIONS[namespace]
        : DEFAULT_TRANSLATIONS;
  }

  // Get custom translations from database
  const customTranslations = await prisma.translation.findMany({
    where: {
      languageCode,
      ...(namespace && { namespace }),
    },
  });

  // Merge custom translations
  if (customTranslations.length > 0) {
    customTranslations.forEach((t) => {
      if (!translations[t.namespace]) {
        translations[t.namespace] = {};
      }
      translations[t.namespace][t.key] = t.value;
    });
  }

  // Cache translations
  translationCache.set(cacheKey, translations);

  return translations;
};

/**
 * Get a specific translation
 * @param {string} languageCode - Language code
 * @param {string} key - Translation key (namespace.key format)
 * @param {Object} params - Interpolation parameters
 * @returns {Promise<string>} Translated string
 */
exports.translate = async (languageCode, key, params = {}) => {
  const [namespace, ...keyParts] = key.split('.');
  const translationKey = keyParts.join('.');

  const translations = await exports.getTranslations(languageCode, namespace);
  let translation = translations?.[translationKey] || key;

  // Interpolate parameters
  Object.entries(params).forEach(([param, value]) => {
    translation = translation.replace(new RegExp(`{{${param}}}`, 'g'), value);
  });

  return translation;
};

/**
 * Add/update custom translation
 * @param {string} languageCode - Language code
 * @param {string} namespace - Namespace
 * @param {string} key - Translation key
 * @param {string} value - Translation value
 * @returns {Promise<Object>} Translation record
 */
exports.setTranslation = async (languageCode, namespace, key, value) => {
  if (!exports.isLanguageSupported(languageCode)) {
    throw new BadRequestError(`Language ${languageCode} is not supported`);
  }

  const translation = await prisma.translation.upsert({
    where: {
      languageCode_namespace_key: { languageCode, namespace, key },
    },
    update: { value, updatedAt: new Date() },
    create: { languageCode, namespace, key, value },
  });

  // Clear cache
  translationCache.delete(`${languageCode}:${namespace}`);
  translationCache.delete(`${languageCode}:all`);

  return translation;
};

/**
 * Bulk import translations
 * @param {string} languageCode - Language code
 * @param {Object} translations - Translations object
 * @returns {Promise<Object>} Import result
 */
exports.importTranslations = async (languageCode, translations) => {
  if (!exports.isLanguageSupported(languageCode)) {
    throw new BadRequestError(`Language ${languageCode} is not supported`);
  }

  let imported = 0;
  let updated = 0;

  for (const [namespace, keys] of Object.entries(translations)) {
    for (const [key, value] of Object.entries(keys)) {
      const existing = await prisma.translation.findUnique({
        where: {
          languageCode_namespace_key: { languageCode, namespace, key },
        },
      });

      if (existing) {
        await prisma.translation.update({
          where: { id: existing.id },
          data: { value, updatedAt: new Date() },
        });
        updated++;
      } else {
        await prisma.translation.create({
          data: { languageCode, namespace, key, value },
        });
        imported++;
      }
    }
  }

  // Clear cache
  translationCache.clear();

  return { imported, updated, total: imported + updated };
};

// =============================================================================
// CONTENT TRANSLATION
// =============================================================================

/**
 * Get translated content for a product
 * @param {string} productId - Product ID
 * @param {string} languageCode - Language code
 * @returns {Promise<Object>} Translated product content
 */
exports.getProductTranslation = async (productId, languageCode) => {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    include: {
      translations: {
        where: { languageCode },
      },
    },
  });

  if (!product) {
    throw new NotFoundError('Product not found');
  }

  const translation = product.translations[0];

  return {
    id: product.id,
    name: translation?.name || product.name,
    description: translation?.description || product.description,
    shortDescription: translation?.shortDescription || product.shortDescription,
    specifications: translation?.specifications || product.specifications,
    languageCode: translation ? languageCode : 'en',
    isTranslated: !!translation,
  };
};

/**
 * Set product translation
 * @param {string} productId - Product ID
 * @param {string} languageCode - Language code
 * @param {Object} content - Translation content
 * @returns {Promise<Object>} Translation record
 */
exports.setProductTranslation = async (productId, languageCode, content) => {
  if (!exports.isLanguageSupported(languageCode)) {
    throw new BadRequestError(`Language ${languageCode} is not supported`);
  }

  const { name, description, shortDescription, specifications } = content;

  const translation = await prisma.productTranslation.upsert({
    where: {
      productId_languageCode: { productId, languageCode },
    },
    update: {
      name,
      description,
      shortDescription,
      specifications,
      updatedAt: new Date(),
    },
    create: {
      productId,
      languageCode,
      name,
      description,
      shortDescription,
      specifications,
    },
  });

  return translation;
};

/**
 * Get translated content for a category
 * @param {string} categoryId - Category ID
 * @param {string} languageCode - Language code
 * @returns {Promise<Object>} Translated category content
 */
exports.getCategoryTranslation = async (categoryId, languageCode) => {
  const category = await prisma.category.findUnique({
    where: { id: categoryId },
    include: {
      translations: {
        where: { languageCode },
      },
    },
  });

  if (!category) {
    throw new NotFoundError('Category not found');
  }

  const translation = category.translations[0];

  return {
    id: category.id,
    name: translation?.name || category.name,
    description: translation?.description || category.description,
    languageCode: translation ? languageCode : 'en',
    isTranslated: !!translation,
  };
};

// =============================================================================
// USER PREFERENCES
// =============================================================================

/**
 * Set user language preference
 * @param {string} userId - User ID
 * @param {string} languageCode - Language code
 * @returns {Promise<Object>} Updated user
 */
exports.setUserLanguage = async (userId, languageCode) => {
  if (!exports.isLanguageSupported(languageCode)) {
    throw new BadRequestError(`Language ${languageCode} is not supported`);
  }

  const user = await prisma.user.update({
    where: { id: userId },
    data: {
      preferences: {
        upsert: {
          create: { language: languageCode },
          update: { language: languageCode },
        },
      },
    },
    include: { preferences: true },
  });

  return { language: languageCode, user: { id: user.id } };
};

/**
 * Get user language preference
 * @param {string} userId - User ID
 * @returns {Promise<string>} Language code
 */
exports.getUserLanguage = async (userId) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { preferences: true },
  });

  return user?.preferences?.language || 'en';
};

// =============================================================================
// AUTO-TRANSLATION
// =============================================================================

/**
 * Auto-translate content (placeholder for external service)
 * @param {string} text - Text to translate
 * @param {string} sourceLang - Source language
 * @param {string} targetLang - Target language
 * @returns {Promise<string>} Translated text
 */
exports.autoTranslate = async (text, sourceLang, targetLang) => {
  // This would integrate with Google Translate, Azure Translator, or similar
  // For now, return original text with a note
  logger.info('Auto-translation requested', { sourceLang, targetLang });
  
  // Placeholder - in production, integrate with translation API
  return {
    originalText: text,
    translatedText: text, // Would be actual translation
    sourceLang,
    targetLang,
    confidence: 0,
    isAutoTranslated: false,
    note: 'Auto-translation service not configured',
  };
};

// =============================================================================
// MODULE EXPORTS
// =============================================================================

module.exports = {
  ...exports,
  SUPPORTED_LANGUAGES,
  NAMESPACES,
  DEFAULT_TRANSLATIONS,
};
