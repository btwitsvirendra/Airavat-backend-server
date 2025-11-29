// =============================================================================
// AIRAVAT B2B MARKETPLACE - WAREHOUSE ROUTES
// =============================================================================

const express = require('express');
const router = express.Router();
const warehouseController = require('../controllers/warehouse.controller');
const { protect } = require('../middleware/auth.middleware');

router.use(protect);

router.post('/', warehouseController.createWarehouse);
router.get('/', warehouseController.getWarehouses);
router.get('/:warehouseId', warehouseController.getWarehouse);
router.put('/:warehouseId', warehouseController.updateWarehouse);
router.delete('/:warehouseId', warehouseController.deleteWarehouse);
router.get('/:warehouseId/inventory', warehouseController.getInventory);
router.put('/:warehouseId/inventory', warehouseController.updateInventory);
router.post('/transfer', warehouseController.transferInventory);
router.get('/distribution/:variantId', warehouseController.getInventoryDistribution);

module.exports = router;

