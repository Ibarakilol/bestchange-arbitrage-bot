function mapArbitrageToButton(arbitrage) {
  return {
    text: `${arbitrage.symbol}: ${arbitrage.exchange} | ${arbitrage.profit}💰`,
    callback_data: arbitrage.id,
  };
}

module.exports = mapArbitrageToButton;
