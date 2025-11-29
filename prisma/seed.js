// =============================================================================
// AIRAVAT B2B MARKETPLACE - DATABASE SEED
// Sample data for development and testing
// =============================================================================

const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const { nanoid } = require('nanoid');

const prisma = new PrismaClient();

// =============================================================================
// SEED DATA
// =============================================================================

const categories = [
  {
    name: 'Industrial Machinery',
    slug: 'industrial-machinery',
    icon: '🏭',
    description: 'Heavy machinery and industrial equipment',
    children: [
      { name: 'CNC Machines', slug: 'cnc-machines' },
      { name: 'Packaging Machines', slug: 'packaging-machines' },
      { name: 'Printing Machines', slug: 'printing-machines' },
      { name: 'Textile Machines', slug: 'textile-machines' },
    ],
  },
  {
    name: 'Raw Materials',
    slug: 'raw-materials',
    icon: '🧱',
    description: 'Industrial raw materials and supplies',
    children: [
      { name: 'Metals & Alloys', slug: 'metals-alloys' },
      { name: 'Chemicals', slug: 'chemicals' },
      { name: 'Plastics & Polymers', slug: 'plastics-polymers' },
      { name: 'Textiles & Fabrics', slug: 'textiles-fabrics' },
    ],
  },
  {
    name: 'Electronics & Components',
    slug: 'electronics-components',
    icon: '🔌',
    description: 'Electronic parts and components',
    children: [
      { name: 'Semiconductors', slug: 'semiconductors' },
      { name: 'PCB & Circuits', slug: 'pcb-circuits' },
      { name: 'Connectors & Cables', slug: 'connectors-cables' },
      { name: 'Sensors & Switches', slug: 'sensors-switches' },
    ],
  },
  {
    name: 'Packaging Materials',
    slug: 'packaging-materials',
    icon: '📦',
    description: 'Packaging supplies and materials',
    children: [
      { name: 'Corrugated Boxes', slug: 'corrugated-boxes' },
      { name: 'Plastic Packaging', slug: 'plastic-packaging' },
      { name: 'Labels & Tags', slug: 'labels-tags' },
      { name: 'Stretch Films', slug: 'stretch-films' },
    ],
  },
  {
    name: 'Office & Stationery',
    slug: 'office-stationery',
    icon: '📎',
    description: 'Office supplies and stationery',
    children: [
      { name: 'Paper Products', slug: 'paper-products' },
      { name: 'Writing Instruments', slug: 'writing-instruments' },
      { name: 'Office Furniture', slug: 'office-furniture' },
      { name: 'IT Accessories', slug: 'it-accessories' },
    ],
  },
  {
    name: 'Food & Beverages',
    slug: 'food-beverages',
    icon: '🍎',
    description: 'Food products and ingredients',
    children: [
      { name: 'Spices & Seasonings', slug: 'spices-seasonings' },
      { name: 'Grains & Pulses', slug: 'grains-pulses' },
      { name: 'Beverages', slug: 'beverages' },
      { name: 'Processed Foods', slug: 'processed-foods' },
    ],
  },
];

const subscriptionPlans = [
  {
    name: 'Starter',
    slug: 'starter',
    description: 'Perfect for small businesses just getting started',
    monthlyPrice: 0,
    annualPrice: 0,
    currency: 'INR',
    features: [
      'Up to 20 product listings',
      'Basic analytics',
      'Email support',
      'Standard verification badge',
    ],
    limits: { products: 20, staff: 1, inquiries: 50 },
    organicListings: 10,
    promotedListings: 0,
    commissionRate: 5,
    isPopular: false,
    trialDays: 0,
  },
  {
    name: 'Growth',
    slug: 'growth',
    description: 'Ideal for growing businesses',
    monthlyPrice: 4999,
    annualPrice: 49990,
    currency: 'INR',
    features: [
      'Up to 200 product listings',
      'Advanced analytics & reports',
      'Priority email & chat support',
      'Verified seller badge',
      '5 promoted listings/month',
      'RFQ access',
    ],
    limits: { products: 200, staff: 3, inquiries: 500 },
    organicListings: 100,
    promotedListings: 5,
    commissionRate: 4,
    isPopular: true,
    trialDays: 14,
  },
  {
    name: 'Professional',
    slug: 'professional',
    description: 'For established businesses scaling up',
    monthlyPrice: 14999,
    annualPrice: 149990,
    currency: 'INR',
    features: [
      'Unlimited product listings',
      'Full analytics suite',
      'Dedicated account manager',
      'Premium verified badge',
      '20 promoted listings/month',
      'Priority RFQ access',
      'API access',
      'Credit line eligibility',
    ],
    limits: { products: -1, staff: 10, inquiries: -1 },
    organicListings: 500,
    promotedListings: 20,
    commissionRate: 3,
    isPopular: false,
    trialDays: 14,
  },
  {
    name: 'Enterprise',
    slug: 'enterprise',
    description: 'Custom solutions for large enterprises',
    monthlyPrice: 49999,
    annualPrice: 499990,
    currency: 'INR',
    features: [
      'Everything in Professional',
      'Custom integrations',
      'White-label options',
      'SLA guarantee',
      'Dedicated infrastructure',
      'Custom commission rates',
      'Training & onboarding',
    ],
    limits: { products: -1, staff: -1, inquiries: -1 },
    organicListings: -1,
    promotedListings: -1,
    commissionRate: 2,
    isPopular: false,
    trialDays: 30,
  },
];

const hsnCodes = [
  { code: '84719000', description: 'Automatic data processing machines', gstRate: 18 },
  { code: '85171100', description: 'Telephone sets', gstRate: 18 },
  { code: '94036000', description: 'Wooden furniture', gstRate: 18 },
  { code: '39269099', description: 'Other articles of plastics', gstRate: 18 },
  { code: '48192000', description: 'Cartons, boxes of paper', gstRate: 12 },
  { code: '09109100', description: 'Mixtures of spices', gstRate: 5 },
  { code: '72149900', description: 'Other bars and rods of iron', gstRate: 18 },
  { code: '39011010', description: 'Polyethylene', gstRate: 18 },
  { code: '85423100', description: 'Processors and controllers', gstRate: 0 },
  { code: '84439900', description: 'Parts of printing machinery', gstRate: 18 },
];

// =============================================================================
// SEED FUNCTIONS
// =============================================================================

async function seedCategories() {
  console.log('Seeding categories...');
  
  for (const category of categories) {
    const parent = await prisma.category.upsert({
      where: { slug: category.slug },
      update: {},
      create: {
        name: category.name,
        slug: category.slug,
        icon: category.icon,
        description: category.description,
        isActive: true,
        displayOrder: categories.indexOf(category),
      },
    });
    
    // Create children
    if (category.children) {
      for (const child of category.children) {
        await prisma.category.upsert({
          where: { slug: child.slug },
          update: {},
          create: {
            name: child.name,
            slug: child.slug,
            parentId: parent.id,
            isActive: true,
            displayOrder: category.children.indexOf(child),
          },
        });
      }
    }
  }
  
  console.log('✓ Categories seeded');
}

async function seedSubscriptionPlans() {
  console.log('Seeding subscription plans...');
  
  for (const plan of subscriptionPlans) {
    await prisma.subscriptionPlan.upsert({
      where: { slug: plan.slug },
      update: plan,
      create: plan,
    });
  }
  
  console.log('✓ Subscription plans seeded');
}

async function seedHSNCodes() {
  console.log('Seeding HSN codes...');
  
  for (const hsn of hsnCodes) {
    await prisma.hsnCode.upsert({
      where: { code: hsn.code },
      update: hsn,
      create: hsn,
    });
  }
  
  console.log('✓ HSN codes seeded');
}

async function seedAdminUser() {
  console.log('Seeding admin user...');
  
  const hashedPassword = await bcrypt.hash('Admin@123', 12);
  
  await prisma.user.upsert({
    where: { email: 'admin@airavat.com' },
    update: {},
    create: {
      email: 'admin@airavat.com',
      phone: '+919999999999',
      password: hashedPassword,
      firstName: 'Admin',
      lastName: 'User',
      role: 'ADMIN',
      status: 'ACTIVE',
      isEmailVerified: true,
      isPhoneVerified: true,
    },
  });
  
  console.log('✓ Admin user seeded');
}

async function seedDemoBusinesses() {
  console.log('Seeding demo businesses...');
  
  const hashedPassword = await bcrypt.hash('Demo@123', 12);
  
  const demoBusinesses = [
    {
      user: {
        email: 'seller@demo.com',
        phone: '+919876543210',
        firstName: 'Demo',
        lastName: 'Seller',
        role: 'SELLER',
      },
      business: {
        businessName: 'ABC Manufacturing Pvt Ltd',
        slug: 'abc-manufacturing',
        businessType: 'MANUFACTURER',
        gstin: '27AABCU9603R1ZM',
        pan: 'AABCU9603R',
        description: 'Leading manufacturer of industrial machinery and equipment',
        shortDescription: 'Quality industrial machinery since 1990',
        city: 'Mumbai',
        state: 'Maharashtra',
        country: 'IN',
        pincode: '400001',
        verificationStatus: 'VERIFIED',
        trustScore: 85,
        averageRating: 4.5,
        totalReviews: 150,
        establishedYear: 1990,
      },
    },
    {
      user: {
        email: 'buyer@demo.com',
        phone: '+919876543211',
        firstName: 'Demo',
        lastName: 'Buyer',
        role: 'BUYER',
      },
      business: {
        businessName: 'XYZ Traders LLC',
        slug: 'xyz-traders',
        businessType: 'TRADER',
        gstin: '24AABCU9603R1ZN',
        pan: 'AABCU9603R',
        description: 'Wholesale trader of industrial supplies',
        shortDescription: 'Your trusted trading partner',
        city: 'Ahmedabad',
        state: 'Gujarat',
        country: 'IN',
        pincode: '380001',
        verificationStatus: 'VERIFIED',
        trustScore: 75,
        averageRating: 4.2,
        totalReviews: 80,
        establishedYear: 2005,
      },
    },
    {
      user: {
        email: 'uae-seller@demo.com',
        phone: '+971501234567',
        firstName: 'UAE',
        lastName: 'Seller',
        role: 'SELLER',
      },
      business: {
        businessName: 'Gulf Trading Co. LLC',
        slug: 'gulf-trading',
        businessType: 'TRADER',
        trn: '100123456789012',
        description: 'Premium trading company based in Dubai',
        shortDescription: 'Your gateway to Gulf markets',
        city: 'Dubai',
        state: 'Dubai',
        country: 'AE',
        pincode: '00000',
        verificationStatus: 'VERIFIED',
        trustScore: 80,
        averageRating: 4.3,
        totalReviews: 60,
        establishedYear: 2010,
      },
    },
  ];
  
  for (const demo of demoBusinesses) {
    const user = await prisma.user.upsert({
      where: { email: demo.user.email },
      update: {},
      create: {
        ...demo.user,
        password: hashedPassword,
        status: 'ACTIVE',
        isEmailVerified: true,
        isPhoneVerified: true,
      },
    });
    
    await prisma.business.upsert({
      where: { slug: demo.business.slug },
      update: {},
      create: {
        ...demo.business,
        ownerId: user.id,
      },
    });
  }
  
  console.log('✓ Demo businesses seeded');
}

async function seedDemoProducts() {
  console.log('Seeding demo products...');
  
  const seller = await prisma.business.findFirst({
    where: { slug: 'abc-manufacturing' },
  });
  
  if (!seller) {
    console.log('⚠ Seller not found, skipping products');
    return;
  }
  
  const category = await prisma.category.findFirst({
    where: { slug: 'cnc-machines' },
  });
  
  const products = [
    {
      name: 'CNC Lathe Machine - Pro Series',
      slug: 'cnc-lathe-machine-pro-series',
      description: 'High-precision CNC lathe machine with advanced automation features. Perfect for precision engineering and manufacturing.',
      shortDescription: 'High-precision CNC lathe with automation',
      brand: 'ABC Pro',
      hsnCode: '84571000',
      gstRate: 18,
      minOrderQuantity: 1,
      unit: 'PCS',
      images: ['https://placeholder.com/cnc-1.jpg', 'https://placeholder.com/cnc-2.jpg'],
      status: 'ACTIVE',
      minPrice: 1500000,
      maxPrice: 2500000,
      currency: 'INR',
      organicScore: 85,
      averageRating: 4.6,
      reviewCount: 25,
    },
    {
      name: 'Industrial Packaging Machine',
      slug: 'industrial-packaging-machine',
      description: 'Automatic packaging machine for industrial use. High speed, reliable performance.',
      shortDescription: 'Automatic high-speed packaging',
      brand: 'ABC Pack',
      hsnCode: '84224000',
      gstRate: 18,
      minOrderQuantity: 1,
      unit: 'PCS',
      images: ['https://placeholder.com/pack-1.jpg'],
      status: 'ACTIVE',
      minPrice: 500000,
      maxPrice: 800000,
      currency: 'INR',
      organicScore: 75,
      averageRating: 4.3,
      reviewCount: 18,
    },
  ];
  
  for (const productData of products) {
    const product = await prisma.product.upsert({
      where: { slug: productData.slug },
      update: {},
      create: {
        ...productData,
        businessId: seller.id,
        categoryId: category?.id,
      },
    });
    
    // Create default variant
    await prisma.productVariant.upsert({
      where: { 
        productId_sku: {
          productId: product.id,
          sku: `${productData.slug}-default`,
        },
      },
      update: {},
      create: {
        productId: product.id,
        sku: `${productData.slug}-default`,
        variantName: 'Standard',
        basePrice: productData.minPrice,
        stockQuantity: 10,
        lowStockThreshold: 2,
        isDefault: true,
        isActive: true,
      },
    });
  }
  
  console.log('✓ Demo products seeded');
}

async function seedPlatformSettings() {
  console.log('Seeding platform settings...');
  
  await prisma.platformSettings.upsert({
    where: { id: 'default' },
    update: {},
    create: {
      id: 'default',
      platformName: 'Airavat B2B Marketplace',
      supportEmail: 'support@airavat.com',
      supportPhone: '+91-1800-123-4567',
      defaultCurrency: 'INR',
      supportedCurrencies: ['INR', 'AED', 'USD'],
      supportedCountries: ['IN', 'AE'],
      defaultCommissionRate: 5,
      minOrderValue: 1000,
      maxCODAmount: 50000,
      gstEnabled: true,
      vatEnabled: true,
      eInvoiceEnabled: true,
      eWayBillEnabled: true,
      eWayBillThreshold: 50000,
    },
  });
  
  console.log('✓ Platform settings seeded');
}

// =============================================================================
// MAIN SEED FUNCTION
// =============================================================================

async function main() {
  console.log('\n🌱 Starting database seed...\n');
  
  try {
    await seedCategories();
    await seedSubscriptionPlans();
    await seedHSNCodes();
    await seedAdminUser();
    await seedDemoBusinesses();
    await seedDemoProducts();
    await seedPlatformSettings();
    
    console.log('\n✅ Database seeded successfully!\n');
    
    console.log('Demo Credentials:');
    console.log('─'.repeat(40));
    console.log('Admin: admin@airavat.com / Admin@123');
    console.log('Seller: seller@demo.com / Demo@123');
    console.log('Buyer: buyer@demo.com / Demo@123');
    console.log('UAE Seller: uae-seller@demo.com / Demo@123');
    console.log('─'.repeat(40));
    
  } catch (error) {
    console.error('❌ Seed failed:', error);
    throw error;
  }
}

// Run seed
main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
