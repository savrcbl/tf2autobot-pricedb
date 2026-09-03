import SKU from '@tf2autobot/tf2-sku';
import Currencies from '@tf2autobot/tf2-currencies';
import Bot from '../../Bot';
import log from '../../../lib/logger';
import { apiRequest } from '../../../lib/apiRequest';

/**
 * Looks up live backpack.tf classifieds listings for a SKU.
 *
 * Autopriced items can lag behind the real market for a few minutes. This
 * module is used to sanity-check buy prices against what the item is
 * actually going for right now (see UserCart.ts), and to power the
 * !checkbptf command so admins can look up live listings on demand.
 *
 * All lookups are deliberately "fail-open": if the request errors, times
 * out, or is rate-limited, callers get null rather than a thrown error.
 * backpack.tf's v1 snapshot endpoint is rate-limited and unofficially
 * deprecated, so this should never be relied on as the only guard against
 * bad prices - it's an extra layer on top of the normal pricer.
 */

interface SnapshotListing {
    intent: 'buy' | 'sell';
    currencies: { keys?: number; metal?: number };
    steamid?: string;
}

interface SnapshotResponse {
    listings?: SnapshotListing[];
}

export interface LiveListingSummary {
    /** Cheapest current sell listing value in scrap, excluding our own listing. */
    cheapestSell: number | null;
    /** Highest current buy listing value in scrap, excluding our own listing. */
    highestBuy: number | null;
    /** Number of sell listings (excluding ours) the summary was built from. */
    sellCount: number;
    /** Number of buy listings (excluding ours) the summary was built from. */
    buyCount: number;
}

interface CacheEntry {
    value: LiveListingSummary | null;
    expires: number;
}

const cache = new Map<string, CacheEntry>();

/**
 * @param bot - The bot instance
 * @param sku - The SKU to check
 * @param cacheSeconds - How long to reuse a cached result for this SKU
 * @returns A summary of live buy/sell listings, or null if the lookup could
 *          not be made (no bptf token configured, request failed, rate limited, etc.)
 */
export async function getLiveListingSummary(
    bot: Bot,
    sku: string,
    cacheSeconds = 60
): Promise<LiveListingSummary | null> {
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

        const toValue = (listing: SnapshotListing): number =>
            new Currencies({
                keys: listing.currencies.keys ?? 0,
                metal: listing.currencies.metal ?? 0
            }).toValue(keyPriceMetal);

        const listings = (response.listings ?? []).filter(listing => listing.steamid !== ourSteamID64);

        const sellValues = listings
            .filter(listing => listing.intent === 'sell')
            .map(toValue)
            .filter(value => value > 0);

        const buyValues = listings
            .filter(listing => listing.intent === 'buy')
            .map(toValue)
            .filter(value => value > 0);

        const summary: LiveListingSummary = {
            cheapestSell: sellValues.length > 0 ? Math.min(...sellValues) : null,
            highestBuy: buyValues.length > 0 ? Math.max(...buyValues) : null,
            sellCount: sellValues.length,
            buyCount: buyValues.length
        };

        cache.set(sku, { value: summary, expires: Date.now() + cacheSeconds * 1000 });
        return summary;
    } catch (err) {
        log.debug(`Live listing lookup failed for ${sku}, skipping: `, err);
        // Fail open - don't block trading or the command because of an API hiccup
        cache.set(sku, { value: null, expires: Date.now() + 15 * 1000 });
        return null;
    }
}

/**
 * Convenience wrapper around getLiveListingSummary for the buy-price sanity
 * check in UserCart.ts, which only cares about the cheapest sell value.
 *
 * @returns The cheapest live sell listing value in scrap (metal), excluding
 *          our own listing, or null if unknown / check could not be made.
 */
export async function getCheapestLiveSellValue(bot: Bot, sku: string, cacheSeconds = 60): Promise<number | null> {
    const summary = await getLiveListingSummary(bot, sku, cacheSeconds);
    return summary ? summary.cheapestSell : null;
}
