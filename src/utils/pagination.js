// =============================================================================
// AIRAVAT B2B MARKETPLACE - PAGINATION UTILITY
// Flexible pagination with cursor-based and offset-based support
// =============================================================================

const crypto = require('crypto');

/**
 * Pagination configuration
 */
const CONFIG = {
  defaultLimit: 20,
  maxLimit: 100,
  defaultPage: 1,
};

/**
 * Encode cursor for cursor-based pagination
 */
function encodeCursor(data) {
  return Buffer.from(JSON.stringify(data)).toString('base64url');
}

/**
 * Decode cursor
 */
function decodeCursor(cursor) {
  try {
    return JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

/**
 * Parse pagination parameters from request
 */
function parsePaginationParams(query) {
  const page = Math.max(1, parseInt(query.page) || CONFIG.defaultPage);
  const limit = Math.min(
    CONFIG.maxLimit,
    Math.max(1, parseInt(query.limit) || CONFIG.defaultLimit)
  );
  const cursor = query.cursor || null;
  const sortBy = query.sortBy || 'createdAt';
  const sortOrder = query.sortOrder === 'asc' ? 'asc' : 'desc';

  return {
    page,
    limit,
    cursor,
    sortBy,
    sortOrder,
    skip: (page - 1) * limit,
  };
}

/**
 * Build Prisma pagination arguments for offset-based pagination
 */
function buildOffsetPagination(params) {
  return {
    skip: params.skip,
    take: params.limit,
    orderBy: {
      [params.sortBy]: params.sortOrder,
    },
  };
}

/**
 * Build Prisma pagination arguments for cursor-based pagination
 */
function buildCursorPagination(params, cursorField = 'id') {
  const pagination = {
    take: params.limit,
    orderBy: {
      [params.sortBy]: params.sortOrder,
    },
  };

  if (params.cursor) {
    const decoded = decodeCursor(params.cursor);
    if (decoded) {
      pagination.cursor = { [cursorField]: decoded.id };
      pagination.skip = 1; // Skip the cursor item itself
    }
  }

  return pagination;
}

/**
 * Create pagination response for offset-based pagination
 */
function createOffsetPaginationResponse(items, total, params) {
  const totalPages = Math.ceil(total / params.limit);

  return {
    data: items,
    pagination: {
      page: params.page,
      limit: params.limit,
      total,
      totalPages,
      hasNextPage: params.page < totalPages,
      hasPrevPage: params.page > 1,
      nextPage: params.page < totalPages ? params.page + 1 : null,
      prevPage: params.page > 1 ? params.page - 1 : null,
    },
  };
}

/**
 * Create pagination response for cursor-based pagination
 */
function createCursorPaginationResponse(items, params, cursorField = 'id') {
  const hasMore = items.length === params.limit;
  const lastItem = items[items.length - 1];

  return {
    data: items,
    pagination: {
      limit: params.limit,
      hasMore,
      nextCursor: hasMore && lastItem
        ? encodeCursor({ id: lastItem[cursorField], sortBy: params.sortBy })
        : null,
      prevCursor: params.cursor,
    },
  };
}

/**
 * Paginate array in memory
 */
function paginateArray(array, page, limit) {
  const start = (page - 1) * limit;
  const end = start + limit;
  const items = array.slice(start, end);

  return createOffsetPaginationResponse(items, array.length, {
    page,
    limit,
  });
}

/**
 * Create pagination links for HATEOAS
 */
function createPaginationLinks(baseUrl, params, total) {
  const totalPages = Math.ceil(total / params.limit);
  const links = {
    self: `${baseUrl}?page=${params.page}&limit=${params.limit}`,
    first: `${baseUrl}?page=1&limit=${params.limit}`,
    last: `${baseUrl}?page=${totalPages}&limit=${params.limit}`,
  };

  if (params.page > 1) {
    links.prev = `${baseUrl}?page=${params.page - 1}&limit=${params.limit}`;
  }

  if (params.page < totalPages) {
    links.next = `${baseUrl}?page=${params.page + 1}&limit=${params.limit}`;
  }

  return links;
}

/**
 * Pagination middleware
 */
function paginationMiddleware(options = {}) {
  const { maxLimit = CONFIG.maxLimit, defaultLimit = CONFIG.defaultLimit } = options;

  return (req, res, next) => {
    req.pagination = parsePaginationParams(req.query);
    req.pagination.limit = Math.min(req.pagination.limit, maxLimit);

    // Helper methods
    req.paginate = {
      offset: () => buildOffsetPagination(req.pagination),
      cursor: (field) => buildCursorPagination(req.pagination, field),
    };

    res.paginate = {
      offset: (items, total) =>
        createOffsetPaginationResponse(items, total, req.pagination),
      cursor: (items, field) =>
        createCursorPaginationResponse(items, req.pagination, field),
    };

    next();
  };
}

/**
 * Infinite scroll pagination helper
 */
class InfiniteScrollPagination {
  constructor(options = {}) {
    this.limit = options.limit || 20;
    this.cursorField = options.cursorField || 'id';
  }

  buildQuery(cursor) {
    const query = { take: this.limit };

    if (cursor) {
      const decoded = decodeCursor(cursor);
      if (decoded) {
        query.cursor = { [this.cursorField]: decoded.value };
        query.skip = 1;
      }
    }

    return query;
  }

  formatResponse(items) {
    const hasMore = items.length === this.limit;
    const lastItem = items[items.length - 1];

    return {
      items,
      hasMore,
      nextCursor: hasMore && lastItem
        ? encodeCursor({ value: lastItem[this.cursorField] })
        : null,
    };
  }
}

/**
 * Keyset pagination for large datasets
 */
class KeysetPagination {
  constructor(options = {}) {
    this.limit = options.limit || 20;
    this.sortField = options.sortField || 'createdAt';
    this.sortOrder = options.sortOrder || 'desc';
    this.idField = options.idField || 'id';
  }

  buildWhere(after) {
    if (!after) return {};

    const decoded = decodeCursor(after);
    if (!decoded) return {};

    // For descending order, get items with smaller sort value
    // or same sort value with smaller id
    if (this.sortOrder === 'desc') {
      return {
        OR: [
          { [this.sortField]: { lt: decoded.sortValue } },
          {
            AND: [
              { [this.sortField]: decoded.sortValue },
              { [this.idField]: { lt: decoded.id } },
            ],
          },
        ],
      };
    }

    // For ascending order
    return {
      OR: [
        { [this.sortField]: { gt: decoded.sortValue } },
        {
          AND: [
            { [this.sortField]: decoded.sortValue },
            { [this.idField]: { gt: decoded.id } },
          ],
        },
      ],
    };
  }

  buildOrderBy() {
    return [
      { [this.sortField]: this.sortOrder },
      { [this.idField]: this.sortOrder },
    ];
  }

  formatResponse(items) {
    const hasMore = items.length === this.limit;
    const lastItem = items[items.length - 1];

    return {
      items,
      hasMore,
      nextCursor: hasMore && lastItem
        ? encodeCursor({
            id: lastItem[this.idField],
            sortValue: lastItem[this.sortField],
          })
        : null,
    };
  }
}

/**
 * Search pagination with aggregations
 */
function createSearchPaginationResponse(searchResult, params) {
  return {
    data: searchResult.hits,
    pagination: {
      page: params.page,
      limit: params.limit,
      total: searchResult.total,
      totalPages: Math.ceil(searchResult.total / params.limit),
      hasNextPage: params.page * params.limit < searchResult.total,
    },
    aggregations: searchResult.aggregations,
    took: searchResult.took,
  };
}

module.exports = {
  CONFIG,
  encodeCursor,
  decodeCursor,
  parsePaginationParams,
  buildOffsetPagination,
  buildCursorPagination,
  createOffsetPaginationResponse,
  createCursorPaginationResponse,
  paginateArray,
  createPaginationLinks,
  paginationMiddleware,
  InfiniteScrollPagination,
  KeysetPagination,
  createSearchPaginationResponse,
};
