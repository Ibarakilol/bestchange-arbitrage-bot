function getTimeString() {
  const date = new Date();
  const hours = date.getHours();
  const minutes = `0${date.getMinutes()}`;
  return `${hours}:${minutes.slice(-2)}`;
}

module.exports = getTimeString;
