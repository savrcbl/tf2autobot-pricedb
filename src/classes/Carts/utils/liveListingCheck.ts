import SKU from '@tf2autobot/tf2-sku';
import Currencies from '@tf2autobot/tf2-currencies';
import Bot from '../../Bot';
import log from '../../../lib/logger';
import { apiRequest } from '../../../lib/apiRequest';

/**
 * Sanity-checks a would-be buy against live backpack.tf classifieds listings.
 *
 * Autopriced items can lag behind the real market for a few minutes. This
 * queries backpack.tf's listing snapshot for the item being bought and makes
 * sure our buy price isn't higher than what the item is actually going for
 * right now. If it is, that's a strong signal the pricer is stale, and we
 * should not buy at that price.
 *
 * This is deliberately "fail-open": if the request errors, times out, or is
 * rate-limited, we skip the check rather than block the trade. backpack.tf's
 * v1 snapshot endpoint is rate-limited and unofficially deprecated, so this
 * should never be relied on as the only guard against bad prices - it's an
 * extra layer on top of the normal pricer.
 */

interface SnapshotListing {
    intent: 'buy' | 'sell';
    currencies: { keys?: number; metal?: number };
    steamid?: string;
    userAgent?: {
        client: string;
    };
}

interface SnapshotResponse {
    listings?: SnapshotListing[];
}

interface CacheEntry {
    value: number | null;
    expires: number;
}

const cache = new Map<string, CacheEntry>();

/**
 * @param bot - The bot instance
 * @param sku - The SKU to check
 * @param cacheSeconds - How long to reuse a cached result for this SKU
 * @returns The cheapest live sell listing value in scrap (metal), excluding
 *          our own listing, or null if unknown / check could not be made.
 */
export async function getCheapestLiveSellValue(bot: Bot, sku: string, cacheSeconds = 60): Promise<number | null> {
    const cached = cache.get(sku);
    if (cached && cached.expires > Date.now()) {
        return cached.value;
    }

    const token = bot.options.bptfAccessToken;
    if (!token) {
        return null;
    }

    // backpack.tf's snapshot endpoint takes the item's display name, not its SKU
    const name = bot.schema.getName(SKU.fromString(sku), false);

    try {
        const response = await apiRequest<SnapshotResponse>({
            method: 'GET',
            url: 'https://backpack.tf/api/classifieds/listings/snapshot',
            params: {
                sku: name,
                appid: 440,
                token
            }
        });

        const ourSteamID64 = bot.client.steamID ? bot.client.steamID.getSteamID64() : null;
        const keyPriceMetal = bot.pricelist.getKeyPrice.metal;

        const sellValues = (response.listings ?? [])
            .filter(listing => listing.intent === 'sell' && listing.steamid !== ourSteamID64)
            .map(listing => {
                const currencies = new Currencies({
                    keys: listing.currencies.keys ?? 0,
                    metal: listing.currencies.metal ?? 0
                });
                return currencies.toValue(keyPriceMetal);
            })
            .filter(value => value > 0);

        const cheapest = sellValues.length > 0 ? Math.min(...sellValues) : null;

        cache.set(sku, { value: cheapest, expires: Date.now() + cacheSeconds * 1000 });
        return cheapest;
    } catch (err) {
        log.debug(`Live listing check failed for ${sku}, skipping check: `, err);
        // Fail open - don't block trading because of an API hiccup
        cache.set(sku, { value: null, expires: Date.now() + 15 * 1000 });
        return null;
    }
}
