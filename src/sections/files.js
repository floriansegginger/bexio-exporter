import { ensureFilesIndex, safe } from './helpers.js';
import { pMap, progress } from '../util.js';

export default {
  name: 'files',
  description: 'The file inbox: every uploaded file (archived included) plus where each one is used',
  async run(ctx) {
    const { client, store, opts } = ctx;
    const index = await ensureFilesIndex(ctx);
    const { list } = index;
    ctx.log(`files: ${list.length} in inbox`);
    if (!store.exists('files/index.json')) await store.writeJson('files/index.json', list);

    const tick = progress(ctx, 'files: downloaded', list.length);
    await pMap(
      list,
      async (file) => {
        await safe(ctx, `files/${file.id}`, async () => {
          if (!store.shouldSkip(file._path)) {
            const buf = await client.getBinary(`/3.0/files/${file.id}/download`);
            await store.writeBinary(file._path, buf);
          }
          if (!opts.fast && file._usage === undefined) {
            const usage = await client.getJson(`/3.0/files/${file.id}/usage`, undefined, { allow: [400, 404, 422] });
            file._usage = usage ?? null;
          }
        });
        tick();
      },
      opts.concurrency,
      { shouldStop: () => ctx.aborted },
    );

    await store.writeJson('files/index.json', list);
    await store.writeCsv('files/index.csv', list);
  },
};
