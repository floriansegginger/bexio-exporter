import { simpleList } from './helpers.js';

export default {
  name: 'banking',
  description: 'Bank accounts and bank payments',
  async run(ctx) {
    await simpleList(ctx, '/3.0/banking/accounts', 'banking/bank_accounts', { csv: true });
    await simpleList(ctx, '/4.0/banking/payments', 'banking/payments', { csv: true, style: 'perpage' });
  },
};
