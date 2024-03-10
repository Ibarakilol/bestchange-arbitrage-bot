const { createHmac } = require('node:crypto');

require('dotenv').config();
const axios = require('axios');

class Binance {
  createSignature(data) {
    return createHmac('sha256', process.env.BINANCE_API_SECRET).update(data).digest('hex');
  }

  getSpotTradeLink(currency) {
    return `https://www.binance.com/ru/trade/${currency}_USDT?type=spot`;
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
        [coinInfo.coin]: coinInfo.networkList
          .filter((network) => network.withdrawEnable)
          .map((network) => ({ name: network.name, fees: parseFloat(network.withdrawFee) })),
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
