import { TradeOffer, ItemsDict } from '@tf2autobot/tradeoffer-manager';
import Currencies from '@tf2autobot/tf2-currencies';
import Bot from '../../../Bot';
import { getLiveListingSummary } from '../../../Carts/utils/liveListingCheck';
import { sendAlert } from '../../../DiscordWebhook/export';
import log from '../../../../lib/logger';

const PURE_SKUS = ['5021;6', '5002;6', '5001;6', '5000;6'];

/**
 * Post-trade sanity check, run AFTER a trade has already been accepted.
 *
 * For every item we just bought, compares our pricelist buy price against
 * live backpack.tf listings, and sends a Discord alert if the buy price
 * looks stale (i.e. we paid more than the cheapest live sell listing).
 *
 * This is intentionally separate from the buy-price gate in UserCart.ts:
 * it never runs before or during offer construction, so it can never delay,
 * block, or rate-limit an actual trade. It's meant to build visibility and
 * confidence in the live listing data before ever wiring it into something
 * that blocks trades.
 *
 * Call this with `void` right after a trade is confirmed accepted - errors
 * here should never bubble up and affect trade handling.
 */
export default async function checkLivePriceAlert(offer: TradeOffer, bot: Bot): Promise<void> {
    const opt = bot.options.miscSettings.liveListingCheck;
    if (!opt?.alertOnMismatch) {
        return;
    }

    const dict = offer.data('dict') as ItemsDict | undefined;
    const theirItems = dict?.their ?? {};
    const skus = Object.keys(theirItems).filter(sku => !PURE_SKUS.includes(sku));

    if (skus.length === 0) {
        return;
    }

    const keyPriceMetal = bot.pricelist.getKeyPrice.metal;
    const tolerance = 1 + (opt.tolerancePercent ?? 0) / 100;
    const dwEnabled =
        bot.options.discordWebhook.sendAlert.enable && bot.options.discordWebhook.sendAlert.url.main !== '';

    for (const sku of skus) {
        const entry = bot.pricelist.getPrice({ priceKey: sku, onlyEnabled: true });
        if (entry === null || entry.buy === null) {
            continue;
        }

        try {
            const summary = await getLiveListingSummary(bot, sku, opt.cacheSeconds ?? 60);
            if (!summary || summary.cheapestSell === null) {
                continue;
            }

            const ourBuyValue = entry.buy.toValue(keyPriceMetal);

            if (ourBuyValue > summary.cheapestSell * tolerance) {
                const cheapestString = Currencies.toCurrencies(summary.cheapestSell, keyPriceMetal).toString();
                const msg =
                    `Bought **${entry.name}** (${sku}) at ${entry.buy.toString()}, but the cheapest live ` +
                    `backpack.tf sell listing right now is ${cheapestString} (${summary.sellCount} listing${
                        summary.sellCount === 1 ? '' : 's'
                    }). This buy price may be stale - offer #${offer.id}.`;

                if (dwEnabled) {
                    sendAlert('livePriceMismatch', bot, msg);
                } else {
                    bot.messageAdmins(msg, []);
                }
            }
        } catch (err) {
            log.debug(`Live price alert check failed for ${sku}, skipping: `, err);
        }
    }
}
