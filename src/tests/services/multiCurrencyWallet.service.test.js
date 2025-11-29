// =============================================================================
// AIRAVAT B2B MARKETPLACE - MULTI-CURRENCY WALLET SERVICE TESTS
// =============================================================================

const multiCurrencyWalletService = require('../../services/multiCurrencyWallet.service');
const { prisma } = require('../../config/database');

// Mock dependencies
jest.mock('../../config/database', () => ({
  prisma: {
    wallet: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    walletCurrencyBalance: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      upsert: jest.fn(),
    },
    currencyExchange: {
      create: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    $transaction: jest.fn((callback) => callback(prisma)),
  },
}));

jest.mock('axios', () => ({
  get: jest.fn(),
}));

const axios = require('axios');

describe('Multi-Currency Wallet Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('addCurrency', () => {
    it('should add new currency to wallet', async () => {
      const mockWallet = {
        id: 'wallet_123',
        userId: 'user_123',
      };

      const mockBalance = {
        id: 'balance_123',
        walletId: 'wallet_123',
        currency: 'USD',
        balance: 0,
        lockedBalance: 0,
      };

      prisma.wallet.findFirst.mockResolvedValue(mockWallet);
      prisma.walletCurrencyBalance.findFirst.mockResolvedValue(null);
      prisma.walletCurrencyBalance.create.mockResolvedValue(mockBalance);

      const result = await multiCurrencyWalletService.addCurrency('user_123', 'USD');

      expect(result.currency).toBe('USD');
      expect(result.balance).toBe(0);
    });

    it('should throw error if currency already exists', async () => {
      prisma.wallet.findFirst.mockResolvedValue({ id: 'wallet_123' });
      prisma.walletCurrencyBalance.findFirst.mockResolvedValue({
        id: 'balance_123',
        currency: 'USD',
      });

      await expect(multiCurrencyWalletService.addCurrency('user_123', 'USD'))
        .rejects.toThrow('Currency USD already exists in wallet');
    });

    it('should throw error for unsupported currency', async () => {
      prisma.wallet.findFirst.mockResolvedValue({ id: 'wallet_123' });

      await expect(multiCurrencyWalletService.addCurrency('user_123', 'XYZ'))
        .rejects.toThrow('Currency XYZ is not supported');
    });
  });

  describe('getExchangeRate', () => {
    it('should return cached exchange rate', async () => {
      // Simulate cached rate
      multiCurrencyWalletService._rateCache = {
        'USD_INR': { rate: 83.5, timestamp: Date.now() },
      };

      const result = await multiCurrencyWalletService.getExchangeRate('USD', 'INR');

      expect(result.rate).toBe(83.5);
    });

    it('should fetch rate from API if not cached', async () => {
      multiCurrencyWalletService._rateCache = {};

      axios.get.mockResolvedValue({
        data: {
          rates: { INR: 83.5 },
        },
      });

      const result = await multiCurrencyWalletService.getExchangeRate('USD', 'INR');

      expect(result.rate).toBe(83.5);
      expect(axios.get).toHaveBeenCalled();
    });

    it('should return 1 for same currency', async () => {
      const result = await multiCurrencyWalletService.getExchangeRate('INR', 'INR');

      expect(result.rate).toBe(1);
    });
  });

  describe('exchangeCurrency', () => {
    it('should exchange currency successfully', async () => {
      const mockWallet = { id: 'wallet_123', userId: 'user_123' };
      const mockFromBalance = {
        id: 'balance_1',
        walletId: 'wallet_123',
        currency: 'USD',
        balance: 1000,
        lockedBalance: 0,
      };
      const mockToBalance = {
        id: 'balance_2',
        walletId: 'wallet_123',
        currency: 'INR',
        balance: 0,
        lockedBalance: 0,
      };

      prisma.wallet.findFirst.mockResolvedValue(mockWallet);
      prisma.walletCurrencyBalance.findFirst
        .mockResolvedValueOnce(mockFromBalance)
        .mockResolvedValueOnce(mockToBalance);

      multiCurrencyWalletService._rateCache = {
        'USD_INR': { rate: 83.5, timestamp: Date.now() },
      };

      prisma.walletCurrencyBalance.update
        .mockResolvedValueOnce({ ...mockFromBalance, balance: 900 })
        .mockResolvedValueOnce({ ...mockToBalance, balance: 8350 });

      const mockExchange = {
        id: 'exchange_123',
        walletId: 'wallet_123',
        fromCurrency: 'USD',
        toCurrency: 'INR',
        fromAmount: 100,
        toAmount: 8350,
        exchangeRate: 83.5,
        fee: 0,
        status: 'COMPLETED',
      };

      prisma.currencyExchange.create.mockResolvedValue(mockExchange);

      const result = await multiCurrencyWalletService.exchangeCurrency(
        'user_123',
        'USD',
        'INR',
        100
      );

      expect(result.fromAmount).toBe(100);
      expect(result.toAmount).toBe(8350);
      expect(result.exchangeRate).toBe(83.5);
    });

    it('should throw error for insufficient balance', async () => {
      prisma.wallet.findFirst.mockResolvedValue({ id: 'wallet_123' });
      prisma.walletCurrencyBalance.findFirst.mockResolvedValue({
        currency: 'USD',
        balance: 50, // Less than amount to exchange
        lockedBalance: 0,
      });

      await expect(multiCurrencyWalletService.exchangeCurrency(
        'user_123',
        'USD',
        'INR',
        100
      )).rejects.toThrow('Insufficient USD balance');
    });

    it('should apply exchange fee', async () => {
      const mockWallet = { id: 'wallet_123' };
      prisma.wallet.findFirst.mockResolvedValue(mockWallet);
      prisma.walletCurrencyBalance.findFirst
        .mockResolvedValueOnce({ currency: 'USD', balance: 1000, lockedBalance: 0 })
        .mockResolvedValueOnce({ currency: 'INR', balance: 0, lockedBalance: 0 });

      multiCurrencyWalletService._rateCache = {
        'USD_INR': { rate: 83.5, timestamp: Date.now() },
      };

      prisma.walletCurrencyBalance.update.mockResolvedValue({});
      prisma.currencyExchange.create.mockResolvedValue({
        fromAmount: 100,
        toAmount: 8267, // After 1% fee
        fee: 83,
      });

      const result = await multiCurrencyWalletService.exchangeCurrency(
        'user_123',
        'USD',
        'INR',
        100,
        { feePercent: 1 }
      );

      expect(result.fee).toBe(83);
    });
  });

  describe('getBalances', () => {
    it('should return all currency balances', async () => {
      const mockBalances = [
        { currency: 'INR', balance: 100000, lockedBalance: 5000 },
        { currency: 'USD', balance: 500, lockedBalance: 0 },
        { currency: 'AED', balance: 2000, lockedBalance: 100 },
      ];

      prisma.wallet.findFirst.mockResolvedValue({ id: 'wallet_123' });
      prisma.walletCurrencyBalance.findMany.mockResolvedValue(mockBalances);

      const result = await multiCurrencyWalletService.getBalances('user_123');

      expect(result).toHaveLength(3);
      expect(result[0].currency).toBe('INR');
    });

    it('should include total in base currency', async () => {
      const mockBalances = [
        { currency: 'INR', balance: 100000, lockedBalance: 0 },
        { currency: 'USD', balance: 100, lockedBalance: 0 },
      ];

      prisma.wallet.findFirst.mockResolvedValue({ id: 'wallet_123' });
      prisma.walletCurrencyBalance.findMany.mockResolvedValue(mockBalances);

      multiCurrencyWalletService._rateCache = {
        'USD_INR': { rate: 83.5, timestamp: Date.now() },
      };

      const result = await multiCurrencyWalletService.getBalances('user_123', {
        includeTotalInBaseCurrency: true,
        baseCurrency: 'INR',
      });

      expect(result.totalInBaseCurrency).toBeDefined();
      expect(result.baseCurrency).toBe('INR');
    });
  });

  describe('creditCurrency', () => {
    it('should credit amount to currency balance', async () => {
      const mockBalance = {
        id: 'balance_123',
        currency: 'USD',
        balance: 500,
      };

      prisma.wallet.findFirst.mockResolvedValue({ id: 'wallet_123' });
      prisma.walletCurrencyBalance.findFirst.mockResolvedValue(mockBalance);
      prisma.walletCurrencyBalance.update.mockResolvedValue({
        ...mockBalance,
        balance: 600,
      });

      const result = await multiCurrencyWalletService.creditCurrency(
        'user_123',
        'USD',
        100,
        'DEPOSIT',
        'dep_123'
      );

      expect(result.balance).toBe(600);
    });

    it('should create currency balance if not exists', async () => {
      prisma.wallet.findFirst.mockResolvedValue({ id: 'wallet_123' });
      prisma.walletCurrencyBalance.findFirst.mockResolvedValue(null);
      prisma.walletCurrencyBalance.create.mockResolvedValue({
        currency: 'EUR',
        balance: 100,
      });

      const result = await multiCurrencyWalletService.creditCurrency(
        'user_123',
        'EUR',
        100,
        'DEPOSIT',
        'dep_123'
      );

      expect(result.currency).toBe('EUR');
      expect(result.balance).toBe(100);
    });
  });

  describe('debitCurrency', () => {
    it('should debit amount from currency balance', async () => {
      const mockBalance = {
        id: 'balance_123',
        currency: 'USD',
        balance: 500,
        lockedBalance: 0,
      };

      prisma.wallet.findFirst.mockResolvedValue({ id: 'wallet_123' });
      prisma.walletCurrencyBalance.findFirst.mockResolvedValue(mockBalance);
      prisma.walletCurrencyBalance.update.mockResolvedValue({
        ...mockBalance,
        balance: 400,
      });

      const result = await multiCurrencyWalletService.debitCurrency(
        'user_123',
        'USD',
        100,
        'PAYMENT',
        'pay_123'
      );

      expect(result.balance).toBe(400);
    });

    it('should throw error for insufficient balance', async () => {
      prisma.wallet.findFirst.mockResolvedValue({ id: 'wallet_123' });
      prisma.walletCurrencyBalance.findFirst.mockResolvedValue({
        currency: 'USD',
        balance: 50,
        lockedBalance: 0,
      });

      await expect(multiCurrencyWalletService.debitCurrency(
        'user_123',
        'USD',
        100,
        'PAYMENT',
        'pay_123'
      )).rejects.toThrow('Insufficient USD balance');
    });
  });

  describe('getExchangeHistory', () => {
    it('should return exchange history with pagination', async () => {
      const mockExchanges = [
        {
          id: 'ex_1',
          fromCurrency: 'USD',
          toCurrency: 'INR',
          fromAmount: 100,
          toAmount: 8350,
          createdAt: new Date(),
        },
        {
          id: 'ex_2',
          fromCurrency: 'INR',
          toCurrency: 'AED',
          fromAmount: 10000,
          toAmount: 440,
          createdAt: new Date(),
        },
      ];

      prisma.wallet.findFirst.mockResolvedValue({ id: 'wallet_123' });
      prisma.currencyExchange.findMany.mockResolvedValue(mockExchanges);
      prisma.currencyExchange.count.mockResolvedValue(2);

      const result = await multiCurrencyWalletService.getExchangeHistory(
        'user_123',
        { page: 1, limit: 10 }
      );

      expect(result.exchanges).toHaveLength(2);
      expect(result.pagination.total).toBe(2);
    });

    it('should filter by currency', async () => {
      prisma.wallet.findFirst.mockResolvedValue({ id: 'wallet_123' });
      prisma.currencyExchange.findMany.mockResolvedValue([]);
      prisma.currencyExchange.count.mockResolvedValue(0);

      await multiCurrencyWalletService.getExchangeHistory('user_123', {
        currency: 'USD',
      });

      expect(prisma.currencyExchange.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: [
              { fromCurrency: 'USD' },
              { toCurrency: 'USD' },
            ],
          }),
        })
      );
    });
  });

  describe('getSupportedCurrencies', () => {
    it('should return list of supported currencies', () => {
      const currencies = multiCurrencyWalletService.getSupportedCurrencies();

      expect(currencies).toContain('INR');
      expect(currencies).toContain('USD');
      expect(currencies).toContain('AED');
      expect(currencies).toContain('EUR');
      expect(currencies).toContain('GBP');
    });
  });

  describe('convertAmount', () => {
    it('should convert amount between currencies', async () => {
      multiCurrencyWalletService._rateCache = {
        'USD_INR': { rate: 83.5, timestamp: Date.now() },
      };

      const result = await multiCurrencyWalletService.convertAmount(
        100,
        'USD',
        'INR'
      );

      expect(result.convertedAmount).toBe(8350);
      expect(result.rate).toBe(83.5);
    });
  });
});
