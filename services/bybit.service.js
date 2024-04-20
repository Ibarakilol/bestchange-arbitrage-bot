const { createHmac } = require('node:crypto');

require('dotenv').config();
const axios = require('axios');

const { CURRENCY_LIST } = require('../constants');

class Bybit {
  getSpotTradeLink(currency) {
    return `https://www.bybit.com/en/trade/spot/${currency}/USDT`;
  }

  async getMarketData() {
    try {
      const { data: exchangeInfo } = await axios.get('https://api.bybit.com/v5/market/instruments-info?category=spot');

      const filteredExchangeInfo = exchangeInfo.result.list
        .filter((symbolData) => symbolData.status === 'Trading' && symbolData.quoteCoin === 'USDT')
        .map((symbolData) => ({ symbol: symbolData.symbol, asset: symbolData.baseCoin }));

      const pairsData = filteredExchangeInfo
        .filter((data) => CURRENCY_LIST.includes(data.asset))
        .reduce(
          (acc, data) => ({
            ...acc,
            [data.symbol]: { asset: data.asset, bidPrice: 0, askPrice: 0, spotLink: this.getSpotTradeLink(data.asset) },
          }),
          {}
        );

      return pairsData;
    } catch (err) {
      console.log(`Ошибка обработки данных Bybit. ${err}`);
    }
  }

  async getCurrenciesFees() {
    try {
      const timestamp = Date.now();
      const recvWindow = 5000;
      const apiKey = process.env.BYBIT_API_KEY;
      const signature = createHmac('sha256', process.env.BYBIT_API_SECRET)
        .update(`${timestamp}${apiKey}${recvWindow}`)
        .digest('hex');
      const url = 'https://api.bybit.com/v5/asset/coin/query-info';

      const { data: coinsInfo } = await axios.get(url, {
        headers: {
          'X-BAPI-SIGN': signature,
          'X-BAPI-API-KEY': apiKey,
          'X-BAPI-TIMESTAMP': timestamp,
          'X-BAPI-RECV-WINDOW': recvWindow,
        },
      });

      return coinsInfo.result.rows.reduce((acc, coinInfo) => ({
        ...acc,
        [coinInfo.coin]: coinInfo.chains
          .filter((network) => network.chainWithdraw === '1')
          .map((network) => ({ name: network.chainType, fees: parseFloat(network.withdrawFee) })),
      }));
    } catch (err) {
      console.log(`Ошибка получения комиссий Bybit. ${err}`);
    }
  }

  async getTickersData() {
    try {
      const { data: tickersData } = await axios.get('https://api.bybit.com/v5/market/tickers?category=spot');

      return tickersData.result.list.map((tickerData) => ({
        symbol: tickerData.symbol,
        bidPrice: parseFloat(tickerData.bid1Price),
        askPrice: parseFloat(tickerData.ask1Price),
      }));
    } catch (err) {
      console.log(`Ошибка получения цен Bybit. ${err}`);
    }
  }
}

module.exports = new Bybit();
