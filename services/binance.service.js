const { createHmac } = require('node:crypto');

require('dotenv').config();
const axios = require('axios');

const { CURRENCY_LIST } = require('../constants');

class Binance {
  createSignature(data) {
    return createHmac('sha256', process.env.BINANCE_API_SECRET).update(data).digest('hex');
  }

  getSpotTradeLink(currency) {
    return `https://www.binance.com/ru/trade/${currency}_USDT?type=spot`;
  }

  getFuturesTradeLink(symbol) {
    const currency = symbol.split('USDT')[0];
    return `https://www.binance.com/ru/futures/${currency}USDT`;
  }

  getDepositLink(currency) {
    return `https://www.binance.com/ru/my/wallet/account/main/deposit/crypto/${currency}`;
  }

  getWithdrawLink(currency) {
    return `https://www.binance.com/ru/my/wallet/account/main/withdrawal/crypto/${currency}`;
  }

  async getMarketData() {
    try {
      const { data: exchangeInfo } = await axios.get('https://api.binance.com/api/v3/exchangeInfo');
      const { data: fundingRates } = await axios.get('https://fapi.binance.com/fapi/v1/premiumIndex');

      const filteredExchangeInfo = exchangeInfo.symbols
        .filter((symbolData) => symbolData.status === 'TRADING' && symbolData.quoteAsset === 'USDT')
        .map((symbolData) => ({ symbol: symbolData.symbol, asset: symbolData.baseAsset }));

      const pairsData = filteredExchangeInfo
        .filter((data) => CURRENCY_LIST.includes(data.asset))
        .reduce((acc, data) => {
          const futuresSymbol = fundingRates.find((fundingRate) => fundingRate.symbol.includes(data.symbol))?.symbol;

          return {
            ...acc,
            [data.symbol]: {
              asset: data.asset,
              bidPrice: 0,
              askPrice: 0,
              spotLink: this.getSpotTradeLink(data.asset),
              futuresLink: futuresSymbol ? this.getFuturesTradeLink(futuresSymbol) : '',
              withdrawLink: this.getWithdrawLink(data.asset),
              depositLink: this.getDepositLink(data.asset),
            },
          };
        }, {});

      return pairsData;
    } catch (err) {
      console.log(`Ошибка обработки данных Binance. ${err}`);
    }
  }

  async getCurrenciesFees() {
    try {
      const queryParams = new URLSearchParams({ recvWindow: 5000, timestamp: Date.now() });
      const signature = this.createSignature(queryParams.toString());
      const url = `https://api.binance.com/sapi/v1/capital/config/getall?${queryParams.toString()}&signature=${signature}`;

      const { data: coinsInfo } = await axios.get(url, {
        headers: {
          'X-MBX-APIKEY': process.env.BINANCE_API_KEY,
        },
      });

      return coinsInfo.reduce((acc, coinInfo) => ({
        ...acc,
        [coinInfo.coin]: coinInfo.networkList.map((network) => ({
          name: network.name,
          network: network.network,
          fees: parseFloat(network.withdrawFee),
          withdrawEnable: network.withdrawEnable,
          depositEnable: network.depositEnable,
        })),
      }));
    } catch (err) {
      console.log(`Ошибка получения комиссий Binance. ${err}`);
    }
  }

  async getTickersData() {
    try {
      const { data: tickersData } = await axios.get('https://api.binance.com/api/v3/ticker/bookTicker');

      return tickersData.map((tickerData) => ({
        symbol: tickerData.symbol,
        bidPrice: parseFloat(tickerData.bidPrice),
        askPrice: parseFloat(tickerData.askPrice),
      }));
    } catch (err) {
      console.log(`Ошибка получения цен Binance. ${err}`);
    }
  }
}

module.exports = new Binance();
