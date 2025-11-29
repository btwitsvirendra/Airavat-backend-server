// =============================================================================
// AIRAVAT B2B MARKETPLACE - BULK UPLOAD ROUTES
// =============================================================================

const express = require('express');
const router = express.Router();
const multer = require('multer');
const bulkUploadController = require('../controllers/bulkUpload.controller');
const { protect } = require('../middleware/auth.middleware');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['.csv', '.xlsx', '.xls'];
    const ext = file.originalname.toLowerCase().slice(file.originalname.lastIndexOf('.'));
    if (allowedTypes.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only CSV and Excel files allowed.'));
    }
  }
});

router.use(protect);

router.post('/products', upload.single('file'), bulkUploadController.uploadProducts);
router.post('/inventory', upload.single('file'), bulkUploadController.uploadInventory);
router.post('/prices', upload.single('file'), bulkUploadController.uploadPrices);
router.get('/jobs', bulkUploadController.getJobs);
router.get('/jobs/:jobId', bulkUploadController.getJob);
router.get('/template/:type', bulkUploadController.getTemplate);

module.exports = router;

