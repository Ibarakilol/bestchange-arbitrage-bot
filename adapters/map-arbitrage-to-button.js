function mapArbitrageToButton(arbitrage) {
  return {
    text: `${arbitrage.symbol}: ${arbitrage.exchange} | ${arbitrage.spread}%`,
    callback_data: arbitrage.id,
  };
}

module.exports = mapArbitrageToButton;
