import { simpleList } from './helpers.js';

export default {
  name: 'tasks',
  description: 'Tasks with priorities and statuses',
  async run(ctx) {
    await simpleList(ctx, '/2.0/task', 'tasks/tasks', { csv: true });
    await simpleList(ctx, '/2.0/todo_priority', 'tasks/task_priorities');
    await simpleList(ctx, '/2.0/todo_status', 'tasks/task_status');
  },
};
