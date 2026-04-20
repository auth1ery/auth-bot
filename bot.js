require('dotenv').config();
const { AsteriskClient, Command } = require('./src/index');

const client = new AsteriskClient({ token: process.env.BOT_TOKEN, prefix: '!' });

client.on('ready', user => console.log(`logged in as ${user.username}`));

client.addCommand(new Command({
  name: 'ping',
  execute(msg) { msg.reply('pong!'); }
}));

client.login();
