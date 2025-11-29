// =============================================================================
// AIRAVAT B2B MARKETPLACE - LOCALIZATION CONTROLLER
// Handles multi-language and translation endpoints
// =============================================================================

const localizationService = require('../services/localization.service');
const asyncHandler = require('../middleware/async.middleware');

// =============================================================================
// LANGUAGE ENDPOINTS
// =============================================================================

/**
 * Get supported languages
 * @route GET /api/v1/i18n/languages
 */
const getLanguages = asyncHandler(async (req, res) => {
  const languages = localizationService.getSupportedLanguages();

  res.json({
    success: true,
    data: languages,
  });
});

/**
 * Get translations for a language
 * @route GET /api/v1/i18n/translations/:lang
 */
const getTranslations = asyncHandler(async (req, res) => {
  const translations = await localizationService.getTranslations(
    req.params.lang,
    req.query.namespace
  );

  res.json({
    success: true,
    data: translations,
  });
});

/**
 * Translate a key
 * @route GET /api/v1/i18n/translate
 */
const translate = asyncHandler(async (req, res) => {
  const { lang = 'en', key, params = {} } = req.query;
  
  const translation = await localizationService.translate(
    lang,
    key,
    typeof params === 'string' ? JSON.parse(params) : params
  );

  res.json({
    success: true,
    data: { key, translation },
  });
});

/**
 * Set a translation (Admin)
 * @route POST /api/v1/i18n/translations
 */
const setTranslation = asyncHandler(async (req, res) => {
  const { languageCode, namespace, key, value } = req.body;

  const translation = await localizationService.setTranslation(
    languageCode,
    namespace,
    key,
    value
  );

  res.json({
    success: true,
    message: 'Translation saved',
    data: translation,
  });
});

/**
 * Import translations (Admin)
 * @route POST /api/v1/i18n/import
 */
const importTranslations = asyncHandler(async (req, res) => {
  const { languageCode, translations } = req.body;

  const result = await localizationService.importTranslations(
    languageCode,
    translations
  );

  res.json({
    success: true,
    message: `Imported ${result.imported} new, updated ${result.updated} translations`,
    data: result,
  });
});

/**
 * Set user language preference
 * @route PUT /api/v1/users/language
 */
const setUserLanguage = asyncHandler(async (req, res) => {
  const { languageCode } = req.body;

  const result = await localizationService.setUserLanguage(
    req.user.id,
    languageCode
  );

  res.json({
    success: true,
    message: 'Language preference updated',
    data: result,
  });
});

// =============================================================================
// MODULE EXPORTS
// =============================================================================

module.exports = {
  getLanguages,
  getTranslations,
  translate,
  setTranslation,
  importTranslations,
  setUserLanguage,
};



