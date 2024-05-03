const { createHmac } = require('node:crypto');

require('dotenv').config();
const axios = require('axios');

const { CURRENCY_LIST } = require('../constants');

class Bybit {
  createSignature(data) {
    return createHmac('sha256', process.env.BYBIT_API_SECRET).update(data).digest('hex');
  }

  getSpotTradeLink(currency) {
    return `https://www.bybit.com/ru-RU/trade/spot/${currency}/USDT`;
  }

  getFuturesTradeLink(symbol) {
    const currency = symbol.split('USDT')[0];
    return `https://www.bybit.com/trade/usdt/${currency}USDT`;
  }

  getDepositLink() {
    return 'https://www.bybit.com/user/assets/deposit';
  }

  getWithdrawLink() {
    return 'https://www.bybit.com/user/assets/withdraw';
  }

  async getMarketData() {
    try {
      const { data: exchangeInfo } = await axios.get('https://api.bybit.com/v5/market/instruments-info?category=spot');
      const { data: fundingRates } = await axios.get(
        'https://api.bybit.com/derivatives/v3/public/tickers?category=linear'
      );

      const filteredExchangeInfo = exchangeInfo.result.list
        .filter((symbolData) => symbolData.status === 'Trading' && symbolData.quoteCoin === 'USDT')
        .map((symbolData) => ({ symbol: symbolData.symbol, asset: symbolData.baseCoin }));

      const pairsData = filteredExchangeInfo
        .filter((data) => CURRENCY_LIST.includes(data.asset))
        .reduce((acc, data) => {
          const futuresSymbol = fundingRates.result.list.find((fundingRate) =>
            fundingRate.symbol.includes(data.symbol)
          )?.symbol;

          return {
            ...acc,
            [data.symbol]: {
              asset: data.asset,
              bidPrice: 0,
              askPrice: 0,
              spotLink: this.getSpotTradeLink(data.asset),
              futuresLink: futuresSymbol ? this.getFuturesTradeLink(futuresSymbol) : '',
              withdrawLink: this.getWithdrawLink(),
              depositLink: this.getDepositLink(),
            },
          };
        }, {});

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
      const data = `${timestamp}${apiKey}${recvWindow}`;
      const signature = this.createSignature(data);
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
        [coinInfo.coin]: coinInfo.chains.map((network) => ({
          name: network.chainType,
          network: network.chain,
          fees: parseFloat(network.withdrawFee),
          withdrawEnable: network.chainWithdraw === '1',
          depositEnable: network.chainDeposit === '1',
        })),
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
