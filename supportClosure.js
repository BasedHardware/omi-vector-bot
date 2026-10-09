// One staff closing notice per customer case generation. Recovery repairs
// local state from a receipt, never sends a new card or archives a thread.
function createClosureWorkflow({ cases, deliveries, actions, sendNotice, finishThread,
  resolveEscalation, markThreadClosed, botUserId, log = (line) => console.error(line) }) {
  const belongs = (row, value) => row.caseId === value.id && row.customerId === value.customerId &&
    [value.channelId, value.customerThreadId, value.handoffThreadId].includes(row.channelId);

  async function project(row, assertOwned) {
    if (row.kind !== 'closure' || row.state !== 'accepted' || !row.messageId) return { ok: false };
    if (typeof botUserId !== 'function' || row.botUserId !== String(botUserId() || '') ||
        row.sourceMessageId !== row.channelId || row.referenceMessageId || row.approvalId ||
        row.operationKey !== `closure:${row.caseId}:${row.caseGeneration}:${row.channelId}`) return { ok: false };
    const recorded = await deliveries.get(row.operationKey);
    if (!recorded || recorded.state !== 'accepted' ||
        ['id', 'messageId', 'kind', 'sourceMessageId', 'customerId', 'channelId', 'botUserId', 'caseId', 'caseGeneration']
          .some((key) => recorded[key] !== row[key])) return { ok: false };
    const value = await cases.getCaseById(row.caseId);
    if (!value || !belongs(row, value)) return { ok: false };
    if (value.generation !== row.caseGeneration) {
      await deliveries.markProjected(row.id);
      return { ok: false, obsolete: true };
    }
    await assertOwned();
    if (value.status !== 'closed' || value.deliveryId !== row.messageId) {
      const closed = await cases.resolveCase(value.id, { close: true, deliveryId: row.messageId, expectedGeneration: row.caseGeneration });
      if (!closed) return { ok: false, obsolete: true };
    }
    await assertOwned();
    // Only the escalation owned by this exact case may be resolved.
    if (value.escalationId) await resolveEscalation(value.escalationId);
    await deliveries.markProjected(row.id);
    return { ok: true };
  }

  async function close({ channel, user, client, customerCase, payloadFn }) {
    let acceptedNotice = false;
    let noticeUncertain = false;
    let caseUpdateCompleted = false;
    try {
      return await actions.run(customerCase.id, async (assertOwned) => {
        const scope = await cases.getThreadCaseScope(String(channel.id));
        const current = scope.case;
        if (scope.ambiguous || !current || current.id !== customerCase.id ||
            current.customerId !== customerCase.customerId || current.generation !== customerCase.generation) {
          return { ok: false, reason: 'This case changed while the command was waiting. Review the current case before closing it.' };
        }
        const botUserId = String(client?.user?.id || '');
        if (!botUserId) return { ok: false, reason: 'The closing notice is not ready to send. The case has not been closed.' };
        const operationKey = `closure:${current.id}:${current.generation}:${channel.id}`;
        const existing = await deliveries.get(operationKey);
        if (current.status === 'closed' && !existing) {
          return { ok: true, reason: 'This case is already closed. No additional closing notice was posted.' };
        }
        let sent;
        try {
          sent = await deliveries.send({ operationKey, kind: 'closure',
            sourceMessageId: String(channel.id), referenceMessageId: null,
            customerId: current.customerId, channelId: String(channel.id), botUserId,
            caseId: current.id, caseGeneration: current.generation, approvalId: null,
          }, async (nonceOptions) => {
            await assertOwned();
            const fresh = await cases.getCaseById(current.id);
            if (!fresh || fresh.generation !== current.generation || fresh.customerId !== current.customerId) {
              throw new Error('Closing intent is stale');
            }
            return sendNotice(client, channel, { ...payloadFn(user, { feedbackNonce: nonceOptions.nonce }), ...nonceOptions });
          });
          acceptedNotice = true;
        } catch (error) {
          noticeUncertain = error.deliveryUncertain === true;
          log('[Closure] closing notice held or rejected');
          return { ok: false, reason: error.deliveryUncertain
            ? 'I could not confirm delivery of the closing notice. I have not closed or archived the case; do not repost the notice while its receipt is checked.'
            : 'The closing notice was blocked or rejected. The case has not been closed or archived.' };
        }
        const row = await deliveries.get(operationKey);
        if (!row || row.messageId !== sent.id || row.botUserId !== botUserId) {
          return { ok: false, reason: 'The closing notice needs receipt reconciliation. The case has not been archived.' };
        }
        let projected;
        try { projected = await project(row, assertOwned); }
        catch {
          log('[Closure] closing receipt projection pending');
          return { ok: false, reason: 'The closing notice was posted, but updating the case is incomplete. Retrying /done will reuse that notice, not post another.' };
        }
        if (!projected.ok) return { ok: false, reason: 'This closing notice no longer matches the current case. The thread has not been archived.' };
        caseUpdateCompleted = true;
        const guard = async () => {
          await assertOwned();
          const fresh = await cases.getCaseById(current.id);
          const ownership = await cases.getThreadCaseScope(String(channel.id));
          if (!fresh || fresh.generation !== current.generation || fresh.status !== 'closed' ||
              ownership.ambiguous || ownership.case?.id !== current.id) throw new Error('Closing intent is stale');
        };
        try {
          await guard();
          markThreadClosed(channel);
          await finishThread(channel, guard);
        } catch {
          log('[Closure] case closed; thread finalization unconfirmed');
          const latest = await cases.getCaseById(current.id).catch(() => null);
          if (latest && (latest.generation !== current.generation || latest.status !== 'closed')) {
            return { ok: false, reason: 'The closing notice was delivered, but the case changed before the thread update completed. Please review the current case before using /done again.' };
          }
          return { ok: true, reason: 'The closing notice was delivered and a resolution update was saved. I could not confirm the thread tag/archive update; please inspect the current case before retrying.' };
        }
        return { ok: true, receiptId: sent.id };
      });
    } catch {
      log('[Closure] case coordination unavailable');
      if (acceptedNotice) return { ok: false, reason: caseUpdateCompleted
        ? 'The closing notice was delivered and a case update completed, but coordination was lost before confirming the final state. Please inspect the current case before retrying /done.'
        : 'The closing notice was delivered, but I could not confirm the case update. Please inspect the case; retrying /done reuses the notice rather than reposting it.' };
      if (noticeUncertain) return { ok: false, reason: 'I could not confirm the closing notice or final case state. Leave the action held; do not repost the notice while its receipt is checked.' };
      return { ok: false, reason: 'This case is being updated or its records are unavailable. Please try /done again; no additional closing notice was posted.' };
    }
  }

  async function repair(row) {
    if (row?.kind !== 'closure' || row.state !== 'accepted') return false;
    try {
      return await actions.run(row.caseId, async (assertOwned) => {
        const result = await project(row, assertOwned);
        return result.ok || result.obsolete === true;
      });
    } catch { log('[Closure] receipt repair pending'); return false; }
  }
  return { close, repair };
}

module.exports = { createClosureWorkflow };
