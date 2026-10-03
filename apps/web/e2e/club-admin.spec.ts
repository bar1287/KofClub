import { expect, test } from '@playwright/test';
import { register, snap, uniqueName } from './helpers';

test('club staff manage members, chips and tables from the admin console', async ({ browser }) => {
  const ownerCtx = await browser.newContext();
  const bobCtx = await browser.newContext();
  const owner = await ownerCtx.newPage();
  const bob = await bobCtx.newPage();
  owner.on('dialog', (d) => void d.accept());
  const ownerName = uniqueName('owner');
  const bobName = uniqueName('bob');

  await register(owner, ownerName);
  await register(bob, bobName);
  await owner.getByLabel('Club name').fill(`Admin Club ${ownerName}`);
  await owner.getByRole('button', { name: 'Create club' }).click();
  const joinCode = (await owner.getByTestId('join-code').textContent())?.trim() ?? '';
  const clubUrl = owner.url();
  await bob.getByLabel('Join or invite code').fill(joinCode);
  await bob.getByRole('button', { name: 'Join' }).click();
  await expect(bob).toHaveURL(clubUrl);

  // A table to close later.
  await owner.reload();
  await owner.getByLabel('Name', { exact: true }).fill('Doomed Table');
  await owner.getByRole('button', { name: 'Create table' }).click();
  await expect(owner.getByTestId('table-list')).toContainText('Doomed Table');

  await owner.getByRole('link', { name: 'Manage club' }).click();
  await expect(owner.getByRole('heading', { name: /^Manage / })).toBeVisible();

  // Chips: grant from the treasury; the ledger summary and balances follow.
  await owner.getByRole('tab', { name: 'Chips & ledger' }).click();
  const bobRow = owner.getByTestId('ledger-balances').locator(`tr[data-member="${bobName}"]`);
  await bobRow.getByLabel(`Chips for ${bobName}`).fill('700');
  await bobRow.getByRole('button', { name: 'Grant' }).click();
  await expect(owner.getByText(`Granted 700 chips to ${bobName}.`)).toBeVisible();
  await expect(bobRow).toContainText('700');
  await expect(owner.getByTestId('ledger-summary')).toContainText('700');
  await expect(owner.getByTestId('ledger-transactions')).toContainText('CLUB_GRANT');
  await snap(owner, '06-club-admin-chips');

  // Members: ban, then unban.
  await owner.getByRole('tab', { name: 'Members' }).click();
  const member = owner.getByTestId('admin-members').locator(`tr[data-member="${bobName}"]`);
  await member.getByRole('button', { name: 'Ban' }).click();
  await expect(owner.getByText(`${bobName} was banned.`)).toBeVisible();
  await bob.reload();
  await expect(bob.getByText('You are banned from this club')).toBeVisible();
  await owner.getByLabel('Member status').selectOption('BANNED');
  await owner
    .getByTestId('admin-members')
    .locator(`tr[data-member="${bobName}"]`)
    .getByRole('button', { name: 'Unban' })
    .click();
  await expect(owner.getByText(`${bobName} was unbanned.`)).toBeVisible();
  await bob.reload();
  await expect(bob.getByTestId('wallet-balance')).toHaveText('700');

  // Tables: close for good.
  await owner.getByRole('tab', { name: 'Tables' }).click();
  const table = owner.getByTestId('admin-tables').locator('tr[data-table="Doomed Table"]');
  await table.getByRole('button', { name: 'Close table' }).click();
  await expect(owner.getByText('Doomed Table is closed.')).toBeVisible();
  await expect(table).toContainText('CLOSED');

  // Everything above is in the audit trail.
  await owner.getByRole('tab', { name: 'Audit log' }).click();
  const audit = owner.getByTestId('audit-log');
  await expect(audit).toContainText('TABLE_CLOSED');
  await expect(audit).toContainText('MEMBER_BANNED');
  await expect(audit).toContainText('MEMBER_UNBANNED');

  // Members cannot open the console's staff tabs.
  await bob.goto(`${clubUrl}/admin`);
  await expect(bob.getByText('Club staff only.')).toBeVisible();

  await ownerCtx.close();
  await bobCtx.close();
});
