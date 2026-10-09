// Repair local projections from accepted Discord receipts, never replay a send.
function createReceiptRecovery({ deliveries, cases, fetchChannel, botUserId,
  staffChannelId, validateDestination, getApproval, bindCard, rememberAnswer,
  repairClosure,
  log = (line) => console.error(line) }) {
  async function repair(row, observedMessage = null) {
    if (!row || row.state !== 'accepted' || !row.messageId || row.botUserId !== String(botUserId())) return false;
    try {
      if (row.kind === 'closure') return typeof repairClosure === 'function' ? await repairClosure(row) : false;
      if (row.kind === 'answer') {
        rememberAnswer({ id: row.messageId }, { author: { id: row.customerId }, channel: { id: row.channelId } });
        await deliveries.markProjected(row.id);
        return true;
      }
      if (row.kind !== 'staff-card' || row.channelId !== String(staffChannelId())) return false;
      const supportCase = await cases.getCaseById(row.caseId);
      if (!supportCase || supportCase.customerId !== row.customerId) return false;
      if (supportCase.generation !== row.caseGeneration) {
        await deliveries.markProjected(row.id);
        return true;
      }
      // A late receipt cannot reopen a closed case or assert staff acceptance.
      if (['closed', 'resolved'].includes(supportCase.status)) {
        await deliveries.markProjected(row.id);
        return true;
      }
      const channel = await fetchChannel(row.channelId);
      if (!channel || String(channel.id) !== row.channelId || !(await validateDestination(channel))) return false;
      const sent = observedMessage || await channel.messages.fetch(row.messageId, { force: true });
      if (!sent || String(sent.id) !== row.messageId ||
          String(sent.channelId || sent.channel_id || sent.channel?.id || '') !== row.channelId ||
          String(sent.author?.id || '') !== row.botUserId || sent.webhookId || sent.webhook_id) return false;
      if (supportCase.status === 'queued' || supportCase.status === 'delivered') {
        const updated = await cases.markDelivered(row.caseId, { messageId: row.messageId, destination: 'staff-channel', expectedGeneration: row.caseGeneration });
        if (!updated) return false;
      } else if (supportCase.status !== 'accepted') return false;
      const rows = (sent.components || []).map((group) => typeof group.toJSON === 'function' ? group.toJSON() : group);
      const ids = rows.flatMap((group) => group.components || [])
        .map((item) => String(item.customId || item.custom_id || ''))
        .filter((id) => id.startsWith('file:')).map((id) => id.slice(5));
      // The binding failure path may have removed the control. The immutable
      // ledger scope, not the current presentation, identifies that proposal.
      if (ids.some((id) => id !== row.approvalId)) return false;
      for (const id of row.approvalId ? [row.approvalId] : []) {
        const approval = await getApproval(id);
        if (!approval || approval.caseId !== row.caseId || approval.customerId !== row.customerId ||
            approval.sourceMessageId !== row.sourceMessageId || approval.channelId !== row.channelId ||
            approval.botUserId !== row.botUserId) return false;
        if (approval.cardMessageId && approval.cardMessageId !== row.messageId) return false;
        // Publication or expiry can make the initial bind transition unavailable.
        // An already exact binding remains valid without mutating it again.
        if (approval.cardMessageId !== row.messageId) await bindCard(approval, sent);
        if (!ids.includes(id)) {
          if (rows.length >= 5) return false;
          const components = [...rows, { type: 1, components: [{ type: 2, style: 2,
            label: 'Review technical summary', custom_id: `file:${id}` }] }];
          // A PATCH of the same saved card is idempotent. Never recreate it.
          if (typeof sent.edit === 'function') await sent.edit({ components, allowedMentions: { parse: [] } });
          else if (typeof channel.messages?.edit === 'function') await channel.messages.edit(sent.id, { components, allowedMentions: { parse: [] } });
          else return false;
        }
      }
      await deliveries.markProjected(row.id);
      return true;
    } catch {
      log('[Delivery] accepted receipt projection held');
      return false;
    }
  }

  let running = false;
  async function recover(limit = 20) {
    if (running) return;
    running = true;
    try {
      for (const row of await deliveries.pendingReceipts(limit)) {
        if (!(await repair(row))) await deliveries.deferProjection(row.id);
      }
    } catch { log('[Delivery] receipt recovery unavailable'); }
    finally { running = false; }
  }
  return { repair, recover };
}

module.exports = { createReceiptRecovery };
