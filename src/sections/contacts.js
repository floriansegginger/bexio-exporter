import { collect, simpleList, safe } from './helpers.js';
import { pMap, progress } from '../util.js';

export default {
  name: 'contacts',
  description: 'Contacts (active and archived), groups, sectors, relations, additional addresses, salutations, titles, notes',
  async run(ctx) {
    const { client, opts } = ctx;
    const contacts = await collect(
      ctx,
      'contacts/contacts',
      async () => {
        const active = await client.listOffset('/2.0/contact');
        const archived = await client.listOffset('/2.0/contact', { show_archived: true });
        return [
          ...active.map((c) => ({ ...c, _archived: false })),
          ...archived.map((c) => ({ ...c, _archived: true })),
        ];
      },
      { csv: true },
    );
    await simpleList(ctx, '/2.0/contact_group', 'contacts/contact_groups');
    await simpleList(ctx, '/2.0/contact_branch', 'contacts/contact_sectors');
    await simpleList(ctx, '/2.0/contact_relation', 'contacts/contact_relations', { csv: true });
    await simpleList(ctx, '/2.0/salutation', 'contacts/salutations');
    await simpleList(ctx, '/2.0/title', 'contacts/titles');
    await simpleList(ctx, '/2.0/note', 'contacts/notes', { csv: true });

    if (!opts.fast) {
      await collect(
        ctx,
        'contacts/additional_addresses',
        async () => {
          const tick = progress(ctx, 'contacts: additional addresses', contacts.length);
          const rows = await pMap(
            contacts,
            async (contact) => {
              const list = await safe(ctx, `contact/${contact.id}/additional_address`, () =>
                client.listOffset(`/2.0/contact/${contact.id}/additional_address`, {}, { allow: [404] }),
              );
              tick();
              return (list ?? []).map((addr) => ({ contact_id: contact.id, ...addr }));
            },
            opts.concurrency,
            { shouldStop: () => ctx.aborted },
          );
          return rows.flat();
        },
        { csv: true },
      );
    }
  },
};
