import { simpleList, safe } from './helpers.js';
import { imageExt } from '../util.js';

export default {
  name: 'company',
  description: 'Company profile and logo, users, permissions, document templates and settings, payment types',
  async run(ctx) {
    const { client, store } = ctx;
    await safe(ctx, 'company/company_profile', async () => {
      if (store.shouldSkip('company/company_profile.json')) return;
      const profiles = await client.getJson('/2.0/company_profile');
      await store.writeJson('company/company_profile.json', profiles);
      for (const profile of Array.isArray(profiles) ? profiles : [profiles]) {
        if (profile?.logo_base64) {
          const buf = Buffer.from(profile.logo_base64, 'base64');
          await store.writeBinary(`company/logo_${profile.id ?? 1}.${imageExt(buf)}`, buf);
        }
      }
      ctx.log(`company/company_profile: ${Array.isArray(profiles) ? profiles.length : 1}`);
    });
    await simpleList(ctx, '/3.0/users', 'company/users', { csv: true });
    await simpleList(ctx, '/3.0/fictional_users', 'company/fictional_users');
    await simpleList(ctx, '/3.0/users/me', 'company/me', { style: 'single' });
    await simpleList(ctx, '/3.0/permissions', 'company/permissions', { style: 'single' });
    await simpleList(ctx, '/3.0/document_templates', 'company/document_templates', { style: 'single' });
    await simpleList(ctx, '/2.0/kb_item_setting', 'company/document_settings', { style: 'single' });
    await simpleList(ctx, '/2.0/payment_type', 'company/payment_types');
  },
};
