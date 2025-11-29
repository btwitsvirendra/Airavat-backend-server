// =============================================================================
// AIRAVAT B2B MARKETPLACE - TEST SEQUENCER
// Controls the order of test execution
// =============================================================================

const Sequencer = require('@jest/test-sequencer').default;

class CustomSequencer extends Sequencer {
  // Define test priority order
  static ORDER = [
    'setup',
    'auth',
    'user',
    'business',
    'category',
    'product',
    'cart',
    'order',
    'payment',
    'review',
    'rfq',
    'chat',
    'search',
    'admin',
  ];

  sort(tests) {
    // Sort tests based on priority order
    return tests.sort((a, b) => {
      const getOrder = (test) => {
        const filename = test.path.toLowerCase();
        for (let i = 0; i < CustomSequencer.ORDER.length; i++) {
          if (filename.includes(CustomSequencer.ORDER[i])) {
            return i;
          }
        }
        return CustomSequencer.ORDER.length;
      };

      return getOrder(a) - getOrder(b);
    });
  }
}

module.exports = CustomSequencer;
