const binance = require('./binance.service');
const bybit = require('./bybit.service');

async function getMarketData(exchange) {
  switch (exchange) {
    case 'binance':
      return await binance.getMarketData();
    case 'bybit':
      return await bybit.getMarketData();
    default:
      return null;
  }
}

async function getCurrenciesFees(exchange) {
  switch (exchange) {
    case 'binance':
      return await binance.getCurrenciesFees();
    case 'bybit':
      return await bybit.getCurrenciesFees();
    default:
      return null;
  }
}

async function getTickersData(exchange) {
  switch (exchange) {
    case 'binance':
      return await binance.getTickersData();
    case 'bybit':
      return await bybit.getTickersData();
    default:
      return null;
  }
}

module.exports = { getMarketData, getCurrenciesFees, getTickersData };
