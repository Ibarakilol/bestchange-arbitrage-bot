function mapArbitrageToButton(arbitrage) {
  return {
    text: `${arbitrage.asset}USDT: ${arbitrage.exchange} | ${arbitrage.spread}%`,
    callback_data: arbitrage.id,
  };
}

module.exports = mapArbitrageToButton;
