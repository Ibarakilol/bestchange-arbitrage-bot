require('dotenv').config();
const axios = require('axios');
const { Telegraf, Extra } = require('telegraf');

const binance = require('./services/binance.service');
const bestChange = require('./services/bestchange.service');
const { CURRENCY_LIST } = require('./constants');
const { mapArbitrageToButton } = require('./adapters');
const { getTimeString, sleep } = require('./utils');

const MIN_SPREAD = 0.4;
const VOLUME = 2000;

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

bot.telegram.setMyCommands([
  {
    command: 'spreads',
    description: 'Список спредов',
  },
]);

let profitableArbitrages = [];

const getPairsData = async () => {
  try {
    const { data: exchangeInfo } = await axios.get('https://api.binance.com/api/v3/exchangeInfo');

    const filteredExchangeInfo = exchangeInfo.symbols
      .filter((symbolData) => symbolData.status === 'TRADING' && symbolData.quoteAsset === 'USDT')
      .map((symbolData) => ({ symbol: symbolData.symbol, asset: symbolData.baseAsset }));

    const pairsData = filteredExchangeInfo
      .filter((data) => CURRENCY_LIST.includes(data.asset))
      .reduce(
        (acc, data) => ({
          ...acc,
          [data.symbol]: { asset: data.asset, bidPrice: 0, askPrice: 0 },
        }),
        {}
      );

    console.log(`Завершено определение путей арбитража. Всего пар для арбитража: ${Object.keys(pairsData).length}.`);
    return pairsData;
  } catch (err) {
    console.log(`Ошибка получения данных для арбитража. ${err}`);
  }
};

const findArbitrages = async (pairsData, currenciesFees) => {
  const bestChangeData = await bestChange.getBestChangeData();
  const binanceTickersData = await binance.getTickersData();

  binanceTickersData.forEach((data) => {
    if (data.symbol in pairsData) {
      pairsData[data.symbol].bidPrice = data.bidPrice; // SELL
      pairsData[data.symbol].askPrice = data.askPrice; // BUY
    }
  });

  Object.keys(pairsData).forEach((symbol) => {
    if (pairsData[symbol].bidPrice && pairsData[symbol].askPrice && symbol in bestChangeData) {
      const currencyFees = currenciesFees[pairsData[symbol].asset];
      const bestChangeOption = bestChangeData[symbol].sort((prev, next) => (prev.price < next.price ? -1 : 1))[0];

      let spread = 0;
      let total = 0;
      let tradePath = '';
      let withdrawFees = 0;
      let withdrawMessage = '';

      if (currencyFees?.length) {
        const bestFee = currencyFees.sort((prev, next) => (prev.price < next.price ? -1 : 1))[0];
        withdrawFees = bestFee.fees;
        withdrawMessage = `Сеть: ${bestFee.name}, комиссия: ${bestFee.fees} ${pairsData[symbol].asset} (${(
          bestFee.fees * pairsData[symbol].askPrice
        ).toFixed(2)} USDT)\n`;
      }

      spread = 1 / pairsData[symbol].askPrice;
      const tradeFeePrice = (VOLUME / pairsData[symbol].askPrice / 100) * 0.1;
      total = VOLUME / pairsData[symbol].askPrice - tradeFeePrice - withdrawFees;
      tradePath = `Обмен 1 на Binance: USDT на ${pairsData[symbol].asset} по ${
        pairsData[symbol].askPrice
      }\nК отдаче: ${VOLUME} USDT\nК получению: ≈${total} ${
        pairsData[symbol].asset
      }\n${withdrawMessage}${binance.getSpotTradeLink(pairsData[symbol].asset)}\n\n`;

      if (bestChangeOption.minSum > total) {
        return;
      }

      spread *= 1 / bestChangeOption.price;
      total = total / bestChangeOption.price;
      tradePath += `Обмен 2 на ${bestChangeOption.exchange}: ${pairsData[symbol].asset} на USDT по ${
        bestChangeOption.price
      } (${bestChangeOption.minSum} ${pairsData[symbol].asset}/${(
        bestChangeOption.minSum / bestChangeOption.price
      ).toFixed(2)} USDT)\n${bestChangeOption.link}\n\n`;

      pairsData[symbol].id = `${pairsData[symbol].asset}USDT-binance-${bestChangeOption.exchange}`;
      pairsData[symbol].tradePath = tradePath;
      pairsData[symbol].exchange = bestChangeOption.exchange;
      pairsData[symbol].spread = parseFloat(parseFloat((spread - 1) * 100 - 0.1).toFixed(2));
      pairsData[symbol].total = total.toFixed(2);
    }
  });

  profitableArbitrages = Object.values(pairsData)
    .filter(
      (arbitrage) => !!arbitrage?.spread && arbitrage.spread >= MIN_SPREAD && parseFloat(arbitrage.total) > VOLUME
    )
    .sort((prev, next) => (prev.spread > next.spread ? -1 : 1));
};

bot.command('spreads', (ctx) => {
  bot.telegram.sendMessage(ctx.chat.id, `Найдено арбитражных сделок: ${profitableArbitrages.length}.`, {
    reply_markup: {
      inline_keyboard: profitableArbitrages.map((arbitrage) => [mapArbitrageToButton(arbitrage)]),
    },
  });
});

bot.action(/^\w+USDT-binance-\w+$/, (ctx) => {
  const id = ctx.match[0];
  const arbitrage = profitableArbitrages.find((arbitrage) => arbitrage.id === id);
  const message = `Пара: ${arbitrage.asset}USDT\n\n${arbitrage.tradePath}💰Спред: ${arbitrage.spread}%\nИтого: ${arbitrage.total} USDT`;

  ctx.reply(message, Extra.webPreview(false));
});

(async function () {
  bot.launch();

  const pairsData = await getPairsData();
  const currenciesFees = await binance.getCurrenciesFees();

  while (true) {
    console.log(`${getTimeString()}: Поиск спредов...`);
    await findArbitrages(pairsData, currenciesFees);
    console.log(`${getTimeString()}: Следующая итерация через 60 секунд.`);
    await sleep(60);
  }
})();
