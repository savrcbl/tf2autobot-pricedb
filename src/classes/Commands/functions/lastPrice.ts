import dayjs from 'dayjs';
import Currencies from '@tf2autobot/tf2-currencies';
import Bot from '../../Bot';
import { itemStats } from '../../../lib/tools/export';

export interface LastTradeEntry {
    timestamp: number;
    intent: 'bought' | 'sold';
    count: number;
    priceString: string;
}

/**
 * Gets the most recent accepted trades for a SKU, most recent first, capped
 * at `limit`. Reuses the same trade history itemStats() already builds from
 * poll data, just merged into one chronological list and reshaped for a
 * quick "what have I actually been paying/getting for this" glance instead
 * of itemStats' full 1h/24h/7d/4w breakdown.
 */
export default async function getLastTrades(bot: Bot, sku: string, limit = 5): Promise<LastTradeEntry[]> {
    const { bought, sold } = await itemStats(bot, sku);

    const entries: LastTradeEntry[] = [
        ...Object.keys(bought).map(time => {
            const trade = bought[time];
            return {
                timestamp: +time,
                intent: 'bought' as const,
                count: trade.count,
                priceString: new Currencies({ keys: trade.keys, metal: trade.metal }).toString()
            };
        }),
        ...Object.keys(sold).map(time => {
            const trade = sold[time];
            return {
                timestamp: +time,
                intent: 'sold' as const,
                count: trade.count,
                priceString: new Currencies({ keys: trade.keys, metal: trade.metal }).toString()
            };
        })
    ];

    entries.sort((a, b) => b.timestamp - a.timestamp);

    return entries.slice(0, limit);
}

export function formatLastTrade(entry: LastTradeEntry): string {
    const date = dayjs.unix(entry.timestamp).format('MMM D, YYYY HH:mm');
    const verb = entry.intent === 'bought' ? 'Bought' : 'Sold';
    const countSuffix = entry.count > 1 ? ` x${entry.count}` : '';
    return `• ${verb}${countSuffix} for ${entry.priceString} - ${date}`;
}
