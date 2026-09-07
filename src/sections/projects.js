import { collect, fetchOrRead, folderNames, safe, simpleList } from './helpers.js';
import { pMap, progress } from '../util.js';

export default {
  name: 'projects',
  description: 'Projects with milestones and work packages, timesheets, business activities, communication types',
  async run(ctx) {
    const { client, opts } = ctx;
    const projects = await simpleList(ctx, '/2.0/pr_project', 'projects/projects', { csv: true });
    await simpleList(ctx, '/2.0/pr_project_state', 'projects/project_states', { style: 'single' });
    await simpleList(ctx, '/2.0/pr_project_type', 'projects/project_types', { style: 'single' });

    const names = folderNames(projects, (p) => (p.nr ? `${p.nr}_${p.name ?? ''}` : p.name));
    const milestones = [];
    const packages = [];
    const tick = progress(ctx, 'projects: milestones and work packages', projects.length);
    await pMap(
      projects,
      async (project) => {
        const dir = `projects/projects/${names.get(project)}`;
        await safe(ctx, `projects/${project.id}`, async () => {
          const ms = await fetchOrRead(ctx, `${dir}/milestones.json`, () =>
            client.listOffset(`/3.0/projects/${project.id}/milestones`, {}, { allow: [404] }),
          );
          for (const m of ms ?? []) milestones.push({ project_id: project.id, project_nr: project.nr, ...m });
          const wp = await fetchOrRead(ctx, `${dir}/work_packages.json`, () =>
            client.listOffset(`/3.0/projects/${project.id}/packages`, {}, { allow: [404] }),
          );
          for (const w of wp ?? []) packages.push({ project_id: project.id, project_nr: project.nr, ...w });
        });
        tick();
      },
      opts.concurrency,
      { shouldStop: () => ctx.aborted },
    );
    await collect(ctx, 'projects/milestones', async () => milestones, { csv: true });
    await collect(ctx, 'projects/work_packages', async () => packages, { csv: true });

    await simpleList(ctx, '/2.0/timesheet', 'projects/timesheets', { csv: true });
    await simpleList(ctx, '/2.0/timesheet_status', 'projects/timesheet_status');
    await simpleList(ctx, '/2.0/client_service', 'projects/business_activities');
    await simpleList(ctx, '/2.0/communication_kind', 'projects/communication_types');
  },
};
