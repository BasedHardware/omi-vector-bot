const { checkConfiguredStaffDestination } = require('./discordPrivacy');
const telegram = require('./telegram');

async function checkBootStaffDestination(client, { staffUsers = [], staffRoleIds = [],
  alert = telegram.sendOperationalAlert, log = console.log, error = console.error } = {}) {
  const result = await checkConfiguredStaffDestination(client, { staffUsers, staffRoleIds });
  if (result.ok) {
    log('[Boot] Discord staff destination verified (private_staff_destination)');
    return result;
  }
  error(`[Boot] Discord staff destination rejected (${result.code}); full cards and GitHub approvals are blocked.`);
  let notified = false;
  try {
    notified = await alert(`Omi Support Bot: Discord staff destination rejected (${result.code}). ` +
      'Full Discord staff cards and GitHub approvals are blocked. Check the private channel audience and bot send permissions. ' +
      'Customer handoffs must use the existing safe fallback.');
  } catch { /* Transport exceptions may contain credentials; never dump them. */ }
  if (!notified) error('[Boot] Staff destination Telegram alert not confirmed; operator follow-up required.');
  return result;
}

module.exports = { checkBootStaffDestination };
