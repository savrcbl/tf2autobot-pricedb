import { sendWebhook } from './utils';
import { Webhook } from './interfaces';
import log from '../../lib/logger';
import Bot from '../Bot';

/**
 * Fires once, right after the bot finishes its startup sequence and is ready
 * to trade. Uses its own webhook URL (discordWebhook.startup.url), separate
 * from sendAlert, so it can be pointed at a different Discord channel -
 * useful if other alert channels are muted but you still want an unmissable
 * ping confirming the bot actually came back online.
 */
export default function sendStartup(bot: Bot): void {
    const optDW = bot.options.discordWebhook;

    if (!optDW.startup?.enable || !optDW.startup.url) {
        return;
    }

    const botInfo = bot.handler.getBotInfo;

    const webhook: Webhook = {
        username: optDW.displayName || botInfo.name,
        avatar_url: optDW.avatarURL || botInfo.avatarURL,
        embeds: [
            {
                color: optDW.embedColor,
                author: {
                    name: `${botInfo.name} is online`,
                    icon_url: optDW.avatarURL || botInfo.avatarURL
                },
                description:
                    `🟢 Started up and ready to trade.\n` +
                    `• Items in pricelist: ${bot.pricelist.getLength}\n` +
                    `• Listings cap: ${bot.listingManager.cap}\n` +
                    `• Startup time: ${process.uptime().toFixed(0)}s`,
                footer: {
                    text: new Date().toUTCString()
                }
            }
        ]
    };

    sendWebhook(optDW.startup.url, webhook, 'startup').catch(err => {
        log.warn('Failed to send startup webhook to Discord: ', err);
    });
}
