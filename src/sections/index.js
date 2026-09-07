import company from './company.js';
import reference from './reference.js';
import contacts from './contacts.js';
import files from './files.js';
import sales from './sales.js';
import purchase from './purchase.js';
import accounting from './accounting.js';
import banking from './banking.js';
import items from './items.js';
import projects from './projects.js';
import tasks from './tasks.js';
import payroll from './payroll.js';

/** Export order matters: `files` runs before sections that link receipts to documents. */
export const SECTIONS = [company, reference, contacts, files, sales, purchase, accounting, banking, items, projects, tasks, payroll];
