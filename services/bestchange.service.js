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
              exchange: exchanges[exchangeId].name,
              price:
                parseFloat(splitedLineData[3]) === 1 ? parseFloat(splitedLineData[4]) : parseFloat(splitedLineData[3]),
              minSum: parseFloat(splitedLineData[8]),
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
          console.log('Данные BestChange извлечены успешно.');
          resolve(this.parseBestChangeData());
        });
        writer.on('error', (err) => console.log(`Ошибка сохранения данных BestChange. ${err}`));
      });
    } catch (err) {
      console.log(`Ошибка получения данных BestChange. ${err}`);
    }
  }
}

module.exports = new BestChangeService();
