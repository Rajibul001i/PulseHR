/**
 * Verifies the schema-level rule that an employee can never hold two overlapping APPROVED
 * leave requests (migration 013). The approval transaction already refuses this; this script
 * goes around the application and writes to the database directly, to prove the database
 * refuses it too.
 *
 *   node scripts/verify-leave-overlap.mjs                      (SQLite, apps/api/pulsehr.db)
 *   DATABASE_URL=postgres://... node scripts/verify-leave-overlap.mjs   (PostgreSQL)
 *
 * Run after `npm run seed`. Leaves no rows behind.
 */
const url = process.env.DATABASE_URL;
let query;
let close = async () => {};

if (url) {
  const { default: pg } = await import('pg');
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  query = async (sql, params = []) => {
    let n = 0;
    return (await client.query(sql.replace(/\?/g, () => `$${++n}`), params)).rows;
  };
  close = () => client.end();
} else {
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync('apps/api/pulsehr.db');
  query = async (sql, params = []) => (/^\s*select/i.test(sql) ? db.prepare(sql).all(...params) : (db.prepare(sql).run(...params), []));
  close = async () => db.close();
}

const [e] = await query(`SELECT id, organisation_id FROM employee WHERE employment_status = 'ACTIVE' LIMIT 1`);
const ids = ['overlap-check-a', 'overlap-check-b', 'overlap-check-c'];
const insert = (id, start, end, status) =>
  query(
    `INSERT INTO leave_request (id, organisation_id, employee_id, leave_type, start_date, end_date, days, status, reason, created_at)
     VALUES (?, ?, ?, 'CASUAL', ?, ?, 1, ?, 'overlap check', ?)`,
    [id, e.organisation_id, e.id, start, end, status, new Date().toISOString()],
  );

let failures = 0;
const check = (label, ok) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}`);
  if (!ok) failures++;
};

try {
  await insert(ids[0], '2099-03-10', '2099-03-12', 'APPROVED');

  let refused = false;
  try {
    await insert(ids[1], '2099-03-12', '2099-03-14', 'APPROVED');
  } catch {
    refused = true;
  }
  check('A second APPROVED request overlapping by one day is refused by the database', refused);

  await insert(ids[2], '2099-03-11', '2099-03-11', 'PENDING');
  check('An overlapping PENDING request is allowed (only approved leave must not overlap)', true);

  refused = false;
  try {
    await query(`UPDATE leave_request SET status = 'APPROVED' WHERE id = ?`, [ids[2]]);
  } catch {
    refused = true;
  }
  check('Approving that overlapping request directly in the database is refused', refused);

  await insert(ids[1], '2099-03-13', '2099-03-14', 'APPROVED');
  check('Back-to-back approved leave that does not overlap is allowed', true);
} finally {
  for (const id of ids) await query('DELETE FROM leave_request WHERE id = ?', [id]).catch(() => {});
  await close();
}

console.log(failures ? `\n${failures} failure(s)` : '\nall checks passed');
process.exit(failures ? 1 : 0);
