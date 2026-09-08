import dayjs from 'dayjs';
import Bot from '../../Bot';
import loadPollData from '../../../lib/tools/polldata';

export interface DeadStockItem {
    sku: string;
    name: string;
    /** Days since the last accepted trade involving this SKU, or null if it has never traded. */
    daysSinceLastTrade: number | null;
}

const PURE_SKUS = ['5021;6', '5002;6', '5001;6', '5000;6'];

/**
 * Finds pricelist items that haven't been part of an accepted trade in at
 * least `minDays` days (or ever), so they can be flagged for repricing or
 * removal to free up listing slots.
 *
 * Reuses the same poll data (accepted trade history) that powers !itemstats,
 * but scans it once for the whole pricelist instead of once per item.
 */
export default function getDeadStock(bot: Bot, minDays: number): DeadStockItem[] {
    const pollData = loadPollData(bot.handler.getPaths.files.dir);
    const lastTraded = new Map<string, number>();

    if (pollData?.offerData) {
        for (const offerID in pollData.offerData) {
            if (!Object.prototype.hasOwnProperty.call(pollData.offerData, offerID)) {
                continue;
            }

            const trade = pollData.offerData[offerID];
            if (!trade.handledByUs || !trade.isAccepted || !trade.dict) {
                continue;
            }

            const timestamp = pollData.timestamps?.[offerID];
            if (!timestamp) {
                continue;
            }

            for (const side of [trade.dict.our, trade.dict.their]) {
                if (!side) {
                    continue;
                }

                for (const sku in side) {
                    if (!Object.prototype.hasOwnProperty.call(side, sku)) {
                        continue;
                    }

                    // Ignore painted partial sku suffix, same as !itemstats does
                    const cleanSku = sku.replace(/;[p][0-9]+/, '');
                    const existing = lastTraded.get(cleanSku);

                    if (existing === undefined || timestamp > existing) {
                        lastTraded.set(cleanSku, timestamp);
                    }
                }
            }
        }
    }

    const now = dayjs();
    const results: DeadStockItem[] = [];
    const prices = bot.pricelist.getPrices;

    for (const sku in prices) {
        if (!Object.prototype.hasOwnProperty.call(prices, sku) || PURE_SKUS.includes(sku)) {
            continue;
        }

        const entry = prices[sku];
        if (!entry.enabled) {
            continue;
        }

        const last = lastTraded.get(sku);
        const daysSinceLastTrade = last === undefined ? null : now.diff(dayjs.unix(last), 'day');

        if (daysSinceLastTrade === null || daysSinceLastTrade >= minDays) {
            results.push({ sku, name: entry.name, daysSinceLastTrade });
        }
    }

    // Never-traded items first, then longest idle first
    results.sort((a, b) => {
        if (a.daysSinceLastTrade === null) {
            return b.daysSinceLastTrade === null ? 0 : -1;
        }
        if (b.daysSinceLastTrade === null) {
            return 1;
        }
        return b.daysSinceLastTrade - a.daysSinceLastTrade;
    });

    return results;
}
