const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
} = require('discord.js');
const shopify = require('./shopify');
const shopifyBind = require('./shopifyBind');
const shopifyEmail = require('./shopifyEmail');
const { PersistentVerificationService, normalizeEmail } = require('./verification');

const verification = new PersistentVerificationService();
const ephemeral = { flags: MessageFlags.Ephemeral };
const EARLY_DEFER_MS = 1200;

const orderCommand = new SlashCommandBuilder()
  .setName('order')
  .setDescription('Check your Shopify order. Verifies the email on the order first.')
  .setDefaultMemberPermissions(null)
  .addStringOption((option) =>
    option.setName('number').setDescription('Optional order number, e.g. #1234').setRequired(false)
  )
  .toJSON();

const ordersCommand = new SlashCommandBuilder()
  .setName('orders')
  .setDescription('List recent Shopify orders for your verified email.')
  .setDefaultMemberPermissions(null)
  .toJSON();

const unlinkCommand = new SlashCommandBuilder()
  .setName('unlink')
  .setDescription('Forget your verified Shopify order email.')
  .setDefaultMemberPermissions(null)
  .toJSON();

function isLive() {
  return shopify.isConfigured() && shopifyBind.isReady() && shopifyEmail.isReady();
}

function notLiveReply() {
  return {
    content: 'Order lookup is not live yet. Email help@omi.me with your Order ID.',
    ...ephemeral,
  };
}

function emailModal() {
  const modal = new ModalBuilder().setCustomId('link_email').setTitle('Verify your order email');
  const email = new TextInputBuilder()
    .setCustomId('email')
    .setLabel('Email used on the Shopify order')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(254)
    .setPlaceholder('you@example.com');
  modal.addComponents(new ActionRowBuilder().addComponents(email));
  return modal;
}

function codeModal() {
  const modal = new ModalBuilder().setCustomId('verify_code').setTitle('Enter verification code');
  const code = new TextInputBuilder()
    .setCustomId('code')
    .setLabel('6-digit code')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMinLength(6)
    .setMaxLength(6)
    .setPlaceholder('123456');
  modal.addComponents(new ActionRowBuilder().addComponents(code));
  return modal;
}

async function hold(interaction) {
  if (interaction.deferred || interaction.replied) return;
  if (typeof interaction.deferReply !== 'function') return;
  await interaction.deferReply(ephemeral);
}

async function say(interaction, payload) {
  const body = typeof payload === 'string' ? { content: payload } : payload;
  if (interaction.deferred || interaction.replied) return interaction.editReply(body);
  return interaction.reply({ ...body, ...ephemeral });
}

async function lookupBindingWithEarlyDefer(interaction) {
  let deferredResponse;
  const timer = setTimeout(() => {
    // Observe rejection immediately, even while the database lookup is pending.
    deferredResponse = hold(interaction).then(() => null, (error) => error);
  }, EARLY_DEFER_MS);
  try {
    return await shopifyBind.get(interaction.user.id);
  } finally {
    clearTimeout(timer);
    if (deferredResponse) {
      const error = await deferredResponse;
      if (error) throw error;
    }
  }
}

function emailVerificationPrompt() {
  const button = new ButtonBuilder()
    .setCustomId('start_order_verification')
    .setLabel('Verify email')
    .setStyle(ButtonStyle.Primary);
  return {
    content: 'Verify the email used on your Shopify order to check your orders.',
    components: [new ActionRowBuilder().addComponents(button)],
  };
}

async function verifiedOrders(email) {
  const found = await shopify.ordersForVerifiedEmail(email);
  if (!found.ok) throw new Error(`Shopify lookup failed: ${found.reason}`);
  return found.orders;
}

function orderLines(order) {
  return shopify.formatUserReply(order);
}

async function replyBoundOrder(interaction, requested, binding) {
  await hold(interaction);
  const orders = await verifiedOrders(binding.email);
  if (!orders.length) {
    await say(interaction, 'No recent orders were found for your verified email.');
    return true;
  }
  const want = String(requested || '')
    .replace(/^#/, '')
    .trim();
  const order = want
    ? orders.find((item) => String(item.name || '').replace(/^#/, '') === want)
    : orders[0];
  if (!order) {
    await say(interaction, `I could not find order #${want} among your recent orders.`);
    return true;
  }
  await say(interaction, orderLines(order));
  return true;
}

async function handleOrderInteraction(interaction) {
  try {
    if (interaction.isChatInputCommand?.()) {
      if (!['order', 'orders', 'unlink'].includes(interaction.commandName)) return false;
      if (interaction.commandName === 'unlink') {
        await hold(interaction);
        const removed = await shopifyBind.remove(interaction.user.id);
        await say(interaction, {
          content: removed ? 'Your Shopify order-email link was removed.' : 'No Shopify email was linked.',
        });
        return true;
      }
      if (!isLive()) {
        await interaction.reply(notLiveReply());
        return true;
      }
      const binding = await lookupBindingWithEarlyDefer(interaction);
      if (!binding) {
        if (interaction.deferred || interaction.replied) await say(interaction, emailVerificationPrompt());
        else await interaction.showModal(emailModal());
        return true;
      }
      if (interaction.commandName === 'order') {
        await replyBoundOrder(interaction, interaction.options?.getString?.('number'), binding);
        return true;
      }
      await hold(interaction);
      const orders = await verifiedOrders(binding.email);
      if (!orders.length) {
        await say(interaction, 'No recent orders were found for your verified email.');
        return true;
      }
      const body = orders
        .slice(0, 5)
        .map((order) => orderLines(order))
        .join('\n\n');
      await say(interaction, body);
      return true;
    }

    if (interaction.isModalSubmit?.() && interaction.customId === 'link_email') {
      if (!isLive()) {
        await interaction.reply(notLiveReply());
        return true;
      }
      const email = normalizeEmail(interaction.fields.getTextInputValue('email'));
      if (!email) {
        await interaction.reply({ content: 'That does not look like a valid email address.', ...ephemeral });
        return true;
      }
      await hold(interaction);
      const reservedAt = await verification.reserveAttempt(interaction.user.id, email);
      if (!reservedAt) {
        await say(interaction, 'Too many verification requests. Try again later.');
        return true;
      }
      let exists;
      try {
        exists = await shopify.hasRecentOrderForEmail(email);
      } catch (err) {
        await verification.releaseAttempt(interaction.user.id, email, reservedAt);
        throw err;
      }
      if (exists) {
        const code = await verification.create(interaction.user.id, email);
        const sent = await shopifyEmail.sendVerificationCode(email, code);
        if (!sent.ok) {
          await say(interaction, 'Could not send a verification email. Email help@omi.me with your Order ID.');
          return true;
        }
      }
      const button = new ButtonBuilder()
        .setCustomId('enter_verification_code')
        .setLabel('Enter verification code')
        .setStyle(ButtonStyle.Primary);
      await say(interaction, {
        content:
          'If that email matches a recent order, a verification code was sent. The code expires in 10 minutes.',
        components: [new ActionRowBuilder().addComponents(button)],
      });
      return true;
    }

    if (interaction.isButton?.() && interaction.customId === 'start_order_verification') {
      if (!isLive()) await interaction.reply(notLiveReply());
      else await interaction.showModal(emailModal());
      return true;
    }

    if (interaction.isButton?.() && interaction.customId === 'enter_verification_code') {
      await interaction.showModal(codeModal());
      return true;
    }

    if (interaction.isModalSubmit?.() && interaction.customId === 'verify_code') {
      await hold(interaction);
      const result = await verification.verify(interaction.user.id, interaction.fields.getTextInputValue('code'));
      if (!result.ok) {
        await say(interaction, { content: result.reason });
        return true;
      }
      // Verification stores the link and consumes its challenge in one transaction.
      let orders;
      try {
        orders = await verifiedOrders(result.email);
      } catch (err) {
        console.error('[Bot] order command failed:', err.message);
        await say(interaction, 'Verified. Order lookup failed. Try /order again in a moment.');
        return true;
      }
      if (!orders.length) {
        await say(interaction, 'Verified. No recent orders are currently accessible.');
        return true;
      }
      await say(interaction, `${orderLines(orders[0])}\n\nYour Discord account is linked. Use /order next time.`);
      return true;
    }
  } catch (err) {
    console.error('[Bot] order command failed:', err.message);
    if (interaction.isRepliable?.()) {
      try {
        await say(interaction, 'Order lookup failed. Try again in a moment.');
      } catch {
        /* ignore */
      }
    }
    return true;
  }
  return false;
}

module.exports = {
  orderCommand,
  ordersCommand,
  unlinkCommand,
  isLive,
  handleOrderInteraction,
  verification,
};
