import { simpleList } from './helpers.js';

export default {
  name: 'items',
  description: 'Items / products, stock locations and areas, units',
  async run(ctx) {
    await simpleList(ctx, '/2.0/article', 'items/items', { csv: true });
    await simpleList(ctx, '/2.0/stock', 'items/stock_locations');
    await simpleList(ctx, '/2.0/stock_place', 'items/stock_areas');
    await simpleList(ctx, '/2.0/unit', 'items/units');
  },
};
