import { simpleList } from './helpers.js';

export default {
  name: 'reference',
  description: 'Reference data: countries, languages, currency codes',
  async run(ctx) {
    await simpleList(ctx, '/2.0/country', 'reference/countries', { csv: true });
    await simpleList(ctx, '/2.0/language', 'reference/languages');
    await simpleList(ctx, '/3.0/currencies/codes', 'reference/currency_codes', { style: 'single' });
  },
};
