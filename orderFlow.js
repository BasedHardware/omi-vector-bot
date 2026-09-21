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
const { VerificationService, normalizeEmail } = require('./verification');

const verification = new VerificationService();
const ephemeral = { flags: MessageFlags.Ephemeral };

const orderCommand = new SlashCommandBuilder()
  .setName('order')
  .setDescription('Check your Shopify order. Verifies the email on the order first.')
  .addStringOption((option) =>
    option.setName('number').setDescription('Optional order number, e.g. #1234').setRequired(false)
  )
  .toJSON();

const ordersCommand = new SlashCommandBuilder()
  .setName('orders')
  .setDescription('List recent Shopify orders for your verified email.')
  .toJSON();

const unlinkCommand = new SlashCommandBuilder()
  .setName('unlink')
  .setDescription('Forget your verified Shopify order email.')
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

function orderLines(order) {
  return shopify.formatUserReply(order);
}

async function replyBoundOrder(interaction, requested) {
  const binding = await shopifyBind.get(interaction.user.id);
  if (!binding) return false;
  const found = await shopify.ordersForVerifiedEmail(binding.email);
  if (!found.orders.length) {
    await interaction.reply({
      content: 'No recent orders were found for your verified email.',
      ...ephemeral,
    });
    return true;
  }
  const want = String(requested || '')
    .replace(/^#/, '')
    .trim();
  const order = want
    ? found.orders.find((item) => String(item.name || '').replace(/^#/, '') === want)
    : found.orders[0];
  if (!order) {
    await interaction.reply({
      content: `I could not find order #${want} among your recent orders.`,
      ...ephemeral,
    });
    return true;
  }
  await interaction.reply({ content: orderLines(order), ...ephemeral });
  return true;
}

async function handleOrderInteraction(interaction) {
  try {
    if (interaction.isChatInputCommand?.()) {
      if (!['order', 'orders', 'unlink'].includes(interaction.commandName)) return false;
      if (!isLive()) {
        await interaction.reply(notLiveReply());
        return true;
      }
      if (interaction.commandName === 'unlink') {
        const removed = await shopifyBind.remove(interaction.user.id);
        await interaction.reply({
          content: removed ? 'Your Shopify order-email link was removed.' : 'No Shopify email was linked.',
          ...ephemeral,
        });
        return true;
      }
      const binding = await shopifyBind.get(interaction.user.id);
      if (!binding) {
        await interaction.showModal(emailModal());
        return true;
      }
      if (interaction.commandName === 'order') {
        await replyBoundOrder(interaction, interaction.options?.getString?.('number'));
        return true;
      }
      const found = await shopify.ordersForVerifiedEmail(binding.email);
      if (!found.orders.length) {
        await interaction.reply({
          content: 'No recent orders were found for your verified email.',
          ...ephemeral,
        });
        return true;
      }
      const body = found.orders
        .slice(0, 5)
        .map((order) => orderLines(order))
        .join('\n\n');
      await interaction.reply({ content: body, ...ephemeral });
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
      if (!verification.reserveAttempt(interaction.user.id, email)) {
        await interaction.reply({ content: 'Too many verification requests. Try again later.', ...ephemeral });
        return true;
      }
      const exists = await shopify.hasRecentOrderForEmail(email);
      if (exists) {
        const code = verification.create(interaction.user.id, email);
        const sent = await shopifyEmail.sendVerificationCode(email, code);
        if (!sent.ok) {
          await interaction.reply({
            content: 'Could not send a verification email. Email help@omi.me with your Order ID.',
            ...ephemeral,
          });
          return true;
        }
      }
      const button = new ButtonBuilder()
        .setCustomId('enter_verification_code')
        .setLabel('Enter verification code')
        .setStyle(ButtonStyle.Primary);
      await interaction.reply({
        content:
          'If that email matches a recent order, a verification code was sent. The code expires in 10 minutes.',
        components: [new ActionRowBuilder().addComponents(button)],
        ...ephemeral,
      });
      return true;
    }

    if (interaction.isButton?.() && interaction.customId === 'enter_verification_code') {
      await interaction.showModal(codeModal());
      return true;
    }

    if (interaction.isModalSubmit?.() && interaction.customId === 'verify_code') {
      const result = verification.verify(interaction.user.id, interaction.fields.getTextInputValue('code'));
      if (!result.ok) {
        await interaction.reply({ content: result.reason, ...ephemeral });
        return true;
      }
      await shopifyBind.set(interaction.user.id, result.email);
      const found = await shopify.ordersForVerifiedEmail(result.email);
      if (!found.orders.length) {
        await interaction.reply({
          content: 'Verified. No recent orders are currently accessible.',
          ...ephemeral,
        });
        return true;
      }
      await interaction.reply({
        content: `${orderLines(found.orders[0])}\n\nYour Discord account is linked. Use /order next time.`,
        ...ephemeral,
      });
      return true;
    }
  } catch (err) {
    console.error('[Bot] order command failed:', err.message);
    if (interaction.isRepliable?.()) {
      try {
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp({ content: 'Order lookup failed. Try again in a moment.', ...ephemeral });
        } else {
          await interaction.reply({ content: 'Order lookup failed. Try again in a moment.', ...ephemeral });
        }
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
