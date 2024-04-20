require('dotenv').config();
const { Telegraf, Extra } = require('telegraf');

const { getMarketData, getCurrenciesFees, getTickersData } = require('./services');
const bestChange = require('./services/bestchange.service');
const { mapArbitrageToButton } = require('./adapters');
const { getTimeString, sleep } = require('./utils');
const { EXCHANGE_NAME } = require('./constants');

const MIN_SPREAD = 0.2;
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
  return `Пара: ${arbitrage.asset}USDT\n\n${arbitrage.tradePath}💰Спред: ${arbitrage.spread}%\nИтого: ${arbitrage.total} USDT`;
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
      if (marketData[exchange][symbol].bidPrice && marketData[exchange][symbol].askPrice && symbol in bestChangeData) {
        const currencyFees = feesData[exchange]?.[marketData[exchange][symbol].asset];
        const bestChangeOption = bestChangeData[symbol].sort((prev, next) => (prev.price < next.price ? -1 : 1))[0];

        let spread = 0;
        let total = 0;
        let tradePath = '';
        let withdrawFees = 0;
        let withdrawMessage = '';

        if (currencyFees?.length) {
          const bestFee = currencyFees.sort((prev, next) => (prev.price < next.price ? -1 : 1))[0];
          withdrawFees = bestFee.fees;
          withdrawMessage = `Сеть: ${bestFee.name}, комиссия: ${bestFee.fees} ${marketData[exchange][symbol].asset} (${(
            bestFee.fees * marketData[exchange][symbol].askPrice
          ).toFixed(2)} USDT)\n`;
        }

        spread = 1 / marketData[exchange][symbol].askPrice;
        const tradeFeePrice = (VOLUME / marketData[exchange][symbol].askPrice / 100) * 0.1;
        total = VOLUME / marketData[exchange][symbol].askPrice - tradeFeePrice - withdrawFees;
        tradePath = `Обмен 1 на ${exchangeName}: USDT на ${marketData[exchange][symbol].asset} по ${marketData[exchange][symbol].askPrice}\nК отдаче: ${VOLUME} USDT\nК получению: ≈${total} ${marketData[exchange][symbol].asset}\n${withdrawMessage}${marketData[exchange][symbol].spotLink}\n\n`;

        if (bestChangeOption.minSum > total || bestChangeOption.maxSum < total) {
          return;
        }

        spread *= 1 / bestChangeOption.price;
        total = total / bestChangeOption.price;
        tradePath += `Обмен 2 на ${bestChangeOption.exchange}: ${bestChangeOption.giveCurrencyName} на ${
          bestChangeOption.getCurrencyName
        } по ${bestChangeOption.price} (${bestChangeOption.minSum} ${marketData[exchange][symbol].asset}/${(
          bestChangeOption.minSum / bestChangeOption.price
        ).toFixed(2)} USDT)\n${bestChangeOption.link}\n\n`;

        const arbitrage = {
          id: `${marketData[exchange][symbol].asset}USDT-${exchange}-${bestChangeOption.exchange.replace(/-/g, '')}`,
          asset: marketData[exchange][symbol].asset,
          tradePath,
          exchange: bestChangeOption.exchange,
          spread: parseFloat(parseFloat((spread - 1) * 100 - 0.1).toFixed(2)),
          total: total.toFixed(2),
        };

        arbitrages.push(arbitrage);
      }
    });

    profitableArbitrages[exchange] = arbitrages
      .filter(
        (arbitrage) => !!arbitrage?.spread && arbitrage.spread >= MIN_SPREAD && parseFloat(arbitrage.total) > VOLUME
      )
      .sort((prev, next) => (prev.spread > next.spread ? -1 : 1));
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
