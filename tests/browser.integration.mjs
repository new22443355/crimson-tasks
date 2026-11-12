import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const base = new URL(process.env.TEST_BASE_URL ?? 'http://127.0.0.1:3000').origin;
const output = await mkdtemp(path.join(tmpdir(), 'crimson-browser-'));
const username = `qa_ui_${randomBytes(7).toString('hex')}`;
const password = randomBytes(2).toString('hex');
const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, timezoneId: 'Europe/Moscow' });
const page = await context.newPage();
page.setDefaultTimeout(15_000);
const errors = [];
const externalRequests = [];
const checks = [];
let authenticated = false;
page.on('pageerror', error => errors.push(error.message));
page.on('request', request => {
  const url = new URL(request.url());
  if (['http:', 'https:'].includes(url.protocol) && url.origin !== base) externalRequests.push(url.origin);
});

async function api(route, method = 'GET', body) {
  const response = await context.request.fetch(`${base}/api${route}`, { method, headers: { Origin: base }, ...(body === undefined ? {} : { data: body }) });
  assert.ok(response.ok(), `${method} ${route}: HTTP ${response.status()}`);
  return response.json();
}
async function check(name, run) { await run(); checks.push(name); console.log(`PASS: ${name}`); }
async function rows(expected) {
  await page.waitForFunction(count => document.querySelectorAll('.task-row').length === count, expected);
}
async function closeDialog() { await page.locator('dialog.modal').getByRole('button', { name: 'Закрыть окно' }).click(); }
async function select(id, option) {
  await page.locator(`#${id}`).click();
  await page.getByRole('option', { name: option, exact: true }).click();
}
async function date(id, value) {
  await page.locator(`#${id}`).click();
  if (value === '') await page.locator('.calendar-panel').getByRole('button', { name: 'Очистить', exact: true }).click();
  else await page.locator(`.calendar-panel button[data-day="${value}"]`).click();
}
async function filterButton() { await page.locator('.tasks-section .filter-trigger').click(); }
async function applyFilters() {
  await page.locator('dialog.modal').getByRole('button', { name: 'Применить', exact: true }).click();
  await page.locator('dialog.modal').waitFor({ state: 'hidden' });
}
async function resetTaskFilters() {
  const reset = page.getByRole('button', { name: 'Сбросить фильтры', exact: true });
  if (await reset.count()) await reset.click();
}
async function boundedModal() {
  const geometry = await page.locator('dialog.modal').evaluate(element => {
    const box = element.getBoundingClientRect();
    return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: innerWidth, height: innerHeight, scroll: element.scrollWidth, client: element.clientWidth };
  });
  assert.ok(geometry.left >= -1 && geometry.top >= -1 && geometry.right <= geometry.width + 1 && geometry.bottom <= geometry.height + 1, 'Dialog stays inside viewport');
  assert.ok(geometry.scroll <= geometry.client + 1, 'Dialog has no horizontal overflow');
}
async function noHorizontalOverflow() {
  const geometry = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: document.documentElement.clientWidth }));
  assert.ok(geometry.scroll <= geometry.width + 1, `Page has no horizontal overflow (${geometry.scroll}/${geometry.width})`);
}
async function screenshot(name) { await page.screenshot({ path: path.join(output, `${name}.png`), fullPage: true }); }

try {
  await page.goto(base, { waitUntil: 'networkidle' });
  await check('registration accepts a four-character password', async () => {
    await page.locator('.auth-tabs').getByRole('button', { name: 'Создать аккаунт' }).click();
    assert.equal(await page.locator('#username').getAttribute('minlength'), '4');
    await page.getByLabel('Логин', { exact: true }).fill(username);
    await page.getByLabel('Пароль', { exact: true }).fill(password);
    await page.locator('.auth-form').getByRole('button', { name: 'Создать аккаунт' }).click();
    await page.getByRole('button', { name: 'Новая задача', exact: true }).waitFor();
    authenticated = true;
  });
  const today = await page.evaluate(() => {
    const value = new Date();
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
  });
  const next = new Date(`${today}T12:00:00Z`); next.setUTCDate(next.getUTCDate() + 1);
  const tomorrow = next.toISOString().slice(0, 10);
  const title = `Ёжик — курс ${randomBytes(3).toString('hex')}`;
  const note = 'Первая строка\nВторая строка\nМаршрут учёба';
  const longNote = 'длинная строка '.repeat(250);
  const longTitle = 'Подробный план для проверки заметки';
  let primary;

  await check('custom controls, persistent close style and automatic notes', async () => {
    await page.getByRole('button', { name: 'Новая задача', exact: true }).click();
    const modal = page.locator('dialog.modal');
    await modal.waitFor();
    assert.equal(await modal.locator('select,input[type="date"]').count(), 0);
    const close = modal.getByRole('button', { name: 'Закрыть окно' });
    const background = await close.evaluate(element => getComputedStyle(element).backgroundColor);
    assert.notEqual(background, 'rgba(0, 0, 0, 0)');
    const closeBox = await close.boundingBox();
    assert.ok(closeBox.width >= 44 && closeBox.height >= 44);
    await page.locator('#task-title').fill(title);
    assert.equal(await close.evaluate(element => getComputedStyle(element).backgroundColor), background);
    await close.hover();
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.modal-close')).backgroundColor === 'rgb(113, 28, 45)');
    await page.locator('#task-description').click();
    await page.waitForFunction(color => getComputedStyle(document.querySelector('.modal-close')).backgroundColor === color, background);
    const textarea = page.locator('#task-description');
    await textarea.fill('первая строка\nвторая строка');
    assert.equal(await textarea.inputValue(), 'Первая строка\nВторая строка');
    await textarea.press('End'); await textarea.press('Enter'); await textarea.pressSequentially('третья строка');
    assert.equal(await textarea.inputValue(), 'Первая строка\nВторая строка\nТретья строка');
    assert.equal(await textarea.evaluate(element => element.selectionStart), (await textarea.inputValue()).length);
    await textarea.fill(Array.from({ length: 150 }, (_, index) => `строка ${index}`).join('\n'));
    const size = await textarea.evaluate(element => ({ height: element.getBoundingClientRect().height, viewport: innerHeight, resize: getComputedStyle(element).resize, scroll: element.scrollHeight, client: element.clientHeight }));
    assert.equal(size.resize, 'none');
    assert.ok(size.height > 112 && size.height <= size.viewport * 0.45);
    assert.ok(size.scroll > size.client);
    await boundedModal();
    await textarea.fill('я'.repeat(5001));
    assert.equal((await textarea.inputValue()).length, 5000);
    await textarea.fill(note);
    await page.locator('#task-priority').click();
    await page.getByRole('option', { name: 'Обычный', exact: true }).press('Escape');
    assert.ok(await modal.isVisible());
    assert.equal(await page.getByRole('listbox').count(), 0);
    await page.locator('#task-priority').click();
    await page.getByRole('option', { name: 'Обычный', exact: true }).press('ArrowDown');
    await page.getByRole('option', { name: 'Высокий', exact: true }).press('Enter');
    assert.match(await page.locator('#task-priority').innerText(), /Высокий/);
    await page.locator('#task-date').click();
    await page.locator(`.calendar-panel [data-day="${today}"]`).press('Escape');
    assert.ok(await modal.isVisible());
    assert.equal(await page.locator('.calendar-panel').count(), 0);
    await page.locator('#task-date').click();
    await page.locator(`.calendar-panel [data-day="${today}"]`).press('ArrowRight');
    await page.locator(`.calendar-panel [data-day="${tomorrow}"]`).press('Enter');
    await date('task-date', today);
    await page.locator('#task-date').click();
    await boundedModal();
    await screenshot('desktop-calendar');
    await page.locator('.calendar-panel').getByRole('button', { name: 'Сегодня', exact: true }).click();
    await modal.getByRole('button', { name: 'Добавить задачу', exact: true }).click();
    await modal.waitFor({ state: 'hidden' });
    await rows(1);
    primary = (await api('/tasks')).tasks[0];
    assert.equal(primary.description, note);
    assert.equal(primary.dueDate, today);
    assert.equal(primary.priority, 'high');
  });

  const fixture = async (task, status) => {
    const created = (await api('/tasks', 'POST', task)).task;
    if (status) await api(`/tasks/${created.id}`, 'PATCH', status);
    return created;
  };
  await fixture({ title: 'Низкий приоритет без срока', priority: 'low' });
  await fixture({ title: 'Задача на завтра', priority: 'normal', dueDate: tomorrow });
  await fixture({ title: 'Завершённая важная задача', priority: 'high', dueDate: today }, { completed: true });
  await fixture({ title: 'Отменённый план', priority: 'normal', dueDate: today }, { cancelled: true });
  await fixture({ title: longTitle, description: longNote });
  await page.reload({ waitUntil: 'networkidle' });
  await rows(6);

  await check('priority, creation dates, due dates and statuses combine inclusively', async () => {
    await filterButton();
    await select('filter-priority', 'Высокий');
    for (const id of ['filter-created-from', 'filter-created-to', 'filter-due-from', 'filter-due-to']) await date(id, today);
    await applyFilters(); await rows(2);
    await page.locator('.filter-tabs').getByRole('button', { name: /^В работе/ }).click(); await rows(1);
    assert.equal(await page.locator('.task-title').innerText(), title);
    await page.locator('.filter-tabs').getByRole('button', { name: /^Выполнено/ }).click(); await rows(1);
    assert.equal(await page.locator('.task-title').innerText(), 'Завершённая важная задача');
    await filterButton();
    await date('filter-created-from', tomorrow); await date('filter-created-to', tomorrow);
    await applyFilters(); await rows(0);
    await filterButton();
    await date('filter-created-from', today); await date('filter-created-to', today);
    await select('filter-status', 'В работе');
    await applyFilters(); await rows(1);
  });

  const xssTitle = '<img src=x onerror="window.__crimsonXss=1">';
  await check('word search survives completion, cancellation, renaming and reload', async () => {
    await page.getByRole('textbox', { name: 'Поиск задач' }).fill('ежик УЧЕБ');
    await rows(1);
    await page.locator('.task-row').getByRole('checkbox').click();
    await page.locator('.task-completed').waitFor(); await rows(1);
    await page.reload({ waitUntil: 'networkidle' }); await rows(1);
    assert.equal(await page.getByRole('textbox', { name: 'Поиск задач' }).inputValue(), 'ежик УЧЕБ');
    await page.locator('.task-row').getByRole('button', { name: /^Отменить задачу:/ }).click();
    await page.locator('.task-cancelled').waitFor(); await rows(1);
    await page.locator('.task-row').getByRole('button', { name: /^Редактировать:/ }).click();
    await page.locator('#task-title').fill(xssTitle);
    await page.locator('#task-description').fill('Новое имя без прежних слов');
    await page.locator('dialog.modal').getByRole('button', { name: 'Сохранить изменения' }).click();
    await page.locator('dialog.modal').waitFor({ state: 'hidden' }); await rows(1);
    await page.reload({ waitUntil: 'networkidle' }); await rows(1);
    assert.equal(await page.locator('.task-title').innerText(), xssTitle);
    assert.equal(await page.locator('.task-row img').count(), 0);
    assert.equal(await page.evaluate(() => window.__crimsonXss ?? 0), 0);
    await screenshot('desktop-search');
    await page.getByRole('button', { name: 'Очистить поиск', exact: true }).click(); await rows(0);
    await resetTaskFilters(); await rows(6);
    await page.locator('.filter-tabs').getByRole('button', { name: /^Отменено/ }).click(); await rows(2);
    const pinnedRow = page.locator('.task-row').filter({ hasText: xssTitle });
    await pinnedRow.getByRole('button', { name: /^Вернуть в работу:/ }).click(); await rows(1);
    await resetTaskFilters(); await rows(6);
  });

  await check('existing long notes grow on opening and fit the screen', async () => {
    await page.getByRole('button', { name: `Редактировать: ${longTitle}`, exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#task-description').getBoundingClientRect().height > 112);
    await boundedModal();
    await page.locator('#task-description').fill(`${longNote}\nновая строка`);
    await page.locator('dialog.modal').getByRole('button', { name: 'Сохранить изменения' }).click();
    await page.locator('dialog.modal').waitFor({ state: 'hidden' });
  });

  await check('history action and local date filters work before pagination', async () => {
    await page.getByRole('button', { name: 'История действий', exact: true }).click();
    await page.locator('.audit-list>li').first().waitFor();
    await page.locator('.history-section .filter-trigger').click();
    await select('history-action', 'Задача отменена');
    await date('history-from', today); await date('history-to', today);
    await applyFilters();
    await page.waitForFunction(() => document.querySelectorAll('.audit-content h3').length === 2 && [...document.querySelectorAll('.audit-content h3')].every(element => element.textContent === 'Задача отменена'));
    await page.locator('.history-section .filter-trigger').click();
    await date('history-from', tomorrow); await date('history-to', tomorrow);
    await applyFilters();
    await page.getByRole('heading', { name: 'Подходящих действий нет' }).waitFor();
    await page.getByRole('button', { name: 'Сбросить фильтр', exact: true }).click();
    await page.locator('.audit-list>li').first().waitFor();
    const changedNote = page.locator('.audit-list>li').filter({ hasText: longTitle }).filter({ has: page.locator('details') }).first();
    await changedNote.locator('summary').click();
    await noHorizontalOverflow();
    await screenshot('desktop-history');
  });

  await check('mobile and small-screen dialogs, calendars and history remain bounded', async () => {
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: width === 320 ? 568 : 844 });
      await noHorizontalOverflow();
      await screenshot(`history-${width}`);
      await page.getByRole('button', { name: 'Мои задачи', exact: false }).first().click();
      await page.getByRole('button', { name: 'Новая задача', exact: true }).click();
      await page.locator('#task-description').fill('длинная заметка\n'.repeat(180));
      await boundedModal();
      await page.locator('#task-date').click();
      await boundedModal();
      const panel = await page.locator('.calendar-panel').boundingBox();
      assert.ok(panel.x >= 0 && panel.x + panel.width <= width + 1);
      await screenshot(`calendar-${width}`);
      await page.locator('.calendar-panel').getByRole('button', { name: 'Сегодня', exact: true }).click();
      await page.locator('#task-priority').click(); await boundedModal();
      await page.getByRole('option', { name: 'Высокий', exact: true }).press('Escape');
      assert.ok(await page.locator('dialog.modal').isVisible());
      await closeDialog();
      await noHorizontalOverflow();
      await screenshot(`tasks-${width}`);
      await page.getByRole('button', { name: 'История действий', exact: true }).click();
      await page.locator('.audit-list>li').first().waitFor();
    }
  });

  await check('deletion keeps the audit and logout revokes the session', async () => {
    await page.getByRole('button', { name: 'Мои задачи', exact: false }).first().click();
    await page.getByRole('button', { name: `Удалить: ${xssTitle}`, exact: true }).click();
    await page.locator('dialog.modal').getByRole('button', { name: 'Удалить', exact: true }).click();
    await page.locator('dialog.modal').waitFor({ state: 'hidden' }); await rows(5);
    assert.ok((await api('/audit?action=task.deleted')).events.some(event => event.taskId === primary.id));
    for (const task of (await api('/tasks')).tasks) await api(`/tasks/${task.id}`, 'DELETE');
    await page.getByRole('button', { name: 'Выйти из аккаунта', exact: true }).click();
    await page.locator('.auth-form').waitFor();
    assert.equal((await api('/session')).user, null);
    authenticated = false;
  });
  assert.deepEqual(errors, [], 'No browser JavaScript errors');
  assert.deepEqual(externalRequests, [], 'No external runtime requests');
  console.log(`PASS: ${checks.length} browser scenarios. Artifacts: ${output}`);
} catch (error) {
  await screenshot('failure').catch(() => {});
  console.error(String(error?.stack ?? error).replaceAll(password, '[redacted]'));
  console.error(`Artifacts: ${output}`);
  process.exitCode = 1;
} finally {
  if (authenticated) {
    try {
      for (const task of (await api('/tasks')).tasks) await api(`/tasks/${task.id}`, 'DELETE');
      await api('/auth/logout', 'POST', {});
    } catch { console.error('Не удалось убрать тестовые задачи; они принадлежат только новому тестовому аккаунту.'); }
  }
  await writeFile(path.join(output, 'result.json'), JSON.stringify({ ok: !process.exitCode, checks, errors, externalRequests }, null, 2));
  await browser.close();
}
