// =============================================================================
// AIRAVAT B2B MARKETPLACE - CONTRACT SERVICE UNIT TESTS
// Comprehensive tests for B2B contract management functionality
// =============================================================================

const ContractService = require('../../src/services/contract.service');
const { prisma, factories } = require('../setup');

// Mock dependencies
jest.mock('../../src/config/redis', () => ({
  redis: {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    setex: jest.fn(),
  },
}));

jest.mock('../../src/config/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

describe('ContractService', () => {
  let buyerUser;
  let sellerUser;
  let buyerBusiness;
  let sellerBusiness;

  beforeAll(async () => {
    // Create buyer
    buyerUser = await factories.createUser({
      email: 'contract-buyer@example.com',
      role: 'BUYER',
    });
    buyerBusiness = await factories.createBusiness(buyerUser.id, {
      businessName: 'Contract Buyer Co',
    });

    // Create seller
    sellerUser = await factories.createUser({
      email: 'contract-seller@example.com',
      role: 'SELLER',
    });
    sellerBusiness = await factories.createBusiness(sellerUser.id, {
      businessName: 'Contract Seller Co',
    });
  });

  afterAll(async () => {
    // Cleanup
    await prisma.contract.deleteMany({});
    await prisma.business.deleteMany({
      where: { id: { in: [buyerBusiness.id, sellerBusiness.id] } },
    });
    await prisma.user.deleteMany({
      where: { id: { in: [buyerUser.id, sellerUser.id] } },
    });
  });

  // ===========================================================================
  // CONTRACT CREATION
  // ===========================================================================

  describe('createContract', () => {
    it('should create a new contract', async () => {
      const contractData = {
        partyBId: sellerBusiness.id,
        title: 'Annual Supply Agreement',
        description: 'Contract for annual supply of raw materials',
        contractType: 'SUPPLY_AGREEMENT',
        startDate: new Date(),
        endDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
        totalValue: 1000000,
        currency: 'INR',
        paymentTerms: 'Net 30 days',
        deliveryTerms: 'FOB Mumbai',
        terms: [
          { clause: 'Payment', details: 'Payment within 30 days of invoice' },
          { clause: 'Delivery', details: 'Monthly deliveries' },
        ],
      };

      const contract = await ContractService.createContract(buyerBusiness.id, contractData);

      expect(contract).toBeDefined();
      expect(contract.title).toBe(contractData.title);
      expect(contract.partyAId).toBe(buyerBusiness.id);
      expect(contract.partyBId).toBe(sellerBusiness.id);
      expect(contract.status).toBe('DRAFT');
      expect(contract.contractNumber).toBeDefined();
    });

    it('should reject contract with self as party B', async () => {
      const contractData = {
        partyBId: buyerBusiness.id, // Same as creator
        title: 'Self Contract',
        contractType: 'SUPPLY_AGREEMENT',
        startDate: new Date(),
        endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        totalValue: 10000,
        currency: 'INR',
      };

      await expect(
        ContractService.createContract(buyerBusiness.id, contractData)
      ).rejects.toThrow(/same business|party/i);
    });

    it('should reject contract with end date before start date', async () => {
      const contractData = {
        partyBId: sellerBusiness.id,
        title: 'Invalid Date Contract',
        contractType: 'SUPPLY_AGREEMENT',
        startDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        endDate: new Date(), // Before start date
        totalValue: 10000,
        currency: 'INR',
      };

      await expect(
        ContractService.createContract(buyerBusiness.id, contractData)
      ).rejects.toThrow(/date/i);
    });
  });

  // ===========================================================================
  // GET CONTRACTS
  // ===========================================================================

  describe('getContracts', () => {
    beforeAll(async () => {
      // Create multiple contracts
      for (let i = 0; i < 5; i++) {
        await ContractService.createContract(buyerBusiness.id, {
          partyBId: sellerBusiness.id,
          title: `Test Contract ${i + 1}`,
          contractType: i % 2 === 0 ? 'SUPPLY_AGREEMENT' : 'PURCHASE_ORDER',
          startDate: new Date(),
          endDate: new Date(Date.now() + (i + 1) * 30 * 24 * 60 * 60 * 1000),
          totalValue: 10000 * (i + 1),
          currency: 'INR',
        });
      }
    });

    it('should return paginated contracts', async () => {
      const result = await ContractService.getBusinessContracts(buyerBusiness.id, {
        page: 1,
        limit: 10,
      });

      expect(result.contracts).toBeDefined();
      expect(Array.isArray(result.contracts)).toBe(true);
      expect(result.pagination).toBeDefined();
    });

    it('should filter by status', async () => {
      const result = await ContractService.getBusinessContracts(buyerBusiness.id, {
        status: 'DRAFT',
      });

      result.contracts.forEach((contract) => {
        expect(contract.status).toBe('DRAFT');
      });
    });

    it('should filter by contract type', async () => {
      const result = await ContractService.getBusinessContracts(buyerBusiness.id, {
        contractType: 'SUPPLY_AGREEMENT',
      });

      result.contracts.forEach((contract) => {
        expect(contract.contractType).toBe('SUPPLY_AGREEMENT');
      });
    });

    it('should search by title', async () => {
      const result = await ContractService.getBusinessContracts(buyerBusiness.id, {
        search: 'Test Contract',
      });

      expect(result.contracts.length).toBeGreaterThan(0);
    });

    it('should get contracts where business is party B', async () => {
      const result = await ContractService.getBusinessContracts(sellerBusiness.id, {
        page: 1,
        limit: 10,
      });

      result.contracts.forEach((contract) => {
        expect([contract.partyAId, contract.partyBId]).toContain(sellerBusiness.id);
      });
    });
  });

  // ===========================================================================
  // CONTRACT WORKFLOW
  // ===========================================================================

  describe('Contract Workflow', () => {
    let workflowContract;

    beforeEach(async () => {
      workflowContract = await ContractService.createContract(buyerBusiness.id, {
        partyBId: sellerBusiness.id,
        title: 'Workflow Test Contract',
        contractType: 'SUPPLY_AGREEMENT',
        startDate: new Date(),
        endDate: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
        totalValue: 50000,
        currency: 'INR',
      });
    });

    describe('sendForReview', () => {
      it('should send contract for review', async () => {
        const result = await ContractService.sendForReview(
          workflowContract.id,
          buyerBusiness.id
        );

        expect(result.status).toBe('PENDING_REVIEW');
      });

      it('should not send already sent contract', async () => {
        await ContractService.sendForReview(workflowContract.id, buyerBusiness.id);

        await expect(
          ContractService.sendForReview(workflowContract.id, buyerBusiness.id)
        ).rejects.toThrow(/status|already/i);
      });
    });

    describe('approveContract', () => {
      beforeEach(async () => {
        await ContractService.sendForReview(workflowContract.id, buyerBusiness.id);
      });

      it('should approve contract by party B', async () => {
        const result = await ContractService.approveContract(
          workflowContract.id,
          sellerBusiness.id,
          'Approved by seller'
        );

        expect(result.status).toBe('PENDING_SIGNATURE');
      });

      it('should not allow party A to approve own contract', async () => {
        await expect(
          ContractService.approveContract(workflowContract.id, buyerBusiness.id)
        ).rejects.toThrow(/party B|other party/i);
      });
    });

    describe('signContract', () => {
      beforeEach(async () => {
        await ContractService.sendForReview(workflowContract.id, buyerBusiness.id);
        await ContractService.approveContract(workflowContract.id, sellerBusiness.id);
      });

      it('should allow party A to sign first', async () => {
        const result = await ContractService.signContract(
          workflowContract.id,
          buyerBusiness.id,
          {
            signatureData: 'base64signature',
            signedAt: new Date(),
          }
        );

        expect(result.partyASignedAt).toBeDefined();
        expect(result.status).toBe('PENDING_SIGNATURE');
      });

      it('should activate contract when both parties sign', async () => {
        await ContractService.signContract(workflowContract.id, buyerBusiness.id, {
          signatureData: 'buyer-signature',
        });

        const result = await ContractService.signContract(
          workflowContract.id,
          sellerBusiness.id,
          {
            signatureData: 'seller-signature',
          }
        );

        expect(result.partyBSignedAt).toBeDefined();
        expect(result.status).toBe('ACTIVE');
      });
    });

    describe('rejectContract', () => {
      it('should reject contract', async () => {
        await ContractService.sendForReview(workflowContract.id, buyerBusiness.id);

        const result = await ContractService.rejectContract(
          workflowContract.id,
          sellerBusiness.id,
          'Terms not acceptable'
        );

        expect(result.status).toBe('REJECTED');
      });
    });
  });

  // ===========================================================================
  // CONTRACT AMENDMENTS
  // ===========================================================================

  describe('Contract Amendments', () => {
    let activeContract;

    beforeAll(async () => {
      activeContract = await ContractService.createContract(buyerBusiness.id, {
        partyBId: sellerBusiness.id,
        title: 'Amendment Test Contract',
        contractType: 'SUPPLY_AGREEMENT',
        startDate: new Date(),
        endDate: new Date(Date.now() + 180 * 24 * 60 * 60 * 1000),
        totalValue: 100000,
        currency: 'INR',
      });

      // Fast-track to active status
      await prisma.contract.update({
        where: { id: activeContract.id },
        data: {
          status: 'ACTIVE',
          partyASignedAt: new Date(),
          partyBSignedAt: new Date(),
        },
      });
    });

    it('should propose amendment to active contract', async () => {
      const amendment = await ContractService.proposeAmendment(
        activeContract.id,
        buyerBusiness.id,
        {
          changes: {
            totalValue: 150000, // Increase value
          },
          reason: 'Increased order volume',
        }
      );

      expect(amendment).toBeDefined();
      expect(amendment.status).toBe('AMENDMENT_PENDING');
    });

    it('should accept amendment', async () => {
      const contract = await ContractService.createContract(buyerBusiness.id, {
        partyBId: sellerBusiness.id,
        title: 'Accept Amendment Contract',
        contractType: 'SUPPLY_AGREEMENT',
        startDate: new Date(),
        endDate: new Date(Date.now() + 180 * 24 * 60 * 60 * 1000),
        totalValue: 100000,
        currency: 'INR',
      });

      await prisma.contract.update({
        where: { id: contract.id },
        data: { status: 'ACTIVE' },
      });

      await ContractService.proposeAmendment(contract.id, buyerBusiness.id, {
        changes: { totalValue: 120000 },
        reason: 'Minor adjustment',
      });

      const result = await ContractService.acceptAmendment(
        contract.id,
        sellerBusiness.id
      );

      expect(result.status).toBe('ACTIVE');
      expect(result.totalValue).toBe(120000);
    });
  });

  // ===========================================================================
  // CONTRACT TERMINATION
  // ===========================================================================

  describe('Contract Termination', () => {
    it('should terminate contract by mutual agreement', async () => {
      const contract = await ContractService.createContract(buyerBusiness.id, {
        partyBId: sellerBusiness.id,
        title: 'Termination Test Contract',
        contractType: 'SUPPLY_AGREEMENT',
        startDate: new Date(),
        endDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
        totalValue: 500000,
        currency: 'INR',
      });

      await prisma.contract.update({
        where: { id: contract.id },
        data: { status: 'ACTIVE' },
      });

      const result = await ContractService.terminateContract(
        contract.id,
        buyerBusiness.id,
        {
          reason: 'Business closure',
          terminationType: 'MUTUAL',
        }
      );

      expect(result.status).toBe('TERMINATED');
      expect(result.terminatedAt).toBeDefined();
    });

    it('should mark contract as expired', async () => {
      const contract = await ContractService.createContract(buyerBusiness.id, {
        partyBId: sellerBusiness.id,
        title: 'Expiry Test Contract',
        contractType: 'SUPPLY_AGREEMENT',
        startDate: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000),
        endDate: new Date(Date.now() - 24 * 60 * 60 * 1000), // Expired yesterday
        totalValue: 100000,
        currency: 'INR',
      });

      await prisma.contract.update({
        where: { id: contract.id },
        data: { status: 'ACTIVE' },
      });

      const result = await ContractService.checkAndExpireContract(contract.id);

      expect(result.status).toBe('EXPIRED');
    });
  });

  // ===========================================================================
  // CONTRACT DOCUMENTS
  // ===========================================================================

  describe('Contract Documents', () => {
    let documentContract;

    beforeAll(async () => {
      documentContract = await ContractService.createContract(buyerBusiness.id, {
        partyBId: sellerBusiness.id,
        title: 'Document Test Contract',
        contractType: 'SUPPLY_AGREEMENT',
        startDate: new Date(),
        endDate: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
        totalValue: 25000,
        currency: 'INR',
      });
    });

    it('should attach document to contract', async () => {
      const result = await ContractService.attachDocument(
        documentContract.id,
        buyerBusiness.id,
        {
          name: 'Terms Document',
          type: 'pdf',
          url: 'https://storage.example.com/contracts/terms.pdf',
          size: 1024000,
        }
      );

      expect(result.documents).toBeDefined();
      expect(result.documents.length).toBeGreaterThan(0);
    });

    it('should generate contract PDF', async () => {
      const result = await ContractService.generateContractPDF(documentContract.id);

      expect(result.pdfUrl).toBeDefined();
    });
  });

  // ===========================================================================
  // CONTRACT STATISTICS
  // ===========================================================================

  describe('Contract Statistics', () => {
    it('should get contract statistics for business', async () => {
      const stats = await ContractService.getContractStats(buyerBusiness.id);

      expect(stats).toBeDefined();
      expect(stats).toHaveProperty('total');
      expect(stats).toHaveProperty('byStatus');
      expect(stats).toHaveProperty('totalValue');
    });

    it('should get upcoming renewals', async () => {
      const renewals = await ContractService.getUpcomingRenewals(buyerBusiness.id, 30);

      expect(Array.isArray(renewals)).toBe(true);
    });
  });
});



