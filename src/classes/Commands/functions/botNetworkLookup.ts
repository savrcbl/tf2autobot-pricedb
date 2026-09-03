import SteamID from 'steamid';
import Bot from '../../Bot';
import Inventory from '../../Inventory';
import log from '../../../lib/logger';

export interface BotNetworkMatch {
    steamID: string;
    tradeUrl: string;
}

/**
 * When a customer wants to !buy/!buycart an item this bot has zero stock of,
 * this checks the other bots configured in miscSettings.botNetwork.bots (all
 * owned by the same person) to see if any of them currently hold the item.
 *
 * This reuses the same Inventory class the bot already uses to fetch a
 * trading partner's inventory - it just points it at a sibling bot's SteamID
 * instead. No new Steam API integration needed.
 *
 * Checks run one at a time and stop at the first match. Any bot that fails
 * to fetch (private inventory, rate limited, offline, bad SteamID) is
 * skipped rather than treated as an error - one bad entry in the list
 * should never break the check for the rest.
 *
 * @returns The first sibling bot found holding the item, or null if none do
 *          (or the feature is disabled / has no bots configured).
 */
export default async function findItemOnBotNetwork(bot: Bot, sku: string): Promise<BotNetworkMatch | null> {
    const opt = bot.options.miscSettings.botNetwork;
    const bots = opt?.bots ?? [];

    if (!opt?.enable || bots.length === 0) {
        return null;
    }

    for (const sibling of bots) {
        try {
            const inventory = new Inventory(new SteamID(sibling.steamID), bot, 'their', bot.boundInventoryGetter);
            await inventory.fetch();

            if (inventory.findBySKU(sku, true).length > 0) {
                return sibling;
            }
        } catch (err) {
            log.debug(`Bot network lookup failed for ${sibling.steamID}, skipping: `, err);
        }
    }

    return null;
}
