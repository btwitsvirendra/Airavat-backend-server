// =============================================================================
// AIRAVAT B2B MARKETPLACE - ELASTICSEARCH SEARCH SERVICE
// Advanced product search, filtering, and suggestions
// =============================================================================

const { Client } = require('@elastic/elasticsearch');
const { prisma } = require('../config/database');
const { cache } = require('../config/redis');
const logger = require('../config/logger');
const config = require('../config');

class ElasticsearchService {
  constructor() {
    this.client = new Client({
      node: config.elasticsearch?.url || 'http://localhost:9200',
      auth: config.elasticsearch?.apiKey ? {
        apiKey: config.elasticsearch.apiKey,
      } : undefined,
    });
    
    this.indices = {
      products: 'airavat_products',
      businesses: 'airavat_businesses',
      categories: 'airavat_categories',
    };
  }
  
  // =============================================================================
  // INDEX MANAGEMENT
  // =============================================================================
  
  /**
   * Initialize all indices
   */
  async initializeIndices() {
    try {
      await this.createProductIndex();
      await this.createBusinessIndex();
      await this.createCategoryIndex();
      logger.info('Elasticsearch indices initialized');
    } catch (error) {
      logger.error('Failed to initialize Elasticsearch indices', { error: error.message });
    }
  }
  
  /**
   * Create products index with mappings
   */
  async createProductIndex() {
    const indexExists = await this.client.indices.exists({ index: this.indices.products });
    
    if (!indexExists) {
      await this.client.indices.create({
        index: this.indices.products,
        body: {
          settings: {
            number_of_shards: 2,
            number_of_replicas: 1,
            analysis: {
              analyzer: {
                product_analyzer: {
                  type: 'custom',
                  tokenizer: 'standard',
                  filter: ['lowercase', 'asciifolding', 'product_synonyms', 'product_stemmer'],
                },
                autocomplete_analyzer: {
                  type: 'custom',
                  tokenizer: 'autocomplete_tokenizer',
                  filter: ['lowercase'],
                },
              },
              tokenizer: {
                autocomplete_tokenizer: {
                  type: 'edge_ngram',
                  min_gram: 2,
                  max_gram: 20,
                  token_chars: ['letter', 'digit'],
                },
              },
              filter: {
                product_synonyms: {
                  type: 'synonym',
                  synonyms: [
                    'phone, mobile, smartphone',
                    'laptop, notebook, computer',
                    'tv, television',
                    'ac, air conditioner',
                    'fridge, refrigerator',
                  ],
                },
                product_stemmer: {
                  type: 'stemmer',
                  language: 'english',
                },
              },
            },
          },
          mappings: {
            properties: {
              id: { type: 'keyword' },
              name: {
                type: 'text',
                analyzer: 'product_analyzer',
                fields: {
                  keyword: { type: 'keyword' },
                  autocomplete: {
                    type: 'text',
                    analyzer: 'autocomplete_analyzer',
                    search_analyzer: 'standard',
                  },
                },
              },
              description: { type: 'text', analyzer: 'product_analyzer' },
              shortDescription: { type: 'text' },
              brand: {
                type: 'text',
                fields: { keyword: { type: 'keyword' } },
              },
              sku: { type: 'keyword' },
              slug: { type: 'keyword' },
              categoryId: { type: 'keyword' },
              categoryName: { type: 'keyword' },
              categoryPath: { type: 'keyword' },
              businessId: { type: 'keyword' },
              businessName: {
                type: 'text',
                fields: { keyword: { type: 'keyword' } },
              },
              businessVerified: { type: 'boolean' },
              businessCity: { type: 'keyword' },
              businessState: { type: 'keyword' },
              businessCountry: { type: 'keyword' },
              minPrice: { type: 'float' },
              maxPrice: { type: 'float' },
              currency: { type: 'keyword' },
              unit: { type: 'keyword' },
              minOrderQuantity: { type: 'integer' },
              hsnCode: { type: 'keyword' },
              gstRate: { type: 'float' },
              images: { type: 'keyword' },
              tags: { type: 'keyword' },
              attributes: { type: 'object', enabled: false },
              specifications: { type: 'object', enabled: false },
              status: { type: 'keyword' },
              averageRating: { type: 'float' },
              reviewCount: { type: 'integer' },
              orderCount: { type: 'integer' },
              viewCount: { type: 'integer' },
              organicScore: { type: 'float' },
              inStock: { type: 'boolean' },
              stockQuantity: { type: 'integer' },
              createdAt: { type: 'date' },
              updatedAt: { type: 'date' },
              location: { type: 'geo_point' },
            },
          },
        },
      });
      
      logger.info('Products index created');
    }
  }
  
  /**
   * Create businesses index
   */
  async createBusinessIndex() {
    const indexExists = await this.client.indices.exists({ index: this.indices.businesses });
    
    if (!indexExists) {
      await this.client.indices.create({
        index: this.indices.businesses,
        body: {
          settings: {
            number_of_shards: 1,
            number_of_replicas: 1,
          },
          mappings: {
            properties: {
              id: { type: 'keyword' },
              businessName: {
                type: 'text',
                fields: {
                  keyword: { type: 'keyword' },
                  autocomplete: {
                    type: 'text',
                    analyzer: 'autocomplete_analyzer',
                  },
                },
              },
              description: { type: 'text' },
              businessType: { type: 'keyword' },
              categories: { type: 'keyword' },
              city: { type: 'keyword' },
              state: { type: 'keyword' },
              country: { type: 'keyword' },
              pincode: { type: 'keyword' },
              verificationStatus: { type: 'keyword' },
              trustScore: { type: 'float' },
              averageRating: { type: 'float' },
              totalReviews: { type: 'integer' },
              totalProducts: { type: 'integer' },
              responseRate: { type: 'float' },
              responseTime: { type: 'integer' },
              establishedYear: { type: 'integer' },
              logo: { type: 'keyword' },
              location: { type: 'geo_point' },
              createdAt: { type: 'date' },
            },
          },
        },
      });
      
      logger.info('Businesses index created');
    }
  }
  
  /**
   * Create categories index
   */
  async createCategoryIndex() {
    const indexExists = await this.client.indices.exists({ index: this.indices.categories });
    
    if (!indexExists) {
      await this.client.indices.create({
        index: this.indices.categories,
        body: {
          mappings: {
            properties: {
              id: { type: 'keyword' },
              name: {
                type: 'text',
                fields: {
                  keyword: { type: 'keyword' },
                  autocomplete: {
                    type: 'text',
                    analyzer: 'autocomplete_analyzer',
                  },
                },
              },
              slug: { type: 'keyword' },
              parentId: { type: 'keyword' },
              path: { type: 'keyword' },
              level: { type: 'integer' },
              productCount: { type: 'integer' },
              icon: { type: 'keyword' },
            },
          },
        },
      });
      
      logger.info('Categories index created');
    }
  }
  
  // =============================================================================
  // INDEXING OPERATIONS
  // =============================================================================
  
  /**
   * Index a single product
   */
  async indexProduct(product) {
    try {
      const doc = this.transformProductForIndex(product);
      
      await this.client.index({
        index: this.indices.products,
        id: product.id,
        body: doc,
        refresh: true,
      });
      
      logger.debug('Product indexed', { productId: product.id });
    } catch (error) {
      logger.error('Failed to index product', { productId: product.id, error: error.message });
    }
  }
  
  /**
   * Bulk index products
   */
  async bulkIndexProducts(products) {
    try {
      const operations = products.flatMap((product) => [
        { index: { _index: this.indices.products, _id: product.id } },
        this.transformProductForIndex(product),
      ]);
      
      const result = await this.client.bulk({ body: operations, refresh: true });
      
      if (result.errors) {
        logger.warn('Bulk indexing had some errors', {
          errorCount: result.items.filter((item) => item.index?.error).length,
        });
      }
      
      logger.info('Bulk indexed products', { count: products.length });
      
      return result;
    } catch (error) {
      logger.error('Bulk indexing failed', { error: error.message });
      throw error;
    }
  }
  
  /**
   * Transform product for Elasticsearch
   */
  transformProductForIndex(product) {
    return {
      id: product.id,
      name: product.name,
      description: product.description,
      shortDescription: product.shortDescription,
      brand: product.brand,
      sku: product.sku,
      slug: product.slug,
      categoryId: product.categoryId,
      categoryName: product.category?.name,
      categoryPath: product.category?.path,
      businessId: product.businessId,
      businessName: product.business?.businessName,
      businessVerified: product.business?.verificationStatus === 'VERIFIED',
      businessCity: product.business?.city,
      businessState: product.business?.state,
      businessCountry: product.business?.country,
      minPrice: parseFloat(product.minPrice || 0),
      maxPrice: parseFloat(product.maxPrice || 0),
      currency: product.currency || 'INR',
      unit: product.unit,
      minOrderQuantity: product.minOrderQuantity,
      hsnCode: product.hsnCode,
      gstRate: product.gstRate,
      images: product.images,
      tags: product.tags,
      attributes: product.attributes,
      specifications: product.specifications,
      status: product.status,
      averageRating: product.averageRating || 0,
      reviewCount: product.reviewCount || 0,
      orderCount: product.orderCount || 0,
      viewCount: product.viewCount || 0,
      organicScore: product.organicScore || 0,
      inStock: product.variants?.some((v) => v.stockQuantity > 0) || false,
      stockQuantity: product.variants?.reduce((sum, v) => sum + (v.stockQuantity || 0), 0) || 0,
      createdAt: product.createdAt,
      updatedAt: product.updatedAt,
      location: product.business?.latitude && product.business?.longitude ? {
        lat: product.business.latitude,
        lon: product.business.longitude,
      } : null,
    };
  }
  
  /**
   * Delete product from index
   */
  async deleteProduct(productId) {
    try {
      await this.client.delete({
        index: this.indices.products,
        id: productId,
        refresh: true,
      });
    } catch (error) {
      if (error.meta?.statusCode !== 404) {
        logger.error('Failed to delete product from index', { productId, error: error.message });
      }
    }
  }
  
  // =============================================================================
  // SEARCH OPERATIONS
  // =============================================================================
  
  /**
   * Search products
   */
  async searchProducts(options = {}) {
    const {
      query,
      category,
      brand,
      minPrice,
      maxPrice,
      rating,
      verified,
      inStock,
      city,
      state,
      country,
      sort = 'relevance',
      page = 1,
      limit = 20,
      aggregations = true,
    } = options;
    
    const must = [];
    const filter = [];
    
    // Full-text search
    if (query) {
      must.push({
        multi_match: {
          query,
          fields: [
            'name^3',
            'name.autocomplete^2',
            'brand^2',
            'description',
            'tags',
            'categoryName',
          ],
          type: 'best_fields',
          fuzziness: 'AUTO',
          prefix_length: 2,
        },
      });
    }
    
    // Filters
    filter.push({ term: { status: 'ACTIVE' } });
    
    if (category) {
      filter.push({
        bool: {
          should: [
            { term: { categoryId: category } },
            { term: { 'categoryPath': category } },
          ],
        },
      });
    }
    
    if (brand) {
      const brands = Array.isArray(brand) ? brand : [brand];
      filter.push({ terms: { 'brand.keyword': brands } });
    }
    
    if (minPrice !== undefined) {
      filter.push({ range: { minPrice: { gte: minPrice } } });
    }
    
    if (maxPrice !== undefined) {
      filter.push({ range: { maxPrice: { lte: maxPrice } } });
    }
    
    if (rating !== undefined) {
      filter.push({ range: { averageRating: { gte: rating } } });
    }
    
    if (verified === true) {
      filter.push({ term: { businessVerified: true } });
    }
    
    if (inStock === true) {
      filter.push({ term: { inStock: true } });
    }
    
    if (city) {
      filter.push({ term: { businessCity: city } });
    }
    
    if (state) {
      filter.push({ term: { businessState: state } });
    }
    
    if (country) {
      filter.push({ term: { businessCountry: country } });
    }
    
    // Sorting
    let sortConfig;
    switch (sort) {
      case 'price_low':
        sortConfig = [{ minPrice: 'asc' }];
        break;
      case 'price_high':
        sortConfig = [{ minPrice: 'desc' }];
        break;
      case 'rating':
        sortConfig = [{ averageRating: 'desc' }, { reviewCount: 'desc' }];
        break;
      case 'newest':
        sortConfig = [{ createdAt: 'desc' }];
        break;
      case 'popular':
        sortConfig = [{ orderCount: 'desc' }, { viewCount: 'desc' }];
        break;
      case 'relevance':
      default:
        if (query) {
          sortConfig = [{ _score: 'desc' }, { organicScore: 'desc' }];
        } else {
          sortConfig = [{ organicScore: 'desc' }, { averageRating: 'desc' }];
        }
    }
    
    // Build aggregations
    const aggs = aggregations ? {
      categories: {
        terms: { field: 'categoryName', size: 20 },
      },
      brands: {
        terms: { field: 'brand.keyword', size: 30 },
      },
      priceRange: {
        stats: { field: 'minPrice' },
      },
      ratings: {
        histogram: { field: 'averageRating', interval: 1, min_doc_count: 0 },
      },
      cities: {
        terms: { field: 'businessCity', size: 20 },
      },
      states: {
        terms: { field: 'businessState', size: 20 },
      },
    } : undefined;
    
    try {
      const result = await this.client.search({
        index: this.indices.products,
        body: {
          from: (page - 1) * limit,
          size: limit,
          query: {
            bool: {
              must: must.length > 0 ? must : [{ match_all: {} }],
              filter,
            },
          },
          sort: sortConfig,
          aggs,
          highlight: query ? {
            fields: {
              name: {},
              description: { number_of_fragments: 2 },
            },
            pre_tags: ['<mark>'],
            post_tags: ['</mark>'],
          } : undefined,
        },
      });
      
      return {
        products: result.hits.hits.map((hit) => ({
          ...hit._source,
          _score: hit._score,
          _highlight: hit.highlight,
        })),
        total: result.hits.total.value,
        aggregations: result.aggregations ? {
          categories: result.aggregations.categories?.buckets || [],
          brands: result.aggregations.brands?.buckets || [],
          priceRange: {
            min: result.aggregations.priceRange?.min || 0,
            max: result.aggregations.priceRange?.max || 0,
          },
          ratings: result.aggregations.ratings?.buckets || [],
          cities: result.aggregations.cities?.buckets || [],
          states: result.aggregations.states?.buckets || [],
        } : null,
      };
    } catch (error) {
      logger.error('Elasticsearch search failed', { error: error.message, query });
      throw error;
    }
  }
  
  /**
   * Autocomplete suggestions
   */
  async getAutocompleteSuggestions(query, limit = 10) {
    if (!query || query.length < 2) {
      return { products: [], categories: [], brands: [] };
    }
    
    // Check cache
    const cacheKey = `autocomplete:${query.toLowerCase()}`;
    const cached = await cache.get(cacheKey);
    if (cached) return cached;
    
    try {
      const [products, categories, brands] = await Promise.all([
        // Product name suggestions
        this.client.search({
          index: this.indices.products,
          body: {
            size: limit,
            query: {
              bool: {
                must: [
                  {
                    match: {
                      'name.autocomplete': {
                        query,
                        operator: 'and',
                      },
                    },
                  },
                ],
                filter: [{ term: { status: 'ACTIVE' } }],
              },
            },
            _source: ['name', 'slug', 'images', 'minPrice', 'categoryName'],
            collapse: { field: 'name.keyword' },
          },
        }),
        
        // Category suggestions
        this.client.search({
          index: this.indices.categories,
          body: {
            size: 5,
            query: {
              match: {
                'name.autocomplete': query,
              },
            },
            _source: ['name', 'slug', 'productCount'],
          },
        }),
        
        // Brand suggestions
        this.client.search({
          index: this.indices.products,
          body: {
            size: 0,
            query: {
              bool: {
                must: [
                  {
                    prefix: {
                      'brand.keyword': {
                        value: query,
                        case_insensitive: true,
                      },
                    },
                  },
                ],
                filter: [{ term: { status: 'ACTIVE' } }],
              },
            },
            aggs: {
              brands: {
                terms: { field: 'brand.keyword', size: 5 },
              },
            },
          },
        }),
      ]);
      
      const result = {
        products: products.hits.hits.map((hit) => hit._source),
        categories: categories.hits.hits.map((hit) => hit._source),
        brands: brands.aggregations?.brands?.buckets?.map((b) => b.key) || [],
      };
      
      // Cache for 5 minutes
      await cache.set(cacheKey, result, 300);
      
      return result;
    } catch (error) {
      logger.error('Autocomplete failed', { error: error.message, query });
      return { products: [], categories: [], brands: [] };
    }
  }
  
  /**
   * Get similar products
   */
  async getSimilarProducts(productId, limit = 10) {
    try {
      // Get the product first
      const product = await this.client.get({
        index: this.indices.products,
        id: productId,
      });
      
      if (!product._source) {
        return [];
      }
      
      // More-like-this query
      const result = await this.client.search({
        index: this.indices.products,
        body: {
          size: limit,
          query: {
            bool: {
              must: [
                {
                  more_like_this: {
                    fields: ['name', 'description', 'tags', 'categoryName'],
                    like: [
                      {
                        _index: this.indices.products,
                        _id: productId,
                      },
                    ],
                    min_term_freq: 1,
                    min_doc_freq: 1,
                    max_query_terms: 25,
                  },
                },
              ],
              filter: [
                { term: { status: 'ACTIVE' } },
                { term: { inStock: true } },
              ],
              must_not: [
                { term: { id: productId } },
              ],
            },
          },
          _source: ['id', 'name', 'slug', 'images', 'minPrice', 'averageRating', 'businessName'],
        },
      });
      
      return result.hits.hits.map((hit) => hit._source);
    } catch (error) {
      logger.error('Failed to get similar products', { productId, error: error.message });
      return [];
    }
  }
  
  /**
   * Search businesses
   */
  async searchBusinesses(options = {}) {
    const { query, city, state, country, verified, category, sort, page = 1, limit = 20 } = options;
    
    const must = [];
    const filter = [];
    
    if (query) {
      must.push({
        multi_match: {
          query,
          fields: ['businessName^3', 'businessName.autocomplete^2', 'description'],
          fuzziness: 'AUTO',
        },
      });
    }
    
    if (verified === true) {
      filter.push({ term: { verificationStatus: 'VERIFIED' } });
    }
    
    if (city) filter.push({ term: { city } });
    if (state) filter.push({ term: { state } });
    if (country) filter.push({ term: { country } });
    if (category) filter.push({ term: { categories: category } });
    
    let sortConfig;
    switch (sort) {
      case 'rating':
        sortConfig = [{ averageRating: 'desc' }];
        break;
      case 'reviews':
        sortConfig = [{ totalReviews: 'desc' }];
        break;
      case 'trust':
        sortConfig = [{ trustScore: 'desc' }];
        break;
      default:
        sortConfig = query ? [{ _score: 'desc' }] : [{ trustScore: 'desc' }];
    }
    
    try {
      const result = await this.client.search({
        index: this.indices.businesses,
        body: {
          from: (page - 1) * limit,
          size: limit,
          query: {
            bool: {
              must: must.length > 0 ? must : [{ match_all: {} }],
              filter,
            },
          },
          sort: sortConfig,
        },
      });
      
      return {
        businesses: result.hits.hits.map((hit) => hit._source),
        total: result.hits.total.value,
      };
    } catch (error) {
      logger.error('Business search failed', { error: error.message });
      throw error;
    }
  }
  
  // =============================================================================
  // REINDEXING
  // =============================================================================
  
  /**
   * Reindex all products from database
   */
  async reindexAllProducts(batchSize = 100) {
    logger.info('Starting full product reindex');
    
    let skip = 0;
    let indexed = 0;
    
    while (true) {
      const products = await prisma.product.findMany({
        skip,
        take: batchSize,
        include: {
          business: true,
          category: true,
          variants: {
            where: { isActive: true },
            select: { stockQuantity: true },
          },
        },
      });
      
      if (products.length === 0) break;
      
      await this.bulkIndexProducts(products);
      
      indexed += products.length;
      skip += batchSize;
      
      logger.info(`Reindexed ${indexed} products`);
    }
    
    logger.info(`Full reindex complete. Total: ${indexed} products`);
    
    return indexed;
  }
  
  /**
   * Health check
   */
  async healthCheck() {
    try {
      const health = await this.client.cluster.health();
      return {
        status: health.status,
        numberOfNodes: health.number_of_nodes,
        activeShards: health.active_shards,
      };
    } catch (error) {
      return { status: 'unavailable', error: error.message };
    }
  }
}

module.exports = new ElasticsearchService();
