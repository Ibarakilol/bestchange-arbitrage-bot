require('dotenv').config();
const { Telegraf, Extra } = require('telegraf');

const { getMarketData, getCurrenciesFees, getTickersData } = require('./services');
const bestChange = require('./services/bestchange.service');
const { mapArbitrageToButton } = require('./adapters');
const { getTimeString, sleep } = require('./utils');
const { EXCHANGE_NAME } = require('./constants');

const MIN_PROFIT = 0.5;
const VOLUME = 2000;

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

bot.telegram.setMyCommands(
  Object.entries(EXCHANGE_NAME).map(([exchange, exchangeName]) => ({
    command: `${exchange}_spreads`,
    description: `Список спредов на ${exchangeName}`,
  }))
);

const profitableArbitrages = {};

async function parseExchangesData() {
  const marketData = {};
  const feesData = {};

  for await (const exchange of Object.keys(EXCHANGE_NAME)) {
    try {
      const exchangeMarketData = await getMarketData(exchange);
      const exchangeFeesData = await getCurrenciesFees(exchange);
      marketData[exchange] = exchangeMarketData;
      feesData[exchange] = exchangeFeesData;
    } catch (err) {
      console.log(`Ошибка обработки данных для арбитража. ${err}`);
    }
  }

  return { marketData, feesData };
}

function getArbitrageMessage(arbitrage) {
  return `${arbitrage.tradePath}💰Профит: ${arbitrage.profit} USDT\nИтого: ${arbitrage.total} USDT`;
}

async function findArbitrages(marketData, feesData) {
  const bestChangeData = await bestChange.getBestChangeData();

  for await (const [exchange, exchangeName] of Object.entries(EXCHANGE_NAME)) {
    const arbitrages = [];
    const tickersData = await getTickersData(exchange);

    tickersData.forEach((data) => {
      if (data.symbol in marketData[exchange]) {
        marketData[exchange][data.symbol].bidPrice = data.bidPrice; // SELL
        marketData[exchange][data.symbol].askPrice = data.askPrice; // BUY
      }
    });

    Object.keys(marketData[exchange]).forEach((symbol) => {
      if (marketData[exchange][symbol].bidPrice && marketData[exchange][symbol].askPrice) {
        const asset = marketData[exchange][symbol].asset;
        const reversedSymbol = `USDT${asset}`;

        if (symbol in bestChangeData) {
          const marketPrice = marketData[exchange][symbol].askPrice;
          const currencyFees = feesData[exchange]?.[asset].filter((currencyFee) => currencyFee.withdrawEnable);
          const bestChangeOption = bestChangeData[symbol].sort((prev, next) => {
            if (prev.givePrice === 1 && next.givePrice === 1) {
              return prev.getPrice > next.getPrice ? -1 : 1;
            } else {
              return prev.givePrice < next.givePrice ? -1 : 1;
            }
          })[0];
          const bestChangeOptionPrice =
            bestChangeOption.givePrice === 1 ? bestChangeOption.getPrice : bestChangeOption.givePrice;

          let total = 0;
          let tradePath = '';
          let withdrawFees = 0;
          let withdrawMessage = '';

          if (currencyFees?.length) {
            const bestFee = currencyFees.sort((prev, next) =>
              prev.fees * marketPrice < next.fees * marketPrice ? -1 : 1
            )[0];
            withdrawFees = bestFee.fees;
            withdrawMessage = `Сеть: ${bestFee.name}, комиссия: ${bestFee.fees} ${asset} (${(
              bestFee.fees * marketPrice
            ).toFixed(2)} USDT)\n${marketData[exchange][symbol].withdrawLink}\n`;
          }

          const tradeFeePrice = (VOLUME / marketPrice / 100) * 0.1;
          total = VOLUME / marketPrice - tradeFeePrice - withdrawFees;
          tradePath = `Обмен 1 на ${exchangeName}: USDT на ${asset} по ${marketPrice}\nК отдаче: ${VOLUME} USDT\nК получению: ≈${total} ${asset}\n${withdrawMessage}\nСпот: ${marketData[exchange][symbol].spotLink}\n\n`;

          if (bestChangeOption.minSum > total || bestChangeOption.maxSum < total) {
            return;
          }

          total =
            bestChangeOption.givePrice === 1 ? total * bestChangeOption.getPrice : total / bestChangeOption.givePrice;
          tradePath += `Обмен 2 на ${bestChangeOption.exchange}: ${bestChangeOption.giveCurrencyName} на ${bestChangeOption.getCurrencyName} по ${bestChangeOptionPrice}\n\nСсылка: ${bestChangeOption.link}\n\n`;

          const arbitrage = {
            id: `${symbol}-${exchange}-${bestChangeOption.exchange.replace(/-/g, '')}`,
            symbol,
            tradePath,
            exchange: bestChangeOption.exchange,
            profit: parseFloat((total - VOLUME).toFixed(2)),
            total: total.toFixed(2),
          };

          arbitrages.push(arbitrage);
        }

        if (reversedSymbol in bestChangeData) {
          const marketPrice = marketData[exchange][symbol].bidPrice;
          const currencyFees = feesData[exchange]?.[asset].filter((currencyFee) => currencyFee.depositEnable);
          const bestChangeOption = bestChangeData[reversedSymbol].sort((prev, next) => {
            if (prev.givePrice === 1 && next.givePrice === 1) {
              return prev.getPrice > next.getPrice ? -1 : 1;
            } else {
              return prev.givePrice < next.givePrice ? -1 : 1;
            }
          })[0];
          const bestChangeOptionPrice =
            bestChangeOption.givePrice === 1 ? bestChangeOption.getPrice : bestChangeOption.givePrice;

          if (bestChangeOption.minSum > VOLUME || bestChangeOption.maxSum < VOLUME) {
            return;
          }

          let total = 0;
          let tradePath = '';
          let depositMessage = '';

          if (currencyFees?.length) {
            const bestFee = currencyFees.sort((prev, next) =>
              prev.fees * marketPrice < next.fees * marketPrice ? -1 : 1
            )[0];
            depositMessage = `Сеть: ${bestFee.name}, комиссия: ${bestFee.fees} ${asset} (${(
              bestFee.fees * marketPrice
            ).toFixed(2)} USDT)\n${marketData[exchange][symbol].depositLink}\n`;
          }

          total =
            bestChangeOption.givePrice === 1 ? VOLUME * bestChangeOption.getPrice : VOLUME / bestChangeOption.givePrice;
          tradePath = `Обмен 1 на ${bestChangeOption.exchange}: ${bestChangeOption.giveCurrencyName} на ${bestChangeOption.getCurrencyName} по ${bestChangeOptionPrice}\nК отдаче: ${VOLUME} USDT\nК получению: ≈${total} ${asset}\n\nСсылка: ${bestChangeOption.link}\n\n`;

          const tradeFeePrice = ((total * marketPrice) / 100) * 0.1;
          total = total * marketPrice - tradeFeePrice;
          tradePath += `Обмен 2 на ${exchangeName}: ${asset} на USDT по ${marketPrice}\n${depositMessage}\nСпот: ${marketData[exchange][symbol].spotLink}\n\n`;

          const arbitrage = {
            id: `${reversedSymbol}-${exchange}-${bestChangeOption.exchange.replace(/-/g, '')}`,
            symbol,
            tradePath,
            exchange: bestChangeOption.exchange,
            profit: parseFloat((total - VOLUME).toFixed(2)),
            total: total.toFixed(2),
          };

          arbitrages.push(arbitrage);
        }
      }
    });

    profitableArbitrages[exchange] = arbitrages
      .filter((arbitrage) => arbitrage.profit >= MIN_PROFIT)
      .sort((prev, next) => (prev.profit > next.profit ? -1 : 1));
  }
}

bot.command('binance_spreads', (ctx) => {
  bot.telegram.sendMessage(
    ctx.chat.id,
    `Найдено арбитражных сделок Binance: ${profitableArbitrages['binance']?.length ?? 0}.`,
    {
      reply_markup: {
        inline_keyboard: profitableArbitrages['binance']?.map((arbitrage) => [mapArbitrageToButton(arbitrage)]),
      },
    }
  );
});

bot.command('bybit_spreads', (ctx) => {
  bot.telegram.sendMessage(
    ctx.chat.id,
    `Найдено арбитражных сделок Bybit: ${profitableArbitrages['bybit']?.length ?? 0}.`,
    {
      reply_markup: {
        inline_keyboard: profitableArbitrages['bybit']?.map((arbitrage) => [mapArbitrageToButton(arbitrage)]),
      },
    }
  );
});

bot.action(/^\w+-(binance|bybit)-\w+$/, (ctx) => {
  const id = ctx.match[0];
  const exchange = ctx.match[0].split('-')[1];
  const arbitrage = profitableArbitrages[exchange].find((arbitrage) => arbitrage.id === id);
  const message = getArbitrageMessage(arbitrage);

  ctx.reply(message, Extra.webPreview(false));
});

(async function () {
  bot.launch();

  const { marketData, feesData } = await parseExchangesData();

  while (true) {
    console.log(`${getTimeString()}: Поиск спредов...`);
    await findArbitrages(marketData, feesData);
    console.log(
      `${getTimeString()}: Найдено арбитражных сделок на Binance: ${
        profitableArbitrages['binance']?.length ?? 0
      }, на Bybit: ${profitableArbitrages['bybit']?.length ?? 0}.`
    );
    console.log(`${getTimeString()}: Следующая итерация через 30 секунд.`);
    await sleep(30);
  }
})();
