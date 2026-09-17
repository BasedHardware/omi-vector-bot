require('dotenv').config();

const clientId = process.env.DISCORD_CLIENT_ID;
if (!clientId) {
  console.error('Set DISCORD_CLIENT_ID in .env (Application ID from the Developer Portal).');
  process.exit(1);
}

const permissions = String(
  1024n + // View Channel
    2048n + // Send Messages
    16384n + // Embed Links
    65536n + // Read Message History
    274877906944n // Send Messages in Threads
);

const url = `https://discord.com/oauth2/authorize?client_id=${clientId}&permissions=${permissions}&scope=bot`;
console.log(url);
console.log('');
console.log('Invite this bot to a private test channel, not public help.');
