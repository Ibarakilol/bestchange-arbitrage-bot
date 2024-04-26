const fs = require('fs');
const path = require('path');

const axios = require('axios');
const AdmZip = require('adm-zip');

const { CURRENCIES, EXCHANGES } = require('../constants');

const DATA_PATH = path.resolve(process.cwd(), 'bestchange-data');
const ZIP_PATH = path.resolve(DATA_PATH, 'info.zip');

class BestChangeService {
  getExchangeLink(exchangeId, giveId, getId) {
    return `https://www.bestchange.ru/click.php?id=${exchangeId}&from=${giveId}&to=${getId}&city=0`;
  }

  parseBestChangeData() {
    try {
      const bestChangeData = {};
      const ratesData = fs.readFileSync(path.resolve(DATA_PATH, 'bm_rates.dat'));

      const currencies = CURRENCIES.reduce((acc, currency) => {
        const currencyCode = /\(([^)]+)\)/.exec(currency.name)[1];

        return { ...acc, [currency.id]: { currency: currencyCode, name: currency.name } };
      }, {});

      const exchanges = EXCHANGES.reduce((acc, exchange) => ({ ...acc, [exchange.id]: { name: exchange.name } }), {});

      ratesData
        .toString()
        .split(/\r?\n/)
        .forEach((lineData) => {
          const splitedLineData = lineData.split(';');
          const giveId = splitedLineData[0];
          const getId = splitedLineData[1];
          const exchangeId = splitedLineData[2];

          if (giveId !== getId && giveId in currencies && getId in currencies && exchangeId in exchanges) {
            const tradePair = `${currencies[giveId].currency}${currencies[getId].currency}`;
            const data = {
              giveCurrencyName: currencies[giveId].name,
              getCurrencyName: currencies[getId].name,
              exchange: exchanges[exchangeId].name,
              givePrice: parseFloat(splitedLineData[3]),
              getPrice: parseFloat(splitedLineData[4]),
              minSum: parseFloat(splitedLineData[8]),
              maxSum: parseFloat(splitedLineData[9]),
              link: this.getExchangeLink(exchangeId, giveId, getId),
            };

            if (tradePair in bestChangeData) {
              bestChangeData[tradePair].push(data);
            } else {
              bestChangeData[tradePair] = [data];
            }
          }
        });

      return bestChangeData;
    } catch (err) {
      console.log(`Ошибка обработки данных. ${err}`);
    }
  }

  async getBestChangeData() {
    if (!fs.existsSync('./bestchange-data')) {
      fs.mkdirSync('./bestchange-data');
    }

    const writer = fs.createWriteStream(ZIP_PATH);

    try {
      const response = await axios({
        url: 'http://api.bestchange.ru/info.zip',
        method: 'GET',
        responseType: 'stream',
      });

      response.data.pipe(writer);

      return new Promise((resolve) => {
        writer.on('finish', () => {
          const zip = new AdmZip(ZIP_PATH);
          zip.extractAllTo(DATA_PATH, true);
          fs.unlinkSync(ZIP_PATH);
          resolve(this.parseBestChangeData());
        });
        writer.on('error', (err) => console.log(`Ошибка сохранения данных BestChange. ${err}`));
      });
    } catch (err) {
      console.log(`Ошибка получения данных BestChange. ${err}`);
    }
  }

  parseBestChangeExchanges() {
    try {
      const exchangesData = fs.readFileSync(path.resolve(DATA_PATH, 'bm_exch.dat'));

      exchangesData
        .toString()
        .split(/\r?\n/)
        .forEach((lineData) => {
          const splitedLineData = lineData.split(';');
          console.log({ id: splitedLineData[0], name: splitedLineData[1] });
        });
    } catch (err) {
      console.log(`Ошибка обработки данных. ${err}`);
    }
  }
}

module.exports = new BestChangeService();
